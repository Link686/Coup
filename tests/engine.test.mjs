import { test } from 'node:test';
import assert from 'node:assert/strict';
import engine from '../js/engine.js';
const { createGame, applyIntent, getView, getPlayer, CARD_TYPES, copiesFor } = engine;

// RNG determinístico para os testes.
function seeded(seed = 1) {
  return () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
}

// Cria jogo e força mãos, moedas e quem começa.
function setup(hands, { turn = 0, coins } = {}) {
  const players = hands.map((_, i) => ({ id: 'p' + i, name: 'J' + i }));
  const s = createGame(players, { rng: seeded(7) });
  const deck = [];
  for (const t of CARD_TYPES) for (let i = 0; i < 3; i++) deck.push(t);
  hands.forEach((h, i) => {
    s.players[i].cards = h.map((t) => ({ type: t, revealed: false }));
    s.players[i].coins = coins?.[i] ?? 2;
    for (const t of h) deck.splice(deck.indexOf(t), 1);
  });
  s.deck = deck;
  s.turn = turn;
  return s;
}

const rng = seeded(3);
function act(s, pid, intent) {
  const r = applyIntent(s, pid, intent, { rng });
  assert.ok(r.ok, r.error);
  return r;
}
function bad(s, pid, intent) {
  const r = applyIntent(s, pid, intent, { rng });
  assert.equal(r.ok, false);
  return r;
}
const hidden = (s, id) => getPlayer(s, id).cards.filter((c) => !c.revealed).length;
const totalCards = (s) => s.deck.length + s.players.reduce((n, p) => n + p.cards.length, 0)
  + (s.phase === "exchange" ? s.pending.exchange.options.length - s.pending.exchange.keep : 0);

test('renda e passagem de turno', () => {
  const s = setup([['duque', 'condessa'], ['capitao', 'assassino'], ['embaixador', 'duque']]);
  act(s, 'p0', { type: 'action', action: 'renda' });
  assert.equal(getPlayer(s, 'p0').coins, 3);
  assert.equal(s.turn, 1);
  bad(s, 'p0', { type: 'action', action: 'renda' });
});

test('regra de 2 jogadores: quem começa tem 1 moeda', () => {
  const s = createGame([{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }], { rng: seeded(5) });
  const first = s.players[s.turn];
  const other = s.players[1 - s.turn];
  assert.equal(first.coins, 1);
  assert.equal(other.coins, 2);
});

test('ajuda externa bloqueada por Duque sem contestação', () => {
  const s = setup([['capitao', 'condessa'], ['duque', 'assassino'], ['embaixador', 'capitao']]);
  act(s, 'p0', { type: 'action', action: 'ajuda' });
  assert.equal(s.phase, 'block');
  assert.deepEqual(s.pending.responders, ['p1', 'p2']);
  act(s, 'p1', { type: 'block', card: 'duque' });
  assert.equal(s.phase, 'challengeBlock');
  act(s, 'p0', { type: 'pass' });
  act(s, 'p2', { type: 'pass' });
  assert.equal(getPlayer(s, 'p0').coins, 2);
  assert.equal(s.turn, 1);
});

test('ajuda externa: bloqueio falso contestado, ajuda acontece', () => {
  const s = setup([['capitao', 'condessa'], ['condessa', 'assassino'], ['embaixador', 'capitao']]);
  act(s, 'p0', { type: 'action', action: 'ajuda' });
  act(s, 'p1', { type: 'block', card: 'duque' });
  act(s, 'p2', { type: 'challenge' });
  assert.equal(s.phase, 'loseInfluence');
  assert.equal(s.pending.loser, 'p1');
  act(s, 'p1', { type: 'reveal', cardIndex: 1 });
  assert.equal(getPlayer(s, 'p0').coins, 4);
  assert.equal(s.turn, 1);
});

test('taxa com blefe contestada: ator perde e não ganha moedas', () => {
  const s = setup([['capitao', 'condessa'], ['duque', 'assassino']]);
  act(s, 'p0', { type: 'action', action: 'taxar' });
  act(s, 'p1', { type: 'challenge' });
  act(s, 'p0', { type: 'reveal', cardIndex: 0 });
  assert.equal(getPlayer(s, 'p0').coins, 2);
  assert.equal(hidden(s, 'p0'), 1);
  assert.equal(s.turn, 1);
});

test('taxa verdadeira contestada: contestador perde, carta é trocada, ator ganha 3', () => {
  const s = setup([['duque', 'condessa'], ['capitao', 'assassino'], ['embaixador', 'capitao']]);
  const before = totalCards(s);
  act(s, 'p0', { type: 'action', action: 'taxar' });
  act(s, 'p1', { type: 'challenge' });
  assert.equal(s.pending.loser, 'p1');
  act(s, 'p1', { type: 'reveal', cardIndex: 0 });
  assert.equal(getPlayer(s, 'p0').coins, 5);
  assert.equal(hidden(s, 'p0'), 2);
  assert.equal(totalCards(s), before);
  assert.equal(s.turn, 1);
});

