// Visual das cartas (arte própria em SVG) e textos de referência dos personagens.
(function () {
'use strict';

const EMBLEMS = {
  duque: '<path d="M18 68 L22 34 L36 52 L50 24 L64 52 L78 34 L82 68 Z"/><rect x="18" y="72" width="64" height="9" rx="2"/><circle cx="22" cy="29" r="5"/><circle cx="50" cy="18" r="5"/><circle cx="78" cy="29" r="5"/>',
  assassino: '<path d="M50 6 L59 58 L41 58 Z"/><rect x="26" y="58" width="48" height="7" rx="3"/><rect x="46" y="65" width="8" height="17"/><circle cx="50" cy="88" r="6"/>',
  capitao: '<g fill="none" stroke="currentColor" stroke-width="7" stroke-linecap="round"><circle cx="50" cy="17" r="8"/><path d="M50 25 V86"/><path d="M32 38 H68"/><path d="M20 62 Q22 86 50 86 Q78 86 80 62"/></g><path d="M11 67 L20 53 L29 67 Z"/><path d="M71 67 L80 53 L89 67 Z"/>',
  embaixador: '<rect x="15" y="27" width="70" height="48" rx="4" fill="none" stroke="currentColor" stroke-width="6"/><path d="M17 29 L50 56 L83 29" fill="none" stroke="currentColor" stroke-width="6" stroke-linejoin="round"/><circle cx="50" cy="61" r="10"/>',
  condessa: '<path d="M50 86 C22 64 13 46 25 31 C35 19 48 24 50 35 C52 24 65 19 75 31 C87 46 78 64 50 86 Z"/><path d="M36 12 L42 20 L50 10 L58 20 L64 12 L62 24 L38 24 Z"/>',
};

const CHARS = {
  duque: {
    name: 'Duque', article: 'o', action: 'Taxar', short: '+3 moedas',
    text: 'Pega 3 moedas do tesouro.', blocks: 'Bloqueia Ajuda Externa',
  },
  assassino: {
    name: 'Assassino', article: 'o', action: 'Assassinar', short: 'paga 3, elimina',
    text: 'Paga 3 moedas e escolhe um jogador para perder uma influência.', blocks: null,
  },
  capitao: {
    name: 'Capitão', article: 'o', action: 'Extorquir', short: 'rouba 2 moedas',
    text: 'Pega 2 moedas de outro jogador.', blocks: 'Bloqueia Extorsão',
  },
  embaixador: {
    name: 'Embaixador', article: 'o', action: 'Trocar', short: 'troca cartas',
    text: 'Compra 2 cartas do baralho, escolhe com quais fica e devolve 2.', blocks: 'Bloqueia Extorsão',
  },
  condessa: {
    name: 'Condessa', article: 'a', action: null, short: null,
    text: null, blocks: 'Bloqueia Assassinato',
  },
};

const emblem = (type) => `<svg class="pc-emblem" viewBox="0 0 100 100" fill="currentColor" aria-hidden="true">${EMBLEMS[type]}</svg>`;

// size: xs (mesa), sm (botões), md (mão), lg (referência)
function face(type, { size = 'md', dead = false, detail = size !== 'xs' } = {}) {
  const c = CHARS[type];
  let info = '';
  if (detail && size === 'lg') {
    info = `${c.action ? `<div class="pc-ability"><b>${c.action}</b><br>${c.text}</div>` : '<div class="pc-ability"><b>Sem ação própria</b></div>'}
      ${c.blocks ? `<div class="pc-block">${c.blocks}</div>` : ''}`;
  } else if (detail) {
    const parts = [c.action ? `${c.action}` : null, c.blocks ? c.blocks.replace('Bloqueia ', 'bloqueia ') : null].filter(Boolean);
    info = `<div class="pc-ability">${parts.join(' · ')}</div>`;
  }
  return `<div class="pc pc-${size} c-${type} ${dead ? 'dead' : ''}" role="img" aria-label="${c.name}${dead ? ' (perdida)' : ''}"><div class="pc-body">
    <div class="pc-frame">
      <div class="pc-medal">${emblem(type)}</div>
      <div class="pc-name ${c.name.length > 8 ? 'long' : ''}">${c.name}</div>
      ${info}
    </div>
  </div></div>`;
}

function back(size = 'md') {
  return `<div class="pc pc-${size} pc-back" role="img" aria-label="Carta virada"><div class="pc-body">
    <div class="pc-frame"><div class="pc-back-mark">★</div></div>
  </div></div>`;
}

window.JogoCards = { CHARS, face, back, emblem };
})();
