# Mindwalk real dentro do Micah's Mind (sidecar + webview, win/linux/mac)

- **Data**: 2026-08-19
- **Autor do card**: Rodrigo (comandante), via chat de 19/08
- **Coluna**: Fazendo

## Descricao

O painel Micah's Mind hoje é um renderer caseiro Canvas 2D que porta os CONCEITOS
do mindwalk mas não a cara nem o comportamento. Veredito do comandante (19/08):
a diferença entre a referência (mindwalk) e o estado atual "é absurda", "não
funciona at all", "parece um mock fake, carregado e errado", e
**https://github.com/cosmtrek/mindwalk é o repositório que deveria estar dentro
dessa janela**. Ordem adicional: "tem que funcionar em windows, linux e mac".

Decisão (levantamento 19/08, provas abaixo): apagar a camada visual caseira
(~3.6k LOC, 79% do módulo) e embutir o mindwalk REAL — binário Go servindo a
própria UI React/Three.js — como sidecar Tauri, mostrado num webview filho no
painel esquerdo. O plumbing de sessão do micah (âncora OSC 777, pick da pane em
foco, auto-connect, seletor) permanece e vira o "controle remoto" que diz ao
mindwalk qual sessão abrir.

### Levantamento que sustenta a decisão (todas as provas colhidas em 19/08)

**Empírico, nesta máquina (release oficial v0.5.0 windows_amd64):**
- `mindwalk.exe serve --port 4517 --no-open --claude-dir ~/.claude-micah/projects`
  listou as 41 sessões reais do micah e renderizou a sessão do executor GLM
  (RAG 108646, 1016 calls, 44 turns, 4 subagents) com o visual exato da
  referência — screenshot em `docs/proof/mindwalk-real-no-micahs-mind/00-poc-ui-real.png`.
- Deep-link `/?session=<uuid>` funciona (fallback por id no client; a API aceita
  Key, ID ou basename — server.go:939-963).
- **Custo medido da varredura**: sessão com cwd=HOME → primeiro `/trace` =
  225s (walk de C:\Users\Zigfriad, "9990 files partial map"); cache quente = 6ms;
  SEGUNDA sessão do MESMO cwd = 200s de novo (walk não é compartilhado);
  sessão com cwd=C:\ → >60s (drive inteiro). Sessão com cwd=repo micah: 0.4s.
- **Custo do crescimento**: fingerprint muda → `loadSnapshot` re-executa
  INTEIRO, e `loadTraceAndMap` chama `buildCityMap(repoRoot, trace)` direto
  (server.go:877-883) sem cache de walk (o cache `repoMaps` serve só
  /api/repomap, server.go:439-445; tracestore.go:66-127 confirma). Ou seja:
  **sessão viva em HOME re-paga ~200s a cada refresh** — inviável sem patch.
  41 de 41 sessões reais do micah têm cwd HOME ou C:\ — é O caso comum.

**Da tag v0.5.0 (fonte lida arquivo:linha):**
- `serve` tem `--port` (0=aleatória; imprime `mindwalk serving http://127.0.0.1:PORT`
  no stdout — server.go:149,166), `--no-open`, `--claude-dir` (flag.String,
  ÚNICO, last-wins — main.go:53-65). Multi-root não existe.
- `requireLoopback`: Host ∈ {127.0.0.1, localhost, ::1} sempre; Origin/Sec-Fetch-Site
  só em não-GET (server.go:189-230). Navegação top-level GET de webview passa.
- Playhead nasce no FIM do trace (store.ts:60); refresh do rail (`scan(true)`)
  preserva playhead; reload da página não. Sem auto-play, sem SSE — polling
  `/api/sessions?fresh=1` (TTL 5s, re-sumariza só arquivos com size/mtime novos).
- Releases oficiais: win amd64/arm64 (zip), darwin amd64/arm64, linux amd64/arm64
  (tar.gz) + checksums.txt. Exe Windows é CONSOLE (PE Subsystem 3; goreleaser
  sem -H windowsgui) → spawn precisa de CREATE_NO_WINDOW.
- Licença MIT (Ricko Yu, 2026) — fork e redistribuição permitidos com aviso.
  `LICENSES/mindwalk.txt` já existe no micah (o port atual já credita).

