-- Mensagem livre pelo WhatsApp para clientes do dia (pedido do responsável, 16/11/2026). Só tabelas novas.
-- O sistema prepara um link wa.me por cliente (texto já personalizado); "aberto_em" = quando o botão foi tocado.
CREATE TABLE IF NOT EXISTS mensagens_livres (
  id TEXT PRIMARY KEY,
  barbearia_id TEXT NOT NULL,
  texto TEXT NOT NULL,
  data_ref TEXT NOT NULL,                  -- dia dos clientes escolhidos (AAAA-MM-DD)
  criado_por TEXT NOT NULL,
  criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_mensagens_livres ON mensagens_livres(barbearia_id, criado_em);

CREATE TABLE IF NOT EXISTS mensagens_livres_destinos (
  id TEXT PRIMARY KEY,
  barbearia_id TEXT NOT NULL,
  mensagem_id TEXT NOT NULL,
  agendamento_id TEXT NOT NULL,
  cliente_id TEXT NOT NULL,
  aberto_em TEXT,
  aberto_por TEXT,
  FOREIGN KEY (mensagem_id) REFERENCES mensagens_livres(id)
);
CREATE INDEX IF NOT EXISTS idx_mensagens_livres_destinos ON mensagens_livres_destinos(mensagem_id);
