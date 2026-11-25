-- Aparência da Página da Barbearia (25/11/2026): cor de destaque + aparência (clara, escura, preto e branco).
-- Só tabela nova. A coluna antiga paginas.tema continua (sem linha aqui, a página usa o tema antigo:
-- classico = navalha/escura, claro = navalha/clara, vintage = ferrugem/clara, moderno = indigo/escura).
CREATE TABLE IF NOT EXISTS paginas_aparencia (
  barbearia_id TEXT PRIMARY KEY REFERENCES barbearias(id),
  cor TEXT NOT NULL CHECK (cor IN ('navalha', 'ferrugem', 'indigo', 'ganache', 'berinjela', 'violeta', 'cereja', 'oceano', 'esmeralda', 'bordo')),
  modo TEXT NOT NULL CHECK (modo IN ('claro', 'escuro', 'pb')),
  atualizado_por TEXT,
  atualizado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Mostrar ou não o carrossel "Novidades e promoções" na página (como os horários livres). Padrão: mostra.
ALTER TABLE paginas ADD COLUMN mostrar_novidades INTEGER NOT NULL DEFAULT 1 CHECK (mostrar_novidades IN (0, 1));