**Do repo micah:**
- Precedente de sidecar COMPLETO já em produção: `bundle.externalBin =
  ["binaries/micah-cli"]` (tauri.conf.json:37), binário com sufixo triple em
  src-tauri/binaries/, resolução manual via `current_exe().parent()` com
  fallback dev `TAURI_ENV_TARGET_TRIPLE` (control.rs:654-678), tolerância a
  sidecar ausente em dev (build.rs:43-73 configure_sidecar), cópia dev provada
  (target/debug/micah-cli.exe sem sufixo).
- Webview filho já em produção (browser panel): add_child atrás da feature
  `browser-panel = ["tauri/unstable"]`; singleton é ESTADO do painel browser,
  não limite de plataforma (mod.rs:117-120, panel.rs:145-164); um segundo
  webview com label próprio, sem additional_browser_args e sem data_directory
  próprio, usa o environment default — zero conflito (a trava WebView2 é só
  para environments com args DIFERENTES na MESMA user-data folder).
  Padrões a replicar: measure/rAF/zoom-calib (useBrowserPanel.ts:122-138,
  bounds.ts:44-90), suppression ref-counted com overlays via MutationObserver
  (suppression.ts, OVERLAY_SELECTORS), esconder-nunca-zerar (panel.rs:349-351),
  attach async (add_child posta na main thread — comando síncrono deadlocka,
  panel.rs:121-123), label FORA de qualquer capability (regra do "browser").
- Cadeia da sessão ativa (fica intacta): OSC 777 → AgentNotificationsBridge →
  setLeafResume → pickMindSession (foco > única âncora > ambíguo) → composePick
  (âncora > manual > auto) → `pick.session` = uuid lowercase = o `?session=` da URL.
- Deleção sem dependente externo: nenhum import de MindCanvas/citymap/foldTrace/
  classify/parseSession/trace fora do módulo; morrem 32-38 testes (suite 863 →
  825-831); Rust zero impacto; App.tsx só importa o barrel.
- CI: ci.yml com jobs frontend (ubuntu) + rust (ubuntu) + rust-platforms
  (matrix windows-latest/macos-latest); release.yml com matrix 4 targets via
  tauri-action passando MICAH_CLI_TARGET — o sidecar novo precisa entrar nos
  dois fluxos. Remoto: github.com/larteragia/micah. `gh` CLI NÃO instalado.
- Toolchain local: go1.26.5, node v25.8.1, pnpm 10.34.5 — build do fork local OK.
- Árvore atual: main ahead 45 de origin; 3 arquivos sujos de outra frente
  (scroll-area.tsx, globals.css, terminalTheme.ts) — NÃO tocar, NÃO commitar.

## Criterio de aceite

1. **UI real**: o painel Micah's Mind (modo ai-viewer) mostra a UI do mindwalk
   de verdade (rail de sessões + mapa noturno + timeline/playback) dentro da
   janela do Micah — prova: screenshot da janela real do app.
2. **Sessão certa**: com `claude` rodando numa pane e âncora OSC 777 viva, o
   painel abre exatamente a sessão da âncora (id visível na UI = id da âncora)
   — prova: screenshot + ids lado a lado.
3. **HOME não trava**: com sessão de cwd=HOME, o refresh após crescimento do
   transcript responde em <3s (a primeira varredura de um root pode pagar o
   walk uma vez) — prova: medições curl antes/depois de append em sessão
   sintética (transcripts reais são intocáveis).
4. **3 sistemas**: binários do mindwalk (fork) por target-triple para
   windows x64, macos arm64+x64 e linux x64 gerados/baixados no build; jobs de
   CI (frontend+rust em ubuntu, rust-platforms em windows+macos) VERDES no
   commit do card — prova: URL da run do Actions com conclusão success.
5. **Renderer caseiro morto**: MindCanvas.tsx, citymap.ts, foldTrace.ts,
   classify.ts, parseSession.ts, trace.ts e testes deles deletados;
   `pnpm lint && pnpm check-types && pnpm test` verdes;
   `cargo clippy --all-targets --locked -- -D warnings` e `cargo test --locked`
   verdes; `cargo check --no-default-features` verde (rollback proof).
6. **Sem órfão**: fechar o Micah mata o processo mindwalk — prova: lista de
   processos antes/depois do exit.
7. **LEI ZERO registrada**: binário Go embarcado é runtime novo; a exceção fica
   registrada neste card e no memorium com a ordem literal do comandante
   (19/08): "esse é o repositório que deveria estar dentro dessa janela" +
   "tem que funcionar em windows, linux e mac".

## Comentarios humanos (o alvo)

- "O estado atual parece um mock fake, carregado e errado. Quando deveria
  carregar apenas o que a AI está fazendo." (19/08)
