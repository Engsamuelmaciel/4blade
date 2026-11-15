-- FrotaZ — Migração 0001: base (acesso, auditoria e frota).
-- Origem: tabelas do SIGEO (migrações 0001, 0002 e 0013), sem o que é de produção/apontamento.
-- O tipo e a regional do equipamento são validados na API (src/frota.js), não por CHECK no banco,
-- para poder mudar a lista sem recriar a tabela.

CREATE TABLE IF NOT EXISTS usuarios (
  id TEXT PRIMARY KEY,
  r3 TEXT NOT NULL UNIQUE,
  nome TEXT NOT NULL,
  email TEXT,
  senha_hash TEXT NOT NULL,
  perfil TEXT NOT NULL DEFAULT 'operador' CHECK (perfil IN (
    'operador', 'supervisor', 'gerente', 'mecanico', 'administrador'
  )),
  ativo INTEGER NOT NULL DEFAULT 1,
  trocar_senha INTEGER NOT NULL DEFAULT 1,
  criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  atualizado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS sessoes (
  id TEXT PRIMARY KEY,
  usuario_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expira_em TEXT NOT NULL,
  revogado_em TEXT,
  FOREIGN KEY (usuario_id) REFERENCES usuarios(id)
);
CREATE INDEX IF NOT EXISTS idx_sessoes_usuario ON sessoes(usuario_id);
CREATE INDEX IF NOT EXISTS idx_sessoes_token_hash ON sessoes(token_hash);

CREATE TABLE IF NOT EXISTS recuperacoes_senha (
  id TEXT PRIMARY KEY,
  usuario_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente', 'aprovada', 'rejeitada')),
  solicitado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  analisado_em TEXT,
  analisado_por TEXT,
  observacao TEXT,
  FOREIGN KEY (usuario_id) REFERENCES usuarios(id),
  FOREIGN KEY (analisado_por) REFERENCES usuarios(id)
);
CREATE INDEX IF NOT EXISTS idx_recuperacoes_status ON recuperacoes_senha(status);
CREATE INDEX IF NOT EXISTS idx_recuperacoes_usuario_status ON recuperacoes_senha(usuario_id, status);

CREATE TABLE IF NOT EXISTS limites_acesso (
  chave TEXT PRIMARY KEY,
  janela INTEGER NOT NULL,
  quantidade INTEGER NOT NULL DEFAULT 0
);

-- Auditoria: quem fez o quê e quando. Nunca guarda senhas nem tokens.
CREATE TABLE IF NOT EXISTS auditoria (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  usuario_id TEXT,
  acao TEXT NOT NULL,
  alvo TEXT,
  detalhes TEXT,
  ip_hash TEXT,
  criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_auditoria_data ON auditoria(criado_em);
CREATE INDEX IF NOT EXISTS idx_auditoria_usuario ON auditoria(usuario_id, criado_em);

-- Equipamentos da frota. "codigo" é a identificação da frota.
CREATE TABLE IF NOT EXISTS equipamentos (
  id TEXT PRIMARY KEY,
  codigo TEXT NOT NULL UNIQUE,
  tipo TEXT NOT NULL,
  regional TEXT NOT NULL,
  ativo INTEGER NOT NULL DEFAULT 1,
  placa TEXT,
  marca TEXT,
  modelo TEXT,
  ano INTEGER,
  serie TEXT,
  criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  atualizado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_equipamentos_tipo_regional ON equipamentos(tipo, regional);
