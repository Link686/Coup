(function () {
'use strict';
// Rede peer-to-peer com PeerJS (WebRTC). O anfitrião guarda o estado oficial;
// os convidados só enviam jogadas e recebem a visão filtrada deles.
// O servidor público do PeerJS é usado apenas para "apresentar" os navegadores.

const { createGame, applyIntent, getView, RESPONSE_PHASES, MODES, MIN_PLAYERS } = window.JogoEngine;

const PREFIX = 'eusouduquepego3-v1-';
const HOST_SAVE_KEY = 'esdp3.host';
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const HOST_ID = 'p0';

function randomCode(len = 5) {
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  return Array.from(bytes, (b) => CODE_CHARS[b % CODE_CHARS.length]).join('');
}

const randomToken = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');

const cryptoRng = () => crypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32;

function safeStorage(kind) {
  try { return window[kind]; } catch { return null; }
}

function loadSavedHost() {
  try { return JSON.parse(safeStorage('localStorage')?.getItem(HOST_SAVE_KEY) || 'null'); } catch { return null; }
}

function clearSavedHost() {
  try { safeStorage('localStorage')?.removeItem(HOST_SAVE_KEY); } catch { /* ignora */ }
}

function peerErrorMessage(err) {
  switch (err?.type) {
    case 'peer-unavailable': return 'Sala não encontrada. Confira o código.';
    case 'unavailable-id': return 'Esse código de sala já está em uso.';
    case 'network':
    case 'server-error':
    case 'socket-error':
    case 'socket-closed': return 'Sem conexão com o servidor de pareamento. Verifique a internet.';
    case 'browser-incompatible': return 'Este navegador não suporta WebRTC.';
    default: return err?.message || 'Erro de conexão.';
  }
}

// ======================================================================
// ANFITRIÃO
// ======================================================================

class HostSession {
  constructor({ name, saved = null, onUpdate, onStatus }) {
    this.role = 'host';
    this.onUpdate = onUpdate;
    this.onStatus = onStatus;
    this.conns = new Map(); // playerId -> DataConnection
    this.timer = null;
    this.deadline = null;

    if (saved) {
      this.code = saved.code;
      this.players = saved.players;
      this.game = saved.game;
      this.settings = saved.settings;
      this.nextId = saved.nextId;
    } else {
      this.code = randomCode();
      this.players = [{ id: HOST_ID, name, token: null }];
      this.game = null;
      this.settings = { responseSeconds: 0, mode: 'classico' };
      this.nextId = 1;
    }
    this.playerId = HOST_ID;
  }

  start() {
    this.status('conectando');
    this.openPeer(0);
  }

  openPeer(attempt) {
    const peer = new window.Peer(PREFIX + this.code, { debug: 1 });
    this.peer = peer;
    peer.on('open', () => { this.status('online'); this.publish(); });
    peer.on('connection', (conn) => this.attach(conn));
    peer.on('disconnected', () => {
      this.status('reconectando');
      setTimeout(() => { if (!peer.destroyed) peer.reconnect(); }, 1500);
    });
    peer.on('error', (err) => {
      if (err.type === 'unavailable-id') {
        peer.destroy();
        // Ao recarregar a página, o servidor ainda segura o código por alguns segundos.
        if (attempt < 6 && (this.game || this.players.length > 1)) {
          this.status('reconectando');
          setTimeout(() => this.openPeer(attempt + 1), 3000);
        } else {
          this.code = randomCode();
          this.openPeer(attempt + 1);
        }
        return;
      }
      if (err.type === 'peer-unavailable') return;
      this.status('erro', peerErrorMessage(err));
    });
  }

  attach(conn) {
    conn.on('data', (msg) => this.onMessage(conn, msg));
    conn.on('close', () => this.onClose(conn));
    conn.on('error', () => this.onClose(conn));
  }

  onClose(conn) {
    if (conn.playerId && this.conns.get(conn.playerId) === conn) {
      this.conns.delete(conn.playerId);
      this.publish();
    }
  }

  onMessage(conn, msg) {
    if (!msg || typeof msg !== 'object') return;
    if (msg.t === 'hello') return this.onHello(conn, msg);
    if (!conn.playerId) return;
    if (msg.t === 'intent') this.handleIntent(conn.playerId, msg.intent, conn);
    if (msg.t === 'leave') this.removePlayer(conn.playerId);
  }

  onHello(conn, { name, token }) {
    name = String(name || '').trim().slice(0, 20) || 'Jogador';
    token = String(token || '');
    let p = this.players.find((x) => x.token && x.token === token);

    if (!p) {
      if (this.game) return this.reject(conn, 'A partida já começou. Peça ao anfitrião para abrir uma nova sala.');
      if (this.players.length >= this.maxPlayers()) return this.reject(conn, `A sala está cheia (máximo de ${this.maxPlayers()} no modo ${MODES[this.settings.mode].name}).`);
      p = { id: 'p' + this.nextId++, name: this.uniqueName(name), token };
      this.players.push(p);
    } else if (!this.game) {
      p.name = this.uniqueName(name, p.id);
    }

    const old = this.conns.get(p.id);
    if (old && old !== conn) { old.playerId = null; old.close(); }
    conn.playerId = p.id;
    this.conns.set(p.id, conn);
    conn.send({ t: 'welcome', playerId: p.id, code: this.code });
    this.publish();
  }

  uniqueName(name, selfId = null) {
    let final = name;
    let i = 2;
    while (this.players.some((p) => p.id !== selfId && p.name.toLowerCase() === final.toLowerCase())) final = `${name} ${i++}`;
    return final;
  }

  reject(conn, message) {
    conn.send({ t: 'rejected', message });
    setTimeout(() => conn.close(), 500);
  }

  removePlayer(id) {
    if (id === HOST_ID || this.game) return;
    this.players = this.players.filter((p) => p.id !== id);
    const c = this.conns.get(id);
    if (c) { c.send({ t: 'rejected', message: 'Você foi removido da sala.' }); setTimeout(() => c.close(), 300); }
    this.conns.delete(id);
    this.publish();
  }

  maxPlayers() {
    return (MODES[this.settings.mode] || MODES.classico).max;
  }

  setSettings(patch) {
    if (this.game) return;
    Object.assign(this.settings, patch);
    this.publish();
  }

  startGame() {
    if (this.players.length > this.maxPlayers()) return `O modo ${MODES[this.settings.mode].name} aceita até ${this.maxPlayers()} jogadores. Troque para o modo Festa.`;
    if (this.players.length < MIN_PLAYERS) return `São necessários pelo menos ${MIN_PLAYERS} jogadores.`;
    this.game = createGame(this.players.map(({ id, name }) => ({ id, name })), { rng: cryptoRng });
    this.publish();
    return null;
  }

  backToLobby() {
    this.game = null;
    // Quem saiu da sala durante a partida não volta automaticamente para o lobby.
    this.players = this.players.filter((p) => p.id === HOST_ID || this.conns.has(p.id));
    this.publish();
  }

  // Jogada do próprio anfitrião (sem passar pela rede).
  send(intent) {
    return this.handleIntent(HOST_ID, intent, null);
  }

  handleIntent(playerId, intent, conn) {
    if (!this.game) return 'Nenhuma partida em andamento.';
    const res = applyIntent(this.game, playerId, intent, { rng: cryptoRng });
    if (!res.ok) {
      if (conn) conn.send({ t: 'error', message: res.error });
      return res.error;
    }
    this.publish();
    return null;
  }

  // Passa automaticamente quem não respondeu a tempo.
  armTimer() {
    const g = this.game;
    const secs = this.settings.responseSeconds;
    if (!secs || !g || !RESPONSE_PHASES.includes(g.phase)) {
      clearTimeout(this.timer); this.timer = null; this.timerKey = null; this.deadline = null;
      return;
    }
    // Uma nova janela de resposta (fase mudou) reinicia o relógio. Um "passar" no meio não.
    const windowKey = g.step;
    if (this.timerKey === windowKey) return;
    clearTimeout(this.timer);
    this.timerKey = windowKey;
    this.deadline = Date.now() + secs * 1000;
    this.timer = setTimeout(() => {
      this.timer = null;
      const st = this.game;
      if (!st || !RESPONSE_PHASES.includes(st.phase)) return;
      const phase = st.phase;
      const waiting = st.pending.responders.filter((id) => !st.pending.passed.includes(id));
      for (const id of waiting) {
        if (st.phase !== phase) break;
        applyIntent(this.game, id, { type: 'pass' }, { rng: cryptoRng });
      }
      this.timerKey = null;
      this.publish();
    }, secs * 1000);
  }

  lobbyInfo() {
    return {
      code: this.code,
      hostId: HOST_ID,
      settings: { ...this.settings },
      players: this.players.map((p) => ({ id: p.id, name: p.name, connected: p.id === HOST_ID || this.conns.has(p.id) })),
      inGame: !!this.game,
    };
  }

  publish() {
    this.armTimer();
    const lobby = this.lobbyInfo();
    const msLeft = this.deadline ? Math.max(0, this.deadline - Date.now()) : null;
    for (const [id, conn] of this.conns) {
      if (conn.open) conn.send({ t: 'state', lobby, view: this.game ? getView(this.game, id) : null, msLeft });
    }
    this.onUpdate?.({ lobby, view: this.game ? getView(this.game, HOST_ID) : null, msLeft });
    this.save();
  }

  save() {
    try {
      safeStorage('localStorage')?.setItem(HOST_SAVE_KEY, JSON.stringify({
        code: this.code, players: this.players, game: this.game, settings: this.settings, nextId: this.nextId, savedAt: Date.now(),
      }));
    } catch { /* armazenamento indisponível: segue sem salvar */ }
  }

  status(state, message = null) {
    this.onStatus?.({ state, message });
  }

  close() {
    clearTimeout(this.timer);
    for (const c of this.conns.values()) c.send({ t: 'rejected', message: 'O anfitrião encerrou a sala.' });
    clearSavedHost();
    setTimeout(() => this.peer?.destroy(), 300);
  }
}

// ======================================================================
// CONVIDADO
// ======================================================================

class ClientSession {
  constructor({ code, name, onUpdate, onStatus, onError, onRejected }) {
    this.role = 'client';
    this.code = code.toUpperCase();
    this.name = name;
    this.onUpdate = onUpdate;
    this.onStatus = onStatus;
    this.onError = onError;
    this.onRejected = onRejected;
    this.playerId = null;
    this.everConnected = false;
    this.closed = false;
    const key = 'esdp3.token.' + this.code;
    const ss = safeStorage('sessionStorage');
    this.token = ss?.getItem(key) || randomToken();
    try { ss?.setItem(key, this.token); } catch { /* ignora */ }
  }

  start() {
    this.status('conectando');
    this.peer = new window.Peer({ debug: 1 });
    this.peer.on('open', () => this.connect());
    this.peer.on('disconnected', () => { if (!this.closed) setTimeout(() => !this.peer.destroyed && this.peer.reconnect(), 1500); });
    this.peer.on('error', (err) => {
      if (err.type === 'peer-unavailable') {
        if (!this.everConnected) { this.closed = true; this.status('erro', peerErrorMessage(err)); }
        else this.retry();
        return;
      }
      this.status('erro', peerErrorMessage(err));
      this.retry();
    });
  }

  connect() {
    if (this.closed) return;
    const conn = this.peer.connect(PREFIX + this.code, { reliable: true, serialization: 'json' });
    this.conn = conn;
    conn.on('open', () => conn.send({ t: 'hello', name: this.name, token: this.token }));
    conn.on('data', (msg) => this.onMessage(msg));
    conn.on('close', () => { if (this.conn === conn) this.retry(); });
    conn.on('error', () => { if (this.conn === conn) this.retry(); });
  }

  retry() {
    if (this.closed || this.retrying) return;
    this.retrying = true;
    this.status('reconectando');
    setTimeout(() => {
      this.retrying = false;
      if (this.closed) return;
      if (this.peer.disconnected) this.peer.reconnect();
      if (this.peer.open) this.connect();
    }, 2000);
  }

  onMessage(msg) {
    if (!msg || typeof msg !== 'object') return;
    switch (msg.t) {
      case 'welcome':
        this.everConnected = true;
        this.playerId = msg.playerId;
        this.status('online');
        break;
      case 'state':
        this.onUpdate?.({ lobby: msg.lobby, view: msg.view, msLeft: msg.msLeft });
        break;
      case 'error':
        this.onError?.(msg.message);
        break;
      case 'rejected':
        this.closed = true;
        this.onRejected?.(msg.message);
        this.peer?.destroy();
        break;
    }
  }

  send(intent) {
    if (!this.conn?.open) return 'Sem conexão com o anfitrião.';
    this.conn.send({ t: 'intent', intent });
    return null;
  }

  leave() {
    this.closed = true;
    try { this.conn?.send({ t: 'leave' }); } catch { /* ignora */ }
    try { safeStorage('sessionStorage')?.removeItem('esdp3.token.' + this.code); } catch { /* ignora */ }
    setTimeout(() => this.peer?.destroy(), 300);
  }

  status(state, message = null) {
    this.onStatus?.({ state, message });
  }
}

window.JogoNet = { HOST_ID, randomCode, loadSavedHost, clearSavedHost, HostSession, ClientSession };
})();
