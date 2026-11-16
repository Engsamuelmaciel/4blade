# 4blade — Precificação

Versão 2 · pesquisa em 10/11/2026. **[F]** = dado com fonte · **[E]** = estimativa minha (confirmar).

## 1. Mercado — o que os concorrentes cobram
| Sistema | Preço mensal | Observação | Fonte |
|---|---|---|---|
| BarberCloud | Grátis (limitado) · R$ 49 Pro · R$ 99 Shop Pro | Shop Pro = equipe + comissões automáticas | [F] Capterra |
| Booksy | R$ 99,99 + impostos | Todos os recursos, sem fidelidade; forte em agendamento online | [F] busca (página Booksy) |
| BarbeariaPro | R$ 99,99 | Página de assinatura | [F] Asaas |
| Barbeiro Vip | R$ 119,90 | | [F] Capterra (jul/2026) |
| eHair | R$ 149,90 | Usuários e profissionais ilimitados | [F] GetApp/Capterra (ago/2026) |
| BEMP | R$ 56 a R$ 199 por unidade | Por faixa de plano | [F] Software Advice |
| Trinks, AppBarber, Avec, Belasis | Não publicado nas fontes acessíveis | Sites oficiais bloqueados nesta sessão — conferir | — |
| BestBarbers | Versão grátis para barbearia | Ganha com intermediação | [F] App Store |

**Leitura:** a faixa do mercado é **R$ 50 a R$ 150 por mês**, centro em torno de **R$ 100**. Quase todos vendem pelo **agendamento online**; caixa com fechamento conferido, estoque com custo médio, vales e contas a pagar aparecem menos. Esse é o nosso espaço.

**Tamanho do mercado:** não há número oficial de barbearias no Brasil (informalidade, sem categoria própria nas estatísticas) [F] A Gazeta/O Hoje. O Sebrae registra ~236 mil pequenos negócios de beleza abertos no último ano (+18,5% em 2025) e a maioria fatura menos de R$ 50 mil/mês [F] Sebrae — ou seja, **cliente pequeno, sensível a preço**.

## 2. Custo para manter (mensal)
| Item | Valor | Tipo |
|---|---|---|
| Cloudflare Workers Paid | US$ 5 ≈ R$ 30 — inclui 25 bilhões de leituras e 50 milhões de gravações/mês no banco e 5 GB [F] docs Cloudflare. Atende centenas de barbearias. | Fixo |
| Domínio .com.br do produto | ≈ R$ 40/ano ≈ R$ 3,50/mês [E] | Fixo |
| Domínio próprio de cada barbearia (Profissional) | ≈ R$ 40/ano [E] — **repassado ao cliente** | Por cliente |
| Domínios personalizados na Cloudflare | 100 grátis, depois US$ 0,10/mês cada [F] docs Cloudflare | Por cliente (só acima de 100) |
| Contador | R$ 150 a R$ 300 [E] | Fixo |
| Assinatura do Claude (desenvolvimento e manutenção) | conforme seu plano atual [E] — considerei R$ 600 | Fixo |
| Cobrança da mensalidade (boleto/Pix recorrente) | R$ 2 a R$ 3,50 por cobrança [E] | Por cliente |
| Impostos (Simples Nacional) | **6%** (Anexo III, se o Fator R ≥ 28%: folha + pró-labore ÷ receita) ou **15,5%** (Anexo V) na 1ª faixa [F] artigos de contabilidade — **confirmar com o contador** | Por cliente |

**Custo fixo estimado:** ≈ **R$ 880/mês** (com contador R$ 250 e Claude R$ 600).
**Custo por cliente:** infraestrutura praticamente zero + cobrança ~R$ 3 + imposto.

## 3. Custo para construir (fase 1)
- 4 entregas (E1 a E4) feitas pelo Code com os prompts prontos. [E] 25 a 35 horas suas (acompanhar, testar no celular, aprovar).
- Se valorizar sua hora em R$ 100 [E]: **≈ R$ 3.000** de investimento, sem custo de programador contratado.
- Fase 2 (Plano Profissional: site da barbearia + domínio próprio): 2 entregas a mais (E5 e E6) [E] ≈ 10 a 15 horas suas. A API do WhatsApp (lembrete automático) fica para depois e tem custo por mensagem.

## 4. Valor para a barbearia (argumento de venda) [E]
Barbearia com 4 barbeiros faturando R$ 25 mil/mês:
- Erro de caixa e comissão de 1% a 2% = **R$ 250 a R$ 500/mês** perdidos.
- Dono gastando ~4 h/semana em planilha e fechamento.
- Produto sumindo do estoque sem controle.
→ O sistema se paga com folga mesmo a R$ 129.

