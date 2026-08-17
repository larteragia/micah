# Micah's Mind: rastro luminoso da AI no lugar do AI Viewer

- **Data**: 2026-08-17
- **Autor do card**: Rodrigo Campos
- **Coluna**: Fazendo

## Descricao

Substituir o painel AI Viewer do Micah pelo Micah's Mind: a mente da AI
visualizada como cidade do repositório em bolinhas luminosas, navegável com
mouse ou toque, alimentada em tempo real pelo JSONL da sessão `claude` da aba
ativa. Port do mindwalk (github.com/cosmtrek/mindwalk, MIT, clonado em
/home/ubuntu/projetos/mindwalk no cavalo-santiago) DENTRO do repo do Micah:
sem servidor Go, sem projeto à parte. Ao fim da sessão, um juiz GLM le o
rastro e grava chunk enriquecido no oracle-rag (memória de qualidade).

Renome decidida pelo Rodrigo antes da primeira linha de código: o projeto
chamava "mindhorse" nas memórias de plano e passa a se chamar Micah's Mind.
Label do seletor: "Micah's Mind". O id do modo `ai-viewer` NÃO muda
(localStorage micah.leftPanel.mode compatível).

### Decisão de arquitetura forçada pela LEI ZERO

`three` NÃO está no package.json e a LEI ZERO proíbe dependência nova. A
cena do mindwalk é React/Three.js; portá-la direto exigiria `three`. O
caminho que respeita a lei: renderer próprio em Canvas 2D nativo (pontos com
glow, pan/zoom/toque), zero dependência, zero contexto WebGL novo (o pool de
renderers segue com teto 5 intocado). Se o Rodrigo autorizar `three` em
comentário humano neste card, a camada visual troca sem mexer no
modelo/streaming (a separação parse -> trace -> citymap -> renderer garante
isso). A decisão de dependência é do Rodrigo, nunca do executor.

### Ativos herdados do card painel-esquerdo

O viewer velho já entrega a base que este card reutiliza: comando Rust
`claude_session_tail` (tail por offset, confinado a ~/.claude/projects,
chunk 256 KiB, corte UTF-8 na borda), parser `claudeSessionOps.ts`, feed
`useClaudeSessionFeed.ts` (poll 700 ms com catch-up), ancora de sessão por
pane (`leaf.resume`) e a moldura de três modos. Este card demole a
apresentação velha e constrói a nova em cima dessa base.

## Criterio de aceite

1. Com o app rodando e uma sessão `claude` ativa numa aba, o painel esquerdo
   em modo Mind mostra pontos luminosos do repositório da sessão com cor por
   tipo de toque (verde = visto, azul = lido, âmbar = editado, escuro = não
   visitado), e `grep '"three"' package.json` segue vazio (zero dependência
   nova).
2. Arrastar move o mapa (pan), roda do mouse e pinça mudam o zoom, e clicar
   em um ponto mostra o nome do arquivo; comprovado por capturas da janela
   com scripts/window-shot.ps1 (antes/depois do pan e do zoom).
3. Streaming ao vivo: uma tool_use nova na sessão ativa acende ou cria o
   ponto correspondente em menos de 3 s a partir do evento no JSONL, sem
   recarregar a cena; prova com log do feed e capturas antes/depois.
4. Troca de aba troca o mind: com duas abas apontando sessões `claude`
   distintas, clicar na segunda aba troca imediatamente a cidade exibida
   para a sessão da pane ativa; prova com duas capturas nomeadas.
5. O label do seletor do painel esquerdo mostra "Micah's Mind" com o id
   `ai-viewer` preservado; prova: captura do seletor + teste unitário do
   coerce com valor persistido antigo (`ai-viewer` continua válido).
6. Viewer velho removido: os arquivos exclusivos (lista na seção Plano, E6)
   apagados com seus testes exclusivos, knip limpo, `pnpm lint`,
   `pnpm check-types` e `pnpm test` verdes no conjunto (fails pré-existentes
   documentados no memorium não contam contra), `cargo clippy --all-targets
   --locked -- -D warnings` e `cargo test --locked` no mesmo padrão.
7. Report: `node scripts/micahs-mind-report.mjs <session-jsonl>` roda o juiz
   pela CLI `claude -p` (GLM, nada de Anthropic) sobre o trace e grava chunk
   no oracle-rag; prova: stdout do comando com o id da memória criada e
   timestamp.
