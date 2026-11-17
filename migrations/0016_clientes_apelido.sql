-- 0016: apelido do cliente (pedido de 17/11/2026) para achar mais fácil na busca e na agenda. Só tabela nova.
CREATE TABLE IF NOT EXISTS clientes_apelidos (
  cliente_id TEXT PRIMARY KEY,
  barbearia_id TEXT NOT NULL,
  apelido TEXT,
  atualizado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (cliente_id) REFERENCES clientes(id)
);
CREATE INDEX IF NOT EXISTS idx_clientes_apelidos_barbearia ON clientes_apelidos(barbearia_id);
