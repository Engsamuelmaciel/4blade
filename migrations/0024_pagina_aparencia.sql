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

-- Opções da página que não cabem na tabela antiga. Sem linha = padrão (mostra o carrossel "Novidades e promoções").
CREATE TABLE IF NOT EXISTS paginas_opcoes (
  barbearia_id TEXT PRIMARY KEY REFERENCES barbearias(id),
  mostrar_novidades INTEGER NOT NULL DEFAULT 1 CHECK (mostrar_novidades IN (0, 1)),
  atualizado_por TEXT,
  atualizado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
