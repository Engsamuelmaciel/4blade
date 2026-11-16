# 4blade — Especificação (proposta aprovada)

Versão 4 (final) · 15/11/2026 · nome: **4blade** (domínios 4blade.com.br e forblade.com.br, a conferir) · repositório `4blade`

## 1. Problema e objetivo
Barbearias pequenas controlam agenda, caixa, comissões e estoque em caderno, planilha ou em sistemas focados só em agendamento. Resultado: caixa que não bate, comissão calculada na mão, produto que some, conta paga atrasada e o dono sem saber se teve lucro.

**Objetivo:** um sistema simples, no celular, em que o atendimento finalizado já vira entrada no caixa, comissão e baixa de estoque — sem digitar duas vezes — e o gerente enxerga o dia num painel visual.

**Produto para vender a várias barbearias** (cada uma vê só os seus dados).

## 2. Perfis e permissões
| Perfil | Quem cria | O que faz |
|---|---|---|
| Plataforma (nós) | — | Ativa/bloqueia barbearias, cria o 1º acesso (proprietário), suporte. |
| Proprietário | Plataforma | Tudo o que o gerente faz + cria/desativa gerentes. |
| Gerente | Proprietário | Tudo na barbearia: cadastros, preços, comissões, agenda de todos, caixa, estoque, contas a pagar, painel, relatórios. Tem a própria agenda. |
| Barbeiro | Proprietário/gerente | Só a própria agenda, os próprios atendimentos (valor bruto + sua comissão) e o próprio desempenho. Vê produtos (nome, preço, disponível) sem custo/margem. |
| Caixa | Proprietário/gerente | Ao entrar abre direto a tela do caixa: acompanha entradas, vende produtos, sangria/suprimento, corrige forma de pagamento, fecha o caixa. NÃO vê comissões, painel, custos nem margens. |

Regras gerais: login com usuário e senha, troca obrigatória no 1º acesso, limite de tentativas, nada é apagado (desativar/cancelar com motivo), tudo auditado (quem, quando, antes/depois).

## 3. Cadastros (gerente)
- **Serviços:** nome, preço de tabela, duração (para a agenda), ativo.
- **Produtos:** nome, código (opcional, aceita código de barras), preço de venda, validade (opcional), estoque mínimo, "mostrar no site" (usado no Plano Profissional). Custo vem da entrada de mercadoria (custo médio). Margem = (preço − custo) ÷ preço, exibida ao gerente.
- **Colaboradores:** nome, perfil, telefone, % de comissão em serviços e % em produtos (por barbeiro), horário de trabalho.
- **Clientes:** nome, telefone (obrigatório para mensagem), observação, aceite LGPD; histórico de atendimentos.
- **Modelos de mensagem:** "Lembrete" e "Proposta de horário", editáveis, com campos {cliente} {data} {hora} {barbeiro} {servico} {barbearia}.

## 4. Fluxos
### 4.1 Agenda
- Barbeiro agenda na própria agenda; gerente agenda em qualquer uma. Cliente não agenda sozinho (fase 2).
- Visão dia/semana por barbeiro; gerente vê todos lado a lado.
- Não permite dois horários sobrepostos para o mesmo barbeiro, nem horário fora do funcionamento (4.9) ou em bloqueio.
- **Bloqueios na agenda** (almoço, folga, férias, compromisso): o barbeiro bloqueia na própria agenda; o gerente em qualquer uma. Com motivo opcional.
- **Cliente sempre identificado, sem tela separada:** ao marcar, digita o telefone → se já existe, preenche; se não, informa o nome e o cadastro nasce ali (aceite LGPD). Cliente que chega na hora é marcado/finalizado do mesmo jeito.
- Situações: agendado → finalizado | faltou | cancelado (com motivo).
- **Botões de mensagem** em cada horário: "Enviar lembrete" e "Propor horário". Abre o WhatsApp do aparelho (link wa.me) com o texto do modelo já preenchido; a pessoa só toca em enviar. O envio fica registrado (quem, quando, qual modelo). Sem envio automático.
  - Para sair do número da barbearia, o aparelho precisa estar com o WhatsApp da barbearia (WhatsApp Business permite vários aparelhos). Vai no manual.

