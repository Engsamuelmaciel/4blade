-- 0015: material de uso da barbearia (lâminas, cremes… controlados no estoque, não vendidos) e despesa (conta) que
-- já lança o material no estoque (pedidos de 16/11/2026). Só tabelas novas; nada é apagado.
CREATE TABLE IF NOT EXISTS produtos_uso_interno (
  produto_id TEXT PRIMARY KEY,
  barbearia_id TEXT NOT NULL,
  criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (produto_id) REFERENCES produtos(id)
);
CREATE INDEX IF NOT EXISTS idx_produtos_uso_interno_barbearia ON produtos_uso_interno(barbearia_id);

-- Item de estoque lançado junto com uma conta (despesa): a entrada no estoque fica ligada à conta.
-- Nos relatórios a despesa conta uma vez só (pela conta), não de novo como "compra de mercadoria".
CREATE TABLE IF NOT EXISTS contas_estoque (
  id TEXT PRIMARY KEY,
  barbearia_id TEXT NOT NULL,
  conta_id TEXT NOT NULL,
  produto_id TEXT NOT NULL,
  quantidade INTEGER NOT NULL CHECK (quantidade > 0),
  custo_unit_centavos INTEGER NOT NULL CHECK (custo_unit_centavos >= 0),
  movimento_id TEXT NOT NULL UNIQUE,
  estornado_movimento_id TEXT,
  criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (conta_id) REFERENCES contas(id),
  FOREIGN KEY (produto_id) REFERENCES produtos(id)
);
CREATE INDEX IF NOT EXISTS idx_contas_estoque_conta ON contas_estoque(conta_id);
