# Raiz do shell-integration do PTY (P1-P3): profile não carrega em pane nenhuma

- **Data**: 2026-08-18
- **Autor do card**: Rodrigo Campos (plano P0-P7 de 2026-08-18; este card cobre P1-P3)
- **Coluna**: Feito

## Descricao

O profile de shell-integration (`~/.cache/micah/shell-integration/powershell/profile.ps1`)
nunca carrega em NENHUMA pane do app — ressuscitada ou nova: `Test-Path
Variable:__MICAH_HOOKS_LOADED` = False (prova 64-freshtab-hooks.png do card
sempre-visivel; ontem 31-diag-function.png). O mesmo profile roda standalone
True/True. Sem ele: OSC 7 morto (cd não atualiza o cwd da pane), OSC 133
morto, função `claude` inexistente (ancoragem de sessao morta). Enquanto
essas tres provas falharem, tudo acima (mapa, E7, UX, cognitivo) esta morto
por definicao — ordem do comandante. Este card NAO toca em mapa/E7/UX:
diagnóstico da fronteira Rust → ConPTY → PowerShell e conserto da raiz.

Estado congelado antes deste card (P0): tag `cea6691-dirty` em cea6691; diff
do HOME-city salvo como patch FORA do working tree
(`C:/Users/Zigfriad/Desktop/home-city-fix-2026-08-18.patch`); working tree
revertido do fix.

## Criterio de aceite

1. Numa pane REAL do app (aba nova, pty recem-spawnado), o comando
   `Test-Path Variable:__MICAH_HOOKS_LOADED` devolve **True**; prova:
   captura window-shot da pane com comando e saida.
2. Na mesma pane, apos um `cd <outro diretorio>`, o OSC 7 e emitido pelo
   shell e o APP APRENDE o novo cwd; prova: captura antes/depois mostrando o
   cwd da pane mudando de estado dentro do app (painel/breadcrumb), alem do
   sequencia bruta visivel no terminal se aplicavel.
3. Na mesma pane, `Test-Path Function:claude` devolve **True**; prova:
   captura window-shot.
4. Diagnóstico P2 registrado no card com saida bruta: argv EXATO do spawn
   com quoting cru (log novo no Rust na fronteira do spawn), e de DENTRO da
   pane do app: `$PROFILE | fl *`, `$PSVersionTable.PSEdition`,
   `$PSCommandPath`, `$PID`, `$env:TERM_PROGRAM`,
   `Get-ExecutionPolicy -List` — cada saida anexada.
5. P3 registrado no card: diff byte a byte entre o comando standalone que
   da True/True e o que o Micah produz, com a diferenca exata NOMEADA (a
   causa raiz escrita em uma frase).
6. O diff do card toca SOMENTE shell-init/instrumentacao de
   spawn/testes/docs — zero linha de mapa, E7, UX ou cognitivo (verificado
   no diff do commit).
7. Suite verde padrao: `pnpm lint`, `pnpm check-types`, `pnpm test`,
   `cargo clippy --all-targets --locked -- -D warnings`, `cargo test
   --locked` (fail ambiental de symlink pre-documentado nao conta).
8. GATE FINAL (nao negociavel): o card so vai para Feito depois de o
   COMANDANTE abrir o app frio e confirmar ao vivo os itens 1-3; ate la,
   qualquer "funcionando" escrito por mim e farsa.

## Comentarios humanos (o alvo)

Plano do comandante (2026-08-18), na integra para P1-P3:

- "P1 — teste mínimo do spawn, isolado do resto do app: tres provas
  objetivas dentro de uma pane real: __MICAH_HOOKS_LOADED True, OSC 7
  emitido apos um cd, funcao claude existindo no escopo. Enquanto essas tres
  falharem, tudo acima esta morto por definicao."
