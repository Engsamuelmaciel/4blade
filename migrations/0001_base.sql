-- 4blade — Migração 0001: base (barbearias, acesso, auditoria e cadastros).
-- Origem do acesso/auditoria: FrotaZ (referencia/frotaz/migrations/0001_base.sql), adaptado para multi-empresa.
-- Regras: toda tabela de dados tem barbearia_id; dinheiro em centavos (inteiro); nada é apagado (ativo = 0 + motivo).

CREATE TABLE IF NOT EXISTS barbearias (
  id TEXT PRIMARY KEY,
  nome TEXT NOT NULL,
  plano TEXT NOT NULL DEFAULT 'basico' CHECK (plano IN ('basico', 'profissional')),
  barbeiros_adicionais INTEGER NOT NULL DEFAULT 0 CHECK (barbeiros_adicionais >= 0),
  telefone TEXT,
  bloqueada INTEGER NOT NULL DEFAULT 0 CHECK (bloqueada IN (0, 1)),
  motivo_bloqueio TEXT,
  criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  atualizado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Usuários = colaboradores. "plataforma" (nós) não pertence a nenhuma barbearia; os demais sempre pertencem a uma.
-- Comissão em centésimos de ponto percentual (4000 = 40,00%).
CREATE TABLE IF NOT EXISTS usuarios (
  id TEXT PRIMARY KEY,
  barbearia_id TEXT,
  login TEXT NOT NULL UNIQUE,
  nome TEXT NOT NULL,
  telefone TEXT,
  perfil TEXT NOT NULL CHECK (perfil IN ('plataforma', 'proprietario', 'gerente', 'barbeiro', 'caixa')),
  comissao_servico_bp INTEGER NOT NULL DEFAULT 0 CHECK (comissao_servico_bp BETWEEN 0 AND 10000),
  comissao_produto_bp INTEGER NOT NULL DEFAULT 0 CHECK (comissao_produto_bp BETWEEN 0 AND 10000),
  senha_hash TEXT NOT NULL,
  ativo INTEGER NOT NULL DEFAULT 1 CHECK (ativo IN (0, 1)),
  motivo_desativacao TEXT,
  trocar_senha INTEGER NOT NULL DEFAULT 1,
  criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  atualizado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK ((perfil = 'plataforma') = (barbearia_id IS NULL)),
  FOREIGN KEY (barbearia_id) REFERENCES barbearias(id)
);
CREATE INDEX IF NOT EXISTS idx_usuarios_barbearia ON usuarios(barbearia_id, perfil, ativo);
-- Um único proprietário por barbearia.
CREATE UNIQUE INDEX IF NOT EXISTS idx_usuarios_um_proprietario ON usuarios(barbearia_id) WHERE perfil = 'proprietario';

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

CREATE TABLE IF NOT EXISTS limites_acesso (
  chave TEXT PRIMARY KEY,
  janela INTEGER NOT NULL,
  quantidade INTEGER NOT NULL DEFAULT 0
);

-- Auditoria: quem, quando, o quê, antes/depois (em "detalhes", JSON). Nunca guarda senhas nem tokens.
CREATE TABLE IF NOT EXISTS auditoria (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  barbearia_id TEXT,
  usuario_id TEXT,
  acao TEXT NOT NULL,
  alvo TEXT,
  detalhes TEXT,
  ip_hash TEXT,
  criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_auditoria_barbearia ON auditoria(barbearia_id, criado_em);
CREATE INDEX IF NOT EXISTS idx_auditoria_usuario ON auditoria(usuario_id, criado_em);

CREATE TABLE IF NOT EXISTS servicos (
  id TEXT PRIMARY KEY,
  barbearia_id TEXT NOT NULL,
  nome TEXT NOT NULL,
  preco_centavos INTEGER NOT NULL CHECK (preco_centavos >= 0),
  duracao_min INTEGER NOT NULL CHECK (duracao_min BETWEEN 5 AND 480),
  ativo INTEGER NOT NULL DEFAULT 1 CHECK (ativo IN (0, 1)),
  motivo_desativacao TEXT,
  criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  atualizado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (barbearia_id) REFERENCES barbearias(id)
);
CREATE INDEX IF NOT EXISTS idx_servicos_barbearia ON servicos(barbearia_id, ativo);

-- Custo médio vem da entrada de mercadoria (E3). Estoque também entra na E3.
CREATE TABLE IF NOT EXISTS produtos (
  id TEXT PRIMARY KEY,
  barbearia_id TEXT NOT NULL,
  nome TEXT NOT NULL,
  codigo TEXT,
  preco_centavos INTEGER NOT NULL CHECK (preco_centavos >= 0),
  custo_medio_centavos INTEGER NOT NULL DEFAULT 0 CHECK (custo_medio_centavos >= 0),
  validade TEXT,
  estoque_minimo INTEGER NOT NULL DEFAULT 0 CHECK (estoque_minimo >= 0),
  mostrar_site INTEGER NOT NULL DEFAULT 0 CHECK (mostrar_site IN (0, 1)),
  ativo INTEGER NOT NULL DEFAULT 1 CHECK (ativo IN (0, 1)),
  motivo_desativacao TEXT,
  criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  atualizado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (barbearia_id) REFERENCES barbearias(id)
);
CREATE INDEX IF NOT EXISTS idx_produtos_barbearia ON produtos(barbearia_id, ativo);
CREATE UNIQUE INDEX IF NOT EXISTS idx_produtos_codigo ON produtos(barbearia_id, codigo) WHERE codigo IS NOT NULL;

-- Telefone só com dígitos (DDD + número). Um telefone por cliente dentro da barbearia.
CREATE TABLE IF NOT EXISTS clientes (
  id TEXT PRIMARY KEY,
  barbearia_id TEXT NOT NULL,
  nome TEXT NOT NULL,
  telefone TEXT NOT NULL,
  observacao TEXT,
  aceite_lgpd INTEGER NOT NULL DEFAULT 0 CHECK (aceite_lgpd IN (0, 1)),
  aceite_lgpd_em TEXT,
  aceite_lgpd_por TEXT,
  ativo INTEGER NOT NULL DEFAULT 1 CHECK (ativo IN (0, 1)),
  motivo_desativacao TEXT,
  criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  atualizado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (barbearia_id) REFERENCES barbearias(id)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_clientes_telefone ON clientes(barbearia_id, telefone);

-- Modelos de mensagem do WhatsApp: um de cada tipo por barbearia (criados junto com a barbearia).
CREATE TABLE IF NOT EXISTS modelos_mensagem (
  id TEXT PRIMARY KEY,
  barbearia_id TEXT NOT NULL,
  tipo TEXT NOT NULL CHECK (tipo IN ('lembrete', 'proposta')),
  texto TEXT NOT NULL,
  atualizado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (barbearia_id) REFERENCES barbearias(id),
  UNIQUE (barbearia_id, tipo)
);