- "https://github.com/cosmtrek/mindwalk esse é o repositório que deveria estar
  dentro dessa janela." (19/08)
- "tem que funcionar em windows, linux e mac" (19/08)
- Feedback anterior que continua valendo (micahmind.md): o mapa deve refletir
  o que a sessão toca, nascer enquadrado, e a cidade não pode "nascer fora da
  janela" — o mindwalk real já resolve enquadramento e visual; o que carrega
  é a sessão apontada pela âncora da pane.

## Plano em etapas

**Arquitetura em uma linha**: fork cirúrgico do mindwalk v0.5.0 (2 patches de
servidor, UI intocada) embarcado como segundo sidecar Tauri no padrão
micah-cli, servindo em 127.0.0.1:porta-livre, mostrado num webview filho novo
(label "mind") posicionado pelo MicahsMindArea, que continua dono do gate, do
seletor e da âncora e navega o webview para `/?session=<pick.session>`.

- **E0 — Fork mínimo do mindwalk** (`patches/` + `scripts/build-mindwalk.mjs`):
  clone raso pinado na tag v0.5.0 (sha do commit pinado no script) + 2 patches:
  (P1) cache de varredura por repoRoot no caminho `loadTraceAndMap` — o walk
  roda uma vez por root (TTL longo), rebuilds por crescimento só re-parseiam o
  JSONL e re-projetam o trace na cidade cacheada; (P2) `--claude-dir` aceitável
  múltiplas vezes (multi-root: ~/.claude/projects + ~/.claude-micah/projects;
  junction só existe no Windows e symlink não é seguido pelo WalkDir no unix —
  multi-root de verdade exige flag). Testes Go para os dois patches. Build
  local windows-amd64 + medição de prova do critério 3. Patches como arquivos
  `.patch` versionados no micah; upstream PR fica a critério do comandante.
- **E1 — Sidecar no build**: `binaries/mindwalk` no externalBin;
  build-mindwalk.mjs produz `src-tauri/binaries/mindwalk-<triple>[.exe]`
  (host triple por `rustc -vV`); build.rs estendido no padrão configure_sidecar
  (dev sem binário não quebra; release exige); LICENSES/mindwalk.txt
  re-escopado (binário inteiro, não só o port); ci.yml + release.yml ganham o
  passo setup-go + build do fork por target (matrix release: 4 targets).
- **E2 — Módulo Rust `mind` (sidecar lifecycle)**: spawn no padrão control.rs
  (resolução current_exe/dev-fallback, CREATE_NO_WINDOW no Windows, porta via
  pick_free_port, `--no-open`, dois `--claude-dir` com os MESMOS roots que
  claude_session.rs:115-124 usa), parse da linha `mindwalk serving`, kill em
  RunEvent::Exit/ExitRequested (shared_child já é dep), restart se o processo
  morrer; comando `mind_status`; pré-aquecimento: ao trocar a sessão apontada,
  GET `/api/sessions/<id>/trace` em background (walk acontece antes de o
  usuário abrir o painel).
- **E3 — Webview filho `mind`**: comandos mind_attach/mind_set_bounds/
  mind_set_visible/mind_navigate espelhando panel.rs (async, claim-early,
  esconder-nunca-zerar, on_navigation restrito a `http://127.0.0.1:<porta>`,
  label fora das capabilities, sem data_directory próprio); mesma feature
  `browser-panel` + stubs para `--no-default-features`.
- **E4 — Frontend**: MicahsMindArea troca `<MindCanvas>` por host div medido
  (clone do padrão useBrowserPanel: getBoundingClientRect + zoom-calib + rAF +
  ResizeObserver + suppression por overlays e por modo); mantém gate Ativar,
  auto-connect, seletor manual e badges; monta a URL com `pick.session`;
  estados visíveis: sidecar subindo / varredura em andamento (pré-aquecimento
  com progresso) / sessão ausente (webview escondido, aviso âmbar por cima).
- **E5 — Deleção do renderer caseiro**: os 6 arquivos + testes deletados,
  useMindFeed encolhido a pickMindSession/composePick/absentStatus (+ testes
  que sobrevivem), suites completas verdes, knip limpo.
- **E6 — Live-nudge**: initialization_script no webview mind: poll de
  `/api/sessions?fresh=1` (5-10s) comparando eventCount da sessão corrente;
  mudou → aciona o refresh do rail (scan(true), preserva playhead). Se o
  acionamento programático se provar frágil, degradar com registro: refresh
  fica no botão da própria UI (que já preserva playhead) e o poll vira só
  badge "sessão cresceu".
