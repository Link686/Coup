(function () {
'use strict';
// Interface. Re-renderiza a tela a cada mudança de estado.
const { ACTIONS, CARD_TYPES, MIN_PLAYERS, MODES, MUST_COUP_AT } = window.JogoEngine;
const { HostSession, ClientSession, HOST_ID, loadSavedHost, clearSavedHost } = window.JogoNet;
const { CHARS, face, back } = window.JogoCards;

const $app = document.getElementById('app');
const $toast = document.getElementById('toast');
const $sheet = document.getElementById('sheet');
const $modal = document.getElementById('modal');
const $notice = document.getElementById('notice');

const ui = {
  session: null,
  lobby: null,
  view: null,
  status: { state: 'offline', message: null },
  deadline: null,
  modal: null,
  sheet: null,
  deltas: {},
  busy: false,
  lastLogN: null,
  exchangeSel: [],
  exchangeOpen: false,
  peek: null,
  lastSeq: -1,
};

// ---------- utilidades ----------

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* ignora */ } },
};
const sstore = {
  get(k) { try { return JSON.parse(sessionStorage.getItem(k) || 'null'); } catch { return null; } },
  set(k, v) { try { sessionStorage.setItem(k, JSON.stringify(v)); } catch { /* ignora */ } },
  del(k) { try { sessionStorage.removeItem(k); } catch { /* ignora */ } },
};

let toastTimer;
function toast(msg, ok = false) {
  $toast.textContent = msg;
  $toast.classList.toggle('ok', ok);
  $toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { $toast.hidden = true; }, 3500);
}

const nameOf = (id) => ui.view?.players.find((p) => p.id === id)?.name ?? ui.lobby?.players.find((p) => p.id === id)?.name ?? '?';
const charName = (t) => CHARS[t]?.name ?? t;
const coin = (n) => `<span class="coinpill"><i class="coin"></i>${n}</span>`;

// ---------- sessões ----------

function callbacks() {
  return {
    onUpdate({ lobby, view, msLeft }) {
      ui.lobby = lobby;
      const stepChanged = !view || view.step !== ui.view?.step;
      if (stepChanged) {
        ui.exchangeSel = [];
        ui.exchangeOpen = false;
        if (ui.modal) { closeModal(); if (view) toast('A situação mudou na mesa.'); }
      }
      ui.busy = false;
      notifyEvents(view);
      ui.deltas = {};
      if (view && ui.view) {
        for (const p of view.players) {
          const old = ui.view.players.find((x) => x.id === p.id);
          if (old && old.coins !== p.coins) ui.deltas[p.id] = p.coins - old.coins;
        }
      }
      ui.view = view;
      ui.lastSeq = view?.seq ?? -1;
      ui.deadline = msLeft != null ? Date.now() + msLeft : null;
      render();
      if (ui.sheet === 'history') refreshHistory();
      if (stepChanged && myTask(view)) attention();
    },
    onStatus(st) {
      ui.status = st;
      if (st.state === 'erro' && st.message) toast(st.message);
      render();
    },
    onError(msg) {
      ui.busy = false;
      toast(msg);
      render();
    },
    onRejected(msg) {
      toast(msg);
      sstore.del('esdp3.client');
      resetToHome();
    },
  };
}

function hostGame(saved = null) {
  const name = readName();
  if (!name && !saved) return;
  ui.session = new HostSession({ name, saved, ...callbacks() });
  ui.session.start();
  setUrlCode(ui.session.code);
  ui.session.publish();
}

function joinGame(code, name) {
  code = (code || '').trim().toUpperCase();
  if (code.length < 4) return toast('Digite o código da sala.');
  if (!name) return;
  ui.session = new ClientSession({ code, name, ...callbacks() });
  sstore.set('esdp3.client', { code, name });
  ui.session.start();
  setUrlCode(code);
  render();
}

function resetToHome() {
  ui.session = null;
  ui.lobby = null;
  ui.view = null;
  ui.status = { state: 'offline', message: null };
  setUrlCode(null);
  render();
}

function leave() {
  if (!ui.session) return;
  if (ui.session.role === 'host') {
    if (!confirm('Encerrar a sala para todos?')) return;
    ui.session.close();
  } else {
    if (ui.view && ui.view.phase !== 'gameOver' && !confirm('Sair da partida?')) return;
    ui.session.leave();
    sstore.del('esdp3.client');
  }
  resetToHome();
}

function setUrlCode(code) {
  const url = new URL(location.href);
  if (code) url.searchParams.set('sala', code); else url.searchParams.delete('sala');
  history.replaceState(null, '', url);
}

function readName() {
  const el = document.getElementById('name');
  const name = (el?.value || '').trim().slice(0, 20);
  if (!name) { toast('Digite seu nome.'); el?.focus(); return null; }
  store.set('esdp3.name', name);
  return name;
}

// Envia a jogada junto com o "step" que eu estava vendo: se a mesa mudou
// enquanto isso, o anfitrião recusa em vez de aplicar na fase errada.
function send(intent) {
  if (!ui.session || ui.busy) return;
  if (intent.step === undefined) intent = { ...intent, step: ui.view?.step };
  ui.busy = true;
  const err = ui.session.send(intent);
  if (err) { ui.busy = false; toast(err); }
  render();
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Alternativa para navegadores sem acesso à área de transferência.
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { ok = false; }
    ta.remove();
    return ok;
  }
}

function shareLink() {
  const url = new URL(location.href);
  url.searchParams.set('sala', ui.lobby.code);
  return url.toString();
}

// ---------- telas ----------

function render() {
  document.body.classList.toggle('in-game', !!(ui.session && ui.lobby && ui.view));
  if (!ui.session) return renderHome();
  if (!ui.lobby) return renderConnecting();
  if (!ui.view) return renderLobby();
  return renderGame();
}

function rulesButton(label = 'Cartas e regras') {
  return `<button class="ghost rules-btn" data-do="rules" aria-label="Ver cartas e regras">📖 ${label}</button>`;
}

function renderConnecting() {
  const st = ui.status;
  $app.innerHTML = `
    <h1 class="logo" aria-label="EuSouDuquePego3"><span>EuSou</span><span class="logo-duque">Duque</span><span>Pego<b>3</b></span></h1>
    <div class="panel stack">
      <p>${st.state === 'erro' ? esc(st.message) : 'Conectando à sala…'}</p>
      <button class="block" data-do="leave">Voltar</button>
    </div>`;
}

