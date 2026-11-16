-- 4blade — Migração 0002: agenda, funcionamento, finalização de atendimento e abertura de caixa (E2).
-- Horários em minutos desde 00:00 (540 = 09:00). Início/fim de horários marcados em hora LOCAL de Brasília,
-- no formato 'AAAA-MM-DDTHH:MM' (comparação de texto = comparação de horário). Dinheiro em centavos.

-- Funcionamento semanal da barbearia (dia 0 = domingo ... 6 = sábado).
CREATE TABLE IF NOT EXISTS funcionamento (
  barbearia_id TEXT NOT NULL,
  dia_semana INTEGER NOT NULL CHECK (dia_semana BETWEEN 0 AND 6),
  aberto INTEGER NOT NULL DEFAULT 0 CHECK (aberto IN (0, 1)),
  abre_min INTEGER,
  fecha_min INTEGER,
  intervalo_ini_min INTEGER,
  intervalo_fim_min INTEGER,
  atualizado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (barbearia_id, dia_semana),
  FOREIGN KEY (barbearia_id) REFERENCES barbearias(id)
);

-- Feriados, folga coletiva, reforma: a agenda não aceita horário nesses dias.
CREATE TABLE IF NOT EXISTS datas_fechadas (
  id TEXT PRIMARY KEY,
  barbearia_id TEXT NOT NULL,
  data_ini TEXT NOT NULL,
  data_fim TEXT NOT NULL,
  motivo TEXT NOT NULL,
  ativo INTEGER NOT NULL DEFAULT 1 CHECK (ativo IN (0, 1)),
  motivo_desativacao TEXT,
  criado_por TEXT NOT NULL,
  criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (barbearia_id) REFERENCES barbearias(id)
);
CREATE INDEX IF NOT EXISTS idx_datas_fechadas ON datas_fechadas(barbearia_id, ativo, data_ini);

-- Horário de trabalho de quem atende (gerente/barbeiro). Sem linhas = segue o funcionamento da barbearia.
CREATE TABLE IF NOT EXISTS horario_trabalho (
  barbearia_id TEXT NOT NULL,
  usuario_id TEXT NOT NULL,
  dia_semana INTEGER NOT NULL CHECK (dia_semana BETWEEN 0 AND 6),
  trabalha INTEGER NOT NULL DEFAULT 0 CHECK (trabalha IN (0, 1)),
  ini_min INTEGER,
  fim_min INTEGER,
  atualizado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (usuario_id, dia_semana),
  FOREIGN KEY (barbearia_id) REFERENCES barbearias(id),
  FOREIGN KEY (usuario_id) REFERENCES usuarios(id)
);

-- Bloqueios na agenda (almoço, folga, férias, compromisso). Cancelar com motivo, nunca apagar.
CREATE TABLE IF NOT EXISTS bloqueios (
  id TEXT PRIMARY KEY,
  barbearia_id TEXT NOT NULL,
  barbeiro_id TEXT NOT NULL,
  inicio TEXT NOT NULL,
  fim TEXT NOT NULL,
  motivo TEXT,
  ativo INTEGER NOT NULL DEFAULT 1 CHECK (ativo IN (0, 1)),
  motivo_cancelamento TEXT,
  criado_por TEXT NOT NULL,
  criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (barbearia_id) REFERENCES barbearias(id),
  FOREIGN KEY (barbeiro_id) REFERENCES usuarios(id)
);
CREATE INDEX IF NOT EXISTS idx_bloqueios ON bloqueios(barbearia_id, barbeiro_id, ativo, inicio);

CREATE TABLE IF NOT EXISTS agendamentos (
  id TEXT PRIMARY KEY,
  barbearia_id TEXT NOT NULL,
  barbeiro_id TEXT NOT NULL,
  cliente_id TEXT NOT NULL,
  data TEXT NOT NULL,
  inicio TEXT NOT NULL,
  fim TEXT NOT NULL,
  situacao TEXT NOT NULL DEFAULT 'agendado' CHECK (situacao IN ('agendado', 'finalizado', 'faltou', 'cancelado')),
  motivo TEXT,
  observacao TEXT,
  criado_por TEXT NOT NULL,
  criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  atualizado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (barbearia_id) REFERENCES barbearias(id),
  FOREIGN KEY (barbeiro_id) REFERENCES usuarios(id),
  FOREIGN KEY (cliente_id) REFERENCES clientes(id)
);
CREATE INDEX IF NOT EXISTS idx_agendamentos_dia ON agendamentos(barbearia_id, data, barbeiro_id);
CREATE INDEX IF NOT EXISTS idx_agendamentos_barbeiro ON agendamentos(barbearia_id, barbeiro_id, situacao, inicio);

-- Serviços previstos no horário (definem a duração). Preço de tabela copiado na marcação.
CREATE TABLE IF NOT EXISTS agendamento_servicos (
  id TEXT PRIMARY KEY,
  barbearia_id TEXT NOT NULL,
  agendamento_id TEXT NOT NULL,
  servico_id TEXT NOT NULL,
  nome TEXT NOT NULL,
  duracao_min INTEGER NOT NULL,
  FOREIGN KEY (agendamento_id) REFERENCES agendamentos(id)
);
CREATE INDEX IF NOT EXISTS idx_agendamento_servicos ON agendamento_servicos(agendamento_id);

