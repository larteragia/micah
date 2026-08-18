# Micah's Mind sempre visível: cidade sem sessão, auto-conexão e seletor

- **Data**: 2026-08-18
- **Autor do card**: Rodrigo Campos (direção: "resolvemos primeiro aparecer, depois tempo real")
- **Coluna**: Feito

## Descricao

O painel Micah's Mind só acende quando existe uma sessão claude ANCORADA e
viva na aba ativa — e a âncora é frágil (transcript pode sumir, pane
ressuscitada perde o hook, boot novo não tem nada). O comandante abre o app e
vê "Nenhuma sessão para seguir": a janela parece vazia/quebrada. Este card
resolve a Etapa 1 da direção nova: o mapa aparece SEMPRE que a pane em foco
estiver num repositório, com ou sem sessão; quando não há âncora, o painel
auto-conecta na sessão mais recente do MESMO repo (replay com selo) e oferece
um seletor manual. Tempo real (hooks/PTY) fica para o card E7, depois.

Base factual do sistema atual: `pickMindSession` (useMindFeed.ts:53) só devolve
sessão via âncora; `ensureCity` (useMindFeed.ts:201) só roda DEPOIS da primeira
linha do transcript (o root vem de `fold.session.cwd`); o cwd da pane JÁ é
rastreado por OSC 7 e exposto por `findLeafCwd` (panes.ts:43), mas o
MicahsMindArea nem recebe. A cidade em si (treemap via fs_list_files) não
depende de transcript nenhum — só de um root.

## Criterio de aceite

1. Painel Mind ativo numa aba cuja pane em foco NÃO tem sessão ancorada mas
   tem cwd dentro de um repositório git (raiz resolvida a partir do cwd já
   autorizado por OSC 7): a cidade do repo (pontos escuros, arquivos não
   tocados, vinda do scan REAL de fs_list_files) aparece sem nenhum
   transcript, com selo "cidade sem sessão" no cabeçalho; prova: captura
   window-shot da janela real + teste unitário do scan (shape REL) + ausência
   de invoke claude_session_tail nesse estado (código).
2. Sem âncora viva: cwd DENTRO de repo git → auto-conecta na sessão mais
   recente daquele repo (dir munged da raiz OU dir munged que estenda o path
   da raiz, pois lançamento de subdir conta como sessão do repo); cwd FORA de
   repo (ex.: HOME) → auto-conecta na sessão mais recente GLOBAL e a cidade
   vem do cwd do transcript (fluxo existente); em ambos exibe o id no
   cabeçalho e selo "replay" com a idade da última atividade; prova: captura
   com id no cabeçalho + saída do claude_sessions_recent elegendo aquele id.
3. Um seletor no painel lista até 5 sessões recentes (id curto + idade);
   clicar numa troca a sessão exibida imediatamente; prioridade fixa: âncora
   real > escolha manual > auto-recent; prova: capturas antes/depois com ids
   diferentes no cabeçalho.
4. Sessão conectada cujo transcript deixa de ser encontrado: a cidade
   PERMANECE desenhada e o painel mostra selo "transcript ausente" (status
   novo "missing", tone warn) — nunca branco; prova: teste unitário do
   estado + selo visível na janela real.
5. Suite verde no padrão do projeto: `pnpm lint`, `pnpm check-types`,
   `pnpm test`, `cargo clippy --all-targets --locked -- -D warnings`,
   `cargo test --locked` (fails pré-existentes documentados não contam).
6. Binário reconstruído e lido do ar: build id novo reportado pelo app em
   execução no log da instância viva (LEI DA PROVA, padrão do card anterior).
7. Comportamento conferido na janela real com scripts/window-shot +
   window-click (prova_de_ui do memorium); provas deste card nascem FRESCAS
   do build novo (não reaproveitam capturas do card 17/08).

## Comentarios humanos (o alvo)

- "Esse sistema de repo funciona como localhost mas só aparece alguma coisa
  depois que a AI faz alguma coisa... Talvez resolvemos isso primeiro para só
  depois tentar ativar em tempo real." — o mapa aparece ANTES de qualquer
  atividade; tempo real é card futuro (E7), não escopo daqui.
- "existe uma sessão claude em andamento, ela só está desconectada dessa
  janela. Deveria conectar automaticamente" — auto-conexão é critério 2.
