-- 0019: pagamento da equipe (pedido de 17/11/2026). Só tabelas novas.
-- Salário fixo mensal de cada pessoa da equipe (0 = só comissão). Mudanças ficam na auditoria (antes/depois).
CREATE TABLE IF NOT EXISTS usuarios_salarios (
  usuario_id TEXT PRIMARY KEY,
  barbearia_id TEXT NOT NULL,
  salario_centavos INTEGER NOT NULL DEFAULT 0 CHECK (salario_centavos >= 0),
  atualizado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  atualizado_por TEXT NOT NULL,
  FOREIGN KEY (usuario_id) REFERENCES usuarios(id)
);
CREATE INDEX IF NOT EXISTS idx_usuarios_salarios_barbearia ON usuarios_salarios(barbearia_id);
-- Salário pago = uma despesa (conta paga) ligada ao colaborador e ao mês de competência: entra sozinho nos relatórios.
-- Um salário por pessoa por mês (a conta pode ser cancelada com motivo; aí o vínculo continua, para o histórico).
CREATE TABLE IF NOT EXISTS contas_pessoal (
  conta_id TEXT PRIMARY KEY,
  barbearia_id TEXT NOT NULL,
  usuario_id TEXT NOT NULL,
  competencia TEXT NOT NULL,              -- AAAA-MM
  FOREIGN KEY (conta_id) REFERENCES contas(id),
  FOREIGN KEY (usuario_id) REFERENCES usuarios(id)
);
CREATE INDEX IF NOT EXISTS idx_contas_pessoal ON contas_pessoal(barbearia_id, usuario_id, competencia);
