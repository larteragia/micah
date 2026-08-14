# Painel esquerdo com tres modos: Browser | Editor | Ai Viewer

- **Data**: 2026-08-14
- **Autor do card**: Rodrigo Campos
- **Coluna**: Fazendo

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
   `Browser`, `Editor`, `Ai Viewer`, e essa ordem nao muda em nenhum estado.
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
8. No modo `Ai Viewer`: com uma sessao de AI escrevendo ou editando arquivo, o
   painel mostra em tempo real o arquivo alvo e o conteudo sendo escrito, e o
   painel e somente leitura (digitar nele nao altera o arquivo nem o buffer).
9. No modo `Ai Viewer`: com duas ou mais instancias de AI ativas ao mesmo tempo,
   o painel se divide em faixas horizontais, uma por instancia, cada faixa
   identificada pela instancia que ela mostra.
10. `pnpm lint`, `pnpm check-types` e `pnpm test` passam; `cargo clippy
    --all-targets --locked -- -D warnings` e `cargo test --locked` passam em
    `src-tauri`.
11. O binario `src-tauri/target/release/micah.exe` e reconstruido e executado, e
    o comportamento dos itens 1 a 9 e conferido no app rodando, com prova.

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

> Ordem escolhida: primeiro a moldura (E1), que ja entrega os criterios 1-3 e
> destrava os tres modos; depois um modo por etapa, cada um com auditoria propria.

