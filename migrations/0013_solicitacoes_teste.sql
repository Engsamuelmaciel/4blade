-- Pedidos de teste grátis feitos pelo site (pedido do responsável, 16/11/2026). Ficam com a PLATAFORMA (são de
-- barbearias que ainda não são clientes, por isso não têm barbearia_id até serem cadastradas). Nada é apagado:
-- o pedido muda de situação (nova → em_contato → cadastrada | descartada, com observação).
CREATE TABLE IF NOT EXISTS solicitacoes_teste (
  id TEXT PRIMARY KEY,
  numero INTEGER NOT NULL UNIQUE,
  barbearia_nome TEXT NOT NULL,
  nome TEXT NOT NULL,
  telefone TEXT NOT NULL,
  cidade TEXT NOT NULL,
  barbeiros INTEGER NOT NULL CHECK (barbeiros BETWEEN 1 AND 99),
  plano_interesse TEXT CHECK (plano_interesse IN ('basico', 'standard', 'pro')),
  mensagem TEXT,
  aceite_em TEXT NOT NULL,
  ip_hash TEXT,
  situacao TEXT NOT NULL DEFAULT 'nova' CHECK (situacao IN ('nova', 'em_contato', 'cadastrada', 'descartada')),
  observacao TEXT,
  barbearia_id TEXT REFERENCES barbearias(id),
  atualizado_por TEXT REFERENCES usuarios(id),
  criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  atualizado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS solicitacoes_teste_situacao ON solicitacoes_teste(situacao, criado_em);
CREATE INDEX IF NOT EXISTS solicitacoes_teste_telefone ON solicitacoes_teste(telefone, criado_em);
