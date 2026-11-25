-- Flyers de divulgação (25/11/2026): imagem pronta (gerada no aparelho) publicada no catálogo da barbearia.
-- Só tabela nova; nada é apagado: "excluir" marca removido_em (o arquivo no R2 é apagado e o registro fica).
CREATE TABLE IF NOT EXISTS paginas_flyers (
  id TEXT PRIMARY KEY,
  barbearia_id TEXT NOT NULL REFERENCES barbearias(id),
  titulo TEXT NOT NULL,                 -- texto principal (vai no catálogo, no link e na legenda)
  texto TEXT,                           -- detalhe / descrição curta
  estilo TEXT NOT NULL,
  formato TEXT NOT NULL CHECK (formato IN ('story', 'quadrado', 'retrato')),
  dados TEXT,                           -- campos do gerador (JSON) para refazer/duplicar
  mime TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  validade TEXT,                        -- AAAA-MM-DD: depois dessa data sai do catálogo sozinho
  publicado INTEGER NOT NULL DEFAULT 1 CHECK (publicado IN (0, 1)),
  criado_por TEXT REFERENCES usuarios(id),
  criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  atualizado_em TEXT,
  removido_em TEXT,
  removido_por TEXT REFERENCES usuarios(id)
);
CREATE INDEX IF NOT EXISTS paginas_flyers_barbearia ON paginas_flyers(barbearia_id, removido_em, publicado);