function renderHome() {
  const params = new URLSearchParams(location.search);
  const code = params.get('sala') || '';
  const saved = loadSavedHost();
  const name = store.get('esdp3.name') || '';
  $app.innerHTML = `
    <div class="hero">
      <div class="hero-cards">${['assassino', 'duque', 'condessa'].map((t) => face(t, { size: 'sm', detail: false })).join('')}</div>
      <h1 class="logo" aria-label="EuSouDuquePego3"><span>EuSou</span><span class="logo-duque">Duque</span><span>Pego<b>3</b></span></h1>
      <p class="muted">Blefe, intriga e influência. De 2 a 15 jogadores, cada um no seu celular.</p>
      ${rulesButton()}
    </div>
    <div class="panel stack">
      <div>
        <label for="name">Seu nome</label>
        <input id="name" maxlength="20" autocomplete="nickname" value="${esc(name)}" placeholder="Como os outros vão te ver">
      </div>
    </div>
    <div class="panel stack">
      <h2>Entrar em uma sala</h2>
      <input id="code" class="code" maxlength="6" placeholder="CÓDIGO" value="${esc(code)}" autocomplete="off">
      <button class="primary block" data-do="join">Entrar</button>
    </div>
    <div class="panel stack">
      <h2>Ser o anfitrião</h2>
      <p class="muted small">Seu navegador controla a partida. Mantenha esta aba aberta até o fim do jogo.</p>
      <button class="block ${code ? '' : 'primary'}" data-do="host">Criar sala</button>
      ${saved ? `
        <button class="block" data-do="resume">Retomar sala ${esc(saved.code)}${saved.game ? ' (partida em andamento)' : ''}</button>
        <button class="ghost block small" data-do="forget">Descartar sala salva</button>` : ''}
    </div>
    <p class="disclaimer">Projeto de fã, gratuito e não oficial, inspirado em um jogo de cartas de blefe. Não tem afiliação com os detentores da marca Coup nem com suas editoras. Se você gosta, compre o jogo original!</p>`;
  if (code) document.getElementById(name ? 'code' : 'name').focus();
}

function renderLobby() {
  const l = ui.lobby;
  const isHost = ui.session.role === 'host';
  const mode = MODES[l.settings.mode] || MODES.classico;
  const tooMany = l.players.length > mode.max;
  const enough = l.players.length >= MIN_PLAYERS && !tooMany;
  $app.innerHTML = `
    ${topbar()}
    <div class="panel stack">
      <p class="muted small center">Código da sala</p>
      <div class="big-code">${esc(l.code)}</div>
      <p class="muted small center">Mande o link no grupo para o pessoal entrar:</p>
      <div class="share-row">
        <button class="primary" data-do="copyLink">📋 Copiar link da sala</button>
        <button class="whatsapp" data-do="whatsapp">WhatsApp</button>
        <button data-do="share">Compartilhar…</button>
      </div>
      <div class="linkbox">${esc(shareLink())}</div>
      ${location.protocol === 'file:' ? '<p class="muted small">⚠️ Você abriu o jogo direto do arquivo, então este link só funciona neste computador. Depois de publicar no GitHub Pages, o link funciona para todos.</p>' : ''}
    </div>
    <div class="panel">
      <h2>Jogadores (${l.players.length}/${mode.max})</h2>
      <ul class="list">
        ${l.players.map((p) => `
          <li>
            ${avatar(p.id, p.name)}
            <span class="dot ${p.connected ? '' : 'off'}"></span>
            <span class="grow">${esc(p.name)}${p.id === l.hostId ? ' <span class="muted small">(anfitrião)</span>' : ''}${p.id === ui.session.playerId ? ' <span class="muted small">(você)</span>' : ''}</span>
            ${isHost && p.id !== HOST_ID ? `<button class="ghost small" data-do="kick" data-id="${p.id}">Remover</button>` : ''}
          </li>`).join('')}
      </ul>
    </div>
    ${isHost ? `
      <div class="panel stack">
        <div>
          <label for="mode">Modo de jogo</label>
          <select id="mode" data-change="mode">
            <option value="classico" ${l.settings.mode !== 'festa' ? 'selected' : ''}>Clássico · 2 a 10 jogadores</option>
            <option value="festa" ${l.settings.mode === 'festa' ? 'selected' : ''}>Festa · até 15 jogadores</option>
          </select>
          <p class="muted small" style="margin-top:6px">${l.settings.mode === 'festa'
            ? 'Regra da casa: com 11–12 jogadores há 6 cópias de cada carta, com 13–15 há 7. Com tanta gente, vale ligar o tempo para responder.'
            : 'Regras oficiais: 3 cópias de cada carta (4 com 7–8 jogadores, 5 com 9–10).'}</p>
        </div>
        <div>
          <label for="timer">Tempo para responder (duvidar/bloquear)</label>
          <select id="timer" data-change="timer">
            ${[[0, 'Sem limite'], [10, '10 segundos'], [15, '15 segundos'], [20, '20 segundos'], [30, '30 segundos']]
              .map(([v, t]) => `<option value="${v}" ${l.settings.responseSeconds === v ? 'selected' : ''}>${t}</option>`).join('')}
          </select>
          <p class="muted small" style="margin-top:6px">Quem não responder a tempo deixa passar automaticamente.</p>
        </div>
        <button class="primary block" data-do="start" ${enough ? '' : 'disabled'}>
          ${enough ? 'Começar partida' : tooMany ? `Muitos jogadores para o modo ${mode.name}` : `Aguardando jogadores (mín. ${MIN_PLAYERS})`}
        </button>
      </div>` : `
      <div class="panel"><p class="muted">Aguardando o anfitrião começar a partida…</p>
      <p class="muted small">Modo ${mode.name}</p>
      ${l.settings.responseSeconds ? `<p class="muted small">Tempo para responder: ${l.settings.responseSeconds}s</p>` : ''}</div>`}
    <button class="ghost block" data-do="leave">${isHost ? 'Encerrar sala' : 'Sair da sala'}</button>`;
}

function topbar() {
  const st = ui.status.state;
  const label = { online: 'Conectado', conectando: 'Conectando…', reconectando: 'Reconectando…', erro: 'Erro de conexão', offline: 'Offline' }[st] || st;
  return `<div class="topbar">
    <span>Sala <b>${esc(ui.lobby.code)}</b>${ui.view ? ` · Turno ${ui.view.turnNumber}` : ''}
      <span class="dot ${st === 'online' ? '' : 'off'}" title="${label}"></span></span>
    <span class="topbar-btns">
      ${ui.view ? '<button class="ghost rules-btn" data-do="history" aria-label="Histórico da partida">📜 Histórico</button>' : ''}
      ${rulesButton('Cartas')}
    </span>
  </div>`;
}

// ---------- partida ----------

const art = (t) => CHARS[t].article;
const claimText = (t) => `Sou ${art(t)} ${CHARS[t].name}`;

// O que EU preciso fazer agora (null = nada).
function myTask(v) {
  if (!v || v.phase === 'gameOver') return null;
  const o = v.options;
  const pd = v.pending;
  if (o.actions) return 'Sua vez! Escolha uma ação';
  if (o.reveal) return 'Escolha uma carta para perder';
  if (o.exchange) return 'Escolha com quais cartas ficar';
  if (o.respond) {
    if (v.phase === 'challengeAction') return `${nameOf(pd.actor)} diz: “${claimText(ACTIONS[pd.action].claim)}”. Você acredita?`;
    if (v.phase === 'challengeBlock') return `${nameOf(pd.blocker)} bloqueou. Você acredita?`;
    if (v.phase === 'block') return pd.target === v.you ? 'Você é o alvo! Vai bloquear?' : 'Quer bloquear?';
  }
  return null;
}

