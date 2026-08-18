# Merge das consultas: Micah's Mind E7 — a mente ao vivo, sem depender do JSONL

- **Data**: 2026-08-18 (madrugada)
- **Inputs**: pergunta em `docs/pergunta-micahs-mind-para-outras-ais-2026-08-18.md` +
  resposta A (GPT, "Consultoria de Arquitetura", PT) + resposta B (Claude, "Live
  Epistemic Telemetry", EN) + verificação de realidade pelo executor GLM (que
  roda no parque real: fork Claude Code GLM, ConPTY, Windows, LEI ZERO).
- **Pergunta do comandante que este merge responde**: "O que eu quero é possível?"

## Veredito curto

**Sim, é possível — com uma fronteira honesta desenhada com precisão.**

1. O mapa AO VIVO da AI trabalhando (atenção, intenção ANTES do efeito,
   ação em curso, confirmação física, morte de rumo) é **engenharia
   comprovada**: as duas AIs convergiram independentemente para a mesma
   arquitetura (hooks como espinha dorsal causal + FS como verdade física +
   PTY como transporte/liveness + JSONL rebaixado a testemunha tardia).
2. A camada COGNITIVA (hipóteses, backtrack, "vou parar de insistir nisso")
   é possível **apenas como projeção provocada**: nenhum canal passivo
   contém o raciocínio latente (a resposta B provou que até o thinking do
   transcript vem redigido/vazio com signature). A AI precisa EXTERNALIZAR
   estado num protocolo barato que nós definimos — e o que capturamos é
   asserção + evidência, nunca pensamento bruto.
3. O sabor novo (morango+jaca+saquê) tem nome concreto: **um instrumento
   epistêmico ao vivo** — gravador de voo multissensor + grafo de hipóteses
   que o agente declara, fundidos com a verdade física do disco, com
   procedência visível. Nenhuma das duas AIs tinha isso no treinamento;
   ambas chegaram nele por caminhos independentes. Isso é a evidência mais
   forte de que a resultante é nova E viável.

## 1. CONSENSO das duas AIs (9 pontos — nenhuma divergência real)

1. **O JSONL morre como fonte primária.** Ele é relato posterior, orientado a
   ferramenta, cognitivamente vazio (thinking redigido no disco), frágil
   (arquivo some/compaction/fork — falha que o Rodrigo viu ao vivo) e lento
   (poll 700 ms). Vira canal de reconciliação/backfill assíncrono.
2. **Hooks do Claude Code são a espinha dorsal causal.** `PreToolUse` dispara
   DEPOIS de o modelo construir os argumentos e ANTES da execução — é o
   sinal de intenção antes-do-fato que a arquitetura atual não tem. A
   superfície real: PreToolUse, PostToolUse, PostToolUseFailure,
   PostToolBatch, MessageDisplay, SubagentStart/Stop, PreCompact/PostCompact,
   Stop/StopFailure, SessionStart/End, UserPromptSubmit (~31-32 eventos).
3. **FS watch é a verdade física** (a mutação aconteceu, independente do que
   a AI alega); PostToolUse fecha o loop causal (a AI alega sucesso).
4. **O PTY é o transporte e o liveness**: cada byte já passa por nós;
   spinner/silêncio = estado "aguardando saída do modelo" sub-100 ms.
5. **Transporte front = `tauri::ipc::Channel`**, NUNCA `emit` (doc oficial do
   Tauri: eventos são JSON-string, não projetados para latência baixa;
   Channel é ordenado por índice e feito pra streaming). Coalescer por frame
   (~16 ms): N eventos → 1 Channel message → 1 requestAnimationFrame.
6. **Cognitivo é PROVOCADO, nunca inferido em silêncio**: a AI emite deltas
   estruturados mínimos (`MindStateDelta`); fallback heurístico rotulado
   como inferido. Regra de honestidade: `agent_asserted_confidence` ≠
   `evidence_grade` — asserção do agente nunca vira verdade do Micah.
7. **Âncora de identidade muda**: `pane_id`/`run_id` do Micah (estável,
   nosso) substitui `session_id` (volátil, deles). Event-store/WAL próprio
   append-only + snapshots (`app-data/mind/<run-id>/`). Transcript sumir =
   `source_health: missing`, o mapa CONGELA com selo — nunca acorda vazio.
