-- Página da Barbearia (24/11/2026): página pública em forblade.com.br/<endereço> para a bio do Instagram.
-- Só tabelas novas. Preço/duração dos serviços, equipe e funcionamento vêm das tabelas que já existem (nada duplicado).

-- Uma página por barbearia.
CREATE TABLE IF NOT EXISTS paginas (
  barbearia_id TEXT PRIMARY KEY REFERENCES barbearias(id),
  slug TEXT NOT NULL UNIQUE,                       -- endereço: forblade.com.br/<slug>
  publicada INTEGER NOT NULL DEFAULT 0 CHECK (publicada IN (0, 1)),
  publicada_em TEXT,                               -- última publicação
  nome_exibicao TEXT,                              -- vazio = nome da barbearia
  frase TEXT,
  sobre TEXT,
  whatsapp TEXT,                                   -- só dígitos com DDD; vazio = telefone da barbearia
  mensagem_padrao TEXT,
  instagram TEXT,                                  -- sem @
  telefone TEXT,
  end_rua TEXT, end_numero TEXT, end_bairro TEXT, end_cidade TEXT, end_uf TEXT, end_cep TEXT,
  maps_url TEXT,
  formas TEXT,                                     -- JSON: ["pix","cartao","dinheiro"]
  tema TEXT NOT NULL DEFAULT 'classico' CHECK (tema IN ('classico', 'claro', 'vintage', 'moderno')),
  mostrar_horarios INTEGER NOT NULL DEFAULT 0 CHECK (mostrar_horarios IN (0, 1)),   -- só se o gerente ligar
  previa_token TEXT, previa_ate TEXT,              -- prévia antes de publicar (link de 30 min)
  criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  atualizado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Endereços antigos: continuam levando para o novo por 90 dias (link já postado não quebra).
CREATE TABLE IF NOT EXISTS paginas_slugs_antigos (
  slug TEXT PRIMARY KEY,
  barbearia_id TEXT NOT NULL REFERENCES barbearias(id),
  valido_ate TEXT NOT NULL,
  criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Serviços na página (mostrar, ordem e descrição curta). Preço e duração vêm de servicos.
-- Serviço sem linha aqui aparece (serviço novo entra sozinho); visivel = 0 esconde.
CREATE TABLE IF NOT EXISTS paginas_servicos (
  barbearia_id TEXT NOT NULL REFERENCES barbearias(id),
  servico_id TEXT NOT NULL REFERENCES servicos(id),
  visivel INTEGER NOT NULL DEFAULT 1 CHECK (visivel IN (0, 1)),
  ordem INTEGER NOT NULL DEFAULT 0,
  descricao TEXT,
  PRIMARY KEY (barbearia_id, servico_id)
);

-- Profissionais na página (especialidade e foto). Sem linha = não aparece (o gerente escolhe quem mostrar).
CREATE TABLE IF NOT EXISTS paginas_equipe (
  barbearia_id TEXT NOT NULL REFERENCES barbearias(id),
  usuario_id TEXT NOT NULL REFERENCES usuarios(id),
  visivel INTEGER NOT NULL DEFAULT 1 CHECK (visivel IN (0, 1)),
  ordem INTEGER NOT NULL DEFAULT 0,
  especialidade TEXT,
  PRIMARY KEY (barbearia_id, usuario_id)
);

-- Fotos (o arquivo fica no armazenamento de arquivos; aqui o registro). Removida = arquivo apagado, registro guardado.
CREATE TABLE IF NOT EXISTS paginas_fotos (
  id TEXT PRIMARY KEY,
  barbearia_id TEXT NOT NULL REFERENCES barbearias(id),
  tipo TEXT NOT NULL CHECK (tipo IN ('logo', 'capa', 'galeria', 'equipe')),
  usuario_id TEXT REFERENCES usuarios(id),         -- foto de profissional (tipo equipe)
  mime TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  legenda TEXT,
  ordem INTEGER NOT NULL DEFAULT 0,
  criado_por TEXT REFERENCES usuarios(id),
  criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  removida_em TEXT,
  removida_por TEXT REFERENCES usuarios(id)
);
CREATE INDEX IF NOT EXISTS paginas_fotos_barbearia ON paginas_fotos(barbearia_id, tipo, removida_em);

-- Números da página por dia (anônimos: nada de IP nem dados de quem visitou).
CREATE TABLE IF NOT EXISTS paginas_eventos (
  barbearia_id TEXT NOT NULL REFERENCES barbearias(id),
  dia TEXT NOT NULL,
  tipo TEXT NOT NULL CHECK (tipo IN ('visita', 'whatsapp', 'rota', 'instagram')),
  quantidade INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (barbearia_id, dia, tipo)
);
