-- Mensagem de confirmação de horário e envio para clientes cadastrados (pedido do responsável, 16/11/2026).
-- Só tabelas novas (as antigas aceitam só lembrete/proposta e horários do dia; nada é alterado).
-- Modelos adicionais (hoje: 'confirmacao'); sem registro = texto padrão do sistema.
CREATE TABLE IF NOT EXISTS modelos_mensagem_adicionais (
  id TEXT PRIMARY KEY,
  barbearia_id TEXT NOT NULL,
  tipo TEXT NOT NULL,
  texto TEXT NOT NULL,
  atualizado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (barbearia_id, tipo)
);
-- Envio (abertura no WhatsApp) dos modelos adicionais a partir de um horário da agenda.
CREATE TABLE IF NOT EXISTS mensagens_enviadas_adicionais (
  id TEXT PRIMARY KEY,
  barbearia_id TEXT NOT NULL,
  agendamento_id TEXT NOT NULL,
  tipo TEXT NOT NULL,
  usuario_id TEXT NOT NULL,
  criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_mensagens_adicionais ON mensagens_enviadas_adicionais(agendamento_id);
-- Mensagem livre para clientes cadastrados (sem horário): um destino por cliente.
CREATE TABLE IF NOT EXISTS mensagens_livres_contatos (
  id TEXT PRIMARY KEY,
  barbearia_id TEXT NOT NULL,
  mensagem_id TEXT NOT NULL,
  cliente_id TEXT NOT NULL,
  aberto_em TEXT,
  aberto_por TEXT
);
CREATE INDEX IF NOT EXISTS idx_mensagens_livres_contatos ON mensagens_livres_contatos(mensagem_id);
