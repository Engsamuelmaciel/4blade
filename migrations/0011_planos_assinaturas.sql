-- Planos novos (Básico, Standard, Pro) e assinatura pelo Asaas (cadastro feito pela própria barbearia).
-- Só tabelas novas: a coluna antiga barbearias.plano (CHECK basico|profissional) continua lá e não é mais a referência
-- quando existe linha aqui. Sem linha: 'profissional' vale como 'pro' e 'basico' como 'basico'.

CREATE TABLE IF NOT EXISTS assinaturas (
  barbearia_id TEXT PRIMARY KEY REFERENCES barbearias(id),
  plano TEXT NOT NULL CHECK (plano IN ('basico', 'standard', 'pro')),
  ciclo TEXT NOT NULL DEFAULT 'mensal' CHECK (ciclo IN ('mensal', 'anual')),
  site_horarios INTEGER NOT NULL DEFAULT 0 CHECK (site_horarios IN (0, 1)),   -- adicional do Standard
  valor_centavos INTEGER NOT NULL DEFAULT 0 CHECK (valor_centavos >= 0),
  origem TEXT NOT NULL DEFAULT 'manual' CHECK (origem IN ('manual', 'asaas')),   -- manual = criada pela plataforma
  -- dados de cobrança (só origem asaas)
  documento TEXT,                     -- CPF (11) ou CNPJ (14) só com números
  email TEXT,
  asaas_cliente_id TEXT,
  asaas_assinatura_id TEXT UNIQUE,
  teste_ate TEXT,                     -- último dia grátis (AAAA-MM-DD)
  pago_ate TEXT,                      -- último dia coberto (teste ou mensalidade paga)
  proximo_vencimento TEXT,
  link_pagamento TEXT,
  ultimo_pagamento_em TEXT,
  cancelada INTEGER NOT NULL DEFAULT 0 CHECK (cancelada IN (0, 1)),
  cancelada_em TEXT,
  motivo_cancelamento TEXT,
  termos_versao TEXT,
  termos_aceitos_em TEXT,
  termos_ip_hash TEXT,
  criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  atualizado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS assinaturas_documento ON assinaturas(documento) WHERE documento IS NOT NULL;

-- Avisos recebidos do Asaas (webhook). O id do evento é único: o mesmo aviso repetido não é processado 2 vezes.
CREATE TABLE IF NOT EXISTS assinatura_eventos (
  id TEXT PRIMARY KEY,
  barbearia_id TEXT REFERENCES barbearias(id),   -- NULL quando o aviso não é de nenhuma barbearia nossa
  evento TEXT NOT NULL,
  pagamento_id TEXT,
  assinatura_id TEXT,
  situacao TEXT,
  vencimento TEXT,
  valor_centavos INTEGER,
  resultado TEXT,
  recebido_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS assinatura_eventos_barbearia ON assinatura_eventos(barbearia_id, recebido_em);
