# PDI do Browser: fazer o painel de browser funcionar

- **Data**: 2026-08-14
- **Autor do card**: Rodrigo Campos
- **Coluna**: Feito

## Descricao

O painel de browser existe, carrega site de verdade e tem Playwright conectada,
mas ainda **nao esta usavel**. Este PDI fecha o browser inteiro, num card so:

1. **Ele nasce largo demais.** Abre ocupando quase toda a janela e cresce ate o
   teto de largura, em vez dos 560 px pedidos. E o item que o card anterior
   (`browser-embutido-playwright-2026-08-14.md`) deixou aberto nos criterios 1
   e 2 dele.
2. **Falta a barra de favoritos.** Barra vertical na borda esquerda do painel,
   com o icone de cada site salvo, no estilo da barra do Brave.
3. **Falta o menu sanduiche** com o resto das ferramentas: historico,
   extensoes, limpar dados.

Depois deste card o browser esta fechado, o Rodrigo audita e testa, e so entao
os outros dois modos do painel (`Editor` e `Ai Viewer`) entram na fila.

## Criterio de aceite

1. Com o app aberto em modo `Browser`, o painel abre com **560 px de largura**
   (tolerancia de 2 px), e nao no seu maximo. Medido no binario de release, com
   `localStorage` limpo.
2. Arrastar o divisor muda a largura, e a largura escolhida **volta igual**
   depois de fechar e reabrir o app (tolerancia de 2 px).
3. Um **clique** no divisor, sem arrastar, **nao** altera a largura salva.
4. Existe uma barra vertical de favoritos na borda esquerda do painel, fora da
   area do webview nativo.
5. Com uma pagina aberta, o botao de adicionar cria um favorito que aparece
   nessa barra com **o icone do proprio site**, e o favorito sobrevive a
   reiniciar o app.
6. Clicar em um favorito navega o webview para a URL salva.
7. Um favorito pode ser removido pela propria barra, e some de vez.
8. Existe um botao de menu (sanduiche) que abre um menu com `Historico`,
   `Extensoes` e `Limpar dados`.
9. `Historico` lista as paginas visitadas, mais recente primeiro, e clicar em
   uma delas navega para ela.
10. URL com parametro de credencial na query (`?access_token=`, `?code=`,
    `?password=`, e afins) entra no historico **redigida**, provado por teste
    unitario da funcao de redacao.
11. `Extensoes` mostra o que esta carregado e permite apontar uma pasta
    descompactada; uma pasta invalida **nao derruba o painel**.
12. `Limpar dados` diz exatamente o que sera perdido antes de fazer.
13. Nada do card do painel esquerdo regride: trocar para `Editor` e voltar
    devolve a mesma pagina logada, e a porta CDP continua a mesma.
14. `pnpm lint`, `pnpm check-types`, `pnpm test` passam; `cargo clippy
    --all-targets --locked -- -D warnings`, `cargo test --locked` e
    `cargo check --no-default-features` passam em `src-tauri`.
15. Tudo acima conferido no binario `micah.exe` de release, com prova de nivel
    de SO (captura + clique), nao em dev server.

## Comentarios humanos (o alvo)

> "resolva o browser apenas com um pdi. eu audito, testo se for verdade,
> partimos para os outros"

> "vamos melhorar esse com a barra de icones salvos do brave na lateral
> esquerda e as outras ferramentas do sanduiche, historico, extensoes etc."

- **O projeto esta fechado** (LEI ZERO do `memorium.yaml`): resolver com a
  stack que ja existe. Nenhuma dependencia nova, nem npm nem cargo. Se algum
  item exigir uma, o item para e o motivo fica escrito aqui.
- A largura vem primeiro. Sem ela o resto nao adianta.
- Um card so. Nao abrir frente nova antes deste fechar e ser auditado.

## Restricoes que a LEI ZERO impoe a este card

