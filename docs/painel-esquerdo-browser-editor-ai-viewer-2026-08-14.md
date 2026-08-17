# Painel esquerdo com tres modos: Browser | Editor | Ai Viewer

- **Data**: 2026-08-14
- **Autor do card**: Rodrigo Campos
- **Coluna**: A fazer

> **2026-08-17, volta para a fila (MAXIMO 01 CARD POR VEZ)**: o modo Ai Viewer
> deste card (E5, faixas CM6 com tail do JSONL) esta SUPERADO por decisao do
> Rodrigo: no lugar dele entra o Micah's Mind (card
> `micahs-mind-2026-08-17.md`), que demole o viewer velho e poe a cidade
> luminosa navegavel com streaming ao vivo, juiz GLM e chunk no oracle-rag. Os
> ativos vivos deste card (claude_session_tail, claudeSessionOps,
> useClaudeSessionFeed, moldura de tres modos, pane nas abas) sao HERDADOS e
> mantidos pelo card novo. O que ainda falta FECHAR daqui: (1) prova de E2b em
> binario de release (Ctrl+Tab, Cmd+1..9, guarda de fechamento, restore,
> Cmd+F, criterios 6 e 7); (2) E6/E7 (verificacao completa + memorium). Essas
> provas cavalgam a validacao do card micahs-mind, que roda os mesmos checks e
> a mesma prova no ar em release; ao fechar aquele card, este volta a ser
> conferido item por item antes de Feito.

> **2026-08-15 09:20**: card retomado pela ronda (browser-pdi fechou o modo
> Browser e o E4 daqui esta superado pelos artefatos do PDI; explorer-raiz-livre
> fechado com prova do ar). Etapa corrente: **E2a**.