test('assassinato: Condessa falsa contestada elimina o alvo (perde 2)', () => {
  const s = setup([['assassino', 'duque'], ['capitao', 'embaixador'], ['duque', 'capitao']], { coins: [3, 2, 2] });
  act(s, 'p0', { type: 'action', action: 'assassinar', target: 'p1' });
  assert.equal(getPlayer(s, 'p0').coins, 0);
  act(s, 'p1', { type: 'pass' });
  act(s, 'p2', { type: 'pass' });
  assert.equal(s.phase, 'block');
  assert.deepEqual(s.pending.responders, ['p1']);
  act(s, 'p1', { type: 'block', card: 'condessa' });
  act(s, 'p0', { type: 'challenge' });
  act(s, 'p1', { type: 'reveal', cardIndex: 0 }); // perde pelo blefe, a outra sai pelo assassinato
  assert.equal(hidden(s, 'p1'), 0);
  assert.equal(s.turn, 2);
});

test('assassinato: alvo contesta e perde, depois sofre o assassinato', () => {
  const s = setup([['assassino', 'duque'], ['capitao', 'embaixador'], ['duque', 'capitao']], { coins: [3, 2, 2] });
  act(s, 'p0', { type: 'action', action: 'assassinar', target: 'p1' });
  act(s, 'p1', { type: 'challenge' });
  act(s, 'p1', { type: 'reveal', cardIndex: 0 });
  // alvo ficou com 1 carta: não pode bloquear? pode sim, ainda vivo
  assert.equal(s.phase, 'block');
  act(s, 'p1', { type: 'pass' });
  assert.equal(hidden(s, 'p1'), 0);
  assert.equal(s.turn, 2);
});

test('assassinato com blefe contestado devolve as 3 moedas', () => {
  const s = setup([['duque', 'condessa'], ['capitao', 'embaixador']], { coins: [3, 2] });
  act(s, 'p0', { type: 'action', action: 'assassinar', target: 'p1' });
  assert.equal(getPlayer(s, 'p0').coins, 0);
  act(s, 'p1', { type: 'challenge' });
  act(s, 'p0', { type: 'reveal', cardIndex: 0 });
  assert.equal(getPlayer(s, 'p0').coins, 3);
  assert.equal(hidden(s, 'p1'), 2);
});

test('assassinato bloqueado por Condessa: moedas não voltam', () => {
  const s = setup([['assassino', 'duque'], ['condessa', 'embaixador']], { coins: [3, 2] });
  act(s, 'p0', { type: 'action', action: 'assassinar', target: 'p1' });
  act(s, 'p1', { type: 'pass' });
  act(s, 'p1', { type: 'block', card: 'condessa' });
  act(s, 'p0', { type: 'pass' });
  assert.equal(getPlayer(s, 'p0').coins, 0);
  assert.equal(hidden(s, 'p1'), 2);
});

test('extorsão: bloqueio de Embaixador verdadeiro contestado', () => {
  const s = setup([['capitao', 'duque'], ['embaixador', 'condessa'], ['duque', 'assassino']]);
  act(s, 'p0', { type: 'action', action: 'extorquir', target: 'p1' });
  act(s, 'p1', { type: 'pass' });
  act(s, 'p2', { type: 'pass' });
  bad(s, 'p1', { type: 'block', card: 'duque' });
  act(s, 'p1', { type: 'block', card: 'embaixador' });
  act(s, 'p2', { type: 'challenge' });
  act(s, 'p2', { type: 'reveal', cardIndex: 0 });
  assert.equal(getPlayer(s, 'p0').coins, 2);
  assert.equal(getPlayer(s, 'p1').coins, 2);
  assert.equal(s.turn, 1);
});

test('extorsão de quem tem 1 moeda leva só 1', () => {
  const s = setup([['capitao', 'duque'], ['embaixador', 'condessa']], { coins: [2, 1] });
  act(s, 'p0', { type: 'action', action: 'extorquir', target: 'p1' });
  act(s, 'p1', { type: 'pass' });
  act(s, 'p1', { type: 'pass' });
  assert.equal(getPlayer(s, 'p0').coins, 3);
  assert.equal(getPlayer(s, 'p1').coins, 0);
});

test('golpe obrigatório com 10 moedas e golpe não pode ser bloqueado', () => {
  const s = setup([['capitao', 'duque'], ['embaixador', 'condessa']], { coins: [10, 2] });
  bad(s, 'p0', { type: 'action', action: 'renda' });
  bad(s, 'p0', { type: 'action', action: 'golpe', target: 'p0' });
  act(s, 'p0', { type: 'action', action: 'golpe', target: 'p1' });
  assert.equal(s.phase, 'loseInfluence');
  act(s, 'p1', { type: 'reveal', cardIndex: 1 });
  assert.equal(getPlayer(s, 'p0').coins, 3);
  assert.equal(s.turn, 1);
});

