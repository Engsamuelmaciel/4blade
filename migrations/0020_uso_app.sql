-- 0020: uso do app (pedido de 17/11/2026, fase de testes): o suporte vê COMO a barbearia usa o 4blade —
-- quem está on-line, quando entrou, quanto tempo ficou e quais telas abriu. NADA de dados de clientes ou valores:
-- só o nome da tela (rota) e horários. Só tabelas novas.
-- Um "acesso" = uma sessão de login; o aparelho avisa ao abrir uma tela e a cada minuto com o app aberto e visível.
CREATE TABLE IF NOT EXISTS uso_sessoes (
  sessao_id TEXT PRIMARY KEY,
  barbearia_id TEXT NOT NULL,
  usuario_id TEXT NOT NULL,
  inicio TEXT NOT NULL,                  -- 1º sinal (ISO, UTC)
  ultimo TEXT NOT NULL,                  -- último sinal (on-line = último sinal há menos de 3 minutos)
  telas_qtd INTEGER NOT NULL DEFAULT 0,
  aparelho TEXT                          -- "celular" ou "computador" (pela largura da tela)
);
CREATE INDEX IF NOT EXISTS idx_uso_sessoes ON uso_sessoes(barbearia_id, ultimo);
CREATE TABLE IF NOT EXISTS uso_telas (
  id TEXT PRIMARY KEY,
  barbearia_id TEXT NOT NULL,
  usuario_id TEXT NOT NULL,
  sessao_id TEXT NOT NULL,
  tela TEXT NOT NULL,
  em TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_uso_telas ON uso_telas(barbearia_id, em);
CREATE INDEX IF NOT EXISTS idx_uso_telas_sessao ON uso_telas(sessao_id);
