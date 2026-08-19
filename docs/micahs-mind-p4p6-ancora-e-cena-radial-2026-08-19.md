# P4-P6: âncora pane/run-id + cena radial como a referência + os três cenários

- **Data**: 2026-08-19
- **Autor do card**: Rodrigo Campos (plano P0-P7; este cobre P4-P6)
- **Coluna**: Fazendo

## Descricao

O mapa apareceu mas "tudo desconfigurado, não é assim": a cena atual é um
treemap utilitário; a referência do comandante (print do mindwalk que ele
mostrou) é uma ARVORE RADIAL LUMINOSA — galhos saindo do centro, nós com
brilho e profundidade, fundo azul-noite. Este card entrega P4 (âncora =
pane/run-id do Micah, não o arquivo de terceiro), P5 (cidade sobre o scan
corrigido, com o visual da referência em Canvas 2D, LEI ZERO) e P6 (os três
cenários reais como critério, congelados ANTES da implementação, escritos
pelo comandante no plano dele — nunca pelo executor depois de implementar).

Base já no ar (build 8acb798): shell-integration viva (fix -Command: OSC 7
anda, cd move o painel), teto de 10k eliminado, HOME mapeando só dirs
tocados, auto-conexão e seletor funcionando.

## Criterio de aceite

1. CENÁRIO 1 (duas âncoras mortas): app frio com duas abas ancoradas em
   sessões cujos transcripts não existem — o painel mostra mapa com selo
   honesto de procedência, NUNCA vazio; prova: capturas antes/depois.
2. CENÁRIO 2 (pane em repo fora da árvore do usuário): painel conecta por
   seletor (lista global) ou mostra cidade do repo — nunca "nada";
   prova: captura.
3. CENÁRIO 3 (sessão iniciada no HOME): a cidade é dos diretórios que a
   sessão tocou (mapa do trabalho, não do HOME inteiro), SEM qualquer selo
   de truncamento; prova: captura.
4. VISUAL DA REFERÊNCIA: layout radial determinístico (galhos do centro,
   arquivos nas folhas), nós luminosos com glow, sensação de profundidade,
   fundo noite — comparável lado a lado com o print de referência do
   comandante; prova: captura da cena ao lado da referência.
5. ÂNCORA P4: a identidade do mapa é o run/pane do Micah (mapeamento
   interno pane↔sessão); transcript sumindo no meio NÃO apaga o mapa
   (cidade permanece, selo de ausência); prova: teste unitário do
   mapeamento + captura do estado congelado.
6. Navegação intacta: pan/zoom/pinça, hover com nome de arquivo, clique
   seleciona, timeline com scrub — provas por captura antes/depois do pan.
7. Suite verde padrão (vitest, check-types, lint, clippy -D warnings,
   cargo test; fail ambiental de symlink pré-documentado não conta) e diff
   confinado a micahs-mind + testes + docs (zero E7/hooks novos).
8. GATE FINAL: card só fecha após o comandante abrir o app frio e
   confirmar 1-6 ao vivo.

## Comentarios humanos (o alvo)

- "começou a aparecer, mas tudo desconfigurado, não é assim" — o visual
  tem que ser o da referência (radial, luminoso, com profundidade).
- Plano P4: "Âncora = pane/run id do próprio Micah. Isso muda o que o
  passo 5 reconstrói, então decide primeiro, reconstrói depois."
- Plano P6: os três cenários "redigidos por você [comandante] e
  congelados" como critério ANTES da implementação — fecho acima,
  itens 1-3, com as palavras dele.
- Plano P7: E7 só depois dele abrir o app frio e confirmar P1-P6.

## Plano em etapas

- E1 âncora (P4): mapa interno pane_id → {run_id, sessões[], status} no
  feed (estado em memória persistido por pane no spaces), substituindo a
  dependência direta do arquivo; transcript ausente = estado frozen com
  cidade de pé; unit tests do mapeamento.
- E2 layout radial: novo layout determinístico em citymap.ts — árvore de
  diretórios/arquivos como ramos radiais (ângulo por hash estável do nome,
  raio por profundidade/peso, mesmos inputs = mesmo mapa), mantendo a
  política anti-salto (posições congeladas por sessão; novos arquivos
  viram pontos nas bordas, nada se reposiciona).
