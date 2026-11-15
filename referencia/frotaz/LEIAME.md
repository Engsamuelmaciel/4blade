# Referência: base copiada do FrotaZ (somente leitura)

Arquivos copiados do outro produto da casa (FrotaZ) para REAPROVEITAR, adaptando, na entrega E1:
login com usuário e senha (hash), troca obrigatória no 1º acesso, limite de 5 tentativas/15 min, sessão de 12 h, auditoria (`src/index.js`, `src/util.js`, `migrations/0001_base.sql`), testes com D1 local (`test/d1-local.js`, `test/ambiente.js`, `test/servidor-local.mjs`, exemplo `test/acesso.test.js`), service worker, cabeçalhos de segurança (CSP) e estilo base (`public/`), gerador de hash de senha (`scripts/hash-senha.js`), `wrangler.toml` e `package.json` de exemplo.

- NÃO é código do 4blade: não importar daqui. Copie e adapte para as pastas do projeto.
- Ignore tudo que for de frota (equipamentos, regionais, documentos etc.).
- Não precisa acessar nenhum outro repositório.