| Etapa | Entrega | Prova da etapa |
|-------|---------|----------------|
| **E1** | **Moldura dos tres modos.** Modulo novo `src/modules/left-panel/`: `LeftPanelMode = "browser" \| "editor" \| "ai-viewer"`, leitura/escrita persistida (funcoes puras testadas, espelhando `readBrowserEnabled`), e `LeftPanelSwitcher.tsx` (tres botoes segmentados, ordem constante vinda de um array `readonly`, `aria-pressed` no ativo). `App.tsx` passa o switcher no slot do Header que hoje recebe `spaceSwitcher`. **Espacos nao sao removidos**: continuam pelo atalho `space.overview` e pela paleta (`App.tsx:859`, `commands.ts`), so saem do canto superior esquerdo. O painel da esquerda passa a existir independente do modo. **Regra de HWND**: o webview nativo so fica anexado quando o modo e `browser` — `useBrowserPanel` ganha `active` e o attach passa a ser `enabled && active`; nos outros modos, `browser_detach`. | vitest do modulo + `check-types` + captura de janela do SO mostrando os tres itens e a troca |
| **E2** | **Rust do browser: eventos e favicon.** Em `browser/panel.rs`, dentro de `with_webview`: `add_SourceChanged` + `add_HistoryChanged` + `add_NavigationCompleted` + `add_DocumentTitleChanged` emitindo `micah:browser-nav {url, title}`, e `ICoreWebView2_15::add_FaviconChanged`/`GetFavicon(PNG)` emitindo `micah:browser-favicon {url, png_base64}`. **Remove o polling de 700 ms** de `useBrowserPanel.ts:419-439`. Tudo atras da feature `browser-panel`; `stub.rs` mantem as assinaturas. Deduplicacao `(url, janela ~1s)` porque SourceChanged e HistoryChanged disparam juntos num pushState. | `cargo test` das funcoes puras de dedupe + `cargo clippy` + log bruto dos eventos numa navegacao SPA real (GitHub) |
| **E3** | **Browser: rail de favoritos + menu sanduiche.** Store `micah-browser.json` via `tauri-plugin-store` (`bookmarks: [{id,url,title,iconPng}]`, `history: [{url,title,at}]` com teto de N e poda). Rail vertical na borda esquerda do painel, **fora** do host do webview (o HWND pinta por cima de qualquer coisa dentro dele); botao "adicionar pagina atual"; menu de contexto renomear/remover; reordenar. Menu sanduiche (`DropdownMenu`) com `Historico` (lista invertida, clique navega), `Extensoes` (lista as carregadas, botao "carregar pasta descompactada" via plugin dialog) e `Limpar dados`. Webview-filha passa a nascer com `browser_extensions_enabled(true)` + `extensions_path` no app data dir (o painel **ja tem** `data_directory` proprio, `PROFILE_DIR="browser-profile"`, entao nao contamina a UI do app). | vitest das funcoes puras (poda de historico, dedupe de favorito, normalizacao de URL ja existente) + prova no ar: favorito criado aparece com icone e navega; historico lista e navega; extensao descompactada carrega |
| **E4** | **Modo Editor.** Aba ganha `pane: "workspace" \| "left"` (ausente = `workspace`, para nao invalidar o que ja esta em disco) e o app ganha um segundo id ativo, `leftActiveId`, ao lado de `activeId`. `openFileTab` aceita `options.pane`; `handleOpenFile` e o `onCreated` do `NewEditorDialog` passam `pane: "left"` quando o modo do painel e `editor`. `WorkspaceSurface` passa a receber so as abas `pane !== "left"`; o painel da esquerda em modo `editor` monta `EditorStack` com as abas `pane === "left"` e `leftActiveId`, mais uma faixa compacta de abas com fechar. `serialize.ts` carrega o `pane`; `TabsPanel` marca de qual painel a aba e. Fechar a ultima aba da esquerda deixa um estado vazio explicito, nao um painel morto. | vitest dos planejadores puros (`planFileTabOpen` com `pane`, serializacao ida-e-volta, fechamento) + prova no ar: clique em arquivo abre a esquerda e **o painel central nao ganha aba** |
| **E5** | **Ai Viewer.** Modulo `left-panel/AiViewer`: fonte de dados unica `useAiActivity()` que funde (a) o agente local (`chatStore.agentMeta` + argumentos de `write_file` em voo, que e de onde `AgentRunBridge` ja tira o conteudo proposto) e (b) cada sessao de agente de terminal viva em `agentStore.sessions`. Uma faixa horizontal por instancia, rotulada, empilhadas; sem instancia ativa, estado vazio explicito. Cada faixa e um CM6 `readOnly` + `editable(false)`, append em lote por `requestAnimationFrame`, doc com teto e corte na mesma transacao, linguagem resolvida pelo caminho do arquivo. **Sem WebGL**, pela razao medida na tabela de pesquisa (o pool de renderers do terminal ja e racionado em 5). | vitest do redutor de atividade (fusao, ordem, teto do buffer) + prova no ar: uma instancia escrevendo aparece ao vivo; duas instancias viram duas faixas; digitar na faixa nao altera nada |
| **E6** | **Verificacao completa e prova no ar.** `pnpm lint`, `pnpm check-types`, `pnpm test`; `cargo clippy --all-targets --locked -- -D warnings`, `cargo test --locked`, e `cargo check --no-default-features` (prova de rollback, como no card anterior). Fechar o `micah.exe`, `pnpm tauri build --no-bundle`, subir o binario de release e conferir os criterios 1 a 9 com captura de janela do SO (`PrintWindow`, o mesmo caminho de `scripts/validate-browser-panel.mjs`) — o CDP **nao serve** para dirigir a UI do Micah, por decisao do card anterior (criterio 6 de la). Build id lido do ar via `browser_build_id`. | saidas brutas + PNGs em `docs/proof/left-panel/` |
| **E7** | Registro no `memorium.yaml` com bloco `prova` (build id lido do ar) e `achados` por categoria; aviso no WhatsApp pelo Cavalo Manutencao. | entrada YAML + envio |

### Riscos conhecidos, tratados como etapa e nao como nota de rodape

1. **HWND por cima do DOM**: qualquer coisa desenhada dentro do host do browser fica
   invisivel. O rail de favoritos e o menu ficam **fora** do host (E3), e a troca de modo
   **detacha** o webview (E1), nao apenas o esconde com CSS.
2. **Espacos**: tirar o `SpaceSwitcher` do header nao pode deixar o recurso inalcancavel
   nem quebrar a persistencia por espaco. E1 mantem atalho e paleta, e a suite de testes
   de espacos tem de continuar verde.
3. **Largura do painel**: o card anterior deixou em aberto que o painel nasce largo demais
   (`react-resizable-panels` nao resolve pixel no primeiro commit). E1 nao piora isso, e E6
   mede em binario de release, sem HMR, que era exatamente o que faltava para fechar la.
4. **`pane` nas abas** (E4) toca `useTabs`, que e o coracao do app. Toda a logica nova
   entra em planejadores **puros e testados**; o hook so orquestra.
5. **Extensoes** exigem que o webview do painel tenha data dir proprio (ja tem) e que a
   configuracao de extensoes seja identica em toda webview que compartilhe o dir; a UI do
   app **nao** liga extensoes.

## Auditorias por etapa

<a preencher>

## Validacao independente

<a preencher>

## Rastro

<a preencher>
