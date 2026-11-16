-- 4blade — Migração 0003: caixa completo (vendas, sangria, suprimento, correção de forma, fechamento) e estoque (E3).
-- Só cria tabelas novas (nada é alterado nem apagado nas existentes). Dinheiro em centavos.

-- Saldo atual de cada produto. CHECK impede saldo negativo: venda sem saldo falha e nada é gravado.
CREATE TABLE IF NOT EXISTS produto_estoque (
  produto_id TEXT PRIMARY KEY,
  barbearia_id TEXT NOT NULL,
  saldo INTEGER NOT NULL DEFAULT 0 CHECK (saldo >= 0),
  atualizado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (produto_id) REFERENCES produtos(id)
);
CREATE INDEX IF NOT EXISTS idx_produto_estoque ON produto_estoque(barbearia_id);

-- Histórico por produto: entradas, vendas, cancelamentos, ajustes e inventário.
CREATE TABLE IF NOT EXISTS estoque_movimentos (
  id TEXT PRIMARY KEY,
  barbearia_id TEXT NOT NULL,
  produto_id TEXT NOT NULL,
  tipo TEXT NOT NULL CHECK (tipo IN ('entrada', 'venda', 'cancelamento_venda', 'ajuste', 'inventario')),
  quantidade INTEGER NOT NULL,              -- positivo entra, negativo sai
  custo_unit_centavos INTEGER,              -- entrada: custo pago; venda: custo médio na hora
  custo_medio_apos_centavos INTEGER,
  fornecedor TEXT,
  validade TEXT,
  motivo TEXT,
  venda_id TEXT,
  criado_por TEXT NOT NULL,
  criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (produto_id) REFERENCES produtos(id)
);
CREATE INDEX IF NOT EXISTS idx_estoque_mov_produto ON estoque_movimentos(barbearia_id, produto_id, criado_em);

-- Vendas de produto (avulsas no caixa ou feitas pelo barbeiro). Cancelar devolve o estoque; nada é apagado.
CREATE TABLE IF NOT EXISTS vendas (
  id TEXT PRIMARY KEY,
  barbearia_id TEXT NOT NULL,
  caixa_id TEXT NOT NULL,
  vendedor_id TEXT NOT NULL,                -- quem vendeu (comissão de produto do barbeiro: E4)
  cliente_id TEXT,
  agendamento_id TEXT,
  total_centavos INTEGER NOT NULL CHECK (total_centavos >= 0),
  situacao TEXT NOT NULL DEFAULT 'ativa' CHECK (situacao IN ('ativa', 'cancelada')),
  motivo_cancelamento TEXT,
  cancelada_por TEXT,
  cancelada_em TEXT,
  criado_por TEXT NOT NULL,
  criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (caixa_id) REFERENCES caixas(id)
);
CREATE INDEX IF NOT EXISTS idx_vendas_caixa ON vendas(barbearia_id, caixa_id);

CREATE TABLE IF NOT EXISTS venda_itens (
  id TEXT PRIMARY KEY,
  barbearia_id TEXT NOT NULL,
  venda_id TEXT NOT NULL,
  produto_id TEXT NOT NULL,
  nome TEXT NOT NULL,
  quantidade INTEGER NOT NULL CHECK (quantidade > 0),
  preco_unit_centavos INTEGER NOT NULL,
  custo_unit_centavos INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (venda_id) REFERENCES vendas(id)
);
CREATE INDEX IF NOT EXISTS idx_venda_itens ON venda_itens(venda_id);

-- Demais movimentos do caixa (os atendimentos ficam em caixa_lancamentos, da E2).
-- correcao_saida/correcao_entrada: troca de forma de pagamento (sai da forma antiga, entra na nova), ligada ao lançamento original.
CREATE TABLE IF NOT EXISTS caixa_movimentos (
  id TEXT PRIMARY KEY,
  barbearia_id TEXT NOT NULL,
  caixa_id TEXT NOT NULL,
  tipo TEXT NOT NULL CHECK (tipo IN ('venda', 'estorno_venda', 'sangria', 'suprimento', 'correcao_saida', 'correcao_entrada')),
  forma TEXT NOT NULL CHECK (forma IN ('dinheiro', 'pix', 'debito', 'credito')),
  valor_centavos INTEGER NOT NULL,          -- com sinal: entra (+) ou sai (−)
  venda_id TEXT,
  referencia_id TEXT,                       -- lançamento corrigido (caixa_lancamentos.id ou caixa_movimentos.id)
  motivo TEXT,
  criado_por TEXT NOT NULL,
  criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (caixa_id) REFERENCES caixas(id)
);
CREATE INDEX IF NOT EXISTS idx_caixa_movimentos ON caixa_movimentos(caixa_id);
CREATE INDEX IF NOT EXISTS idx_caixa_movimentos_ref ON caixa_movimentos(referencia_id);

-- Fechamentos do caixa. Reabrir (só gerente, com motivo) desativa o fechamento; nada é apagado.
CREATE TABLE IF NOT EXISTS caixa_fechamentos (
  id TEXT PRIMARY KEY,
  barbearia_id TEXT NOT NULL,
  caixa_id TEXT NOT NULL,
  esperado_dinheiro_centavos INTEGER NOT NULL,
  contado_dinheiro_centavos INTEGER NOT NULL,
  diferenca_centavos INTEGER NOT NULL,      -- contado − esperado (negativo = falta)
  totais_json TEXT NOT NULL,                -- totais por forma, sangrias, suprimentos (foto do fechamento)
  observacao TEXT,
  fechado_por TEXT NOT NULL,
  fechado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ativo INTEGER NOT NULL DEFAULT 1 CHECK (ativo IN (0, 1)),
  reaberto_por TEXT,
  reaberto_em TEXT,
  motivo_reabertura TEXT,
  FOREIGN KEY (caixa_id) REFERENCES caixas(id)
);
CREATE INDEX IF NOT EXISTS idx_caixa_fechamentos ON caixa_fechamentos(caixa_id, ativo);
