// (Origem: FrotaZ.) Imitação mínima do Cloudflare D1 usando o SQLite embutido no Node (node:sqlite).
// Serve só para testes automáticos: aplica as migrações reais da pasta migrations/.
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";

const MIGRACOES = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");

// Contador de consultas: no Cloudflare (plano grátis) cada pedido pode fazer no máximo 50 consultas ao D1
// (um db.batch() conta como UMA). Os testes conferem esse limite em todos os pedidos.
export const LIMITE_CONSULTAS = 50;

class Statement {
  constructor(db, sql, params = [], contador) {
    this.db = db;
    this.sql = sql;
    this.params = params;
    this.contador = contador;
  }
  bind(...params) {
    return new Statement(this.db, this.sql, params, this.contador);
  }
  async first() {
    this.contador.n++;
    return this.db.prepare(this.sql).get(...this.params) ?? null;
  }
  async all() {
    this.contador.n++;
    return { success: true, results: this.db.prepare(this.sql).all(...this.params), meta: {} };
  }
  async run() {
    this.contador.n++;
    return this.executar();
  }
  executar() {
    const r = this.db.prepare(this.sql).run(...this.params);
    return { success: true, meta: { changes: Number(r.changes) } };
  }
}

export function criarBanco() {
  const db = new DatabaseSync(":memory:");
  for (const arquivo of readdirSync(MIGRACOES).filter(f => f.endsWith(".sql")).sort()) {
    db.exec(readFileSync(join(MIGRACOES, arquivo), "utf8"));
  }
  const contador = { n: 0 };
  return {
    raw: db,
    contador,
    prepare: sql => new Statement(db, sql, [], contador),
    async batch(stmts) {
      contador.n++;   // o lote inteiro conta como uma consulta
      db.exec("BEGIN");
      try {
        const out = [];
        for (const s of stmts) out.push(s.executar());
        db.exec("COMMIT");
        return out;
      } catch (e) {
        db.exec("ROLLBACK");
        throw e;
      }
    }
  };
}

export function aplicarMigracoes(db, filtro = () => true) {
  for (const arquivo of readdirSync(MIGRACOES).filter(f => f.endsWith(".sql")).filter(filtro).sort()) {
    db.raw.exec(readFileSync(join(MIGRACOES, arquivo), "utf8"));
  }
}