// Texto + carta declarada, para todos saberem o que está acontecendo.
function situation(v) {
  const pd = v.pending;
  const action = pd ? ACTIONS[pd.action] : null;
  const actor = pd ? `<b>${esc(nameOf(pd.actor))}</b>` : '';
  const target = pd?.target ? ` em <b>${esc(nameOf(pd.target))}</b>` : '';
  const waiting = pd?.waitingFor?.length ? `<p class="muted small">Aguardando: ${pd.waitingFor.map((id) => esc(id === v.you ? 'você' : nameOf(id))).join(', ')}</p>` : '';
  const claimLine = (who, type, what) => `${who} diz: <span class="claim">“${claimText(type)}”</span> ${what}`;

  switch (v.phase) {
    case 'action':
      return { card: null, html: `<p>${v.turn === v.you ? '<b>Sua vez</b> de' : `Vez de <b>${esc(nameOf(v.turn))}</b>`} escolher uma ação.</p>` };
    case 'challengeAction':
      return {
        card: action.claim,
        html: `<p>${claimLine(actor, action.claim, `e quer <b>${action.name}</b>${target}.`)}</p><p class="muted small">Alguém duvida?</p>${waiting}`,
      };
    case 'block':
      return {
        card: action.claim,
        html: `<p>${actor} vai usar <b>${action.name}</b>${target}.</p>
          <p class="muted small">${action.blockedBy.map(charName).join(' ou ')} pode bloquear${action.anyoneCanBlock ? ' (qualquer jogador)' : ''}.</p>${waiting}`,
      };
    case 'challengeBlock':
      return {
        card: pd.blockClaim,
        html: `<p>${claimLine(`<b>${esc(nameOf(pd.blocker))}</b>`, pd.blockClaim, `e bloqueia <b>${action.name}</b> de ${actor}.`)}</p><p class="muted small">Alguém duvida do bloqueio?</p>${waiting}`,
      };
    case 'loseInfluence':
      return { card: null, html: `<p><b>${esc(nameOf(pd.loser))}</b> vai perder uma influência (${esc(pd.lossReason)}).</p>` };
    case 'exchange':
      return { card: 'embaixador', html: `<p>${actor} está escolhendo cartas com o Embaixador.</p>` };
    case 'gameOver':
      return { card: null, html: `<p>🏆 <b>${esc(nameOf(v.winner))}</b> venceu a partida!</p>` };
  }
  return { card: null, html: '' };
}

// Próximo jogador vivo depois de quem está na vez.
function nextPlayerId(v) {
  const i = v.players.findIndex((p) => p.id === v.turn);
  for (let k = 1; k < v.players.length; k++) {
    const p = v.players[(i + k) % v.players.length];
    if (p.alive) return p.id;
  }
  return null;
}

// Cor fixa por jogador (ajuda a reconhecer cada um em mesas grandes).
const PLAYER_COLORS = ['#e2bd6b', '#6aa9e0', '#e07a6a', '#7bc98f', '#b48be0', '#e0a35a', '#5fc6c0', '#e086b8', '#a8b85c', '#9aa3b5'];
function playerColor(id) {
  const list = ui.view?.players ?? ui.lobby?.players ?? [];
  const i = Math.max(0, list.findIndex((p) => p.id === id));
  return PLAYER_COLORS[i % PLAYER_COLORS.length];
}
const avatar = (id, name) => `<span class="avatar" style="--pc:${playerColor(id)}">${esc((name || '?').trim().charAt(0).toUpperCase())}</span>`;

function seat(v, p, nextId) {
  const pd = v.pending;
  const isMe = p.id === v.you;
  const live = v.phase !== 'gameOver';
  let tag = '';
  if (!p.alive) tag = 'eliminado';
  else if (!connected(p.id)) tag = 'desconectado';
  else if (live && p.id === v.turn) tag = 'na vez';
  else if (pd?.waitingFor?.includes(p.id) || pd?.loser === p.id) tag = 'pensando…';
  else if (live && p.id === nextId) tag = 'próximo';
  const targeted = live && pd?.target === p.id && v.phase !== 'action';
  const delta = ui.deltas[p.id];
  const shown = isMe ? `${p.name} (você)` : p.name;
  return `<div class="seat ${live && p.id === v.turn ? 'turn' : ''} ${p.alive ? '' : 'out'} ${isMe ? 'me' : ''} ${targeted ? 'targeted' : ''}" style="--pc:${playerColor(p.id)}">
    <div class="seat-name ${shown.length > 11 ? 'long' : ''}" title="${esc(shown)}">${esc(shown)}</div>
    <span class="seat-coins">${coin(p.coins)}${deltaHtml(delta)}</span>
    <div class="seat-cards">${p.cards.map((c) => (c.revealed ? face(c.type, { size: 'xs', dead: true }) : back('xs'))).join('')}</div>
    ${targeted ? '<span class="seat-target" title="Alvo">🎯</span>' : ''}
    ${tag ? `<div class="seat-tag tag-${tag.replace(/[^a-z]/g, '')}">${tag}</div>` : ''}
  </div>`;
}

const deltaHtml = (d) => (d ? `<span class="delta ${d > 0 ? 'up' : 'down'}">${d > 0 ? '+' : '−'}${Math.abs(d)}</span>` : '');

// Carta da minha mão: virada para baixo, aparece só enquanto segura.
function myCard(c, i) {
  if (c.revealed) return `<div class="handcard">${face(c.type, { size: 'md', dead: true })}</div>`;
  return `<div class="handcard flip ${ui.peek === i ? 'peek' : ''}" data-peek="${i}" tabindex="0" aria-label="Sua carta ${i + 1}. Segure para ver.">
    <div class="flip-inner">
      <div class="flip-side flip-back">${back('md')}</div>
      <div class="flip-side flip-front">${face(c.type, { size: 'md' })}</div>
    </div>
  </div>`;
}

// Minha mão flutuando na parte de baixo da tela, em leque.
function floatingHand(v, me) {
  const n = me.cards.length;
  return `<div class="myhand" aria-label="Suas cartas">
    <div class="fan">
      ${me.cards.map((c, i) => `<div class="fan-card ${ui.peek === i ? 'up' : ''}" style="--i:${i};--n:${n}">${myCard(c, i)}</div>`).join('')}
    </div>
    <div class="myhand-plate">
      ${avatar(me.id, me.name)}<b>${esc(me.name)}</b><span class="plate-coins">${coin(me.coins)}${deltaHtml(ui.deltas[me.id])}</span>
      <span class="muted small">${me.alive ? '· segure para espiar' : '· eliminado'}</span>
    </div>
  </div>`;
}

function renderGame() {
  const v = ui.view;
  const me = v.players.find((p) => p.id === v.you);
  const sit = situation(v);
  const task = myTask(v);
  const showTimer = ui.deadline && v.pending?.waitingFor?.length;
  const nextId = nextPlayerId(v);
  const crowd = v.players.length > 6 ? 'crowd' : '';
  document.title = task ? '⚡ Sua vez · EuSouDuquePego3' : 'EuSouDuquePego3';

  $app.innerHTML = `
    ${topbar()}
    ${task ? `<button class="callout" data-do="gotoTask">
        <span class="callout-icon">⚡</span><span class="grow">${esc(task)}</span>
        ${showTimer ? '<span class="timer" data-timer></span>' : '<span aria-hidden="true">↓</span>'}
      </button>` : ''}

    <div class="table-head">
      <span class="muted small">Ordem dos turnos →</span>
      <span class="muted small">Baralho: ${v.deckCount} cartas</span>
    </div>
    <div class="table ${crowd}">
      ${v.players.map((p) => seat(v, p, nextId)).join('')}
    </div>

    <div class="panel banner ${sit.card ? 'with-card' : ''}">
      ${sit.card ? face(sit.card, { size: 'xs' }) : ''}
      <div class="grow">${sit.html}${showTimer && !task ? '<p class="small">Tempo: <span class="timer" data-timer></span></p>' : ''}</div>
    </div>

    ${promptPanel(v, me)}

    <button class="ghost block leave-btn" data-do="leave">${ui.session.role === 'host' ? 'Encerrar sala' : 'Sair da partida'}</button>
    ${floatingHand(v, me)}`;
  tickTimer();
}