### 4.2 Finalizar atendimento (barbeiro ou gerente)
1. Escolhe o(s) serviço(s); o valor vem do preço de tabela e PODE ser alterado.
2. Alteração de valor fica registrada (tabela, cobrado, quem, quando) e aparece destacada para o gerente.
3. Informa a forma de pagamento (dinheiro, Pix, débito, crédito) — **até 2 formas no mesmo atendimento** (ex.: parte Pix, parte dinheiro; a soma tem de bater com o valor).
4. Ao confirmar: entra na hora no caixa do dia com o **valor bruto**; a comissão é calculada e guardada à parte (visível só ao barbeiro dono e ao gerente).
- Exige caixa do dia aberto (se fechado, avisa "peça para abrir o caixa").
- **Reabrir atendimento finalizado por engano:** o próprio barbeiro (só os dele) ou o gerente, enquanto o caixa do dia estiver aberto. Estorna a entrada e a comissão, volta para "agendado" e fica registrado (quem, quando, motivo). Refinalizado com valor diferente → aparece destacado ao gerente. Caixa já fechado: só o gerente, reabrindo o caixa com motivo.

### 4.3 Caixa (caixa, gerente, proprietário)
- **Abertura** com valor inicial (troco).
- Durante o dia: lista em tempo real de atendimentos (valor bruto) e vendas; **venda avulsa de produto** (baixa estoque); **sangria** (retirada) e **suprimento** (reforço) com motivo; **corrigir forma de pagamento** antes do fechamento (registrado).
- **Fechamento:** todos os atendimentos e vendas do dia; totais por forma de pagamento; sangrias/suprimentos; dinheiro esperado × contado → diferença (sobra/falta) com observação. Fechado não muda; só gerente reabre com motivo.
- Gerente vê o histórico de caixas de outros dias.

### 4.4 Estoque
- Venda (avulsa ou junto ao atendimento) abate automaticamente; cancelamento devolve.
- Entrada de mercadoria: quantidade, custo unitário, fornecedor, validade → recalcula custo médio.
- Ajustes com motivo obrigatório: perda, vencimento, quebra, uso interno.
- Venda sem saldo: **bloqueada** ("estoque insuficiente, peça ao gerente para ajustar").
- Avisos: abaixo do mínimo ("repor") e validade a 30 dias ("vencendo").
- Inventário: gerente digita o contado, sistema mostra diferença e ajusta com motivo.
- Histórico por produto (entradas, vendas, ajustes).

### 4.5 Comissões e vales
- Comissão = valor bruto do atendimento × % do barbeiro (serviço); produto vendido pelo barbeiro × % de produto.
- Taxa da maquininha **não** é descontada (fase 1).
- Vales (adiantamentos) lançados pelo gerente.
- **Fechamento de comissão:** gerente escolhe o período (semana/quinzena/mês) e fecha: total de comissões − vales = a pagar. Fechado não muda.

### 4.6 Contas a pagar (gerente)
- Descrição, categoria (aluguel, luz, água, fornecedor, outros), valor, vencimento, recorrente mensal (sim/não), pago (data).
- "Pago com dinheiro do caixa" → vira sangria do caixa aberto.

### 4.7 Painel do gerente (visual, simples)
Filtro: Hoje · Semana · Mês.
- Cartões: faturamento bruto; atendimentos (qtd + ticket médio); vendas de produtos; comissões (total e por barbeiro); **lucro** (dia/semana: bruto − comissões − custo dos produtos vendidos; mês: também − contas pagas); contas a pagar (atrasadas vermelho, hoje amarelo, 7 dias).
- Gráficos: faturamento por dia (7/30 dias); ranking de barbeiros.
- Avisos: estoque baixo, produto vencendo, diferença no caixa, valores alterados, caixa ainda aberto de dia anterior.

### 4.8 Desempenho do barbeiro
Só dele: atendimentos, faturamento bruto, comissão do período, vales, próximo fechamento.

### 4.9 Funcionamento da barbearia (aba simples, gerente)
- **Dias e horários da semana:** para cada dia, aberto/fechado, abre às, fecha às, intervalo opcional (ex.: almoço 12h–13h).
- **Datas fechadas:** feriados, folga coletiva, reforma — data (ou período) + motivo. A agenda e o site não oferecem horário nesses dias.
- **Fechar a agenda de um dia ou período** já com horários marcados: avisa quantos atendimentos existem e lista para remarcar (com botão de mensagem ao cliente); não cancela sozinho.
- O horário de cada barbeiro fica DENTRO do funcionamento (não pode trabalhar com a barbearia fechada).

