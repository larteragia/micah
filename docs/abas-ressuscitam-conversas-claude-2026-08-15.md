# Abas que ressuscitam: cada aba volta com a sua conversa do Claude, sem digitar nada

- **Data**: 2026-08-15
- **Autor do card**: Rodrigo Campos
- **Coluna**: A fazer

## Descricao

Hoje o Micah restaura as abas (titulo, cwd, splits) ao reabrir, mas cada aba
volta como shell puro: a conversa do Claude Code que vivia ali morre na tela e
so volta se a pessoa digitar `claude --resume <id>` na mao. O Rodrigo quer o
comportamento WhatsApp: fechar o Micah, abrir de novo, e cada aba renascer
sozinha ja com a SUA conversa renderizada. Screenshot do pedido:
`C:\Users\Zigfriad\Desktop\03.jpg` (abas MICAH, CAVALO e VOLUR, todas em C:/).

Ponto tecnico central: as abas dele moram todas na MESMA pasta (C:/), entao
`claude --continue` nao serve (uma aba roubaria a conversa da outra). Cada aba
tem de ancorar o SEU session id e voltar com `claude --resume <session-id>`.

## Criterio de aceite

1. Com uma conversa do Claude aberta numa aba, fechar o Micah e reabrir: ao
   ativar a aba, ela volta sozinha com a MESMA conversa (mesmo session id,
   conferido no transcript de `~/.claude/projects/`), sem nenhum comando
   digitado (clicar na aba nao e digitar; e o gesto do WhatsApp de abrir a
   conversa). Vale para claude DIGITADO no shell, nao so para o lancado pelo
   launcher. Prova: captura da janela + session id lido do disco.
2. Apos abrir uma conversa e tirar o foco da janela (blur) ou fechar o app,
   `micah-spaces.json` contem o session id ancorado aquela aba. Prova: leitura
   do arquivo.
3. Duas abas com duas conversas diferentes voltam cada uma com a SUA conversa,
   sem troca: session ids distintos, cada um na aba de origem. Prova: capturas
   + ids conferidos.
4. Aba onde o Claude foi encerrado (exit limpo) antes de fechar o app volta
   como shell puro, sem resume fantasma.
5. Aba de shell puro que nunca rodou Claude volta exatamente como hoje.
6. Session id que nao casa com o formato UUID nao e escrito no PTY (blindagem
   contra spaces.json envenenado). Prova: teste unitario.
7. Suite verde e build real: `pnpm lint`, `pnpm check-types`, `pnpm test`,
   `cargo clippy --all-targets --locked -- -D warnings`, `cargo test --locked`,
   `cargo check --no-default-features`, e o binario release novo em execucao
   reportando MICAH_BUILD_ID novo no log.
8. A conversa desta propria sessao sobrevive a virada do deploy: o id e
   semeado no `micah-spaces.json` na aba MICAH depois do flush de fechamento
   (o binario velho nao tem o codigo para ancora-lo sozinho, correcao 13 da
   auditoria) e o boot novo o consome: ao ativar a aba MICAH, esta conversa
   esta viva dentro do app. A partir dai a ancoragem passa a ser automatica.
   Nota 2026-08-15: a sessao executora original (5a0b83dc-...) morreu quando
   aquela sessao do Claude falhou no meio do deploy do card do explorer; a
   conversa continuou em 49f13d09-74c0-4da5-896a-b9967366b22a, que passa a
   ser o id semeado. A semeadura e feita por script externo via Task
   Scheduler (fora do Job Object do PTY), que espera o processo micah morrer,
   patcha o JSON sem BOM e religa o binario novo.

## Comentarios humanos (o alvo)

> "aqui nesse terminal, tem como salvarmos o contexto escrito, como numa
> conversa de whatsapp, mesmo fechando e abrindo volta com a conversa salva?"

> "falo sem ter que rodar porra nenhuma, criando algum recurso"

> "isso e uma gambiarra monstra, nao tem que ser fora, tem que ser aqui.
> Salvo ancorado na propria aba MICAH"

