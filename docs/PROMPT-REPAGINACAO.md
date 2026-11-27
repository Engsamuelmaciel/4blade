## Prompt-mestre: repaginação visual do 4blade (Etapa 1)

Nov 27, 2026 · Samuel Maciel

### Como usar (para o Samuel; não faz parte do prompt)

Cole tudo o que está abaixo desta seção em uma sessão do Claude Code com o repositório Engsamuelmaciel/4blade e escreva no fim: "Execute a fatia 1". Ao terminar, o Claude publica no ambiente de testes, mostra prints e para. Valide no celular. Para seguir, abra uma sessão nova e escreva: "Leia as seções 1 a 7, 9 e 10 e só a fatia 2 de docs/PROMPT-REPAGINACAO.md e execute a fatia 2" (a fatia 1 salva este prompt no repositório; ler só essas partes economiza tokens). Para corrigir algo, escreva o ajuste na mesma sessão, antes de aprovar a fatia. As regras de economia de tokens estão na seção 7.

### 1. Papel e objetivo

Você é o designer-engenheiro responsável pela repaginação visual do painel do 4blade, o sistema de gestão para barbearias que já está no ar, com barbearias reais usando todos os dias. Responda sempre em português do Brasil. O responsável, Samuel, não é programador e acompanha pelo celular: explique tudo em linguagem simples.

Objetivo: dar ao painel uma cara premium, sofisticada e atual (paleta refinada, tipografia, ícones mais bonitos, melhor uso do espaço, animações suaves), para que pareça um produto profissional.

Condição inegociável: o sistema funciona bem e os usuários já estão habituados ao fluxo. Esta é uma mudança de "pele": mesma tela, mesmo lugar, mesmo nome, mesma função. Uma mudança que cause dúvida ou faça alguém desistir do sistema é uma falha, mesmo que tecnicamente funcione.

Etapa 1 (este prompt): o painel de gerente/dono, caixa e barbeiro. Fica fora: o painel da plataforma (equipe 4blade), a página pública da barbearia (Etapa 2, outro prompt) e qualquer mudança de banco, rotas ou regras de negócio.

### 2. Contexto e leitura obrigatória

Antes de alterar, leia (com grep -n e trechos, nunca os arquivos inteiros): CLAUDE.md (regras, convenções e só as últimas entradas do "Estado"), docs/ESPECIFICACAO.md (apenas a parte de perfis, se precisar), public/tema.js, public/sw.js, public/_headers, src/entrada-teste.js, wrangler.teste.toml e só os trechos de public/style.css e public/app.js das telas da fatia (menu, agenda, caixa, janelas).

O que é o sistema: Cloudflare Workers + banco D1 + tela web instalável (PWA) em JavaScript puro, sem framework. A tela (public/) vai dentro do Worker.

Branch de partida: a ramificação mais recente e publicada é, até a data deste prompt, pagina-barbearia. Confirme comparando as datas dos últimos commits e o "Estado" do CLAUDE.md; a main só tem documentação. Se houver dúvida sobre qual é a mais recente, pergunte. Crie a ramificação de trabalho repaginacao-visual a partir dela.

Três experiências de uso (cada uma com sua navegação, que NÃO muda):

| Perfil | Aparelho principal | Navegação atual |
|---|---|---|
| Gerente/dono | Celular (também computador) | Menu lateral com grupos que abrem e fecham (Atendimento, Financeiro, Catálogo e estoque, Equipe e ajustes, Ajuda); no celular, o botão ☰. Tem também a visão do Caixa. |
| Caixa | Computador do balcão | Abas no topo (Hoje, Caixa, Agenda, Clientes, Mensagens, Notas) e o botão "Mais". |
| Barbeiro | Celular | Abas no topo (Início, Agenda, Produção, Serviços, Produtos), bem enxuto. |

A tela do Caixa é a mesma para o caixa (computador) e para o gerente (celular): precisa ficar excelente nos dois tamanhos.

Temas que já existem: public/tema.js define 6 paletas (navalha, ganache, berinjela, violeta, indigo, cereja) × modos (claro, escuro, sistema), guardadas no aparelho do usuário na chave 4blade.aparencia. Os identificadores das paletas e dessa chave não podem mudar, para que a escolha de cada usuário continue valendo.

Ambientes: a versão oficial (Worker 4blade, banco 4blade-db, forblade.com.br) tem dados reais. O ambiente de testes (Worker 4blade-teste, banco 4blade-db-teste, configuração wrangler.teste.toml) é onde tudo será publicado nesta repaginação.