### 4.10 Enviar ao contador (gerente e proprietário; os dois planos)
- Botão **"Enviar ao contador"** → período: mês ou ano → gera **PDF** (resumo para ler) + **planilha CSV** (ponto e vírgula, abre no Excel) → no celular abre o **Compartilhar** (WhatsApp, e-mail…); no computador baixa os arquivos.
- Contato do contador (nome, WhatsApp, e-mail) salvo nas configurações.
- Conteúdo: entradas (serviços e produtos, por forma de pagamento); saídas (contas pagas por categoria, compras de mercadoria, sangrias); comissões por barbeiro, vales e valor pago; resultado do período; **separação cota-parte da barbearia × cota-parte dos barbeiros** (Lei 13.352/2016, Salão-Parceiro — o contador confirma se a barbearia usa); estoque no fim do período (quantidade e valor); diferenças de caixa; lista detalhada de todos os lançamentos.
- Cada envio fica registrado; se um lançamento do período mudar depois, aviso "houve alteração depois do envio ao contador; gere de novo".
- Não é nota fiscal.
- **Extrato do barbeiro:** cada barbeiro baixa o próprio extrato mensal (atendimentos, comissões, vales) — útil para quem é MEI.

### 4.11 Cópia dos dados
- Proprietário/gerente baixa TODOS os dados da barbearia em planilhas (clientes, atendimentos, caixa, estoque, contas, comissões) quando quiser.

### 4.12 Site da barbearia (Plano Profissional — fase 2)
Página pública, sem login e sem baixar aplicativo, sincronizada com o sistema. **Tudo termina no WhatsApp da barbearia** (link wa.me com mensagem pronta; sem custo por mensagem).
- **Endereço:** domínio próprio (ex.: `barbeariadojoao.com.br`) ou `4blade.com.br/barbearia-do-joao`. Divulgado no WhatsApp, Instagram e QR code no balcão.
- **Conteúdo:** logo, foto de capa, endereço com botão "Como chegar" (link do mapa), horário de funcionamento, serviços com preços (da tabela), barbeiros, produtos.
- **Horários livres:** gerados da agenda (horário de trabalho de cada barbeiro − horários ocupados − pendentes), por duração do serviço escolhido. Cliente escolhe um barbeiro ou "qualquer um". O site mostra só livre/ocupado — **nunca nome de cliente**.
- **Pedir horário:** cliente toca no horário → informa nome e telefone (aceite LGPD) → o horário fica **PENDENTE por 30 minutos** (some do site) → abre o WhatsApp da barbearia com a mensagem pronta (ex.: "Olá! Quero agendar Corte + Barba com o Pedro, sábado 22/11 às 14h. Nome: …").
  - Na agenda o pendente aparece destacado e o **gerente** (ou o barbeiro do horário) toca em **Confirmar** (vira agendamento, cliente cadastrado/encontrado pelo telefone) ou **Recusar**. Sem confirmação em 30 min, o horário volta a ficar livre sozinho.
  - Antecedência mínima, dias à frente, barbeiros visíveis e pausa do site: configurados pelo gerente.
  - Proteção contra abuso: limite de pedidos por telefone/dia e por aparelho, verificação anti-robô.
- **Produtos:** aparecem os marcados "mostrar no site" COM estoque, com foto, nome e preço (sincronizados); esgotou, some. Botão **Comprar** → WhatsApp com "Quero comprar: Pomada X — R$ 45,00". **Só retirada na barbearia**; a venda é registrada no caixa na retirada (aí baixa o estoque). Sem reserva de estoque.
- **Fotos:** logo, capa e 1 por produto; tipo conferido pelo conteúdo, tamanho limitado, reduzidas no envio.
- **Domínio:** nós registramos e configuramos tudo; fica **no CPF/CNPJ do cliente** (ele é o dono), nós como contato técnico; custo repassado. Tecnicamente: Cloudflare for SaaS (domínios personalizados apontando para o mesmo sistema).
- Plano Básico não tem site; continua com os botões manuais de mensagem na agenda.

