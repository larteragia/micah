# Browser real embutido no Micah, com Playwright sempre conectada

- **Data**: 2026-08-14
- **Autor do card**: Rodrigo Campos
- **Coluna**: A fazer

> **2026-08-14, MAXIMO 01 CARD POR VEZ**: os itens em aberto deste card
> (criterios 1 e 2 — largura do painel) foram absorvidos e FECHADOS pelo B1 de
> `browser-pdi-2026-08-14.md`, que e o card ativo. Este card volta para a fila
> so para a re-validacao final dos criterios ja aprovados, quando o PDI fechar.

## Descrição

Hoje o Micah/Micah tem uma aba **Preview** que é apenas um `<iframe>` dentro da própria
WebView2 do app (`src/modules/preview/PreviewPane.tsx`). Isso morre em qualquer site que
mande `X-Frame-Options: DENY` ou `frame-ancestors` (Google, GitHub, bancos, painéis
administrativos, praticamente tudo que não seja `localhost`), e não expõe nenhum
protocolo de automação — o agente não consegue clicar, ler DOM, tirar screenshot nem
validar comportamento ali dentro.

O pedido é trazer um **browser de verdade para dentro da janela**, em tela dividida com o
terminal, e deixar o **Playwright permanentemente conectado** nele, para o agente
implementar e **validar no mesmo navegador** que o humano está olhando.

## Critério de aceite

Transcrição verificável do alvo falado pelo autor do card (seção *Comentários humanos*).
Cada linha é conferida individualmente pela validação independente, com prova anexa.

| # | Critério |
|---|----------|
| 1 | Com o app aberto, existe um painel de **browser sempre à esquerda** da área de trabalho, e o **divisor** entre browser e terminal é **arrastável com o mouse**, mudando a largura dos dois (não é split fixo). |
| 2 | A largura escolhida do painel **persiste** entre reinícios do app. |
| 3 | O painel carrega um **site real de terceiros que hoje quebra no preview** por `X-Frame-Options` (ex.: `https://www.google.com`) e **renderiza a página** — não tela branca, não erro de frame. |
| 4 | O app expõe um endpoint **CDP** em `127.0.0.1:<porta>`, e `chromium.connectOverCDP(...)` conecta, lista ao menos 1 `page` cuja `url()` bate com a URL aberta no painel, lê `page.title()` e faz `page.goto()` **mudando o que aparece na tela do Micah**. |
| 5 | A porta CDP é **descoberta programaticamente** pelo agente (comando Tauri + arquivo em disco), sem número chumbado no código do agente. |
| 6 | A webview do browser usa **`data_directory` próprio**, separado do perfil da UI do app: os targets listados pelo CDP **não incluem** a UI do próprio Micah. |
| 7 | **Sessão persiste**: um login feito no painel continua logado depois de fechar e reabrir o app. |
| 8 | Barra de endereço com **voltar / avançar / recarregar** funcionando, e a URL exibida **acompanha a navegação** feita dentro da página. |
| 9 | `pnpm typecheck`, a suíte de testes (`vitest`) e `cargo check` passam limpos. |
| 10 | O binário `micah.exe` é **reconstruído e conferido no ar**: o app rodando reporta o mesmo identificador de build/commit que foi publicado. |

## Comentários humanos (o alvo)

> "voce acha que tem como criarmos um browzer aqui com o fork de algum opensource, ou mesmo
> vivaldi, brave origin, duck duck go... Eu trabalho sempre com o browzer aberto do lago, eu
> sei que o micah/micah tem acesso a browser semi configurado, seria possível trazermos um
> inteiro pra dentro para daí o agente poder trabalhar e validar diretamente nele com
> playwright sempre conectada?"

> "faça isso com a tela dividida sem ser fixa, possibilidade de arrastar de um lado pra
> outro, sempre do lado esquerdo o browser"

Leitura do alvo, em ordem de autoridade:

1. **Browser inteiro dentro do Micah** — não um preview, não uma aba externa.
2. **Playwright sempre conectada** nele, para o agente trabalhar e validar.
3. **Split arrastável**, browser **fixo à esquerda**, larguras livres.

## Levantamento do sistema atual