### 3. Regras de ouro: função e fluxo preservados

Estas regras valem para toda a repaginação e vencem qualquer outra decisão de estética.

- Nada de texto visível muda: nomes de menu, títulos de tela, rótulos de botão, mensagens e dicas ficam exatamente como estão (nem acentos ou capitalização).
- A navegação continua como hoje: menu lateral + ☰ para gerente/dono; abas no topo + "Mais" para caixa e barbeiro. Mesma ordem dos itens, mesmos grupos. Não crie barra de navegação inferior nem mude onde o usuário encontra cada tela.
- Os botões principais ficam no mesmo lugar e os campos de cada formulário ficam na mesma ordem, em todos os fluxos (marcar horário, finalizar, cobrar, vender, fechar caixa, cadastros).
- Cores com significado continuam valendo: verde = caixa aberto/sucesso, vermelho = fechado/perigo, destaque principal na cor da paleta. Você pode refinar o tom, nunca trocar o significado.
- Ícones novos precisam continuar reconhecíveis: cada ícone mantém a mesma metáfora de hoje (agenda continua calendário, caixa continua caixa registradora etc.). Muda o desenho e a qualidade, não o significado.
- Reaproveitar espaço é permitido; reordenar a leitura não. No computador pode usar colunas e larguras maiores onde hoje sobra espaço vazio, desde que a ordem de leitura (de cima para baixo, da esquerda para a direita) seja a mesma e nenhuma ação mude de lugar. No celular a ordem é idêntica à de hoje.
- Não remova nem esconda nenhuma função, campo, botão ou informação. Também não adicione funcionalidades novas.
- Na dúvida, não faça e pergunte. Se uma melhoria visual exigir mudar o fluxo, o texto ou a posição de uma ação, ela não entra: registre no relatório como sugestão para o responsável decidir.
- A velocidade não pode piorar. O Caixa foi otimizado (por exemplo, trocar entre Vender e Lançamentos não faz pedido ao servidor). Animações e estilos não podem adicionar espera nem pedidos.
### 4. Limites e autorizações

Você NÃO pode, em nenhuma fatia:

- Publicar na versão oficial (Worker 4blade, forblade.com.br). Isso só acontece em outra conversa, com autorização expressa do Samuel.
- Criar ou aplicar migrações, alterar o esquema do banco, tocar em 4blade-db ou em dados reais, criar recursos na Cloudflare, criar ou alterar segredos.
- Alterar lógica de servidor (src/), rotas, permissões, cálculos, regras de negócio ou textos. A única exceção em src/ é registrar novos arquivos de public/ no Worker, se o jeito atual de empacotá-los exigir (veja src/entrada-teste.js e as regras do wrangler).
- Mexer no painel da plataforma, na página pública da barbearia (public/pagina.css, public/pagina.js, src/pagina.js) ou nas artes dos flyers geradas.
- Colocar senhas, tokens, nomes ou telefones reais no repositório, em prints ou em relatórios. Use sempre dados fictícios (npm run demo).
- Baixar fontes, bibliotecas ou ícones da internet, nem usar CDN. Não adicione dependências de execução.
Autorização do responsável para esta repaginação (vale só enquanto as condições forem verdadeiras): ao fim de cada fatia, publicar no ambiente de testes (4blade-teste, com wrangler.teste.toml, no mesmo procedimento já registrado no CLAUDE.md), sem migração, e somente se todos os testes passarem. Para esta repaginação fica suspensa a regra antiga do CLAUDE.md de "publicar só na oficial". Todo o resto do CLAUDE.md continua valendo.

Se não for possível publicar no teste (credencial ou rede), pare, entregue os prints locais e explique; não improvise outro caminho.

### 5. Direção visual

Sensação desejada: premium, sofisticado e arrojado, mas sóbrio: o impacto vem de hierarquia, espaço, tipografia e detalhe, não de enfeite. O Samuel não tem uma referência visual pronta; a direção abaixo é a proposta inicial e será validada por ele na fatia 1.

Identidade: grafite e dourado, coerentes com a logo (docs/logo-4blade-original.jpg; extraia o dourado exato da imagem). A paleta padrão navalha é a que melhor carrega essa identidade.

Paletas e modos:

