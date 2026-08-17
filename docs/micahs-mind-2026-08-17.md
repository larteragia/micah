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

> v2, revisado pelo auditor de plano (2026-08-17, veredito "aprovado com
> correcoes", 19 correcoes obrigatorias, TODAS aceitas; registro integral em
> *Auditorias por etapa*). Mudancas mais visiveis contra a v1: leitura da
> sessao INTEIRA (offset 0, nao so o tail), layout treemap squarified
> congelado por sessao (nao radial tree), compactacao por registro
> system/compact (a chave isCompactSummary nao existe em nenhum JSONL
> real), subagente marcado pela tool Task/Agent (sidecars da CLI 2.1.x fora
> do v1), juiz selado com env GLM pinado em duas passagens com rollup, e
> demolicao em commit proprio depois das provas.

- E1 Parser e fold (src/modules/micahs-mind/lib/, funcoes puras): parser do
  NDJSON aceitando message.content string OU array e tool_result.content
  string OU array de blocos {text|image|tool_reference}; filtro de
  mensagens injetadas (prefixo "# AGENTS.md instructions" e wrappers
  <...>) antes de criar mark de user turn; compactacao = registro system
  com subtype contendo "compact"; subagente = mark da tool_use Task/Agent;
  fold incremental por append com dedupe por tool_use id (o offset do tail
  pode regredir em arquivo reposto: sem idempotencia a sessao redobra e as
  metricas mentem); timestamps preservados em UTC ISO no trace, zona local
  so no render. Premissa fixada: transcripts no root default
  ~/.claude/projects. Testes vitest com fixtures reais (content string,
  tool_result array com tool_reference, system/compact, e registros a
  ignorar: last-prompt, mode, permission-mode, attachment,
  queue-operation, ai-title, file-history-snapshot).
- E2 Citymap e integracao: port do squarified-treemap-v1 do mindwalk
  (builder.go: peso por linhas/bytes, filhos ordenados por peso desc
  depois nome, deterministico); POLITICA ANTI-SALTO: arvore congelada no
  primeiro snapshot da sessao, arquivo tocado depois e ausente do snapshot
  vira ponto ghost, nenhum relayout de pontos existentes; fonte da arvore:
  comandos Rust de fs existentes (respeitando a autorizacao de workspace),
  excludes de junk dirs (node_modules, dist, build, vendor, target), teto
  10k arquivos com aviso de truncamento. MicahsMindArea montada onde
  AiViewerArea vivia (App.tsx ~1738), feed com PRIMEIRO poll a partir do
  offset 0 (historia completa; catch-up 256 KiB/60 ms), descarte de linha
  parcial so quando offset > 0; codigo do mind em chunk lazy (eager-budget
  verde por construcao: zero deps pesadas).
- E3 Cena Canvas 2D: sprites de glow pre-renderizados em canvas offscreen
  (um por tipo de toque: verde=visto/hit, azul=lido/read, ambar=editado/
  edit, escuro=nao visitado), culling por viewport, LOD (ponto sub-pixel no
  zoom out, label so no hover/click), rAF somente em frame sujo, DPR-aware;
  pan por arraste, zoom por roda/pinca; timeline com histograma cool/warm
  (observacao vs mutacao), follow-the-tail ao vivo; contextos 2d, pool
  WebGL intocado.
- E4 Sync por aba: regra de escolha da sessao: resolveLeafResume(activeLeafId
  da aba ativa) primeiro; fallback: unica leaf ancorada visivel; senao
  estado vazio explicito. Troca imediata (estado sincrono), cidade anterior
  mantida ate o primeiro chunk da nova sessao (sem flash vazio).
- E5 Report (scripts/micahs-mind-report.mjs, Node puro + ssh): juiz SELADO
  na CLI: claude -p --no-session-persistence --tools ""
  --strict-mcp-config --setting-sources "" --output-format json, workdir
  neutro, env PINADO para GLM (ANTHROPIC_BASE_URL z.ai + glm-5.3; chave por
  env/arquivo 600, nunca argv); DUAS passagens como no mindwalk (rubrica
  primeiro, scoring depois) com rollup mecanico dos verdictos e budgets de
  input (12 mensagens x 600 chars, 2000 eventos no narrativo); gravacao via
  ssh ubuntu@100.96.221.52 node CavaloMagico/scripts/cavalo-memory.mjs add
  summary --json, chunk condensado <= 2000 chars, tolerancia 2-4 min,
  politica de dedup no rerun; timestamp do report em ISO com offset -03:00.
  Atribuicao MIT do mindwalk (Ricko Yu) em LICENSES/ junto ao codigo portado
  (prompts, rubrica, treemap).