- **E7 — Validação independente**: build release, relançar micah.exe, abrir
  frio, ativar painel, rodar `claude` numa pane real, conferir critérios 1-7
  item a item com prova anexa (screenshots pelo kit scripts/window-shot,
  medições curl, processos antes/depois, URL do Actions), registrar no
  memorium com bloco prova e avisar o comandante no WhatsApp (Cavalo Manutenção).

**Fora de escopo (registrado para o próximo card)**: SSE/live-follow de
verdade no fork (hoje: nudge por poll), lente automática de subagente,
persistência do walk em disco entre execuções, `mindwalk analyze` (judge) —
o judge do mindwalk chama CLI local e no micah a CLI é selada em GLM, decisão
de habilitar é do comandante.

## Auditorias por etapa

### Auditoria do PLANO (agente auditor independente, 19/08 ~15h40)

Veredito: **aprovar com correções obrigatórias** — todas aceitas e incorporadas:

1. **[Volume/Concorrência] P1 redesenhado**: cache "por repoRoot" era chave
   errada — em workspace mode (HOME) o `touched` da sessão SEMEIA os scan
   roots (builder.go:298-315,414-422) e o custo inclui `inspectFile` lendo
   10k arquivos (countLines). Correção: dividir em `Scan(root, touched
   seeds) → ScanResult` (cacheável, chave = absRoot + fingerprint dos seeds;
   degenera pra root puro quando há marker/git) e `Compose(root, ScanResult,
   trace) → CityMap` (por sessão, copia os CityFile antes de mutar ID/layout);
   singleflight próprio no padrão inflight do tracestore (NUNCA o repoMapMu,
   que segura lock durante o build inteiro); tier-1 re-inspeciona só os
   tocados; wrapper preserva a assinatura `buildCityMap func(string,
   *model.Trace)` para os testes upstream.
2. **[Entrada suja] P2 com dedupe**: dirs normalizados (Abs+EvalSymlinks) e
   dedupados antes de criar um adapter por dir — sem isso, dir duplicado gera
   duas Keys pro mesmo ID e `findSession` vira "ambiguous" → fallback
   silencioso pra sessão errada (server.go:949-961, App.tsx:259-267).
3. **[Concorrência] Porta**: nada de pick_free_port (TOCTOU) — porta
   preferida 4517 (estabiliza o localStorage do fork) com fallback `--port 0`
   e parse do stdout (`mindwalk serving http://127.0.0.1:PORT`); o filtro
   on_navigation lê a porta de estado compartilhado (muda no restart).
4. **[Falha externa] Supervisão com teto**: thread `shared_child.wait()`
   observa; restart com backoff exponencial e teto (5), depois estado "dead"
   com retry manual; Job Object KILL_ON_JOB_CLOSE no Windows (windows-sys já
   tem Win32_System_JobObjects) — morte suja do micah não deixa órfão (dois
   mindwalk.exe órfãos do próprio levantamento provam o risco).
5. **[Regressão] E6 estava funcionalmente ERRADO**: `?fresh=1` em loop mata o
   cache de agentGraphs (server.go:525-528), e o refresh do rail RESTAURA o
   playhead salvo (App.tsx:195-200,285-287) — o palco ficaria congelado no
   evento antigo, o exato sintoma reprovado. Correção: **patch P3 no fork**
   (`?follow=1` em web/src/App.tsx: setInterval no refresh() existente +
   stick-to-tail quando o playhead estava no fim). UI tocada ⇒ build do fork
   passa a exigir npm + embed-static (setup-node já existe nos workflows).
6. **[Regressão] build.rs por subset**: configure_sidecar hoje ZERA o
   externalBin inteiro quando falta um sidecar em dev (build.rs:68) — com
   dois sidecars, gravar só o subset presente; release continua panicando.
7. **[Entrada vazia] Handshake de navegação**: sessão recém-nascida pode não
   estar no scan (TTL 5s) e o client cai pra "latest" em silêncio — navegar
   só depois do pré-aquecimento confirmar GET /trace 200 (retry em 404);
   estado "aguardando a sessão aparecer" enquanto isso.
8. **[Estado] Trava do build**: E7 passo zero = fechar micah.exe (rodando
   agora, build falha com exe em uso — memorium) e matar os mindwalk de teste
   antes das provas dos critérios 3 e 6.