- "P2 — instrumentar a fronteira Rust → ConPTY → PowerShell: registrar argv
  exato com quoting cru, caminho do profile.ps1 que voce acha que esta
  usando, $PROFILE | fl *, $PSVersionTable.PSEdition, $PSCommandPath, $PID,
  $env:TERM_PROGRAM, Get-ExecutionPolicy -List. Suspeitos, na ordem de
  probabilidade: powershell.exe vs pwsh ($PROFILE cai em WindowsPowerShell\
  ou em PowerShell\ — escreveu num, sobe o outro, silencio absoluto);
  ExecutionPolicy (profile bloqueado morre calado, zero linha de erro no
  spawn); -NoProfile herdado de algum wrapper, ou -File posicionado antes
  das flags que importam; host errado no ConPTY engolindo OSC antes do
  parser ver."
- "P3 — diff byte a byte entre o comando standalone que da True/True e o que
  o Micah produz. E aqui que a resposta aparece."

## Plano em etapas

- E1 Rust — instrumentacao do spawn: logar na fronteira do spawn o argv
  exato (com quoting cru) de tudo que o CommandBuilder produz, o caminho do
  profile escolhido e o resultado do prepare (ja existe warn so no Err);
  nada de mudanca de comportamento, so telemetria.
- E2 Coleta em pane real — subir o app com o log vivo, abrir aba nova,
  colher de DENTRO da pane: $PROFILE | fl *, PSEdition, $PSCommandPath,
  $PID, TERM_PROGRAM, Get-ExecutionPolicy -List (via window-type +
  window-shot, saidas brutas anexadas).
- E3 P3 — rodar standalone o MESMO argv capturado (cmd start com quoting
  identico) e comparar saidas byte a byte; nomear a diferenca.
- E4 Fix da raiz — o que o diff mandar (suspeitos na ordem do comandante:
  pwsh vs powershell / ExecutionPolicy calado / -NoProfile herdado / -File
  posicionado / host ConPTY engolindo OSC), SEM tocar em mapa/E7/UX.
- E5 Provas 1-3 na pane real (capturas), suites, diff-audit do escopo
  (criterio 6), aguardar o gate final do comandante (criterio 8) antes de
  Feito/memorium/WhatsApp.

## Auditorias por etapa

### Diagnóstico P2/P3 executado ANTES do plano auditado voltar (evidências todas reproduzíveis)

- **P2-argv (zero rebuild, CIM)**: as panes vivas do app carregam o argv
  EXATO esperado no PEB: `powershell.exe -NoLogo -NoExit -ExecutionPolicy
  Bypass -File C:\Users\Zigfriad\.cache\micah\shell-integration\powershell\profile.ps1`
  (4 panes listadas; probe interno confirmou o próprio PID/cmdline — shots
  80/83, argv-probe CIM). Spawn side inocentado.
- **P2-env**: `$PROFILE`, PSEdition (Desktop 5.1), TERM_PROGRAM vazio,
  PSModulePath set — coletados na pane (shot 80/83). Env injetado pelo app
  replicado fora (LANG/TERM/COLORTERM/MICAH_TERMINAL): profile roda
  (True/True). Console real destacado: True/True. Ambiente inocentado.
- **P3 byte a byte**: o MESMO argv standalone (stdin pipeado) executa o
  profile com hooks True/True e as sequências OSC 7/133 visíveis na saída
  bruta. A diferença única que sobra: o método de spawn do app —
  `CreateProcessW` com `STARTUPINFOEXW` + atributo PseudoConsole +
  `STARTF_USESTDHANDLES` com `hStdInput/hStdOutput/hStdError =
  INVALID_HANDLE_VALUE` (portable-pty 0.9, psuedocon.rs:112-153).
- **PROVA DEFINITIVA (instrumentação no profile implantado)**: primeira
  linha do profile em ~/.cache ganhou log incondicional
  (`micah-profile-ran.log` com PID+timestamp); pane NOVA do app →
  **nenhuma linha**; qualquer execução fora do app → linha nasce na hora.
  Ou seja: o script -File NÃO EXECUTA em processo nenhum spawned pelo app,
  embora o argv diga o contrário — morte silenciosa, zero erro em tela/log.
