-- Abertura em caráter especial (26/11/2026): a barbearia abre num dia que normalmente não abre (ex.: domingo antes do Natal)
-- ou com horário diferente. Vale para a agenda e para a página pública. Nada é apagado: cancelar guarda o motivo.
CREATE TABLE IF NOT EXISTS aberturas_especiais (
  id TEXT PRIMARY KEY,
  barbearia_id TEXT NOT NULL,
  data TEXT NOT NULL,
  abre_min INTEGER NOT NULL,
  fecha_min INTEGER NOT NULL,
  intervalo_ini_min INTEGER,
  intervalo_fim_min INTEGER,
  motivo TEXT NOT NULL,
  ativo INTEGER NOT NULL DEFAULT 1 CHECK (ativo IN (0, 1)),
  motivo_cancelamento TEXT,
  criado_por TEXT NOT NULL,
  criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (barbearia_id) REFERENCES barbearias(id)
);
-- No máximo uma abertura especial ATIVA por dia e por barbearia.
CREATE UNIQUE INDEX IF NOT EXISTS idx_aberturas_especiais_dia ON aberturas_especiais(barbearia_id, data) WHERE ativo = 1;
CREATE INDEX IF NOT EXISTS idx_aberturas_especiais_barbearia ON aberturas_especiais(barbearia_id, ativo, data);
