# Explorer com raiz livre: navegar ate o NAS, com a lupa junto

- **Data**: 2026-08-15
- **Autor do card**: Rodrigo Campos
- **Coluna**: Fazendo

## Descricao

A sidebar Files fica presa na raiz derivada do terminal (hoje: "Zigfriad", o
home). O Rodrigo quer **poder e liberdade de navegar ate o NAS** (Z:, o
Synology via Tailscale) e qualquer outro drive — e a **lupa/pesquisa do
explorer nao alcanca** nada fora da raiz atual. Screenshot do pedido:
`C:\Users\Zigfriad\Desktop\01.jpg` (setas apontando o cabecalho "Zigfriad" e a
lupa).

O Rodrigo ja comecou o encanamento (WIP dele no working tree, a direcao e
dele): `fs_list_drives` no Rust (com testes), `RootSwitcher` no CwdBreadcrumb
do statusbar, `setExplorerRootOverride` no useWorkspaceCwd. Falta a fiacao.

## Criterio de aceite

1. O rotulo da raiz no cabecalho do explorer ("Zigfriad") vira um navegador:
   clicar nele abre opcoes com **Home**, **subir um nivel** e os **drives
   montados** (Z: incluido, por `fs_list_drives`).
2. Escolher `Z:/` troca a raiz do explorer para o NAS e a arvore lista o
   conteudo real de `Z:\` (provado com captura).
3. A **lupa** do explorer, com a raiz no NAS, encontra um arquivo que existe
   la (ex: buscar parte do nome de um arquivo real de `Z:\Documents`).
4. Comandos de fs sobre a raiz nova nao sao recusados pela autorizacao de
   workspace (a raiz escolhida e autorizada no registro ao ser escolhida).
5. Um cwd novo vindo do terminal ativo volta a mandar (o override cai), como o
   WIP do Rodrigo ja desenha.
6. O `RootSwitcher` do statusbar (WIP dele) funciona no mesmo mecanismo.
7. `pnpm check-types`, `pnpm test`, `cargo clippy -D warnings` e
   `cargo check --no-default-features` passam.
8. Provado no binario de release com captura de SO.

## Comentarios humanos (o alvo)

> "em vez de zigfriad, quero ter poder e liberdade de navegar ate o NAS e a
> lupa e a pesquisa nao o alcanca. Conserte"

- A direcao de implementacao e a do WIP dele — terminar, nao reescrever.
- NAS = Z: persistente no laptop (\\100.88.140.127\Documents).

## Plano em etapas

| Etapa | Entrega | Prova |
|-------|---------|-------|
| N1 | Levantamento: como o FileExplorer recebe `rootPath`, onde a lupa e o fuzzy buscam, o que a autorizacao de workspace recusa | file:line no card |
| N2 | Fiacao: `setExplorerRootOverride` ligado no App; cabecalho do explorer vira navegador (Home/subir/drives); `workspace_authorize` na escolha; `fs_list_drives` registrado no generate_handler | check-types + testes |
| N3 | Prova em release: Z: na arvore, lupa achando arquivo do NAS, override caindo com cwd novo | capturas + card |

## Auditorias por etapa

### Auditoria do plano (2 lentes em paralelo, 2026-08-15 ~00:10)

**Veredito: direcao do WIP correta, 5 correcoes obrigatorias — todas aceitas e
aplicadas antes de N3:**

| # | Categoria | Defeito | Correcao aplicada |
|---|-----------|---------|-------------------|
| 1 | Travamento de UI | `fs_list_drives` sincrono sondava A:..Z: com `is_dir()` — drive de rede desconectado trava o redirector SMB por dezenas de segundos NA MAIN THREAD (comando sem async roda inline no handler de IPC) | `GetLogicalDrives()` (bitmask local, zero rede; feature `Win32_Storage_FileSystem` no windows-sys ja direto) + comando async. Drive morto continua listado e o erro chega no clique, onde ja ha toast |
| 2 | Travamento de UI + cancelamento morto | fs_search/fs_list_files/fs_grep/fs_grep_interactive/fs_glob/fs_read_dir/list_subdirs TODOS sincronos → main thread; busca no NAS = janela inteira "Not Responding" por minutos; o cancelamento por geracao do interactive era INERTE (walks serializadas nunca se sobrepoem) | os 7 viram `async fn` + `spawn_blocking` (padrao da casa: wsl_list_distros); `ContentSearchState.generation` virou `Arc<AtomicU64>` e o bump acontece ANTES do spawn — cancelamento passou a cancelar de verdade |
| 3 | Volume / verificabilidade | raiz de NAS sem git: `require_git=true` da crate ignore desliga TODO gitignore, nada e podado, o teto de 50k trunca — "No matches" truncado nao e prova de ausencia | mensagem de truncamento reescrita (com e sem resultados) dizendo que a varredura PAROU no teto e sugerindo raiz mais funda; limite documentado abaixo |
| 4 | Canonicalizacao UNC | usar o retorno canonico do authorize como override troca `Z:/` por `//100.88.140.127/Documents` (renomeia o header, quebra "subir", cria duas grafias do mesmo lugar) | autoriza pelo canonico NO REGISTRO, mas o override guarda a grafia ESCOLHIDA (so separadores normalizados) |
| 5 | Rollback | HEAD `f32fe05` nao era autocontido: lib.rs commitado referenciava `fs_list_drives` que so existia no worktree | o commit deste card inclui o WIP do Rodrigo (tree.rs/CwdBreadcrumb/useWorkspaceCwd) |

