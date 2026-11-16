# 4blade — contexto do projeto

App de gestão para barbearias, vendido por assinatura para várias barbearias (multi-empresa). Responder sempre em português do Brasil; o responsável não é programador e usa principalmente celular: explicar em linguagem simples.

**Fonte da verdade:** `docs/ESPECIFICACAO.md` (perfis, regras, fluxos, fases e entregas). Preço e custos: `docs/PRECIFICACAO.md`. Prompts de cada entrega: `docs/PROMPTS.md`. Em dúvida, siga a especificação; se ela não responder, pergunte antes de inventar regra.

## Regras de trabalho
1. Nunca afirmar que algo foi testado/publicado sem evidência (saída de teste, print).
2. Pedir confirmação ANTES de: migração no banco real, criar/alterar segredos, apagar algo, publicar (deploy), criar recursos na Cloudflare.
3. Nada de senhas, tokens ou nomes/telefones reais no repositório. Dados de teste são fictícios.
4. Banco evolui só por migrações versionadas (`migrations/`), sem apagar dados. Nada é apagado na aplicação: desativar/cancelar com motivo; tudo auditado (quem, quando, antes/depois).
5. Uma entrega por vez (E1, E2…), na ramificação designada, com testes automáticos + teste no navegador (1366 px e celular 390 px) + prints. Atualizar este arquivo ao fim de cada entrega (seção "Estado").

## Padrão técnico
- Cloudflare Workers (API) + D1 (banco) + tela web instalável (PWA, JavaScript sem framework). Arquivos (fotos, fase 2): KV ou R2.
- **Multi-empresa:** toda tabela de dados tem `barbearia_id`; o servidor SEMPRE filtra pela barbearia da sessão, nunca pelo que vem da tela. Teste de isolamento obrigatório em toda rota nova.
- **Plano** na barbearia (`basico` | `profissional`); limites de usuários por perfil conferidos no servidor (ver especificação).
- Dinheiro em centavos (inteiro). Fuso America/Sao_Paulo.
- Reaproveitar a base do FrotaZ, já copiada em `referencia/frotaz/` (ver o LEIAME de lá; não acessar outro repositório): login/senha/sessão/limite de tentativas/auditoria (`src/index.js`, `src/util.js`, `migrations/0001_base.sql`), testes com D1 local (`test/d1-local.js`, `test/ambiente.js`), service worker e estilo base. Não copiar nada de frota.
- WhatsApp sempre por link `wa.me` com mensagem pronta (sem API paga).

## Convenções da tela (herdadas do FrotaZ)
- Política de segurança (CSP): nada de `style="…"` no HTML; cor/forma por classe no CSS (SVG usa atributos).
- `replaceChildren(...)` com `null` insere o texto "null": filtrar com `.filter(Boolean)`.
- Botão novo com ícone por máscara de SVG precisa da regra de ícone no CSS (senão vira quadrado cheio); conferir no celular e no computador.

## Estado
- 15/11/2026: especificação aprovada (versão 4).
- 16/11/2026: **E1 (Base) pronta** na ramificação `e1-base` (aprovada pelo responsável).
  - Banco: `migrations/0001_base.sql` (barbearias com `plano`, usuarios, sessoes, limites_acesso, auditoria, servicos, produtos, clientes, modelos_mensagem). Comissão em centésimos de % (`*_bp`, 4000 = 40%).
  - API: `src/index.js` (login, sessão 12 h, 5 tentativas/15 min, troca obrigatória), `src/plataforma.js`, `src/usuarios.js` (equipe + limite por plano), `src/cadastros.js`, `src/perfis.js` (limites e quem gerencia quem), `src/util.js`.
  - Usuários = colaboradores; login único no sistema todo; senha provisória gerada pelo servidor (mostrada 1 vez). 1º usuário da plataforma: `POST /api/setup/plataforma` com o segredo `ADMIN_SETUP_TOKEN`.
  - Tela: `public/` (index.html, app.js, style.css, sw.js, manifest, ícones). Caixa abre em `#/caixa` (em construção).
  - Testes: `npm test` (44 automáticos) e `node test/navegador-e1.mjs` (Playwright, 1366 e 390 px; prints em `docs/prints/e1/`). Tela local: `npm run tela` (usuário `suporte`, senha `Nova-suporte-senha`).
  - Deixado para a E2: horário de trabalho do colaborador (depende do funcionamento, 4.9); busca de cliente pelo barbeiro na marcação. Estoque/custo médio: E3 (barbeiro e caixa veem "disponível" = produto ativo por enquanto).
  - `wrangler.toml` com ids MARCADORES: nada criado na Cloudflare, nenhum deploy.