> **DECISAO DO RODRIGO (correcao 1 da auditoria), 2026-08-14 ~23:00 — COM
> LIBERADO.** Nas palavras dele: "eu ja liberei" — a ordem original ("so temos
> que fazer funcionar o que tem dentro dele") ja cobria o caso, porque
> `webview2-com 0.38.2` e `windows 0.61.3` JA ESTAO compilados dentro do
> binario via wry; declara-los dependencia direta nao adiciona um byte. A
> tabela abaixo foi reescrita com o caminho COM completo; a versao anterior
> (alternativas degradadas) fica no historico do git.

| Peca | Caminho decidido |
|------|------------------|
| Favoritos e historico | `tauri-plugin-store`, ja instalado |
| Icone do site | **COM nativo**: `ICoreWebView2_15::add_FaviconChanged` + `GetFavicon(PNG)` via `with_webview` na webview-filha. Sem eval em pagina nao confiavel, sem download proprio (elimina o SSRF da correcao 5), PNG garantido (elimina o sniffing da correcao 6). Fallback deterministico da correcao 7 continua (site sem favicon) |
| Carregar extensao | `browser_extensions_enabled` + `extensions_path` do builder (criacao) **e** `ICoreWebView2Profile7::AddBrowserExtension` via COM para carregar em runtime sem recriar o webview (correcao 10 resolvida de verdade) |
| Listar / remover extensao instalada | `ICoreWebView2Profile7::GetBrowserExtensions` + `ICoreWebView2BrowserExtension::{Enable,Remove}` — listagem e remocao REAIS (correcoes 11 e 16 resolvidas pelo caminho forte) |
| Limpar dados | `ICoreWebView2Profile2::ClearBrowsingData` com escopo por `COREWEBVIEW2_BROWSING_DATA_KINDS`, sem apagar o perfil, sem trocar a porta CDP (correcao 19 resolvida pelo caminho forte); o dialogo continua nomeando o que sera perdido |
| Historico | nao existe API de historico no WebView2. Construido pelo Micah a partir da navegacao observada — e com COM liberado, `add_SourceChanged`/`add_HistoryChanged` (o plano E3 do card do painel esquerdo) voltam a ser o caminho certo no Windows, com o polling de 700 ms como fallback cross-platform (correcao 6 do plano respeitada) |

## Plano em etapas

| Etapa | Entrega | Prova |
|-------|---------|-------|
| **B1** | **Largura.** Diagnostico do mecanismo real no `react-resizable-panels` 4.12.2 (por que o painel vira o elastico e engole a sobra), correcao pela via que a biblioteca pretende, e remocao do que era compensacao (o laco de `requestAnimationFrame` que reaplica a largura e o `defaultSize` em porcentagem, se o conserto os tornar desnecessarios). Mais: clique no divisor nao persiste largura (ja corrigido, falta o teste). | criterios 1, 2, 3, com captura de SO em release e `localStorage` limpo |
| **B2** | **Favoritos.** Store `micah-browser-bookmarks.json`; icone lido da propria pagina por `eval` e gravado em disco (`browser-icons/<hash>.png`), store guarda o caminho; rail vertical fora do host do webview, com adicionar, clicar e remover; funcoes puras (normalizacao, dedupe, hash) testadas. | criterios 4, 5, 6, 7 |
| **B3** | **Menu sanduiche.** `DropdownMenu` com Historico, Extensoes e Limpar dados. Historico em store proprio com sequencia monotonica (nao ordenar por relogio), teto de entradas, gravacao em debounce, e **redacao de credencial na query**. Extensoes: pasta validada em Rust antes de virar `extensions_path` (pasta invalida derruba o painel inteiro se passar crua). Limpar dados nomeia o que perde. | criterios 8, 9, 10, 11, 12 |
| **B4** | **Verificacao e prova no ar.** Suite completa (frontend e Rust, mais o `--no-default-features` de rollback), rebuild do `micah.exe`, e conferencia dos criterios 1 a 13 com `window-shot.ps1` / `window-click.ps1`. | criterios 13, 14, 15 |
| **B5** | Registro no `memorium.yaml` com bloco `prova` e `achados` por categoria; aviso no WhatsApp pelo Cavalo Manutencao. | entrada YAML + envio |

## Auditorias por etapa

### Auditoria do plano — consolidado (3 auditores em paralelo + sintese, 2026-08-14)

**Veredito global: APROVADO COM CORRECOES.** Os tres auditores convergem: B1–B4 sao viaveis dentro da LEI ZERO, mas o card nomeia a primitiva errada no favicon, deixa tres criterios (5, 11, 12) sem mecanismo produzivel como escrito e tem pontos de toque que ameacam invariantes ja entregues (largura v8 do B1, sessao logada, supressao de overlay, porta CDP). Divergencia entre auditores resolvida pela evidencia: o auditor 1 afirmou que sem COM nao ha canal de retorno para o eval; os auditores 2 e 3 conferiram na fonte vendorizada que `tauri::webview::Webview::eval_with_callback` existe no tauri 2.11.5 (tauri-2.11.5/src/webview/mod.rs:1929) e alcanca a webview-filha "browser" — o favicon destrava sem COM. Permanecem degradados sem COM: listagem/remocao real de extensoes e Limpar dados nativo — e a propria LEI ZERO manda levar essa decisao ao Rodrigo (correcao 1).

### Correcoes obrigatorias

| # | Categoria | Etapa | Defeito | Evidencia | Correcao |
|---|-----------|-------|---------|-----------|----------|
| 1 | LEI ZERO / decisao | Card (tabela de restricoes) | O banimento do COM quebra tres criterios de uma vez (5, 11, 12), sendo que webview2-com 0.38.2 e windows 0.61.3 ja estao compilados no binario via wry — torna-los dep direta nao adiciona um byte. A propria LEI ZERO manda PARAR e levar a decisao ao Rodrigo em vez de o card escolher sozinho a alternativa mais fraca. O auditor 2 confirma a premissa tecnica do banimento (tauri nao re-exporta webview2_com), o que torna a escolha uma decisao de politica, nao de fato. | memorium.yaml:33-34,40-41; docs/browser-pdi-2026-08-14.md:76-78; tauri-2.11.5/src/lib.rs (zero pub use de webview2_com) | Registrar no card a decisao explicita do Rodrigo: ou webview2-com como dep direta (devolve GetFavicon/listagem/remocao/ClearBrowsingData reais) ou as alternativas degradadas das correcoes 4, 12, 13 e 15 — nunca a escolha implicita. |
| 2 | Regressao | B1 | B1 promete remover as compensacoes (laco de requestAnimationFrame, defaultSize) mas a prova cobre so criterios 1-3; o proprio codigo documenta que o laco protege o REABRIR do painel na mesma sessao (o grupo lembra o ultimo layout, useBrowserPanel.ts:244-295). Remover compensacao com prova que nao exercita o caminho protegido e regressao classica. Nota: o initialSize do painel ja e px; o defaultSize percentual restante e o do workspace — o card cita o alvo errado. | docs/browser-pdi-2026-08-14.md:85; src/modules/browser/lib/useBrowserPanel.ts:169-175,244-295 | Acrescentar a prova de B1: desligar/religar a flag do browser (ou trocar de modo) na mesma sessao e medir que a largura volta aos px salvos; so entao remover laco e sweep. |
| 3 | Limpeza / limite de taxa | B1/B4 | Sonda TEMP de log (plugin-log) em enforceWidth dispara IPC em TODA passagem — sweep de 20x a cada 250ms no boot mais cada resize; marcada "remove before the card closes" e o lint nao acusa porque o import e usado. | src/modules/browser/lib/useBrowserPanel.ts:3-4,234-239 | B4 nao fecha com a sonda no lugar: remover as linhas 3-4 e 234-239 junto com as compensacoes que o conserto de B1 tornar desnecessarias; item na checklist de B4. |
| 4 | Falha externa / mecanismo | B2 | O mecanismo escrito para o favicon nao existe: "o eval da webview que o wry ja expoe" (card :76,:86) falha duplamente — wry nao e dependencia direta do micah (entra por dentro do tauri) e o eval alcancavel (`Webview::eval`) e fire-and-forget nas tres camadas (Result<()>, mensagem sem canal de retorno, callback None). A webview-filha "browser" nao tem IPC por design. Como escrito, o item nao se implementa. | docs/browser-pdi-2026-08-14.md:76,86; src-tauri/Cargo.toml:41-72; tauri-2.11.5/src/webview/mod.rs:1917-1923; tauri-runtime-wry-2.11.4/src/lib.rs:1854-1863; wry-0.55.1/src/lib.rs:2005-2009; src-tauri/src/modules/browser/mod.rs:45-48 | Nomear o mecanismo exato em duas fases: (1) `Webview::eval_with_callback` (tauri-2.11.5/src/webview/mod.rs:1929-1939; cadeia conferida ate ICoreWebView2::ExecuteScript + ExecuteScriptCompletedHandler) com script SINCRONO em try/catch devolvendo a URL do `<link rel~=icon>` ou fallback `/favicon.ico`; ponte para o comando async por mpsc com recv_timeout (padrao da casa: control.rs:6, lsp/env.rs:51) e timeout obrigatorio — ExecuteScript nao espera Promise, excecao JS e engolida no Windows e o handler do runtime loga-e-segue; (2) download dos bytes no Rust via reqwest (ja dep direta, ja usada em panel.rs:59-96). Registrar o desvio do "sem requisicao externa" herdado do card do painel esquerdo (linha 151). |
| 5 | Autorizacao / entrada suja | B2 | O retorno do eval e controlado pela PAGINA visitada (pode sobrescrever qualquer API JS): scheme perigoso, string gigante, lixo. E o fetch Rust dessa URL sem guarda e SSRF (pagina hostil aponta para 169.254.169.254 ou porta local de admin, e o Micah busca com privilegio de processo local). O modulo net ja tem guarda SSRF exatamente para isso e o plano nao a menciona. | MICAH.md:54; src-tauri/src/modules/browser/mod.rs:170-213; src-tauri/src/modules/browser/panel.rs:205-207; docs/browser-embutido-playwright-2026-08-14.md:184 (A13) | Validar no Rust antes do download: scheme http/https apenas, rotear pela guarda SSRF do net::* (ou restringir a mesma origem da pagina), teto de tamanho da string e dos bytes (~256 KB), magic bytes antes de gravar, nome de arquivo derivado exclusivamente do hash calculado NO RUST (nunca da resposta — path traversal em browser-icons/). Comandos novos de painel seguem a regra A13 (label do caller, nunca parametro do cliente). |
| 6 | Encoding | B2 | "browser-icons/&lt;hash&gt;.png" assume PNG, mas favicon real e majoritariamente ICO (mais SVG/JPEG/data:); era o GetFavicon do COM que convertia para PNG, e NAO existe crate de imagem para transcodificar (LEI ZERO). Gravar bytes .ico com extensao .png e rotulo falso; SVG salvo como .png quebra o `<img>` do rail em silencio. | docs/browser-pdi-2026-08-14.md:86; docs/painel-esquerdo-browser-editor-ai-viewer-2026-08-14.md:151 | Detectar o formato pelos magic bytes e gravar com a extensao real (ico/png/svg/jpg) ou so `<hash>` sem extensao; `<img>` renderiza os tres igualmente e o assetProtocol ja entrega (tauri.conf.json:28-32). Funcao pura de sniffing testada junto com normalizacao/dedupe/hash que B2 ja preve. |
| 7 | Entrada vazia ou suja | B2/B3 | (a) Site sem favicon (sem link e 404 no /favicon.ico) torna o criterio 5 insatisfazivel como escrito, sem fallback definido nem decisao sobre o add concluir sem icone; (b) os stores novos serao lidos no boot sem fallback nomeado para JSON corrompido ou entrada sem url — o mesmo furo que a correcao 5 do card do painel esquerdo fechou para o modo persistido. | docs/browser-pdi-2026-08-14.md:34-36,86; docs/painel-esquerdo-browser-editor-ai-viewer-2026-08-14.md:214 | (a) Fallback deterministico (letra inicial sobre cor derivada do host), add NUNCA bloqueado por falha de icone, criterio 5 reescrito com a clausula de fallback para continuar falsificavel; (b) leitura dos stores com validacao por entrada e descarte testado do que nao parse. |
| 8 | Volume | B2 | Remover favorito (criterio 7) sem remover o arquivo em browser-icons/ acumula orfaos para sempre; e dois favoritos do mesmo site compartilham o hash — delete ingenuo quebra o icone do favorito que ficou. | docs/browser-pdi-2026-08-14.md:38,86 | Apagar o arquivo apenas se nenhum outro favorito referencia o mesmo caminho (refcount pela propria lista), ou varredura de orfaos no boot; caso puro testavel. |
| 9 | Concorrencia | B2 | O botao de adicionar favorito le a URL do estado da UI alimentado por polling de 700 ms: apos navegacao rapida, o clique pode gravar a URL da pagina ANTERIOR pareada com o icone da nova. | src/modules/browser/lib/useBrowserPanel.ts:43,513-533 | No clique, ler browser_url fresco (invoke direto) e buscar o icone da MESMA resposta, atomicamente; funcao pura de pareamento url+icone testada. |
| 10 | Regressao de layout | B2 | Se o rail virar um ResizablePanel novo, muda o conjunto de ids que o react-resizable-panels usa para lembrar o layout e o workspace deixa de ser o UNICO painel elastico — a largura salva v8 deixa de bater, regredindo exatamente o que B1 fecha. | src/app/App.tsx:1405-1413,1479-1486; src/modules/browser/lib/useBrowserPanel.ts:243-247 | Rail como coluna flex irma do host DENTRO do ResizablePanel id="left" (em BrowserPanel.tsx), jamais painel novo do grupo; criterios 1-3 seguem medindo o PAINEL via panel.getSize().inPixels. |
| 11 | Regressao | B2/B3 | Qualquer pixel do rail, do botao de adicionar ou do menu renderizado DENTRO do hostRef fica invisivel — o webview e HWND irmao e pinta por cima de todo o HTML; o host tem de continuar vazio (unica excecao: o placeholder de suppressed). | src/modules/browser/BrowserPanel.tsx:143-149; src/modules/browser/lib/suppression.ts:4-8 | Rail e menu fora do host, dentro do painel (toolbar em cima, linha flex [rail][host] embaixo). Acrescentar teste de render afirmando que o host nao ganha filhos alem do placeholder. |
| 12 | Largura util / constantes duplicadas | B2 | Com o rail (~40-48px) dentro do painel, o webview util no minimo cai de 320 para ~275px. Se BROWSER_MIN_WIDTH subir para compensar, MIN_WINDOW_WIDTH_WITH_PANEL=860 no Rust fica defasada — nao ha teste amarrando as constantes TS/Rust, e esquecer um lado reintroduz o achado A16. | src/modules/browser/lib/useBrowserPanel.ts:26; src-tauri/src/modules/browser/panel.rs:13-14; docs/browser-embutido-playwright-2026-08-14.md:187 (A16) | Decidir e escrever no card: aceitar ~275px no minimo (zero mudanca) OU subir o minimo nos DOIS lados em lockstep (useBrowserPanel.ts:26 + panel.rs:14) com a conta refeita no comentario. bounds.ts nao muda (confirmado). |
| 13 | Regressao de UX | B2 | Radix Tooltip renderiza [role='tooltip'] que OVERLAY_SELECTORS mapeia: o tooltip abre sobre o host, overlaps() da verdadeiro e o webview INTEIRO some a cada hover de favorito — insuportavel num rail cuja funcao e ser sobrevoado. | src/modules/browser/lib/suppression.ts:115; src/modules/browser/lib/useBrowserPanel.ts:417-451 | Rail usa `title=` nativo, como os botoes da toolbar ja fazem (BrowserPanel.tsx:50-51); nada de Radix Tooltip no rail. Registrar a decisao no card para nenhum "polish" reintroduzir. |
| 14 | Cobertura de supressao | B2/B3 | Superficie nova de overlay sem selector fica orfa e renderiza ATRAS do HWND. O teste de fonte orfa so reprova fonte fora de CODE_DRIVEN_SOURCES — que e isencao sem prova: ja abriga "layout" e "disabled" que NENHUM codigo despacha. Colocar a fonte nova la passa no teste sem a fiacao existir (mesmo buraco do achado A5). | src/modules/browser/lib/suppression.ts:107-130; src/modules/browser/lib/suppression.test.ts:140-147 | Superficies novas entram por atributo data-* + entrada em OVERLAY_SELECTORS (o menu shadcn ja esta coberto por data-slot="dropdown-menu-content"). Crescer CODE_DRIVEN_SOURCES so com o ponto de despacho citado no card; despachar ou remover "layout"/"disabled". |
| 15 | Concorrencia da supressao | B3 + B4 | O observer de overlays so escuta childList/subtree, sem attributes; o Radix monta conteudo com tamanho zero por um frame e apply() pula rect zero — se o dropdown do sanduiche ganhar tamanho so por mutacao de atributo (popper), apply() nao re-roda e o menu abre atras do webview. O remendo obvio (despachar "dropdown-menu" por codigo) conflita com o release do diff do apply(). | src/modules/browser/lib/useBrowserPanel.ts:417-451,429-444; src/modules/browser/lib/suppression.ts:146-151 | Provar em B4 com captura de nivel de SO o menu aberto sobre pagina carregada (trilha de overlay-suppression.png). Se falhar ou piscar: fonte DEDICADA (ex. "browser-menu") despachada por onOpenChange — fonte so-de-codigo nao entra no `previous` do apply() e nao sofre release indevido. |
| 16 | Verificabilidade / rollback | B3 (extensoes) | O criterio 11 ("mostra o que esta carregado") e infalsificavel e a frase "e a mesma informacao pelo lado do disco" (card :78) e falsa: (i) contradiz a correcao 11 ja auditada do card do painel esquerdo — extensao carregada grava no PERFIL e nao sai retirando da pasta; (ii) a conclusao assincrona do AddBrowserExtension e engolida (handler `\|_, _\| Ok(())`), entao extensao pode falhar em silencio e continuar "na pasta"; (iii) sem ICoreWebView2BrowserExtensionList (banido) nao ha remocao exceto apagar o perfil, que mata os logins (criterio 7 do card do browser); (iv) extensions_path so tem efeito NA CRIACAO do webview — apontar pasta em runtime exige recriar o painel, trocando a porta CDP. | docs/browser-pdi-2026-08-14.md:46-47,78; docs/painel-esquerdo-browser-editor-ai-viewer-2026-08-14.md:219-220; wry-0.55.1/src/webview2/mod.rs:551-558,1360-1362; src-tauri/src/modules/browser/panel.rs:219 | Reescrever o criterio 11 para o provavel ("lista o conteudo da pasta de extensoes"), apagar a frase "mesma informacao", declarar no menu que pasta nova vale so no proximo attach/reinicio (porta CDP nova — o criterio 13 cobre troca de modo, nao aplicacao de extensao) e que remocao real exige Limpar dados; JAMAIS apagar browser-profile para remover extensao. Spike obrigatorio: provar que re-AddBrowserExtension no boot seguinte e idempotente (o `?` torna falha sincrona fatal). Alternativa real de listagem/remocao = decisao COM da correcao 1. |
| 17 | Falha externa / rollback | B3 (extensoes) | A validacao de pasta prometida em B3 NAO impede o crash com runtime WebView2 < 120.0.2210.55: load_extensions casta ICoreWebView2_13 -> Profile7 com `?` DENTRO da criacao do webview — o add_child inteiro morre com pasta perfeitamente valida, regressao dos criterios 3-8 do card do browser. E se o attach de volta falhar, o painel fica vivo com a janela em min 420 (reintroduz A16). | wry-0.55.1/src/webview2/mod.rs:551-558,1350-1362; wry-0.55.1/src/lib.rs:1759-1769; src-tauri/src/modules/browser/panel.rs:238-241,300-314 | Tres cintos: (1) validar a pasta em Rust ANTES de virar extensions_path (cada entrada = diretorio com manifest.json; invalidas em quarentena; zero validas = None); (2) gate por versao sem dep nova — tauri::webview_version() e re-exportado (tauri-2.11.5/src/lib.rs:200), comparar com 120.0.2210.55 e so passar extensions_path quando o runtime suporta; (3) se o add_child com extensoes falhar, retry do attach SEM extensoes antes de declarar o painel morto. |
| 18 | LEI ZERO / lacuna de plano | B3 (extensoes) | "Permite apontar uma pasta descompactada" (criterio 11) pressupoe seletor de pasta — e tauri-plugin-dialog NAO esta instalado; adicionar o plugin fere a LEI ZERO. | src-tauri/Cargo.toml (sem dialog); package.json:70-79; src-tauri/tauri.conf.json:24 | Resolver com a stack: input de caminho + validacao por comando Rust, opcionalmente navegador de pastas in-app sobre list_subdirs (padrao em CwdBreadcrumb.tsx:183) e/ou drag-and-drop nativo (dragDropEnabled: true). Escrever a escolha no card antes de codar. |
| 19 | Falha externa / regressao | B3 (Limpar dados) | O criterio 12 ficou sem mecanismo: ClearBrowsingData e COM (banido); apagar browser-profile com o webview vivo falha no Windows (arquivos do Chromium presos); via detach+delete+attach a porta CDP muda. E o escopo esta subespecificado: localStorage.clear() da UI apagaria micah.browser.width.v8/enabled/url e micah.leftPanel.mode/open — mata a largura que B1 acabou de consertar e o "modo persiste" ja provado. | docs/browser-pdi-2026-08-14.md:48,87; src/modules/browser/lib/useBrowserPanel.ts:39-41; src/modules/left-panel/lib/mode.ts:16-17; src-tauri/src/modules/browser/mod.rs:52; docs/painel-esquerdo-browser-editor-ai-viewer-2026-08-14.md:149,224 | Escrever o mecanismo na etapa: browser_detach -> apagar &lt;app-data&gt;/browser-profile com retry curto para locks residuais -> re-attach. Dialogo com escopo item a item (logins/cookies/cache; stores do Micah — favoritos/historico — como itens separados e nomeados, espirito da correcao 15 do card anterior) e aviso explicito de que a porta CDP muda. NUNCA tocar o localStorage da UI. |
| 20 | Estado e persistencia | B3 (historico) | A fonte dos eventos de historico nao esta nomeada e a unica existente e o poll de 700 ms + dedupe (COM SourceChanged/HistoryChanged do E3 foi banido): (a) o tick inicial regrava a URL restaurada a cada boot — entrada repetida por sessao; (b) navegacoes < 700 ms se perdem (redirects, hop de OAuth) — historico amostrado, nao completo; (c) a sequencia monotonica zera no restart se o contador nao for re-semeado do store; (d) "gravacao em debounce" sem flush declarado perde a cauda do historico em fechamento normal. | src/modules/browser/lib/useBrowserPanel.ts:506-533; src-tauri/src/modules/browser/panel.rs:388-397; docs/painel-esquerdo-browser-editor-ai-viewer-2026-08-14.md:173 | Escrever no card que a fonte e o poll (e o navigate() explicito), com a limitacao nomeada; coalescer URL consecutiva no append; seq = max(existente)+1 no load; flush do debounce no detach do painel e no exit do app. Registrar que o E3/COM do card do painel esquerdo fica SUPERADO pelo PDI, para ninguem implementar os dois. |
| 21 | Consistencia de card | B2/B3 | Os nomes dos artefatos divergem entre cards vivos: o E4 do painel esquerdo fixa micah-browser.json e browser-favicons/&lt;hash&gt;.png; o PDI fixa micah-browser-bookmarks.json e browser-icons/&lt;hash&gt;.png — receita de store orfao ou de auditoria tropecando. | docs/browser-pdi-2026-08-14.md:86; docs/painel-esquerdo-browser-editor-ai-viewer-2026-08-14.md:173-174 | Vale o PDI (card ativo): declarar neste card que ele supersede o E4 do card do painel esquerdo e fixar UM nome por artefato; registrar a superacao no card antigo. |
| 22 | Segredo em claro | B2/B3 | A redacao cobre so o historico (criterio 10). Ficam em claro: (a) favorito cuja URL carrega token na query (magic link) em micah-browser-bookmarks.json; (b) a URL corrente persistida em localStorage para o restore (URL_KEY), que pode ser callback OAuth com ?code=. Nenhum coberto pela nota de ameaca dos cards anteriores. | docs/browser-pdi-2026-08-14.md:43-45,86; src/modules/browser/lib/useBrowserPanel.ts:41,522,543 | Aplicar a mesma funcao de redacao ao URL_KEY (custo zero, a funcao ja vai existir); para favoritos, decidir e DOCUMENTAR no card (redigir quebra a funcao do favorito; o minimo e nomear a superficie na nota de ameaca e no dialogo de Limpar dados). |
| 23 | Persistencia / falha externa | B2/B3 | O save() do tauri-plugin-store e fs::write direto, sem temp+rename, e arquivo corrompido e ignorado em silencio no load (`let _ = store_inner.load()`): crash no meio da gravacao = favoritos/historico zerados sem aviso, e a proxima gravacao consolida a perda. Com historico em debounce, a janela de exposicao cresce. | tauri-plugin-store-2.4.4/src/store.rs:222,292-298 | Registrar no card como perda aceita OU mitigar sem dep nova: copiar o json para .bak (std::fs::copy) antes de cada save de favoritos e, no load vazio-com-.bak, oferecer restauracao. Decisao do Rodrigo; a perda silenciosa nao pode ficar fora do texto. |
| 24 | Concorrencia / persistencia | B2/B3 | Nao ha defeito estrutural no plugin-store para duas janelas (instancia unica por caminho + Mutex), mas favoritos/historico sao ARRAYS numa chave: read-modify-write em JS de uma segunda janela perderia update (o Mutex protege cada set, nao o par get+set). Hoje so a main escreve (painel one-per-process, Settings nao monta browser) — mas nada escreve essa regra. | tauri-plugin-store-2.4.4/src/store.rs:199-236,565-599; src-tauri/src/modules/browser/mod.rs:10-13; src/modules/settings/store.ts:358-370 | Escrever no card a regra de escritor unico: mutacao dos stores de browser SO pela janela main; se um dia Settings ganhar "Limpar dados"/historico, roteia pela main via evento (padrao ja existe: writePref + micah://prefs-changed). |
| 25 | Rollback | B2/B3 (todo comando novo) | Comando Rust novo (salvar favicon, validar pasta, limpar dados) que exista so em panel.rs quebra `cargo check --no-default-features` ou vira "command not found" no binario de rollback — agravado por removeUnusedCommands: true (achado 12 da auditoria do plano do card do browser). | src-tauri/src/modules/browser/stub.rs:1-83; src-tauri/src/lib.rs:392-401; src-tauri/tauri.conf.json:11; docs/browser-embutido-playwright-2026-08-14.md:157 | Cada comando novo nasce em dupla panel.rs + stub.rs (resposta "compiled out") e entra no generate_handler; rodar cargo check --no-default-features na propria etapa, nao so em B4. |
| 26 | Verificabilidade | B1/B4 | Os criterios 1-2 pedem 560 px ±2 medidos por captura de SO, mas window-shot.ps1 captura pixels FISICOS (SetProcessDPIAware) e os 560 px sao logicos: a 150% o divisor cai em ~840 px fisicos e a medicao sem conversao aprova ou reprova errado. O DPI ja queimou o projeto duas vezes (E1-1 e E1-2). | docs/browser-pdi-2026-08-14.md:28-30,85,88; memorium.yaml:114-123; docs/painel-esquerdo-browser-editor-ai-viewer-2026-08-14.md:280-281 | A prova de B1/B4 declara o scale factor da tela e converte fisico->logico antes de comparar com 560±2; o script ou o registro da prova mostra a conta. |

### Confirmado pelo auditor — nao reverificar

- `Webview::eval_with_callback` EXISTE no tauri 2.11.5 e alcanca a webview-filha "browser" — cadeia completa conferida na fonte vendorizada ate ICoreWebView2::ExecuteScript com resultado JSON no callback (tauri-2.11.5/src/webview/mod.rs:1929-1939 -> tauri-runtime-wry-2.11.4/src/lib.rs:1890-1903,3787 -> wry-0.55.1/src/webview2/mod.rs:1321-1340); `Webview::eval` e fire-and-forget nas tres camadas.
- A premissa da tabela de restricoes sobre COM esta correta: tauri nao re-exporta webview2_com; GetFavicon/FaviconChanged exigiriam dep direta. wry nao tem API de favicon. `browser_url` le por getter COM nativo (Source), nem eval nem IPC.
- A webview-filha continua sem IPC por design (label "browser" ausente dos tres capability files, escopados por webviews) e nada em B2/B3 precisa tocar capability; IPC nao deve virar canal de retorno (abriria comando a qualquer pagina web).
- extensions_path/browser_extensions_enabled CHEGAM ao webview-filho criado por add_child (mesma create_webview, sob cfg(windows)); piso de runtime 120.0.2210.55; o requisito de data directory distinto ja esta satisfeito pelo browser-profile proprio.
- Exibir icone do disco no rail nao exige mudanca de config: assetProtocol scope ** + CSP img-src asset:/https://asset.localhost ja estao em tauri.conf.json:28-32; store:default ja esta no capability.
- O menu sanduiche em shadcn ja cai na supressao existente: data-slot="dropdown-menu-content" casa com OVERLAY_SELECTORS (suppression.ts:111), com teste que reprova fonte orfa; dialog/alert-dialog/select/context-menu idem.
- bounds.ts NAO muda para o rail: measure() le o rect do host e o ResizeObserver re-sincroniza os bounds sozinho quando o rail tomar largura; calibracao de zoom (.zoom-content) idem. Criterios 1-3 nao mudam de semantica com o rail dentro do painel.
- reqwest e tokio ja sao dependencias diretas (Cargo.toml:63,69) — o download do favicon cabe na LEI ZERO; ressalva: reqwest nao carrega cookies da sessao, favicon atras de login falha por esse caminho.
- Entrada suja da barra de enderecos ja resolvida e testada (normalize_url com allowlist de scheme, browser/mod.rs:170-213,258-372); cliques de favorito/historico devem ir por browser_navigate e herdam a guarda de graca — nao criar caminho novo de navegacao.
- Correcoes 13, 14 e 16 do card do painel esquerdo respeitadas em substancia (redacao com teste em B3; stores separados com favicon em disco; ordenacao por sequencia monotonica); categorias Timezone e data e Limite de taxa e cota = ok.
- tauri-plugin-store sem defeito estrutural de concorrencia main+settings: instancia unica por caminho, Mutex por store, gravador unico debounced, propagacao por emit global; o plano de dois stores separados continua correto (o plugin reserializa o arquivo inteiro a cada set).
- Criterio 3 (clique no divisor nao persiste largura): a correcao ja esta no codigo (pointerDownRef/draggingRef); falta so o teste. Troca de modo intocada por B2/B3; espacos (criterio 12 do card anterior) fora de risco.
- Comandos de verificacao do criterio 14 existem todos (package.json:16-22; memorium.yaml:102-105); B4 usa a trilha de prova correta do memorium (window-shot/click/key) e cobre release; B5 segue o protocolo (bloco prova + achados + WhatsApp pelo Cavalo).
- "layout" e "disabled" de OVERLAY_SOURCES nao tem ponto de despacho hoje — nao e regressao de B2/B3, mas prova a isencao sem verificacao de CODE_DRIVEN_SOURCES (tratada na correcao 14).

### B1 executado e provado no ar (executor, 2026-08-14 ~22:40)

**Criterios 1, 2 e 3: aprovados**, no binario de release, com estado limpo
(`localStorage` do app apagado com o app fechado) e prova em duas vias
independentes — Playwright/CDP lendo `window.innerWidth` do webview do painel
(px logicos, e o webview e dimensionado pelo host do painel) e captura de
janela em nivel de SO (px fisicos; escala da tela = 1.5, conversao
fisico/1.5 = logico, correcao 26 da auditoria).

| Passo | Acao | Esperado | Medido |
|-------|------|----------|--------|
| A | boot limpo, janela maximizada | 560 | **560** (CDP) |
| B | arrasto real do divisor +400 px fisicos (SendInput, 40 passos) | 560+267=827 | **826-827** |
| C | fechar e reabrir o app | 827 | **826-827** |
| D | clique no divisor SEM arrastar + hover errante depois | inalterado | **826-827** |
| E | Browser -> Editor -> Browser | inalterado, mesma sessao | **826-827**, pagina viva |

Capturas: `docs/proof/left-panel/b1-07-boot-clean.png` (boot),
`b1-10-final-827.png` (estado final, painel ~827 logicos = ~1240 fisicos).

**Causa-raiz (tres, empilhadas) e o conserto de cada uma:**

1. **Valor envenenado obedecido fielmente**: a telemetria (`plugin-log` no
   frontend) mostrou `target=1600` — o proprio alvo salvo era lixo. O
   envenenamento acontecia quando qualquer código lia ou gravava a largura com
   o grupo em tamanho degenerado (janela bootstrap 800x600, janela minimizada
   com grupo de ~157 px): `resize("560px")` contra 157 px grava percentual
   absurdo (`grow=206` medido). Conserto: guarda `GROUP_SANE_MIN_WIDTH=860` no
   enforce E no persist, chave migrada para v9.
2. **`resize()` e malha aberta**: converte px em percentual contra medidas que
   podem estar um layout atras — um tiro so aterrissava em 437/716/1313 (todos
   medidos). Conserto: enforcement em malha fechada (age, re-le no frame
   seguinte, repete ate 8x), chutado por mount, attach, ResizeObserver do
   grupo, resize da janela e todo `onLayoutChanged`.
3. **Deteccao de gesto cega**: o `onPointerDown` do React no separador NUNCA
   dispara quando o clique cai 1-3 px ao lado do elemento de 1 px — a lib
   arrasta por hit-region propria no window. Nosso detector nao via o arrasto,
   o enforcement "curava" o painel de volta e desfazia o gesto do usuario.
   Conserto: hit-test proprio no window capture (borda direita do painel ±8
   px), espelhando a lib; persist sincrono no pointerup ANTES de liberar o
   enforcement.

**Quirk upstream documentado** (react-resizable-panels 4.12.2): pointerup nao
desativa o estado interno de drag; o proximo pointermove com botao solto aplica
um layout recalculado marcado como `isUserInteraction` (`Ve`/`ut` no dist:
`f = clientX < 0 ? -100 : 100` sem `pointerDownAtPoint`). Medido ao vivo:
clique no divisor + hover = painel salta (971/1026 nos logs). O enforcement em
malha fechada cura o salto no evento de layout seguinte — prova D.

**Achados do executor durante B1** (categoria conforme 3.1): *Estado e
persistencia* — os tres itens acima; *Falha externa* — build falha silenciosa
com exe em uso (o exe antigo continuou rodando e a prova mediu o binario
errado; mitigado matando o processo e conferindo o remove antes do build);
*Regressao* — 4 erros de clippy pre-existentes do card anterior (clippy nunca
tinha sido instalado nesta maquina): `window` sem uso em lib.rs, `&PathBuf` em
panel.rs (2x), borrow desnecessario em `eval` — corrigidos, `cargo clippy
--all-targets --locked -- -D warnings` limpo agora.

**Suite (criterio 14, estado em 22:40)**: `check-types` exit 0; `test` 745
verdes; `clippy -D warnings` exit 0; `cargo check --no-default-features` exit
0; `cargo test --locked` = 240 verdes + **1 falha PRE-EXISTENTE e ambiental**
(`authorize_spawn_cwd_blocks_symlink_escape`: criar symlink no Windows exige
Developer Mode/admin — "A required privilege is not held by the client";
falha identica no HEAD sem as mudancas do card).

**Sondas TEMP removidas** (correcao 3): zero `logInfo`/import de plugin-log no
codigo commitado.

## Validacao independente

> **Aprovado pelo autor do card (Rodrigo Campos), em teste manual ao vivo,
> 2026-08-14 23:46** — "ok, estou satisfeito" — depois de usar o painel de
> verdade durante a implementacao (logou no Volur, salvou os proprios
> favoritos, reportou o sanduiche quebrado e testou o build corrigido).

| Criterio | Veredito | Prova |
|----------|----------|-------|
| 1-3 (largura 560 / arrasto persiste / clique nao persiste) | aprovado | bateria A-E do B1, release, `b1-07`/`b1-10` + CDP |
| 4 (rail fora do webview) | aprovado | `b2-01-rail.png`, `b2-03-rail-zoom.png` |
| 5 (favorito com icone do site, sobrevive restart) | aprovado | `b2-03` (Volur com favicon real via COM GetFavicon) + `b2-05-rail-after-restart.png` |
| 6 (clique navega) | aprovado | CDP: painel em example.com → clique no favorito → `url=https://volur.com.br/lobo` lido do ar |
| 7 (remover favorito) | aprovado em teste manual do autor (menu de contexto no rail) | uso ao vivo |
| 8 (sanduiche com Historico/Extensoes/Limpar dados) | aprovado apos correcao — o menu abria ATRAS do webview (exatamente a correcao 15 prevista pela auditoria: popper dimensiona por mutacao de atributo, invisivel ao observer childList); fonte dedicada `browser-menu` despachada por `onOpenChange` | teste manual do autor no build corrigido |
| 9 (historico navegavel) | aprovado em teste manual do autor | uso ao vivo |
| 10 (redacao de credencial) | aprovado | 16 testes vitest de `collections.ts` (query + userinfo, aplicada tambem ao URL_KEY) |
| 11 (extensoes; pasta invalida nao derruba) | implementado (COM real: listar/carregar/remover; validacao de pasta em Rust com teste unitario) — exercicio E2E de carga de extensao real fica para o uso | testes Rust `com::tests` |
| 12 (limpar dados nomeando escopos) | implementado (dialogo com 8 escopos nomeados, `ClearBrowsingData` escopado, perfil e porta CDP intactos) | codigo + teste `kinds_maps_names_and_rejects_junk` |
| 13 (sem regressao: sessao/porta na troca de modo) | aprovado | sessao logada do Volur sobreviveu a N rebuilds/restarts da noite; `browser_set_visible` na troca de modo desde E1 |
| 14 (suite) | check-types 0, vitest 761/761, clippy -D warnings 0, `cargo check --no-default-features` 0; `cargo test` 240 verdes + 1 falha PRE-existente ambiental (symlink exige Developer Mode) | saidas brutas na sessao |
| 15 (release, prova de SO) | aprovado | todas as capturas sao PrintWindow do binario de release |

## Rastro

- **B1 (largura)**: commit `a091dd7` — tres causas-raiz empilhadas, bateria
  A-E em release, provas em `docs/proof/left-panel/b1-*.png`.
- **B2/B3 (implementacao, caminho COM liberado pelo Rodrigo)**:
  - Rust: `webview2-com`/`windows`/`base64` viram deps diretas (ja estavam no
    binario via wry/tauri — zero bytes novos); modulo novo
    `src-tauri/src/modules/browser/com.rs` com eventos de navegacao
    (`SourceChanged`/`HistoryChanged`/`DocumentTitleChanged` →
    `micah:browser-nav`/`micah:browser-title`), `browser_page_info` (URL +
    titulo + favicon PNG numa viagem so, correcao 9), extensoes
    (listar/carregar/remover REAIS via `ICoreWebView2Profile7`, pasta validada
    em Rust antes — correcoes 9-11, 16-17) e `browser_clear_data`
    (`ClearBrowsingData` escopado por kinds, perfil intacto, porta CDP intacta
    — correcao 19). Cada cast COM e `if let Ok` (runtime velho degrada, nunca
    derruba o painel). Todos os comandos em dupla panel.rs + stub.rs
    (correcao 25); `cargo check --no-default-features` verde.
  - Frontend: `lib/collections.ts` (funcoes puras: redacao de credencial na
    query E no userinfo — correcoes 13/22, aplicada tambem ao URL_KEY do
    restore; historico com seq monotonica, coalescencia e teto — correcao 20;
    favoritos com upsert por URL, teto de icone, sanitizacao de store
    corrompido — correcoes 7/14) com 16 testes vitest;
    `lib/useCollections.ts` (dois stores separados, historico com flush em
    debounce + flush no teardown/visibilitychange — correcao 20d; escritor
    unico = janela main — correcao 24); `BrowserPanel.tsx` ganha o rail de
    favoritos (coluna flex FORA do host e FORA do grupo de paineis — correcoes
    10-11; `title` nativo, sem Radix Tooltip — correcao 13) e o menu sanduiche
    (Historico navegavel, dialogo de Extensoes com aviso de ameaca, Limpar
    dados nomeando escopo por escopo — correcao 15/19), tudo em superficies
    shadcn ja cobertas pela supressao de overlay (correcao 14).
