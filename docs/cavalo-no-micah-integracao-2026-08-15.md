# Integracao do Cavalo no Micah: a TUI ganha corpo

- **Data**: 2026-08-15
- **Autor do card**: Rodrigo Campos (pedido em conversa de 2026-08-15; redigido pelo executor a partir das palavras dele)
- **Coluna**: A fazer

## Descricao

A TUI do Cavalo (pacote npm `cavalo-magico`, aberto pelo alias `cavalo` no
zig-laptop, fonte da verdade em `/home/ubuntu/CavaloMagico` no cavalo-santiago)
esta desatualizada. Em vez de so atualizar o pacote, o Cavalo passa a viver
dentro do Micah: o Micah e o corpo (PTY, browser com CDP, editor, Ai Viewer) e
o Cavalo e o espaco/identidade. Analise completa em
`fable-claude-code-fortes-fracos.md` e `cavalo-no-micah-integracao.md`
(scratchpad da conversa; copiar para docs/ quando o card entrar em Fazendo).

A tese: os pontos fracos do Claude Code puro viram pontos fortes aqui.

| Fraqueza no Claude Code puro | Orgao no Micah |
|---|---|
| Nao dirige programa interativo (sem PTY) | ponte MCP sobre as sessoes PTY das abas |
| Agente escreve as cegas, nunca ve o render | Ai Viewer (card painel-esquerdo, E5) + captura de janela |
| Estado de shell evapora entre chamadas | PTY persistente por aba |
| Negacao de permissao sem dialogo | botao Intervir injetando steering na sessao |

O que ja existe e este card NAO refaz: ressurreicao de sessao Claude por aba
(commit 54efdef), ponte Playwright para o painel de browser
(`scripts/micah-playwright-mcp.mjs` + `browser-cdp.json`), moldura dos tres
modos (E1 do card painel-esquerdo). Editor e Ai Viewer sao entrega do card
`painel-esquerdo-browser-editor-ai-viewer-2026-08-14.md`, que e PRE-REQUISITO
deste e roda antes (MAXIMO 01 CARD POR VEZ).

## Criterio de aceite

1. **Ponte PTY**: existe um wrapper MCP `scripts/micah-pty-mcp.mjs` no mesmo
   padrao do `micah-playwright-mcp.mjs` (script node fino, zero dependencia
   nova, LEI ZERO respeitada) expondo `pty_list`, `pty_read(tab)` e
   `pty_write(tab, data)` sobre as sessoes PTY vivas do Micah. Prova: um agente
   Claude Code, via essa ponte, abre um REPL interativo (ex. `python`) numa aba
   do Micah, envia uma expressao e le o resultado do buffer, com saida bruta
   anexada.
2. **Seguranca da ponte**: a ponte so alcanca sessoes do proprio usuario no
   proprio Micah (descoberta por arquivo local, como o `browser-cdp.json`);
   `pty_write` em aba inexistente devolve erro limpo, nao trava; teste cobre os
   dois casos.
3. **Alias atualizado**: o comando `cavalo` no zig-laptop abre o ambiente novo
   (Micah no espaco CAVALO, com a sessao Claude do espaco ressuscitando via o
   mecanismo do commit 54efdef). `cavalo --tui` (fallback) continua abrindo a
   TUI antiga do pacote npm, atualizada da fonte da verdade do box.
4. **Intervir**: com o Ai Viewer entregue (card anterior), existe um caminho de
   intervencao: o usuario, vendo a AI trabalhar, dispara uma mensagem de
   steering que chega a sessao do agente em execucao, e o agente muda de rumo
   sem perder a sessao. Prova E2E com a sessao real.
5. Nada disso regride o que ja passou: `scripts/validate-browser-panel.mjs`
   verde, suite vitest e cargo verdes, criterios do card painel-esquerdo
   conferidos apos a integracao.

## Comentarios humanos (o alvo)

- Palavras do Rodrigo (2026-08-15): "Como podemos fazer a tui do cavalo se
  integrar ao Micah trazendo consigo exatamente seu desenho, seus pontos
  fortes do claude code, mas tornando os pontos fracos de la, seus maiores
  pontos fortes aqui?"
- O AI Viewer e observacao com poder de intervencao humana: "se comecar
  alucinar, fazer algo errado o usuario poder intervir na hora".
- LEI ZERO do memorium vale: zero dependencia nova; wrapper de script e
  fiacao, nao tecnologia.
- Este card so entra em Fazendo depois que `painel-esquerdo` fechar.

## Plano em etapas

<a gerar quando o card entrar em Fazendo, com auditoria de plano Opus>

## Auditorias por etapa

<a preencher>

## Validacao independente

<a preencher>

## Rastro

<a preencher>