- 16/11/2026: **E2 (Agenda e finalização) pronta** na ramificação `e2-agenda` (criada a partir da `e1-base`); o responsável mandou seguir.
  - Banco: `migrations/0002_agenda.sql` (funcionamento, datas_fechadas, horario_trabalho, bloqueios, agendamentos, agendamento_servicos, caixas, finalizacoes, finalizacao_itens, caixa_lancamentos, comissoes, mensagens_enviadas). Horas em minutos; início/fim de horário em texto local `AAAA-MM-DDTHH:MM`.
  - API: `src/funcionamento.js` (funcionamento, datas fechadas com lista para remarcar, horário de trabalho), `src/agenda.js` (agenda, marcar, faltou/cancelado, mensagem wa.me registrada, finalizar, reabrir, bloqueios), `src/caixa.js` (abrir caixa + entradas do dia), `src/agenda-util.js`.
  - Gravações críticas em um só lote com condição (sem sobreposição por corrida; finalização só com caixa aberto; no máximo 1 finalização válida por horário — índice único). Reabrir = estorno (lançamento negativo + comissão estornada), nada apagado.
  - Valor alterado: item com cobrado ≠ tabela OU refinalização com total diferente do anterior → destacado só para a gestão.
  - Regras que decidi (confirmar com o responsável): sem funcionamento cadastrado a agenda não aceita horário; bloqueio por cima de horário marcado é recusado; finalizar só horários de hoje ou anteriores (a entrada vai para o caixa de hoje); "Propor horário" usa a data/hora do próprio horário; proprietário não tem agenda própria (só gerente e barbeiro).
  - Pendente para a E3: fechar/reabrir caixa (o gerente reabrir atendimento com caixa fechado depende disso), sangria, suprimento, vendas.
  - Testes: `npm test` (61) + `node test/navegador-e1.mjs` e `node test/navegador-e2.mjs` (prints em `docs/prints/e1/` e `docs/prints/e2/`).
- 16/11/2026: **E3 (Caixa e estoque) pronta** na ramificação `e3-caixa-estoque` (a partir da `e2-agenda`); o responsável mandou seguir.
  - Banco: `migrations/0003_caixa_estoque.sql` (só tabelas novas): produto_estoque (saldo com CHECK ≥ 0), estoque_movimentos, vendas, venda_itens, caixa_movimentos (venda, estorno_venda, sangria, suprimento, correcao_saida/entrada), caixa_fechamentos.
  - API: `src/caixa.js` (resumo, sangria/suprimento, corrigir forma, fechar, reabrir, histórico/dia), `src/estoque.js` (estoque, entrada com custo médio, ajuste, inventário, histórico, vendas e cancelamento).
  - Correção de forma = par de movimentos (sai da forma antiga, entra na nova) ligado ao lançamento; estornos usam a forma ATUAL (`formaEfetiva`).
  - Dinheiro esperado = troco + entradas em dinheiro + suprimentos − sangrias. Diferença ≠ 0 exige observação. Fechado não muda; só gestão reabre (com motivo).
  - Venda guarda vendedor (barbeiro) e custo unitário do momento — base para comissão de produto e lucro na E4. Barbeiro vende em seu nome (botão no horário da agenda).
  - Regras que decidi (confirmar): sangria não pode passar do dinheiro na gaveta; preço do produto na venda é o de tabela (sem alterar); "repor" quando saldo < mínimo; validade do produto = a mais próxima entre a atual e a da nova entrada.
  - Testes: `npm test` (72, inclui o dia simulado conferido à mão) + navegador E1, E2 e E3. Demonstração local: `npm run demo` (senha dos usuários *.demo: `Demo-4blade-2026`).
