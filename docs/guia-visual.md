# Guia visual do 4blade (repaginação, Etapa 1)

Fonte das regras: `docs/PROMPT-REPAGINACAO.md`. Este guia registra o que foi decidido e o que vale para as próximas fatias.
Estado: **fatia 1** (fundação + telas de amostra), 27/11/2026. Os valores ficam na camada "REPAGINAÇÃO VISUAL v5" no fim de `public/style.css`.

## 1. Diagnóstico (prints de `docs/prints/repaginacao/fatia-1/antes/`)
- **Paletas claras com fundo bege/pêssego** (ganache `#efe7da`, índigo `#f7e7dc`): ar "amarelado", cartão quase da mesma cor do fundo.
- **Contraste insuficiente** no botão da paleta Cereja (texto branco sobre `#f0284a` = 4,1:1, abaixo de 4,5).
- **Valores soltos**: raios 9/10/12/14/16/18/20 px, sombras e durações diferentes em cada camada (v3, v4, caixa) — botões, chips, cartões e campos quase iguais, mas não iguais.
- **Ícones** com traços e cantos diferentes entre si (uns quadrados, outros arredondados; espessura única 1,8 sem diferença para o item ativo).
- **Espaço mal aproveitado no computador**: Mensagens fica em 760 px e deixa metade da tela vazia a 1366 px.
- **Hierarquia de cor fraca na agenda em grade**: blocos azul-claro com texto azul e pouca separação do fundo.
- **Movimento**: janelas e grupos do menu aparecem "secos"; troca de tela sem transição; nenhum esqueleto quando a tela está vazia.

## 2. Tokens (variáveis CSS)
| Grupo | Tokens |
|---|---|
| Tipografia | `--fonte-marca` (Montserrat de `public/fontes/`), `--fs-1` 12 · `--fs-2` 13,5 · `--fs-3` 15 · `--fs-4` 17 · `--fs-5` 21 · `--fs-6` 27 px. Números: `tabular-nums`. |
| Espaço (4/8) | `--esp-1` 4 · `--esp-2` 8 · `--esp-3` 12 · `--esp-4` 16 · `--esp-5` 20 · `--esp-6` 24 · `--esp-8` 32 px |
| Forma | `--raio-p` 8 · `--raio-m` 12 (botões, campos) · `--raio-g` 16 (cartões) · `--raio-xg` 22 (janelas, faixas) |
| Sombra | `--sombra-1` (quase nada), `--sombra` (cartão), `--sombra-2` (destaque), `--sombra-alta` (janela) — versões próprias no escuro |
| Movimento | `--dur-1` 120 · `--dur-2` 180 · `--dur-3` 240 ms; `--curva-saida` cubic-bezier(.22,.8,.24,1); `--transicao` |
| Foco | `--anel-foco` (anel de 3 px na cor `--foco`) |
| Cor | `--fundo`, `--cartao`, `--texto`, `--suave`, `--borda`/`--linha`, `--primaria` (grafite), `--dourado` (destaque), `--destaque` (destaque escuro para texto), `--sobre-dourado`, `--ok`, `--erro`, `--neutro`, `--neutro-2`, `--campo`, `--campo-borda` |

## 3. Paletas (mesmos nomes e chave `4blade.aparencia`)
Regra comum: claro = fundo neutro levemente quente, cartão mais claro que o fundo, texto grafite, **um** destaque; escuro = grafite profundo, cartão um tom acima.
| Paleta | Escura (30%) | Destaque (10%) | Fundo claro |
|---|---|---|---|
| navalha (padrão) | `#24282b` (grafite da logo) | `#e0a330` (dourado da logo) | `#f5f4f1` |
| ganache | `#3d251c` | `#1fd15a` | `#f6f2ed` |
| berinjela | `#3a2044` | `#ff6420` | `#f6f3f1` |
| violeta | `#1d1918` | `#6f3cff` | `#f5f4f2` |
| indigo | `#231a4f` | `#00d2ff` | `#f5f4f3` |
| cereja | `#2f3748` | `#e11d48` (antes `#f0284a`, sem contraste) | `#f4f5f7` |
Cor do topo do celular: `COR_TOPO` em `public/tema.js` (= escura de cada paleta). Contraste conferido por `node test/contraste-temas.mjs` (texto, texto suave, destaque, botões, avisos: todos ≥ 4,5:1).

## 4. Componentes
- **Botões**: principal = cor de destaque da paleta (`.botao.principal`/`.dourado`); secundário = contornado (`.botao`); texto/perigo = `.botao.texto-perigo`; perigo cheio = `.perigo-cheio`. Altura mínima 44 px (40 px no `.pequeno` do celular). Estados: hover, foco (anel), pressionado (escala .97), desativado (45% e cursor proibido), carregando (`.ocupado`, girador).
- **Cartões**: borda fina `--linha` + `--sombra`; cartão dentro de cartão sem sombra.
- **Campos**: raio 12, foco com halo da cor `--foco`; desativado em `--neutro-2`.
- **Chips/abas**: chip ativo = cor escura da paleta (no escuro, invertido); abas segmentadas como antes.
- **Listas que expandem** (`itemExpansivel`): conteúdo desce com 180 ms.
- **Janelas**: raio 22, entrada com leve subida + fundo que esmaece.
- **Cabeçalho de tela**: moldura com traço da marca, título na fonte da marca.
- **Estado vazio / carregando**: `.vazio` em tom suave; `#app` vazio mostra esqueleto pulsando.

## 5. Ícones
Uma família própria em `ICONES` (`public/app.js`): grade 24 px, traço 1,75, pontas e cantos arredondados, sem preenchimento. **Mesmas chaves e mesmas metáforas** (agenda = calendário, caixa = caixa registradora, clientes = pessoas, serviços = tesoura…). Ativo = cor de destaque + traço 2,15 (não muda o desenho). Ícone novo: desenhar na mesma grade, só com `path` em traço.

## 6. Animações
Só `transform` e `opacity`, 120–240 ms, curva de saída. Usadas em: toque nos botões, grupos do menu, menu lateral, janelas, listas que expandem, avisos flutuantes, troca de tela (`#app.tela-entra`, só quando muda o endereço) e esqueleto. Com "reduzir movimento" do aparelho: nenhuma.

## 7. Fazer e evitar
- Fazer: usar os tokens; um destaque por tela; separar por espaço antes de usar linha; conferir 390 e 1366 px nos dois modos.
- Evitar: gradiente chamativo, vidro fosco, neon, emoji, sombra pesada, cor nova fixa fora dos tokens, `style="…"` (CSP), mudar texto, ordem de campos ou lugar de ações.