9. **[Autorização/honestidade] Critério 4 re-escopado**: CI verde prova
   COMPILA + binários existem — o runtime (add_child, spawn) nunca executa
   fora do Windows em prova alguma; registrado com todas as letras. Push:
   main está 45 ahead e o protocolo proíbe perguntar → decisão registrada:
   NÃO tocar main; branch de card `card/mindwalk-real` com gatilho de CI
   adicionado no próprio branch, precedida de varredura de segredos nos 45
   commits (categoria Segredo em claro); publicação de main continua decisão
   do comandante.

Recomendações aceitas: porta preferida (↑3), `go test ./...` do fork no CI,
clone cacheado/offline no build script, spinner honesto sem porcentagem
(GET /trace bloqueia até o fim, não há API de progresso), window.open do
"repository map" documentado como esquisitice aceita, validação de uuid antes
de montar URL. Lacunas apontadas e resolvidas no escopo: paneAnchor encolhe
para identidade/histórico (freeze de cidade morre com a cidade);
scripts/micahs-mind-report.mjs tem parser próprio e fica como está (nota).
Risco de instrumento antecipado: validar captura de screenshot do child
webview (PrintWindow pode pintar preto) já no E3, não descobrir no E7.

### E0 — Fork do mindwalk (FEITO, auditado, correções aplicadas)

Implementação: 3 agentes paralelos (P1/P2/P3) + integração; fontes no clone
pinado (tag v0.5.0, sha 68aeda6). Entrega em
`scripts/mindwalk/patches/mindwalk-micah.patch` (8 arquivos: cache.go novo +
builder.go split Scan/Compose + cache_test.go; main.go dirList + main_test;
server.go ClaudeDirs/dedupe + multiroot_test; web/src/App.tsx follow).

Provas empíricas (nesta máquina):
- Critério 3 PROVADO: sessão sintética cwd=HOME, primeiro /trace = 244s
  (walk única), append + /trace = **0,18s** (antes: ~200-225s por refresh).
- Follow ao vivo: append de evento em diretório NOVO → playhead avançou
  sozinho 21/21→22/22 em ≤10s, ghost correto, sem stall (screenshots
  01/02 em docs/proof/mindwalk-real-no-micahs-mind/).
- Multi-root: 2 sintéticas (scratch) + 31 reais (~/.claude-micah) + 10 codex
  listadas juntas; deep-link por UUID resolve.
- Corrida do primeiro scan REPRODUZIDA (?session consumido com lista vazia →
  fallback silencioso pra outra sessão) — confirma a correção 7 do plano
  (handshake no app é obrigatório).

Auditoria de etapa (agente independente): **aprovada com correções** —
achados A1-A8; A1 (rebanho: walks concorrentes ilimitados por seed novo →
gate `revalidating` por root), A2 (freeze de minutos a cada 15min quando o
TTL da própria chave vencia → janela de graça soft/hard TTL 15/30min com
stale-while-revalidate), A3 (falha de rescan em background era muda →
log.Printf no finalize), A6 (dirs aninhados duplicavam sessões no rail →
underDir mantém o mais raso), A7 (testes podiam vazar goroutine lendo vars
de pacote pós-cleanup → drainFlights + sync.Once no gate) APLICADOS com
testes novos (TestOneBackgroundRevalidationPerRoot,
TestExpiredEntryServesStaleWithinGrace, TestNestedClaudeDirsKeepTheShallowest).
Registrados como conhecidos/backlog: A4 (tick do follow reseta seleção/lens
— mesmo comportamento do botão de refresh manual; decisão de produto), A5
(agent-trace vs rootCity de gerações diferentes — pré-existente do upstream),
A8 (lastByRoot cresce ~1 entry/root; rootKey sem casefold no Windows =
entry duplicada inofensiva). Vereditos por categoria no relatório do auditor
(rastro da sessão). Suites: go vet limpo; go test = só as 3 falhas
ambientais pré-existentes do Windows (symlink privilege + semântica unix),
inalteradas; `-race` indisponível nesta máquina (sem cgo) — CI linux cobre.

### E2+E3 — Módulo Rust `mind` (FEITO, auditado, correções aplicadas)

