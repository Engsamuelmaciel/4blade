-- Modelo da Página da Barbearia (27/11/2026): "classico" (o de sempre) ou "impacto" (capa em tela cheia, cardápio com
-- barra de pedido, galeria grande, equipe com "Agendar com"). Só tabela nova; sem linha = clássico.
CREATE TABLE IF NOT EXISTS paginas_modelo (
  barbearia_id TEXT PRIMARY KEY REFERENCES barbearias(id),
  modelo TEXT NOT NULL CHECK (modelo IN ('classico', 'impacto')),
  atualizado_por TEXT,
  atualizado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
