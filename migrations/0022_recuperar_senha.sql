-- Recuperar a senha por e-mail (25/11/2026). Só tabelas novas; nada é apagado.
-- E-mail de cada usuário (opcional): usado só para mandar o link de troca de senha.
CREATE TABLE IF NOT EXISTS usuarios_emails (
  usuario_id TEXT PRIMARY KEY,
  email TEXT,                      -- NULL = a pessoa tirou o e-mail (a linha fica, como histórico)
  atualizado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  atualizado_por TEXT,
  FOREIGN KEY (usuario_id) REFERENCES usuarios(id)
);
CREATE INDEX IF NOT EXISTS idx_usuarios_emails_email ON usuarios_emails (email);

-- Pedidos de troca: guarda só o resumo (hash) do código do link; vale 1 hora e uma vez só.
CREATE TABLE IF NOT EXISTS senha_recuperacoes (
  id TEXT PRIMARY KEY,
  usuario_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL,
  criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expira_em TEXT NOT NULL,
  usado_em TEXT,
  ip_hash TEXT,
  FOREIGN KEY (usuario_id) REFERENCES usuarios(id)
);
CREATE INDEX IF NOT EXISTS idx_senha_recuperacoes_usuario ON senha_recuperacoes (usuario_id, criado_em);
