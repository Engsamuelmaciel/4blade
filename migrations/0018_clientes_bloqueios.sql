-- 0018: bloquear cliente (pedido de 17/11/2026, tela "Visão do dia"). Cliente bloqueado não marca horário novo.
-- Nada é apagado: desbloquear marca ativo = 0 e guarda quem/quando/motivo; o histórico completo fica na auditoria.
CREATE TABLE IF NOT EXISTS clientes_bloqueios (
  cliente_id TEXT PRIMARY KEY,
  barbearia_id TEXT NOT NULL,
  ativo INTEGER NOT NULL DEFAULT 1 CHECK (ativo IN (0, 1)),
  motivo TEXT NOT NULL,
  bloqueado_por TEXT NOT NULL,
  bloqueado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  desbloqueado_por TEXT,
  desbloqueado_em TEXT,
  motivo_desbloqueio TEXT,
  FOREIGN KEY (cliente_id) REFERENCES clientes(id)
);
CREATE INDEX IF NOT EXISTS idx_clientes_bloqueios_barbearia ON clientes_bloqueios(barbearia_id, ativo);
