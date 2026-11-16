-- 4blade — Migração 0005: horários fixos (recorrência semanal) — pedido do responsável em 16/11/2026.
-- Só tabelas novas. Cada ocorrência continua sendo um agendamento normal; a série só agrupa.

CREATE TABLE IF NOT EXISTS agendamento_series (
  id TEXT PRIMARY KEY,
  barbearia_id TEXT NOT NULL,
  barbeiro_id TEXT NOT NULL,
  cliente_id TEXT NOT NULL,
  intervalo_semanas INTEGER NOT NULL CHECK (intervalo_semanas BETWEEN 1 AND 4),
  hora TEXT NOT NULL,
  data_ini TEXT NOT NULL,
  data_fim TEXT NOT NULL,
  ativo INTEGER NOT NULL DEFAULT 1 CHECK (ativo IN (0, 1)),
  motivo_encerramento TEXT,
  criado_por TEXT NOT NULL,
  criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (barbearia_id) REFERENCES barbearias(id)
);
CREATE INDEX IF NOT EXISTS idx_series ON agendamento_series(barbearia_id, barbeiro_id, ativo);

CREATE TABLE IF NOT EXISTS agendamento_serie_itens (
  serie_id TEXT NOT NULL,
  agendamento_id TEXT NOT NULL UNIQUE,
  barbearia_id TEXT NOT NULL,
  FOREIGN KEY (serie_id) REFERENCES agendamento_series(id),
  FOREIGN KEY (agendamento_id) REFERENCES agendamentos(id)
);
CREATE INDEX IF NOT EXISTS idx_serie_itens ON agendamento_serie_itens(serie_id);
