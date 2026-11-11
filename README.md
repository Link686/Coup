# Coup Online

Versão web do jogo de cartas **Coup** (2 a 15 jogadores), feita em JavaScript puro para rodar no **GitHub Pages**, sem servidor próprio.

## Como funciona

- Um jogador cria a sala e vira o **anfitrião**: o navegador dele guarda o estado oficial da partida e aplica as regras.
- Os outros entram com o código da sala (ou pelo link de convite) e se conectam direto ao anfitrião via WebRTC, usando [PeerJS](https://peerjs.com/). O servidor público do PeerJS só serve para "apresentar" os navegadores; as jogadas não passam por ele.
- Cada convidado recebe apenas a sua visão do jogo (as cartas dos outros não são enviadas).
- Se um convidado recarregar a página, ele volta sozinho para o mesmo lugar. Se o anfitrião recarregar, pode usar **Retomar sala** e a partida continua.

> O anfitrião tem o estado completo no navegador dele, então tecnicamente poderia espiar as cartas. É o preço de não ter servidor: jogue com quem você confia.

## Estrutura

| Arquivo | O que faz |
|---|---|
| `js/engine.js` | Motor de regras puro (sem DOM, sem rede). Exposto como `window.CoupEngine`. |
| `js/net.js` | Sessões de anfitrião e convidado com PeerJS. |
| `js/cards.js` | Visual das cartas (arte própria em SVG) e textos de referência. |
| `js/app.js` | Interface. |
| `tests/engine.test.mjs` | Testes das regras (`npm test`, precisa de Node 18+). |

## Rodar localmente

Basta abrir o `index.html` no navegador (precisa de internet para a conexão entre jogadores). Para testar sozinho, abra várias abas: cada aba conta como um jogador.

## Publicar no GitHub Pages

Settings → Pages → *Deploy from a branch* → branch `master`, pasta `/ (root)`.

## Regras implementadas

- 5 personagens (Duque, Assassino, Capitão, Embaixador, Condessa), 2 cartas e 2 moedas por jogador.
- Cópias de cada carta: 3 (até 6 jogadores), 4 (7–8) ou 5 (9–10).
- Modo Festa (regra da casa, até 15 jogadores): 6 cópias com 11–12 e 7 com 13–15.
- 2 jogadores: quem começa recebe só 1 moeda (regra oficial).
- Ações: Renda, Ajuda Externa, Golpe de Estado (7), Taxar, Assassinar (3), Extorquir, Trocar.
- Com 10+ moedas o Golpe de Estado é obrigatório.
- Contestação de ações e de bloqueios por qualquer jogador; quem prova ter a carta a devolve ao baralho e compra outra.
- Bloqueios: Duque bloqueia Ajuda Externa (qualquer jogador); Condessa bloqueia Assassinato; Capitão ou Embaixador bloqueiam Extorsão (só o alvo).
- Assassinato contestado com sucesso devolve as 3 moedas; assassinato bloqueado não devolve.
- Perda dupla de influência (ex.: Condessa falsa contestada + assassinato) funciona.
- Tempo opcional para responder: quem não responde passa automaticamente.
