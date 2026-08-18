# Consulta tecnica: como capturar e visualizar a MENTE de uma AI em trabalho, ao vivo, sem depender so do log de sessao

Voce esta sendo consultado como arquiteto. Nao existe produto no mercado que faca
o que descrevemos abaixo; as respostas obvias do seu treinamento (parsear mais
logs, fazer um dashboard, usar um LLM para resumir) sao justamente o que NAO
queremos. Pense em sabor novo: seu treinamento conhece morango e conhece jaca,
mas a resultante morango+jaca+saque nao existe nele — ela precisa ser inventada
aqui. Ataque as premissas, inclusive as nossas.

## 1. O que existe (factual, sem interpretacao)

O Micah e um desktop app (Tauri 2: backend Rust, frontend React 19, sem nuvem,
tudo local na maquina do usuario). Ele e, essencialmente, um terminal com abas e
painels divididos (panes), mais um chat com agente in-app ("caixinha"), mais um
painel de browser embutido e um editor. Agentes de codigo (CLIs tipo Claude
Code) rodam DENTRO dos PTYs das panes do app.

O terminal ja tem instrumentacao propria: cada pane emite e escuta sequencias
OSC — OSC 7 (cwd atual do shell), OSC 133 (fronteiras de prompt/comando/saida),
OSC 777 (marcador custom: quando um CLI claude sobe numa pane, o wrapper do
shell anuncia `session;<uuid>` e o app ancora aquela pane aquele transcript).

Ha tambem um painel esquerdo chamado Micah's Mind, hoje implementado assim:

- FONTE UNICA: o JSONL de transcript da sessao claude (arquivo local
  `~/.claude/projects/<repo>/<session-id>.jsonl`), lido por um comando Rust que
  faz tail incremental por offset (chunk 256 KiB, poll de 700 ms, catch-up de
  60 ms quando ha dado novo).
- PARSER: o NDJSON e dobrado (fold) num "trace" de eventos: tool_use (com
  arquivos tocados: lido/editado/visto), turnos de usuario, compactacoes de
  contexto, subagentes.
- CITYMAP: o repositorio e layoutado como treemap squarified congelado no
  primeiro snapshot da sessao (arquivos tocados depois viram pontos "ghost",
  sem re-layout).
- CENA: Canvas 2D com pontos luminosos por arquivo, cor por tipo de toque
  (verde=visto, azul=lido, ambar=editado, escuro=nao visitado), pan/zoom/pinca,
  timeline com histograma observacao vs mutacao, follow-the-tail ao vivo.
- FIM DE SESSAO: um juiz LLM (outra CLI, headless) le o trace e grava uma
  memoria enriquecida num RAG local.

O usuario navega pelas bolinhas com mouse ou dedo e deveria VER o workflow da
AI: por onde passou, o que fez, se deu certo — rastreavel, transparente — e isso
se converte em memoria de qualidade no fim.

## 2. A falha raiz (que deixamos passar desde a origem da ideia)

Depender SOMENTE do JSONL para "o que a AI esta fazendo" e estruturalmente
quebrado, por razoes que se somam:

1. O JSONL e RELATO POSTERIOR: existe so DEPOIS que o modelo emitiu a tool_use
  e o CLI decidiu serializar. Nao ha sinal de intention/antes-do-fato.
2. E o que o CLI QUIS contar: nada do estado cognitivo (hipoteses, plano,
  duvidas, backtrack, morte de rumo) vira evento; um replan silencioso e
  invisivel.
3. E orientado a FERRAMENTA, nao a SEMANTICA: "Edit file X" nao diz se aquilo
  foi um fix trivial, um desespero da terceira tentativa, ou a jogada que
  resolveu o problema.
4. Frágil como canal: arquivo pode ser compactado/forkado/movido/apagado; a
  ancora morre e o mapa some (aconteceu de verdade: sessao ancorada sumiu do
  disco, painel acordou vazio).
5. Polling de arquivo nao e streaming: 700 ms de granularidade, sem nocao de
  "esta pensando agora", sem progresso intra-tool.
6. Sessoes que NAO sao CLI claude (o agente in-app, humanos+AI mistos,
  subagentes sidecar fora do arquivo principal) nao aparecem.

## 3. O alvo (o sabor novo)

Um mapa mental AO VIVO da AI trabalhando, onde o usuario VE, no instante em que
acontece: onde a atencao dela esta agora, o que ela esta explorando, qual
hipotese esta testando, o que morreu e foi descartado, o que esta prestes a
acontecer — nao um replay colorido de quais arquivos ela tocou. E ainda: ao fim,
esse fluxo capturado vira memoria enriquecida (RAG) melhor do que qualquer
transcript bruto.

## 4. Restricoes duras (inviolanveis)

- Stack fixa: Tauri 2 (Rust) + React 19 + Canvas 2D (WebGL tem pool de 5
  contextos, ocupado pelos terminais; three.js proibido). ZERO dependencia
  nova, zero servidor novo, zero runtime novo. Tudo local.
- Os agentes sao processos filhos (PTYs) do proprio app: o app VE cada byte que
  entra e sai do terminal (stdin/stdout/raw mode), os processos filhos que a AI
  spawna, os eventos de filesystem das edicoes dela, e pode conversar com o
  agente por hooks (PreToolUse/PostToolUse/Stop/SessionStart etc.) e por
  prompts/injecoes de contexto.
- Nao vale proposta que exija nuvem, servico pago, ou modificacao do CLI
  upstream (hooks e env ja sao suficientes e permitidos; fork proprio tambem).

## 5. As perguntas (responda numerado, para podermos fazer merge)

1. CANAIS: alem do JSONL, quais canais de captura reais existem nesse cenario
   (PTY byte-stream, hooks do agente, filesystem watch, processos filhos,
   git/mtime/diff, auto-relato estruturado da propria AI via tool/hook, sinais
   de UI do TUI...) e o que CADA um ve que os outros nao veem? Para cada canal:
   latencia tipica, o que ele mente/omite, e custo de coleta.
2. FUSAO: como fundir canais independentes num unico modelo de eventos ao vivo
   com confianca por evento (ex.: a AI DIZ que editou X, o FS confirma, o PTY
   mostrou o diff)? Proponha o esquema de reconciliacao (quem e fonte da
   verdade de que? como tratar eventos fora de ordem?).
3. ESTADO COGNITIVO: como representar o que NAO e arquivo — arvore de
   hipoteses/planos, tentativa-e-erro, backtrack, confianca, "vou parar de
   insistir nisso" — de forma que a propria AI consiga emitir barato (um
   sidecar estruturado por tool/hook) e a cena consiga desenhar? Proponha o
   schema minimo viavel do "mind-state delta".
4. STREAMING REAL: arquitetura push (do hook/PTY para o front) sem polling de
   arquivo — fila/protocolo/transporte dentro do Tauri (invoke? evento? canal
   dedicado?), backpressure, e o que fazer quando o agente dispara 50 eventos
   num segundo (agregacao? decaimento? camera segue o foco?).
5. CENA: como estender o treemap-cidade de arquivos para um espaco que tambem
   mostre o cognitivo (camada? segunda dimensao? constelacoes efemeras de
   hipoteses que nascem e morrem sobre a cidade?) mantendo pan/zoom/touch e
   Canvas 2D a 60 fps com 10k pontos.
6. ANTI-FRAGILIDADE: como o sistema sobrevive a sessao morrendo, transcript
   sumindo, CLI travado, pane fechada no meio — sem o mapa apagar (o usuario
   perde o estado mental acumulado de vista).
7. MEMORIA FINAL: como o fluxo multimodal capturado vira o melhor chunk de RAG
   possivel no fim da sessao (o que guardar do cognitivo que hoje se perde no
   transcript?).
8. PROTÓTIPO: qual E1 minimo (1-2 semanas de um dev) prova ou mata a ideia —
   qual canal fusive-lo primeiro e qual metrica de "isso e a mente dela ao
   vivo, nao um replay" validar?

## 6. Formato pedido da resposta

Para cada pergunta: (a) proposta concreta (arquitetura/schema, nao vibe),
(b) trade-offs e modos de falha, (c) o que na sua formacao parece adjacente mas
voce esta desconfiado que nao basta aqui. Seja adversarial com a secao 3: se o
alvo parecer impossivel com as restricoes, diga onde quebra e o que trocaria.
_________________________________________________________________________________


# Consultoria de Arquitetura: Mapa mental AO VIVO da AI no Micah

## TL;DR
- **O alvo é possível, mas NÃO com o JSONL como fonte primária.** A arquitetura correta inverte a hierarquia: os **hooks do Claude Code** (PreToolUse/PostToolUse/etc.) e o **byte-stream do PTY** viram a espinha dorsal ao vivo (push, sub-100ms), e o JSONL vira apenas um canal de reconciliação/backfill assíncrono. Isso resolve 5 das 6 falhas-raiz sem violar nenhuma restrição dura.
- **O estado cognitivo (hipóteses, backtrack, "vou desistir disso") NÃO existe em nenhum canal passivo** — nem no JSONL, nem no PTY, nem no FS. Ele precisa ser *provocado*: a AI se auto-relata barato via um hook `PostToolUse`/`Stop` ou uma tool MCP local que emite um "mind-state delta" estruturado. Sem auto-relato instrumentado, qualquer "árvore de hipóteses" é alucinação da visualização.
- **O E1 que prova ou mata a ideia em 1-2 semanas:** fundir só DOIS canais (hook PreToolUse + FS watch já existente) num `ipc::Channel` do Tauri, e validar a métrica **"intent-lead"** — a fração de eventos em que o halo de *intenção* aparece ANTES da mutação física no disco. Se > 80%, é mente ao vivo; se ~0, o sistema é ontologicamente um replay e a ideia está morta.

## Key Findings

