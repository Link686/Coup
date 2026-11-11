(function (root) {
'use strict';
// Motor de regras do jogo (2 a 15 jogadores).
// Não depende de DOM nem de rede: recebe intenções e altera o estado.
// O estado é JSON puro, para poder ser salvo e enviado pela rede.

const CARD_TYPES = ['duque', 'assassino', 'capitao', 'embaixador', 'condessa'];

const CARD_NAMES = {
  duque: 'Duque',
  assassino: 'Assassino',
  capitao: 'Capitão',
  embaixador: 'Embaixador',
  condessa: 'Condessa',
};

// Jogo base: 3 cópias de cada (até 6 jogadores). Para 7 a 10 jogadores,
// segue a regra da expansão: 4 cópias (7-8) ou 5 cópias (9-10).
// Modo Festa (regra da casa): 6 cópias (11-12) ou 7 cópias (13-15),
// deixando pelo menos 5 cartas no baralho.
function copiesFor(n) {
  if (n <= 6) return 3;
  if (n <= 8) return 4;
  if (n <= 10) return 5;
  if (n <= 12) return 6;
  return 7;
}

const MODES = {
  classico: { name: 'Clássico', max: 10 },
  festa: { name: 'Festa', max: 15 },
};
const STARTING_COINS = 2;
const MUST_COUP_AT = 10;
const MIN_PLAYERS = 2;
const MAX_PLAYERS = 15;

const ACTIONS = {
  renda:      { name: 'Renda',           cost: 0, claim: null,         needsTarget: false, blockedBy: [],                        anyoneCanBlock: false },
  ajuda:      { name: 'Ajuda Externa',   cost: 0, claim: null,         needsTarget: false, blockedBy: ['duque'],                 anyoneCanBlock: true },
  golpe:      { name: 'Golpe de Estado', cost: 7, claim: null,         needsTarget: true,  blockedBy: [],                        anyoneCanBlock: false },
  taxar:      { name: 'Taxar',           cost: 0, claim: 'duque',      needsTarget: false, blockedBy: [],                        anyoneCanBlock: false },
  assassinar: { name: 'Assassinar',      cost: 3, claim: 'assassino',  needsTarget: true,  blockedBy: ['condessa'],              anyoneCanBlock: false },
  extorquir:  { name: 'Extorquir',       cost: 0, claim: 'capitao',    needsTarget: true,  blockedBy: ['capitao', 'embaixador'], anyoneCanBlock: false },
  trocar:     { name: 'Trocar',          cost: 0, claim: 'embaixador', needsTarget: false, blockedBy: [],                        anyoneCanBlock: false },
};

const RESPONSE_PHASES = ['challengeAction', 'block', 'challengeBlock'];

class RuleError extends Error {}
const fail = (msg) => { throw new RuleError(msg); };

let rng = Math.random;

// ---------- utilidades ----------

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function getPlayer(s, id) {
  return s.players.find((p) => p.id === id) || null;
}

function hiddenIndexes(p) {
  const out = [];
  p.cards.forEach((c, i) => { if (!c.revealed) out.push(i); });
  return out;
}

function isAlive(p) {
  return p.cards.some((c) => !c.revealed);
}

function aliveIds(s, exclude = []) {
  return s.players.filter((p) => isAlive(p) && !exclude.includes(p.id)).map((p) => p.id);
}

function currentPlayer(s) {
  return s.players[s.turn];
}

// kind/data marcam eventos importantes (a interface mostra como notificação).
function log(s, text, kind = null, data = null) {
  s.log.push({ n: s.log.length + 1, turn: s.turnNumber, text, kind, data });
}

// Toda mudança de fase/janela gera um novo "step". Jogadas enviadas para um
// step antigo são recusadas (evita que um clique atrasado caia na fase errada).
function setPhase(s, phase) {
  s.phase = phase;
  s.step++;
}

const nameOf = (s, id) => getPlayer(s, id)?.name ?? '?';
const card = (t) => CARD_NAMES[t];
const coins = (n) => `${n} moeda${n === 1 ? '' : 's'}`;

// ---------- criação ----------

function createGame(players, options = {}) {
  rng = options.rng || Math.random;
  if (players.length < MIN_PLAYERS || players.length > MAX_PLAYERS) {
    throw new Error(`O jogo precisa de ${MIN_PLAYERS} a ${MAX_PLAYERS} jogadores.`);
  }
  const deck = [];
  const copies = copiesFor(players.length);
  for (const t of CARD_TYPES) for (let i = 0; i < copies; i++) deck.push(t);
  shuffle(deck);

  const s = {
    version: 1,
    players: players.map((p) => ({
      id: p.id,
      name: p.name,
      coins: STARTING_COINS,
      cards: [{ type: deck.pop(), revealed: false }, { type: deck.pop(), revealed: false }],
    })),
    deck,
    turn: Math.floor(rng() * players.length),
    turnNumber: 1,
    phase: 'action',
    pending: null,
    winner: null,
    log: [],
    seq: 0,
    step: 1,
    copies,
  };
  // Regra oficial para 2 jogadores: quem começa recebe só 1 moeda.
  if (s.players.length === 2) s.players[s.turn].coins = 1;

  log(s, `A partida começou com ${s.players.length} jogadores. ${currentPlayer(s).name} começa.`);
  if (s.players.length === 2) log(s, `Regra de 2 jogadores: ${currentPlayer(s).name} começa com apenas 1 moeda.`);
  return s;
}

// ---------- ponto de entrada ----------

function applyIntent(s, playerId, intent, options = {}) {
  rng = options.rng || Math.random;
  try {
    if (!intent || typeof intent.type !== 'string') fail('Jogada inválida.');
    if (s.phase === 'gameOver') fail('A partida já terminou.');
    if (intent.step !== undefined && intent.step !== s.step) fail('Alguém foi mais rápido! A mesa mudou antes da sua jogada chegar.');
    const p = getPlayer(s, playerId);
    if (!p) fail('Jogador desconhecido.');
    const handler = HANDLERS[intent.type];
    if (!handler) fail('Jogada desconhecida.');
    handler(s, p, intent);
    s.seq++;
    return { ok: true };
  } catch (e) {
    if (e instanceof RuleError) return { ok: false, error: e.message };
    throw e;
  }
}

// ---------- fluxo do turno ----------

function newPending(action, actor, target) {
  return {
    action, actor, target,
    blocker: null, blockClaim: null,
    challenger: null,
    responders: [], passed: [],
    loser: null, lossReason: null, lossInfo: null, then: null,
    exchange: null,
  };
}

// Abre uma janela de resposta. Retorna false se ninguém pode responder.
function openWindow(s, phase, responders) {
  if (responders.length === 0) return false;
  setPhase(s, phase);
  s.pending.responders = responders;
  s.pending.passed = [];
  s.pending.challenger = null;
  return true;
}

// A ação não foi contestada (ou o ator provou ter a carta). Próximo passo: bloqueio.
function afterActionClaim(s) {
  const pd = s.pending;
  const def = ACTIONS[pd.action];
  if (def.blockedBy.length) {
    let blockers = [];
    if (def.anyoneCanBlock) blockers = aliveIds(s, [pd.actor]);
    else if (pd.target && isAlive(getPlayer(s, pd.target))) blockers = [pd.target];
    if (openWindow(s, 'block', blockers)) return;
  }
  resolveAction(s);
}

function resolveAction(s) {
  const pd = s.pending;
  const actor = getPlayer(s, pd.actor);
  const target = pd.target ? getPlayer(s, pd.target) : null;

  switch (pd.action) {
    case 'renda':
      actor.coins += 1;
      log(s, `${actor.name} recebe 1 moeda.`);
      return endTurn(s);
    case 'ajuda':
      actor.coins += 2;
      log(s, `${actor.name} recebe 2 moedas de Ajuda Externa.`);
      return endTurn(s);
    case 'taxar':
      actor.coins += 3;
      log(s, `${actor.name} recebe 3 moedas de Taxa.`);
      return endTurn(s);
    case 'extorquir': {
      const amount = Math.min(2, target.coins);
      target.coins -= amount;
      actor.coins += amount;
      log(s, `${actor.name} extorque ${coins(amount)} de ${target.name}.`, 'stolen', { actor: actor.id, target: target.id, amount });
      return endTurn(s);
    }
    case 'golpe':
    case 'assassinar':
      if (!target || !isAlive(target)) {
        log(s, `${nameOf(s, pd.target)} já estava fora do jogo.`);
        return endTurn(s);
      }
      if (pd.action === 'golpe') log(s, `${actor.name} derruba ${target.name} com um Golpe de Estado.`, 'coup', { actor: actor.id, target: target.id });
      else log(s, `${actor.name} assassina ${target.name}.`, 'assassinated', { actor: actor.id, target: target.id });
      return loseInfluence(s, target.id, 'endTurn', pd.action === 'golpe' ? 'golpe' : 'assassinato',
        { cause: pd.action === 'golpe' ? 'coup' : 'assassinated', by: actor.id });
    case 'trocar': {
      const hidden = hiddenIndexes(actor).map((i) => actor.cards[i].type);
      const drawn = s.deck.splice(0, 2);
      setPhase(s, 'exchange');
      pd.exchange = { options: [...hidden, ...drawn], keep: hidden.length };
      log(s, `${actor.name} compra ${drawn.length} cartas do baralho para trocar.`);
      return;
    }
  }
}

function endTurn(s) {
  if (checkWinner(s)) return;
  const n = s.players.length;
  let i = s.turn;
  do { i = (i + 1) % n; } while (!isAlive(s.players[i]));
  s.turn = i;
  s.turnNumber++;
  setPhase(s, 'action');
  s.pending = null;
}

function checkWinner(s) {
  const alive = s.players.filter(isAlive);
  if (alive.length > 1) return false;
  setPhase(s, 'gameOver');
  s.pending = null;
  s.winner = alive[0]?.id ?? null;
  log(s, `${alive[0]?.name ?? 'Ninguém'} venceu a partida!`, 'win', { who: s.winner });
  return true;
}

// Continuações (guardadas como texto para o estado continuar serializável).
const CONTINUATIONS = {
  afterActionClaim,
  resolveAction,
  endTurn,
  blockStands(s) {
    const pd = s.pending;
    log(s, `O bloqueio de ${nameOf(s, pd.blocker)} se mantém. A ação de ${nameOf(s, pd.actor)} falhou.`, 'blocked', { blocker: pd.blocker, card: pd.blockClaim, actor: pd.actor, action: pd.action });
    endTurn(s);
  },
};

function runContinuation(s, then) {
  if (checkWinner(s)) return;
  CONTINUATIONS[then](s);
}

// info = { cause, by, card }: por que a influência foi perdida (vai para o
// histórico como evento "lost", que a interface mostra com animação).
function loseInfluence(s, playerId, then, reason, info = {}) {
  const p = getPlayer(s, playerId);
  const hidden = hiddenIndexes(p);
  if (hidden.length === 0) return runContinuation(s, then);
  // Escolha automática quando não há escolha real (1 carta, ou 2 cartas iguais).
  const sameType = hidden.every((i) => p.cards[i].type === p.cards[hidden[0]].type);
  if (hidden.length === 1 || sameType) {
    revealCard(s, p, hidden[0], info);
    return runContinuation(s, then);
  }
  setPhase(s, 'loseInfluence');
  s.pending.loser = playerId;
  s.pending.lossReason = reason;
  s.pending.lossInfo = info;
  s.pending.then = then;
}

function revealCard(s, p, index, info = {}) {
  p.cards[index].revealed = true;
  const eliminated = !isAlive(p);
  log(s, `${p.name} perde uma influência e revela ${card(p.cards[index].type)}.`, 'lost',
    { who: p.id, lostCard: p.cards[index].type, eliminated, ...info });
  if (eliminated) log(s, `${p.name} foi eliminado(a).`, 'eliminated', { who: p.id });
}

// O jogador provou ter a carta: ela volta ao baralho, embaralha e compra outra.
function swapProvenCard(s, p, index) {
  const old = p.cards[index].type;
  s.deck.push(old);
  shuffle(s.deck);
  p.cards[index].type = s.deck.pop();
}

function resolveChallenge(s, challenger, claimantId, claim, isBlock) {
  const claimant = getPlayer(s, claimantId);
  const pd = s.pending;
  pd.challenger = challenger.id;
  log(s, `${challenger.name} contesta: duvida que ${claimant.name} tenha ${card(claim)}.`);

  const idx = claimant.cards.findIndex((c) => !c.revealed && c.type === claim);
  if (idx >= 0) {
    log(s, `${claimant.name} tinha ${card(claim)} e vence a contestação. A carta volta ao baralho e ${claimant.name} compra outra.`, 'challengeLost', { claimant: claimant.id, challenger: challenger.id, card: claim });
    swapProvenCard(s, claimant, idx);
    return loseInfluence(s, challenger.id, isBlock ? 'blockStands' : 'afterActionClaim', 'contestação perdida',
      { cause: 'wrongChallenge', by: claimant.id, card: claim });
  }

  log(s, `${claimant.name} não tinha ${card(claim)}. Blefe descoberto!`, 'bluff', { claimant: claimant.id, challenger: challenger.id, card: claim });
  if (isBlock) {
    log(s, `O bloqueio falha e a ação de ${nameOf(s, pd.actor)} continua.`);
    return loseInfluence(s, claimant.id, 'resolveAction', 'blefe descoberto', { cause: 'bluff', by: challenger.id, card: claim });
  }
  const def = ACTIONS[pd.action];
  if (def.cost > 0) {
    claimant.coins += def.cost;
    log(s, `A ação falha e ${claimant.name} recebe de volta ${coins(def.cost)}.`);
  } else {
    log(s, 'A ação falha.');
  }
  return loseInfluence(s, claimant.id, 'endTurn', 'blefe descoberto', { cause: 'bluff', by: challenger.id, card: claim });
}

// ---------- handlers de intenção ----------

function requireResponder(s, p) {
  const pd = s.pending;
  if (!RESPONSE_PHASES.includes(s.phase)) fail('Não há nada para responder agora.');
  if (!pd.responders.includes(p.id)) fail('Você não pode responder agora.');
  if (pd.passed.includes(p.id)) fail('Você já respondeu.');
}

const HANDLERS = {
  action(s, p, { action, target }) {
    if (s.phase !== 'action') fail('Não é hora de escolher uma ação.');
    if (currentPlayer(s).id !== p.id) fail('Não é a sua vez.');
    const def = ACTIONS[action];
    if (!def) fail('Ação desconhecida.');
    if (p.coins >= MUST_COUP_AT && action !== 'golpe') fail(`Com ${MUST_COUP_AT} ou mais moedas você é obrigado a dar um Golpe de Estado.`);
    if (p.coins < def.cost) fail(`${def.name} custa ${coins(def.cost)}.`);
    let t = null;
    if (def.needsTarget) {
      t = getPlayer(s, target);
      if (!t || t.id === p.id || !isAlive(t)) fail('Escolha um alvo válido.');
    }

    p.coins -= def.cost;
    s.pending = newPending(action, p.id, t ? t.id : null);

    let text = `${p.name} `;
    switch (action) {
      case 'renda': text += 'pega Renda (1 moeda).'; break;
      case 'ajuda': text += 'pede Ajuda Externa (2 moedas).'; break;
      case 'golpe': text += `paga 7 moedas e dá um Golpe de Estado em ${t.name}.`; break;
      case 'taxar': text += 'diz ser o Duque e Taxa (3 moedas).'; break;
      case 'assassinar': text += `diz ser o Assassino, paga 3 moedas e tenta assassinar ${t.name}.`; break;
      case 'extorquir': text += `diz ser o Capitão e tenta extorquir ${t.name}.`; break;
      case 'trocar': text += 'diz ser o Embaixador e quer trocar cartas.'; break;
    }
    log(s, text);

    if (def.claim && openWindow(s, 'challengeAction', aliveIds(s, [p.id]))) return;
    afterActionClaim(s);
  },

  pass(s, p) {
    requireResponder(s, p);
    const pd = s.pending;
    pd.passed.push(p.id);
    if (pd.passed.length < pd.responders.length) return;

    if (s.phase === 'challengeAction') return afterActionClaim(s);
    if (s.phase === 'block') return resolveAction(s);
    if (s.phase === 'challengeBlock') return CONTINUATIONS.blockStands(s);
  },

  challenge(s, p) {
    requireResponder(s, p);
    const pd = s.pending;
    if (s.phase === 'challengeAction') return resolveChallenge(s, p, pd.actor, ACTIONS[pd.action].claim, false);
    if (s.phase === 'challengeBlock') return resolveChallenge(s, p, pd.blocker, pd.blockClaim, true);
    fail('Não há o que contestar agora.');
  },

  block(s, p, { card: claim }) {
    requireResponder(s, p);
    if (s.phase !== 'block') fail('Não é hora de bloquear.');
    const pd = s.pending;
    const def = ACTIONS[pd.action];
    if (!def.blockedBy.includes(claim)) fail('Essa carta não bloqueia esta ação.');
    pd.blocker = p.id;
    pd.blockClaim = claim;
    log(s, `${p.name} diz ter ${card(claim)} e bloqueia ${def.name}.`);
    if (!openWindow(s, 'challengeBlock', aliveIds(s, [p.id]))) CONTINUATIONS.blockStands(s);
  },

  reveal(s, p, { cardIndex }) {
    if (s.phase !== 'loseInfluence') fail('Você não precisa perder influência agora.');
    if (s.pending.loser !== p.id) fail('Não é você quem perde influência.');
    const c = p.cards[cardIndex];
    if (!c || c.revealed) fail('Escolha uma das suas cartas escondidas.');
    const then = s.pending.then;
    const info = s.pending.lossInfo || {};
    s.pending.loser = null;
    s.pending.lossReason = null;
    s.pending.lossInfo = null;
    s.pending.then = null;
    revealCard(s, p, cardIndex, info);
    runContinuation(s, then);
  },

  exchange(s, p, { keep }) {
    if (s.phase !== 'exchange') fail('Não há troca em andamento.');
    const pd = s.pending;
    if (pd.actor !== p.id) fail('Não é a sua troca.');
    const { options, keep: count } = pd.exchange;
    if (!Array.isArray(keep) || keep.length !== count) fail(`Escolha exatamente ${count} carta${count === 1 ? '' : 's'}.`);
    const unique = new Set(keep);
    if (unique.size !== keep.length || keep.some((i) => !Number.isInteger(i) || i < 0 || i >= options.length)) fail('Seleção inválida.');

    const kept = keep.map((i) => options[i]);
    const returned = options.filter((_, i) => !unique.has(i));
    hiddenIndexes(p).forEach((ci, k) => { p.cards[ci].type = kept[k]; });
    s.deck.push(...returned);
    shuffle(s.deck);
    log(s, `${p.name} devolve ${returned.length} cartas ao baralho.`);
    endTurn(s);
  },
};

// ---------- visão filtrada (o que cada jogador pode ver) ----------

function getOptions(s, viewerId) {
  const p = getPlayer(s, viewerId);
  const o = { actions: null, respond: null, reveal: null, exchange: null };
  if (!p || s.phase === 'gameOver') return o;
  const pd = s.pending;

  if (s.phase === 'action' && currentPlayer(s).id === p.id) {
    const targets = aliveIds(s, [p.id]);
    o.actions = Object.entries(ACTIONS).map(([id, def]) => {
      let reason = null;
      if (p.coins >= MUST_COUP_AT && id !== 'golpe') reason = `Com ${MUST_COUP_AT}+ moedas o Golpe é obrigatório`;
      else if (p.coins < def.cost) reason = `Precisa de ${coins(def.cost)}`;
      return { id, name: def.name, claim: def.claim, cost: def.cost, needsTarget: def.needsTarget, targets: def.needsTarget ? targets : [], enabled: !reason, reason };
    });
  }

  if (RESPONSE_PHASES.includes(s.phase) && pd.responders.includes(p.id) && !pd.passed.includes(p.id)) {
    o.respond = {
      canChallenge: s.phase !== 'block',
      blockCards: s.phase === 'block' ? ACTIONS[pd.action].blockedBy : [],
    };
  }

  if (s.phase === 'loseInfluence' && pd.loser === p.id) o.reveal = hiddenIndexes(p);
  if (s.phase === 'exchange' && pd.actor === p.id) o.exchange = { ...pd.exchange };
  return o;
}

function getView(s, viewerId, logLimit = 150) {
  let pending = null;
  if (s.pending) {
    const { exchange, then, ...rest } = s.pending;
    pending = { ...rest, waitingFor: rest.responders.filter((id) => !rest.passed.includes(id)) };
  }
  return {
    you: viewerId,
    players: s.players.map((p) => ({
      id: p.id,
      name: p.name,
      coins: p.coins,
      alive: isAlive(p),
      cards: p.cards.map((c) => (c.revealed || p.id === viewerId ? { type: c.type, revealed: c.revealed } : { type: null, revealed: false })),
    })),
    deckCount: s.deck.length,
    copies: s.copies ?? 3,
    turn: currentPlayer(s).id,
    turnNumber: s.turnNumber,
    phase: s.phase,
    step: s.step,
    pending,
    winner: s.winner,
    seq: s.seq,
    log: s.log.slice(-logLimit),
    options: getOptions(s, viewerId),
  };
}

const api = {
  CARD_TYPES, CARD_NAMES, copiesFor, MODES, STARTING_COINS, MUST_COUP_AT, MIN_PLAYERS, MAX_PLAYERS,
  ACTIONS, RESPONSE_PHASES, getPlayer, hiddenIndexes, isAlive, currentPlayer,
  createGame, applyIntent, getOptions, getView,
};
if (typeof module === 'object' && module.exports) module.exports = api;
else root.JogoEngine = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