8. **A cena mantém a cidade** (memória espacial do usuário é patrimônio) e
   ganha uma ATMOSFERA cognitiva acima: constelações de hipóteses (dezenas
   de nós, nunca milhares — Canvas 2D aguenta), pulso de intenção
   (PreToolUse → alvo, a "aresta do futuro"), pulso reverso na evidência,
   ramo morto que APAGA devagar em vez de sumir (a feature mais valiosa:
   conhecimento negativo visível), backtrack como aresta de primeira
   classe, rail de raciocínio pros estados sem arquivo. Procedência no
   traço: sólido=observado, anel duplo=declarado, tracejado=inferido.
9. **Memória final = cápsula de episódio de decisão**, não resumo de
   transcript: hipóteses rejeitadas + motivo, decisões com `evidence_ids`,
   verificação, incertezas restantes. O LLM juiz vira EDITOR de uma cápsula
   determinística, não arqueólogo de um log. Múltiplas projeções de
   recuperação (problema→solução, rejeitado→evidência, arquivo→verificação)
   sobre o MESMO objeto canônico.

## 2. DIVERGÊNCIAS e a resolução do merge

| Tema | Resposta A (GPT) | Resposta B (Claude) | **Resolução** |
|---|---|---|---|
| Hook→backend | named pipe/Unix socket → tokio mpsc | hook devolve `terminalSequence` → o PRÓPRIO Claude Code escreve OSC 777 no terminal dele → nosso parser PTY consome | **B como primário** (zero socket, zero descoberta: o pacote OSC segue o PTY do agente e chega na pane certa automaticamente — o terminal É o barramento; já somos donos do OSC 777). **A como fallback** p/ sessões fora do app (socket local). Risco a validar no E7.1: `terminalSequence` na allowlist da versão do nosso fork. |
| Confiança | numérica (0.9, 0.99) | categórica (H/S/C/A) | **Categórica no E7** (número não calibrado é teatro); numérica só depois de milhares de sessões rotuladas |
| Modelo de eventos | 1 UnifiedEvent com confidence | 2 camadas: Observation Ledger imutável + Claim Graph mutável | **B (2 camadas)**: ledger guarda o que cada sensor DISSE; claims guardam nossa melhor interpretação (asserted/observed/corroborated/contradicted/superseded) — corrige retroativamente sem reescrever história |
| Fora de ordem | watermark + bounded out-of-orderness (stream processing) | nunca bloquear a UI; upgrade de claim quando chega tarde | **Os dois**: watermark ~2 s selando eventos, e a UI mostra provisório imediatamente (nunca espera certeza) |
| Fusão falsa | (não tratou) | armadilha da "independência falsa": hook+OTel+transcript = 1 plano só | **Adotado**: `source_family` por evento; corroboração exige famílias INDEPENDENTES (controle ≠ efeito físico) |

## 3. Verificação de realidade pelo executor (o que nenhuma delas sabia)

- **Nós rodamos um FORK do Claude Code com GLM** (wrapper micah): hooks são
  configurados no settings do `CLAUDE_CONFIG_DIR` (`~/.claude-micah`) —
  controle total, sem depender de upstream. O protocolo de auto-relato
  `<MICAH_STATE>` pode ser injetado via CLAUDE.md do projeto + hook, e o
  juiz/cena continuam "nada de anthropic" onde for LLM.
- **Windows/ConPTY**: risco apontado pela resposta A (spawn de processo de
  hook mais lento no Windows) é REAL aqui — medir `hook→OSC→parser` no
  E7.1 na MÁQUENA REAL (zig-laptop) antes de qualquer compromisso; o
  binário `micah-hook` precisa ser mínimo (parse→emitir→sair).
- **A caixinha in-app** ganha a via limpa: `mind_delta` como ação interna
  nativa (resposta B) — sem protocolo de texto, sem custo de prompt.
- **LEI ZERO**: tudo cabe (hooks=processo nosso, OSC=parser existente,
  Channel=Tauri nativo, WAL=fs nosso, cena=Canvas 2D existente). Zero
  dependência nova. Confere.

## 4. Arquitetura fundida (o diagrama de uma olhada)