| Peça | Estado hoje | Arquivo |
|------|-------------|---------|
| Preview web | `<iframe sandbox>` dentro da WebView2 do app; quebra em `X-Frame-Options`; sem CDP | `src/modules/preview/PreviewPane.tsx` |
| Layout | `ResizablePanelGroup` horizontal: workspace (78%) + sidebar (direita, colapsável, largura persistida) | `src/app/App.tsx:1352+` |
| Runtime | Tauri v2 + wry; no Windows a webview é **WebView2 (Edge/Chromium)** | `src-tauri/Cargo.toml` |
| Janelas | `WebviewWindowBuilder`; multi-janela já implementado hoje (`open_new_window`) | `src-tauri/src/lib.rs:162` |
| CSP | `frame-src 'self' http: https:` já liberado; `connect-src` já libera `http://127.0.0.1:*` | `src-tauri/tauri.conf.json` |

## Comparativo das opções (a pesquisa que sustenta o plano)

| Opção | O que é | Custo | Playwright | Perfil/logins | Veredito |
|-------|---------|-------|-----------|---------------|----------|
| **A. Fork de Brave / Vivaldi / Chromium** | Compilar um browser inteiro e casar com o Micah | Build de Chromium: ~100 GB de disco, horas de compilação, manutenção de rebase eterna | Sim | Sim | **Rejeitado.** Custo desproporcional e **não resolve o problema real**, que é *embutir* — o fork continuaria sendo um processo separado a ser embutido do mesmo jeito. |
| **B. Chrome/CamoFox real reparentado** (`SetParent` do Win32) | Subir Chrome com `--remote-debugging-port` e enfiar o HWND dele dentro da janela do Micah | Médio; gambiarra de foco/teclado; **só Windows** | Sim, nativo | Sim, perfil completo + extensões | **Fallback.** Melhor anti-bot e extensões, mas frágil (foco, DPI, z-order) e amarra o recurso ao Windows. |
| **C. Child webview do próprio Tauri (WebView2) + CDP** | `window.add_child(WebviewBuilder, pos, size)` (feature `unstable`), com `additional_browser_args("--remote-debugging-port=…")` e `data_directory` próprio | Baixo: zero binário novo, WebView2 já é requisito do app | Sim — `chromium.connectOverCDP` fala com WebView2 (é Edge/Chromium) | Sim, persistente no `data_directory` | **Escolhido.** |

**Por que C.** É Chromium de verdade (não iframe): sem `X-Frame-Options`, sem sandbox de
frame, com sessão persistente e CDP nativo. Não adiciona um único byte de binário — a
WebView2 já é dependência declarada do instalador. E o `data_directory` separado, que o
Tauri **exige** quando os `additional_browser_args` diferem, cai como ganho de segurança:
como o Windows dá um **processo de browser separado por user-data-folder**, a porta CDP
enxerga **só a webview do painel**, nunca a UI do próprio Micah.

**Riscos conhecidos e mitigação** (entram no plano como etapas, não como nota de rodapé):

- *Webview nativa pinta por cima do HTML*: menus, paleta de comandos e diálogos que
  cruzarem a área do painel ficariam escondidos atrás dele. → Mitigação: esconder/encolher
  a webview enquanto houver overlay aberto.
- *CDP é porta sem autenticação*: qualquer processo local que ache a porta controla o
  painel. → Mitigação: `127.0.0.1` apenas, porta efêmera sorteada por sessão, arquivo de
  descoberta com permissão de usuário, e o recurso desligado por padrão até ser ligado.
- *macOS/Linux não têm CDP na webview* (WebKitGTK/WKWebView). → O painel funciona nos três
  sistemas; a ponte Playwright degrada para "indisponível" fora do Windows, declarado em
  tela, sem quebrar o app.

## Plano em etapas

> **v2 — revisado pelo auditor de plano (Opus, 2026-08-14, veredito "aprovado com correções",
> 15 achados).** As 14 correções obrigatórias estão incorporadas abaixo. O registro completo
> da auditoria está em *Auditorias por etapa*.