function connected(id) {
  return ui.lobby?.players.find((p) => p.id === id)?.connected ?? true;
}

const GENERAL = {
  renda: { gain: '+1', note: 'ninguém bloqueia' },
  ajuda: { gain: '+2', note: 'o Duque bloqueia' },
  golpe: { gain: '−7', note: 'ninguém bloqueia' },
};

function actionCard(a) {
  return `<button class="cardbtn" data-do="act" data-id="${a.id}" ${a.enabled ? '' : 'disabled'}>
    ${face(a.claim, { size: 'sm', detail: false })}
    <span class="cardbtn-label">${a.name}</span>
    <span class="cardbtn-sub">${a.reason ? esc(a.reason) : CHARS[a.claim].short}</span>
  </button>`;
}

function generalTile(a, me) {
  const g = GENERAL[a.id];
  const forced = a.id === 'golpe' && me.coins >= MUST_COUP_AT;
  return `<button class="tile ${forced ? 'primary' : ''}" data-do="act" data-id="${a.id}" ${a.enabled ? '' : 'disabled'}>
    <span class="tile-gain">${g.gain}</span>
    <b>${a.name}</b>
    <span class="tile-sub">${a.reason && !forced ? esc(a.reason) : forced ? 'obrigatório' : g.note}</span>
  </button>`;
}

// Painel com o que EU posso fazer agora.
function promptPanel(v, me) {
  const o = v.options;
  const busy = ui.busy ? 'busy' : '';

  if (v.phase === 'gameOver') {
    return `<div class="panel stack center">
      <h2>${v.winner === me.id ? 'Você venceu! 🎉' : `${esc(nameOf(v.winner))} venceu.`}</h2>
      ${ui.session.role === 'host' ? '<button class="primary block" data-do="lobby">Nova partida com a mesma sala</button>' : '<p class="muted">Aguardando o anfitrião iniciar outra partida…</p>'}
    </div>`;
  }

  if (o.actions) {
    const chars = o.actions.filter((a) => a.claim);
    const general = o.actions.filter((a) => !a.claim);
    return `<div class="panel urgent ${busy}" id="task">
      <h2>Sua vez</h2>
      <p class="muted small">Personagens: diga quem você é. Pode ser blefe!</p>
      <div class="char-actions">${chars.map(actionCard).join('')}</div>
      <p class="muted small" style="margin-top:12px">Ações gerais</p>
      <div class="gen-actions">${general.map((a) => generalTile(a, me)).join('')}</div>
    </div>`;
  }

  if (o.respond) {
    const pd = v.pending;
    const blockCards = o.respond.blockCards;
    const passLabel = v.phase === 'block' ? 'Não bloquear' : v.phase === 'challengeBlock' ? 'Aceitar o bloqueio' : 'Deixar passar';
    return `<div class="panel stack urgent ${busy}" id="task">
      <h2>${v.phase === 'block' ? (pd.target === me.id ? 'Você é o alvo!' : 'Quer bloquear?') : 'Você acredita?'}</h2>
      ${blockCards.length ? `
        <p class="muted small">Bloquear dizendo ser:</p>
        <div class="char-actions">${blockCards.map((c) => `
          <button class="cardbtn" data-do="block" data-card="${c}">
            ${face(c, { size: 'sm', detail: false })}
            <span class="cardbtn-label">Bloquear</span>
          </button>`).join('')}</div>` : ''}
      ${o.respond.canChallenge ? '<button class="danger block big" data-do="challenge">Duvido!</button>' : ''}
      <button class="block" data-do="pass">${passLabel}</button>
    </div>`;
  }

  if (o.reveal) {
    return `<div class="panel stack urgent ${busy}" id="task">
      <h2>Você perde uma influência</h2>
      <p class="muted small">Escolha qual carta revelar. Segure para espiar.</p>
      <div class="hand">${o.reveal.map((i) => `
        <div class="pick">${myCard(me.cards[i], i)}<button class="danger block" data-do="reveal" data-index="${i}">Revelar esta</button></div>`).join('')}</div>
    </div>`;
  }

  if (o.exchange) {
    const { options, keep } = o.exchange;
    if (!ui.exchangeOpen) {
      return `<div class="panel stack urgent" id="task">
        <h2>Embaixador: troca de cartas</h2>
        <p class="muted small">Você comprou 2 cartas. Proteja a tela antes de abrir.</p>
        <button class="primary block" data-do="exopen">Ver cartas</button>
      </div>`;
    }
    const n = ui.exchangeSel.length;
    return `<div class="panel stack urgent ${busy}" id="task">
      <h2>Fique com ${keep} carta${keep > 1 ? 's' : ''}</h2>
      <div class="exchange">${options.map((t, i) => `
        <button class="cardpick ${ui.exchangeSel.includes(i) ? 'selected' : ''}" data-do="exsel" data-index="${i}" aria-pressed="${ui.exchangeSel.includes(i)}">
          ${face(t, { size: 'sm' })}
        </button>`).join('')}</div>
      <button class="primary block" data-do="exconfirm" ${n === keep ? '' : 'disabled'}>Confirmar (${n}/${keep})</button>
    </div>`;
  }

  return '';
}

let timerInterval;
function tickTimer() {
  clearInterval(timerInterval);
  const els = document.querySelectorAll('[data-timer]');
  if (!els.length || !ui.deadline) return;
  const update = () => {
    const left = Math.max(0, Math.ceil((ui.deadline - Date.now()) / 1000));
    els.forEach((el) => { el.textContent = `${left}s`; el.classList.toggle('low', left <= 5); });
  };
  update();
  timerInterval = setInterval(update, 250);
}