## 5. Escopo por fase
- **Fase 1 = Plano Básico:** tudo das seções 2 a 4.11 (o site, 4.12, é da fase 2). Equipe do Básico: **proprietário + 1 gerente + 3 barbeiros + 1 caixa** (o gerente também atende). O sistema já nasce com o campo "plano" na barbearia e recusa usuário acima do limite.
- **Fase 2 = Plano Profissional:** site da barbearia (seção 4.12) — E5: horários livres, pedido pendente e confirmação na agenda, serviços, preços, localização; E6: vitrine de produtos com fotos e domínio próprio — **proprietário + até 2 gerentes + 10 barbeiros + 2 caixas** (+ barbeiros adicionais). Depois: lembrete automático (API do WhatsApp, pago), relatórios avançados, taxa de maquininha opcional na comissão, cobrança da assinatura dentro do sistema.
- **Fase 3:** várias unidades por dono, clube de assinatura (corte mensal), fidelidade, emissão de nota fiscal.

## 6. Sistema e tecnologia
- **Projeto novo**, repositório próprio (a criar pelo responsável).
- Padrão da casa: Cloudflare Workers (API) + D1 (banco SQL, migrações versionadas) + tela web instalável no celular (PWA, JavaScript simples), CSP rígida.
- **Multi-empresa desde o dia 1:** toda tabela tem `barbearia_id`; o servidor filtra sempre pela barbearia da sessão (nunca pelo que vem da tela).
- **Reaproveitar do FrotaZ** (cópia em `referencia/frotaz/`): login, sessão, senha, limite de tentativas, auditoria, utilitários, testes com D1 local, service worker e estilo base.
- Dinheiro sempre em **centavos (inteiro)** no banco; nunca número com vírgula.
- Fuso: America/Sao_Paulo para "dia" do caixa e da agenda.

## 7. Estratégia de implementação (4 entregas, cada uma funcionando de ponta a ponta)
| Entrega | Conteúdo | Pronto quando |
|---|---|---|
| E1 Base | Repositório, multi-empresa, painel da plataforma, login/perfis, cadastros (serviços, produtos, colaboradores, clientes, modelos de mensagem) | Plataforma cria barbearia; proprietário cria usuários; cada perfil vê só o que deve; isolamento entre barbearias testado |
| E2 Agenda | Funcionamento da barbearia, bloqueios, agenda, cliente identificado na marcação, mensagens WhatsApp, reabrir atendimento, 2 formas de pagamento, finalizar atendimento (valor alterado registrado), abertura de caixa mínima | Barbeiro agenda, envia mensagem, finaliza; entrada aparece no caixa com valor bruto |
| E3 Caixa e estoque | Caixa completo e fechamento, vendas avulsas, estoque (entrada, ajustes, inventário, avisos) | Dia completo simulado fecha com diferença correta; estoque bate |
| E4 Gestão | Comissões, vales e fechamento; contas a pagar; painel do gerente; desempenho do barbeiro; Enviar ao contador; extrato do barbeiro; cópia dos dados | Painel mostra números conferidos à mão num dia simulado |
| E5 Site — horários (fase 2) | Página pública: serviços, preços, localização, horários livres, pedido pendente 30 min + WhatsApp, confirmar/recusar na agenda | Cliente pede pelo site, horário some, barbeiro confirma com 1 toque; sem confirmar, volta livre |
| E6 Site — produtos e domínio (fase 2) | Vitrine com fotos sincronizada ao estoque, Comprar → WhatsApp, logo/capa, domínio próprio | Produto entra no estoque e aparece; esgota e some; domínio de teste funcionando |

Cada entrega: testes automáticos + teste no navegador (computador 1366 px e celular 390 px) + prints na entrega + ramificação própria para avaliação.

## 8. Riscos e decisões em aberto
- **Concorrência forte em agendamento online**: o Básico vende "caixa e comissão sem erro"; o Profissional compete com o site sincronizado + pedido pelo WhatsApp + domínio próprio (o cliente da barbearia já está no WhatsApp; não precisa criar conta).
- O Profissional só pode ser vendido depois da fase 2 pronta.
- WhatsApp manual depende do aparelho estar com o número da barbearia.
- LGPD: telefone de cliente é dado pessoal — aceite e uso só para atendimento.
- Nota fiscal fora da fase 1 (muitas barbearias são MEI).
- Cobrança das assinaturas na fase 1 é fora do sistema (link de pagamento/boleto recorrente).
- Nome e domínio a conferir (INPI e registro.br).

