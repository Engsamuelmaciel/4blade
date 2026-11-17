-- Despesas (contas a pagar): forma de pagamento e parcelamento (pedido de 17/11/2026).
-- Tabela nova, ligada à conta (a tabela contas não muda; migração pode rodar de novo).
-- forma: como a despesa é/foi paga (dinheiro, pix, debito, credito, boleto, transferencia).
-- Parcelada: cada parcela é uma conta; todas têm o mesmo grupo_id, parcela = 1..parcelas.
CREATE TABLE IF NOT EXISTS contas_detalhes (
  conta_id TEXT PRIMARY KEY,
  barbearia_id TEXT NOT NULL,
  forma TEXT CHECK (forma IS NULL OR forma IN ('dinheiro', 'pix', 'debito', 'credito', 'boleto', 'transferencia')),
  parcela INTEGER NOT NULL DEFAULT 1 CHECK (parcela >= 1),
  parcelas INTEGER NOT NULL DEFAULT 1 CHECK (parcelas >= 1 AND parcelas <= 48),
  grupo_id TEXT,
  FOREIGN KEY (conta_id) REFERENCES contas(id)
);
CREATE INDEX IF NOT EXISTS idx_contas_detalhes_grupo ON contas_detalhes(barbearia_id, grupo_id);
