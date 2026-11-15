# 4blade — Prompts para o Code (uma entrega por sessão)

Os documentos `docs/ESPECIFICACAO.md`, `docs/PRECIFICACAO.md` e o `CLAUDE.md` já estão neste repositório: cada prompt é curto e o Code lê a especificação aqui.

Use UM prompt por sessão, nesta ordem. Só passe para o próximo depois de avaliar e aprovar a entrega.

---

## Prompt E1 — Base

```
Projeto novo: sistema de gestão para barbearias, vendido para várias barbearias (multi-empresa). Leia CLAUDE.md e docs/ESPECIFICACAO.md antes de qualquer coisa: lá estão perfis, regras, fluxos e as entregas (fase 1 = E1 a E4). Execute SOMENTE a entrega E1 (Base).

Tecnologia (obrigatória): Cloudflare Workers + D1 (migrações versionadas em migrations/) + tela web instalável (PWA, JavaScript sem framework), CSP rígida (sem style="" no HTML). Testes com node --test e D1 local.

Reaproveite, adaptando, a base que já está neste repositório em referencia/frotaz/ (leia referencia/frotaz/LEIAME.md; NÃO acesse nenhum outro repositório): login por usuário e senha com hash, troca obrigatória no 1º acesso, limite de 5 tentativas/15 min, sessão de 12 h, auditoria, util.js, testes com D1 local (test/d1-local.js, test/ambiente.js), service worker e estilo base. Não copie nada específico de frota.

E1 deve entregar:
1. Multi-empresa: tabela barbearias (com campo plano: basico | profissional); toda tabela de dados tem barbearia_id; o servidor SEMPRE filtra pela barbearia da sessão, nunca pelo que vem da tela. Limite de usuários ativos por perfil conforme o plano (Básico: 1 gerente, 3 barbeiros, 1 caixa; Profissional: 2 gerentes, 10 barbeiros + adicionais, 2 caixas), conferido no servidor; desativar libera a vaga.
2. Perfis: plataforma, proprietário, gerente, barbeiro, caixa (permissões da seção 2 da especificação). Usuário caixa ao entrar abre direto a tela do caixa (por enquanto uma página "Caixa — em construção").
3. Painel da plataforma: criar barbearia + 1º acesso do proprietário, bloquear/desbloquear (bloqueada não entra).
4. Proprietário/gerente: criar, editar e desativar usuários (proprietário cria gerentes; gerente cria barbeiro e caixa).
5. Cadastros da seção 3: serviços, produtos (sem estoque ainda; só o cadastro), colaboradores com % de comissão em serviço e em produto, clientes com aceite LGPD, modelos de mensagem editáveis.
6. Dinheiro em centavos (inteiro). Fuso America/Sao_Paulo. Nada é apagado (desativar com motivo). Tudo auditado com antes/depois.

Testes obrigatórios (automáticos): isolamento entre duas barbearias (uma nunca lê/altera dado da outra, inclusive mudando ids na requisição); cada perfil recusado nas rotas que não pode; barbearia bloqueada não entra; login/limite de tentativas; validações dos cadastros.
Teste no navegador (Playwright, já instalado): plataforma cria barbearia → proprietário troca senha → cria gerente, barbeiro e caixa → gerente cadastra 2 serviços, 2 produtos, 1 cliente → barbeiro não vê custo/margem → caixa abre na tela do caixa. Prints em computador 1366 px e celular 390 px.

Dados de teste fictícios. Não faça deploy, não crie recursos na Cloudflare, não use segredos reais. Atualize CLAUDE.md com o que foi feito. Commit e push na ramificação designada. Entregue: resumo em linguagem simples (o responsável não é programador e usa celular), saída dos testes e os prints.
```

---

## Prompt E2 — Agenda e finalização