## 9. Nome — DEFINIDO: 4blade
- "for blade" = para a lâmina/navalha, símbolo do barbeiro. Família com o 4trucker.
- "4cut/forcut" descartado: já existe sistema para barbearias com o nome forcut.
- Busca na web (15/11/2026) não achou "4blade" nem "forblade" em barbearia. A conferir: domínios 4blade.com.br e forblade.com.br (registrar os dois, um redirecionando) e marca no INPI (classe 42, software).
- Nomes técnicos em minúsculas: repositório e Worker `4blade`.

## 10. Ajustes pedidos pelo responsável após a fase 1 (16/11/2026)
- **Menu lateral por categorias** (Visão geral; Atendimento = agenda, caixa, clientes e mensagens; Financeiro; Catálogo e estoque; Equipe e ajustes; cada perfil vê só as suas). Tocar na categoria abre as opções; escolher uma fecha o menu (celular) e a tela ocupa a página toda. No computador o menu fica fixo à esquerda.
- **Visual mais compacto e moderno** (menos rolagem); painel do gestor sem espaços vazios.
- **Agenda em Dia, Semana, Mês e Ano.** Mês: calendário com a cor de cada dia — verde = horários livres, laranja = poucos horários (menos de 1/3 livre), vermelho = agenda cheia (não cabe nem o serviço mais curto), cinza = fechado/folga — e quantas vagas sobram. Ano: 12 mini calendários com as mesmas cores; tocar abre o mês, tocar no dia abre o dia.
- **Horário fixo (recorrência):** ao marcar, "Repetir" toda semana ou a cada 2, 3 ou 4 semanas, até uma data (no máximo 6 meses). Datas sem vaga (ocupado, fechado, folga, bloqueio) ficam de fora e aparecem numa lista. O horário mostra o selo "Fixo". Ao cancelar dá para cancelar só aquele dia ou aquele e os próximos (encerra a série, com motivo).
- **Caixa como frente de caixa (PDV):** abas Cobrar (fila dos atendimentos de hoje para cobrar + "Atendimento sem horário" para quem chegou sem marcar), Vender (produtos em botões + carrinho) e Lançamentos. O caixa não vê comissão. Atendimento sem horário fica registrado na agenda do profissional na hora atual.
- **Telefone opcional ao marcar** (agenda e "Atendimento sem horário"): sem telefone, informa-se o nome (no caixa, nem o nome é obrigatório: sem nada, fica "Cliente não identificado"); o mesmo nome sem telefone é o mesmo cliente; não há WhatsApp para ele (botões somem). O cliente pode ganhar telefone depois em Clientes. Telefone digitado errado continua recusado. No banco, o cliente sem telefone guarda o marcador `sem:<id>` (a coluna é obrigatória e única; nada muda na estrutura).
- **Marca e carregamento:** tela de entrada com a logo e a frase "Gestão afiada para sua barbearia."; ao abrir o app, tela escura com a logo e a frase; ao carregar telas, o símbolo da navalha com anel dourado girando (só aparece se a espera passar de 0,25 s).
- **Hora digitada** (09:30) em todos os campos de hora, com teclado numérico: substitui o relógio do celular, que em telas com letra grande ficava cortado (botão "Definir" fora da tela). "930" vira 09:30; "9" vira 09:00.
- **Estoque no cadastro do produto:** "Quantidade em estoque" e "Custo unitário" (opcionais) no produto novo; gravados junto com o produto como uma entrada de mercadoria (custo médio, histórico e auditoria iguais aos da tela Estoque).
- **Topo no estilo 4trucker:** logo (navalha + "blade") à esquerda, linha dourada embaixo e botão "Minha conta" (nome, perfil, barbearia, plano e "Sair do sistema").
- **Editar conta a pagar:** em aberto muda descrição, categoria, valor, vencimento e recorrência; paga muda só descrição e categoria; cancelada não muda. Tudo auditado (antes/depois).

