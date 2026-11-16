-- Desconto na venda de produtos (pedido do responsável, 16/11/2026). Só tabela nova: nada é alterado nem apagado.
-- vendas.total_centavos guarda o valor FINAL (já com desconto); aqui fica o bruto, o % e o valor do desconto, e quem lançou.
CREATE TABLE IF NOT EXISTS venda_descontos (
  venda_id TEXT PRIMARY KEY,
  barbearia_id TEXT NOT NULL,
  bruto_centavos INTEGER NOT NULL CHECK (bruto_centavos > 0),
  percentual_bp INTEGER NOT NULL CHECK (percentual_bp > 0 AND percentual_bp < 10000),   -- centésimos de % (1000 = 10%)
  valor_centavos INTEGER NOT NULL CHECK (valor_centavos >= 0),
  criado_por TEXT NOT NULL,
  criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (venda_id) REFERENCES vendas(id)
);
CREATE INDEX IF NOT EXISTS idx_venda_descontos_barbearia ON venda_descontos(barbearia_id);