Novo src-tauri/src/modules/mind/{mod.rs,live.rs,stub.rs}: 9 comandos
(mind_status/ensure/prewarm/wait_session/attach/navigate/set_bounds/
set_visible/detach), sidecar no padrão find_bundled_cli com CREATE_NO_WINDOW
+ Job Object (reusa proc::job::ProcessJob — zero dependência nova), porta
4517→fallback 0 com parse do stdout real, dois --claude-dir vindos de
transcript_roots (mesma fonte de HOME do resto do app), supervisão com
backoff 1-16s teto 5 sem reset na tenure, kill em ExitRequested+Exit,
webview filho label "mind" (fora das capabilities, on_navigation lê a porta
de Arc, sem data_directory), detach preserva o sidecar (cache é o ativo
caro). 9 testes unitários (parse, filtro de URL incl. truque de userinfo,
backoff, args, serde).

Auditoria de etapa: **aprovada com correções** — medo do removeUnusedCommands
REFUTADO com fonte (poda só com app-ACL manifest, que o micah não tem);
correções aplicadas: A1 restart preservava só a raiz → agora troca SÓ a
porta na URL corrente (mantém ?session) E emite `micah:mind-restarted`
(ouvinte no frontend); A2 wait_session devolvia false imediato em
refused/5xx (hot-loop no caller) → retry com sono até o budget, porta 0 vira
Err; A3 latch de shutdown eterno se um prevent_exit futuro entrar → ensure
re-arma o flag e claim raceado nunca fica em Starting; A4 órfão em unix →
PR_SET_PDEATHSIG no Linux (libc já era dep); **macOS fica sem backstop de
morte suja — limitação registrada** (kill nos dois RunEvents cobre saída
limpa); A5 drenagem de pipe parava no 1º erro de UTF-8 → continue. Nits
registrados (detach sem checagem de dono = paridade com browser; client
reqwest por chamada; restarts cumulativo). Pós-correções: cargo check +
clippy -D warnings + no-default-features + test — todos verdes (1 ambiental
pré-documentada).

### E4 — Frontend (FEITO, auditoria em curso)

useMindView.ts novo (máquina off→sidecar-starting→session-waiting→ready +
dead/absent; funções puras testadas normalizeMindSession/mindUrl/
deriveMindPhase), MicahsMindArea reescrita (gate/auto-connect/seletor/badges
intactos; badges movidos pra header fora do retângulo do webview; spinner
honesto com segundos; estado dead com Religar), reuso por import de
bounds.ts e suppressionReducer do browser, handshake da correção 7
implementado (navega só após wait_session true), ?follow=1 na URL (E6
resolvido pelo P3 do fork — zero polling no app). 12 testes novos; suite
877/877 verde com `pnpm test` cru após exclude de src-tauri/** no vitest
(o clone do fork em src-tauri/target vazava spec Playwright pro glob).

### E1 — Sidecar no build (FEITO)

- `scripts/mindwalk/build-mindwalk.mjs`: clone pinado com verificação de sha,
  patch idempotente (reset+clean+apply), npm ci/build + embed-static, go
  build CGO_ENABLED=0 por triple (mapa Rust→GOOS/GOARCH), stamp sha+hash do
  patch (skip offline), --force/--test. Provado: host (windows x64) e
  cross-compile linux x64 (ELF válido) desta máquina; patch aplica limpo em
  clone pristine.
- tauri.conf.json: `binaries/mindwalk` no externalBin; beforeBuildCommand
  ganhou `pnpm build:mindwalk`; package.json script novo.
- build.rs: configure_sidecar por SUBSET (correção 6 do plano) — dev sem um
  sidecar não apaga o outro; release panica nomeando qual falta e o comando.
  `cargo check --all-targets --locked` verde após a mudança.
- LICENSES/mindwalk.txt re-escopado (binário embarcado + rubrica do report;
  port antigo registrado como removido).
- CI: job `mindwalk` novo em ci.yml (ubuntu: build+test linux x64 e
  cross-compile win x64/mac arm64/mac x64, artifacts de prova); release.yml
  ganhou setup-go (beforeBuildCommand builda o sidecar em cada leg).

## Validacao independente

(preenchido ao final)

## Rastro

- Levantamento: workflows `wf_75c95c88-e8e` e `wf_d8b79dbc-24b` (sessão Claude
  Code de 19/08), medições curl nesta máquina, fontes v0.5.0 lidas arquivo:linha.
- Prova de conceito: mindwalk v0.5.0 oficial rodando contra
  ~/.claude-micah/projects nesta máquina, screenshot da UI com a sessão RAG
  108646 renderizada.
- Card anterior `micahs-mind-p4p6-ancora-e-cena-radial-2026-08-19.md` devolvido
  a "A fazer" como reprovado/superado (motivo escrito nele).