> "cada conversa salva em sua respectiva aba, sem ter que colocar NADA nenhum
> comando pra recuperar" (03.jpg)

- Nada de atalho externo, nada de comando manual: o recurso mora DENTRO do
  Micah, ancorado na aba.
- LEI ZERO do memorium vale: zero dependencia nova; resolver com a fiacao que
  ja existe (hooks de agente do Micah, detector OSC 777, serialize das spaces,
  writeToSession).

## Plano em etapas (v2, reescrito apos a auditoria do plano)

Desenho v2: o Micah GERA o session id em vez de captura-lo.

- A CLI 2.1.233 aceita `claude --session-id <uuid>` (valida UUID antes de
  qualquer chamada ao modelo) e `--resume` PRESERVA o id (so `--fork-session`
  troca). Entao a fonte da verdade nasce DENTRO do Micah, `crypto.randomUUID()`
  (precedente: settings/store.ts:452), e nao existe captura por hook nenhuma.
- Claude lancado pelo launcher (`App.tsx` launchAgentGroup, useAiLiveBridge):
  o comando ja sai com `--session-id <uuid>` e a folha recebe o id na hora,
  por um `setLeafResume` espelhado no `setLeafCwd` (useTabs.ts:1124,
  panes.ts:47).
- Claude DIGITADO no shell (o cenario do 03.jpg): o wrapper de shell nos
  scripts de init que o Micah ja injeta (pty/scripts/profile.ps1 no Windows,
  zshrc/bashrc no Unix) define uma funcao `claude` que gera o uuid, emite um
  marcador OSC 777 com verbo NOVO (`notify;Micah;claude;session;<uuid>`) e
  delega para o binario real com `--session-id <uuid>`. Pass-through honesto:
  se a pessoa ja digitou `--resume`, `--session-id`, `--continue`, `-p` ou
  `--print`, a funcao NAO injeta id (e re-ancora quando o id digitado for
  conhecido). O `pty/agent_detect.rs` ganha o verbo novo (kind novo no
  AgentSignal), com validacao de UUID NO RUST, sem tocar o marcador legado.
- Persistencia: `serializeNode` grava `resume` POR FOLHA ao lado do `cwd`
  (precedente correto, serialize.ts:42-55); `hydrateNode` devolve; campo
  desconhecido e ignorado pelo Micah velho (compativel nos dois sentidos).
- Renascimento: NADA de aquecer todas as abas no boot. A injecao acontece na
  primeira ATIVACAO da aba (o ponto cold->warm de useTabs.ts:513-521), quando
  a folha e visivel e o `whenSessionReady` e real (OSC 7 registrado). Grid:
  `writeToSession`; aba blocks: `submitToLeaf`. Id validado por regex UUID +
  teto de tamanho antes de tocar o shell; guarda anti-dupla-execucao;
  preferencia para desligar (default ligado); poda no boot quando o
  transcript `~/.claude/projects/**/<uuid>.jsonl` nao existe mais (limpeza
  periodica do Claude Code apaga transcripts velhos).
- Limpeza do id: NUNCA no sinal `exited` do detector (ele tambem dispara no
  fechamento do app e apagaria exatamente o que se quer guardar, correcao 6).
  O id sai da folha quando um novo lancamento de claude a substitui, quando o
  processo claude termina com a janela viva e visivel, ou na poda do boot.