-- Caixa do dia (abertura mínima na E2; fechamento completo na E3).
CREATE TABLE IF NOT EXISTS caixas (
  id TEXT PRIMARY KEY,
  barbearia_id TEXT NOT NULL,
  data TEXT NOT NULL,
  situacao TEXT NOT NULL DEFAULT 'aberto' CHECK (situacao IN ('aberto', 'fechado')),
  troco_centavos INTEGER NOT NULL CHECK (troco_centavos >= 0),
  aberto_por TEXT NOT NULL,
  aberto_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  fechado_por TEXT,
  fechado_em TEXT,
  FOREIGN KEY (barbearia_id) REFERENCES barbearias(id),
  UNIQUE (barbearia_id, data)
);

-- Cada finalização de atendimento. Reabrir = estornar (estornada = 1), nunca apagar.
CREATE TABLE IF NOT EXISTS finalizacoes (
  id TEXT PRIMARY KEY,
  barbearia_id TEXT NOT NULL,
  agendamento_id TEXT NOT NULL,
  barbeiro_id TEXT NOT NULL,
  caixa_id TEXT NOT NULL,
  total_centavos INTEGER NOT NULL CHECK (total_centavos >= 0),
  valor_alterado INTEGER NOT NULL DEFAULT 0 CHECK (valor_alterado IN (0, 1)),
  total_anterior_centavos INTEGER,
  criado_por TEXT NOT NULL,
  criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  estornada INTEGER NOT NULL DEFAULT 0 CHECK (estornada IN (0, 1)),
  estorno_id TEXT,
  estornada_por TEXT,
  estornada_em TEXT,
  motivo_estorno TEXT,
  FOREIGN KEY (agendamento_id) REFERENCES agendamentos(id),
  FOREIGN KEY (caixa_id) REFERENCES caixas(id)
);
CREATE INDEX IF NOT EXISTS idx_finalizacoes_agendamento ON finalizacoes(agendamento_id, estornada);
-- No máximo UMA finalização válida por horário.
CREATE UNIQUE INDEX IF NOT EXISTS idx_finalizacao_valida ON finalizacoes(agendamento_id) WHERE estornada = 0;

-- Serviços cobrados: preço de tabela × cobrado (alteração fica registrada aqui + quem/quando na finalização).
CREATE TABLE IF NOT EXISTS finalizacao_itens (
  id TEXT PRIMARY KEY,
  barbearia_id TEXT NOT NULL,
  finalizacao_id TEXT NOT NULL,
  servico_id TEXT NOT NULL,
  nome TEXT NOT NULL,
  preco_tabela_centavos INTEGER NOT NULL,
  preco_cobrado_centavos INTEGER NOT NULL CHECK (preco_cobrado_centavos >= 0),
  FOREIGN KEY (finalizacao_id) REFERENCES finalizacoes(id)
);
CREATE INDEX IF NOT EXISTS idx_finalizacao_itens ON finalizacao_itens(finalizacao_id);

-- Entradas e estornos no caixa (valor BRUTO). Estorno = linha negativa; nada é apagado.
CREATE TABLE IF NOT EXISTS caixa_lancamentos (
  id TEXT PRIMARY KEY,
  barbearia_id TEXT NOT NULL,
  caixa_id TEXT NOT NULL,
  tipo TEXT NOT NULL CHECK (tipo IN ('atendimento', 'estorno_atendimento')),
  finalizacao_id TEXT,
  forma TEXT NOT NULL CHECK (forma IN ('dinheiro', 'pix', 'debito', 'credito')),
  valor_centavos INTEGER NOT NULL,
  criado_por TEXT NOT NULL,
  criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (caixa_id) REFERENCES caixas(id)
);
CREATE INDEX IF NOT EXISTS idx_caixa_lancamentos ON caixa_lancamentos(caixa_id);

-- Comissão guardada À PARTE do caixa (só o barbeiro dono e a gestão veem).
CREATE TABLE IF NOT EXISTS comissoes (
  id TEXT PRIMARY KEY,
  barbearia_id TEXT NOT NULL,
  barbeiro_id TEXT NOT NULL,
  finalizacao_id TEXT NOT NULL,
  tipo TEXT NOT NULL DEFAULT 'servico' CHECK (tipo IN ('servico', 'produto')),
  base_centavos INTEGER NOT NULL,
  percentual_bp INTEGER NOT NULL,
  valor_centavos INTEGER NOT NULL,
  estornada INTEGER NOT NULL DEFAULT 0 CHECK (estornada IN (0, 1)),
  criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (finalizacao_id) REFERENCES finalizacoes(id)
);
CREATE INDEX IF NOT EXISTS idx_comissoes_barbeiro ON comissoes(barbearia_id, barbeiro_id, estornada);

-- Mensagens de WhatsApp abertas pelos botões (quem, quando, qual modelo). Sem envio automático.
CREATE TABLE IF NOT EXISTS mensagens_enviadas (
  id TEXT PRIMARY KEY,
  barbearia_id TEXT NOT NULL,
  agendamento_id TEXT NOT NULL,
  tipo TEXT NOT NULL CHECK (tipo IN ('lembrete', 'proposta')),
  usuario_id TEXT NOT NULL,
  criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (agendamento_id) REFERENCES agendamentos(id)
);
CREATE INDEX IF NOT EXISTS idx_mensagens_agendamento ON mensagens_enviadas(agendamento_id);
