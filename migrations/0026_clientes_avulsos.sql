-- 4blade — Migração 0026: clientes AVULSOS (só tabela nova; nada é apagado nem alterado).
-- Cliente avulso = digitado só pelo nome no caixa/agenda, sem WhatsApp. Ele continua existindo (o lançamento guarda o nome),
-- mas NÃO aparece na lista de clientes cadastrados, nem na busca, nem nas mensagens. Para entrar na base, o cliente é
-- cadastrado de verdade (com WhatsApp): aí 'promovido_em' é preenchido e ele passa a aparecer na lista.
CREATE TABLE IF NOT EXISTS clientes_avulsos (
  cliente_id TEXT PRIMARY KEY REFERENCES clientes(id),
  barbearia_id TEXT NOT NULL REFERENCES barbearias(id),
  criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  promovido_em TEXT                       -- preenchido quando o cliente foi cadastrado na base (ganhou WhatsApp)
);
CREATE INDEX IF NOT EXISTS idx_clientes_avulsos_barbearia ON clientes_avulsos(barbearia_id);

-- Já existentes: os criados pelo caixa/agenda só com o nome (sem telefone) passam a ser avulsos.
-- Cadastros de implantação (lote do suporte) e cadastros com WhatsApp continuam na base.
INSERT OR IGNORE INTO clientes_avulsos (cliente_id, barbearia_id)
SELECT c.id, c.barbearia_id FROM clientes c
WHERE c.telefone LIKE 'sem:%'
  AND EXISTS (SELECT 1 FROM auditoria a WHERE a.alvo = c.id AND a.acao = 'cliente_criado')
  AND c.id NOT IN (SELECT cliente_id FROM clientes_excluidos);