- E6 Demolicao e verificacao, NESTA ORDEM: (1) migrar store+lanes do
  aiViewer para src/modules/ai/lib/ (publicacao sem tela da caixinha),
  atualizando AgentRunBridge, barrel e App; (2) trocar AiViewerArea por
  MicahsMindArea com label "Micah's Mind" (assertion do mode.test.ts
  atualizada, id ai-viewer e coerce intactos); (3) provas dos criterios 1-5
  no ar; (4) SO ENTAO demolir os 9 arquivos exclusivos + testes exclusivos
  EM COMMIT PROPRIO (revert de um commit restaura o viewer); opt-in de
  ativacao MANTIDO com a mesma chave micah.aiViewer.active (sem chave
  orfa); knip + lint + check-types + test + clippy + cargo test + build
  --no-bundle.

Cada etapa termina com agente auditor criterioso varrendo o checklist de
categorias (seção 3.1 do Quadro de Cards); achado corrige antes de seguir.

## Auditorias por etapa

### Auditoria do plano (etapa 4 do protocolo) — auditor GLM, 2026-08-17

**Veredito: aprovado com correcoes.** 19 correcoes obrigatorias, todas com
evidencia; 11 suspeitas investigadas e derrubadas (nao regastar); arquitetura
central (Canvas 2D por LEI ZERO, base herdada do feed, id ai-viewer
preservado, AgentRunBridge vivo, multi-sessao por aba) CONFIRMADA. Leu: card,
memorium, 21 arquivos do left-panel, claude_session.rs, integracao no
App.tsx, eager-budget.test.ts, 60+ JSONL reais de ~/.claude/projects e o
fonte do mindwalk no santiago (adapter, citymap, judge, store, oracle-rag).