// Chama atenção quando surge algo para eu fazer.
function attention() {
  try { navigator.vibrate?.([120, 60, 120]); } catch { /* ignora */ }
  const el = document.getElementById('task');
  if (!el) return;
  const r = el.getBoundingClientRect();
  if (r.top < 0 || r.top > window.innerHeight * 0.6) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ---------- confirmação de jogadas ----------

const ACTION_INFO = {
  renda: { what: () => 'Você pega 1 moeda do tesouro.', note: () => 'Ninguém pode bloquear nem duvidar.' },
  ajuda: { what: () => 'Você pega 2 moedas do tesouro.', note: () => 'Qualquer jogador pode dizer que é o Duque e bloquear.' },
  golpe: { what: (t) => `Você paga 7 moedas e ${t} perde uma influência.`, note: () => 'Ninguém pode bloquear nem duvidar.' },
  taxar: { what: () => 'Você diz que é o Duque e pega 3 moedas do tesouro.', note: () => 'Ninguém pode bloquear, mas podem duvidar.' },
  assassinar: { what: (t) => `Você diz que é o Assassino, paga 3 moedas e ${t} perde uma influência.`, note: (t) => `${cap(t)} pode bloquear dizendo ser a Condessa (aí as 3 moedas não voltam).` },
  extorquir: { what: (t) => `Você diz que é o Capitão e pega até 2 moedas ${t === 'o alvo' ? 'do alvo' : `de ${t}`}.`, note: (t) => `${cap(t)} pode bloquear dizendo ser o Capitão ou o Embaixador.` },
  trocar: { what: () => 'Você diz que é o Embaixador, compra 2 cartas do baralho, escolhe com quais fica e devolve 2.', note: () => 'Ninguém pode bloquear, mas podem duvidar.' },
};
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

function openModal(m) {
  ui.modal = { ...m, step: ui.view.step };
  renderModal();
}

function closeModal() {
  if (!ui.modal) return;
  ui.modal = null;
  $modal.hidden = true;
  $modal.innerHTML = '';
}

function renderModal() {
  const m = ui.modal;
  if (!m) return closeModal();
  const v = ui.view;
  const pd = v.pending;
  let cardHtml = '';
  let title = '';
  let subtitle = '';
  let body = '';
  let extra = '';
  let confirm = 'Confirmar';
  let ready = true;
  let danger = false;

  if (m.kind === 'action') {
    const a = v.options.actions.find((x) => x.id === m.id);
    const def = ACTIONS[m.id];
    const tName = m.target ? nameOf(m.target) : 'o alvo';
    const info = ACTION_INFO[m.id];
    if (def.claim) {
      cardHtml = face(def.claim, { size: 'sm', detail: false });
      title = claimText(def.claim);
      subtitle = `${def.name}${def.cost ? ` · paga ${def.cost}` : ''}`;
    } else {
      cardHtml = `<div class="modal-tile"><span class="tile-gain">${GENERAL[m.id].gain}</span></div>`;
      title = def.name;
    }
    body = `<p>${esc(info.what(tName))}</p><p class="muted">${esc(info.note(tName))}</p>`;
    if (def.claim) {
      body += `<p class="warn">⚠️ Se alguém duvidar e você não tiver ${art(def.claim)} ${charName(def.claim)}, você perde uma influência${m.id === 'assassinar' ? ' (e as 3 moedas voltam)' : ''}.</p>
        <p class="good">✅ Se tiver, quem duvidou é que perde.</p>`;
    }
    if (def.needsTarget) {
      ready = !!m.target;
      extra = `<p class="muted small">Escolha o alvo:</p>
        <div class="targets">${a.targets.map((id) => {
          const t = v.players.find((p) => p.id === id);
          const inf = t.cards.filter((c) => !c.revealed).length;
          return `<button class="target ${m.target === id ? 'selected' : ''}" data-do="modalTarget" data-id="${id}" aria-pressed="${m.target === id}">
            <b>${esc(t.name)}</b><span class="small muted">${coin(t.coins)} · ${inf} carta${inf > 1 ? 's' : ''}</span>
          </button>`;
        }).join('')}</div>`;
    }
    confirm = def.claim ? `${claimText(def.claim)}!` : `Confirmar ${def.name}`;
  }

  if (m.kind === 'block') {
    const def = ACTIONS[pd.action];
    cardHtml = face(m.card, { size: 'sm', detail: false });
    title = claimText(m.card);
    subtitle = `Bloquear ${def.name}`;
    body = `<p>Você bloqueia ${def.name} de <b>${esc(nameOf(pd.actor))}</b>.</p>
      <p class="warn">⚠️ Se alguém duvidar e você não tiver ${art(m.card)} ${charName(m.card)}, você perde uma influência${pd.action === 'assassinar' ? ' pelo blefe <b>e ainda sofre o assassinato: perde as duas!</b>' : ' e a ação acontece mesmo assim.'}</p>
      <p class="good">✅ Se tiver, quem duvidou é que perde.</p>`;
    confirm = `${claimText(m.card)}!`;
  }

  if (m.kind === 'challenge') {
    const isBlock = v.phase === 'challengeBlock';
    const claimant = isBlock ? pd.blocker : pd.actor;
    const claim = isBlock ? pd.blockClaim : ACTIONS[pd.action].claim;
    const who = esc(nameOf(claimant));
    cardHtml = face(claim, { size: 'sm', detail: false });
    title = 'Duvido!';
    subtitle = `${nameOf(claimant)} tem ${art(claim)} ${charName(claim)}?`;
    body = `<p class="good">✅ Se ${who} <b>não</b> tiver: ${who} perde uma influência e ${isBlock ? 'o bloqueio falha' : 'a ação falha'}.</p>
      <p class="warn">⚠️ Se ${who} tiver: <b>você</b> perde uma influência${!isBlock && pd.action === 'assassinar' && pd.target === v.you ? ' e ainda sofre o assassinato (pode perder as duas!)' : ''}.</p>`;
    confirm = 'Duvido!';
    danger = true;
  }

  if (m.kind === 'reveal') {
    const c = v.players.find((p) => p.id === v.you).cards[m.index];
    cardHtml = face(c.type, { size: 'sm', detail: false });
    title = `Perder ${art(c.type)} ${charName(c.type)}?`;
    body = '<p>A carta fica virada para cima, todos vão ver, e você perde essa influência.</p>';
    confirm = 'Revelar esta carta';
    danger = true;
  }

  $modal.innerHTML = `
    <div class="modal-box" role="dialog" aria-modal="true" aria-labelledby="modal-title">
      <div class="modal-main">
        <div class="modal-card">${cardHtml}</div>
        <div class="grow">
          <h2 id="modal-title">${esc(title)}</h2>
          ${subtitle ? `<p class="muted small">${esc(subtitle)}</p>` : ''}
        </div>
      </div>
      <div class="modal-body">${body}</div>
      ${extra}
      <div class="modal-actions">
        <button data-do="modalCancel">Cancelar</button>
        <button class="${danger ? 'danger' : 'primary'}" data-do="modalConfirm" ${ready ? '' : 'disabled'}>${esc(confirm)}</button>
      </div>
    </div>`;
  $modal.hidden = false;
}

function confirmModal() {
  const m = ui.modal;
  if (!m) return;
  let intent;
  if (m.kind === 'action') intent = { type: 'action', action: m.id, target: m.target || undefined };
  if (m.kind === 'block') intent = { type: 'block', card: m.card };
  if (m.kind === 'challenge') intent = { type: 'challenge' };
  if (m.kind === 'reveal') intent = { type: 'reveal', cardIndex: m.index };
  const step = m.step;
  closeModal();
  send({ ...intent, step });
}

// ---------- notificações de eventos ----------

// Escolha "aleatória" mas igual para todos: depende só do número do evento.
const pickFor = (e, arr) => arr[(e.n * 7 + e.kind.length) % arr.length];

const JOKES = {
  bluff: [
    'O nariz cresceu! 🤥 Pinóquio mandou um abraço.',
    'Pego no flagra! 🚨 A cara de pau não foi suficiente.',
    'Mentira tem perna curta… 🦵✂️',
    'Hoje não, ator de novela! 🎭📺',
    'Blefou, se deu mal. 😬 Fica pra próxima.',
  ],
  wrongChallenge: [
    'Duvidou e quebrou a cara. 🤡',
    'Plot twist: era verdade! 😎🃏',
    'Desconfiança custa caro! 💸',
    'Quem duvida, paga. 🧾😬',
    'Sinceridade raríssima nesta corte. 😇✨',
  ],
  assassinated: ['🗡️ Nada pessoal… só negócios.', '🔪 Silencioso e eficiente.', '☠️ Alguém chame a guarda!', '🌹 Que descanse em paz.'],
  coup: ['💥 Sem conversa e sem bloqueio.', '🪖 Democracia? Nunca ouvi falar.', '🏛️ Troca de governo à força.'],
  blocked: ['🛡️ Hoje não!', '🙅 Aqui não, meu bem.', '🧱 Bateu na parede.', '✋ Pode parar aí mesmo.'],
  win: ['👑 Domínio absoluto da corte!', '🏆 Manipulou todo mundo com classe.', '🥇 Ninguém confia em mais ninguém. Missão cumprida.'],
  stolen: ['🏴‍☠️ Assalto em plena corte!', '💰 O cofrinho foi saqueado.', '🦝 Mão leve!'],
  eliminated: ['Fora do jogo! 🪦 Pode ir fazendo a pipoca. 🍿', 'F no chat. 😵🫡', 'Saiu da corte pela porta dos fundos. 🚪🏃'],
};

// Monta a cena de cada evento. Todos os jogadores veem exatamente a mesma.
function spotlightFor(e, v) {
  const d = e.data || {};
  const nm = (id) => v.players.find((p) => p.id === id)?.name ?? '?';
  const cardOf = (t) => `${art(t)} ${charName(t)}`;

  if (e.kind === 'lost') {
    const who = nm(d.who);
    const by = d.by ? nm(d.by) : '';
    const base = { cause: d.cause || 'lost', dead: d.lostCard, tone: 'bad' };
    const lostLine = `${who} perdeu ${cardOf(d.lostCard)}${d.eliminated ? ' e está fora do jogo! 🪦' : '.'}`;
    switch (d.cause) {
      case 'bluff':
        return { ...base, stamp: 'MENTIRA!', title: `${who} blefou!`, sub: `Não tinha ${cardOf(d.card)}. ${by} desmascarou.`, lostLine, joke: pickFor(e, JOKES.bluff) };
      case 'wrongChallenge':
        return { ...base, stamp: 'ERROU!', title: `${who} duvidou errado!`, sub: `${by} tinha ${cardOf(d.card)} mesmo.`, lostLine, joke: pickFor(e, JOKES.wrongChallenge) };
      case 'assassinated':
        return { ...base, stamp: 'ASSASSINADO', title: `${by} assassinou ${who}!`, sub: '', lostLine, joke: pickFor(e, JOKES.assassinated) };
      case 'coup':
        return { ...base, stamp: 'GOLPE!', title: `Golpe de Estado em ${who}!`, sub: `${by} pagou 7 moedas.`, lostLine, joke: pickFor(e, JOKES.coup) };
      default:
        return { ...base, stamp: 'PERDEU', title: `${who} perdeu uma influência`, sub: '', lostLine, joke: d.eliminated ? pickFor(e, JOKES.eliminated) : '' };
    }
  }
  if (e.kind === 'blocked') {
    return {
      cause: 'blocked', tone: 'good', alive: d.card, stamp: 'BLOQUEADO',
      title: `${nm(d.blocker)} bloqueou!`,
      sub: `${ACTIONS[d.action].name} de ${nm(d.actor)} não passou. ${nm(d.blocker)} disse ser ${cardOf(d.card)}.`,
      joke: pickFor(e, JOKES.blocked),
    };
  }
  if (e.kind === 'win') {
    return { cause: 'win', tone: 'gold', stamp: 'VITÓRIA', title: `${nm(d.who)} venceu a partida!`, sub: '', joke: pickFor(e, JOKES.win) };
  }
  if (e.kind === 'stolen' && d.amount) {
    return {
      cause: 'stolen', tone: 'bad', alive: 'capitao', stamp: `−${d.amount}`, amount: d.amount, short: true,
      title: `${nm(d.actor)} extorquiu ${nm(d.target)}!`,
      sub: `Levou ${d.amount} moeda${d.amount > 1 ? 's' : ''}.`, joke: pickFor(e, JOKES.stolen),
    };
  }
  return null;
}

// Efeitos visuais por tipo de evento.
function fxHtml(n) {
  switch (n.cause) {
    case 'assassinated':
      return `<div class="fx fx-dagger"><svg viewBox="0 0 100 100" fill="currentColor">${'<path d="M50 6 L59 58 L41 58 Z"/><rect x="26" y="58" width="48" height="7" rx="3"/><rect x="46" y="65" width="8" height="17"/><circle cx="50" cy="88" r="6"/>'}</svg></div>
        <div class="fx fx-slash"></div><div class="fx fx-flash"></div>`;
    case 'coup':
      return '<div class="fx fx-boom"></div><div class="fx fx-emoji fx-boom-emoji">💥</div><div class="fx fx-flash"></div>';
    case 'bluff':
      return '<div class="fx fx-emoji fx-liar">🤥</div><div class="fx fx-emoji fx-mask">🎭</div>';
    case 'wrongChallenge':
      return '<div class="fx fx-emoji fx-clown">🤡</div><div class="fx fx-emoji fx-q q1">❓</div><div class="fx fx-emoji fx-q q2">❓</div>';
    case 'blocked':
      return '<div class="fx fx-emoji fx-arrow">🗡️</div><div class="fx fx-emoji fx-shield">🛡️</div>';
    case 'win': {
      const colors = ['#e2bd6b', '#8ef0aa', '#6aa9e0', '#e07a6a', '#b48be0', '#fff3c4'];
      const bits = Array.from({ length: 26 }, (_, i) => {
        const x = (i * 37) % 100;
        const delay = ((i * 13) % 10) / 10;
        const rot = (i * 53) % 360;
        return `<i style="left:${x}%;background:${colors[i % colors.length]};animation-delay:${0.3 + delay}s;--r:${rot}deg"></i>`;
      }).join('');
      return `<div class="fx fx-crown">👑</div><div class="fx fx-confetti">${bits}</div>`;
    }
    case 'stolen':
      return `<div class="fx fx-coins">${Array.from({ length: Math.min(n.amount, 2) * 2 }, (_, i) => `<span class="coin c${i}"></span>`).join('')}</div>`;
  }
  return '';
}

function stageHtml(n) {
  let card = '';
  if (n.dead) {
    card = `<div class="spot-card dead-flip"><div class="dead-inner">
      <div class="flip-side flip-back">${back('md')}</div>
      <div class="flip-side flip-front">${face(n.dead, { size: 'md' })}<div class="dead-x"></div></div>
    </div></div>`;
  } else if (n.alive) {
    card = `<div class="spot-card">${face(n.alive, { size: 'md' })}</div>`;
  }
  return `<div class="spot-stage">${card}${fxHtml(n)}<div class="spot-stamp">${esc(n.stamp)}</div></div>`;
}

const NOTICE_MS = 9000;
const notices = [];
const noticeState = { timer: null, remaining: 0, startedAt: 0, paused: false, open: false };

function notifyEvents(view) {
  if (!view) {
    // Voltou para a sala: descarta cenas pendentes da partida anterior.
    ui.lastLogN = null;
    notices.length = 0;
    if (noticeState.open) showNextNotice();
    return;
  }
  const last = view.log.length ? view.log[view.log.length - 1].n : 0;
  if (ui.lastLogN == null || ui.lastLogN > last) { ui.lastLogN = last; return; }
  const fresh = view.log.filter((e) => e.n > ui.lastLogN && e.kind);
  ui.lastLogN = last;
  for (const e of fresh) {
    const n = spotlightFor(e, view);
    if (n) notices.push(n);
  }
  // Não deixa acumular demais: mantém só as cenas mais recentes.
  if (notices.length > 5) notices.splice(0, notices.length - 5);
  if (!noticeState.open && notices.length) showNextNotice();
}

function showNextNotice() {
  clearTimeout(noticeState.timer);
  const n = notices.shift();
  if (!n) {
    noticeState.open = false;
    $notice.hidden = true;
    $notice.innerHTML = '';
    return;
  }
  // Com fila, cada cena dura menos para não ficar atrasada em relação à mesa.
  const base = n.short ? 5000 : NOTICE_MS;
  noticeState.remaining = notices.length >= 3 ? 4000 : notices.length >= 1 ? Math.min(base, 6500) : base;
  $notice.innerHTML = `
    <div class="spot-backdrop" data-do="noticeClose"></div>
    <div class="spot cause-${n.cause} tone-${n.tone}" data-do="noticeToggle" role="alert">
      <button class="notice-x" data-do="noticeClose" aria-label="Fechar">✕</button>
      ${stageHtml(n)}
      <div class="spot-title">${esc(n.title)}</div>
      ${n.sub ? `<div class="spot-sub">${esc(n.sub)}</div>` : ''}
      ${n.lostLine ? `<div class="spot-lost">${esc(n.lostLine)}</div>` : ''}
      ${n.joke ? `<div class="spot-joke">${esc(n.joke)}</div>` : ''}
      <div class="notice-hint"></div>
      <div class="notice-bar"></div>
    </div>`;
  $notice.querySelector('.notice-bar').style.animationDuration = `${noticeState.remaining}ms`;
  $notice.hidden = false;
  noticeState.open = true;
  noticeState.paused = false;
  runNotice();
}

function runNotice() {
  noticeState.startedAt = Date.now();
  noticeState.timer = setTimeout(showNextNotice, noticeState.remaining);
  $notice.querySelector('.spot')?.classList.remove('paused');
  const hint = $notice.querySelector('.notice-hint');
  if (hint) hint.textContent = `Toque para pausar · fora para fechar${notices.length ? ` · mais ${notices.length}` : ''}`;
}

// Toque: congela. Toque de novo: volta a contar (e fecha quando acabar).
function toggleNotice() {
  if (!noticeState.open) return;
  if (noticeState.paused) {
    noticeState.paused = false;
    runNotice();
    return;
  }
  clearTimeout(noticeState.timer);
  noticeState.remaining = Math.max(800, noticeState.remaining - (Date.now() - noticeState.startedAt));
  noticeState.paused = true;
  $notice.querySelector('.spot')?.classList.add('paused');
  const hint = $notice.querySelector('.notice-hint');
  if (hint) hint.textContent = '⏸ Pausado · toque para continuar';
}

// ---------- referência: cartas e regras ----------

function refChar(t) {
  const c = CHARS[t];
  const actionId = Object.keys(ACTIONS).find((k) => ACTIONS[k].claim === t);
  const counters = actionId ? ACTIONS[actionId].blockedBy.map(charName) : [];
  return `<div class="ref-char">
    ${face(t, { size: 'sm', detail: false })}
    <div>
      <h4>${c.name}</h4>
      ${c.action ? `<p><b>${c.action}:</b> ${c.text}</p>` : '<p class="muted">Não tem ação própria.</p>'}
      ${c.blocks ? `<p class="ref-block">🛡 ${c.blocks}.</p>` : ''}
      ${actionId ? `<p class="muted small">${counters.length ? `Sua ação pode ser bloqueada por ${counters.join(' ou ')}.` : 'Sua ação não pode ser bloqueada, só duvidada.'}</p>` : ''}
    </div>
  </div>`;
}

function openRules() {
  ui.sheet = 'rules';
  const rows = (items) => items.map(([a, b, c]) => `<div class="ref-row"><div><b>${a}</b></div><div>${b}</div>${c !== undefined ? `<div class="muted">${c}</div>` : ''}</div>`).join('');
  $sheet.innerHTML = `
    <div class="sheet-inner" role="dialog" aria-modal="true" aria-labelledby="rules-title">
      <header class="sheet-head">
        <h2 id="rules-title">Cartas e regras</h2>
        <button data-do="closeRules" aria-label="Fechar">✕</button>
      </header>

      <section>
        <h3>Objetivo</h3>
        <p>Ser o último com influência. Cada carta virada para baixo é uma <b>influência</b>. Perdeu as duas, está fora.</p>
      </section>

      <section>
        <h3>Personagens</h3>
        <p class="muted">Há 3 cópias de cada (4 com 7–8 jogadores, 5 com 9–10; no modo Festa, 6 com 11–12 e 7 com 13–15). Você pode usar a ação de qualquer personagem, mesmo sem ter a carta. É o blefe!</p>
        <div class="ref-chars">${CARD_TYPES.map(refChar).join('')}</div>
      </section>

      <section>
        <h3>Ações gerais</h3>
        <p class="muted">Qualquer um usa, não precisa de personagem e ninguém pode duvidar.</p>
        <div class="ref-table">${rows([
          ['Renda', '+1 moeda.', 'Não pode ser bloqueada.'],
          ['Ajuda Externa', '+2 moedas.', 'O Duque bloqueia.'],
          ['Golpe de Estado', 'Paga 7: o alvo perde uma influência.', `Não pode ser bloqueado. Com ${MUST_COUP_AT}+ moedas é obrigatório.`],
        ])}</div>
      </section>

      <section>
        <h3>Quem bloqueia o quê</h3>
        <div class="ref-table">${rows([
          ['Ajuda Externa', 'Duque', 'Qualquer jogador pode bloquear.'],
          ['Assassinar', 'Condessa', 'Só o alvo.'],
          ['Extorquir', 'Capitão ou Embaixador', 'Só o alvo.'],
          ['Taxar, Trocar, Renda, Golpe', 'Ninguém', ''],
        ])}</div>
        <p class="muted small">Bloquear também é dizer que tem uma carta, então também dá para blefar e duvidar.</p>
      </section>

      <section>
        <h3>Duvidar</h3>
        <ul>
          <li>Quando alguém diz ser um personagem (para agir ou bloquear), qualquer jogador pode dizer <b>“Duvido!”</b>.</li>
          <li><b>Tinha a carta:</b> mostra, devolve ao baralho e compra outra. Quem duvidou perde uma influência.</li>
          <li><b>Era blefe:</b> quem blefou perde uma influência e a ação (ou o bloqueio) falha.</li>
          <li>Assassino desmascarado recebe as 3 moedas de volta. Assassinato bloqueado pela Condessa não devolve.</li>
          <li>Dá para perder 2 influências no mesmo turno. Ex.: duvidar do Assassino, errar e ainda ser assassinado.</li>
        </ul>
      </section>

      <section>
        <h3>Ordem de um turno</h3>
        <ol>
          <li>Quem está na vez escolhe uma ação.</li>
          <li>Se a ação é de personagem, todos podem duvidar.</li>
          <li>Se a ação pode ser bloqueada, quem pode decide se bloqueia.</li>
          <li>Se houve bloqueio, todos podem duvidar do bloqueio.</li>
          <li>A ação acontece (ou não) e passa a vez.</li>
        </ol>
      </section>

      <section>
        <h3>Detalhes</h3>
        <ul>
          <li>Todos começam com 2 cartas e 2 moedas.</li>
          <li>Com 2 jogadores, quem começa recebe só 1 moeda.</li>
          <li>Extorquir de quem tem 1 moeda leva só 1.</li>
          <li>Cartas perdidas ficam viradas para cima na mesa.</li>
        </ul>
      </section>
      <button class="primary block" data-do="closeRules">Entendi</button>
      <p class="disclaimer">Projeto de fã, gratuito e não oficial, inspirado em um jogo de cartas de blefe. Não tem afiliação com os detentores da marca Coup nem com suas editoras. Se você gosta, compre o jogo original!</p>
    </div>`;
  $sheet.hidden = false;
  document.body.classList.add('noscroll');
  $sheet.querySelector('.sheet-inner').scrollTop = 0;
}

function closeRules() {
  ui.sheet = null;
  $sheet.hidden = true;
  $sheet.innerHTML = '';
  document.body.classList.remove('noscroll');
}

// ---------- histórico ----------

function historyHtml() {
  const log = ui.view?.log ?? [];
  let html = '';
  let turn = null;
  for (const e of [...log].reverse()) {
    if (e.turn !== turn) { turn = e.turn; html += `<div class="hist-turn">Turno ${turn}</div>`; }
    html += `<p class="${e.kind ? `ev ev-${e.kind}` : ''}">${esc(e.text)}</p>`;
  }
  return html || '<p class="muted">Nada ainda.</p>';
}

function openHistory() {
  ui.sheet = 'history';
  $sheet.innerHTML = `
    <div class="sheet-inner" role="dialog" aria-modal="true" aria-labelledby="hist-title">
      <header class="sheet-head">
        <h2 id="hist-title">Histórico da partida</h2>
        <button data-do="closeRules" aria-label="Fechar">✕</button>
      </header>
      <div class="history" id="history">${historyHtml()}</div>
    </div>`;
  $sheet.hidden = false;
  document.body.classList.add('noscroll');
}

function refreshHistory() {
  const el = document.getElementById('history');
  if (el) el.innerHTML = historyHtml();
}

// ---------- espiar cartas (segurar) ----------

function setPeek(i) {
  if (ui.peek === i) return;
  ui.peek = i;
  document.querySelectorAll('[data-peek]').forEach((el) => {
    const on = Number(el.dataset.peek) === i;
    el.classList.toggle('peek', on);
    el.closest('.fan-card')?.classList.toggle('up', on);
  });
}

document.addEventListener('pointerdown', (e) => {
  const el = e.target.closest('[data-peek]');
  if (el) setPeek(Number(el.dataset.peek));
});
['pointerup', 'pointercancel', 'blur'].forEach((ev) => window.addEventListener(ev, () => setPeek(null)));
document.addEventListener('visibilitychange', () => setPeek(null));
document.addEventListener('contextmenu', (e) => { if (e.target.closest('[data-peek]')) e.preventDefault(); });
document.addEventListener('keydown', (e) => {
  if ((e.key === ' ' || e.key === 'Enter') && e.target.matches?.('[data-peek]')) { e.preventDefault(); setPeek(Number(e.target.dataset.peek)); }
  if (e.key === 'Escape') { if (!$modal.hidden) closeModal(); else if (!$sheet.hidden) closeRules(); }
});
document.addEventListener('keyup', (e) => { if (e.target.matches?.('[data-peek]')) setPeek(null); });

// ---------- cliques ----------

document.addEventListener('click', async (e) => {
  if (e.target === $sheet) return closeRules();
  if (e.target === $modal) return closeModal();
  const btn = e.target.closest('[data-do]');
  if (!btn || btn.disabled) return;
  const { do: what, id, card, index } = btn.dataset;

  switch (what) {
    case 'rules': return openRules();
    case 'closeRules': return closeRules();
    case 'host': return hostGame();
    case 'resume': {
      const saved = loadSavedHost();
      if (saved) hostGame(saved);
      return;
    }
    case 'forget': clearSavedHost(); return render();
    case 'join': {
      const name = readName();
      if (name) joinGame(document.getElementById('code').value, name);
      return;
    }
    case 'leave': return leave();
    case 'kick': return ui.session.removePlayer(id);
    case 'start': {
      const err = ui.session.startGame();
      if (err) toast(err);
      return;
    }
    case 'lobby': return ui.session.backToLobby();
    case 'copyLink': {
      const ok = await copyText(shareLink());
      toast(ok ? 'Link copiado! Agora é só colar no grupo. 📋' : 'Não consegui copiar. Segure o link para copiar.', ok);
      return;
    }
    case 'whatsapp': {
      const text = `Bora jogar EuSouDuquePego3! 🃏 Entra na minha sala (código ${ui.lobby.code}): ${shareLink()}`;
      window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
      return;
    }
    case 'share': {
      const url = shareLink();
      if (navigator.share) {
        try { await navigator.share({ title: 'EuSouDuquePego3', text: `Bora jogar EuSouDuquePego3! Entra na minha sala: ${ui.lobby.code}`, url }); } catch { /* cancelado */ }
      } else {
        try { await navigator.clipboard.writeText(url); toast('Link copiado!', true); } catch { window.prompt('Copie o link:', url); }
      }
      return;
    }
    case 'act': {
      const a = ui.view.options.actions?.find((x) => x.id === id);
      if (!a) return;
      return openModal({ kind: 'action', id, target: a.targets.length === 1 ? a.targets[0] : null });
    }
    case 'modalTarget': ui.modal.target = id; return renderModal();
    case 'modalCancel': return closeModal();
    case 'modalConfirm': return confirmModal();
    case 'noticeClose': return showNextNotice();
    case 'noticeToggle': return toggleNotice();
    case 'history': return openHistory();
    case 'gotoTask': return document.getElementById('task')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    case 'pass': return send({ type: 'pass' });
    case 'challenge': return openModal({ kind: 'challenge' });
    case 'block': return openModal({ kind: 'block', card });
    case 'reveal': return openModal({ kind: 'reveal', index: Number(index) });
    case 'exopen': ui.exchangeOpen = true; return render();
    case 'exsel': {
      const i = Number(index);
      const keep = ui.view.options.exchange.keep;
      if (ui.exchangeSel.includes(i)) ui.exchangeSel = ui.exchangeSel.filter((x) => x !== i);
      else if (ui.exchangeSel.length < keep) ui.exchangeSel.push(i);
      else if (keep === 1) ui.exchangeSel = [i];
      return render();
    }
    case 'exconfirm': return send({ type: 'exchange', keep: ui.exchangeSel });
  }
});

$app.addEventListener('change', (e) => {
  if (e.target.dataset.change === 'mode') ui.session.setSettings({ mode: e.target.value });
  if (e.target.dataset.change === 'timer') ui.session.setSettings({ responseSeconds: Number(e.target.value) });
});

$app.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.id === 'code') document.querySelector('[data-do="join"]')?.click();
});

// ---------- início ----------

if (!window.Peer) {
  $app.innerHTML = '<div class="panel"><p>Não foi possível carregar a biblioteca de conexão (PeerJS). Verifique a internet e recarregue.</p></div>';
} else {
  // Convidado que recarregou a aba volta automaticamente para a sala.
  const again = sstore.get('esdp3.client');
  const urlCode = new URLSearchParams(location.search).get('sala');
  if (again && (!urlCode || urlCode.toUpperCase() === again.code)) joinGame(again.code, again.name);
  else render();
}
})();
