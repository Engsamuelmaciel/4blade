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
- Reaproveitar do FrotaZ (`Engsamuelmaciel/Novo-sistem`, pasta `apps/api`): login/senha/sessão/limite de tentativas/auditoria (`src/index.js`, `src/util.js`, `migrations/0001_base.sql`), testes com D1 local (`test/d1-local.js`, `test/ambiente.js`), service worker e estilo base. Não copiar nada de frota.
- WhatsApp sempre por link `wa.me` com mensagem pronta (sem API paga).

## Convenções da tela (herdadas do FrotaZ)
- Política de segurança (CSP): nada de `style="…"` no HTML; cor/forma por classe no CSS (SVG usa atributos).
- `replaceChildren(...)` com `null` insere o texto "null": filtrar com `.filter(Boolean)`.
- Botão novo com ícone por máscara de SVG precisa da regra de ícone no CSS (senão vira quadrado cheio); conferir no celular e no computador.

## Estado
- 15/11/2026: especificação aprovada (versão 4). Nenhum código ainda. Próximo: E1 (Base).

## Pendências fora do código
- Conferir domínios 4blade.com.br e forblade.com.br (registro.br) e a marca no INPI (classe 42).
- Termos de uso e política de privacidade (LGPD) antes de vender.
- Forma de cobrança da mensalidade (boleto/Pix recorrente) — fora do sistema na fase 1.
- Contador: CNAE, anexo do Simples (Fator R) e se as barbearias clientes usam a Lei do Salão-Parceiro.
