-- Excluir cliente (pedido do responsável, 16/11/2026). Só tabela nova; nada é apagado:
-- o cliente sai das listas, da busca e da marcação (ativo = 0), o telefone fica livre para um novo cadastro
-- (o original fica guardado aqui) e o histórico (atendimentos, vendas, notas) continua.
CREATE TABLE IF NOT EXISTS clientes_excluidos (
  cliente_id TEXT PRIMARY KEY,
  barbearia_id TEXT NOT NULL,
  nome TEXT NOT NULL,
  telefone_original TEXT,
  motivo TEXT NOT NULL,
  excluido_por TEXT NOT NULL,
  excluido_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (cliente_id) REFERENCES clientes(id)
);
CREATE INDEX IF NOT EXISTS idx_clientes_excluidos ON clientes_excluidos(barbearia_id);