test('golpe sem moedas suficientes é recusado', () => {
  const s = setup([['capitao', 'duque'], ['embaixador', 'condessa']], { coins: [6, 2] });
  const r = bad(s, 'p0', { type: 'action', action: 'golpe', target: 'p1' });
  assert.match(r.error, /7 moedas/);
});

test('troca do Embaixador mantém número de cartas', () => {
  const s = setup([['embaixador', 'duque'], ['capitao', 'condessa']]);
  const before = totalCards(s);
  act(s, 'p0', { type: 'action', action: 'trocar' });
  act(s, 'p1', { type: 'pass' });
  assert.equal(s.phase, 'exchange');
  const opts = s.pending.exchange.options;
  assert.equal(opts.length, 4);
  bad(s, 'p0', { type: 'exchange', keep: [0] });
  bad(s, 'p0', { type: 'exchange', keep: [1, 1] });
  act(s, 'p0', { type: 'exchange', keep: [2, 3] });
  assert.deepEqual(getPlayer(s, 'p0').cards.map((c) => c.type), [opts[2], opts[3]]);
  assert.equal(totalCards(s), before);
  assert.equal(s.deck.length, 15 - 4);
});

test('troca com 1 influência: escolhe 1 entre 3', () => {
  const s = setup([['embaixador', 'duque'], ['capitao', 'condessa']]);
  s.players[0].cards[1].revealed = true;
  act(s, 'p0', { type: 'action', action: 'trocar' });
  act(s, 'p1', { type: 'pass' });
  assert.equal(s.pending.exchange.options.length, 3);
  act(s, 'p0', { type: 'exchange', keep: [2] });
  assert.equal(getPlayer(s, 'p0').cards[1].revealed, true);
  assert.equal(getPlayer(s, 'p0').cards[1].type, 'duque');
});

test('fim de jogo quando sobra um jogador', () => {
  const s = setup([['capitao', 'duque'], ['embaixador', 'condessa']], { coins: [7, 2] });
  s.players[1].cards[0].revealed = true;
  act(s, 'p0', { type: 'action', action: 'golpe', target: 'p1' });
  assert.equal(s.phase, 'gameOver');
  assert.equal(s.winner, 'p0');
  bad(s, 'p1', { type: 'action', action: 'renda' });
});

test('turno pula jogadores eliminados', () => {
  const s = setup([['capitao', 'duque'], ['embaixador', 'condessa'], ['duque', 'assassino']]);
  s.players[1].cards.forEach((c) => { c.revealed = true; });
  act(s, 'p0', { type: 'action', action: 'renda' });
  assert.equal(s.turn, 2);
});

test('contestador eliminado ao perder a contestação; jogo segue', () => {
  const s = setup([['duque', 'condessa'], ['capitao', 'assassino'], ['embaixador', 'capitao']]);
  s.players[1].cards[0].revealed = true;
  act(s, 'p0', { type: 'action', action: 'taxar' });
  act(s, 'p1', { type: 'challenge' });
  assert.equal(hidden(s, 'p1'), 0);
  assert.equal(getPlayer(s, 'p0').coins, 5);
  assert.equal(s.turn, 2);
});

test('visão esconde cartas alheias e opções corretas', () => {
  const s = setup([['duque', 'condessa'], ['capitao', 'assassino']]);
  const v = getView(s, 'p1');
  assert.deepEqual(v.players[0].cards, [{ type: null, revealed: false }, { type: null, revealed: false }]);
  assert.equal(v.players[1].cards[0].type, 'capitao');
  assert.equal(v.options.actions, null);
  const v0 = getView(s, 'p0');
  assert.ok(v0.options.actions.find((a) => a.id === 'golpe' && !a.enabled));
  assert.equal(JSON.stringify(v).includes('"deck"'), false);
});