- "ou ao menos ter um botão pra conexão" — seletor é critério 3.

## Plano em etapas

Plano v2 com as 9 correções obrigatórias do auditor de plano (ver Auditorias).

- E0 TS — conserto crítico do scan: `scanEntries` trata `fs_list_files` como
  o que ele é (paths REL ao root, search.rs:211-218) — cleanRel direto, scans
  de subDir prefixam o rel do subdir, scan vazio/falho → `entries=null` (tier-1
  assenta tocados, citymap.ts:422-426); teste unitário pinando o shape REL.
  Sem isto, E2 entregaria cidade vazia (e o card 17/08 herdou essa regressão
  silenciosa: o scan nunca contribuiu).
- E1 Rust — comando `claude_sessions_recent(cwd, limit)`: munge do cwd com
  ascii-alnumérico mantido e TODO o resto vira '-' (premissa verificada em
  disco para `:` `\` `.` espaço; acento é premissa — divergência cai em lista
  vazia, falha segura); lista `<root>/<munged>/*.jsonl` nos dois roots com
  teto de leitura ~300 entradas/dir; stem filtrado por is_uuid (mesmo gate do
  tail); ordena mtime desc → size desc → id asc (determinístico); retorna
  [{session_id, mtime_ms, size_bytes}]; limit default 5, hard 50; testes:
  munge, ordem/tie-break, limite, root secundário, dir inexistente → vazio.
- E2 TS — cidade sem sessão com noção de REPO: App expõe `resolveLeafCwd`;
  resolução da raiz: cwd (já autorizado via OSC 7) → raiz do repo git quando
  houver (git gate apenas para resolver; sem chamar git_* no repo-root sem
  autorizar antes); cwd em repo → cidade do repo-root via scan corrigido,
  sessões = dirs munged == munge(raiz) OU estendendo o path da raiz; cwd
  FORA de repo (HOME etc.) → NÃO escaneia cwd (50k entradas de lixo),
  auto-conecta a mais fresca GLOBAL e a cidade vem do transcript (fluxo
  atual); status "city" com selo "cidade sem sessão"; scan falha/vazio →
  entries=null + selo, nunca branco.
- E3 TS — auto-conexão + seletor: prioridade fixa âncora real > override
  manual > auto-recent; auto-connect roda UMA vez por cwd (nunca atropela
  escolha manual nem âncora); override vive em memória (sem localStorage),
  descartado quando activeLeafId muda OU âncora aparece; seletor lista até 5
  (id curto + idade), clique conecta imediatamente.
- E4 TS — anti-branco: status novo "missing" quando !found && synced (badge
  warn "transcript ausente"), cidade/fold permanecem; rótulos PT para todos
  os status no header (city/cidade sem sessão, probing, feed/ao vivo,
  missing/transcript ausente).
- E5 — testes (scan REL, pickMindSession com cwd/repo/global, override,
  seletor, missing), suites completas, commit próprio POR ETAPA, build
  release, deploy, provas FRESCAS na janela real (window-shot/click),
  memorium com prova lida do ar, WhatsApp.

## Auditorias por etapa

### Auditoria do plano (etapa 4 do protocolo) — auditor GLM independente, 2026-08-18

**Veredito: aprovado com correcoes.** 9 correções obrigatórias (todas aceitas
e incorporadas no plano v2 acima), 6 suspeitas derrubadas, 1 contradição
empírica registrada. O auditor leu o card, memorium, todos os arquivos
envolvidos, os dois roots de transcript no disco e o contrato de
fs_list_files no Rust.

| # | Categoria | Achado | Evidencia | Correcao aplicada |
|---|-----------|--------|-----------|-------------------|
| 1 | Regressao/Volume (CRITICA) | scanEntries tratava retorno de fs_list_files como ABS e filtrava por prefixo: todo arquivo descartado, scan nunca contribuiu (cidade do 17/08 era tocados-only; scannedRel nunca semeado, predicado exists morto) | useMindFeed.ts:121-125 vs search.rs:210-218 (`files.push(rel)` REL) | E0: scan consome REL direto, subdir prefixa, vazio→entries=null + teste pinando shape |
| 2 | Entrada vazia/suja | caso real do comandante (pane no HOME) quebrava o plano: munge do cwd não acha sessão do repo e scan do HOME = 50k lixo | roots no disco (dirs por cwd); search.rs:30 MAX_SCANNED | E2: noção de repo git (cidade da raiz + sessões da raiz/subdirs); fora de repo → global fresca, cidade do transcript; critério 2 reescrito |
| 3 | Autorizacao | git_resolve_repo é gated; repo-root ancestral do cwd autorizado não coberto; fs_list_files sem gate (verificado) | git/utils.rs:59; workspace.rs:33-36 | cwd já autorizado via OSC 7 resolve a raiz; sem git_* no repo-root sem autorizar; decisão registrada aqui |
| 4 | Concorrencia | mtime idêntico = escolha não determinística; override atropelável | plano v1 E3 | tie-break mtime desc/size desc/id asc; prioridade âncora > manual > auto; auto 1x por cwd |
| 5 | Estado/persistencia | cwd pode estar stale (subdir apagado, Z:/ offline) | serialize.ts:51,147; useTerminalSession.ts:668 | scan falha/vazio → entries=null + selo, nunca branco; override em memória, perde no remount (aceito) |
| 6 | Volume | dir de projeto com centenas de jsonl sem teto | plano v1 E1 | cap ~300/dir, limit 5 default/hard 50, is_uuid no stem |
| 7 | Encoding | munge com acento é premissa não verificável em disco | ls dos roots | ascii-alnum mantém, resto '-'; divergência → lista vazia (falha segura); premissa registrada |
| 8 | Regressao | Badge mostrava feed.status CRU em inglês; transcript sumido publicava "feed" mentindo | MindCanvas.tsx:419; useMindFeed.ts:241-243 | status "missing" + selos PT (sem isto critérios 1/4 não eram verificáveis) |
| 9 | Rollback/Eficiencia | plano omitia commit por etapa; risco de duplicar scan | plano v1 | commit próprio por etapa; E2 reusa o scan corrigido |

Suspeitas derrubadas (não regastar): fs_list_files sempre foi REL (c48f89d só
tornou async); cwd sobrevive a restart (serializado por leaf + OSC 7 re-emite
+ replay no remount); fs_list_files não tem gate; pickMindSession intacto
para âncoras; poll não vaza (área desmonta fora do modo); cleanRel rejeita
absoluto (torna o achado 1 determinístico).

Contradição empírica registrada: as capturas 15/16 do card 17/08 parecem
mostrar um cabeçalho "Sessão/Repo/legenda" que NENHUM componente no HEAD
renderiza, e cidade densa de scan que o pipeline (com o achado 1) não
produziria — ou a leitura das capturas completou padrões, ou vieram de
instância não-logada. Provas deste card nascem frescas do build novo
(critério 7).

### Auditoria da implementacao E0-E4 (auditor GLM independente) — 2026-08-18

**Veredito: achados a corrigir — nenhum matou a arquitetura; 1-5+7-8
corrigidos no commit seguinte, 6 e o cap-300 registrados aqui.** O auditor
leu o diff completo (2007cbf..9fdb7d8), rodou as suites por conta própria
(vitest micahs-mind 42/42, cargo claude_session 16/16) e mediu o custo real
do fallback de drive (13 dirs / 348 jsonl nesta máquina).

| # | Categoria | Achado | Evidencia | Correcao aplicada |
|---|-----------|--------|-----------|-------------------|
| 1 | Regressao/anti-farsa | selo "replay" com idade nao existia: sessao morta auto-conectada exibia badge "ao vivo" — criterio 2 nao passava | MindCanvas STATUS_LABEL so por status; WHY_TEXT so no empty state | badge sessionBadge no header do canvas (replay/escolhida + idade via recent) |
| 2 | Volume/plano | city-only escaneava QUALQUER cwd, inclusive HOME (walk de lixo proibido pela correcao 2 do plano) | MicahsMindArea passava focusedCwd cru | gate de cheiro de repo: fs_read_dir 1o nivel procura .git/package.json/Cargo.toml/go.mod/pyproject/deno/pnpm-workspace; sem marcador nao escaneia |
| 3 | Concorrencia/UX | overlay "sessões" cobria o botao de replay (mesmo canto top-right) | classes top-2 right-2 z-20 vs z-10 | botao de replay movido para bottom-[64px] right-2 |
| 4 | Estado | troca sessao→cidade mantinha a cidade COLORIDA da sessao morta sob o selo "cidade sem sessao" ate o scan completar | useMindFeed city-only primeiro setState sem city:null | city:null imediato (painel escuro breve em vez de mapa mentiroso) |
| 5 | Volume | sonda de ancestral no nivel de drive ("C:") casava TODOS os dirs com verificacao vacua: full-machine scan medido (13 dirs/348 jsonl) | collect_repo_sessions depth 1 | sonda comeca no nivel 2; repo vazio cai no global explicito (+teste drive_level_is_never_probed) |
| 6 | Entrada suja | ancestral intermediario casa largo entre usuarios (C:\Users casa C--Users-* de outro usuario; verificacao passa pois esta dentro de C:\Users) | munge/extend | REGISTRADO sem correcao: maquina single-user hoje; se multi-perfil importar, parar a sonda no home do usuario |
| 7 | Estado/UX | selected/replaySeq sobreviviam a troca sessao→cidade (stroke orfao sobre a cidade escura) | MindCanvas efeito com early-return em session null | limpeza em qualquer mudanca de pick.session |
| 8 | Estado/UX | flicker: primeiro paint publicava "absent" ("sem transcript") por um frame antes do city | useState inicial | estado inicial ja considera cityRoot ("city") |
| R1 | Volume | list_recent_in_dir trunca 300/dir por NOME (nao recencia): dir com >300 sessoes pode deixar a mais fresca fora | names.sort + truncate | REGISTRADO sem correcao: nenhum dir real passa de 300 nesta maquina; corrigir se um dir real crescer alem do cap |

Hipoteses do executor confirmadas/derrubadas pelo auditor: transitorio do
estado confirmado (achado 4); loop de effect DERRUBADO (guard forCwd cobre,
invoke em voo descartado pelo cleanup); ambiguous+auto OK (composePick
devolve o veredito anchored, seletor resolve com manual); selected/replay
confirmado (achado 7); custo do drive-root confirmado com numeros (achado
5); showHidden:false pre-existente para cidades de sessao (limitacao
registrada, nao deste card); mtime futuro DERRUBADO (clamp em "agora");
activeLeafId de aba editora DERRUBADO (retorna null, empty state correto).

### Adendo pós-fechamento (2026-08-18, reclamacao ao vivo do comandante)

Comandante reabriu o app e viu o painel vazio ("nao esta aparecendo nada",
70-user-report.png): duas abas com ancoras antigas -> pickMindSession
devolvia "ambiguous" -> composePick antigo recusava a auto-conexao por
principio. Corrigido no commit d3e3140: com seletor + selo de replay na
tela, seguir a mais fresca rotulada deixa de ser adivinhacao; ancora viva
continua mandando (teste atualizado). Build d3e3140-dirty lido do ar no
boot seguinte: `[19:00:47][INFO] micah build d3e3140-dirty` +
auto-conexao disparando nos dois panes (cwd=micah -> 6; global -> 100).

### ACHADO GRAVE pós-validação (2026-08-18, card próprio recomendado)

O shell-integration do PTY está INOPERANTE para toda pane neste build: o
profile.ps1 nunca roda (`Test-Path Variable:__MICAH_HOOKS_LOADED` = False em
pane ressuscitada E em aba nova — 64-freshtab-hooks.png; ontem 31-diag
Function:claude False), embora o arquivo esteja correto no disco e funcione
standalone (True/True por execução direta) e o log de spawn não registre o
warn de "shell integration disabled". Consequências: OSC 7 morto (cd não
atualiza cwd de pane), OSC 133 morto, wrapper claude com ancoragem mortos —
a jornada claude-numa-aba do card 08-15 depende disso. A regressão antecede
este card (achado do 17/08, então tratado como só-ressuscitada; agora se
provou geral). A auto-conexão deste card cobre o boot via cwd serializado,
mas o mapa ao vivo por cd fica cego até a raiz ser caçada.

## Validacao independente

Veredito: **APROVADO** (validador GLM independente do executor, 2026-08-18,
provas frescas em docs/proof/micahs-mind-sempre-visivel/, nascidas do build
novo — nenhuma captura do card 17/08 reaproveitada). Item por item:

1. **pass.** Painel com cwd em repo sem nenhuma sessão (repo de prova criado
   para isto): cidade escura treemap com selo "cidade sem sessão" e SEM id
   de sessão (57-c1-fresh-tab.png); o modo city-only não invoca
   claude_session_tail (early-return no efeito, useMindFeed.ts) e o shape
   REL do scan está pinado por teste (useMindFeed.test.ts).
2. **pass.** Boot com pane em repo: auto-conexão na sessão mais fresca do
   local com selo "replay · há 2 h" + id + cidade colorida com 1162 eventos
   (61-final-boot.png) e a saída do comando no log da instância viva:
   `[17:37:01][INFO] claude_sessions_recent cwd=Some("C:/Users/Zigfriad/
   projetos/micah") -> 6 sessions`; variante cwd fora de repo (global, a
   sessão desconectada que o comandante queria ver) provada em
   50-autoconnect.png/52-c2-global.png.
3. **pass.** Seletor lista 5 sessões (id + idade); clique na terceira trocou
   o id do cabeçalho de 6b1f761x para 9e64b9b5 com selo "escolhida · há 3 h"
   (62-c3-list-open.png → 63-c3-switched.png); prioridade âncora > manual >
   auto coberta por testes (composePick).
4. **pass.** Sessão conectada cujo transcript foi apagado (fake criada e
   deletada por mim, nenhum transcript real tocado): badge âmbar "transcript
   ausente" com a cidade PERMANECENDO desenhada (65-c4-connected.png →
   66-c4-missing.png); contrato pinado em teste (absentStatus).
5. **pass.** vitest 859/859 (846 prévios + 13 novos), check-types verde,
   biome lint verde, clippy --all-targets --locked -D warnings verde, cargo
   test 267/267 válidos (1 fail ambiental de symlink pré-documentado no
   memorium desde 17/08: erro 1314 de privilégio, fora do critério).
6. **pass.** Binário reconstruído e lido do ar: `[2026-08-18][17:37:01]
   [micah_lib][INFO] micah build 6b1f761-dirty` no stdout da instância viva
   com redirect (micah-run7.log); 6b1f761 = HEAD do card; -dirty por três
   arquivos de estilo tocados fora do card (preservados, registro abaixo).
7. **pass.** Todo o comportamento conferido na janela real via
   window-shot/window-click (prova_de_ui do memorium), com o comandante
   usando o mesmo build ao vivo durante a manhã (auto-conexão visível no
   boot das instâncias dele).

Registro de escopo: o acompanhamento de cwd por `cd` DENTRO de uma pane
existente depende do shell-integration do PTY, que está quebrado para TODAS
as panes neste build (aba ressuscitada E aba nova: `__MICAH_HOOKS_LOADED`
False, 64-freshtab-hooks.png; o profile.ps1 funciona standalone — provado
por execução direta True/True). A auto-conexão cobre o caso de uso real via
cwd serializado da pane no boot (provado no critério 2), mas `cd` ao vivo
não atualiza o mapa até esse bug raiz ser corrigido — aberto como achado
grave abaixo, card próprio recomendado.

## Rastro

- Commits (um por etapa + correções de auditoria): 025053c (E0 scan REL),
  b269f8e (E1 comando), d2f81f7 (E1b ancestor probing), 9fdb7d8 (E2-E4
  frontend), 47bdde8 (correções da auditoria de implementação), 77d1f41
  (repo sem sessões fica na cidade escura), e4df969 (telemetria do comando),
  6b1f761 (contrato absentStatus).
- Arquivos: src-tauri/src/modules/fs/claude_session.rs (+comando
  claude_sessions_recent, munge, verificação de cwd na 1ª linha, sondagem
  por ancestrais sem nível de drive), src/modules/micahs-mind/lib/
  useMindFeed.ts (mapScanFiles, city-only, missing, composePick,
  absentStatus), MicahsMindArea.tsx (auto-conexão 1x por cwd, gate de
  cheiro de repo, seletor), MindCanvas.tsx (selos PT, badge de sessão,
  replay sem colisão), src/app/App.tsx (resolveLeafCwd).
- Provas: docs/proof/micahs-mind-sempre-visivel/ (50-66 + crops).
- Deploy: micah.exe 6b1f761-dirty em execução no zig-laptop desde
  2026-08-18 14:37 -0300; comandante usou o build ao longo da manhã.
- Fakes do critério 4 criados em dir próprio com uuids inventados e
  removidos no fim (rm-fake-sessions.sh); nenhum transcript real tocado.
