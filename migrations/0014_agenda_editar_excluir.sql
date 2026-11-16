-- 0014: editar e excluir horário da agenda (pedido de 16/11/2026). Só acrescenta tabelas; nada é apagado.
-- Serviço trocado na edição: a linha antiga continua em agendamento_servicos e é marcada aqui como removida.
CREATE TABLE IF NOT EXISTS agendamento_servicos_removidos (
  linha_id TEXT PRIMARY KEY,
  barbearia_id TEXT NOT NULL,
  agendamento_id TEXT NOT NULL,
  removido_em TEXT NOT NULL,
  removido_por TEXT NOT NULL,
  FOREIGN KEY (linha_id) REFERENCES agendamento_servicos(id)
);
CREATE INDEX IF NOT EXISTS idx_servicos_removidos_agendamento ON agendamento_servicos_removidos(agendamento_id);

-- Horário "excluído" pelo barbeiro/recepção/gestão: some da agenda, mas continua no banco (situação vira cancelado) e auditado.
CREATE TABLE IF NOT EXISTS agendamentos_excluidos (
  agendamento_id TEXT PRIMARY KEY,
  barbearia_id TEXT NOT NULL,
  motivo TEXT NOT NULL,
  situacao_antes TEXT NOT NULL,
  excluido_por TEXT NOT NULL,
  excluido_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (agendamento_id) REFERENCES agendamentos(id)
);
CREATE INDEX IF NOT EXISTS idx_agendamentos_excluidos_barbearia ON agendamentos_excluidos(barbearia_id);