| Etapa | Entrega | Prova |
|-------|---------|-------|
| E1 | Provas empiricas pre-codigo: semantica de `--session-id` reutilizado (segunda chamada com o mesmo id: erro ou resume?), `--resume <id>` headless, wrapper de funcao PowerShell sobre claude.exe | saidas brutas no card |
| E2 | Rust: verbo `session` no agent_detect.rs (parse + validacao UUID + kind novo no AgentSignal), marcador legado intocado; testes de parsing incluindo lixo | cargo test |
| E3 | Shell init: funcao `claude` em profile.ps1 (+ paridade zshrc/bashrc) com pass-through de flags; prova manual da funcao num pty real | saida bruta |
| E4 | Front: `setLeafResume` no paneTree (espelho de setLeafCwd), launcher passando `--session-id`, sinal novo ancorando folha, limpeza com guarda de teardown, preferencia default ON; testes | vitest |
| E5 | Persistencia: serialize/hydrate de `resume` por folha, round-trip + poda de transcript inexistente; testes | vitest |
| E6 | Ativacao: injecao unica de `claude --resume <id>` no cold->warm com sanitizacao, submitToLeaf para blocks; testes | vitest |
| E7 | Suite completa (lint, check-types, test, clippy -D warnings, cargo test, --no-default-features) + build release; rename do micah.exe em execucao destrava o linker, JAMAIS duas instancias simultaneas (LazyStore autoSave 500ms, ultima escrita vence) | saidas brutas |
| E8 | Validacao independente E2E fora do processo (Task Scheduler + window-shot/click/key.ps1, todos DPIAware): jornada real digitando claude numa aba, conversando, fechando o app com flush, conferindo o id no micah-spaces.json, reabrindo, ativando a aba e capturando a conversa viva; semeadura do id 5a0b83dc na aba MICAH antes do restart (criterio 8) | capturas + json + transcript do validador |
| E9 | Registro no memorium.yaml com bloco prova (MICAH_BUILD_ID lido do log do binario em execucao) + aviso no WhatsApp via Cavalo Manutencao | entrada + envio |

Riscos mapeados (levantamento + auditoria):
- handleLeafExit (App.tsx:1115) so age quando o SHELL morre; resume com id
  morto devolve "No conversation found" exit 1 sem fechar pane; a poda do
  boot reduz esse caso a corrida rara.
- Flush: debounce 3s + flush em blur/beforeunload; taskkill /F perde o que
  nao foi flushado; o ancoramento na FOLHA (estado de tabs) garante que todo
  blur persiste o id (correcao 5).
- O deploy reinicia o Micah e mata TODAS as abas vivas: choreografia so roda
  com o quadro livre e o Rodrigo avisado na tela.
- Wrapper nao pode quebrar `claude --resume`/`-p` digitados (pass-through
  testado na E1/E3).

## Auditorias por etapa

### Auditoria do plano (Opus, 2026-08-15 ~02:05)

**VEREDITO: NAO CONCORDA com o desenho v1 (captura via hook UserPromptSubmit).
3 premissas falsas verificadas em codigo + 13 correcoes obrigatorias. Propos
desenho menor (`--session-id` gerado pelo Micah) que elimina duas etapas
inteiras. Executor ACATOU o desenho menor com a extensao do wrapper de shell
para cobrir claude digitado (o cenario real do pedido).**

Fatos externos verificados pela auditoria (CLI 2.1.233 local + doc oficial):
- session_id chega no stdin de hooks (comum a todos os eventos).
- terminalSequence existe e e documentado; lista de excecoes por evento nao
  obtida (pagina trunca). Ficou IRRELEVANTE no v2 (sem hook).
- `--resume <uuid>` funciona de qualquer diretorio desde a 2.1.223 e PRESERVA
  o id; id inexistente: "No conversation found with session ID", exit 1,
  sem custo de modelo (medido ao vivo).
