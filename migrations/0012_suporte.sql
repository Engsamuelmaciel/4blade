-- Suporte do 4blade (pedido do responsável, 16/11/2026): chamados abertos pelo proprietário/gerente e respondidos
-- pela plataforma, em forma de conversa. Nada é apagado: o chamado é encerrado (e reaberto se o cliente responder).
CREATE TABLE IF NOT EXISTS suporte_chamados (
  id TEXT PRIMARY KEY,
  numero INTEGER NOT NULL UNIQUE,                 -- número curto para falar ao telefone (#123)
  barbearia_id TEXT NOT NULL REFERENCES barbearias(id),
  aberto_por TEXT NOT NULL REFERENCES usuarios(id),
  categoria TEXT NOT NULL CHECK (categoria IN ('duvida', 'problema', 'assinatura', 'sugestao')),
  assunto TEXT NOT NULL,
  situacao TEXT NOT NULL DEFAULT 'aguardando_suporte'
    CHECK (situacao IN ('aguardando_suporte', 'respondido', 'encerrado')),
  tela TEXT,                                       -- tela em que a pessoa estava (ajuda o suporte)
  criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  atualizado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  encerrado_em TEXT,
  encerrado_por TEXT REFERENCES usuarios(id)
);
CREATE INDEX IF NOT EXISTS suporte_chamados_barbearia ON suporte_chamados(barbearia_id, atualizado_em);
CREATE INDEX IF NOT EXISTS suporte_chamados_situacao ON suporte_chamados(situacao, atualizado_em);

CREATE TABLE IF NOT EXISTS suporte_mensagens (
  id TEXT PRIMARY KEY,
  chamado_id TEXT NOT NULL REFERENCES suporte_chamados(id),
  barbearia_id TEXT NOT NULL REFERENCES barbearias(id),
  autor_id TEXT NOT NULL REFERENCES usuarios(id),
  lado TEXT NOT NULL CHECK (lado IN ('barbearia', 'suporte')),
  texto TEXT NOT NULL,
  criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS suporte_mensagens_chamado ON suporte_mensagens(chamado_id, criado_em);

-- Configurações da PLATAFORMA (não são de nenhuma barbearia): contato do suporte (WhatsApp, e-mail, horário).
CREATE TABLE IF NOT EXISTS plataforma_config (
  chave TEXT PRIMARY KEY,
  valor TEXT NOT NULL,
  atualizado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  atualizado_por TEXT REFERENCES usuarios(id)
);