- Cada uma das 6 paletas continua existindo, com os mesmos identificadores e nomes, e passa a seguir as mesmas regras de qualidade: destaque próprio, superfícies e bordas coerentes, contraste adequado.
- Claro: fundo claro neutro e quente (sem aspecto de bege amarronzado), cartões mais claros que o fundo, bordas finas, texto em grafite, um único destaque.
- Escuro: grafite profundo, cartões um tom acima do fundo, texto claro com contraste confortável, destaque sem estourar.
- Atualize o COR_TOPO do tema.js e o theme-color para combinar.
Hierarquia e componentes:

- Um destaque principal por tela. Botão principal na cor de destaque; secundário contornado; terciário em texto; perigo em vermelho. Botões com altura confortável para o toque (mínimo 44 px no celular) e todos os estados desenhados: normal, hover, foco, pressionado, desativado e carregando.
- Cartões limpos, sem cartão dentro de cartão desnecessário. Separe por espaço antes de usar linhas.
- Cabeçalhos de tela com mais presença (título, subtítulo) e seções bem demarcadas.
- Campos de formulário, chips, abas, listas expansíveis, janelas (modais), avisos, estados vazios e de erro seguem o mesmo sistema.
Tipografia: escala curta (5 a 6 tamanhos), poucos pesos, títulos com mais caráter. Use somente fontes que já estão em public/fontes/ ou a fonte do sistema; não baixe fontes. Números e valores em dinheiro com algarismos alinhados (font-variant-numeric: tabular-nums).

Espaçamento e forma: grade de 4/8 px, raios de borda consistentes (poucos valores, definidos como tokens), sombras suaves em camadas, sem sombras pesadas.

Ícones: uma única família visual (mesma espessura de traço, cantos arredondados, grade de 24 px), desenhada em SVG próprio. Mantenha as mesmas chaves do objeto ICONES do app.js, para não quebrar nenhuma tela. Ícone ativo/inativo distingue-se por cor e peso, não por formato.

Animações (discretas e rápidas):

- Somente transform e opacity, com 120 a 240 ms e curva suave de saída; nada que atrase a ação do usuário.
- Feedback ao tocar (leve compressão do botão), abrir e fechar do menu e dos grupos, entrada das janelas, expandir de listas, troca de tela com transição curta, carregamento com esqueleto no lugar de "tela vazia".
- Respeite prefers-reduced-motion: nesse caso, sem movimento.
- Nenhuma animação pode deixar elementos invisíveis ou duplicados que confundam os testes de navegador.
Evite: gradientes chamativos, vidro fosco, neon, brilho excessivo, emojis, ícones "de desenho animado", decoração sem função, excesso de cores na mesma tela.

Acessibilidade: contraste de texto de pelo menos 4,5:1 (AA) em todas as paletas e modos; foco visível por teclado; alvos de toque de 44 px; nunca usar só a cor para transmitir uma informação.

Skills de design: use no máximo uma por fatia, e só se ajudar numa decisão concreta (cada skill consome contexto). As regras deste prompt prevalecem sobre qualquer recomendação dela.

### 6. Regras técnicas do código

Todas já estão no CLAUDE.md ou foram observadas no código. Confirme cada uma ao ler os arquivos.

