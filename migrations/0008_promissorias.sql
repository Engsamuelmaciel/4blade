-- Promissória ("notinha", fiado): cliente leva o serviço/produto e paga depois (pedido do responsável, 16/11/2026).
-- Só tabelas novas. O valor NÃO entra no caixa do dia; entra no caixa do dia em que a nota for quitada (recebimento).
-- Nada é apagado: nota estornada (atendimento reaberto/venda cancelada) ou recebimento estornado ficam registrados.
CREATE TABLE IF NOT EXISTS promissorias (
  id TEXT PRIMARY KEY,
  barbearia_id TEXT NOT NULL,
  cliente_id TEXT NOT NULL,
  origem TEXT NOT NULL CHECK (origem IN ('atendimento', 'venda')),
  finalizacao_id TEXT,
  venda_id TEXT,
  caixa_id TEXT NOT NULL,                    -- caixa do dia em que a nota foi feita
  valor_centavos INTEGER NOT NULL CHECK (valor_centavos > 0),
  descricao TEXT NOT NULL,
  situacao TEXT NOT NULL DEFAULT 'aberta' CHECK (situacao IN ('aberta', 'quitada', 'estornada')),
  recebimento_id TEXT,
  motivo_estorno TEXT,
  criado_por TEXT NOT NULL,
  criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (cliente_id) REFERENCES clientes(id)
);
CREATE INDEX IF NOT EXISTS idx_promissorias_cliente ON promissorias(barbearia_id, cliente_id, situacao);
CREATE INDEX IF NOT EXISTS idx_promissorias_situacao ON promissorias(barbearia_id, situacao);

CREATE TABLE IF NOT EXISTS promissoria_recebimentos (
  id TEXT PRIMARY KEY,
  barbearia_id TEXT NOT NULL,
  cliente_id TEXT NOT NULL,
  caixa_id TEXT NOT NULL,                    -- caixa do dia em que o dinheiro entrou
  total_centavos INTEGER NOT NULL CHECK (total_centavos > 0),
  situacao TEXT NOT NULL DEFAULT 'ativo' CHECK (situacao IN ('ativo', 'estornado')),
  motivo_estorno TEXT,
  estornado_por TEXT,
  estornado_em TEXT,
  criado_por TEXT NOT NULL,
  criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_promissoria_receb_caixa ON promissoria_recebimentos(barbearia_id, caixa_id);

CREATE TABLE IF NOT EXISTS promissoria_pagamentos (
  id TEXT PRIMARY KEY,
  barbearia_id TEXT NOT NULL,
  recebimento_id TEXT NOT NULL,
  caixa_id TEXT NOT NULL,
  forma TEXT NOT NULL CHECK (forma IN ('dinheiro', 'pix', 'debito', 'credito')),
  valor_centavos INTEGER NOT NULL CHECK (valor_centavos > 0),
  FOREIGN KEY (recebimento_id) REFERENCES promissoria_recebimentos(id)
);
CREATE INDEX IF NOT EXISTS idx_promissoria_pag ON promissoria_pagamentos(recebimento_id);