- `--session-id <uuid>` existe e valida UUID (medido: "Invalid session ID.
  Must be a valid UUID.", exit 1).

Correcoes obrigatorias e o destino de cada uma no plano v2:

| # | Categoria | Correcao | Destino no v2 |
|---|-----------|----------|---------------|
| 1 | Regressao | Marcador legado corta no primeiro `;` e descarta campo extra em silencio (agent_detect.rs:163-199) | Verbo novo `session` + kind novo; legado intocado (E2) |
| 2 | Autorizacao | "Hook que o Micah ja instala" era falso: settings.json do usuario nao tem notify;Micah e digitar claude nao instala hook | v2 nao usa hook nenhum; captura via wrapper + --session-id (E3) |
| 3 | Regressao | Hook do claude em agent.rs:104 e POSIX sh sem prova no Windows; agent_hooks_status mente (procura substring no arquivo) | Evaporou no v2 (sem hook). Fica registrado como divida do modulo agents para card proprio |
| 4 | Estado e persistencia | UserPromptSubmit so dispara no primeiro prompt; SessionStart seria o certo | Evaporou no v2 (id nasce no lancamento) |
| 5 | Estado e persistencia | Id no agentStore nunca agenda flush (useSpacePersistence.ts:73-84 so observa tabs); taskkill /F perde tudo | Id mora na FOLHA do paneTree, espelho de setLeafCwd (E4) |
| 6 | Estado e persistencia | Sinal exited tambem dispara no fechamento do PTY/app: limpar ali apaga o que se quer guardar | Limpeza nunca no exited do detector; regras explicitas no v2 |
| 7 | Volume/Regressao | Aquecer todas as abas: PTY 80x24, DormantRing 1MiB contra transcript de 2,2MB medido, replay byte a byte, viola MICAH.md:83 | Injecao so na primeira ativacao (cold->warm), zero aquecimento eager (E6) |
| 8 | Concorrencia | whenSessionReady para folha invisivel e sleep cego de 4s (markSessionReady so roda com slot visivel) | Injecao acontece com a folha VISIVEL (ativacao), onde o ready e real (E6) |
| 9 | Entrada suja | Aba blocks: writeToSession fura o block machine | submitToLeaf para blocks (E6) |
| 10 | Autorizacao | Id vindo de saida de PTY nao confiavel + --resume cross-projeto desde 2.1.223 = abrir conversa de outro projeto | Validacao UUID no Rust (verbo novo) + regex/teto no front antes de tocar o shell (E2/E6); id nasce do proprio Micah no caminho launcher |
| 11 | Falha externa | Transcript some sozinho (limpeza periodica ~30 dias): resume com id morto da erro na cara do usuario | Poda no boot quando o jsonl nao existe; erro residual e exit 1 inofensivo (E5) |
| 12 | Rollback | Sem chave de desligar, spaces.json estranho digitaria comando no shell | Preferencia default ON + degradacao silenciosa sem o campo (E4/E6) |
| 13 | Estado e persistencia | Criterio 8 era circular (o binario velho nao ancora esta sessao) | Criterio 8 reescrito: semeadura manual do id na aba MICAH antes do restart, boot novo consome (E8) |

Checklist 3.1 varrido pela auditoria: 12 de 12 categorias declaradas
(achados acima; Encoding ok com a regra from_utf8-nunca-lossy; Timezone fora
de escopo com a nota da limpeza periodica; Taxa ok com nota de N sessoes
simultaneas; Segredo ok com nota de que session id e ponteiro para transcript
em claro e aba private ja fica de fora por serialize.ts:59-60).

Achado FORA DE ESCOPO registrado pela auditoria para card proprio:
`~/.claude/config.json` guarda chave de API em claro exportada como
ANTHROPIC_API_KEY, colidindo com a lei anti-pay-per-token do memorium. Nao
tratado neste card.

### E1: provas empiricas pre-codigo (executor, 2026-08-15 02:15, CLI 2.1.233)

1. `claude -p "..." --session-id 3f8a1c2e-9b4d-4f6a-8e2c-1a5d7b9c0e42`
   respondeu "ancora", exit 0: a CLI cria a sessao com o id EXATO fornecido.
2. Repetir com o MESMO id: `Error: Session ID 3f8a1c2e-... is already in
   use.`, exit 1, sem custo. Consequencia de desenho: id e de USO UNICO na
   criacao; o wrapper gera uuid fresco a cada lancamento e a restauracao usa
   SEMPRE `--resume`, nunca `--session-id` de novo.
3. `claude -p --resume 3f8a1c2e-... "qual palavra..."` respondeu "ancora":
   resume headless com prompt funciona a partir de C:\ (jornada do validador
   E8 viavel).
4. Prova de conceito do wrapper (scratchpad/wrapper-poc.ps1, mesmo padrao do
   `function global:micah` do profile.ps1): funcao `claude` sombreia o exe,
   pass-through de flags dispara o binario real ("atravessou"), caminho com
   id gerado criou sessao com transcript no disco com o id exato
   (SID-GERADO=94144000-8101-401c-808b-f7c2291aa747, EXIT=0,
   TRANSCRIPT-EXISTE=True).
5. Nota de implementacao do wrapper colhida na prova: alem das flags
   (--resume/-r, --continue/-c, --session-id, -p/--print, --fork-session,
   --version/-v, --help/-h), subcomandos (mcp, agents, doctor, plugin,
   install, update, auth, project, setup-token, import, gateway, auto-mode,
   ultrareview) tambem exigem pass-through sem id.

## Execucao (2026-08-15, manha)

Desvio declarado sobre o plano v2: o launcher e o spawnManagedAgent NAO
ganharam injecao propria de `--session-id`. Os dois caminhos escrevem
`claude ...` num shell interativo do Micah, e o shell resolve para o wrapper
da E3, que ja gera o id e emite o marcador. Um mecanismo unico cobre digitado,
launcher e agente gerenciado; duas implementacoes do mesmo id seriam duas
fontes de verdade para divergir.

- E2 src-tauri/src/modules/pty/agent_detect.rs: verbo `session` no marcador
  777 de 4 campos (`notify;Micah;<agent>;session;<uuid>`), validacao UUID
  estrita em Rust (is_uuid), `Transition::Session` + campo `session` no
  AgentSignal (skip_serializing_if). Legado intocado; a forma de 3 campos
  `notify;Micah;session;<uuid>` cai no caminho de agente desconhecido e morre.
  Prova: cargo test --lib agent_detect = 25 passed (7 novos, incluindo
  payload com injecao de shell e uuid truncado).
- E3 profile.ps1 + zshrc.zsh + bashrc.bash: funcao `claude` que sombreia o
  binario. Gera uuid fresco e delega com `--session-id <uuid>`; pass-through
  para --resume/-r/--continue/-c/--session-id/-p/--print/--fork-session/
  --version/--help e subcomandos (mcp, agents, doctor, plugin, install,
  update, auth, project, setup-token, import, gateway, auto-mode,
  ultrareview); re-ancora id digitado em --resume/--session-id (nunca em
  --fork-session, cujo id final e da CLI). fish fica de fora (escopo do
  plano); paridade so profile/zsh/bash.
  Prova (stub claude.cmd + dot-source do profile.ps1 real): `claude hello
  world` -> marker + STUB-ARGS=--session-id 2f23f3b0-... hello world;
  `--resume 3F8A...` -> marker minusculo re-ancorado + args intactos; -r, -c,
  doctor, --fork-session e -p atravessaram sem marker.
- E4 panes.ts `resume` por folha + setLeafResume/findLeafResume (identidade
  preservada em no-op), useTabs.setLeafResume espelho do setLeafCwd,
  AgentNotificationsBridge consome `session` (ancora, minusculo) e limpa no
  `exited` SOMENTE quando o agente da folha era claude e a janela esta
  visivel (correcao 6: nunca no teardown). Preferencia resumeClaudeTabs
  (default ON) em settings/store.ts + toggle em GeneralSection (Agents).
- E5 serialize.ts round-trip de `resume` com blindagem UUID no hydrate;
  claudeResumeBoot.ts poda anchors sem transcript (fs_glob local em
  ~/.claude/projects, workspace null; erro desconhecido preserva, "not a
  directory" poda tudo; espaco WSL pula a poda mas mantem a fila).
- E6 claudeResume.ts (validacao + fila single-shot por folha) +
  useClaudeResumeInjection: injeta `claude --resume <id>` na primeira
  ativacao cold->warm, whenSessionReady real, writeToSession no grid e
  submitToLeaf em aba blocks, guarda inFlight contra dupla execucao.
- Provas E4-E6: pnpm check-types exit 0; pnpm test 779 passed em 104
  arquivos (novos: claudeResume.test.ts, claudeResumeBoot.test.ts 6 casos,
  setLeafResume em panes.test.ts, round-trip + veneno em serialize.test.ts);
  pnpm lint 99 warnings identicos a baseline (git stash comparado).

## Validacao independente

(pendente)

## Rastro

(pendente)