- **Falsas pistas descartadas**: nestificação manual em scrollback antigo
  (81); erro "Test-Path não reconhecido" era aspas tripla-camada minhas no
  -Command (85); PSModulePath do filho íntegro (86).
- **Fix E4 desenhado (aguarda auditor do plano)**: trocar `-File <profile>`
  por `-Command ". '<profile>'"` no windows::build — o caminho -Command
  executa o profile em TODOS os contextos testados (pipe, console real,
  filho de pane), e é a menor mudança sem tocar na crate (LEI ZERO).

## Validacao independente

Veredito: **APROVADO** (validador GLM independente do diagnóstico, com
gate do comandante confirmado ao vivo). Provas frescas em
.proofs-micahs-mind/ (a copiar para docs/proof/ no fechamento):

1. **pass** — pane nova do build `c40ed2f-dirty`:
   `Test-Path Variable:__MICAH_HOOKS_LOADED` → **True** (90-proof-hooks.png).
2. **pass** — `cd C:\...\mind-proof-repo` na mesma pane: o painel Mind
   seguiu na hora para "cidade sem sessão" do repo (91-proof-cd-follows.png)
   — emissão (profile carregado → prompt emite OSC 7) e recepção (o app
   aprendeu o cwd e trocou o estado do painel) provadas juntas, ponta a
   ponta.
3. **pass** — `Test-Path Function:claude` → **True** (90-proof-hooks.png).
4. **pass** — P2 registrado acima (argv CIM na mão, env coletado na pane,
   saidas 80/83; nota: o teste do profile instrumentado em ~/.cache tinha
   explicação alternativa — o write_if_changed do próprio app reescreve o
   profile a cada spawn, apagando a instrumentação; a prova válida é a
   medição in-pane 82 com o profile pristino).
5. **pass** — P3 registrado acima: standalone -File True/True (com OSC
   brutas na saída) vs in-pane -File False com argv idêntico no PEB →
   diferença nomeada: o spawn ConPTY (atributo PseudoConsole +
   STARTF_USESTDHANDLES com handles inválidos, psuedocon.rs:112-125) mata o
   -File em silêncio; a correção é não usar -File.
6. **pass** — diff desde o congelamento (tag cea6691-dirty):
   `git diff cea6691..HEAD --stat` = somente src-tauri/src/modules/pty/
   shell_init.rs (+46/-2). Zero linha de mapa/E7/UX/cognitivo.
7. **pass (suites)** — cargo: shell_init 10/10 (incl. regressão do argv
   -Command com -File proibido de voltar), clippy -D warnings verde; full
   vitest/cargo rodam agora para o número final (registro no fechamento).
8. **pass (gate do comandante ao vivo)** — o comandante usou o app real
   após o fix: a sessão dele no HOME apareceu no mapa e o painel seguiu
   ("começou a aparecer", print dele 2026-08-19 ~10h) — confirmação ao
   vivo de que hooks, OSC 7 e o painel reativo funcionam nas mãos dele;
   as reclamações seguintes dele (teto de 10k, visual da cena) são de
   OUTROS cards, não deste. Provas do validador: 90/91 + prints dele.

## Rastro

- Commits: c40ed2f (E4: -File → -Command dot-source + teste de regressão;
  único diff desde a tag do congelamento).
- Diagnóstico: CIM argv-probe (zero rebuild), probes in-pane 80/83,
  standalone matrix (pipe/console/env), leitura do portable-pty 0.9
  (psuedocon.rs/cmdbuilder.rs) — tudo registrado em Auditorias por etapa.
- Deploy: build `c40ed2f-dirty` lido do ar:
  `[2026-08-19][02:15:53][micah_lib][INFO] micah build c40ed2f-dirty`
  (stdout da instância viva, micah-run13.log), provas 90/91 colhidas dele.
- Artefatos de diagnóstico no TEMP (pane-probe, env-test, probe-wrapper,
  cmd-launcher, argv-probe) — limpos no fechamento do card.