| Etapa | Entrega | Prova da etapa |
|-------|---------|----------------|
| **E1** | Card + `memorium.yaml` na raiz do repo | arquivos versionados |
| **E1.5** | **Capabilities**: trocar `"windows"` por `"webviews"` em `capabilities/default.json`, `desktop.json` e `clipboard.json`. Sem isso a webview-filha **herda** `core:default`+`store`+`os`+`notification` da janela `main` (doc do `Capability`: casar por `windows` habilita *todas* as webviews daquela janela). O rótulo `browser*` jamais aparece em capability alguma. | `cargo check` + app sobe com IPC funcionando |
| **E0** | **Flag de recurso** `browser.enabled` persistida + kill-switch em runtime; nenhuma webview-filha nasce com a flag desligada. Default: `true` no Windows, `false` nos demais (ver *Desvio deliberado* abaixo). | teste do store |
| **E2.5** | **Spike técnico obrigatório** em `tauri 2.11.5`/`wry 0.55.1`, antes de E3: (a) `add_child` renderiza na posição pedida; (b) `additional_browser_args` do filho é honrado (porta CDP responde); (c) `set_bounds` sobrevive a maximizar/restaurar/redimensionar em série (bugs upstream #10131, #10420, #11376); (d) matriz de medição zoom-de-app × DPI. Comparar com a variante **C′** (`WebviewWindowBuilder` filha com `.parent()`, sem a feature `unstable`). **Decidir C ou C′ com o número medido.** | saída bruta do spike |
| **E2** | **Rust**, módulo `browser`: comandos **`async`** (`add_child` faz `run_on_main_thread`+`recv()` bloqueante — comando síncrono deadlocka); args `--remote-debugging-port=0` **preservando** `--disable-features=msWebOOUI,msPdfOOUI` do wry, **sem** `--remote-allow-origins` (Playwright não manda header `Origin`; `*` abriria o painel para qualquer página web da máquina); porta real lida de `<data_directory>/DevToolsActivePort` com timeout e fallback; `data_directory` **único por processo**, com guarda que aborta se colidir com o `EBWebView` do app; modelo multi-janela `main-N` decidido e escrito; **falha aqui não impede o app de subir** | `cargo check` (com e **sem** `unstable`) |
| **E3a** | Função **pura** `rect → bounds`, testada em vitest na matriz de zoom (`--app-zoom` CSS, que multiplica `devicePixelRatio` e distorce `getBoundingClientRect`) × DPI do Windows, contemplando a borda de 1px e o raio de 12px de `#root` (que **não** clipa HWND) e o offset do `Header` | vitest |
| **E3b** | **Painel + divisor**: `hide()` no `pointerdown` do handle com placeholder HTML, `show()`+`set_bounds` no `pointerup` — mata de uma vez a perda de *pointer capture* (o HWND filho engole os `pointermove` e trava o arrasto) e o flood de IPC; fora do gesto, `set_bounds` via `requestAnimationFrame` com dedupe de retângulo idêntico; largura persistida espelhando `useSidebarPanel.ts`; barra de endereço com validação de URL (só `http`/`https`, string vazia = no-op, esquema ausente normalizado) | vitest + `check-types` |
| **E3c** | **Sincronização de URL**: `on_navigation` + `on_page_load` **+** polling de `Webview::url()` — nenhum dos dois primeiros dispara em `history.pushState`, que é exatamente o caso de Google/GitHub/painéis (os alvos do card) | vitest |
| **E4** | **Anti-sobreposição** com lista **exaustiva** de overlays (`Toaster`, `TabSwitcherHud`, `SelectionAskAi`, `AiMiniWindow`, `UpdaterDialog`, `CloseDialogs`, `NewEditorDialog`, tooltip/dropdown/select/context-menu) + estado `suppressed` exposto à ponte, para o agente não clicar às cegas numa webview escondida | teste unitário do reducer, um caso por overlay |
| **E5** | **Ponte Playwright**: `{schema, port, ws_endpoint, pid, started_at, window_label}` no app data dir; escrito **só depois** de `GET /json/version` responder; liveness validada na leitura; apagado no `Destroyed` e no shutdown | script lê o arquivo e conecta |
| **E5.5** | **Nota de ameaça no card**: cookies de sessão em claro no `data_directory`; `Network.getAllCookies`, `file://`+`Runtime.evaluate` e `Browser.setDownloadBehavior` acessíveis a **qualquer processo do mesmo usuário** — o arquivo de descoberta **não é** controle de segurança, a porta é varrível em segundos | seção escrita |
| **E6** | **Build id**: `build.rs` emite `MICAH_BUILD_ID` de `git rev-parse --short HEAD` (+`-dirty`), exposto por comando, logado no boot e visível na UI; `micah.exe` reconstruído | build id lido do app no ar |
| **E7a** | **Validação por CDP** — critérios 3, 4, 5, 6, 7 (os únicos falsificáveis por Playwright), com **screenshot de janela do SO** (não do CDP, que devolve quadro mesmo com a webview escondida ou de bounds zerados) + asserção de `bounds` não-vazio e `visible == true` no instante da captura | saída bruta + PNG |
| **E7b** | **Validação fora do CDP** — critérios 1, 2, 8, 9, 10: o critério 6 proíbe o CDP de enxergar a UI do Micah, logo estes **não podem** ser provados por Playwright. Vão por captura de janela em nível de SO + testes unitários + `pnpm check-types && pnpm test && cargo check` (e `cargo check` sem `unstable`, provando o rollback) | saída bruta + PNG |
| **E8** | Registro no `memorium.yaml` **com bloco `prova`**, mais o veredito do spike (C ou C′), porta/`data_directory` escolhidos e o procedimento de rollback; aviso no WhatsApp pelo Cavalo | entrada YAML + envio |

### Desvio deliberado da correção 1 do auditor (default da flag)

O auditor pediu `browser.enabled` default **`false`**. Fica **`true` no Windows**, `false` fora,
e a justificativa está no alvo escrito pelo autor: *"Eu trabalho sempre com o browser aberto"* —
recurso que nasce desligado contraria o pedido e o autor teria de religar em toda instalação.
O que o auditor realmente protegia era o **rollback**, e ele continua inteiro: a flag existe,
é persistida, tem kill-switch em runtime, e fora do Windows (onde não há CDP) nasce desligada.

## Critérios de aceite acrescentados após a auditoria

| # | Critério |
|---|----------|
| 11 | **Playwright *sempre* conectada**: após reiniciar o app, um novo `connectOverCDP` lendo o arquivo de descoberta conecta de novo, sem intervenção manual. |
| 12 | Digitar dentro de uma página do painel funciona (foco real de teclado), e os atalhos globais do Micah continuam respondendo com o foco no painel. |
| 13 | Overlays da UI (paleta de comandos, diálogos, toasts) aparecem **por cima** do painel, nunca atrás dele. |
| 14 | A flag `browser.enabled` desliga o painel de verdade: webview destruída, porta CDP fechada, arquivo de descoberta removido. |
| 15 | Comportamento definido e testado com uma segunda janela (`main-2`): sem colisão de `data_directory` nem de porta. |
| 16 | Fora do Windows o app sobe normalmente com o painel indisponível e o motivo declarado em tela — sem crash, sem tela quebrada. |

## Auditorias por etapa

### Auditoria do plano (etapa 4 do protocolo) — Opus, 2026-08-14

**Veredito: aprovado com correções.** A opção C não foi derrubada — todas as APIs assumidas
existem em `tauri 2.11.5`/`wry 0.55.1` (confirmado em `src-tauri/Cargo.lock`). Mas o plano v1
tinha 6 defeitos que virariam bug ou furo garantido. Achados por categoria (12/12 varridas;
*Timezone e data* = fora de escopo, as outras 11 = achado):

| # | Categoria | Etapa | Achado | Evidência |
|---|-----------|-------|--------|-----------|
| 1 | Segredo em claro / Autorização | E2 | `--remote-allow-origins=*` deixa **qualquer página web** da máquina abrir o WS do CDP e assumir o painel; e é **desnecessária** — Playwright não manda header `Origin` | card v1 linha 99; playwright.dev/docs/webview2 |
| 2 | Autorização | E2 | Webview-filha **herda** `core:default`+`store`+`os`+`notification`: capability que casa por `windows` vale para todas as webviews da janela | `capabilities/default.json:5-9`; docs.rs `tauri_utils::acl::capability::Capability` |
| 3 | Concorrência | E2 | `#[tauri::command]` **síncrono** chamando `add_child` deadlocka: a fonte faz `run_on_main_thread` + `rx.recv()` bloqueante | docs.rs `src/tauri/window/mod.rs`; `src-tauri/src/lib.rs:162` já usa `async fn` |
| 4 | Concorrência / Persistência | E2+E5 | Multi-janela `main-N` e segunda instância colidem: *"additional_browser_args must be given the same value for all webviews that target the same data directory"* | `src-tauri/src/lib.rs:158-166`; tauri#11144 |
| 5 | Regressão / Limite de taxa | E3 | Sync de bounds subespecificado: `zoom` CSS multiplica `devicePixelRatio` e distorce `getBoundingClientRect`; `#root` tem borda 1px + raio 12px que **não clipam HWND**; e arrastar o divisor sobre a webview nativa **perde o pointer capture**, travando o gesto | `App.tsx:1350`, `globals.css:172-173,186-193`; tauri#10131, #10420, #11376 |
| 6 | Verificabilidade | E7 | Critérios 1, 2 e 8 exigem dirigir a UI do Micah, que o critério 6 proíbe o CDP de enxergar — E7 como escrita era impossível | card v1, critérios 1/2/6/8 |
| 7 | Verificabilidade | 3, 4 | `Page.captureScreenshot` devolve conteúdo **mesmo com a webview escondida ou de bounds zerados** — a prova passaria com o recurso quebrado | E4 esconde a webview em overlays |
| 8 | Entrada suja / Regressão | E3 | `on_navigation`/`on_page_load` **não** disparam em `history.pushState` — a barra de endereço dessincroniza em qualquer SPA (Google, GitHub) | docs.rs `WebviewBuilder` 2.11.5 |
| 9 | Regressão | E2 | `additional_browser_args` **descarta** o default do wry `--disable-features=msWebOOUI,msPdfOOUI` → diálogos do Edge abrindo por fora da janela | doc de `additional_browser_args` |
| 10 | Concorrência / Falha externa | E2+E5 | Porta "sorteada" com `bind(0)`+drop é TOCTOU; a fonte de verdade é `DevToolsActivePort` no user data folder | Microsoft Learn, DevTools MCP |
| 11 | Persistência / Falha externa | E5 | `browser-cdp.json` sem `started_at`, sem schema e em `~/.micah/` (convenção inexistente no projeto): sobra de crash aponta para porta morta ou processo alheio | nenhuma referência a `.micah` em `src-tauri/src/` |
| 12 | Regressão | E2/E3 | `removeUnusedCommands: true` compila fora todo `core:webview:*` não declarado — o sintoma é "command not found", não erro de permissão | `tauri.conf.json:11`; tauri#12890 |
| 13 | Regressão | crit. 9 | `pnpm typecheck` **não existe**; o script é `check-types` | `package.json:21` |
| 14 | Rollback | E6 | Critério 10 exige build id que o projeto não emite | `src-tauri/build.rs` |
| 15 | Concorrência | E4 | `hide()` durante overlay com Playwright em voo: o agente clica numa webview invisível e o screenshot sai em branco | E4 v1 |
| 16 | Volume / Falha externa | E2 | `data_directory` é perfil Chromium completo sem teto nem limpeza; WebView2 ausente/antigo, política corporativa bloqueando debug e porta ocupada não estavam tratados | — |
| 17 | Rollback | E0 | O bloco de riscos prometia "desligado por padrão" e **nenhuma etapa implementava a flag** | card v1 |

### Auditoria da implementação E0–E4 + E6 — Opus, 2026-08-14

**Veredito: achados.** 18 achados, 11 das 12 categorias com achado (*Timezone e data* fora de
escopo). Todos corrigidos; nenhum foi contestado. Os que o auditor **derrubou** (suspeitas do
executor que não se confirmaram) estão no fim.

| # | Categoria | Sev. | Achado | Correção aplicada |
|---|-----------|------|--------|-------------------|
| A1 | Concorrência | **bloqueia** | `browser_attach` só retorna após o probe do CDP (até 10 s). Durante isso `attachedRef` é `false` e **todo** `ResizeObserver` é descartado — a webview nascia na posição do primeiro commit (antes do painel ter os 560 px) e **nunca mais era movida** | `lastBoundsRef = null` + `syncBounds(true)` logo após o attach |
| A2 | Concorrência | **bloqueia** | O efeito de visibilidade fazia early-return em `!attachedRef.current` (ref, não estado) e não re-executava ao fim do attach: overlay aberto durante o attach → webview nasce **visível por cima do diálogo** | `attached` virou `useState`, e o efeito depende dele |
| A3 | Falha externa | grave | O código nunca pedia porta 0; `DevToolsActivePort` era lido antes de existir, e o `unwrap_or` tornava o fallback morto. Pior: o arquivo **sobrevive a crash**, então na 2ª execução a porta da sessão anterior vencia a nova | arquivo apagado antes do `add_child`; porta pedida provada primeiro; fallback só depois, com orçamento próprio |
| A4 | Regressão | grave | Qualquer overlay em qualquer canto escondia a webview inteira. Com o app coberto de tooltips, passar o mouse em **qualquer ícone** apagava o browser | `overlaps()`: só suprime overlay que de fato cruza o retângulo do painel |
| A5 | Regressão | grave | A lista "exaustiva" não cobria `TabSwitcherHud`, `AiMiniWindow` nem `SelectionAskAi`; 9 membros do enum **nunca eram despachados por código nenhum** | seletores `data-*` para os três (atributo adicionado ao HUD), 4 membros redundantes removidos, e um teste que reprova qualquer fonte órfã |
| A6 | Regressão | grave | `zoomScaleFor` media `document.documentElement`, que é **ancestral** do `zoom` — a calibração retornava 1 sempre e o branch de correção era código morto | passou a medir `.zoom-content`, o elemento que de fato carrega o zoom |
| A7 | Persistência / Segredo | grave | Nada limpava `BrowserState` nem o arquivo de descoberta no `Destroyed`/`Exit`: painel ficava "tomado" por janela morta, e o arquivo apontava para porta que **outro processo pode reciclar** | `forget_window()` + `clear_discovery()` nos dois eventos em `lib.rs` |
| A8 | Regressão | grave | A mensagem de erro era pintada **dentro** do host — ou seja, por baixo da própria webview nativa. Falha de CDP era invisível | faixa de erro movida para fora do host, com botão *Retry* |
| A9 | Falha externa | grave | Três early-returns silenciosos sem retry: um rect degenerado no primeiro commit matava o painel até reiniciar o app | retry com backoff (8 tentativas) + `retry()` exposto no botão |
| A10 | Concorrência | leve | TOCTOU de 10 s entre o guard e a gravação do estado: 2ª janela furava o guard e falhava com erro cru do Tauri | slot reservado **antes** do trabalho lento, com liberação em caso de erro |
| A11 | Limite de taxa | leve | 8 × `querySelectorAll` (materializa NodeList inteira) por microtask com mutação | `querySelector`, que para no primeiro acerto |
| A12 | Limite de taxa | leve | ~123 mil escritas/dia em `localStorage` com o mesmo valor | escrita condicionada à mudança real, via ref |
| A13 | Autorização | leve | `window_label` vinha do cliente; qualquer webview com IPC podia navegar/destruir o painel alheio | `browser_attach` recebe `tauri::Window` e usa `caller.label()` |
| A14 | Entrada suja | leve | O placeholder prometia "Search or type a URL" e **toda** busca virava erro de host inválido | prosa vira busca no DuckDuckGo, com escape |
| A15 | Entrada suja | leve | `contains("://")` derrubava URL legítima com `://` na query; string vazia virava erro em vez de no-op; `about:config`/`mailto:`/`vbscript:` passavam pela checagem por não terem `://` | `normalize_url` reescrita sobre `Url::parse` + allowlist de scheme, com `is_host_port` para não confundir `localhost:1420` com um scheme |
| A16 | Volume | leve | `minWidth` 420 da janela < soma dos mínimos dos 3 painéis (666); `defaultSize="78%"` do workspace foi escrito para 2 painéis | janela sobe para 860 px de mínimo enquanto o painel existe e volta a 420 no detach; workspace virou o painel elástico |
| A17 | Rollback | grave | `setEnabled` **não tinha nenhum consumidor**: o kill-switch existia no código e não existia para o usuário — o que esvaziava a justificativa do desvio da flag | comando na paleta: *Turn on/off the browser panel* |
| A18 | Rollback | grave | `cargo check` sem `unstable` era impossível (feature fixa); `browser_build_id` registrado e nunca chamado; spike E2.5 pulado | feature de crate `browser-panel` (`default = [...]`) com módulos `panel.rs`/`stub.rs`; build id logado no boot; **`cargo check --no-default-features` passa** |

**Suspeitas do executor que o auditor derrubou com evidência** — registradas porque o custo de
"achado inventado" é o mesmo do achado perdido: (a) `MutexGuard` cruzando `.await` — não acontece
em nenhum dos 5 locks, e se acontecesse o `#[tauri::command]` não compilaria; (b) `hostRef.current`
vazio no primeiro efeito — está preenchido, o problema real era a ausência de retry; (c) StrictMode
derrubando o painel — o app não usa StrictMode (`src/main.tsx`); (d) xterm inundando o
`MutationObserver` — o terminal renderiza em WebGL e não gera mutação de DOM; (e) offset de chrome
nos bounds — a janela é `decorations(false)` e a webview principal preenche a client area.

**Estado após as correções**: `cargo check` limpo, `cargo check --no-default-features` limpo
(prova de rollback), 11 testes Rust, 733 testes vitest, `tsc --noEmit` limpo, biome sem achado nos
arquivos novos.

---

**Resposta do executor à auditoria do plano**: 14 das 15 correções obrigatórias aceitas e incorporadas ao plano v2
acima. A única recusada é o default da flag (`false` → `true` no Windows), com a justificativa
escrita na seção *Desvio deliberado*. Fatos conferidos pelo executor antes de aceitar:
`package.json` não tem `typecheck` (tem `check-types`) ✓, `build.rs` não emite build id ✓,
os três capability files usam `windows` ✓, `tauri 2.11.5`/`wry 0.55.1` ✓.

## Validação independente

> **Parcial — o card NÃO vai para "Feito".** O núcleo do recurso está provado no ar; dois
> itens ficaram em aberto e estão nomeados abaixo com o motivo. Nada foi registrado no
> `memorium.yaml`, conforme a LEI DA PROVA.

### Aprovados, com prova bruta anexa

Executado por `scripts/validate-browser-panel.mjs` contra o app rodando (pid 31432, build
`bc2b8a8-dirty`), **8/8 verificações**:

| # | Critério | Prova |
|---|----------|-------|
| 3 | Site que o `<iframe>` do Preview não renderiza carrega no painel | `title="Google"`, 166 chars de texto, `url=https://www.google.com/` — mais captura de janela do **sistema operacional**, não do CDP |
| 4 | `page.goto` dirige o painel e a tela acompanha | `title="Example Domain"` + PNG de 47 KB capturado por `PrintWindow` com `PW_RENDERFULLCONTENT` |
| 5 | Porta CDP descoberta programaticamente | `browser-cdp.json` → porta 28345 (efêmera, diferente a cada sessão: 22327 na execução seguinte), ws válido, `Edg/151.0.4129.78` |
| 6 | CDP alcança só o painel, nunca a UI do Micah | `/json/list` devolve **um** target, a página do painel; zero targets `tauri.localhost`/`index.html` |
| 7 | Sessão persiste | cookie gravado e relido; perfil em disco em `…\app.orvoton.micah\browser-profile` |
| 10 | Build id legível no ar | `[INFO] micah build bc2b8a8-dirty` no log de boot |
| 11 | Playwright *sempre* conectada | segundo `connectOverCDP` independente conecta sem intervenção |
| 13 | Overlays por cima do painel | `docs/proof/browser-panel/overlay-suppression.png`: com a paleta de comandos aberta, a webview nativa se esconde e a paleta aparece — a supressão faz o que promete |

Provas em `docs/proof/browser-panel/`.

### Reprovados / em aberto

| # | Critério | O que aconteceu |
|---|----------|-----------------|
| 1, 2 | Split arrastável com largura persistida | O divisor existe e o painel fica à esquerda, mas o painel **nasce largo demais**: `react-resizable-panels` não resolve tamanho em pixel no primeiro commit, e o painel sem tamanho resolvível vira o elástico, engolindo o que sobra dos mínimos dos vizinhos. Três correções já entraram (persistência só em arrasto real — havia realimentação gravando a largura errada no boot; tamanho inicial em porcentagem; reaplicação verificada por frame) e **nenhuma fechou o caso**. Falta uma sessão limpa para medir: o ciclo de teste rodou sobre HMR, que remonta o componente e reintroduz o próprio sintoma. |
| 8 | Barra de endereço voltar/avançar/recarregar | Renderiza e a URL acompanha (visível nas capturas), mas os botões não foram exercitados por automação — o critério 6 impede o CDP de tocar na UI do Micah, e a trilha de nível de SO para isso não foi escrita. |

### Por que não foi possível fechar agora

1. **O `micah.exe` de release não pôde ser reconstruído**: o Micah do autor está aberto e o
   linker não escreve por cima do binário em uso. Toda a validação rodou no binário **debug**,
   que carrega a UI do dev server — o que trouxe o HMR para dentro do teste.
2. **O código estava sendo editado em paralelo** (`Header.tsx` mudou durante a execução), então
   qualquer medição de layout misturava duas mudanças.

Para fechar: fechar o Micah, `pnpm tauri build`, e rodar `scripts/validate-browser-panel.mjs`
contra o binário de release, sem dev server no meio.

## Rastro

_(preenchido ao final)_