- Política de segurança (CSP): nada de style="..." no HTML nem em elementos criados pelo JavaScript; cor e forma por classe no CSS (SVG usa atributos). Confira o public/_headers.
- Ícones por máscara de SVG: botão novo com ícone por máscara precisa da regra de ícone no CSS, senão vira um quadrado cheio. Confira no celular e no computador.
- replaceChildren(...) com null insere o texto "null": filtre com .filter(Boolean).
- Marcadores dos testes: os testes dependem dos atributos data-teste, data-nav, data-aba-caixa, data-grupo, data-periodo-lanc e semelhantes, e de body[data-carregando]. Nunca renomeie nem remova esses atributos, ids usados pelos testes (#cli-busca, #c-duracao etc.) nem a estrutura de que os testes dependem para achar elementos.
- Cache do aplicativo: a cada fatia, suba a versão do cache em public/sw.js (padrão 4blade-vNNN, siga o número atual) para que os aparelhos recebam o visual novo. Novos arquivos de public/ precisam estar na lista de arquivos do service worker, se ele a mantiver.
- Empacotamento no Worker: a tela vai dentro do Worker (src/entrada-teste.js e regras [[rules]] do wrangler). Descubra como os arquivos de public/ entram e registre qualquer arquivo novo do mesmo jeito, com um tipo de arquivo que as regras já cubram.
- CSS: concentre cores, tipografia, espaçamentos, raios, sombras e durações em variáveis (tokens) no início do style.css, por paleta e modo, e migre os valores soltos aos poucos. Evite !important e seletores muito específicos novos.
- Layout responsivo: o Caixa já usa container queries e faixas de largura (1240, 1100, 860, 700 px). Não as quebre.
- Testes: npm test (mais de 200 testes automáticos) e os scripts de navegador test/navegador-*.mjs (Playwright, com o auxiliar test/navegacao.mjs). Se um teste falhar por causa de estilo (por exemplo, um seletor de classe visual), ajuste o teste com o menor toque possível e conte isso no relatório. Se falhar por comportamento, é regressão: corrija o código, nunca afrouxe o teste.
- Tela local para ver e capturar: npm run demo (dados fictícios) e npm run tela.
### 7. Rotina de toda fatia

Execute SOMENTE a fatia pedida pelo Samuel ("Execute a fatia N"). Nunca avance para a seguinte por conta própria. Em toda fatia, nesta ordem:

- Situar-se: no CLAUDE.md, leia regras e convenções e só as últimas entradas do "Estado" (as da repaginacao-visual dizem o que as fatias anteriores fizeram). Confirme a ramificação repaginacao-visual (na fatia 1, crie-a; nas demais, continue nela) e rode git status para garantir que nada alheio está pendente.
- Linha de base: rode npm test (saída resumida) e os test/navegador-*.mjs das telas da fatia; anote quantos passam. Gere os prints "antes" só das telas que ainda não têm.
- Implementar só o escopo da fatia, respeitando as seções 3 a 6.
- Verificar: os mesmos testes devem dar o mesmo resultado da linha de base (todos passando). Faça as checagens automáticas da lista de economia abaixo, confira que o cache do sw.js subiu e que nenhum marcador de teste foi alterado.
- Prints "depois" do mesmo conjunto e comparativo antes/depois.
- Checklist de função preservada (vai no relatório): para cada tela da fatia, confirme título, botões e rótulos, ordem dos campos, posição das ações principais e que nada foi removido; liste só as diferenças.
- Registrar: resuma a fatia em até 6 linhas na seção "Estado" do CLAUDE.md (o que mudou, versão do cache, resultado dos testes), faça commit e push na ramificação repaginacao-visual.
- Publicar no ambiente de testes conforme a seção 4. Confira no endereço de teste que a versão nova está no ar (versão do cache e uma marca nova do CSS/JS) e informe o endereço para o Samuel abrir no celular.
- Relatar no formato da seção 10 e parar, aguardando a aprovação.
Prints (padrão de todas as fatias): gere por script (Playwright, dados fictícios de npm run demo) e salve em docs/prints/repaginacao/fatia-N/antes e .../depois, com nomes que digam tela, perfil, largura e modo. Conjunto mínimo: paleta navalha, claro e escuro, em 390 px e 1366 px. Acrescente 1100 e 960 px no Caixa e 360 px nas telas de celular. A paleta ganache entra só nas fatias 1 e 5.

Economia de tokens (obrigatória em toda fatia):

- Nunca leia app.js (cerca de 8 mil linhas) nem style.css (cerca de 2,7 mil) inteiros: localize com grep -n e leia só os trechos necessários.
- Não releia um arquivo que você acabou de editar. Agrupe as edições do mesmo arquivo e use scripts (sed, node) para trocas repetitivas, como valores soltos por tokens.
- Abra para olhar no máximo 8 imagens por fatia: de 3 a 5 "depois" de telas-chave e as que levantarem suspeita. Os demais prints só são gerados e salvos, para o Samuel conferir.
- Prefira checagem automática à visual, via Playwright: sem rolagem horizontal (scrollWidth <= clientWidth), sem style=" novo, sem erro no console, contraste calculado por script a partir dos tokens.
- npm test completo só na linha de base e na verificação final; mostre a saída com | tail -n 40 e detalhe apenas o que falhou. No resto, rode só os testes de navegador ligados às telas da fatia.
- Use no máximo uma skill de design por fatia, e só se ela ajudar numa decisão concreta. Evite subagentes para tarefas simples.
- O relatório final tem no máximo 300 palavras e não repete o que já está nos arquivos.
### 8. As cinco fatias e suas tarefas

Cada fatia termina com o relatório da seção 10 e a parada para aprovação. A lista de telas de cada fatia é o mínimo: se encontrar uma tela do perfil que não esteja listada, trate-a na fatia mais próxima e avise no relatório.

#### Fatia 1: Fundação visual e amostra (o Samuel aprova a direção)

- Preparação: crie a ramificação repaginacao-visual. Salve este prompt, na íntegra, em docs/PROMPT-REPAGINACAO.md (as próximas sessões vão lê-lo de lá). Linha de base de testes e prints "antes" das telas de amostra e de uma tela de cada perfil (gerente, caixa, barbeiro).
- Diagnóstico curto: liste, com base nos prints, os problemas visuais atuais (espaço mal aproveitado, inconsistências entre botões, chips, cartões e campos, ícones genéricos, hierarquia de cores fraca). Vai no guia visual.
- Tokens: variáveis centrais no style.css (cores por paleta e modo, tipografia, espaçamento, raios, sombras, durações e curvas de animação). Aplique de forma global e conservadora (cores, tipografia, raios, sombras), para que todas as telas já herdem o novo visual sem ficar quebradas.
- Componentes base: botões (principal, secundário, texto, perigo, ícone), chips e abas, cartões, campos, listas expansíveis (itemExpansivel), janelas (janela*), avisos, estado vazio, cabeçalho de tela.
- Ícones: nova família no ICONES (mesmas chaves, mesma metáfora).
- Animações base (seção 5) e refinamento das 6 paletas nos dois modos, com COR_TOPO.
- Telas de amostra com acabamento completo: Mensagens (gerente), Agenda do dia (barbeiro, celular), Início e uma janela (por exemplo, Novo horário).
- Guia visual: crie docs/guia-visual.md (diagnóstico, tokens, componentes, regras de ícone e animação, o que fazer e evitar).
- Pronto quando: testes iguais à linha de base (nesta fatia, rode todos os testes de navegador, porque os tokens afetam todas as telas); amostras com prints antes/depois; demais telas continuam corretas (confira uma por perfil). Pare e peça ao Samuel que valide a direção no celular. Se ele pedir ajustes, faça-os nesta mesma fatia antes de qualquer outra.
#### Fatia 2: Barbeiro e gerente no celular

Telas: Início e Visão do dia; Agenda (dia em grade, semana, mês, ano); janelas Novo horário, Editar horário, Finalizar, mensagem de WhatsApp e atendimentos sobrepostos; Minha produção; Serviços e Produtos (visão do barbeiro); abas do topo do barbeiro e o menu ☰ do gerente (lateral no celular, grupos que abrem e fecham).

Tarefas: aplicar o sistema visual às telas acima pensando primeiro no celular (390 e 360 px), sem rolagem lateral, com alvos de toque de 44 px, blocos da grade de agenda legíveis (inclusive sobrepostos e de duração personalizada) e animações de menu e janelas. Confira o gerente também a 1366 px. Testes de navegador desta fatia: agenda, e2, inicio-barbeiro e melhorias.

#### Fatia 3: Caixa (computador do balcão e gerente no celular)

Telas: frente de caixa (Vitrine, Comanda, Total e Pagamento), Fila, Lançar atendimento, Lançamentos (Dia e Semana), Movimentações (sangria e suprimento), cadeado de situação, abrir e fechar caixa, Notas em aberto, Hoje/Visão do dia do caixa e histórico.

Tarefas: dar ao Caixa o visual premium nas larguras 1366, 1100, 960 e 390 px. Não pode regredir: topo sempre em uma linha no computador; painéis Vitrine, Comanda e Total com a mesma altura; troca entre Vender e Lançamentos sem pedido ao servidor; "Finalizar venda" mantém a cor dourada ao passar o mouse e ao tocar; cadeado verde/vermelho; nada cortado no celular. Rode os testes de navegador do Caixa (navegador-e3, navegador-melhorias, navegador-financeiro, navegador-agenda).

#### Fatia 4: Restante do gerente/dono

Telas: Clientes (lista, cadastro, lote); Mensagens (completa); Financeiro (Relatório financeiro com suas abas, Lançamentos, Despesas, Notas em aberto, Pagamento da equipe); Catálogo e estoque (Serviços, Produtos e estoque); Equipe (lista, panorama da pessoa); Funcionamento; Meu plano e assinatura; Ajuda (Dúvidas frequentes, Tutoriais, Suporte); Divulgação (a tela de edição, sem alterar a arte dos flyers); e o editor "Minha página" dentro do painel (apenas o visual do editor; a página pública fica para a Etapa 2).

Tarefas: aplicar o sistema visual a todas, no celular (390 px) e no computador (1366 px), aproveitando melhor a largura no computador conforme a regra 6 da seção 3. Testes de navegador desta fatia: equipe, financeiro, ajuda, assinatura, e4 e melhorias.

#### Fatia 5: Polimento e fechamento

- Todas as paletas: confira as 6 paletas × claro e escuro (e "sistema") nas telas-chave de cada perfil; calcule o contraste dos tokens por script e ajuste (mínimo 4,5:1 no texto).
- Acessibilidade: foco por teclado visível, alvos de toque, prefers-reduced-motion.
- Estados: vazio, carregando e erro desenhados em todas as telas que os têm.
- Consistência: ícones, espaçamentos, raios e sombras em todo o painel; remova CSS morto ou duplicado apenas quando tiver certeza (teste e prints antes e depois).
- Tutoriais: as imagens em public/tutoriais/ mostram o visual antigo. Regenere com test/gerar-tutoriais.mjs se o script rodar sem alterar o conteúdo dos tutoriais; se não der, avise no relatório.
- Revisão final: compare antes/depois de todas as telas, finalize o docs/guia-visual.md e liste, no relatório, as sugestões que ficaram de fora por exigirem mudança de fluxo.
### 9. Casos de borda

| Situação | O que fazer |
|---|---|
| Um teste de comportamento falha depois da mudança | É regressão. Corrija o código visual; nunca afrouxe o teste nem mude data-teste. |
| Um teste falha só por seletor de estilo | Ajuste o teste com o menor toque possível e conte no relatório. |
| A melhoria visual pediria mudar texto, ordem de campos, posição de uma ação ou navegação | Não faça. Registre como sugestão no relatório. |
| Você acha um bug de funcionamento (não visual) | Não corrija. Registre no relatório com a tela e o passo para reproduzir. Bug puramente visual pode ser corrigido. |
| A mudança exigiria migração de banco ou mexer em src/ | Pare e pergunte ao Samuel. |
| Não consegue publicar no teste (credencial, rede, erro) | Pare, entregue os prints locais e explique. Não publique em outro lugar. |
| Não tem certeza de qual é a ramificação mais recente | Pergunte antes de criar repaginacao-visual. |
| Uma paleta fica sem contraste em algum modo | Ajuste a paleta; não aceite abaixo de 4,5:1 no texto. |
| O visual novo piora a velocidade ou o uso no celular | Simplifique (menos sombra, menos animação). Desempenho vem antes de enfeite. |
| Uma tela tem conteúdo real longo (nomes grandes, muitos itens) | Teste com dados extremos nos prints: nada pode vazar, sobrepor ou cortar. |
| As instruções deste prompt conflitam com o CLAUDE.md | Para visual e publicação no teste, vale este prompt. Em todo o resto, vale o CLAUDE.md. Em dúvida, pergunte. |
| O Samuel pede um ajuste após ver a fatia | Faça o ajuste na mesma fatia, repita verificação e publicação no teste, e só então pare de novo. |

### 10. Entrega e fim de cada sessão

Ao concluir uma fatia, entregue um relatório curto em português simples (até 300 palavras; o Samuel lê no celular), com estes itens, nesta ordem:

- O que mudou: de 3 a 6 linhas, sem jargão.
- Como ver: o endereço do ambiente de testes e, se for o caso, qual perfil e qual tela abrir.
- Prints antes e depois: caminhos dos arquivos e, se possível, as imagens da amostra.
- Testes: resultado resumido (por exemplo, "210 testes passaram, como antes") e quais testes de navegador rodaram.
- O que NÃO mudou (função preservada): o checklist da seção 7, com qualquer diferença encontrada, mesmo pequena.
- Decisões minhas para você confirmar: escolhas de estética ou de tela que o Samuel pode querer mudar.
- Sugestões que ficaram de fora: melhorias que exigiriam mudar fluxo, texto ou posição de ação, e bugs de funcionamento encontrados.
- Versão publicada no teste: versão do cache e identificação da publicação.
- Próximo passo: a frase "Aguardando sua aprovação para a fatia N+1" (ou, na fatia 5, "Aguardando sua aprovação final; nada foi publicado na versão oficial").
Nunca afirme que algo foi testado ou publicado sem mostrar a evidência (saída dos testes, print, versão conferida no ar).

Fim da sessão: depois do relatório, pare. Não comece a fatia seguinte, não publique na versão oficial e não abra pull request sem o Samuel pedir.