8. Binário reconstruído e lido do ar: `pnpm tauri build --no-bundle` com o
   build id novo reportado pelo app em execução (comando browser_build_id /
   log MICAH_BUILD_ID), anexado com timestamp.

## Comentários humanos (o alvo)

Palavras do Rodrigo (2026-08-17), mandam sobre tudo:

- "o usuário com mouse ou dedo poderá mover e navegar ali pelas bolinhas
  luminosas ilustrando o workflow da ai por onde ela passou e o que ela fez.
  Deixando rastreável, transparente e se convertendo em uma memória mais
  enriquecida na hora de salvar em rag."
- "Tudo dentro da janela do AI Viewer obedecendo a regra de cada aba a sua:
  no que eu clicar numa aba e mudar o conteúdo do editor que eu falo com a
  AI, imediatamente ao mesmo tempo também muda o micah's mind respectivo da
  janela aberta."
- "Seremos o primeiro no universo a construir algo assim e que todo mundo
  vai pirar desde que você não faça merda ou negligencie alguma etapa do
  pdi."
- Decisões registradas em conversa: multi-sessão confirmada (1 cena por vez,
  a da pane ativa, demais por abas); juiz do report em GLM ("nada de
  anthropic"); a caixinha de chat in-app NÃO é destruída; o painel AI Viewer
  É eliminado.

## Plano em etapas

Base: memórias 1/3, 2/3 e 3/3 do RAG (handle mindhorse) + levantamento do
sistema atual + código do mindwalk no santiago.

- E1 Parser e fold: funções puras TS em src/modules/micahs-mind/lib/ que
  leem o NDJSON da sessão (message.role, content[] thinking/tool_use/
  tool_result, toolUseResult.file.content) e dobram em eventos de trace
  {file, acao visto|lido|editado, ts, turno, subagente} com append
  incremental (não recarrega o mundo a cada chunk). Testes vitest com
  fixtures reais de ~/.claude/projects.
- E2 Citymap e integração: layout determinístico do repo (radial tree:
  mesma árvore = mesmo mapa) em TS puro; MicahsMindArea montada onde
  AiViewerArea vivia (App.tsx ~1738), consumindo claude_session_tail com o
  padrão de poll do useClaudeSessionFeed (700 ms / 60 ms catch-up), código
  do mind em chunk lazy (respeita eager-budget).
- E3 Cena Canvas 2D: renderer com glow por tipo de toque, pan por arraste,
  zoom por roda/pinça, label no hover/click, timeline com histograma
  cool/warm (observação vs mutação) e follow-the-tail ao vivo; marcadores de
  compactação de contexto, subagente e turno de usuário.
- E4 Sync por aba: leaf.resume/anchoredLeaves/visibleLeafIds decidem qual
  sessão alimenta a cena; troca imediata ao clicar em aba (critério 4).
- E5 Report: scripts/micahs-mind-report.mjs (Node puro + ssh): trace ->
  prompt de juiz adaptado do internal/judge do mindwalk -> `claude -p` ->
  chunk enriquecido -> oracle_add no oracle-rag; saída prova o id da
  memória.
- E6 Demolição e verificação: apagar exclusivos do viewer velho
  (src/modules/left-panel/AiViewerArea.tsx, SessionStreamView.tsx,
  ReadOnlyStream.tsx, lib/useClaudeSessionFeed.ts, lib/sessionStream.ts,
  lib/claudeSessionOps.ts, lib/aiViewerLanes.ts, lib/useAiViewerStore.ts,
  lib/activation.ts + testes correspondentes; conferir na hora a lista
  contra o código vivo e o knip). Manter compartilhados: mode.ts (id
  ai-viewer, label novo), LeftPanelSwitcher.tsx, useLeftPanel.ts,
  LeftPanelEmpty.tsx, agent_detect.rs, panes.ts, claude_session.rs (vira a
  fonte do streaming), claudeResumeBoot. AgentRunBridge (caixinha) fica
  vivo: publicação migra pra store própria sem tela. knip + lint +
  check-types + test + clippy + cargo test + build --no-bundle.

Cada etapa termina com agente auditor criterioso varrendo o checklist de
categorias (seção 3.1 do Quadro de Cards); achado corrige antes de seguir.

## Auditorias por etapa

(pendente: preenchida por etapa, com categoria e evidencia)

## Validacao independente

(pendente: veredito item por item do critério de aceite, com prova anexa)

## Rastro

(pendente: arquivos tocados, commits, leitura do ar)