```
Leia CLAUDE.md e docs/ESPECIFICACAO.md. A E1 está pronta. Execute SOMENTE a entrega E2 (seções 4.1, 4.2 e 4.9 da especificação), mais a abertura de caixa mínima (abrir com valor de troco; lista das entradas do dia).

Pontos que não podem faltar: sem sobreposição de horário por barbeiro; barbeiro só vê/agenda a própria agenda, gerente todas; situações agendado/finalizado/faltou/cancelado (com motivo); botões "Enviar lembrete" e "Propor horário" abrindo wa.me com o modelo preenchido e envio registrado; finalizar com valor de tabela alterável, alteração registrada (tabela, cobrado, quem, quando); forma de pagamento; entra no caixa com VALOR BRUTO; comissão calculada e guardada à parte (visível só ao barbeiro dono e ao gerente; o caixa nunca vê); finalizar exige caixa aberto; funcionamento da barbearia (dias, horários, intervalo, datas fechadas, fechar agenda com lista para remarcar); bloqueios do barbeiro e do gerente; cliente identificado pelo telefone na própria marcação; até 2 formas de pagamento com soma conferida; barbeiro reabre o próprio atendimento enquanto o caixa está aberto (estorna entrada e comissão, registrado).

Testes automáticos dessas regras (incluindo isolamento entre barbearias e perfis) + navegador (barbeiro agenda, envia mensagem, finaliza com valor alterado; caixa vê o valor bruto e não vê comissão; gerente vê a alteração destacada), prints 1366 px e 390 px. Mesmas regras de entrega da E1.
```

---

## Prompt E3 — Caixa e estoque

```
Leia CLAUDE.md e docs/ESPECIFICACAO.md. E1 e E2 prontas. Execute SOMENTE a entrega E3 (seções 4.3 e 4.4).

Não pode faltar: vendas avulsas baixando estoque; cancelamento devolvendo; sangria/suprimento com motivo; correção de forma de pagamento antes do fechamento (registrada); tela de fechamento com todos os atendimentos e vendas do dia, totais por forma de pagamento, esperado × contado e diferença; caixa fechado imutável, só gerente reabre com motivo; histórico de caixas para o gerente. Estoque: entrada com custo (custo médio), ajustes com motivo, venda sem saldo bloqueada, avisos de mínimo e validade 30 dias, inventário, histórico por produto.

Teste de ponta a ponta: um dia simulado com 6 atendimentos, 3 vendas, 1 sangria, 1 suprimento e fechamento com R$ 5,00 de falta — conferir todos os totais à mão no teste. Navegador + prints 1366 px e 390 px. Mesmas regras de entrega.
```

---

## Prompt E4 — Gestão (comissões, contas, painel)

```
Leia CLAUDE.md e docs/ESPECIFICACAO.md. E1 a E3 prontas. Execute SOMENTE a entrega E4 (seções 4.5 a 4.8, 4.10 e 4.11).

Não pode faltar: comissão de serviço e de produto pelo % de cada barbeiro sobre o valor bruto; vales; fechamento de comissão por período (comissões − vales), imutável depois de fechado; contas a pagar com recorrência mensal e "pago com dinheiro do caixa" (vira sangria); painel do gerente com filtro Hoje/Semana/Mês, cartões, gráfico de faturamento por dia, ranking de barbeiros e avisos (seção 4.7, fórmula de lucro exatamente como lá); desempenho do barbeiro só com os dados dele; Enviar ao contador (PDF + CSV, Compartilhar do celular, registro do envio e aviso de alteração posterior, separação cota-parte barbearia × barbeiros); extrato mensal do barbeiro; cópia de todos os dados em planilhas.

Teste: semana simulada com 2 barbeiros (% diferentes), vales e 3 contas — conferir no teste os números do painel e do fechamento de comissão calculados à mão. Visual simples e legível no celular (gráficos em SVG/CSS, sem biblioteca externa). Navegador + prints 1366 px e 390 px. Mesmas regras de entrega.
```