**Limite conhecido e medido**: walk do Z:\ inteiro via SMB/Tailscale ≈ 297
entradas/s (medido em 15s de amostra) → o teto de 50.000 entradas leva ~3
minutos e trunca. Busca em raiz gigante e melhor a partir de subpasta; a
mensagem no painel agora diz exatamente isso.

## Validacao independente

> Parcial — aguardando o teste manual do Rodrigo (ele assumiu a maquina
> durante a prova, o que e o proprio uso real).

| Criterio | Estado | Prova |
|----------|--------|-------|
| 1 (header vira navegador Home/subir/drives) | implementado; visivel em `n3-02-files-z.png` (header "Z:" com seta) | captura |
| 2 (raiz troca para Z: e lista o NAS) | **aprovado** — arvore listando o conteudo real de Z:\ (01 L'Arte Regia, CavaloMagico, comandante.txt...) | `n3-02-files-z.png` |
| 3 (lupa acha arquivo no NAS) | busca RODA no NAS com a UI viva ("Searching..." pintando = main thread livre; antes do fix seria "Not Responding"); raiz-total trunca no teto em ~3min (limite medido e documentado) — prova de acerto pontual fica para busca em subpasta | `n3-03/-04` + medicao 297/s |
| 4 (autorizacao) | aprovado — fs_read_dir listou Z:\ sem recusa (a arvore renderizou) | `n3-02` |
| 5 (cwd do terminal derruba o override) | mecanica do WIP do Rodrigo mantida; o boot ja mostrou o explorer seguindo `PS Z:\>` | `n3-01-boot.png` |
| 6 (RootSwitcher do statusbar) | visivel no rodape ("Z:" com icone de drive) | `n3-01-boot.png` |
| 7 (suite) | check-types 0; vitest verde; clippy -D warnings 0; cargo test 243 verdes + symlink ambiental conhecido; `--no-default-features` 0 | saidas na sessao |
| 8 (release + SO) | todas as capturas sao PrintWindow do binario de release | n3-*.png |

Extra deste ciclo (pedido ao vivo): painel central (terminal/AI) agora espreme
ate **160px** (era 25% ≈ 640px) — `App.tsx` id="workspace" minSize.

## Rastro

- WIP do Rodrigo (fs_list_drives, RootSwitcher do statusbar,
  setExplorerRootOverride) mantido como direcao e terminado.
- Novo: `RootNavigator` no cabecalho do FileExplorer (Home/subir/drives),
  `navigateExplorerRoot` no App (autoriza + override com a grafia escolhida),
  7 comandos de fs em async/spawn_blocking, `GetLogicalDrives`, mensagem de
  truncamento honesta, minSize 160px no painel central.