test('partidas aleatórias completas nunca quebram as invariantes', () => {
  const r = seeded(99);
  for (let g = 0; g < 300; g++) {
    const n = 2 + (g % 14);
    const s = createGame(Array.from({ length: n }, (_, i) => ({ id: 'p' + i, name: 'J' + i })), { rng: r });
    let steps = 0;
    while (s.phase !== 'gameOver' && steps++ < 2000) {
      // encontra quem tem algo a fazer e escolhe uma jogada aleatória válida
      const moves = [];
      for (const p of s.players) {
        const o = getView(s, p.id).options;
        if (o.actions) for (const a of o.actions.filter((a) => a.enabled)) {
          if (a.needsTarget) a.targets.forEach((t) => moves.push([p.id, { type: 'action', action: a.id, target: t }]));
          else moves.push([p.id, { type: 'action', action: a.id }]);
        }
        if (o.respond) {
          moves.push([p.id, { type: 'pass' }], [p.id, { type: 'pass' }]);
          if (o.respond.canChallenge) moves.push([p.id, { type: 'challenge' }]);
          o.respond.blockCards.forEach((c) => moves.push([p.id, { type: 'block', card: c }]));
        }
        if (o.reveal) o.reveal.forEach((i) => moves.push([p.id, { type: 'reveal', cardIndex: i }]));
        if (o.exchange) {
          const idx = o.exchange.options.map((_, i) => i).sort(() => r() - 0.5).slice(0, o.exchange.keep);
          moves.push([p.id, { type: 'exchange', keep: idx }]);
        }
      }
      assert.ok(moves.length > 0, `travou na fase ${s.phase}`);
      const [pid, intent] = moves[Math.floor(r() * moves.length)];
      const res = applyIntent(s, pid, intent, { rng: r });
      assert.ok(res.ok, res.error);
      assert.equal(totalCards(s), 5 * copiesFor(n));
      assert.ok(s.players.every((p) => p.coins >= 0));
    }
    assert.equal(s.phase, 'gameOver');
    assert.equal(s.players.filter((p) => p.cards.some((c) => !c.revealed)).length, 1);
  }
});

test('jogada atrasada (step antigo) é recusada', () => {
  const s = setup([['capitao', 'condessa'], ['duque', 'assassino'], ['embaixador', 'capitao']]);
  act(s, 'p0', { type: 'action', action: 'taxar' });
  const old = s.step;
  // p1 e p2 clicam ao mesmo tempo: p1 duvida primeiro, o "passar" de p2 chega depois
  act(s, 'p1', { type: 'challenge', step: old });
  const r = bad(s, 'p2', { type: 'pass', step: old });
  assert.match(r.error, /mais rápido/);
});

test('respostas simultâneas na mesma janela são aceitas', () => {
  const s = setup([['duque', 'condessa'], ['capitao', 'assassino'], ['embaixador', 'capitao']]);
  act(s, 'p0', { type: 'action', action: 'taxar' });
  const st = s.step;
  act(s, 'p1', { type: 'pass', step: st });
  act(s, 'p2', { type: 'pass', step: st });
  assert.equal(getPlayer(s, 'p0').coins, 5);
});

test('carta perdida registra causa e quem causou', () => {
  const s = setup([['assassino', 'duque'], ['capitao', 'embaixador'], ['duque', 'capitao']], { coins: [3, 2, 2] });
  act(s, 'p0', { type: 'action', action: 'assassinar', target: 'p1' });
  act(s, 'p1', { type: 'pass' });
  act(s, 'p2', { type: 'pass' });
  act(s, 'p1', { type: 'block', card: 'condessa' });
  act(s, 'p0', { type: 'challenge' });
  act(s, 'p1', { type: 'reveal', cardIndex: 1 });
  const lost = s.log.filter((e) => e.kind === 'lost').map((e) => e.data);
  assert.deepEqual(lost[0], { who: 'p1', lostCard: 'embaixador', eliminated: false, cause: 'bluff', by: 'p0', card: 'condessa' });
  assert.deepEqual(lost[1], { who: 'p1', lostCard: 'capitao', eliminated: true, cause: 'assassinated', by: 'p0' });
});

test('eventos importantes são marcados no histórico', () => {
  const s = setup([['capitao', 'condessa'], ['duque', 'assassino']]);
  act(s, 'p0', { type: 'action', action: 'taxar' });
  act(s, 'p1', { type: 'challenge' });
  const ev = s.log.find((e) => e.kind === 'bluff');
  assert.deepEqual(ev.data, { claimant: 'p0', challenger: 'p1', card: 'duque' });
});

test('7 a 15 jogadores usam mais cópias de cada carta', () => {
  for (const [n, copies] of [[6, 3], [7, 4], [8, 4], [9, 5], [10, 5], [11, 6], [12, 6], [13, 7], [15, 7]]) {
    const s = createGame(Array.from({ length: n }, (_, i) => ({ id: 'p' + i, name: 'J' + i })), { rng: seeded(n) });
    assert.equal(s.deck.length + n * 2, 5 * copies);
    assert.ok(s.deck.length >= (n > 10 ? 5 : 3));
    for (const t of CARD_TYPES) {
      const count = s.deck.filter((c) => c === t).length + s.players.flatMap((p) => p.cards).filter((c) => c.type === t).length;
      assert.equal(count, copies);
    }
  }
  assert.throws(() => createGame(Array.from({ length: 16 }, (_, i) => ({ id: 'p' + i, name: 'J' + i }))));
});
