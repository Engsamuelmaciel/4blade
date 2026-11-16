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
- 16/11/2026: **E2 (Agenda e finalização) pronta** na ramificação `e2-agenda` (criada a partir da `e1-base`), aguardando avaliação. Próximo: E3 (Caixa e estoque).
  - Banco: `migrations/0002_agenda.sql` (funcionamento, datas_fechadas, horario_trabalho, bloqueios, agendamentos, agendamento_servicos, caixas, finalizacoes, finalizacao_itens, caixa_lancamentos, comissoes, mensagens_enviadas). Horas em minutos; início/fim de horário em texto local `AAAA-MM-DDTHH:MM`.
  - API: `src/funcionamento.js` (funcionamento, datas fechadas com lista para remarcar, horário de trabalho), `src/agenda.js` (agenda, marcar, faltou/cancelado, mensagem wa.me registrada, finalizar, reabrir, bloqueios), `src/caixa.js` (abrir caixa + entradas do dia), `src/agenda-util.js`.
  - Gravações críticas em um só lote com condição (sem sobreposição por corrida; finalização só com caixa aberto; no máximo 1 finalização válida por horário — índice único). Reabrir = estorno (lançamento negativo + comissão estornada), nada apagado.
  - Valor alterado: item com cobrado ≠ tabela OU refinalização com total diferente do anterior → destacado só para a gestão.
  - Regras que decidi (confirmar com o responsável): sem funcionamento cadastrado a agenda não aceita horário; bloqueio por cima de horário marcado é recusado; finalizar só horários de hoje ou anteriores (a entrada vai para o caixa de hoje); "Propor horário" usa a data/hora do próprio horário; proprietário não tem agenda própria (só gerente e barbeiro).
  - Pendente para a E3: fechar/reabrir caixa (o gerente reabrir atendimento com caixa fechado depende disso), sangria, suprimento, vendas.
  - Testes: `npm test` (61) + `node test/navegador-e1.mjs` e `node test/navegador-e2.mjs` (prints em `docs/prints/e1/` e `docs/prints/e2/`).

## Pendências fora do código
- Conferir domínios 4blade.com.br e forblade.com.br (registro.br) e a marca no INPI (classe 42).
- Termos de uso e política de privacidade (LGPD) antes de vender.
- Forma de cobrança da mensalidade (boleto/Pix recorrente) — fora do sistema na fase 1.
- Contador: CNAE, anexo do Simples (Fator R) e se as barbearias clientes usam a Lei do Salão-Parceiro.