## 5. Proposta de preço
> **Atualizado em 16/11/2026 (decisão do responsável): 3 planos.** Gerentes e caixas sem limite em todos.
>
> | Plano | Barbeiros | Mensal | Anual (paga 10 meses) |
> |---|---|---|---|
> | **Básico** | até 2 | **R$ 79** | R$ 790 |
> | **Standard** | até 4 | **R$ 119** | R$ 1.190 |
> | **Pro** | até 10 (+ adicionais) | **R$ 179** | R$ 1.790 |
>
> Standard: site só para o cliente ver os horários livres, **opcional e pago à parte** (valor provisório no sistema: + R$ 20/mês, a confirmar). Pro: site completo integrado (fase 2). Enquanto o site não estiver pronto, aparece como "em breve" e não pode ser contratado.
>
> A tabela abaixo é a proposta ANTIGA (2 planos), guardada só como histórico.

| Plano | Para quem | Mensal | Anual (paga 10 meses) |
|---|---|---|---|
| **Básico** | 1 gerente + 3 barbeiros + 1 caixa · tudo da fase 1 (agenda, caixa, estoque, comissões, contas, painel) | **R$ 79** | R$ 790 |
| **Profissional** | 2 gerentes + 10 barbeiros + 2 caixas · tudo do Básico + **site da barbearia** (horários livres, serviços, preços, produtos, tudo pelo WhatsApp) + **domínio próprio** | **R$ 139** | R$ 1.390 |
| Barbeiro adicional (acima de 10, só Profissional) | — | + R$ 12 cada | — |

- **Domínio próprio:** nós registramos, configuramos e renovamos; custo (≈ R$ 40/ano) repassado ao cliente na cobrança anual ou na 1ª mensalidade de cada ano. Registrado no CPF/CNPJ do cliente.
- Profissional a R$ 139 fica logo abaixo do eHair (R$ 149,90) e acima de Booksy (R$ 99,99), entregando agendamento + gestão completa + endereço próprio.
- **Teste grátis de 14 dias.** Sem fidelidade.
- **Implantação opcional R$ 197:** nós cadastramos serviços, produtos e equipe e treinamos por vídeo-chamada.
- **Preço mínimo (abaixo dá prejuízo na escala inicial): R$ 49.**
- Posicionamento: Básico abaixo de Booksy/Barbeiro Vip/eHair; Profissional competitivo com os líderes, com o diferencial de caixa e comissão sem erro.
- **Upgrade simples:** Básico → Profissional a qualquer momento, sem perder dados.
- **Cliente fundador (este primeiro pedido):** implantação grátis + 50% por 6 meses em troca de uso real, sugestões e depoimento.

## 6. Contas do negócio [E]
Ticket médio considerado: **R$ 105** (mistura dos planos, já com descontos anuais).
Por cliente: R$ 105 − imposto 6% (R$ 6,30) − cobrança (R$ 3) ≈ **R$ 95,70 de margem** (91%). No Anexo V (15,5%): ≈ R$ 85,70.

- **Ponto de equilíbrio:** R$ 880 ÷ R$ 95,70 ≈ **10 barbearias**.
- **Volta do investimento (R$ 3.000):** com 20 clientes, ~4 meses depois do equilíbrio.

| Cenário em 12 meses | Clientes | Receita/mês | Resultado/mês |
|---|---|---|---|
| Pessimista | 10 | R$ 1.050 | ≈ R$ 80 (empata) |
| Realista | 30 | R$ 3.150 | ≈ R$ 2.000 |
| Otimista | 80 | R$ 8.400 | ≈ R$ 6.800 (precisa de ajuda no suporte) |

**Gargalo real não é custo, é venda e suporte:** com mais de ~40 clientes, você sozinho no suporte fica pesado — planejar manual/vídeos e um FAQ desde o início.

## 7. Próximos passos de preço
1. Conferir os preços de Trinks, AppBarber, Avec e Belasis nos sites oficiais (bloqueados nesta sessão).
2. Contador: CNAE, anexo do Simples e Fator R.
3. Validar o preço com 3 a 5 barbearias da região antes de fixar.
4. Revisar em 6 meses ou ao lançar a fase 2.

## Fontes
- BarberCloud: https://www.capterra.com/p/10037029/BarberCloud/
- Barbeiro Vip: https://www.capterra.com/p/10049263/Barbeiro-Vip/
- eHair: https://www.getapp.com/all-software/a/ehair/ · https://www.capterra.com/p/10045641/eHair/
- Booksy (preço citado na busca): https://biz.booksy.com/pt-br/pricing
- BEMP: https://www.softwareadvice.com.au/software/529573/BEMP
- BestBarbers: https://apps.apple.com/br/app/bestbarbers/id1501336370
- Mercado (Sebrae / imprensa): https://agenciasebrae.com.br/?p=37010 · https://ohoje.com/2026/03/04/barbearias-e-estetica-em-goias/ · https://www.uai.com.br/?p=175719
- Cloudflare D1: https://developers.cloudflare.com/d1/platform/pricing/
- Cloudflare for SaaS (domínios personalizados): https://developers.cloudflare.com/cloudflare-for-platforms/cloudflare-for-saas/plans/
- Simples / Fator R: https://agilize.com.br/artigos/?p=4180 · https://agilize.com.br/artigos/?p=4364