> **2026-08-14, MAXIMO 01 CARD POR VEZ**: E1 (moldura dos tres modos) esta
> entregue e provada (commit efcd8f4). O card volta para a fila enquanto
> `browser-pdi-2026-08-14.md` (card ativo, ordem do Rodrigo: "resolva o browser
> apenas com um pdi") fecha o modo Browser; E2+ (Editor, Ai Viewer) continuam
> daqui. O E4 de favoritos/menu deste card foi SUPERADO pelo PDI (correcao 21
> da auditoria do PDI): valem os nomes de artefato do PDI.

## Descricao

Hoje o canto superior esquerdo da janela do Micah mostra "Default", que e o
`SpaceSwitcher` (seletor de espaco de trabalho). Esta errado: aquele lugar nao
serve para trocar de espaco, serve para trocar **o conteudo e a natureza do
painel da esquerda** (o painel que hoje so hospeda o browser embutido).

No lugar de "Default" entra um seletor **fixo e permanente**, sempre nesta ordem:

```
Browser | Editor | Ai Viewer
```

Os tres modos ocupam o mesmo painel da esquerda, um de cada vez.

### 1. Browser

O painel de browser que ja existe, melhorado:

- Barra lateral esquerda com os icones dos sites salvos (favoritos), no estilo
  da barra de favoritos vertical do Brave.
- Menu sanduiche com as demais ferramentas do browser: historico, extensoes,
  e o resto do que um browser precisa expor.

### 2. Editor

"Editor" significa que o codigo passa a abrir **neste painel**, e nao onde se
conversa com a AI. Vale para os dois caminhos de abertura:

- o botao **New Editor Tab**;
- o clique em qualquer arquivo na sidebar de arquivos (a direita).

### 3. Ai Viewer

Um painel **somente leitura** que mostra onde a AI esta trabalhando neste
instante: o arquivo, o trecho, a escrita e a edicao acontecendo. Se houver
varias instancias de AI trabalhando ao mesmo tempo, o painel se divide em
faixas horizontais, uma por instancia. Aceleracao por GPU se houver ganho real.

## Criterio de aceite

1. O texto "Default" nao aparece mais no canto superior esquerdo da janela
   principal; no lugar dele ha um seletor com exatamente tres itens, na ordem
   `Browser`, `Editor`, `Ai Viewer`. A ordem vem de um array `readonly` unico,
   fixado por teste unitario, e um teste de render confere a ordem no DOM.
   (Redacao corrigida apos a auditoria: "nao muda em nenhum estado" era
   quantificacao universal infalsificavel.)
2. Clicar em cada um dos tres itens troca o conteudo do painel da esquerda para
   o modo correspondente, e o item ativo fica visualmente marcado.
3. O modo escolhido sobrevive ao fechar e reabrir o aplicativo.
4. No modo `Browser`: existe uma barra vertical de favoritos na borda esquerda
   do painel; um favorito adicionado pelo usuario aparece nessa barra como
   icone, e clicar nele navega o webview para a URL salva.
5. No modo `Browser`: existe um botao de menu (sanduiche) que abre um menu com,
   no minimo, `Historico` e `Extensoes`; `Historico` lista as URLs visitadas na
   sessao em ordem cronologica inversa e clicar em uma delas navega para ela.
6. No modo `Editor`: com o painel em `Editor`, clicar em um arquivo na sidebar
   de arquivos abre o conteudo daquele arquivo **no painel da esquerda**, e o
   painel central (onde se fala com a AI / terminal) nao recebe uma aba de
   editor por causa desse clique.
7. No modo `Editor`: o botao `New Editor Tab` abre o novo editor no painel da
   esquerda, com a mesma regra do item 6.
8. No modo `Ai Viewer`, com o agente local escrevendo um arquivo: a faixa mostra
   o caminho do arquivo e o conteudo **parcial** chegando durante o streaming da
   chamada de `write_file` (estado `input-streaming`, chaveado por `toolCallId`),
   e a faixa e somente leitura (digitar nela nao altera arquivo nem buffer).
   Numa edicao (`edit`/`multi_edit`), a faixa mostra o par velho/novo, nao um
   arquivo reconstruido.
9. No modo `Ai Viewer`, com duas ou mais instancias de AI ativas ao mesmo tempo
   (agente local + agentes de terminal, ou dois agentes de terminal), o painel se
   divide em faixas horizontais, uma por instancia, cada faixa rotulada com a
   instancia. A faixa de um agente de terminal mostra a **saida ao vivo daquele
   terminal**, rotulada como tal.

> **Item 9 corrigido pelo autor (Rodrigo, 2026-08-15 11:21), apos ver o E5 no
> ar (05.jpg):** espelhar a saida do terminal e inutil, "isso eu estou vendo
> tambem". O alvo verdadeiro e mostrar o que a TUI NAO mostra: os arquivos que
> o agente esta lendo, editando e escrevendo, abertos ao lado com o conteudo.
> A reescrita da auditoria ("a saida do terminal e onde ele trabalha") partiu
> de "dado que existe" mas errou o alvo humano. Fonte de dado que existe e
> satisfaz o alvo: o transcript JSONL da sessao do Claude Code
> (`~/.claude/projects/<proj>/<sessao>.jsonl`), que o Micah ja ancora por pane
> (`leaf.resume`) e que o harness escreve independente do modelo por tras
> (vale para GLM via base URL). Cada Read/Edit/Write entra la com caminho e
> conteudo integrais. Redacao vigente do criterio 9 para agentes de terminal:
> a faixa de um agente de terminal com sessao ancorada mostra os arquivos que
> ele le/edita/escreve (Read com o trecho lido, Edit com o par velho/novo,
> Write com o conteudo), tailados do transcript; o espelho do buffer do
> terminal fica apenas como fallback quando nao ha transcript (agente sem
> ancora ou sem JSONL). Implementacao: comando Rust `claude_session_tail`
> (tail por offset, confinado a `~/.claude/projects`, session id uuid-gated,
> chunk 256 KiB, UTF-8 partido na borda deferido; `fs/claude_session.rs`, 7
> testes), parser puro `claudeSessionOps.ts` (JSONL -> eventos de lane, 13
> testes), `useClaudeSessionFeed.ts` (poll 700 ms so com o viewer montado,
> catch-up rapido, probe lento enquanto o arquivo nao existe) e
> `AiViewerArea` com `resolveLeafResume` vindo do App.
>
> **Itens 8 e 9 reescritos apos a auditoria do plano, com o motivo escrito.** A
> redacao original ("mostra o arquivo alvo de qualquer instancia") era
> **insatisfazivel**: `AgentSession` (`agents/lib/types.ts:12-26`) nao carrega
> arquivo nem conteudo — so `leafId/tabId/agent/status/timestamps` —, e o agente
> local tem uma sessao ativa por vez (`chatStore.ts:144`), com `agentMeta` sem
> `path` nem `content` (`chatStore.ts:50-60`). O alvo escrito pelo autor e
> *"mostrar onde a AI esta trabalhando"*; para um agente de terminal, onde ele
> esta trabalhando **e** a saida do terminal dele, que existe e e legivel
> (`live.readLeafBuffer`, `chatStore.ts:40`). A reescrita mira o mesmo alvo com
> dado que existe, em vez de prometer dado que nao existe.
10. `pnpm lint`, `pnpm check-types` e `pnpm test` passam; `cargo clippy
    --all-targets --locked -- -D warnings` e `cargo test --locked` passam em
    `src-tauri`.
11. O binario `src-tauri/target/release/micah.exe` e reconstruido e executado, e
    o comportamento dos itens 1 a 9 e conferido no app rodando, com prova.

### Criterios acrescentados apos a auditoria do plano

12. **Espacos continuam alcancaveis e inteiros**: sair do canto superior esquerdo
    nao pode apagar criar/renomear/deletar/reordenar espaco, mover aba entre
    espacos, "new tab in space" nem jump-to-tab. O atalho `space.overview` e o
    comando da paleta abrem o overview, provado por teste de render.
13. **Nenhuma regressao contra o card anterior**: trocar de modo **nao** derruba a
    sessao do browser, a porta CDP nem `browser-cdp.json` — os criterios 4, 5, 7 e
    11 daquele card continuam valendo depois de ir e voltar entre os tres modos.
14. **Nada quebra em `useTabs`**: com uma aba de editor no painel esquerdo e um
    terminal no central, continuam corretos o ciclo Ctrl+Tab, `Cmd+1..9`, a guarda
    de fechamento, o fechamento do ultimo shell, o restore de sessao e a busca do
    header (Cmd+F acha o editor do painel com foco).
15. **Historico nao vaza credencial**: URL com parametro de credencial na query
    entra redigida no historico, provado por teste unitario da funcao de redacao.

## Comentarios humanos (o alvo)

- A ordem `Browser | Editor | Ai Viewer` e permanente e fixa. Nao inventar
  ordem dinamica, nao reordenar por uso.
- O ponto do modo `Editor` e tirar o codigo de perto da conversa com a AI. O
  codigo vai para a esquerda; a conversa fica onde esta.
- `Ai Viewer` e observacao, nao interacao: somente leitura, sempre.
- Aceleracao por GPU no `Ai Viewer` e desejavel, nao obrigatoria: so entra se o
  ganho for real e nao custar peso no bundle (a lei de performance do MICAH.md
  vale aqui).
- Nao quebrar o que ja existe: browser embutido, sidebar a direita, abas no
  painel Tabs da sidebar, provider claude-code.

## Levantamento do sistema atual (mapeado antes do plano)

| Peca | Estado hoje | Arquivo |
|------|-------------|---------|
| "Default" no canto superior esquerdo | trigger do `SpaceSwitcher` (Popover de espacos) | `SpaceSwitcher.tsx:239-256`, montado em `App.tsx:1185-1199`, renderizado em `Header.tsx:136` |
| Espacos | dirigem persistencia de abas por espaco, cwd de aba nova, env de workspace, alvo do source-control, paleta de comandos, `TabsPanel` | `spaces/lib/{useSpaces,useSpacesBoot,useSpacePersistence,serialize}.ts`, `tabs/lib/useTabs.ts:280,488,501` |
| Painel da esquerda | so existe quando `browser.enabled`; hospeda o webview nativo | `App.tsx:1377-1408`, `browser/lib/useBrowserPanel.ts` |
| Webview do browser | HWND irmao no Windows: pinta **por cima** do DOM; nada pode renderizar dentro do host | `BrowserPanel.tsx:143-149`, `browser/panel.rs` |
| URL do painel | polling de `browser_url` a cada 700 ms | `useBrowserPanel.ts:419-439` |
| Abrir arquivo da sidebar | `handleOpenFile` -> `openFileTab(path, false)` -> aba `editor` no workspace | `App.tsx:626-635`, `tabs/lib/useTabs.ts:749-766` |
| New Editor Tab | 3 entradas (NewTabMenu, paleta, atalho) -> `setNewEditorOpen(true)` -> `onCreated` -> `openFileTab(path)` | `NewTabMenu.tsx:146-156`, `commands.ts:176-185`, `App.tsx:848`, `App.tsx:1593-1598` |
| Onde o codigo aparece hoje | camada `EditorStack` empilhada no painel central, junto de terminal/preview/ai-diff | `WorkspaceSurface.tsx:90-105`, `App.tsx:1409-1446` |
| Onde se fala com a AI | faixa do compositor no rodape do painel central (`WorkspaceInputBar`) + `AiMiniWindow` flutuante | `WorkspaceInputBar.tsx:126-180`, `AiMiniWindow.tsx:198-205` |
| Atividade de AI observavel | `chatStore.agentMeta` (agente local) e `agentStore.sessions` alimentado por `micah:agent-signal` (agentes de terminal) | `ai/store/chatStore.ts`, `agents/store/agentStore.ts`, `pty/agent_detect.rs` |

## Pesquisa que sustenta o plano (WebView2, versoes travadas do repo)

Baseline verificado em `src-tauri/Cargo.lock`: `tauri 2.11.5`, `wry 0.55.1`,
`webview2-com 0.38.2`.

| Pergunta | Resposta | Consequencia para o plano |
|----------|----------|---------------------------|
| Extensoes Chrome no WebView2 | **Sim**, via `ICoreWebView2Profile7::AddBrowserExtension` com `AreBrowserExtensionsEnabled=true` (runtime >= 120.0.2210.55). `wry 0.55.1` ja expoe `with_browser_extensions_enabled` + `with_extensions_path`; Tauri expoe `browser_extensions_enabled`/`extensions_path`. So pasta **descompactada** (com `manifest.json`), nunca `.crx`; a loja recusa WebView2. Extensao carrega, mas **nao tem UI propria** (sem icone/badge/popup) porque o WebView2 nao tem chrome de browser. | O menu sanduiche lista e habilita extensoes; a UI de cada extensao e do Micah, nao da extensao. Enumerar/remover exige COM cru (`ICoreWebView2BrowserExtensionList`) via `with_webview`. |
| API de historico | **Nao existe.** `ICoreWebView2_23` e `PostWebMessageAsJsonWithAdditionalObjects`, nao tem relacao com historico. So da para **apagar** historico (`ClearBrowsingData`). | Historico e do Micah. Construir a partir de eventos. |
| Eventos que pegam SPA (`pushState`) | `add_SourceChanged` **sim** (documentado: dispara em navegacao de fragmento e mudanca de URL), `add_HistoryChanged` **sim**, `add_ContentLoading` **nao**, `add_NavigationCompleted` so documento. `wry` so liga ContentLoading/NavigationCompleted/NavigationStarting. `webview2-com 0.38.2` ja traz `SourceChangedEventHandler` e `HistoryChangedEventHandler`. | Ligar `SourceChanged`+`HistoryChanged` no Rust **elimina o polling de 700 ms** que existe hoje. Ganho de performance, nao custo. |
| Favicon | **Sim**, `ICoreWebView2_15` (`add_FaviconChanged`, `get_FaviconUri`, `GetFavicon`), formatos PNG e JPEG. `wry` **nao** expoe: zero ocorrencia de `favicon` em `wry-0.55.1/src/webview2/`. `webview2-com 0.38.2` ja traz os dois handlers. | Rail de favoritos com icone real via COM cru dentro de `with_webview`. Sem requisicao externa, sem `google.com/s2/favicons`. |
| Bookmarks | **Nao existe API**, e o perfil do WebView2 **nao compartilha nada** com Brave/Edge instalados. | Favoritos sao armazenamento do Micah (`tauri-plugin-store`, ja dependencia). Importar do Brave, se um dia, e leitura one-shot de arquivo, jamais apontar o UDF para o perfil de um browser real. |
| Superficie mais barata para o Ai Viewer | **CodeMirror 6 somente leitura**, nao xterm+WebGL. Motivo decisivo: `terminal/lib/rendererPool.ts:31` limita contextos WebGL a 5 **porque o navegador raciona contextos**; um xterm a mais no painel **disputa e pode despejar o renderer de um terminal vivo**. CM6 ja virtualiza (so renderiza o viewport) e ja esta no bundle. | `Ai Viewer` usa CM6 com `EditorState.readOnly.of(true)` **e** `EditorView.editable.of(false)`, append em lote por `requestAnimationFrame`, com corte de janela na mesma transacao. Nunca recriar o doc inteiro. |

## Plano em etapas

> **v2 — revisado pelo auditor de plano (Opus, 2026-08-14, veredito "aprovado com
> correcoes", 24 correcoes obrigatorias, 12/12 categorias com achado).** Todas as 24
> foram aceitas; nenhuma recusada. O registro integral esta em *Auditorias por etapa*.
>
> **A ordem mudou** (correcao 23): a cirurgia em `useTabs` (modo Editor) sobe para
> logo depois da moldura, porque tem 13 consumidores e o maior raio de dano — nao faz
> sentido construir favoritos e extensoes em cima de um app que ainda vai ser operado
> no coracao. E cada etapa que mexe no ciclo de vida do painel fecha em **binario de
> release** (correcao 22), nao em dev server: foi exatamente o HMR que impediu o card
> anterior de fechar os criterios 1 e 2 dele.

| Etapa | Entrega | Prova da etapa |
|-------|---------|----------------|
| **E1** | **Moldura dos tres modos.** Modulo novo `src/modules/left-panel/`: `LeftPanelMode = "browser" \| "editor" \| "ai-viewer"` com array `readonly` unico como fonte da ordem, leitura/escrita persistida em `localStorage` (funcoes puras testadas, espelhando `readBrowserEnabled`; valor desconhecido, vazio ou invalido cai em modo valido — correcao 5), e `LeftPanelSwitcher.tsx` (tres botoes segmentados, `aria-pressed` no ativo). `App.tsx` poe o switcher no slot do Header que hoje recebe `spaceSwitcher`. **O `SpaceSwitcher` continua MONTADO** (correcao 1): o overview vira `Dialog` (sem ancora de popover) e o gatilho vai para o rail da sidebar; `switcherOpen`, `space.overview` e o comando da paleta continuam abrindo, com teste de render que reprova a remocao. **Troca de modo usa `browser_set_visible`, NUNCA `browser_detach`** (correcao 2): detach fecha o webview e apaga `browser-cdp.json` (`panel.rs:299-314`), derrubando os criterios 4, 5 e 11 do card anterior e ressincronizando `set_min_size` 860↔420 a cada clique. Fora do modo `browser`, `syncBounds` para; ao voltar, `syncBounds(force)`. **`browser.enabled` deixa de gatear o painel e passa a gatear o modo `Browser`** (correcao 4): desligada, o item aparece desabilitado com motivo e um modo persistido invalido cai em `editor`. | vitest do modulo (ordem, fallback de valor sujo, teste de render do overview de espacos) + `check-types` + **binario de release** + captura de janela do SO dos tres itens e da troca, mais `scripts/validate-browser-panel.mjs` verde (prova de nao-regressao dos criterios 4/5/7/11 do card anterior) |
| **E2a** | **Modo Editor, so os planejadores puros** (correcao 17; escopo realinhado pela auditoria de E2a, achado 6 — o que exige `activeByPane`/fiacao desceu para E2b). Aba ganha `pane?: "left"` (ausente = `workspace`, para nao invalidar o que ja esta em disco), com `tabPane()` como leitura canonica. Passam a receber/filtrar por `(spaceId, pane)`: `planFileTabOpen` (**incluindo a chave de dedupe e a busca do slot de preview** — sem isso, arquivo ja aberto no centro faz o painel esquerdo mostrar nada), `planMarkdownTabOpen` (ponto cego do plano: o criterio 6 diz "qualquer arquivo" e .md abre por outro caminho), `nextActiveInSpace`, `pickTabBySpaceIndex`, `reorderTabsByGap` e `planSpaceRemoval` (achados 1 e 2 da auditoria de E2a: a invariante do espaco de fallback e sobre o pool do workspace). `setMarkdownView` preserva `pane` na conversao editor->markdown. Persistencia: `SpaceState.activeTabIndexByPane?` e `SerializedTab.pane?` — ambos **opcionais**, para o binario antigo ignorar e o rollback ficar limpo. Nenhuma fiacao ainda; nenhum caller passa `pane`, runtime identico (provado por grep e pelo micah-spaces.json real sem a chave). | vitest dos planejadores, incluindo os casos que o auditor nomeou: arquivo ja aberto no outro painel, slot de preview por painel, ida-e-volta de serializacao com e sem `pane` (+ valor sujo), guarda do ultimo terminal com editor vivo na esquerda, gap de reorder com aba left intercalada, invariante do fallback com so aba left |
| **E2b** | **Modo Editor, fiacao.** O app ganha **`activeByPane: Record<Pane, number>`**, nao um `leftActiveId` solto; passam a filtrar por pane os consumidores que dependem dele: `getSwitcherOrder`, o efeito de aquecimento de aba fria e `handleLeafExit` (movidos de E2a pelo achado 6 — sem `activeByPane` eles nao tem o que filtrar). Herancas obrigatorias da auditoria de E2a: **(a)** os 5 callers de `nextActiveInSpace` leem `null` como "recuse fechar" — para aba left, `null` deve esvaziar o painel, senao a ultima aba do painel esquerdo fica impossivel de fechar e o X falha calado (achado 5); **(b)** `useSpacePersistence` grava e `useSpacesBoot` le `activeTabIndex` contando os DOIS panes — dividir por pane em lockstep nos dois lados, e incluir `activeTabIndexByPane` no literal unico de `saveState` (achados 3 e 4: set substitui a chave inteira, campo fora do literal evapora). `WorkspaceSurface` recebe so abas `pane !== "left"`; o painel esquerdo em modo `editor` monta `EditorStack` com as abas `pane === "left"` e `activeByPane.left`, com faixa compacta de abas e fechar. `handleOpenFile` e o `onCreated` do `NewEditorDialog` passam `pane: "left"` quando o modo e `editor`. **Atalhos e busca passam a resolver pelo painel COM FOCO** (`focusedPane`, atualizado no `focusin` de cada host), nao pelo `activeId` do workspace — senao `editor.undo/redo/aiComplete/codeComplete` e `Cmd+F` ficam mortos justamente no modo em que se edita codigo (`App.tsx:877-906`, `:944-951`, `:1088-1116`). `TabsPanel` recebe `activeByPane` e um `onSelect(id)` que descobre o painel pela propria aba. Saida do ultimo shell (`App.tsx:1069`) e o boot de espacos (`useSpacesBoot.ts:100-103`) passam a contar so abas do workspace. | vitest + **binario de release**: clique em arquivo abre a esquerda e o centro **nao** ganha aba; Ctrl+Tab, Cmd+1..9, guarda de fechamento, restore de sessao e Cmd+F conferidos (criterio 14) |
| **E3** | **Rust do browser: eventos e favicon.** Em `panel.rs`, dentro de `with_webview`: `add_SourceChanged` + `add_HistoryChanged` + `add_DocumentTitleChanged` emitindo `micah:browser-nav {url,title}`, e `ICoreWebView2_15::add_FaviconChanged`/`GetFavicon(PNG)` emitindo `micah:browser-favicon`. **Todo cast COM novo e `if let Ok(...)`, nunca `?` no caminho de criacao do webview** (correcao 8): runtime velho degrada, nao derruba o painel. `add_NavigationCompleted` **sai** do conjunto (correcao 8, nota): `SourceChanged` ja cobre documento e fragmento, e IPC sem criterio atras fere a lei de performance do MICAH.md. **O polling de 700 ms NAO e removido** (correcao 6): vira fallback — `panel.rs:391` compila cross-platform e macOS/Linux nao tem esses eventos, entao sem polling a barra de endereco congela la e o criterio 8 do card anterior regride. No Windows o intervalo sobe para 5 s **so depois** de o registro dos handlers confirmar em runtime. Dedupe `(url, ~1s)` para o disparo duplo, **mais throttle de gravacao** (correcao 7): SPA de feed faz `pushState` com URL diferente dezenas de vezes por segundo. | `cargo test` das funcoes puras (dedupe, throttle, redacao de URL) + `cargo clippy` + log bruto de navegacao SPA real |
| **E4** | **Browser: rail de favoritos + menu sanduiche.** **Dois stores separados** (correcao 14): favoritos em `micah-browser.json`, historico em store proprio com flush por debounce — `tauri-plugin-store` reserializa o arquivo inteiro a cada `set`, e um append por navegacao ao lado de icones base64 reescreveria centenas de KB por pushState. **Favicon vai para disco** (`browser-favicons/<hash>.png`), o store guarda o caminho. **Historico redige credencial** (correcao 13): URL com parametro de credencial na query entra redigida, deny-list no espirito de `ai/lib/security.ts`, com teste unitario — historico em texto puro no app data dir e superficie nova, nao coberta pela nota de ameaca do card anterior. **Ordem do historico e por sequencia monotonica, nao por `at`** (correcao 16): passo de NTP reordena a lista; `at` so exibe, formatado por `Intl.DateTimeFormat`. Rail vertical e menu ficam **fora** do host do webview. Extensoes: `extensions_path` so e passado depois de **validar a pasta em Rust** — cada entrada e diretorio e tem `manifest.json`, o resto vai para quarentena, e zero validas = `None` (correcao 9: `wry-0.55.1/src/webview2/mod.rs:551-556` propaga `?` de cada `AddBrowserExtension`, entao um arquivo solto na pasta **mata o painel inteiro**). Carregar extensao em runtime e via COM cru `ICoreWebView2Profile7::AddBrowserExtension` dentro de `with_webview` (correcao 10: `load_extensions` do wry so roda na criacao), e a **remocao** usa `ICoreWebView2BrowserExtensionList` (correcao 11: a extensao grava no perfil e nao sai tirando o `extensions_path`; apagar o perfil derrubaria o criterio 7 do card anterior). "Limpar dados" e escopado ao perfil do painel e nomeia o que sera perdido (correcao 15). Nota de ameaca do card anterior **estendida** para extensoes, com confirmacao explicita nomeando a pasta (correcao 12). | vitest das funcoes puras (poda, redacao, dedupe) + `cargo test` da validacao da pasta + prova no ar: favorito com icone navega; historico lista e navega; extensao descompactada carrega; pasta invalida **nao** derruba o painel |
| **E5** | **Ai Viewer.** **O `AgentRunBridge` (assinante unico do `useChat`) publica** num store leve `{toolCallId, path, chunk}`; o Ai Viewer assina **esse** store (correcao 20): montar um segundo assinante de `messages` re-renderiza a cada token, e o proprio codigo ja avisa que essa rota e a mais cara (`AgentRunBridge.tsx:137-139`). A fonte do conteudo e a parte `tool-write_file` em `state: "input-streaming"` com `input.content` parcial, chaveada por **`toolCallId`** — nao por `approval.id`, que so existe em `approval-requested`, quando o input **ja esta completo** (`AgentRunBridge.tsx:187`, `ai@6.0.207` `index.d.ts:1723-1745`) (correcao 18). `edit`/`multi_edit` mostram o par velho/novo, nao arquivo reconstruido. Agente de terminal mostra o **buffer do terminal** via `live.readLeafBuffer` (`chatStore.ts:40`), rotulado como tal — `AgentSession` (`agents/lib/types.ts:12-26`) nao tem arquivo nem conteudo. Uma faixa horizontal por instancia, rotulada; sem instancia, estado vazio explicito. Cada faixa e CM6 `readOnly(true)` **e** `editable(false)`, append em lote por `requestAnimationFrame`, doc com teto e corte na mesma transacao. **Sem WebGL** (`rendererPool.ts:31` raciona contextos em 5). | vitest do redutor (fusao, ordem, teto) + prova no ar: streaming parcial aparece ao vivo; duas instancias viram duas faixas; digitar na faixa nao altera nada |
| **E6** | **Verificacao completa e prova no ar, com trilha de ACIONAMENTO** (correcao 21). Captura de janela e passiva: fotografa, nao clica; e o CDP nao alcanca a UI do Micah por construcao (so o webview-filho recebe `additional_browser_args`, `panel.rs:212-224`). Entao os criterios 2, 4, 5, 6, 7, 8 e 9 ganham acionamento por **extensao de debug do `useControlBridge`** (ja existe, ja e IPC do CLI para a UI: `control/useControlBridge.ts:119-161` + `src-tauri/src/modules/control.rs`) com metodos de introspecao/acionamento, e por `SendInput` via PowerShell (mesmo caminho de P/Invoke de `scripts/window-shot.ps1`) onde for clique de verdade. Mais `pnpm lint`, `check-types`, `test`; `cargo clippy --all-targets --locked -- -D warnings`, `cargo test --locked`, `cargo check --no-default-features` (rollback). Build id lido do ar via `browser_build_id`. | saidas brutas + PNGs em `docs/proof/left-panel/`, um artefato por criterio |
| **E7** | Registro no `memorium.yaml` com bloco `prova` (build id lido do ar) e `achados` por categoria; aviso no WhatsApp pelo Cavalo Manutencao. | entrada YAML + envio |

### Riscos conhecidos, tratados como etapa e nao como nota de rodape

1. **HWND por cima do DOM**: nada renderiza dentro do host do webview. Rail e menu ficam
   **fora** dele (E4), e a troca de modo usa `browser_set_visible` — o mesmo mecanismo que
   ja passou no criterio 13 do card anterior com PNG anexo.
2. **Espacos**: o `SpaceSwitcher` **nao sai do app**, so sai do canto. Ele e o unico
   consumidor de `handleDeleteSpace`, `handleMoveTab`, `handleReorderTab`,
   `handleNewTabInSpace` e `onReorderSpaces` (`App.tsx:1133-1197`); removido, esses
   caminhos e `removeTabsForSpace` viram codigo morto.
3. **Largura do painel**: o card anterior deixou em aberto que o painel nasce largo demais.
   E1 fecha em release, sem HMR — que e exatamente o que faltava la.
4. **`pane` nas abas** toca `useTabs`, o coracao do app: por isso virou E2a (planejadores
   puros e testados) + E2b (fiacao), com os 13 consumidores nomeados um a um.
5. **Extensoes** sao codigo arbitrario com acesso a todas as sessoes logadas do painel,
   que tem porta CDP aberta. Validacao de pasta, confirmacao nomeada, caminho de remocao
   e nota de ameaca estendida entram como entrega de E4, nao como aviso.
6. **Concorrencia na troca de modo**: com `set_visible` no lugar do detach, some a janela
   em que um `browser_attach` em voo (segundos, `useBrowserPanel.ts:284-308`) concluia
   depois de um detach e deixava webview orfa pintando por cima do editor.

## Auditorias por etapa

### Auditoria do plano (etapa 4 do protocolo) — Opus, 2026-08-14

**Veredito: aprovado com correcoes.** 24 correcoes obrigatorias, **12/12 categorias com
achado** (diferente do card anterior, este toca data e encoding, entao nenhuma linha ficou
"fora de escopo"). **As 24 foram aceitas; nenhuma recusada.** Duas eram regressao direta
contra criterios ja entregues e provados no card anterior.

| # | Categoria | Etapa | Achado | Evidencia | Correcao aplicada |
|---|-----------|-------|--------|-----------|-------------------|
| 1 | Regressao / Autorizacao | E1 | "Espacos continuam pela paleta e pelo atalho" e **falso**: o `SpaceSwitcher` e um `Popover` ancorado no gatilho do header e o unico consumidor de criar/renomear/deletar/reordenar espaco, mover aba entre espacos, new-tab-in-space e jump-to-tab | `SpaceSwitcher.tsx:239-256`; unico render em `App.tsx:1186`; `App.tsx:1133-1197`; `removeTabsForSpace` `useTabs.ts:616` | overview vira `Dialog`, gatilho vai para o rail da sidebar, componente segue montado; teste de render reprova a remocao; criterio 12 novo |
| 2 | Regressao (contra card entregue) | E1 | `browser_detach` na troca de modo **fecha o webview e apaga `browser-cdp.json`**, derrubando os criterios 4, 5 e 11 do card anterior; volta custa ate 8 s de probe com **porta nova**, e `set_min_size` alterna 860↔420 redimensionando a janela do SO a cada clique | `panel.rs:299-314`, `mod.rs:59`, `panel.rs:39`, `panel.rs:238/305` | trocar de modo usa `browser_set_visible` (`panel.rs:337-347`), o mesmo mecanismo aprovado no criterio 13 daquele card; `syncBounds` para fora do modo e volta com `force` |
| 3 | Concorrencia | E1 | Trocar de modo durante `browser_attach` em voo: o detach nao acha o label, nada fecha, o attach conclui depois e a webview fica orfa por cima do editor | `useBrowserPanel.ts:284-308` vs `panel.rs:304` | some com a correcao 2; se algum detach permanecer, epoch/generation no `BrowserState` |
| 4 | Estado e persistencia | E1 | Relacao `browser.enabled` × `mode` indefinida: `enabled=false` + `mode="browser"` = painel sem webview e sem sinal; e o criterio 14 do card anterior deixa de valer se o painel passa a existir sempre | `App.tsx:1377` | `browser.enabled` passa a gatear o **modo**, nao o painel; item desabilitado com motivo; modo invalido cai em `editor` |
| 5 | Entrada vazia ou suja | E1 | "Espelhando `readBrowserEnabled`" nao define o que fazer com valor persistido corrompido | `useBrowserPanel.ts:92-97` | fallback explicito e testado em vitest |
| 6 | Regressao / Falha externa | E3 | Remover o polling quebra a barra de endereco em macOS/Linux: `SourceChanged`/`HistoryChanged` sao API do WebView2, mas `panel.rs` e `browser_url` compilam cross-platform; e o polling e o unico caminho que grava `micah.browser.url` para o restore | `panel.rs:114/212/391`, `useBrowserPanel.ts:428` | polling vira **fallback**; no Windows sobe para 5 s so apos confirmar o registro dos handlers em runtime |
| 7 | Limite de taxa e cota | E3 | Dedupe `(url, ~1s)` cobre o disparo duplo, nao a **rajada** de `pushState` com URL diferente (feed infinito, mapa) | doc do `SourceChanged` | throttle de gravacao (>=1/s), teto rigido, coalescencia por URL consecutiva |
| 8 | Falha externa | E3 | `?` no cast `ICoreWebView2_15` propaga e mata a criacao do webview em runtime velho; `add_NavigationCompleted` e IPC redundante para URL | — | todo cast COM novo e `if let Ok(...)`; `NavigationCompleted` sai do conjunto |
| 9 | Entrada suja / Falha externa | E4 | `extensions_path` mal-formado **mata o painel inteiro**: `load_extensions` roda dentro da criacao e propaga `?` de cada `AddBrowserExtension`; um arquivo solto, uma pasta sem `manifest.json` ou runtime < 1.0.2210.55 derrubam os criterios 3-8 do card anterior | `wry-0.55.1/src/webview2/mod.rs:551-556` e `~:1353-1367` | validacao da pasta em Rust antes de passar o caminho; zero validas = `None`; teste unitario |
| 10 | Regressao | E4 | "Carregar pasta descompactada" nao funciona: `load_extensions` roda **uma vez**, na criacao | mesmo arquivo | add em runtime via COM cru `ICoreWebView2Profile7::AddBrowserExtension` dentro de `with_webview` |
| 11 | Rollback | E4 | Extensao instalada grava no **perfil** e nao sai retirando `extensions_path`; apagar o perfil derrubaria o criterio 7 do card anterior (logins) | — | caminho de remocao via `ICoreWebView2BrowserExtensionList` escrito na etapa |
| 12 | Autorizacao | E4 | Extensao descompactada e codigo arbitrario sobre todas as sessoes logadas de um painel com porta CDP aberta; a etapa nao estendia a nota de ameaca do card anterior | card anterior, E5.5 | nota estendida + confirmacao explicita nomeando a pasta |
| 13 | Segredo em claro | E4 | Historico em texto puro no app data dir inclui URL com token na query (callback OAuth, magic link, reset de senha) — superficie nova | — | redacao por deny-list de parametros, teste unitario, criterio 15 novo |
| 14 | Encoding / Volume | E4 | Icone base64 no mesmo JSON que recebe um append por navegacao: `tauri-plugin-store` reserializa o arquivo inteiro a cada `set` | — | favicon vai para disco, store guarda caminho; historico em store separado com debounce |
| 15 | Regressao | E4 | "Limpar dados" sem escopo apaga o `localStorage` da UI (largura, flag, URL e o modo novo) ou os logins do criterio 7 | `useBrowserPanel.ts:28-30` | escopo explicito + confirmacao nomeando o que sera perdido |
| 16 | Timezone e data | E4 | Ordenar historico por `at` reordena com passo de NTP ou relogio manual | — | ordem por sequencia monotonica; `at` so exibe, via `Intl.DateTimeFormat` |
| 17 | Regressao (bloqueia) | E2 | `pane` + `leftActiveId` quebra **13 consumidores**, com o pior deles silencioso: `planFileTabOpen` dedupe por `(kind, spaceId, path)` **sem pane**, entao arquivo ja aberto no centro faz o painel esquerdo mostrar **nada** e o criterio 6 falha calado. Tambem: slot de preview, aquecimento de aba fria (painel esquerdo nasce vazio a cada restart), guarda de fechamento, saida do ultimo shell, boot de espacos, `SpaceState.activeTabIndex` singular, `SerializedTab` sem `pane`, `replaceTabs` com um id so, Ctrl+Tab/MRU, Cmd+1..9, atalhos de editor mortos, `searchTarget` cego, `TabsPanel` com um ativo so | `useTabs.ts:187-264`, `:246-263`, `:514-521`, `:295-305`, `:1109-1117`; `EditorStack.tsx:24-26`; `useTabCloseGuards.ts:26`; `App.tsx:1069`, `:439-467`, `:852-856`, `:877-906`, `:944-951`, `:1088-1116`, `:1489-1493`; `useSpacesBoot.ts:100-103`, `:117`; `useSpacePersistence.ts:50-70`; `spaces/lib/store.ts:16-19`; `serialize.ts:18-27` | `activeByPane: Record<Pane, number>` no lugar do id solto; todos os planejadores passam a filtrar por `(spaceId, pane)`; `pane` entra na chave de dedupe e no slot de preview; campos de persistencia **opcionais**; atalhos e busca resolvem por `focusedPane`; etapa dividida em E2a (puro) + E2b (fiacao); criterio 14 novo |
| 18 | Falha externa / Verificabilidade | E5 | O criterio 8 original era **insatisfazivel**: `AgentSession` nao tem arquivo nem conteudo; `agentMeta` nao tem `path` nem `content`; e o conteudo do `write_file` nao esta no `chatStore` nem "em voo" — a bridge faz `if (!approvalId) continue`, e `approval` so existe em `approval-requested`, onde o input **ja esta completo** | `agents/lib/types.ts:12-26`; `chatStore.ts:50-60`, `:144`, `:40`; `AgentRunBridge.tsx:187`, `:270-325`; `ai@6.0.207 index.d.ts:1723-1745` | criterio 8 reescrito: streaming real vem de `state: "input-streaming"` chaveado por `toolCallId`; `edit`/`multi_edit` mostram o par; agente de terminal mostra o buffer do terminal |
| 19 | Verificabilidade | E5 | Criterio 9 inatingivel como escrito: o agente local tem **uma** sessao ativa e sub-agentes nao tem store nem stream proprio | `chatStore.ts:144`, `AgentRunBridge.tsx:41-44`, `ai/agents/runSubagent.ts` | criterio 9 reescrito para "agente local + agentes de terminal, ou dois de terminal" |
| 20 | Limite de taxa | E5 | Um segundo assinante de `messages` re-renderiza a cada token; o proprio codigo diz que essa e a rota mais cara | `AgentRunBridge.tsx:137-139` | o `AgentRunBridge` publica num store leve; o viewer assina o store |
| 21 | Verificabilidade | E6 | Captura de janela **fotografa, nao clica**, e o CDP nao alcanca a UI do Micah por construcao — 7 dos 11 criterios ficavam improvaveis ("eu olhei e estava certo") | `scripts/window-shot.ps1`, `panel.rs:212-224` | trilha de acionamento: extensao de debug do `useControlBridge` (`control/useControlBridge.ts:119-161`) + `SendInput` por P/Invoke |
| 22 | Rollback / Ordem | E6 | Prova em release so no fim repete a falha do card anterior, cujos criterios 1 e 2 nao fecharam **porque a validacao rodou em debug com HMR** | card anterior, secao *Por que nao foi possivel fechar agora* | E1 e E2b fecham em binario de release, cada um com sua prova |
| 23 | Ordem | — | E2 (modo Editor) tem o maior raio de dano e estava agendada em 4o; E3/E4 seriam construidas sobre um app ainda por operar no coracao | achado 17 | ordem virou E1 → E2a → E2b → E3 → E4 → E5 → E6 → E7 |
| 24 | Verificabilidade | crit. 1 | "essa ordem nao muda em nenhum estado" e quantificacao universal infalsificavel | — | vira array `readonly` fixado por teste unitario + teste de render da ordem no DOM |

**O que o auditor conferiu e CONFIRMOU** (nao regastar tempo): baseline `tauri 2.11.5` /
`wry 0.55.1` / `webview2-com 0.38.2` / `windows 0.61.3` no `Cargo.lock`; `wry` expoe
`with_browser_extensions_enabled` e `with_extensions_path` (`lib.rs:1769/1774`); Tauri expoe
os equivalentes (`webview/mod.rs:1063/1075`); `wry` **nao** expoe favicon (zero ocorrencia em
`wry-0.55.1/src/webview2/`); `webview2-com 0.38.2` traz os quatro handlers
(`callback.rs:199/213/328/539`); **`SourceChanged` pega `pushState`** com URL diferente (doc
da Microsoft; so o pushState para a *mesma* URL escapa, e ai a URL nao mudou) — era o ponto
mais provavel de o plano estar errado e estava certo; `with_webview` funciona em webview-filha
(`webview/mod.rs:1668`); CM6 read-only sobre xterm+WebGL esta **certo** (`rendererPool.ts:31`,
`readOnly` e `editable` sao Facets); `scripts/validate-browser-panel.mjs` e `window-shot.ps1`
existem e capturam em nivel de SO (`PrintWindow` + `PW_RENDERFULLCONTENT`, recusa PNG < 5 KB);
toda a tabela *Levantamento do sistema atual* bate linha a linha; `react-resizable-panels`
v4.12.2 e a API usada e a real; os tres scripts do criterio 10 existem (o card **nao** repetiu
o erro do `pnpm typecheck` do card anterior).

**Suspeitas do proprio auditor que ele investigou e DERRUBOU** (registradas porque achado
inventado custa o mesmo que achado perdido): (a) `localStorage` nao sobreviveria a janela de
Settings — falso, `open_settings_window` (`lib.rs:101`) nao passa `data_directory` nem
`additional_browser_args`, entao Settings e janela principal compartilham `EBWebView` e origem;
so o painel tem perfil proprio; (b) `useWorkspaceCwd` quebraria — falso, ela deriva de abas
**terminal** e ja ignora editor; (c) `editorRefs`/`previewRefs` colidiriam — falso, sao mapas
por id de aba e uma aba vive num painel so; o problema real e **quem le** o mapa; (d) registro
de sessoes do LSP quebraria — falso, chaveia por `(server, workspace root)` com refcount;
(e) extensoes exigiriam `.crx` ou loja — falso, o plano acertou ao dizer pasta descompactada.

### Auditoria da implementacao de E1 (executor, com prova no ar) — 2026-08-14

**Estado: E1 entregue e provado em binario de release, com um item herdado em
aberto.** Todas as capturas sao de nivel de SO (`PrintWindow`), do binario
`src-tauri/target/release/micah.exe`, sem dev server e sem HMR. Provas em
`docs/proof/left-panel/`.

| Criterio | Veredito | Prova |
|----------|----------|-------|
| 1 (sem "Default"; tres itens na ordem) | **aprovado** | `e1-01-browser.png` (canto superior esquerdo) + `e1-10-cluster.png` (o cluster da direita nao tem mais o texto "Default", so o avatar do espaco) + teste unitario da ordem do array |
| 2 (clicar troca o painel, ativo marcado) | **aprovado** | cliques reais por `SendInput`: `e1-02-editor.png`, `e1-03-ai-viewer.png`, `calib-a.png` |
| 3 (modo sobrevive ao restart) | **aprovado** | `e1-04-restart-keeps-editor.png`: app fechado e reaberto, `Editor` continua ativo |
| 12 (espacos alcancaveis e inteiros) | **aprovado** | `e1-12-spaces-popover.png`: overview abre pelo avatar no cluster, com lista, abas, "New space" e o atalho `Ctrl Shift S` |
| 13 (sem regressao contra o card anterior) | **aprovado** | `e1-16-roundtrip.png`: ida e volta `Browser -> Editor -> Browser` devolve a **mesma pagina logada**, sem recarregar. `browser_set_visible` no lugar de `browser_detach` fez o que a correcao 2 previa |
| 10 (checagens) | **parcial** | `pnpm check-types` limpo, `pnpm test` 745/745 verde, biome sem achado novo nos arquivos tocados. Rust ainda nao rodado nesta etapa |

**Achados do executor durante E1, todos corrigidos e re-provados:**

| # | Categoria | Achado | Evidencia | Correcao |
|---|-----------|--------|-----------|----------|
| E1-1 | Falha externa / Verificabilidade | `scripts/window-shot.ps1` capturava **um recorte do canto superior esquerdo** da janela e reportava sucesso: o host PowerShell e DPI-unaware, entao `GetWindowRect` responde em pixels logicos enquanto `PrintWindow` pinta em fisicos. Num monitor a 150% sumia o terco direito da janela, ou seja **todo o cluster do header**, e a captura passava como completa. Isso contamina retroativamente as provas do card anterior | captura reportando 2575x1392 para uma janela de 3862x2110 | `SetProcessDPIAware()` no script; a captura passou a bater 1:1 com os pixels |
| E1-2 | Verificabilidade | Captura de tela nao clica. Sem trilha de acionamento, os criterios 2 a 9 nao eram falsificaveis (correcao 21 do auditor) | — | `scripts/window-click.ps1` e `scripts/window-key.ps1` novos, por `SendInput`/`keybd_event`, com o mesmo `SetProcessDPIAware` (sem ele um clique mirado em `Editor` cai em `Ai Viewer` e o run reporta sucesso) |
| E1-3 | Regressao (bloqueia) | Esconder a superficie do browser com `display: none` **matava o painel**: o host deixa de ter caixa, `measure()` devolve nulo, as 8 tentativas de attach se esgotam e o webview nunca mais e anexado. Bootar em modo `Editor` e depois ir para `Browser` dava barra de endereco preenchida e **pagina em branco** | `e1-13-back-to-browser.png` | a superficie do browser passou a esconder com `invisible` (mantem layout, mantem medida) e `visible` volta a zerar o contador de tentativas |
| E1-4 | Estado e persistencia | Um **clique** no divisor contava como arrasto: `suppress("handle-drag")` marcava `draggingRef` no `pointerdown`, e a passagem de layout seguinte gravava a largura corrente. Foi assim que a largura errada virou a largura salva no meio desta propria sessao | `useBrowserPanel.ts` (`suppress`) | so movimento com o ponteiro pressionado conta como arrasto; chave de largura para `v5`, porque nenhum dos dois consertos cura valor ja gravado em disco |

**Item herdado que continua em aberto (nao e regressao desta etapa):** o painel
esquerdo **nasce largo demais** e cresce ate `BROWSER_MAX_WIDTH`. Isto e o mesmo
que o card anterior deixou aberto nos criterios 1 e 2 dele, e agora esta medido
**em binario de release, sem HMR** — que era exatamente o que faltava la. O que
esta etapa acrescentou de diagnostico: (a) nao e valor envenenado no
`localStorage`, porque acontece com a chave nova e vazia; (b) nao e o
`defaultSize` percentual do painel de workspace, porque remove-lo nao mudou o
sintoma (mudanca revertida por nao estar provada); (c) o laco que reaplica a
largura por `requestAnimationFrame` roda e nao consegue segurar o valor. A
proxima tentativa tem de ser sobre a semantica de tamanhos mistos px/% do
`react-resizable-panels` v4, com um caso reduzido, e nao mais por tentativa.

### Auditoria da implementacao de E2a (auditor Opus independente) — 2026-08-15

**Veredito: aprovado com correcoes — 7 achados, todos aceitos e aplicados; zero
mudanca de runtime hoje (provado pelo auditor: grep de producao sem `pane:
"left"` fora de teste/planejador, e o `micah-spaces.json` real sem a chave).**
O auditor reverificou por conta propria: `check-types` exit 0, 792/792 verdes
antes das correcoes; 795/795 depois delas.

| # | Categoria | Achado | Evidencia | Correcao |
|---|-----------|--------|-----------|----------|
| 1 | Regressao (latente E2b) | `reorderTabsByGap` ficou o unico planejador puro sem escopo de pane: com faixa E2b filtrada, pool `[L1,W1,W2]` vs faixa `[W1,W2]` faz o arrasto de W1 para o fim virar no-op silencioso (`spaceTarget === spaceFrom`) | `useTabs.ts` (filtro sem `tabPane`); `TabsPanel.tsx:47-48,246`; `App.tsx:314-317` | pool passa a `(spaceId, pane)` do proprio tab arrastado + teste com aba left intercalada |
| 2 | Regressao (latente E2b) | `planSpaceRemoval` contava abas dos dois panes na invariante "fallback nunca vazio": espaco de fallback so com abas left nao ganharia o terminal frio e o centro ficaria vazio, com `activeId` podendo cair numa aba left | `useTabs.ts` (as duas verificacoes de fallback) | as duas verificacoes escopadas a `tabPane === "workspace"` + 2 testes; o terminal frio nasce workspace (confirmado correto) |
| 3 | Estado e persistencia | comentario novo em `SpaceState.activeTabIndex` afirmava "index within the workspace pane" — falso: o produtor (`useSpacePersistence.ts`) conta os dois panes; implementador de E2b leria contrato que nao existe | `store.ts` vs `useSpacePersistence.ts:54-59` | comentario corrigido para o contrato real, com o split anotado como trabalho de E2b em lockstep |
| 4 | Estado e persistencia / Rollback | `activeTabIndexByPane` e campo morto e `saveState` substitui a chave inteira: qualquer writer futuro que grave o campo o perde no proximo flush deste caminho | `useSpacePersistence.ts:69`, `store.ts:63-65` | sem mudanca de codigo em E2a; heranca (b) escrita na linha E2b do plano |
| 5 | Regressao (contradicao interna) | comentario e nome de teste vendiam "left pool esvazia o painel", mas TODOS os 5 callers leem `null` como "recuse fechar" — em E2b a ultima aba left seria impossivel de fechar, com o X falhando calado | `useTabs.ts` callers; `useTabCloseGuards.ts:26-28` | comentario e teste reescritos para a semantica real ("no fallback exists"; decisao e dos callers em E2b); heranca (a) escrita na linha E2b |
| 6 | Escopo / LEI DA PROVA | card e arvore discordavam: a linha E2a atribuia `activeByPane`, `getSwitcherOrder`, aquecimento e `handleLeafExit`, que exigem fiacao e nao foram (nem deviam ser) tocados | linha E2a do plano vs arvore | linhas E2a/E2b do plano realinhadas ao escopo real, com os 4 itens movidos para E2b |
| 7 | Estilo | duas linhas novas fora do `biome format` (mascaradas pelo CRLF do repo) | `pickTabBySpaceIndex`, assinatura de `newMarkdownTab` | formatadas |

**Achado do executor durante E2a** (antes da auditoria): o plano omitia
`planMarkdownTabOpen` — o criterio 6 diz "qualquer arquivo" e `.md` abre por
`newMarkdownTab`, nao por `openFileTab`; sem pane ali, clicar num `.md` no modo
Editor abriria no centro. Corrigido com o mesmo padrao (+ `setMarkdownView`
preservando `pane` na conversao editor->markdown, que reconstruia o objeto e o
perderia).

**Suspeitas do auditor investigadas e derrubadas** (registradas para nao
regastar): os 7 callers de `nextActiveInSpace` sao bit-a-bit equivalentes hoje
(tautologia `tabPane===tabPane` sem abas left); a intersection em
`SerializedTab` nao quebra narrowing (TS distribui sobre a union); JSON
antigo->novo e novo->antigo nao estouram (nenhum writer emite `pane` ainda);
`prepareClaudeResumes`/`dropResumeLeaves` preservam `pane` por spread; o
control bridge nao repassa `pane` externo (`openControlFile` desestrutura
campos nomeados); `newMarkdownTab` tem um unico call site e nao e passada como
handler.

### Auditoria da implementacao de E2b (auditor Opus independente) — 2026-08-15

**Veredito: 7 achados (1 bloqueante), todos aceitos e corrigidos; 12 suspeitas
investigadas e derrubadas com prova.** O auditor reverificou por conta propria
check-types 0, vitest 798/798 e lint na baseline de 99 warnings, e validou as
duas divergencias deliberadas do plano como defensaveis (TabsPanel sem
activeByPane: "melhor que o plano, fecha o achado 1 de E2a por construcao").
Pos-correcao: check-types 0, 798/798, lint 99 (baseline).

| # | Categoria | Achado | Correcao aplicada |
|---|-----------|--------|-------------------|
| A1 | Regressao / Estado (**bloqueava**) | Trocar o modo do painel, fecha-lo ou trocar de espaco DESMONTAVA o editor esquerdo e descartava edicoes nao salvas em silencio (buffer CM mora em estado de componente, sem flush no unmount; `editorAutoSave` default false; `dirty` ainda true apontando para buffer destruido) | Pilhas do editor esquerdo agora ficam MONTADAS: recebem `stackTabs` = todas as abas left de todos os espacos (como o centro recebe workspaceTabs), escondem com `invisible` fora do modo editor, e o estado vazio e overlay, nao substituto; fechar o painel (que desmonta o ResizablePanel inteiro) com editor sujo passa a ser recusado com toast dizendo o porque |
| A2 | Regressao | `focusedPane` travava em "left" via browser chrome ou ao fechar a ultima aba left, matando editor.undo/redo/aiComplete/codeComplete do centro (contra o proprio motivo da linha E2b e o criterio 14) | `effectivePane` derivado (`focusedPane==="left" && leftEditorShowing && activeLeftTab`) usado em TODAS as rotas de teclado; `onFocusCapture` movido do painel inteiro para o container do modo editor |
| A3 | Regressao | Arrastar aba left para outro espaco no overview deixava `activeByPane.left` orfao (painel em branco sem cura): `moveTabToSpace` compara com o ativo do WORKSPACE e o efeito de troca de espaco so rodava em mudanca de espaco | O repontuamento virou INVARIANTE: efeito que dispara sempre que o left ativo deixa de existir no pool do espaco ativo (cobre troca de espaco, drag cross-space e fechamento); o bloco no efeito de troca de espaco saiu |
| A4 | Estado e persistencia | `activeTabIndexByPane` era apagado sempre que um espaco NAO-ativo regravava (herança b cumprida pela metade: sem seed, o spread condicional omitia a chave e saveState substitui a chave inteira) | Seed do disco: `useSpaces.hydrate` ganhou `initialActiveByPane`, o boot o alimenta, e o flush carrega `prev.byPane` adiante para espacos de fundo |
| A5 | Regressao | Cmd+W nao roteava pelo pane com foco: com foco no editor esquerdo, fechava aba do CENTRO (podendo ser terminal com processo vivo) | `handleCloseTabOrPane` roteia por `effectivePane`; left fecha via handleClose (guardas de sujo/processo intactas) |
| A6 | Volume | `setActiveId` perdeu o bail-out do useState (objeto novo sempre): ativacao no-op re-renderizava o App e invalidava `activeByPane` (disparo extra do efeito de aquecimento) | Bail-out nos dois setters: valor igual devolve `prev` |
| A7 | Estado (doc) | Comentarios de `store.ts` ficaram falsos apos E2b (mesma classe do achado 3 de E2a, invertida) | Reescritos para o contrato real (legacy = dois panes, para binario antigo; byPane = ativo calculado + fundo preservado por seed) |

**Aviso de integridade registrado pelo auditor**: durante a checagem ele rodou
`biome format --write ./src` por engano (137 arquivos) e RESTAUROU a arvore ao
byte (diff stat identico, suite e lint reconferidos). Sem efeito residual.

**Divergencia adicional anotada (parecer do auditor)**: "ir para definicao" do
LSP a partir de um editor esquerdo abre o resultado no CENTRO
(`openContentHit` e o navegador do LSP). Nao fere criterio escrito; fica
registrado como comportamento deliberado ate um card proprio decidir o
contrario.

**Pendente para fechar E2b**: prova no ar em binario de release (Ctrl+Tab,
Cmd+1..9, guarda de fechamento, restore, Cmd+F, criterios 6 e 7) — o binario
com E2b+correcoes esta buildado; a prova de clique sera colhida na proxima
reabertura do app, sem derrubar a sessao viva do Rodrigo.

## Validacao independente

<a preencher>

## Rastro

<a preencher>