- 16/11/2026: **E4 (Gestão) pronta** na ramificação `e4-gestao` (a partir da `e3-caixa-estoque`), aguardando avaliação. **Fase 1 (E1–E4) completa.** Versão de teste publicada (ver abaixo). Logo oficial aplicada (docs/logo-4blade-original.jpg). Próximo: avaliação; depois fase 2 (E5).
  - Banco: `migrations/0004_gestao.sql` (só tabelas novas): comissoes_produto, vales, fechamentos_comissao + fechamento_comissao_itens (UNIQUE: cada comissão/vale entra em um só fechamento), contas, configuracoes (contato do contador), envios_contador.
  - API: `src/gestao.js` (comissões/prévia/fechamento/pagamento, vales, contas, painel, desempenho, extrato), `src/contador.js` (relatório, envio com impressão digital, envios com aviso de alteração, contato, exportar CSV), `src/pdf.js` (PDF sem biblioteca, Helvetica/WinAnsi), `src/csv.js` (ponto e vírgula, BOM, vírgula decimal, proteção contra fórmula).
  - Dia de cada lançamento = dia do caixa. Painel: hoje; semana = hoje e 6 dias antes; mês = dia 1º até hoje. Lucro dia/semana = bruto − comissões − custo dos produtos vendidos (custo guardado na venda); mês = também − contas pagas (pelo dia do pagamento).
  - Comissão de produto: gravada na venda para gerente/barbeiro (% de produto dele); estornada se a venda for cancelada. Venda registrada pelo caixa sem vendedor não gera comissão.
  - Fechado não muda: não dá para reabrir atendimento, cancelar venda ou cancelar/lançar vale que já entrou (ou cairia) num fechamento de comissão; período sobreposto é recusado.
  - Conta recorrente paga gera a do mês seguinte (31 → último dia do mês). "Pago com dinheiro do caixa" (conta ou comissão) = sangria no caixa de hoje (exige caixa aberto e dinheiro suficiente).
  - Contador: entradas por forma (serviços × produtos), saídas (contas por categoria, compras de mercadoria, sangrias avulsas), comissões/vales/pago, resultado, cota-parte (barbearia = bruto − comissões; profissionais = comissões — o contador confirma se usa a Lei 13.352), estoque no fim (saldo × custo médio atual), diferenças de caixa e lista detalhada. Aviso de alteração: compara a impressão digital (recalcula até 2 períodos por consulta).
  - Regras que decidi (confirmar): vale não sai do caixa (só registro) — a comissão paga pode sair; ranking por faturamento em atendimentos; extrato do barbeiro mostra só o primeiro nome do cliente.
  - Testes: `npm test` (78, inclui a semana simulada conferida à mão) + navegador E1–E4. `npm run demo` sobe com a demonstração e com a semana simulada (`*.semana`, senha `Senha-Semana-2026`).