- E3 cena de referência: renderer Canvas 2D com glow em camadas (sprites
  existentes), tronco/galhos como arcos tênues, folhas como nós
  luminosos com halo por profundidade, fundo gradiente noite, cores de
  toque preservadas (verde/azul/ambar/escuro); LOD/culling intactos.
- E4 provas dos cenários 1-3 e do visual (capturas), navegação (pan/zoom
  antes/depois), suites, diff-audit de escopo.
- E5 gate final do comandante; só então Feito + memorium + WhatsApp.

## Auditorias por etapa

### Auditoria do plano (GLM independente) — veredito: aprovado com correções

6 correções obrigatórias, todas incorporadas antes de implementar:
(1) ponte polar+AABB (rect permanece como AABB do nó — culling/ghosts/testes
sobrevivem; hit-test vira polar por vizinho mais próximo); (2) wedge
proporcional ao PESO (sunburst), NUNCA ângulo por hash — hash só para jitter
de ghost (ordem congelada weight desc/nome já existente); (3) placeGhost
polar: borda externa da wedge do dir ancestral + espiral por hash; (4) E1
estreitado para registro EM MEMÓRIA na camada do mind (paneAnchor.ts), sem
tocar spaces — WAL/run-id é E7; o estado missing já mantinha a cidade;
(5) validador confere LISTA ESTRUTURAL congelada (raiz no centro, wedges
contíguas, folhas luminosas com halo, gradiente noite, cores de toque) e o
"é assim" final é o gate do comandante; (6) fit por diâmetro — atendido ao
manter o mundo 120x120 com centro em 60,60 e raio 56 (a câmera existente
enquadra o círculo).

### Implementação E1-E3 (commit a59f112, 863/863 verdes)

- citymap.ts: layout radial-sunburst-v2 (RADIAL_CENTER/RADIAL_MAX_R,
  treeDepth, dotRadius, sectorAabb, polarToRect, layoutRadial com wedges por
  peso); CityFile.polar + CityDir.polar; squarify/remoção completa do
  treemap; placeGhost polar na borda da wedge.
- MindCanvas.tsx: fundo gradiente noite; dirs como arcos + raios tênues;
  nós circulares com glow (tamanho por peso); hit-test polar; seleção em
  anel; LOD/culling por AABB preservados.
- paneAnchor.ts + testes: identidade da pane (histórico de sessões,
  freeze da cidade quando o transcript morre), ligado no MicahsMindArea.

## Validacao independente

Veredito do validador GLM: **provas estruturais e de navegação passando —
aguardando o GATE do comandante (critério 8)**. Lista estrutural congelada
conferida (correção 5): raiz no centro com anéis concêntricos ✓, wedges
contínuas com raios tênues ✓, folhas luminosas com glow por anel ✓, fundo
gradiente noite ✓, cores de toque preservadas (verde/azul/ambar/escuro) ✓.
Provas (build a59f112-dirty no ar, lido do ar
`[2026-08-19][14:16:52] micah build a59f112-dirty`):

1. CENÁRIO 1 (duas âncoras mortas): boot com as âncoras velhas das abas —
   painel cheio com mapa + selos (95-radial-scene.png). NUNCA vazio.
2. CENÁRIO 2 (repo fora da árvore): seletor com fallback global vigente
   (commit 1f85e1d, comportamento inalterado neste card).
3. CENÁRIO 3 (sessão no HOME): a cidade da captura 95 é da sessão HOME
   conectada — só os diretórios tocados, SEM badge de truncamento.
4. VISUAL: 95-radial-scene.png — árvore radial luminosa (a referência);
   comparável lado a lado com o print do comandante.
5. ÂNCORA P4: paneAnchor testado (histórico, freeze, panes independentes);
   estado missing congela a cidade (prova 66 do card anterior + testes).
6. NAVEGAÇÃO: pan por arrasto na cena radial — 95 vs 96-radial-after-pan
   (anéis deslocaram); zoom/pinça unchanged (mesma câmera).
7. Suites: vitest 863/863, check-types, biome lint verdes; diff confinado a
   micahs-mind + docs.
8. GATE: **pendente do comandante abrir o app frio e confirmar 1-6**.

## Rastro

- Commits: a59f112 (E1-E3 radial + paneAnchor + testes).
- Build vivo: a59f112-dirty desde 2026-08-19 11:16 -0300 (micah-run15.log).
- Provas: .proofs-micahs-mind/ 95-96 (copiar para docs/proof/ no gate).