| # | Categoria | Etapa | Achado | Evidencia | Correcao aplicada |
|---|-----------|-------|--------|-----------|-------------------|
| 1 | Volume | E1/E2 | Herdar o feed verbatim trunca: primeiro poll comeca em len - 256 KiB (FIRST_POLL_BACK) e a cidade/juiz precisam do trace inteiro | claude_session.rs:17,89; useClaudeSessionFeed.ts:88; sessao real de 301 KB+ | primeiro poll do offset 0, catch-up 256 KiB/60 ms; descarte de linha parcial so com offset > 0 |
| 2 | Entrada vazia ou suja | E1 | message.content chega STRING em user real; tool_result.content string OU array com blocos text/image/tool_reference | JSONL real + adapter.go (caso data[0] == '"') | parser aceita os dois shapes; fixture com ambos |
| 3 | Entrada vazia ou suja | E1 | task-notification e prefixo AGENTS.md virariam turno de usuario falso | registros <task-notification> reais; adapter.go:169-175 | portar o filtro InjectedUserMessage antes de criar marks |
| 4 | Regressao | E1 | isCompactSummary: ZERO registros em ~60 sessoes; mindwalk detecta por system + subtype compact | scan node (0 registros); adapter.go | regra trocada para system/compact; fixture |
| 5 | Regressao | E1/E3 | subagentes NAO estao no JSONL principal (0 isSidechain); vivem em <parent>/subagents/agent-*.jsonl fora do alcance do tail atual | ls real do sidecar; claude_session.rs:43-52,120 | v1 marca subagente pela tool Task/Agent; sidecar fora do escopo, anotado como futuro |
| 6 | Regressao | E2 | layout do mindwalk e squarified-treemap-v1, NAO radial tree | builder.go:262 | card corrigido: port do treemap |
| 7 | Estado e persistencia | E2/E3 | arquivo novo no meio da sessao re-quadrilha o rect pai inteiro: a cidade pula sob a camera; mindwalk usa ghosts + Truncated | builder.go:113-160, model.go | arvore congelada por sessao, novos viram ghost, sem relayout |
| 8 | Autorizacao | E2 | fonte da arvore nao nomeada; TS nao varre FS por arquitetura; mindwalk usa git ls-files com excludes e teto 10k | builder.go:32-58; fs_list_files/fs_glob existem gated | usar comandos Rust existentes, excludes de junk, teto 10k + aviso |
| 9 | Volume | E3 | shadowBlur em ~10k pontos nao sustenta 60 fps | teto 10k do proprio mindwalk (cena degrada) | sprites pre-renderizados + culling + LOD + rAF sujo + DPR-aware |
| 10 | Concorrencia | E4 | visibleLeafIds e o CONJUNTO de panes: com 2+ ancoradas, sessao da cena indefinida; o sinal do focado existe (activeTerminalTab.activeLeafId) | App.tsx:1008-1011 vs :218 | regra: leaf focada primeiro, fallback unica ancorada visivel, senao vazio; cidade anterior mantida ate o primeiro chunk |
| 11 | Segredo em claro + Falha externa | E5 | juiz sem selo roda tools e cria JSONL novo que o proprio Mind taila (loop); sem env pinado o claude do laptop resolve ANTHROPIC | cli.go:73-121 (selos do mindwalk); caixinha caiu no Opus ao vivo | selos completos + workdir neutro + env GLM pinado, chave por env/arquivo 600 |
| 12 | Falha externa + Limite de taxa | E5 | gravacao no RAG e custos indefinidos: cavalo-memory demora ~109 s no embed, add dedupa a 0.97, contrato limita content ~2000 chars | cavalo-memory.mjs:126-135; oracle-rag-server.mjs | chunk <= 2000 chars, tolerancia 2-4 min, --json, politica de rerun |
| 13 | Regressao | E5 | juiz do mindwalk e DUAS passagens + rollup MECANICO (verdictos derivados das severidades), com budgets de input | prompt.go, judge.go:303-330, input.go:15-25 | portar as duas passagens + rollup + budgets |
| 14 | Regressao | E6 | demolicao quebra alem da lista: mode.test.ts:22 trava label "Ai Viewer"; index.ts:1 exporta AiViewerArea; AgentRunBridge importa useAiViewerStore | grep de consumidores | ordem: migrar store -> trocar area -> deletar -> verde, tudo no mesmo ciclo |
| 15 | Estado e persistencia | E1 | arquivo encolhido/reposto faz o tail voltar a 0 e o feed nunca reseta o fold: sessao redobrada por cima | claude_session.rs:85-89 + feed reset so por sessionId | fold idempotente (dedupe por tool_use id) |
| 16 | Rollback | E6 | demolicao sem plano de revert | padrao das rondas anteriores | demolicao em commit proprio DEPOIS das provas 1-5 |
| 17 | Estado e persistencia | E3/E6 | activation.ts (opt-in "Ativar", chave micah.aiViewer.active) deletado deixaria chave orfa e gate implicito | activation.ts:1-37 | opt-in MANTIDO com a mesma chave (decisao registrada) |
| 18 | Timezone e data | E3/E5 | ts do JSONL e UTC ISO; projeto opera em -03:00 | primeiro registro do 9130ec62 | UI renderiza local (Intl); report em ISO com offset |
| 19 | Autorizacao | E1/E5 | atribuicao MIT sem destino: rubrica/prompts/treemap sao copiados do mindwalk (MIT, Ricko Yu) | LICENSE no repo do mindwalk, HEAD 77cd795 | nota + texto MIT em LICENSES/ junto ao portado |