- 16/11/2026: **Melhorias de layout** na ramificação `melhorias-layout` (a partir da `e4-gestao`), pedidas pelo responsável (ver ESPECIFICACAO.md seção 10).
  - Banco: `migrations/0005_recorrencia.sql` (agendamento_series, agendamento_serie_itens) `0006_descontos.sql` (venda_descontos), `0007_mensagens_livres.sql`, `0008_promissorias.sql`, `0009_clientes_excluidos.sql` e `0010_mensagens_confirmacao_contatos.sql`.
  - API: `marcar` aceita `repetir {intervaloSemanas, ate}`; cancelar com `serie: true`; `GET /agenda/ocupacao` (livre/poucos/cheio/fechado por dia); caixa: `GET /caixa/atendimentos`, `POST /caixa/cobrar`, `POST /caixa/atendimento-avulso`.
  - Tela: menu lateral por categorias (`montarMenu`), agenda Mês/Ano, PDV do caixa (abas Cobrar/Vender/Lançamentos), CSS refeito e compacto. `body[data-carregando]` marca tela sendo montada (usado pelos testes); `test/navegacao.mjs` (`ir`) navega pelo menu.
  - Depois: Mensagens no grupo Atendimento; celular com barras na largura toda e Lucro em 2 colunas; tela de entrada com logo + frase "Gestão afiada para sua barbearia."; carregando com a marca (`comCarga`, `#carregador`); telefone OPCIONAL ao marcar (no caixa até o nome é opcional → "Cliente não identificado"; cliente sem telefone = marcador `sem:<id>` na coluna `telefone`; `telefoneReal()` em agenda-util devolve null para a tela, CSV e WhatsApp).
  - Depois (2): hora digitada (`mascaraHora`: todo `type=time` vira texto 00:00 em `aplicarMascaras`); produto novo com `estoqueInicial {quantidade, custoUnitCentavos}` (mesmo lote, `comandosEntrada` em estoque.js); topo com logo + "Minha conta" (`#btn-conta` abre a janela com `#btn-sair`); `POST /contas/alterar` (aberta: tudo; paga: descrição/categoria).
  - Depois (3): caixa = recepção (`veTodasAgendas` em perfis.js; na tela `veTodas()`/`ehCaixa()`): agenda de todos, marca para qualquer profissional (precisa escolher), falta/cancelar/WhatsApp; sem bloqueio/reabrir/finalizar pela agenda; clientes (sem desativar), mensagens e catálogo (consulta).
  - Depois (4): desconto em % na venda (`migrations/0006_descontos.sql`: venda_descontos; `vendas.total_centavos` = valor FINAL; `descontoBp` no POST /vendas; comissão de produto sobre o final).
  - Depois (5): aparência (`public/tema.js` carregado antes do CSS; `html[data-paleta]` navalha|oceano|esmeralda|bordo e `html[data-tema]` claro|escuro; preferência em localStorage `4blade.aparencia`; cores só por variáveis CSS — não usar cor fixa nova; logos com fundo transparente). Mensagem livre: `src/mensagens.js` (`GET /mensagens/clientes-do-dia`, `POST /mensagens/envios` → links wa.me personalizados, `POST /mensagens/envios/aberto`), `migrations/0007_mensagens_livres.sql`.
  - Depois (6): `GET /agenda/disponibilidade` (situação, ocupados, livres pela duração) → painel no Novo horário e resumo por profissional na agenda Dia; `GET /agenda/clientes?busca=` + marcar com `cliente: {id}` (`seletorCliente` na tela); promissória: forma `promissoria` (`lerPagamentos(..., {promissoria:true})`, não vai para caixa_lancamentos/caixa_movimentos), `migrations/0008_promissorias.sql` (promissorias, promissoria_recebimentos, promissoria_pagamentos), `src/promissorias.js` (listar, recebimentos, receber, estornar-recebimento), tela `#/notas`; topo do caixa com um cartão por forma.
  - Depois (7): livres de hora em hora; `POST /promissorias/cancelar` (só gestão; situação 'estornada' com "Cancelada pelo gerente: …"), `GET /promissorias/historico?situacao=pagas|canceladas`; reabrir/cancelar venda com nota em aberto só gestão; troco (`campoTroco`) em `blocoPagamento` e `janelaFinalizar`.
  - Depois (8): `POST /agenda/remarcar` (mesma duração; UPDATE com condição de conflito/bloqueio; caixa e gestão qualquer, barbeiro só o dele); caixa cobra horários de hoje ou dos 7 dias anteriores (`GET /caixa/atendimentos` traz `data`/`atrasado`; cobrar futuro → 403); botão "Concluir atendimento" (`janelaConcluir`) no caixa.
  - Depois (9): excluir cliente = `POST /clientes/excluir` (motivo; `migrations/0009_clientes_excluidos.sql`; ativo=0, telefone vira `sem:<id>`, original guardado; listas/busca filtram excluídos; caixa só sem histórico; nota aberta bloqueia).
  - Depois (10): `migrations/0010_mensagens_confirmacao_contatos.sql` (modelos_mensagem_adicionais, mensagens_enviadas_adicionais, mensagens_livres_contatos — as tabelas antigas têm CHECK lembrete/proposta); modelo `confirmacao` (`MODELOS_ADICIONAIS_PADRAO` em agenda-util; `carregarModelos` junta tudo); marcar devolve `whatsappConfirmacao`; `GET /mensagens/contatos` e `POST /mensagens/envios` com `clienteIds`; fila com "Abrir o próximo".
  - Depois (11): Mensagens com quadro único de modelos (`#modelo-escolha`, `#texto-<tipo>`) e "Escolher uma mensagem pronta" (`#env-modelo`: modelos da agenda só no modo do dia + `MENSAGENS_PRONTAS` nos dois); ícones `icons/icon-v2-*.png`, `icon-v2-maskable-*.png`, `apple-touch-icon-v2.png`, `favicon-v2.png` (cache do sw `4blade-v10`).
  - Testes: `npm test` (99) + `npm run teste-navegador` (E1–E4 + `test/navegador-melhorias.mjs`; prints em `docs/prints/melhorias/`).

