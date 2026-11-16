-- 4blade — Migração 0004: gestão (E4): comissão de produto, vales, fechamento de comissão, contas a pagar,
-- contato do contador e registro dos envios ao contador. Só tabelas novas. Dinheiro em centavos.

-- Comissão sobre produto vendido pelo barbeiro/gerente (% de produto de cada um, guardado na hora da venda).
CREATE TABLE IF NOT EXISTS comissoes_produto (
  id TEXT PRIMARY KEY,
  barbearia_id TEXT NOT NULL,
  barbeiro_id TEXT NOT NULL,
  venda_id TEXT NOT NULL UNIQUE,
  base_centavos INTEGER NOT NULL,
  percentual_bp INTEGER NOT NULL,
  valor_centavos INTEGER NOT NULL,
  estornada INTEGER NOT NULL DEFAULT 0 CHECK (estornada IN (0, 1)),
  criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (venda_id) REFERENCES vendas(id)
);
CREATE INDEX IF NOT EXISTS idx_comissoes_produto ON comissoes_produto(barbearia_id, barbeiro_id, estornada);

-- Vales (adiantamentos) lançados pelo gerente. Cancelar com motivo; nunca apagar.
CREATE TABLE IF NOT EXISTS vales (
  id TEXT PRIMARY KEY,
  barbearia_id TEXT NOT NULL,
  barbeiro_id TEXT NOT NULL,
  data TEXT NOT NULL,
  valor_centavos INTEGER NOT NULL CHECK (valor_centavos > 0),
  descricao TEXT,
  situacao TEXT NOT NULL DEFAULT 'ativo' CHECK (situacao IN ('ativo', 'cancelado')),
  motivo_cancelamento TEXT,
  criado_por TEXT NOT NULL,
  criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_vales ON vales(barbearia_id, barbeiro_id, data);

-- Fechamento de comissão por barbeiro e período: comissões − vales = a pagar. Fechado não muda.
CREATE TABLE IF NOT EXISTS fechamentos_comissao (
  id TEXT PRIMARY KEY,
  barbearia_id TEXT NOT NULL,
  barbeiro_id TEXT NOT NULL,
  data_ini TEXT NOT NULL,
  data_fim TEXT NOT NULL,
  comissao_servico_centavos INTEGER NOT NULL,
  comissao_produto_centavos INTEGER NOT NULL,
  vales_centavos INTEGER NOT NULL,
  a_pagar_centavos INTEGER NOT NULL,
  pago_em TEXT,
  pago_por TEXT,
  pago_com_caixa INTEGER NOT NULL DEFAULT 0,
  criado_por TEXT NOT NULL,
  criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_fechamentos_comissao ON fechamentos_comissao(barbearia_id, barbeiro_id, data_ini);

-- O que entrou em cada fechamento. Cada comissão/vale entra em no máximo UM fechamento.
CREATE TABLE IF NOT EXISTS fechamento_comissao_itens (
  fechamento_id TEXT NOT NULL,
  barbearia_id TEXT NOT NULL,
  tipo TEXT NOT NULL CHECK (tipo IN ('servico', 'produto', 'vale')),
  ref_id TEXT NOT NULL,
  valor_centavos INTEGER NOT NULL,
  UNIQUE (tipo, ref_id),
  FOREIGN KEY (fechamento_id) REFERENCES fechamentos_comissao(id)
);
CREATE INDEX IF NOT EXISTS idx_fechamento_itens ON fechamento_comissao_itens(fechamento_id);

-- Contas a pagar. "Pago com dinheiro do caixa" vira sangria no caixa aberto (caixa_movimento_id).
CREATE TABLE IF NOT EXISTS contas (
  id TEXT PRIMARY KEY,
  barbearia_id TEXT NOT NULL,
  descricao TEXT NOT NULL,
  categoria TEXT NOT NULL CHECK (categoria IN ('aluguel', 'luz', 'agua', 'fornecedor', 'outros')),
  valor_centavos INTEGER NOT NULL CHECK (valor_centavos > 0),
  vencimento TEXT NOT NULL,
  recorrente INTEGER NOT NULL DEFAULT 0 CHECK (recorrente IN (0, 1)),
  situacao TEXT NOT NULL DEFAULT 'aberta' CHECK (situacao IN ('aberta', 'paga', 'cancelada')),
  pago_em TEXT,
  pago_por TEXT,
  caixa_movimento_id TEXT,
  conta_origem_id TEXT,
  motivo_cancelamento TEXT,
  criado_por TEXT NOT NULL,
  criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_contas ON contas(barbearia_id, situacao, vencimento);
-- A conta recorrente gera a do mês seguinte uma vez só.
CREATE UNIQUE INDEX IF NOT EXISTS idx_contas_origem ON contas(conta_origem_id) WHERE conta_origem_id IS NOT NULL;

-- Configurações da barbearia (contato do contador).
CREATE TABLE IF NOT EXISTS configuracoes (
  barbearia_id TEXT PRIMARY KEY,
  contador_nome TEXT,
  contador_telefone TEXT,
  contador_email TEXT,
  atualizado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Cada envio ao contador fica registrado com uma "impressão digital" dos dados do período:
-- se algo do período mudar depois, a tela avisa "houve alteração depois do envio; gere de novo".
CREATE TABLE IF NOT EXISTS envios_contador (
  id TEXT PRIMARY KEY,
  barbearia_id TEXT NOT NULL,
  tipo TEXT NOT NULL CHECK (tipo IN ('mes', 'ano')),
  referencia TEXT NOT NULL,
  data_ini TEXT NOT NULL,
  data_fim TEXT NOT NULL,
  impressao TEXT NOT NULL,
  criado_por TEXT NOT NULL,
  criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_envios_contador ON envios_contador(barbearia_id, criado_em);