1. **O JSONL é estruturalmente um relato posterior, e pior do que Rodrigo diagnosticou.** Além dos 6 pontos dele, a pesquisa confirma: (a) o conteúdo de *thinking* é **redigido/assinado** no disco — em Opus, o campo `thinking` vem vazio com `signature` válida (flag `redact-thinking-2026-02-12`), então o raciocínio real *nunca chega ao arquivo*; (b) sidechains de subagente foram movidos para arquivos separados (`subagents/agent-<id>.jsonl`), então o arquivo principal tem `isSidechain:false` em tudo; (c) há bugs documentados de blocos de texto/thinking **silenciosamente descartados** do JSONL (issue #74260). Ou seja: apostar no JSONL para "estado cognitivo" é apostar no canal que a Anthropic explicitamente esvazia.
2. **Os hooks são o canal ao vivo real, e são muito mais ricos do que "PreToolUse/PostToolUse".** A referência de hooks documenta **31 eventos de ciclo de vida** (verificado em 8/ago/2026 por blakecrosley.com: *"the reference documents 31 hook events... once per session (SessionStart, SessionEnd), once per turn (UserPromptSubmit, Stop, StopFailure), and on every tool call inside the agentic loop (PreToolUse, PostToolUse)"*; The Claude Codex conta 32, exigindo v2.1.106+ para Setup/SubagentStart/Stop/WorktreeCreate/ChannelMessage). Inclui `SubagentStart`/`SubagentStop`, `PostToolBatch`, `Notification`, `PreCompact`/`PostCompact`, `Stop`, `SessionEnd`. Cada hook recebe um envelope comum (`session_id`, `transcript_path`, `cwd`, `hook_event_name`) via stdin e pode **injetar contexto de volta** (`additionalContext`) e, no PreToolUse, até **reescrever** os argumentos (`updatedInput`). Isso é bidirecional — o app pode *perguntar* à AI.
3. **O PTY vê o que nenhum outro canal vê: o "agora".** O app é dono do PTY, então vê cada byte de stdout/stdin em tempo real — incluindo o spinner "esperando", o texto do plano sendo digitado, e as sequências OSC. É o único canal com sinal de "está pensando agora" sub-100ms.
4. **Tauri tem o transporte certo já em árvore: `tauri::ipc::Channel`.** A doc oficial (tauri.app/develop/calling-frontend) diz: *"The event system is not designed for low latency or high throughput situations... event payloads are always JSON strings making them not suitable for bigger messages... Channels are designed to be fast and deliver ordered data. They are used internally for streaming operations such as download progress, child process output and WebSocket messages."* Channel garante ordem por índice. Zero dependência nova.
5. **A stack fixa é suficiente para o alvo, com UMA exceção honesta:** representar constelações de hipóteses efêmeras sobre uma cidade de 10k pontos a 60fps em Canvas 2D é viável com quadtree + dirty-rect + camadas, mas *só* se a camada cognitiva for desenhada como um conjunto pequeno (dezenas, não milhares) de primitivas sobre um layer separado. Se a ambição crescer para milhares de nós cognitivos animados simultâneos, Canvas 2D quebra e não há WebGL disponível — aí o alvo precisa ser reduzido.

## Details

### Fatos verificados que ancoram tudo (fontes)

**Hooks do Claude Code (fato verificado):**
- Envelope comum em todo evento: `session_id`, `transcript_path`, `cwd`, `hook_event_name`; eventos de ferramenta adicionam `tool_name`, `tool_input`; PostToolUse adiciona `tool_response` (com `exit_code`); dentro de subagente vêm `agent_id`, `agent_type`. Payload chega em stdin como JSON.
- PreToolUse pode `deny`/`ask`/`allow` e reescrever args via `hookSpecificOutput.updatedInput`; e desde v2.1.9 pode retornar `additionalContext`. PostToolUse é observação-only (não desfaz), mas injeta `additionalContext` e vê `tool_response.exit_code`.
- UserPromptSubmit e SessionStart injetam stdout de texto puro direto no contexto do modelo. SessionStart injeta silenciosamente via `additionalContext` (desde 2.1.0).
- Timeouts: hooks de ferramenta têm timeout de 10 minutos (subiu de 60s na v2.1.3); UserPromptSubmit tem timeout curto de 30s; hooks `prompt` 30s, `agent` 60s. Hooks casados rodam em paralelo. Há `async: true` para rodar em background sem bloquear.
- Stop tem loop-guard: Claude sobrepõe um Stop hook depois de 8 bloqueios seguidos; `stop_hook_active` sinaliza reentrância.
- SubagentStart recebe `agent_prompt` e suporta `additionalContext`; SubagentStop pode bloquear o encerramento do subagente.

**Transcript JSONL (fato verificado):**
- Uma linha JSON por evento em `~/.claude/projects/<munged-path>/<session-id>.jsonl`; cada linha tem `uuid`, `parentUuid` (lista ligada), `timestamp` ISO-8601, `sessionId`, `cwd`, `gitBranch`, `version`, `isSidechain`.
- Sidechains de subagente ficam em arquivos separados (`subagents/agent-<agentId>.jsonl`); o arquivo principal tem `isSidechain:false`.
- Compactação: escrita faz *field stripping* (`cleanMessagesForLogging`/`removeExtraFields` remove `isSidechain`/`parentUuid`), leitura faz excisão de ramos mortos. Blocos de thinking podem vir com `thinking:""` + `signature` válida (redação via flag `redact-thinking-2026-02-12` em Opus). Bugs conhecidos (issue #74260) descartam blocos de texto do disco.

**OSC / shell integration (fato verificado):**
- OSC 133: A=início de prompt, B=fim de prompt, C=pré-execução, D[;exitcode]=fim de execução com exit code. OSC 7=cwd. OSC 633 (VS Code) estende com E=linha de comando exata + nonce anti-spoof, P=propriedades.
- OSC 9;4 (ConEmu/Windows Terminal): `ESC ] 9 ; 4 ; <state> ; <progress> ST`, state 0=limpar,1=normal,2=erro,3=indeterminado,4=warning; progress 0-100. Progresso intra-comando real.

**Tauri v2 IPC (fato verificado):**
- Doc oficial: *"The event system is not designed for low latency or high throughput situations"* e *"event payloads are always JSON strings"*; *"Under the hood it directly evaluates JavaScript code so it might not be suitable to sending a large amount of data."*
- Channel: *"designed to be fast and deliver ordered data. They are used internally for streaming operations such as download progress, child process output and WebSocket messages"*; ordena por índice.
- Tudo serializa para strings JSON (protocolo tipo JSON-RPC); há otimização de `JSON.parse('...')` para payloads >10KB. Custom protocol via `register_uri_scheme_protocol` é a rota rápida recomendada por mantenedores para alta frequência/binário. Na GitHub Discussion #7146 do repo tauri-apps ("Send data from Rust to Front end via IPC at an extremely high rate"), um usuário reportou: *"After completing 400,000 iterations I send out all the 400,000 datapoints to the webview via IPC which took like 3-4 seconds, which is kind of slow."* Há bug conhecido (#10987) de panic ao emitir em alta frequência. Benchmarks de terceiros (tauri-conduit) medem um blob de 65536 bytes fazendo roundtrip em 600µs via pipe binário vs 6.7ms via IPC JSON padrão do Tauri.

**OpenTelemetry GenAI (fato verificado, referência de modelo de dados):**
- Spans com `gen_ai.operation.name` (que cobre `create_agent`, `invoke_agent`, `invoke_workflow`, `execute_tool`, `retrieval`, `plan` e operações de memória, per o repo semantic-conventions-genai), `gen_ai.request.model`, `gen_ai.usage.input_tokens`/`output_tokens`, `gen_ai.response.finish_reasons`. As convenções modelam a execução inteira do agente como uma *árvore de spans*, não só chamadas de LLM isoladas. **Status: NÃO estável** — per John Hodge (john-hodge.com, 17/jul/2026): *"as of July 17, 2026, no GenAI-specific span, event, metric, or attribute in the dedicated repository is marked Stable; the GenAI conventions remain Development"*; a v1.42.0 do repo semantic-conventions (12/jun/2026) depreciou e moveu todo o conteúdo `gen_ai.*` para o repo dedicado open-telemetry/semantic-conventions-genai.

---

### 1. CANAIS

**(a) Proposta concreta.** Canais reais, com o que cada um vê de exclusivo:

| Canal | Latência típica | O que vê que os outros NÃO veem | O que mente/omite | Custo de coleta |
|---|---|---|---|---|
| **Hook PreToolUse** | ~10-50ms (spawn do processo) | **Intenção antes-do-fato**: a AI *vai* editar X, com `tool_input` completo, antes de qualquer efeito | Não vê se deu certo; não vê raciocínio; só o que virou tool_call | Baixo, mas *bloqueia* a tool até o hook retornar |
| **Hook PostToolUse** | ~10-50ms após efeito | Resultado real (`tool_response`, `exit_code`), confirmação de sucesso/erro | Não desfaz; não vê o "porquê" | Baixo |
| **Hook Stop/SubagentStop/PreCompact** | fim de turno | Fronteiras semânticas: fim de raciocínio, morte de subagente, compactação iminente | Não vê o miolo | Baixo |
| **PTY byte-stream** | <16ms (por byte) | **O "agora"**: spinner, texto de plano sendo digitado, TUI, OSC | Ruído ANSI; difícil semântica; conteúdo não estruturado | Médio (parsing de stream) |
| **OSC (7/133/633/9;4/777)** | <16ms | cwd, fronteiras de comando, exit code confiável, progresso intra-tool | Só o que o shell/CLI emite | Baixo (já instrumentado) |
| **FS watch** | ~5-50ms | Mutação real no disco (ground truth da edição), inclusive edições fora de tool | Não sabe *quem*/*por quê*; eventos em rajada | Médio |
| **Processos filhos (ptree)** | ~poll 100ms | Subagentes/comandos spawnados fora do arquivo principal | Sem semântica; PID não diz intenção | Médio |
| **git/mtime/diff** | sob demanda | Delta semântico real (o que mudou de fato), sobrevive a tudo | Snapshot, não fluxo | Baixo sob demanda |
| **Auto-relato estruturado da AI** (via hook/tool) | ~10-50ms | **O cognitivo**: hipótese, confiança, backtrack — o que nenhum canal passivo tem | A AI pode mentir/racionalizar post-hoc | Baixo (mas custa tokens/latência) |

O insight-chave: **cada falha-raiz do Rodrigo é resolvida por um canal diferente**. Intenção antes-do-fato → PreToolUse. "Está pensando agora" → PTY spinner + ausência de OSC-133-D. Confirmação da edição → FS + PostToolUse. Subagentes sidecar → SubagentStart/Stop. Sobrevivência à morte do arquivo → git/FS/hooks (não dependem do JSONL).

**(b) Trade-offs e modos de falha.** PreToolUse *bloqueia* a tool enquanto roda — um hook lento (ou que faz IPC síncrono pesado) atrasa a própria AI. Mitigação: o hook deve ser um binário minúsculo que só faz um write não-bloqueante num socket/named-pipe local e sai (exit 0). O PTY byte-stream é o canal mais rico e mais mentiroso: parsear TUI para semântica é frágil (o CLI muda o layout e quebra). OSC depende do wrapper de shell continuar vivo — comandos pesados que resetam `PROMPT_COMMAND` podem suprimir 133;D (bug documentado no VS Code, issue #313074). FS watch dispara rajadas (um "salvar" pode gerar N eventos), exigindo debounce.

**(c) Desconfiança do treinamento.** O treinamento sugere "parsear logs melhor" e "usar OpenTelemetry". OTel GenAI é ótima referência de *modelo de dados* (spans de tool/agent, árvore de spans), mas foi desenhado para *backend após o fato* com um coletor/servidor — viola "zero servidor novo", é orientado a request/response e, além disso, ainda está em status *Development* (não estável) em julho/2026. A adjacência enganosa é achar que "instrumentar = adicionar spans"; aqui o valor está em canais que o OTel nem modela (o spinner do PTY, a *ausência* de um evento).

### 2. FUSÃO

**(a) Proposta concreta — modelo de eventos unificado com proveniência e confiança por evento.** Um único `UnifiedEvent` em Rust, append-only, com relógio lógico:

```rust
struct UnifiedEvent {
    seq: u64,                 // Lamport clock local (monotônico, atribuído na ingestão)
    event_time: i64,          // timestamp da FONTE (ms), pode vir fora de ordem
    ingest_time: i64,         // processing time (quando o backend viu)
    pane_id: PaneId,          // âncora primária = a PANE, não o session-id
    session_id: Option<Uuid>, // pode faltar (sessão não-claude)
    kind: EventKind,          // Intent | Mutation | Cognitive | Boundary | Progress
    subject: Subject,         // File(path) | Hypothesis(id) | Tool(id) | Agent(id)
    source: Source,           // Hook | Pty | Fs | Osc | Jsonl | Git | SelfReport
    confidence: f32,          // 0.0-1.0, ver regra de reconciliação
    corroborated_by: SmallVec<[Source; 4]>,
    payload: EventPayload,
}
```

Regra de **fonte da verdade por dimensão** (não há uma única fonte de verdade global):
- **Intenção** (vai fazer): fonte = PreToolUse hook. Ninguém mais tem isso.
- **Mutação de arquivo** (fez de fato): fonte = FS watch (ground truth físico). PostToolUse e JSONL apenas *confirmam*.
- **Sucesso/erro**: fonte = PostToolUse `exit_code` / OSC-133-D exitcode.
- **Cognitivo**: fonte = auto-relato (SelfReport); nunca inferido de outro canal.
- **cwd / fronteira de comando**: fonte = OSC 7/133.

**Confiança:** um evento começa com a confiança da sua fonte (Hook=0.9, FS=0.95, PTY-parse=0.5, Jsonl=0.7 mas atrasado). Quando dois canais concordam (a AI *disse* que editou X via PreToolUse **e** o FS confirmou mutação em X dentro de uma janela), a confiança sobe para ~0.99 e o evento vira "corroborado". Se PreToolUse disse "editar X" mas o FS *nunca* confirma → evento fica "claimed, unverified" (candidato a "rumo que morreu").

**Fora de ordem:** aplicar **watermark com bounded out-of-orderness** (técnica de stream processing). O JSONL chega segundos depois (poll 700ms + serialização do CLI); tratá-lo como *late-arriving event* que faz *retração/correção* de eventos especulativos, não como fonte primária. Watermark = `max(event_time visto) − W`, com W ~2s. Eventos abaixo do watermark são "selados"; um JSONL que chega depois só pode *enriquecer* (adicionar o thinking-summary), nunca reordenar a cena.

**Reconciliação por chave:** correlacionar canais pela tupla `(pane_id, tool_use_id)` quando disponível (o `tool_use_id` aparece no hook e no JSONL), e por `(pane_id, path, janela-temporal)` para casar hook↔FS.

**(b) Trade-offs e modos de falha.** Vector clocks seriam o "correto" para causalidade distribuída, mas aqui tudo roda numa máquina só e num processo Rust — um **Lamport clock local (contador monotônico único)** basta e é muito mais barato; vector clock é over-engineering. O risco real é *casamento errado* hook↔FS: se a AI edita dois arquivos em 5ms, a janela temporal pode cruzar os fios. Mitigação: usar `tool_input.file_path` do hook como chave forte antes de cair na heurística temporal. CRDTs não se aplicam (não há concorrência multi-réplica); citá-los seria cargo-cult.

**(c) Desconfiança do treinamento.** O treinamento puxa para "event sourcing + Kafka + Flink". Os *conceitos* (event time vs processing time, watermark, retração) são exatamente certos e devem ser usados — mas a *infra* é proibida (zero servidor). A adjacência enganosa: achar que precisa de um message broker. Aqui o "broker" é um `tokio::sync::mpsc` + um `Vec<UnifiedEvent>` append-only em memória com snapshot em disco. Todo o valor teórico do stream processing, nenhum dos binários.

### 3. ESTADO COGNITIVO

**(a) Proposta concreta — o "mind-state delta" que a própria AI emite barato.** O mecanismo: um hook `PostToolUse` (e opcionalmente `Stop`) roda um binário minúsculo; mas o *conteúdo* cognitivo vem da AI via um dos dois caminhos:
1. **Caminho barato (sem tokens extras):** o hook injeta, via `additionalContext`, uma instrução permanente leve pedindo que ANTES de cada tool a AI emita uma linha estruturada num arquivo/FD combinado. Custa alguns tokens por turno.
2. **Caminho tool-nativo:** registrar uma tool MCP local trivial `mind_delta(...)` que a AI chama quando muda de hipótese. Zero servidor (MCP local via stdio), a chamada aparece como tool_use — capturável por PreToolUse.

Schema mínimo viável (`MindStateDelta`), deliberadamente pequeno para ser barato:

```json
{
  "t": 1730000000000,
  "op": "spawn|update|kill|confirm|link",
  "node": "h7",                    // id curto e estável da hipótese/plano
  "parent": "h3",                  // árvore de exploração (beam/MCTS-like)
  "label": "race na fila de PTY",  // ≤ 60 chars
  "state": "exploring|testing|dead|validated",
  "confidence": 0.35,              // auto-relatada
  "evidence": ["src/pty.rs", "tool:bash#42"],  // liga ao mundo físico
  "because": "timeout só some com poll<60ms"    // ≤ 120 chars, opcional
}
```

Cinco campos fazem 90% do trabalho: `op`, `node`, `state`, `confidence`, `evidence`. `spawn`=nasce hipótese, `kill`=morreu (o "vou parar de insistir nisso"), `link`=liga hipótese a arquivo. A **árvore** emerge de `parent`. O **backtrack** é visível quando um `kill` de `h7` é seguido de `update` em `h3` (volta ao pai).

**(b) Trade-offs e modos de falha.** O modo de falha fundamental: **a AI racionaliza post-hoc**. O `because` é uma narrativa gerada, não introspecção verídica — o mesmo problema do thinking-summary (que a pesquisa mostra ser escrito por *outro* modelo e depois redigido/encriptado no disco). Portanto `confidence` e `because` devem ser marcados como baixa-confiança na fusão (são SelfReport, nunca corroboráveis). O que *é* confiável é a *estrutura temporal*: quando a hipótese nasceu, quando morreu, o que tocou nela — isso cruza com FS/hooks. Segundo modo de falha: a AI simplesmente esquece de emitir deltas. Mitigação: o hook PostToolUse pode *derivar* um delta implícito ("mesmo arquivo editado 3ª vez" → provável `state:testing, confidence caindo`) mesmo sem auto-relato — heurística, marcada como inferida.

**(c) Desconfiança do treinamento.** O treinamento oferece "árvores de MCTS/beam search" como visualização de raciocínio — a metáfora visual é boa (nós que nascem/morrem), mas o pressuposto de que existe uma árvore de busca *explícita e verídica* para capturar é falso: um LLM não expõe sua árvore de busca. Estamos *fabricando* uma projeção barata, não gravando a real. Ser honesto sobre isso é o que separa "mente ao vivo" de "teatro de raciocínio".

### 4. STREAMING REAL

**(a) Proposta concreta — push do backend Rust para o front via `tauri::ipc::Channel`.** Arquitetura sem polling de arquivo:

```
Hooks (binário) ─┐
PTY reader      ─┤→ tokio::mpsc (unbounded p/ ingest) → Reconciler task → 
FS watcher      ─┤     (Lamport clock, watermark, dedup, confidence)
OSC parser      ─┘                                          │
                                             ring buffer (VecDeque, cap N)
                                                            │
                                        ipc::Channel<CoalescedFrame> → React
```

- **Transporte:** `tauri::ipc::Channel`, não `emit`. A doc oficial recomenda Channel para streaming ordenado; Channel ordena por índice. Um único Channel de longa duração, aberto por um comando `subscribe_mind(pane_id, on_event: Channel<CoalescedFrame>)`.
- **Hooks → backend:** o binário de hook não faz IPC Tauri (ele é outro processo). Ele escreve num **named pipe / Unix domain socket** local (ou TCP loopback) que o backend Rust já escuta. Isso não é "dependência nova" — é o mesmo padrão que o app já usa para PTYs.
- **Backpressure:** canal interno mpsc unbounded na ingestão (nunca perder um hook, que bloqueia a AI), mas **coalescência antes do Channel**: o Reconciler agrega numa janela de frame (~16ms = 60fps). Se 50 eventos chegam num segundo, o front recebe ~60 frames coalescidos/s, cada um com um *batch* de deltas, não 50 mensagens.
- **Agregação/decaimento sob rajada:** quando `events/frame > K` (ex. 20), degradar graciosamente: colapsar N mutações no mesmo arquivo num único "pulse" com contador; aplicar **decaimento** (brilho ∝ recência) para que a rajada vire "onda de calor" em vez de 50 flashes; e **câmera segue o foco** — centro de massa dos eventos de maior confiança da janela.

**(b) Trade-offs e modos de falha.** A pesquisa quantifica o risco do caminho errado: na Discussion #7146, `emit` de ~400k eventos levou "3-4 segundos" e há bug de *panic* ao emitir em alta frequência (#10987). Tudo em Tauri serializa para strings JSON (tipo JSON-RPC); logo, frames devem ser pequenos e já coalescidos. Para o volume esperado (dezenas de deltas/s), JSON via Channel é suficiente e não precisa de custom protocol; se algum dia o PTY raw-stream precisar ir ao front em massa, aí sim `register_uri_scheme_protocol` binário é a saída documentada (tauri-conduit mede 600µs vs 6.7ms para blobs de 64KB por essa rota). Modo de falha: unbounded mpsc pode crescer se o Reconciler travar — cap defensivo com drop-oldest + marca de "gap".

**(c) Desconfiança do treinamento.** O treinamento diz "use WebSockets/SSE/um message queue". Proibido e desnecessário: o Channel do Tauri já É o canal ordenado. A adjacência enganosa é o reflexo de "emit para tudo" (todo tutorial Tauri usa `emit`) — que é exatamente o anti-padrão para este caso segundo a própria doc.

### 5. CENA

**(a) Proposta concreta — cidade (arquivos) + céu (cognitivo) em camadas de Canvas 2D.** Três camadas de canvas empilhadas (não WebGL — pool ocupado):
1. **Layer-cidade (estático/cache):** o treemap squarified congelado, renderizado uma vez para um canvas offscreen/bitmap e blitado. Redesenha só em pan/zoom. Isto é o que a pesquisa chama de cache via bitmap para grupos que não mudam.
2. **Layer-brilho (dinâmico):** os pontos luminosos por arquivo, redesenhados por **dirty-rect** — só as regiões que mudaram. Com quadtree para culling (só desenha pontos no viewport) e hit-testing de hover. A literatura confirma quadtree levando O(n²)→O(n log n) e 60fps com 10k pontos.
3. **Layer-céu (cognitivo efêmero):** as "constelações" de hipóteses como um **grafo pequeno (dezenas de nós)** flutuando ACIMA da cidade, com arestas `parent`. Cada nó-hipótese é um halo; suas arestas de `evidence` descem até os arquivos (pontos) da cidade que ele tocou. `spawn`=fade-in, `kill`=fade-out+colapso, `validated`=pulso verde. O céu é a *segunda dimensão* (altura/camada), não polui a cidade.

O casamento: a hipótese vive no céu; seus tentáculos de evidência ancoram na cidade. Isso mostra literalmente "por onde a atenção está agora" (nós brilhantes) vs "o que morreu" (constelação apagando).

Orçamento de 60fps: cidade cacheada (0 custo/frame exceto blit), ~10k pontos com culling desenha só os ~centenas visíveis, céu com dezenas de nós é trivial. Timeline/histograma num quarto canvas.

**(b) Trade-offs e modos de falha.** O ponto de quebra honesto: se a camada cognitiva crescer para **milhares** de nós animados simultâneos, Canvas 2D não aguenta e não há WebGL — a cena engasga. Mitigação de projeto: hipóteses são *efêmeras* e limitadas (colapsar nós mortos após decaimento; manter só o "beam" ativo, ex. ≤50 nós vivos). Segundo risco: o treemap congelado + ghosts vira ilegível se a sessão tocar arquivos muito fora do snapshot inicial (o problema do "ghost sem re-layout" que já existe). Terceiro: `OffscreenCanvas` em worker ajuda o main-thread mas some com o hit-testing fácil — manter hit-testing no main via quadtree.

**(c) Desconfiança do treinamento.** O treinamento sugere "force-directed graph / three.js / D3". three.js está proibido; D3 force-layout em 10k+ nós a 60fps em Canvas 2D é irreal. A adjacência enganosa é tratar o cognitivo como *mais um grafo grande* — ele tem que ser deliberadamente *pequeno e efêmero* para caber no orçamento. Code-cities (Wettel/Lanza) são boa referência estética, mas assumem layout estático offline; o desafio aqui é o layout *incremental estável* ao vivo.

### 6. ANTI-FRAGILIDADE

**(a) Proposta concreta — o mapa é um agregado durável, não um espelho do arquivo.** Regra central: **a cena renderiza a partir do event-store append-only local, nunca diretamente do JSONL.** Se o JSONL sumir, o event-store já absorveu tudo que importa via hooks/FS/PTY. Mecânica:
- **Âncora primária = `pane_id`, não `session_id`.** A pane é do app e sobrevive; o session-id/arquivo é volátil. Um mapa `pane_id → session_id(s)` é reversível: se a sessão forka/resume (novo UUID), religa à mesma pane sem apagar o acumulado.
- **Persistência:** o event-store escreve snapshots incrementais (ex. a cada watermark selado) num arquivo próprio do app (`~/.micah/panes/<pane_id>/events.log`), independente do `~/.claude`. Reconstrução da cena = replay do log.
- **Detecção de morte:** `SessionEnd` hook, ou FS-watch de deleção do JSONL, ou PTY EOF, disparam transição de estado da pane para `frozen` (não `empty`). Cena congela no último bom estado com um selo visual "sessão encerrada às HH:MM", nunca acorda vazia.
- **CLI travado:** ausência de qualquer evento por T segundos + spinner ainda no PTY = estado `stalled` (visualmente distinto de `frozen` e de `thinking`).

**(b) Trade-offs e modos de falha.** Duplicar o estado (event-store próprio) custa disco e abre risco de divergência com o JSONL. Aceitável: o event-store é a verdade da *cena*, o JSONL é só enriquecimento. Modo de falha: pane fechada no meio — decidir política (persistir e permitir "reabrir mente" vs descartar). Recomendo persistir com TTL. Risco de religação errada em resume: usar `cwd`+`gitBranch`+proximidade temporal para confirmar que o novo session-id é a continuação daquela pane.

**(c) Desconfiança do treinamento.** O treinamento diria "faça o parser mais robusto a arquivo sumindo". Isso trata o sintoma. A cura é arquitetural: **parar de fazer do arquivo a fonte de verdade**. A adjacência enganosa é "adicione retry/backoff no tail" — inútil se o arquivo foi apagado.

### 7. MEMÓRIA FINAL

**(a) Proposta concreta — o chunk de RAG guarda o que o transcript joga fora.** No `SessionEnd`/`Stop`, o juiz LLM (já existente, headless) recebe NÃO o transcript bruto, mas o **event-store fundido + a árvore cognitiva**. O chunk enriquecido guarda o que hoje se perde:
- **A trajetória de hipóteses vivas→mortas:** "testou race na fila de PTY (h7), matou após 2 tentativas, o fix real foi reduzir poll (h3)". Isso é o *aprendizado*, invisível no JSONL.
- **Proveniência e confiança:** o que a AI *disse* vs o que o FS *confirmou* (rumos alegados mas não realizados = pistas falsas a evitar no futuro).
- **Os pontos de backtrack e replan silencioso** (detectados por padrões, não pelo JSONL).
- **Densidade de atenção por arquivo:** quais arquivos foram o "centro de gravidade" (muitas revisitas) vs tangenciais.
- **Âncoras físicas estáveis:** paths + git SHA + spans de tool, para o RAG religar a memória a estados reais do repo.

Schema do chunk: um resumo em linguagem natural (para embedding) + um bloco estruturado (árvore de hipóteses podada + tabela de evidências corroboradas) + metadados (`pane_id`, `session_id`s, janela temporal, arquivos-centro).

**(b) Trade-offs e modos de falha.** O juiz LLM pode super-narrar (dar coerência retroativa a uma sessão que foi caótica) — mitigar alimentando-o com os *fatos corroborados* e pedindo que marque o especulativo. Guardar cognitivo de baixa confiança (o `because` racionalizado) pode poluir o RAG com pós-racionalizações — marcar proveniência no próprio chunk. Custo: o juiz processa mais dados que o transcript; aceitável no fim de sessão.

**(c) Desconfiança do treinamento.** O treinamento: "resuma o transcript com um LLM" — exatamente o que Rodrigo proíbe, e com razão: resumir o JSONL herda todos os seus buracos (thinking redigido, replan invisível). A adjacência enganosa é confundir *sumarização* (comprimir o que foi contado) com *captura* (gravar o que nunca foi contado). O RAG bom vem da fusão multicanal, não do resumo de um canal pobre.

### 8. PROTÓTIPO (E1)

**(a) Proposta concreta — o experimento mínimo que prova ou mata em 1-2 semanas.** Fundir **exatamente dois canais** e nada mais:
1. **PreToolUse hook** (intenção antes-do-fato) — um binário Rust de ~50 linhas que lê stdin, extrai `tool_name`+`tool_input.file_path`+`tool_use_id`, e escreve numa Unix socket local. Registrado em `~/.claude/settings.json` com matcher `Edit|Write|Read`.
2. **FS watch** (confirmação física) — que o terminal Tauri já tem para outras coisas.

Pipeline: socket → tokio::mpsc → Reconciler (casa hook↔FS por path+janela, atribui confidence) → `ipc::Channel` → um Canvas 2D que acende o ponto do arquivo em **dois estágios visuais**: (i) *intenção* (halo pulsante) no instante do PreToolUse, (ii) *confirmação* (preenchimento sólido) quando o FS bate. Sem cognitivo, sem céu, sem juiz — só a espinha dorsal.

**Métrica que valida "mente ao vivo, não replay":**
- **Primária — "intent-lead":** fração de eventos em que o halo de *intenção* aparece ANTES da mutação física do FS. Meta: > 80%. Isto é a prova de que se vê o futuro-imediato, não o passado. É o teste falsificável do alvo inteiro: se o intent-lead for ~0, o sistema é ontologicamente um replay e a ideia está morta.
- **Primária — "time-to-glow":** distribuição da latência entre o PreToolUse (decisão) e o ponto acender. Meta: p50 < 150ms, p95 < 300ms. Se ficar preso perto de 700ms, é o poll disfarçado = replay.
- **Secundária:** "reconciliation rate" (fração de intenções PreToolUse que o FS confirma em <2s) — mede se a fusão casa os fios certos.

**(b) Trade-offs e modos de falha.** E1 não prova a parte mais difícil (o cognitivo) — mas prova a *fundação* (push real, intenção antes-do-fato, fusão de dois canais) sem a qual o resto é impossível. Se o intent-lead já falhar aqui (ex. hooks têm latência de spawn alta demais numa dada máquina), mata a ideia cedo e barato. Risco: PreToolUse bloqueia a tool — medir também o *overhead imposto à AI* (deve ser <50ms). Modo de falha do experimento: escolher um repo pequeno demais onde tudo é rápido e mascarar latências.

**(c) Desconfiança do treinamento.** O treinamento sugeriria como E1 "faça um dashboard das tool calls" ou "um viewer do JSONL". Ambos provam a coisa errada (que dá pra *replayar*), não a coisa nova (que dá pra ver *ao vivo, antes*). A métrica certa não é "quantas tool calls renderizei" mas "quão à frente do efeito físico eu consigo mostrar a intenção".

## Recommendations

1. **Imediato (semana 1-2): rodar o E1** exatamente como na seção 8. Instrumentar `intent-lead` e `time-to-glow` desde o primeiro commit. **Benchmark de matar:** se `intent-lead < 50%` ou `p95 time-to-glow > 400ms` numa máquina real de dev, pare e reavalie — o alvo pode ser incompatível com a latência de spawn de hooks nessa plataforma.
2. **Se E1 passar: inverter a fonte de verdade (semana 3-5).** Promover hooks+PTY+FS a espinha dorsal; rebaixar JSONL a canal de enriquecimento assíncrono com watermark. Construir o `UnifiedEvent` store append-only ancorado em `pane_id`. **Threshold para avançar:** reconciliação hook↔FS > 90%.
3. **Depois: camada cognitiva (semana 6-9).** Implementar o `MindStateDelta` via tool MCP local `mind_delta` (caminho tool-nativo, mais limpo que injeção de contexto). **Benchmark de valor:** em N sessões, a árvore de hipóteses capturada revela ≥1 backtrack/replan que era invisível no JSONL? Se não revelar nada que o transcript já não mostre, o custo (tokens+latência) não se justifica — recue para deltas *inferidos* por heurística.
4. **Cena cognitiva (semana 10-12):** só depois de ter deltas reais fluindo. Manter ≤50 nós vivos. **Threshold de quebra:** se o frame-time passar de 16ms com a cidade+céu, cortar nós ou cachear mais agressivo antes de sonhar com WebGL.
5. **Memória final por último:** religar o juiz LLM ao event-store fundido (não ao transcript). **Benchmark:** chunks de RAG com trajetória de hipóteses batem o baseline (resumo do transcript) numa avaliação cega de "qual memória ajuda mais a próxima sessão"?
6. **Nunca fazer:** re-tornar o JSONL fonte primária; usar `emit` para o stream de alta frequência; adicionar servidor/broker; crescer o cognitivo para milhares de nós em Canvas 2D.

## Caveats

- **O que é fato verificado vs proposta autoral:** os payloads/timeouts de hooks, o formato do JSONL, as sequências OSC, as limitações do Tauri IPC e o modelo OTel GenAI são **fatos verificados** com fonte. Todo o resto — `UnifiedEvent`, `MindStateDelta`, o esquema de confiança/watermark, a cena em três camadas, as métricas de E1 — é **proposta de arquitetura autoral** construída sobre esses fatos.
- **O elo mais fraco de todo o alvo é o estado cognitivo.** Nenhuma tecnologia captura o raciocínio real de um LLM; a pesquisa mostra que até o thinking-summary da Anthropic é escrito por outro modelo e redigido/encriptado no disco. O que se captura é uma *projeção provocada e barata* + a *estrutura temporal corroborável*. Vender isso como "a mente dela" é honesto só se a UI distinguir o corroborado (fatos) do auto-relatado (narrativa).
- **Risco de plataforma não medido:** a latência de spawn de processo dos hooks varia por SO (Windows tende a ser mais lenta). O `intent-lead` pode ser ótimo em Linux/macOS e ruim em Windows. Medir em todas as plataformas-alvo antes de comprometer.
- **Versões movem-se rápido:** o conjunto de hooks (31-32 eventos), os flags de redação de thinking e o layout de sidechains mudaram entre versões do Claude Code em 2025-2026. Qualquer implementação deve tratar o schema de hook/JSONL como *versionado e instável* e ter um validador de drift.
- **Tauri Channel não tem benchmark oficial de eventos/s;** os números de custo JSON (ex. 600µs vs 6.7ms para 64KB) vêm de benchmarks de terceiros (projetos pequenos, ~3 estrelas). Validar o throughput real no E1 antes de assumir folga.


_______________________________________________________________________________________________________________________________________________


# Live Epistemic Telemetry for Micah: Capturing an AI’s Working State as It Happens

The central architectural conclusion is adversarial to the original target:

**Micah can build a genuinely live map of an agent’s epistemic and operational state. It cannot obtain the model’s literal latent “mind.”** Current Claude interfaces expose actions, displayed text, lifecycle boundaries, tool parameters, tool results, subagent activity, explicit plans, and summarized thinking where available; raw internal chain-of-thought remains inaccessible. Anthropic’s current model documentation explicitly states that raw chain-of-thought is never returned on its newest models and that readable thinking output is a summary rather than the underlying reasoning trace. citeturn14search1turn14search6

That distinction should become an invariant inside the implementation:

> **The scene depicts evidence about the agent’s working state, with provenance and confidence. It never labels an inference as hidden cognition.**

The good news is that the underlying premise that Claude Code gives Micah only a JSONL transcript has become obsolete. The current hook surface includes `MessageDisplay`, `PreToolUse`, `PostToolUse`, `PostToolUseFailure`, `PostToolBatch`, `SubagentStart`, `SubagentStop`, `TaskCreated`, `TaskCompleted`, `FileChanged`, `PreCompact`, `PostCompact`, `Stop`, `StopFailure`, and session lifecycle events. `MessageDisplay` fires while assistant text is being rendered, while `PreToolUse` fires after tool parameters have been constructed but before the tool executes. Claude Code’s own documentation now warns that the transcript file is written asynchronously and may lag the in-memory conversation. citeturn17view0turn16view1turn16view0

That suggests a different architecture entirely:

```text
                      ┌──────────────────────────┐
PTY bytes ───────────►│                          │
Claude hooks ────────►│      Micah MindHub       │
FS events ───────────►│                          │
process events ──────►│  timestamp + correlate  │
editor events ───────►│  preserve raw evidence  │
git/diff checkpoints ►│                          │
self-report deltas ──►│                          │
                      └────────────┬─────────────┘
                                   │
                    ┌──────────────┴──────────────┐
                    │                             │
             append-only WAL               Reconciler
             owned by Micah                     │
                    │                       Claim Graph
                    │                             │
                    │                    Epistemic State
                    │                             │
                    │                    Tauri Channel
                    │                             │
                    │                      Canvas scene
                    │
                    └────────────► Final Memory Capsule
```

The important invention is therefore less “better logging” and more **a local flight recorder plus causal sensor-fusion engine**. JSONL becomes one late witness among several.

## Capture channels

**1. CHANNELS**

### Proposal concrete

There are roughly ten useful signal classes. Their strengths are complementary enough that treating any single one as canonical would repeat the current mistake.

The latency numbers below are **engineering budgets I would measure during E1**, rather than vendor guarantees. For hooks, the important vendor guarantee is causal position: for example, `PreToolUse` is before execution and `PostToolUse` is immediately after successful execution. citeturn16view1turn17view0

| Channel | What it sees uniquely | Timing / Micah target | What it can misrepresent or omit | Collection cost |
|---|---|---|---|---|
| **Raw PTY byte stream** | Everything actually written to or read from the pane: streamed characters, spinner/status changes, permission UI, subprocess output, shell OSC boundaries, raw-mode changes | App already owns bytes; target `<5 ms` PTY→MindHub | Presentation is not semantics. Silence can mean inference, network wait, throttling, blocked input, or hang. ANSI/TUI changes across versions | Very low; already captured |
| **Structural Claude hooks** | Exact lifecycle edges: user prompt, tool intent, result/failure, batches, subagents, tasks, compaction, stop, session lifecycle | Causally precise; target `<15 ms` hook→MindHub | Sees only lifecycle surface Claude Code exposes. A crash can prevent a terminal hook. Some validation failures occur before relevant tool hooks | Low |
| **`MessageDisplay` hook** | Assistant text while it is being rendered, already segmented by message/turn IDs and line batches | Line-batch granularity; target `<15 ms` after hook delivery | Tool-call-only responses contain no assistant text and therefore produce no `MessageDisplay`. It sees displayed assistant text, rather than latent reasoning | Low to moderate because each batch invokes the hook |
| **Filesystem watcher owned by Micah** | Physical file changes regardless of what the agent claims | OS-dependent; acceptance target `<50 ms`, followed by recovery when reliability degrades | Attribution is absent. Human/editor/process changes look alike unless correlated. OS watchers can coalesce or lose events | Low |
| **Claude `FileChanged` hook** | Claude Code’s own observed changes for explicitly watched paths | Hook-time | Current hook watch-list semantics are filename-oriented; inadequate as the sole whole-repository observer | Low but supplementary |
| **Child-process lifecycle** | A command actually spawned something; PID tree, start/end, exit/signal, duration | Target `<10 ms` from process observation | A process can daemonize, fork grandchildren, invoke scripts, or modify state indirectly. Process existence says nothing about semantic purpose | Low if process supervision already exists |
| **Git / content diff / stat checkpoints** | The resulting repository state, exact content mutation, dirty/untracked state, semantic diff | On demand; repository-size dependent | It is after-the-fact. Git state says little about actor or intent; working tree can contain unrelated human changes | Moderate, so run at boundaries rather than continuously |
| **Explicit model self-report** | Hypothesis, goal, next experiment, branch rejection, uncertainty, decision | Same response stream as the marker it emits | It is a claim made by the model. It can omit, rationalize, become stale, or comply inconsistently | Token cost + mild behavioral perturbation |
| **Native task/subagent state** | Explicit decomposition and delegation when the agent chooses those features | Event edge | Sparse when the model works without formal tasks/subagents | Very low |
| **JSONL transcript** | Durable-ish conversation history, tool blocks, older replay compatibility | In Micah currently 60–700 ms polling, plus asynchronous writer lag | Late, mutable external ownership, format/version coupling, potential disappearance | Already implemented |
| **Built-in OpenTelemetry** | Prompt correlation, API events, tool results, tool decisions, request IDs, sequence numbers | Default log export interval is 5 seconds | Far too slow as the main live path; assistant-response events omit thinking and tool-use blocks | Useful mainly for validation/testing under these constraints |

Claude Code hooks now carry useful correlation fields including `session_id`, and on recent versions `prompt_id`; the docs explicitly identify `prompt_id` as matching OpenTelemetry’s `prompt.id`. Hooks running inside subagents additionally carry unique `agent_id` and `agent_type`. citeturn16view0

`MessageDisplay` is particularly important because it fires during interactive rendering in batches of newly completed lines and provides `turn_id`, `message_id`, `index`, `final`, and `delta`. Claude Code holds each batch until the hook returns, so a Micah hook attached here must remain extremely small. Tool-only assistant messages produce no `MessageDisplay` event, which prevents this channel from being treated as complete. citeturn16view1

`PreToolUse` gives Micah something the JSONL architecture fundamentally lacked: **a before-execution event**. It fires after Claude has generated `tool_name`, `tool_input`, and `tool_use_id`, yet before the actual tool is processed; paths supplied to built-in file tools are normalized to absolute paths before the hook runs. citeturn16view1

`PostToolUse` then closes the causal loop with the same tool input, the tool response, matching `tool_use_id`, and optional `duration_ms`; `PostToolUseFailure` covers execution failures. `PostToolBatch` fires once after all parallel calls in a batch have resolved and before the next request goes to the model, which makes it an unusually valuable semantic boundary: **evidence has arrived, and reassessment is about to occur**. citeturn17view0turn16view3

Subagents are considerably more observable now than a parent transcript suggests. `SubagentStart` exposes a unique `agent_id` and type; hooks inside subagents carry those identifiers, while `SubagentStop` includes the final assistant message and a separate subagent transcript path. citeturn17view1

OpenTelemetry should remain a validation sensor rather than the core path. Claude Code supplies `prompt.id`, monotonically increasing event sequence values, and `tool_use_id` joins between telemetry and hook events, but the default logs exporter interval is 5,000 ms. Its current `assistant_response` event also contains text blocks while excluding thinking and tool-use blocks. citeturn19view0turn19view1turn19view2

### The channel hierarchy I would implement

Think in **sensor families**, because several nominally different channels share the same failure source:

```text
A. Claude control plane
   hooks, native task events, OTel

B. OS effect plane
   filesystem, process lifecycle

C. presentation plane
   PTY, TUI rendering, OSC

D. repository-state plane
   diff, status, content snapshot

E. epistemic assertion plane
   explicit mind-state deltas / visible narration

F. archival plane
   JSONL
```

This matters later: a hook and an OTel event agreeing with each other should not receive the same evidentiary weight as a hook plus an independently observed disk mutation.

### Trade-offs and failure modes

Filesystem watching is useful precisely because it is independent of the agent, yet it is an imperfect audit log. Linux `inotify` can coalesce identical pending events and can overflow its queue; its documentation also states that it provides no identity for the process or user that caused a change. Windows `ReadDirectoryChangesW` can discard the entire contents of its change buffer after overflow and advises re-enumerating the directory in that case. Apple’s FSEvents is designed for hierarchy-level change detection and is explicitly described as unsuitable for fine-grained per-file monitoring. citeturn18search0turn18search1turn18search5

Consequently:

**FS watch = immediate evidence, diff/status = healing evidence.**

A watcher overflow should trigger a recovery scan rather than silently lowering truth quality.

PTY is the inverse: it has excellent temporal fidelity but poor semantic fidelity. A spinner reading “thinking” could be display logic rather than proof of model computation. I would store it as:

```text
cli_reports_thinking
```

rather than:

```text
model_is_thinking
```

That distinction will save the product from making claims it can never substantiate.

### Adjacent idea I would reject

**“Unified observability dashboard.”**

OpenTelemetry, traces, logs, spans, distributed tracing, and session-replay tooling are all adjacent. They solve *reconstructing what a system did*. They generally assume observable events are the object of interest.

Micah needs something different: **the live relationship between assertions, intentions, actions, effects, evidence, and abandoned branches.**

That is closer to an aircraft flight recorder plus an epistemic notebook than to Grafana.

## Evidence fusion and causal ordering

**2. FUSION**

### Proposal concrete

Use two layers rather than folding everything immediately into one event type:

1. **Immutable Observation Ledger**
2. **Mutable Claim Graph**

The observation ledger records exactly what each sensor said.

The claim graph represents Micah’s current best interpretation of those observations.

That separation is crucial. Otherwise every parser mistake rewrites history.

### Raw envelope

I would make every sensor emit this minimal envelope:

```ts
type MindEvent = {
  v: 1;

  event_id: string;
  run_id: string;          // Micah-owned identity
  pane_id?: string;

  session_id?: string;     // Claude alias, never primary identity
  prompt_id?: string;
  agent_id?: string;

  source:
    | "hook"
    | "pty"
    | "fs"
    | "process"
    | "git"
    | "editor"
    | "self_report"
    | "transcript"
    | "otel";

  source_family:
    | "claude_control"
    | "os_effect"
    | "presentation"
    | "repo_state"
    | "epistemic_assertion"
    | "archive";

  source_seq?: number;
  ingest_seq: number;

  occurred_wall_ms?: number;
  observed_mono_ns: number;

  kind: string;

  correlation: {
    tool_use_id?: string;
    pid?: number;
    path?: string;
    turn_id?: string;
    message_id?: string;
    task_id?: string;
    hypothesis_id?: string;
  };

  payload: unknown;
};
```

The dual-clock design matters. OpenTelemetry itself distinguishes `Timestamp`, when an event occurred, from `ObservedTimestamp`, when the collecting system observed it. Inside a single Micah process, Rust’s `Instant` provides a monotonically nondecreasing clock suitable for measuring local ordering and delays. citeturn18search3turn20search1

Use:

```text
wall time      => user-facing timestamps, cross-process approximate alignment
monotonic time => durations and local receive order
source_seq     => order guaranteed by one producer
ingest_seq     => order in which MindHub accepted events
causal edges   => actual semantic ordering
```

**Never total-order everything solely by wall-clock timestamp.**

Lamport’s classic result is relevant here: causality provides a meaningful ordering relation even when clocks themselves cannot give you one. Micah has an easier problem than a distributed cluster because everything converges locally, but parallel subagents, hook processes, PTY parsing, FS delivery, and OS callbacks still produce observation races. citeturn20search2

### Claim layer

A claim should be separately represented:

```ts
type MindClaim = {
  claim_id: string;

  subject: string;       // toolu_x, file path, hypothesis id, agent id...
  predicate: string;     // intends_edit, mutated, supports, rejected...
  value: unknown;

  status:
    | "asserted"
    | "observed"
    | "corroborated"
    | "contradicted"
    | "superseded";

  confidence:
    | "heuristic"
    | "single_source"
    | "corroborated"
    | "authoritative";

  supports: string[];    // event IDs
  conflicts: string[];

  first_seen_seq: number;
  last_updated_seq: number;
};
```

I would deliberately avoid pretending that `confidence: 0.87` means an actual calibrated 87% probability.

For E1, categorical evidence quality is intellectually cleaner:

```text
H = heuristic
S = one direct sensor
C = corroborated by independent sensor families
A = authoritative artifact/lifecycle closure
```

Later, once Micah has thousands of labeled replay sessions, those classes can be empirically calibrated into numeric probabilities.

### Truth ownership

Different facts need different authorities:

| Question | Primary truth source | Secondary corroboration |
|---|---|---|
| “What tool is about to execute?” | `PreToolUse` | PTY |
| “What arguments did Claude choose?” | `PreToolUse` | OTel / transcript later |
| “Did Claude’s built-in tool report success?” | `PostToolUse` | OTel |
| “Did a process really start?” | OS process observation | PTY |
| “What was its exit state?” | OS process observation | tool result |
| “Did bytes on disk actually change?” | FS/content snapshot | git/diff |
| “What is the final repository mutation?” | content/git diff | FS |
| “What assistant text appeared?” | `MessageDisplay` / PTY | transcript later |
| “What hypothesis does the agent claim to hold?” | explicit mind delta | visible narration |
| “What is the agent truly thinking internally?” | unavailable | unavailable |
| “Which branch was abandoned?” | explicit mind delta, or deterministic behavioral inference labeled as such | later narration |
| “Did a subagent exist?” | `SubagentStart/Stop` | process/transcript |
| “Did compaction occur?” | `PreCompact/PostCompact` | transcript |

### Reconciliation example

Suppose Claude says:

```text
I think auth/cache.ts is retaining an expired token.
```

Then:

```text
t0 self_report:
   hypothesis H7 active
   target auth/cache.ts
   confidence self_asserted=0.61

t1 PreToolUse:
   Read auth/cache.ts
   tool_use_id=T12

t2 PostToolUse:
   T12 success

t3 self_report:
   H7 -> testing
   next="invalidate cache and rerun auth test"

t4 PreToolUse:
   Edit auth/cache.ts
   tool_use_id=T13

t5 FS:
   auth/cache.ts modified

t6 PostToolUse:
   T13 success

t7 PreToolUse:
   Bash "cargo test auth..."
   tool_use_id=T14

t8 process:
   child PID 4817 started

t9 process:
   PID 4817 exit=0

t10 PostToolUse:
    T14 success

t11 self_report:
    H7 -> supported
```

The scene can show H7 at `t0`.

At `t4`, it can show:

> **imminent mutation**

At `t5`, that becomes:

> **disk mutation observed**

At `t6`:

> **tool reports success**

At `t9/t10`:

> **verification passed**

These are separate truths rather than one synthetic “Claude fixed it” event.

### Out-of-order events

Never pause the live UI waiting for certainty.

Instead:

```text
PreToolUse arrives
    ↓
show provisional action immediately

FS event arrives 6 ms later
    ↓
upgrade mutation claim

PostToolUse arrives
    ↓
close tool activity

git checkpoint arrives later
    ↓
upgrade resulting-state claim
```

If a late event contradicts an earlier inference, mutate the **claim**, while preserving the **observations**.

That gives you retroactive correction without history rewriting.

### Human + AI mixed edits

File mutation attribution deserves special treatment.

If:

```text
Claude PreToolUse(Edit X)
```

is followed by:

```text
FS X changed
```

within a short window, this is strong evidence that they belong together.

Yet if Micah’s own editor simultaneously reports a human modification of X, attribution becomes ambiguous.

Represent that ambiguity:

```json
{
  "predicate": "mutation_origin",
  "value": ["agent:T13", "editor:user"],
  "status": "corroborated",
  "ambiguity": true
}
```

Avoid “nearest timestamp wins” as a universal rule.

### Trade-offs and failure modes

The biggest trap is **false independence**.

These:

```text
Claude hook says tool succeeded
Claude OTel says tool succeeded
Claude transcript says tool succeeded
```

are three records produced by essentially one control plane.

This:

```text
Claude hook says edit succeeded
OS saw file mutation
content snapshot confirms bytes changed
```

is genuinely stronger.

Hence `source_family`.

### Adjacent idea I would reject

**Bayesian sensor fusion with hand-chosen priors.**

It sounds sophisticated and would produce beautiful `0.93` confidence values. It would also be numerically theatrical until calibrated against real failure data.

Start with explicit provenance and discrete evidence grades. Earn probabilities later.

## Cognitive state representation

**3. COGNITIVE STATE**

### The hard boundary

This is where I would attack the premise most strongly.

A silent internal replan can remain invisible forever.

A model can internally:

```text
consider A
reject A
consider B
notice contradiction
return to A'
```

and expose only:

```text
Edit(foo.rs)
```

Under the interfaces available to Micah, there is no passive sensor that can recover those hidden transitions afterward. Current Anthropic interfaces expose summarized thinking rather than raw underlying chain-of-thought on current models. citeturn14search1turn14search6

So there are only three honest classes of “cognitive” state:

```text
EXPLICIT
The agent deliberately externalized it.

BEHAVIORALLY INFERRED
Micah inferred it from actions/evidence.

UNOBSERVED
Micah lacks evidence.
```

That third state must be legal.

Otherwise the product will inevitably hallucinate a coherent mind.

### Proposal concrete: Epistemic DAG

The state model should be a tiny DAG rather than another chronological event list.

Node kinds:

```text
goal
question
hypothesis
plan
test
finding
decision
unknown
```

Useful transitions:

```text
open
focus
update
support
reject
park
resume
resolve
supersede
```

Useful edges:

```text
decomposes
tests
supports
refutes
depends_on
supersedes
backtracks_to
caused_by
targets
```

The killer feature is **preserving rejected branches**.

A dead idea should fade visually while staying in the graph.

That is the difference between:

> “The agent edited four files.”

and:

> “It suspected the parser, disproved that with test A, shifted to the cache layer, fixed B, then validated C.”

### Minimal `mind-state delta`

I would keep v1 aggressively small:

```ts
type MindStateDelta = {
  v: 1;

  node_id: string;
  parent_id?: string;

  op:
    | "open"
    | "focus"
    | "update"
    | "support"
    | "reject"
    | "park"
    | "resolve";

  kind:
    | "goal"
    | "question"
    | "hypothesis"
    | "plan"
    | "test"
    | "finding"
    | "decision";

  summary: string;      // hard cap, e.g. 120 chars

  targets?: string[];   // file/symbol/task IDs

  caused_by?: string[]; // event/tool/hypothesis IDs
  next?: string;        // short next observable test/action

  asserted_confidence?: number;
};
```

A real sequence:

```json
{
  "v": 1,
  "node_id": "h7",
  "op": "open",
  "kind": "hypothesis",
  "summary": "Refresh token cache survives invalidation",
  "targets": ["src/auth/cache.ts"],
  "asserted_confidence": 0.55
}
```

Then:

```json
{
  "v": 1,
  "node_id": "h7",
  "op": "update",
  "kind": "hypothesis",
  "summary": "Cache path reproduces stale-token failure",
  "caused_by": ["toolu_test_17"],
  "next": "Invalidate cache before refresh",
  "asserted_confidence": 0.78
}
```

Then:

```json
{
  "v": 1,
  "node_id": "h7",
  "op": "support",
  "kind": "hypothesis",
  "summary": "Invalidation fixes reproducer",
  "caused_by": ["toolu_test_19"]
}
```

A failed hypothesis:

```json
{
  "v": 1,
  "node_id": "h3",
  "op": "reject",
  "kind": "hypothesis",
  "summary": "Parser drops refresh token",
  "caused_by": ["toolu_test_08"]
}
```

That final record is extremely valuable later for memory.

### Important semantic rule

`asserted_confidence` belongs to the agent.

It is **not Micah’s evidence confidence**.

Store them independently:

```text
agent_asserted_confidence = 0.78
evidence_grade = corroborated
```

This prevents:

> “Claude feels 90% confident”

from turning into:

> “Micah believes this is 90% true.”

### How the agent emits it

There should be two implementations.

#### Micah’s own in-app agent

Give it a native internal action:

```text
mind_delta(delta)
```

It need not be exposed as an ordinary user-visible tool.

This is the clean implementation because Micah controls that agent protocol.

#### External Claude Code in a PTY

For E1, avoid an MCP server and avoid an upstream fork.

Use a **tiny explicit output protocol** established at session start:

```text
When your working goal, hypothesis, rejected approach, or next test
materially changes, emit one compact line:

<MICAH_STATE {...}>

Emit only externally useful state, not private chain-of-thought.
Skip the marker when state is unchanged.
```

Capture it through `MessageDisplay`.

`MessageDisplay` is unusually suitable because it receives assistant text during rendering and can replace what the terminal displays without changing the original transcript or what Claude itself sees. That means Micah can consume the telemetry line and return `displayContent` with that line removed from the visible terminal. citeturn16view1

For example, the user sees:

```text
I found the issue. I’m checking the cache invalidation path.
```

while Micah internally receives:

```text
<MICAH_STATE {"node_id":"h7",...}>
```

### Why I would avoid “tell me your reasoning”

The protocol should request:

```text
current hypothesis
next experiment
material evidence
branch disposition
decision
```

rather than a detailed reasoning transcript.

This makes the telemetry useful, cheap, and structurally distinct from chain-of-thought.

You need **state**, rather than prose reasoning.

### Automatic fallback when self-report is absent

Micah can synthesize low-trust nodes:

```text
PreToolUse(Read X)
    → machine_intent:
      "Inspect X"

PreToolUse(Edit X)
    → machine_intent:
      "Attempt mutation of X"

PostToolUseFailure(T)
    → observed finding:
      "Attempt T failed"

three edits to same target + failed tests
    → inferred:
      "Repeated revision cycle"
```

But labels must expose provenance:

```text
◆ agent asserted
● observed
◇ Micah inferred
```

The scene can still be useful during silent agents; it simply becomes less semantically rich.

### A useful live state machine below the hypothesis graph

Even without self-report, Micah can know more than today:

```text
USER_PROMPT
    ↓
AWAITING_MODEL_OUTPUT
    ↓
NARRATING             MessageDisplay
or
ACTION_IMMINENT       PreToolUse
    ↓
TOOL_RUNNING
    ↓
TOOL_SUCCEEDED / TOOL_FAILED
    ↓
REASSESSMENT_WINDOW   PostToolBatch
    ↓
NARRATING / ACTION_IMMINENT / STOP
```

Crucially, label the first state `awaiting model output`, rather than `thinking`.

`PostToolBatch` is a real lifecycle edge before the next model request, making `REASSESSMENT_WINDOW` a defensible process state even though the exact thoughts within it remain hidden. citeturn16view3

### Trade-offs and failure modes

Self-report changes the system being observed.

It costs tokens.

The model can forget to emit it.

It can rationalize a branch change after the fact.

A prompt encouraging frequent telemetry can make the coding agent more verbose or alter its decision strategy.

Therefore E1 must measure **observer effect**:

```text
with telemetry protocol
versus
without telemetry protocol
```

Measure:

```text
task duration
tool-call count
output tokens
telemetry compliance
```

The protocol earns its place only if semantic gain outweighs behavioral perturbation.

### Adjacent idea I would reject

**“Use another LLM to infer the agent’s state continuously.”**

That turns one opaque inference process into two opaque inference processes.

It also moves semantic interpretation later in time and risks manufacturing elegant narratives out of sparse actions.

A deterministic graph fed by explicit assertions and causal evidence is more honest.

An LLM can enrich the memory afterward; it should not be the realtime truth engine.

## Push transport and backpressure

**4. STREAMING REAL**

### Proposal concrete

There is a surprisingly clean path available in current Claude Code:

```text
Claude hook
   │ JSON stdin
   ▼
micah-hook helper
   │ returns terminalSequence
   ▼
Claude Code writes OSC 777
through its own terminal path
   │
   ▼
Micah-owned PTY
   │
   ▼
existing OSC parser
   │
   ▼
MindHub
```

Current Claude Code explicitly supports `terminalSequence` in hook output, restricts it to an allowlist that includes OSC 777, and explains that hooks themselves have no controlling terminal. Claude Code emits the requested sequence through its own terminal write path; the documentation describes this path as race-free in interactive sessions. citeturn16view2

That is almost tailor-made for Micah.

You already own OSC 777.

### Hook wire protocol

Reserve a namespace:

```text
OSC 777 ; micah.mind ; v1 ; <payload> BEL
```

For example conceptually:

```text
ESC ] 777 ; micah.mind ; v1 ; <compact-event> BEL
```

I would avoid shipping arbitrary large JSON through the terminal.

The hook helper should reduce:

```json
{
  "hook_event_name": "PreToolUse",
  "session_id": "...",
  "prompt_id": "...",
  "agent_id": "...",
  "tool_use_id": "...",
  "tool_name": "Edit",
  "tool_input": {
    "file_path": "/repo/src/auth/cache.ts"
  }
}
```

to something like:

```json
{
  "e":"pre",
  "s":"abc",
  "p":"p123",
  "a":"main",
  "t":"toolu_17",
  "n":"Edit",
  "f":"/repo/src/auth/cache.ts"
}
```

No tool-response bodies.

No 60-KB output.

No transcript text.

### Zero-runtime helper

Build:

```text
micah
micah-hook
```

from the existing Rust workspace.

`micah-hook` does only:

```text
read stdin
parse JSON
select fields
encode OSC packet
write hook response JSON
exit
```

No daemon.

No socket.

No HTTP listener.

No package manager dependency.

No second runtime.

This can stay a few hundred lines.

### Why OSC instead of writing directly to Micah storage

Because the PTY already establishes:

```text
process → correct pane → correct Micah instance
```

The terminal itself becomes a trusted local routing bus.

The hook requires neither discovery nor IPC endpoint configuration.

The OSC packet automatically follows the agent’s own PTY.

That is the strongest new architectural idea I see in the whole problem.

### Backend → frontend

Use a Tauri `Channel<T>`.

Avoid emitting one Tauri event per Mind event.

Tauri’s own documentation says its generic event system is intended for small amounts of data and is unsuited to low-latency/high-throughput traffic; Channels are designed for fast, ordered delivery and are used internally for streaming cases such as child-process output. citeturn14search0

Pattern:

```text
React starts Mind panel
       │
       │ invoke("subscribe_mind", Channel)
       ▼
Rust stores channel sender
       │
       │ ordered batches
       ▼
React receives MindFrame[]
```

Use `invoke` to **establish the subscription**, rather than once per event.

### MindHub internals

```text
              high-priority
hooks ───────► queue ─────┐
process ─────►            │
                          ▼
                      Reconciler
                          │
                          ├──► WAL writer
                          │
                          └──► UI coalescer
                                  │
             low-priority         │ every frame/window
PTY hints ──► coalescing queue ────┘
FS bursts ──►
```

With the zero-new-dependency requirement, Rust’s standard `sync_channel` gives you a bounded FIFO channel and therefore a natural primitive for putting a hard ceiling on pending work. citeturn20search0

### Backpressure policy

Divide events into three classes.

**Lossless structural**

```text
run started/stopped
PreToolUse
PostToolUse
PostToolUseFailure
hypothesis opened/rejected/resolved
subagent start/stop
process exit
compaction
WAL corruption/source degradation
```

These reach the WAL.

**Coalescible state**

```text
file modify bursts
repeated focus on same target
progress percentage
repeated process stdout activity
camera-focus updates
```

Keep latest state per key.

**Ephemeral presentation**

```text
spinner frames
PTY byte activity
animation pulses
partial progress decoration
```

These can disappear from the UI under pressure.

The raw PTY terminal already has its own stream path; Mind should never duplicate every byte into its own event bus.

### Fifty events per second

Fifty structural events per second is small.

The mistake would be:

```text
50 events
× React state update
× 10,000 points recomputed
× render
```

Instead:

```text
50 events/sec
      ↓
Rust reconcile immediately
      ↓
batch until next UI frame
      ↓
1 Channel message containing N deltas
      ↓
mutate Canvas model
      ↓
one requestAnimationFrame
```

Under a larger burst:

```text
frame 1:
  43 events arrive

backend:
  preserve 8 structural
  coalesce 25 repeated updates into 4 state changes
  suppress 10 decorative duplicates

frontend:
  consume 12 changes once
```

### React architecture

Keep the high-frequency scene model outside React reconciliation.

Conceptually:

```ts
const mindModelRef = useRef<MindSceneModel>(...);

channel.onmessage = batch => {
  mindModelRef.current.apply(batch);
  requestDraw();
};
```

React owns:

```text
toolbar
filters
timeline controls
selected-item inspector
pane chrome
```

Canvas owns:

```text
10k points
pulses
arcs
hypothesis nodes
animations
focus
```

### Reconnect semantics

The frontend stream itself is expendable.

If the webview disappears:

```text
MindHub keeps accepting events
WAL keeps recording
claim graph keeps updating
```

When React reconnects:

```text
invoke get_mind_snapshot(run_id)
      ↓
snapshot
      ↓
Channel resumes from generation G
```

Never force the frontend to be part of durability.

### Trade-offs and failure modes

There is one particularly important performance risk: `MessageDisplay`.

Claude Code waits for each display batch’s hook to return before rendering it, so a slow semantic hook directly harms perceived streaming latency. citeturn16view1

Therefore:

```text
micah-hook:
    parse
    forward
    exit
```

It should perform zero graph updates, zero filesystem work, zero LLM calls, zero classification.

Measure hook overhead.

If `MessageDisplay` creates measurable UI degradation, PTY text can serve as the fallback semantic-text sensor while structural hooks stay enabled.

### Adjacent idea I would reject

**Tauri `emit()` everywhere.**

It looks simpler and will probably work in a demo.

It is exactly the wrong abstraction for a long-lived ordered telemetry stream, according to Tauri’s own distinction between events and channels. citeturn14search0

## Cognitive scene design

**5. SCENE**

### Proposal concrete

Keep the city.

Do not replace it with a graph.

The frozen file treemap is valuable because it gives the user **spatial memory**:

> “Auth lives over there; tests are down there; this agent keeps bouncing between those two neighborhoods.”

A force-directed graph would destroy that property.

Instead build a **semantic atmosphere over the existing city**.

```text
                     hypothesis H4
                         ◉
                       / │ \
                      /  │  \
                evidence │   next test
                    /    │
                   ▼     ▼
            ┌────────────────────┐
            │ FILE CITY          │
            │                    │
            │   ·  ·  ● X        │
            │ ·  ●  · ·          │
            │            ● Y     │
            └────────────────────┘
```

Think:

```text
ground = repository truth
sky    = epistemic state
light  = current activity
trails = causal movement
```

### Visual grammar

#### Goal

A goal should be persistent and quiet.

Place it near the centroid of its active target region, or in a stable reasoning rail when it has no file target.

#### Active hypothesis

Render as a small constellation above its target region:

```text
         H3
        ◉
      ╱ │ ╲
     X  Y  Z
```

Its position is derived from the weighted centroid of the target files.

#### Imminent tool action

`PreToolUse` creates a fast pulse from the active hypothesis toward the target:

```text
H3  ─────────► cache.ts
```

This is the **future edge** the current city lacks.

It is defensible because `PreToolUse` is causally before execution. citeturn16view1

#### Tool in progress

A halo remains around the destination while the tool is open.

#### Evidence returns

Post result produces a reverse pulse:

```text
cache.ts ───────► H3
```

The cognitive node changes state only after evidence reconciliation.

#### Rejected branch

Never erase it immediately.

Collapse it into a dim “dead branch” marker:

```text
H2 ×
```

with a faint tether to the evidence that killed it.

This is one of the most valuable things the visualization can show.

#### Backtrack

Treat backtracking as a first-class edge:

```text
H4 → rejected
       │
       └────► H2' resumed
```

A branch that returns should visibly re-illuminate rather than creating a visually unrelated hypothesis.

#### Targetless cognition

Some important states have no file:

```text
"API contract may be wrong"
"Need clarification from user"
"Likely dependency issue"
"Current approach too invasive"
```

Give these a stable **reasoning rail** around or above the city.

Avoid putting them arbitrarily at `(0,0)`.

### The user should be able to read causality in one second

Example:

```text
            [H1 parser bug] ×
                  │
                  │ refuted by
                  ▼
             test_parser

        [H2 stale cache] ◉
             │       │
       read cache   test auth
             │       │
             └──► EDIT
                    │
                    ▼
                   PASS
```

A user can see:

1. first route died,
2. second route is current,
3. one edit occurred,
4. a test confirmed it.

That is meaningfully beyond “yellow dot changed.”

### Preserve existing file semantics

Your current color encoding already means:

```text
seen
read
edited
untouched
```

Keep those meanings stable.

Encode epistemic information through:

```text
shape
size
stroke
arc direction
opacity
motion
labels
```

rather than overloading file color.

### Sixty FPS with ten thousand files

I would build the Canvas model around three complexity tiers:

```text
STATIC / SEMI-STATIC
10k file points
treemap geometry
labels at coarse zoom

DYNAMIC
recently touched files
active trails
current tool

VERY SMALL DYNAMIC
active hypotheses
goals
tests
decisions
```

The cognitive graph should usually have tens of live nodes, rather than thousands.

Implementation:

```text
city geometry
    ↓
pre-group points by touch state
    ↓
cache drawing paths / raster for current camera transform

cognitive nodes
    ↓
layout only when graph changes
    ↓
render each frame while animating
```

Avoid running a force simulation every frame.

A deterministic placement rule is better:

```text
anchor = centroid(target files)

slot = hash(node_id) mod radial_slots

position =
  anchor +
  radial_offset(slot, sibling_count)
```

Then do collision adjustment **once on state change**.

### One visible Canvas, cached ground layer

A useful low-complexity optimization:

```text
hidden Canvas2D:
    cached city for current camera transform

visible Canvas2D each frame:
    drawImage(cached city)
    draw recent activity
    draw cognition
    draw transient animation
```

During pan/zoom:

```text
invalidate city cache
rebuild
```

During normal agent animation:

```text
reuse city cache
```

No WebGL dependency.

No scene graph dependency.

No framework runtime.

Benchmark this on the actual Tauri webviews rather than assuming Chrome desktop results transfer exactly.

### Camera behavior

The camera should follow **attention**, rather than individual events.

A bad design:

```text
Read A → camera jumps
Read B → camera jumps
Read C → camera jumps
```

A better rule:

```text
active hypothesis target centroid
             ↓
       focus region

if focus remains inside inner 70% of viewport:
    keep camera still

if focus exits:
    gently reveal it

after user pan/zoom:
    suspend auto-follow for interaction lease
```

That preserves agency.

A cluster of 30 parallel reads should widen focus rather than produce 30 camera movements.

### Decay

Files retain historical visitation state.

Cognitive activity has temporal decay:

```text
active hypothesis       full
recent hypothesis       dim
rejected hypothesis     ghost
old dead branches       compact glyph
```

The user can expand ghosts through timeline scrubbing.

This is better than deleting them, because rejected reasoning becomes part of the session’s value.

### Trade-offs and failure modes

The greatest design risk is **visual epistemic overclaiming**.

Smooth animation creates psychological authority.

A beautiful line from H1 to file X can feel like evidence that the model genuinely “looked mentally” at X before acting.

Therefore every node needs provenance encoded in its appearance:

```text
solid       direct observation
double-ring agent assertion
dashed      Micah inference
```

The distinction matters more than visual polish.

A second risk is semantic clutter. If every read creates a cognitive node, you rebuilt a trace viewer in the sky.

Only material state changes belong in the cognitive layer.

### Adjacent idea I would reject

**Force-directed knowledge graph / three-dimensional neural-network visualization.**

It is visually seductive and operationally wrong.

It destroys the stable geography already established by the treemap, constantly repositions concepts, adds expensive layout work, and implies structural knowledge beyond the evidence.

The right metaphor is closer to:

> **weather and constellations over a persistent city**

than:

> **brain graph floating in space.**

## Durable session identity and failure recovery

**6. ANTI-FRAGILITY**

### Proposal concrete

The current fatal coupling is:

```text
Mind identity = Claude transcript path
```

Replace it with:

```text
Mind identity = Micah run UUID
```

Everything else becomes an alias.

```ts
type RunIdentity = {
  run_id: string;              // Micah owns forever

  panes: string[];

  claude_sessions: {
    session_id: string;
    transcript_path?: string;
    first_seen_seq: number;
    last_seen_seq?: number;
  }[];

  agents: string[];

  repo_root: string;
  started_at: number;

  status:
    | "active"
    | "dormant"
    | "ended"
    | "aborted"
    | "recovering";
};
```

The transcript can:

```text
move
vanish
compact
fork
change session ID
```

without changing `run_id`.

Current Claude hooks explicitly distinguish session-start modes including startup, resume, clear, compact, and fork, so a current implementation can use those events to rebind Claude identities onto a Micah-owned run. citeturn17view3

### Micah-owned local ledger

For each run:

```text
app-data/
  mind/
    <run-id>/
      events.ndjson
      snapshot.json
      metadata.json
```

The raw ledger is append-only:

```json
{"ingest_seq":1,...}
{"ingest_seq":2,...}
{"ingest_seq":3,...}
```

Snapshot:

```json
{
  "through_seq": 19283,
  "claims": {...},
  "epistemic_graph": {...},
  "files": {...},
  "source_health": {...}
}
```

Startup:

```text
load snapshot
     ↓
replay ledger after through_seq
     ↓
scene restored
```

Claude’s transcript becomes:

```text
source: archive/claude-jsonl
health: missing
```

rather than:

```text
entire Mind state = empty
```

### Durability policy

Avoid `fsync` on every tiny event.

Suggested first implementation:

```text
append continuously
flush buffered data frequently

force stronger durability at:
    tool batch boundary
    hypothesis resolution
    Stop
    pane close
    app shutdown
```

The exact intervals should be benchmarked.

Snapshots can use:

```text
snapshot.tmp
write
flush
rename -> snapshot.json
```

so an interrupted snapshot leaves the prior one available.

### CLI crashes

Clean shutdown hooks are useful but cannot be the foundation of lifecycle truth.

`SessionEnd` fires for documented orderly termination cases and carries an exit reason; `StopFailure` covers API-level turn failures. A hard process death can bypass application-level cleanup, so the child process supervisor should synthesize the final observation when necessary. citeturn17view2turn17view0

Example:

```text
last hook:
    PreToolUse Bash T19

PTY:
    disappears

process supervisor:
    claude child exit signal=KILL

MindHub synthesizes:
    agent_process_lost
    open tool T19 => outcome unknown
    run => aborted
```

The scene stays visible.

Open nodes simply acquire:

```text
status = interrupted
```

### Pane closes halfway through

Closing a pane should mean:

```text
display attachment removed
```

rather than:

```text
memory deleted
```

Depending on whether the process is killed:

```text
pane closed, process survives
    → run dormant/detached

pane closed, process dies
    → run aborted/ended
```

Either way the previous mental map remains selectable.

### Transcript disappears

Exactly one state transition:

```text
source_health.transcript =
    healthy → missing
```

No graph deletion.

No city reset.

No loss of current memory.

### Filesystem watcher failure

Watcher overflow should produce its own first-class event:

```json
{
  "kind": "sensor_degraded",
  "source": "fs",
  "payload": {
    "reason": "overflow"
  }
}
```

Then:

```text
pause high-confidence FS attribution
run repository reconciliation
rebuild watcher state
resume
```

That recovery strategy follows the documented reality that Linux and Windows change watchers can lose information under overflow conditions; Linux documentation explicitly advises cache reconstruction as a robust response, while Windows advises re-enumerating the watched subtree after buffer loss. citeturn18search0turn18search1

### Compaction

Compaction should itself appear in the graph:

```text
context epoch 4
     │
     ├── compact
     ▼
context epoch 5
```

`PostCompact` currently exposes the generated `compact_summary`, giving Micah an additional artifact to preserve while still treating its own graph as the canonical accumulated state. citeturn17view2

This could become visually useful:

```text
━━ session memory currently in model context
░░ older Micah-observed knowledge outside current model context
```

That would let the user literally see when **Micah remembers something the active agent may have compacted away**.

That is a genuinely new capability.

### Version drift

Current Claude Code event schemas include feature/version gates; for example, the hook `prompt_id` field requires v2.1.196 or later according to current documentation. citeturn16view0

Record CLI capability at run start:

```json
{
  "adapter": "claude-code",
  "version": "...",
  "capabilities": {
    "prompt_id": true,
    "message_display": true,
    "post_tool_batch": true
  }
}
```

Adapters should degrade, rather than assuming one eternal hook contract.

### Trade-offs and failure modes

Micah’s own WAL can itself corrupt.

Therefore the parser should tolerate a partial final NDJSON record exactly as transcript tailers usually do:

```text
read complete lines
retain incomplete tail
```

Periodic snapshots cap replay work.

The next failure mode is semantic schema drift. Solve this through versioned events:

```text
v: 1
```

and migrations at the derived-state layer.

Raw source events should remain immutable.

### Adjacent idea I would reject

**“Copy the Claude transcript into Micah so it cannot disappear.”**

That fixes storage ownership while preserving every deeper limitation:

```text
still delayed
still tool-oriented
still cognitively sparse
still vendor-schema coupled
```

The durable asset has to be Micah’s **multisensor evidence ledger**, rather than a safer copy of someone else’s log.

## Final memory construction

**7. FINAL MEMORY**

### Proposal concrete

The final RAG object should represent a **decision episode**, rather than a compressed transcript.

The valuable memory is:

```text
What problem existed?
What did the agent initially believe?
What evidence killed bad routes?
What evidence supported the winning route?
What changed?
How was it verified?
What remains uncertain?
```

### Canonical memory capsule

I would produce this deterministic structure first:

```ts
type SessionMemoryCapsule = {
  run_id: string;

  task: {
    request: string;
    normalized_goal: string;
  };

  outcome: {
    status: "solved" | "partial" | "failed" | "aborted";
    summary: string;
  };

  decisions: {
    summary: string;
    evidence_ids: string[];
  }[];

  accepted_hypotheses: {
    summary: string;
    evidence_ids: string[];
  }[];

  rejected_hypotheses: {
    summary: string;
    rejected_because: string;
    evidence_ids: string[];
  }[];

  mutations: {
    path: string;
    purpose?: string;
    diff_anchor?: string;
    evidence_ids: string[];
  }[];

  verification: {
    action: string;
    outcome: string;
    evidence_ids: string[];
  }[];

  constraints_discovered: string[];

  unresolved: {
    question: string;
    confidence?: string;
  }[];

  source_quality: {
    direct: number;
    corroborated: number;
    asserted: number;
    inferred: number;
  };
};
```

Then let the existing end-of-session judge transform this into prose.

The important inversion is:

```text
today:
transcript
   ↓
LLM reconstructs what mattered
   ↓
memory

proposed:
evidence + epistemic graph
   ↓
deterministic capsule
   ↓
LLM improves readability
   ↓
memory
```

The LLM is the **editor**, rather than the archaeologist.

### The most valuable new information

The highest-value fields are probably the ones the transcript representation currently destroys most easily:

**Rejected approach plus reason**

```text
"Changing parser normalization was tested and discarded;
token remained stale before parsing."
```

This prevents future agents from wasting time repeating a dead route.

**Decision boundary**

```text
"Chose cache invalidation rather than global auth reset
because only refresh tokens were stale."
```

**Evidence that changed belief**

```text
"Reproducer passed only after clearing cached refresh state."
```

**Uncertainty**

```text
"Fix validated locally; concurrent refresh remains untested."
```

**Verification**

```text
"cargo test auth_refresh: exit 0"
```

**Scope**

```text
touched:
  src/auth/cache.rs
  tests/auth_refresh.rs

inspected:
  src/auth/parser.rs

explicitly rejected:
  parser modification
```

That is much richer retrieval material than a chronology.

### Preserve negative knowledge

This should be treated as a first-class RAG feature:

```text
DO:
store solutions

ALSO:
store disproved hypotheses
store failed commands when diagnostic
store why routes were abandoned
store invariants discovered
```

A future retrieval query:

> “Refresh tokens fail intermittently after expiry”

could retrieve:

```text
Previously tested parser normalization; disproved.
Cache invalidation was the decisive mechanism.
```

That can save more time than recalling the final patch alone.

### Keep causal compression

The ideal textual projection is something like:

```text
Goal
→ suspected parser issue
→ parser hypothesis rejected by T8 because stale token existed upstream
→ cache hypothesis opened
→ T12 reproduced stale cache
→ cache invalidation changed in src/auth/cache.rs
→ T19 auth refresh test passed
→ concurrency remains unverified
```

This is effectively a **causal path through the session**, rather than a summary of the session.

### RAG projections

I would store one canonical JSON capsule and derive three retrieval-oriented textual projections:

```text
problem → solution
rejected approaches → evidence
files/symbols → verification
```

These are multiple indexes over the same memory object, rather than three independent generated memories.

That improves retrieval for queries phrased around:

```text
symptoms
decisions
code locations
past failed approaches
```

### Compaction summaries

`PostCompact` gives Micah the summary Claude generated during compaction. That is useful as another source, but the capsule should prefer the graph Micah accumulated before and after compaction, because the compact summary is itself a lossy artifact. citeturn17view2

One particularly useful record could be:

```text
knowledge_before_compaction
knowledge_in_compact_summary
knowledge_observed_after_compaction
```

You could eventually detect:

> “This fact was observed earlier but appears absent from the compacted working context.”

That is useful both for memory and live UX.

### Trade-offs and failure modes

The final judge can still invent causal coherence.

Counter this by requiring every substantive memory assertion to carry:

```text
evidence_ids
```

The user usually sees clean prose.

The inspector can expand:

```text
Why does Micah remember this?
```

and reach:

```text
hypothesis delta H7
PreToolUse T12
tool result T12
diff D4
test result T19
```

That gives RAG memories auditability.

### Adjacent idea I would reject

**“Summarize the transcript better.”**

Even an excellent summary model cannot reliably recover a branch that the observed transcript never contained.

Better summarization attacks compression quality.

This architecture attacks **information loss before compression**.

Those are different problems.

## Minimal prototype and falsification test

**8. PROTOTYPE**

### Proposal concrete

For a single developer over one to two weeks, I would cut almost everything except the part that proves the thesis.

E1 should answer:

> **Can Micah display meaningful state before observable side effects and before the transcript catches up, and can it capture at least some semantic branch changes before they become tool history?**

### E1 scope

Build exactly four pieces.

#### Hook-to-OSC bridge

Instrument:

```text
SessionStart
UserPromptSubmit

MessageDisplay

PreToolUse
PostToolUse
PostToolUseFailure
PostToolBatch

SubagentStart
SubagentStop

PreCompact
PostCompact

Stop
StopFailure
SessionEnd
```

The official current lifecycle provides each of those major boundaries, with `PreToolUse` before execution, `PostToolBatch` before the next model request, and `MessageDisplay` during rendered assistant text. citeturn17view0turn16view1turn16view3

Each command hook executes `micah-hook`.

`micah-hook` returns OSC 777.

Micah parses it from its existing PTY infrastructure.

#### Minimal MindHub + WAL

Only these derived states:

```text
waiting_model_output
narrating
action_imminent
tool_running
tool_succeeded
tool_failed
reassessment
waiting_user
finished
interrupted
```

Plus:

```text
current target
current subagent
current tool
```

Do not build the full cognitive DAG first.

#### Fuse one independent effect sensor

For E1, choose **filesystem changes for Edit/Write**.

That yields the essential three-way proof:

```text
Claude says:
PreToolUse Edit X

OS says:
X physically changed

Claude says:
PostToolUse Edit succeeded
```

JSONL runs beside this solely as the delayed baseline.

#### Tiny self-report experiment

Add the minimal marker protocol:

```text
<MICAH_STATE {
  "node":"h1",
  "op":"open|reject|support",
  "kind":"hypothesis|test|decision",
  "summary":"...",
  "next":"..."
}>
```

Capture via `MessageDisplay`.

Render only:

```text
one current hypothesis
one previous/dead hypothesis
one next test
```

That is enough to learn whether the semantic layer has signal.

### E1 scene

Do not implement constellations yet.

Use the existing city plus a small live ribbon:

```text
┌──────────────────────────────────────────────┐
│ HYPOTHESIS                                   │
│ stale refresh token is surviving cache reset │
│                                              │
│ NEXT: test invalidation path                 │
│                                              │
│ STATE: ABOUT TO EDIT  src/auth/cache.rs      │
└──────────────────────────────────────────────┘
```

And city effects:

```text
hypothesis target → soft halo
PreToolUse         → anticipatory pulse
FS mutation        → impact
PostToolUse        → confirmation
failed test        → branch shakes/fades
new hypothesis     → previous one ghosts
```

This proves information architecture before visual-design investment.

### The first fusion I would implement

Strict ordering:

```text
PreToolUse
    +
PostToolUse/PostToolUseFailure
    +
FS watcher
```

PTY is already present and becomes transport plus liveness.

Why these three?

Because they produce:

```text
INTENT
   ↓
EFFECT
   ↓
REPORTED OUTCOME
```

with two independent sensor families.

That is the smallest meaningful fusion unit.

### The critical distinction E1 must preserve

`PreToolUse` proves:

> **The agent has chosen an imminent operation before that operation executes.**

It does **not** prove:

> **This was its hypothesis while it was deciding.**

`PreToolUse` fires only after Claude has already constructed the tool parameters. citeturn16view1

Therefore the prototype has two separate success criteria:

```text
LIVE ACTION TELEMETRY
Does Micah beat side effects / JSONL?

LIVE EPISTEMIC TELEMETRY
Does explicit state reporting reveal hypothesis/branch
changes before action history would reveal them?
```

If the first succeeds and the second fails, Micah has built a superb live execution map, rather than the requested “mind.”

That outcome should be accepted honestly.

### Metrics

I would instrument four primary metrics.

#### Pre-effect coverage

For side-effecting tool calls:

```text
pre_effect_coverage =
  count(intent_displayed_before_first_effect)
  /
  count(side_effecting_tool_calls)
```

Ground truth:

```text
intent = PreToolUse arrival in MindHub
effect = first relevant FS/process event
```

E1 hypothesis:

```text
≥ 95% for supported built-in Edit/Write/Bash cases
```

A miss usually reveals adapter/correlation weakness.

#### Action lead time

```text
action_lead_ms =
    t(first_effect)
  - t(action_imminent_visible)
```

Positive is the key property.

Then compare:

```text
hook-fused lead time
versus
JSONL-visible time
```

The user’s current JSONL design already imposes 60–700 ms polling behavior, while Claude’s own documentation independently confirms that transcript persistence can lag current in-memory state. citeturn16view0

The relevant result is therefore:

```text
How often did Micah show the upcoming action
before the side effect?

How much earlier did it become visible than JSONL?
```

rather than a generic FPS metric.

#### Epistemic anticipation rate

For model-emitted mind deltas:

```text
epistemic_anticipation =
  meaningful state changes emitted before associated action
  /
  meaningful branch changes identified after session
```

A branch change is:

```text
hypothesis opened
hypothesis rejected
approach parked
new test selected
decision made
```

This is the metric that decides whether “Mind” is earned.

If all mind deltas arrive after the corresponding tools, you have built narration.

#### Corroboration precision

For UI assertions such as:

```text
"file X edited"
"test Y executed"
```

measure:

```text
confirmed_claims
/
all_definitive_claims
```

The target should be effectively perfect for statements presented as definitive.

Everything else should remain visually marked as asserted or inferred.

### Observer-effect metrics

Compare telemetry-enabled sessions against control sessions on repeatable tasks:

```text
tool-call count
wall time
assistant output size
hook overhead
self-report marker count
task outcome
```

The self-report layer should be killed or redesigned if it materially damages agent quality.

### Kill criteria

This prototype should be allowed to kill the grander idea.

I would define three outcomes.

**Outcome A — full thesis survives**

```text
PreToolUse gives reliable before-effect action state
+
self-report provides useful hypothesis/backtrack transitions
+
observer effect is acceptable
```

Proceed to cognitive constellations.

**Outcome B — execution map survives, “mind” thesis dies**

```text
actions are beautifully live
but
semantic deltas are sparse/stale/post-hoc
```

Then the truthful product is:

> **Live Agent Work Map**

For a genuine semantic mind layer, the next move would be a deeper integration point in Micah’s own agent protocol or a controlled CLI fork where structured epistemic deltas become part of the agent contract.

**Outcome C — even live action adds little**

```text
hook view is perceptually equivalent
to a fast transcript replay
```

Stop investing in the realtime scene.

That result is valuable.

### What I would deliberately leave outside E1

Skip:

```text
full git reconciliation
all-platform watcher recovery
complete subagent constellations
RAG redesign
complex confidence scoring
physics layout
historical replay polish
OTel ingestion
automatic semantic classifier
```

Those pieces are engineering multipliers.

They do not answer the existential question.

### Adjacent idea I would reject

**“Prototype the beautiful city first and judge whether it feels alive.”**

Animation can make stale information feel realtime.

The E1 metric must be causal:

```text
Did Micah know and display something
before the effect occurred
and before JSONL could reveal it?
```

For the cognitive layer:

```text
Did Micah capture a hypothesis or branch transition
before the later action trace made that transition obvious?
```

That is the falsifiable line between a live mind-state instrument and a sophisticated replay.

The architecture I would ship toward, assuming E1 survives, is therefore:

```text
                         MICAH RUN
                            │
          ┌─────────────────┼─────────────────┐
          │                 │                 │
     CONTROL PLANE      EFFECT PLANE     ASSERTION PLANE
          │                 │                 │
     Claude hooks        FS/process       mind deltas
     native tasks        editor/git       narration
     subagents
          │                 │                 │
          └─────────────► MindHub ◄───────────┘
                            │
                    immutable evidence
                            │
                         Micah WAL
                            │
                       reconciler
                            │
              ┌─────────────┴─────────────┐
              │                           │
        Operational State          Epistemic DAG
              │                           │
              └─────────────┬─────────────┘
                            │
                       scene model
                            │
                    Tauri Channel<T>
                            │
                   Canvas 2D Mind view
                            │
                      session closure
                            │
                  Memory Capsule + RAG
```

The deepest shift is conceptual:

**Files are locations. Tools are actions. Hooks are causal boundaries. OS events are evidence. Hypotheses are assertions. Rejected branches are memory.**

And the scene should show the relationships among those categories rather than collapsing all of them into “what the AI did.”

That gives Micah something substantially different from logs, traces, dashboards, transcript replay, or LLM summarization: **a live, persistent, evidence-qualified epistemic instrument for an agent whose literal internal cognition remains partly unobservable.**