- 16/11/2026: **Planos novos e assinatura on-line (Asaas)** na ramificação `planos-assinatura` (a partir da `melhorias-layout`), ESPECIFICACAO.md seção 11. NÃO publicada ainda.
  - Planos: `PLANOS` em `src/perfis.js` (basico 2 / standard 4 / pro 10 barbeiros; gerente e caixa sem limite = `SEM_LIMITE`, `vagas.limite` null); preços em centavos; `SITE_DISPONIVEL=false` (site da fase 2 "em breve").
  - Banco: `migrations/0011_planos_assinaturas.sql` (assinaturas: plano em vigor + cobrança; assinatura_eventos: avisos do Asaas, id único). Plano em vigor = `SQL_PLANO` (tabela nova; sem linha, coluna antiga: profissional→pro).
  - API: `src/asaas.js` (cliente da API v3; `ASAAS_FETCH` nos testes), `src/assinatura.js`: `GET /api/planos`, `POST /api/assinar` (sem login), `POST /api/asaas/webhook` (header `asaas-access-token`), `GET /api/assinatura`, `POST /api/assinatura/cancelar`. Situação: `situacaoAssinatura` (teste/em_dia/atrasada/bloqueada/cancelada_ate_fim/cancelada/manual), tolerância 5 dias; bloqueio em `src/index.js` (equipe 401/403; proprietário só /assinatura, resto 402).
  - Segredos necessários no Worker (ainda NÃO criados): `ASAAS_API_KEY`, `ASAAS_WEBHOOK_TOKEN`; variável `ASAAS_URL` (padrão sandbox `https://api-sandbox.asaas.com/v3`; produção `https://api.asaas.com/v3`). Sem a chave, a página de planos aparece mas o botão Assinar fica desligado.
  - Tela: `#/planos`, `#/assinar/<plano>`, `#/termos`, `#/privacidade` (sem login, `ROTAS_PUBLICAS`/`montarTela`), boas-vindas, `#/assinatura` (Minha assinatura, menu Equipe e ajustes), faixa `#faixa-assinatura`; textos legais RASCUNHO em `public/legal.js` (cache do sw `4blade-v11`).
  - Testes: `npm test` (117) + `npm run teste-navegador` (inclui `test/navegador-assinatura.mjs`; prints em `docs/prints/assinatura/`). Asaas de mentira: `test/asaas-falso.mjs`; servidor local tem `/__teste/pago-ate` e `/__teste/pagar` (só local).

## Versão de teste publicada (Cloudflare)
- Endereço: https://4blade-teste.terraplanagem.workers.dev (Worker `4blade-teste`, banco D1 `4blade-db-teste`, região ENAM). Dados FICTÍCIOS apenas.
- Publicar de novo: `npx wrangler deploy --config wrangler.teste.toml`; migrações: `npx wrangler d1 migrations apply 4blade-db-teste --remote --config wrangler.teste.toml`.
- No ambiente do Claude o token fica como segredo de rede de api.cloudflare.com (usar `CLOUDFLARE_API_TOKEN=proxy-injected`); o envio de "assets" não passa pelo proxy, por isso a versão de teste usa `src/entrada-teste.js` (tela dentro do Worker).
- 1º acesso da plataforma: usuário `suporte`, senha provisória entregue ao responsável (troca obrigatória). Não há segredo ADMIN_SETUP_TOKEN nessa versão (o usuário foi criado direto no banco).

## Versão OFICIAL publicada (Cloudflare) — 16/11/2026, autorizada pelo responsável
- Endereço: https://4blade.terraplanagem.workers.dev (Worker `4blade`, banco D1 `4blade-db` id `e59dc06b-cf90-4e67-bc06-710165e45d5a`, região ENAM). Dados REAIS: nunca usar para testes.
- Configuração: `wrangler.toml` (mesma entrada `src/entrada-teste.js`, tela dentro do Worker). Publicada a partir da ramificação `melhorias-layout` (todas as melhorias até o "Depois (11)" + mensagens prontas).
- Banco nasceu vazio, com as migrações 0001–0010 aplicadas. 1º acesso: usuário `suporte` (perfil plataforma) criado direto no banco, senha provisória entregue ao responsável na conversa (troca obrigatória no 1º login). Sem segredo ADMIN_SETUP_TOKEN.
- Publicar de novo / migrar o banco REAL: SEMPRE pedir confirmação antes (`npx wrangler deploy`; `npx wrangler d1 migrations apply 4blade-db --remote`). Testar primeiro na versão de teste.

## Pendências fora do código
- Conferir domínios 4blade.com.br e forblade.com.br (registro.br) e a marca no INPI (classe 42).
- Termos de uso e política de privacidade (LGPD) antes de vender.
- Forma de cobrança da mensalidade (boleto/Pix recorrente) — fora do sistema na fase 1.
- Contador: CNAE, anexo do Simples (Fator R) e se as barbearias clientes usam a Lei do Salão-Parceiro.