**Suspeitas investigadas e DERRUBADAS** (registrar para nao regastar): three
ja estaria no bundle (nao: package.json lido inteiro); eager-budget pegaria
three (nao: HEAVY list e fixa, o grep do criterio 1 e que trava); encoding na
borda de chunk (ja resolvido no Rust, take_utf8 com teste); lista de demolicao
errada (esta certa: consumidores mapeados, so AgentRunBridge fora); label
quebraria coerce (nao: mode.test.ts:38 ja trava id); polling vaza ao fechar
painel (nao: area desmonta e efeito limpa timer); knip nao cobre script novo
(cobre: entry scripts/*.mjs); ferramentas de prova inexistentes (existem:
window-shot.ps1, browser_build_id/MICAH_BUILD_ID); latencia do criterio 3
(poll 700 ms + catch-up 60 ms cabe nos 3 s); CLAUDE_CONFIG_DIR escondendo
transcripts no laptop (nao: wrapper e do santiago); encoding de acento no
stream IPC (nao se aplica: leitura por offset com corte UTF-8, nao PTY).

### Auditoria da implementacao de E1 (auditor GLM independente) — 2026-08-17

**Veredito: aprovada com correcoes.** 11 achados (5 a corrigir, 6 a
registrar), todos com experimento reproduzivel; 11 suspeitas derrubadas com
prova (nao regastar). O auditor rodou vitest (30/30), check-types e biome por
conta propria, e comparou linha a linha com o Go do mindwalk. Experimentos
em %TEMP%/micah-audit/ (exp1-exp9), fora do repo.

Correcoes APLICADAS no commit seguinte:

| # | Categoria | Achado | Evidencia | Correcao aplicada |
|---|-----------|--------|-----------|-------------------|
| 1 | Estado | marks nao eram idempotentes na re-entrega: refold do transcript vivo dobrou userTurns 14->28 e subagents 2->4 | exp1 | dedupe de marks por hash de linha em FoldInternals.seenLines (limpo no reset); mark de subagente so quando o evento e novo |
| 2 | Estado | tool_result re-entregue sem o tool_use (pending consumido no settle) reclassificava com input vazio: Bash verify->exec, Read perdia target | exp2 | skip quando existing.settled && !call; input persistido no FoldedEvent e reusado no fallback |
| 3 | Concorrencia | WeakMap de internals nao viajava em copias ({...fold} / structuredClone): byId recriado VAZIO e a linha re-dobrada duplicava evento | exp3 | internsOf semeia byId a partir de fold.events quando o mapa vem vazio |
| 4 | Regressao | verifyCommand estendido alem do port grafa biome check --write (que MUTA arquivos) como verify e zera editsAfterLastVerify | exp8: 9/9 verify da sessao viva eram biome check, Go grafa exec | flags de mutacao (--write/--fix/--unsafe/-w) excluem o grading verify; divergencia do port REGISTRADA aqui (token-grading de pnpm/npm/yarn/bun/cargo/go fica, motivado por "pnpm -C . test" real) |
| 5 | Entrada suja | weakExists retornava true sem predicado (Go sempre stat'a): 38 de 82 paths tocados nao existiam ("1.0", "ubuntu@100.96...") | exp6 | doc corrigida (lib pura, predicado opcional); TouchedInfo ganha campo weak; feed E2 passa exists a partir do scan completo |
| 11 | Estado (teste) | hand count do realSession.test era circular (importava helpers do modulo sob teste) e a idempotencia nao assertionava marks | leitura + exp1 | contagem crua inline (raw*) + idempotencia assertiona events, marks, userTurns, subagents, compactions |

Registradas (sem correcao, decisao documentada):

| # | Categoria | Registro |
|---|-----------|----------|
| 6 | Regressao | resultBytes conta unidades UTF-16 (result.length) vs Go bytes UTF-8: -0,7% na sessao viva; se E5 usar o campo em budgets, converter com TextEncoder |
| 7 | Regressao | seq fixado no tool_use (streaming, criterio 3) vs mindwalk settle+reindex: eventsBeforeFirstEdit pode diferir do prefixo nao-settled; comentario do modulo reescrito |
| 8 | Regressao | Glob/LS/find/ls anexam hit.lines (Go passa nil): sem consumidor em metricas; E2 nao le lines |
| 9 | Segredo em claro | summary embute 96 chars do command e notes 2000 runes: E5 deve redacionar na fronteira do juiz/RAG (implementado no script) |
| 10 | Encoding | BOM no primeiro registro seria ignorado silencioso: parseSessionLine agora strippa ﻿ (defesa barata; 0/326 arquivos reais tem BOM) |

**Suspeitas do auditor E1 derrubadas** (nao regastar): user text+tool_result
misto faria texto sumir (0 ocorrencias em 326 arquivos reais com text ANTES
do tool_result; TS == Go em 100% do acervo); tool_use sem id / is_error em
tool_use / itens nao-objeto (0 ocorrencias); content array com image (318
ocorrencias, tratado igual ao Go); truncateRunes quebra surrogates (nao:
code points, well-formed); custo quadratico fere criterio 3 (nao: 10k eventos
= 24 folds/203 ms total, pior fold 14 ms; 5k polls = media 2 ms);
compactacao nunca detectada (0 registros system/compact E 0 summary em 326
arquivos: compactions=0 e fiel); server_tool_use/fallback blocks (ignorados
sem crash, mesma politica Go); BOM em arquivo real (0/326); barrel/testes/
commit mentem (23 testes verdes como commitado, tsc/biome limpos).

## Validacao independente

(pendente: veredito item por item do critério de aceite, com prova anexa)

## Rastro

(pendente: arquivos tocados, commits, leitura do ar)