```
hooks (micah-hook) ──► OSC 777 micah.mind/v1 ──► parser PTY existente ─┐
PTY bytes/spinner ────────────────────────────────────────────────────┤
FS watcher (Edit/Write) ──────────────────────────────────────────────┤
                                                                       ▼
                                            MindHub (Rust): ingest → lamport/watermark
                                                                       │
                                            Observation Ledger (WAL imutável, nosso)
                                                                       │
                                            Claim Graph + Epistemic DAG (mutável)
                                                                       │
                                            coalescer 16 ms → tauri ipc::Channel
                                                                       │
                                            Canvas 2D: cidade cache + atmosfera cognitiva
                                                                       │
                                            fim de sessão → Memory Capsule → juiz GLM → RAG
```

- Envelope do ledger: `v, event_id, run_id, pane_id, session_id?, source,
  source_family, ingest_seq, occurred_ms, observed_mono, kind, correlation
  {tool_use_id, path, agent_id, hypothesis_id}, payload`.
- `MindStateDelta` v1 (consenso dos schemas): `{node_id, parent_id?, op:
  open|focus|update|support|reject|park|resolve, kind: goal|question|
  hypothesis|plan|test|finding|decision, summary<=120, targets?, caused_by?,
  next?, asserted_confidence?}`.
- Estados operacionais abaixo do grafo (sem auto-relato já funcionam):
  `awaiting_model_output → narrating|action_imminent → tool_running →
  tool_succeeded|tool_failed → reassessment (PostToolBatch) → ...`
  — "awaiting model output", NUNCA "thinking" (honestidade).

## 5. Plano E7 (fases com critérios de morte)

- **E7.1 (semana 1-2) — o experimento que prova ou MATA**: bridge
  hook→OSC 777 + MindHub mínimo (estados operacionais) + FS watch só para
  Edit/Write + fita viva (hipótese atual / próxima ação / estado) sobre a
  cidade existente. Métricas na máquina real: **pre-effect coverage ≥95%**
  (intenção visível antes do primeiro efeito), **action-lead p50 <150 ms /
  p95 <300 ms** vs JSONL, overhead do hook <50 ms, corroboração ~100%.
  MORTE se: lead ≈ 0 (é replay), p95 >400 ms, ou spawn de hook no Windows
  comer a vantagem. JSONL continua rodando como baseline de comparação.
- **E7.2 (3-5) — inversão da fonte de verdade**: run_id/pane como âncora,
  WAL próprio + snapshots, JSONL rebaixado a enriquecimento com watermark,
  estado `frozen` com selo (nunca vazio), `sensor_degraded` como evento.
- **E7.3 (6-9) — camada cognitiva**: protocolo `<MICAH_STATE>` no CLI
  (MessageDisplay captura E filtra da tela via displayContent) +
  `mind_delta` nativo na caixinha; DAG com ramos mortos preservados.
  Métrica que decide se "Mind" é merecido: **epistemic anticipation rate**
  (deltas emitidos ANTES da ação que os tornaria óbvios) + observer effect
  (telemetria não pode degradar o agente: tokens, tempo, tool calls).
  Se falhar: o produto honesto é o **Live Agent Work Map** (outcome B) — e
  isso também é um produto que não existe no mercado.
- **E7.4 (10-12) — cena plena**: constelações (≤50 nós vivos), pulso de
  futuro, ramos-fantasma, rail de raciocínio, câmera que segue a ATENÇÃO
  (centroide da hipótese ativa, lease de interação do usuário), cache de
  cidade por transform de câmera.
- **E7.5 — memória**: cápsula + juiz editor + projeções de recuperação;
  benchmark cego contra o resumo de transcript atual.
- **Nunca**: JSONL primário de novo, `emit` no stream, servidor/broker,
  milhares de nós cognitivos, número de confiança não calibrado, chamar
  asserção de cognição oculta.

## 6. A resposta à pergunta, em uma linha cada

- "Dá pra ver a AI trabalhando AO VIVO, antes do efeito?" — **SIM, e com
  prova falsificável (pre-effect lead) já na semana 2.**
- "Dá pra ver a MENTE dela (hipóteses, mortes de rumo, backtrack)?" —
  **SIM, como projeção provocada e barata que ELA declara e nós
  corroboramos com o disco — nunca como pensamento bruto (isso ninguém
  tem, nem vai ter, e a UI nunca deve fingir que tem).**
- "Isso existe em algum lugar?" — **NÃO. As duas AIs independentes
  chegaram no MESMO desenho inexistente: instrumento epistêmico ao vivo
  com procedência. É o sabor novo.**
