// Servidor LOCAL só para testar a tela no navegador: API (Worker) + arquivos de public/, com banco SQLite em memória,
// KV simulado e frota FICTÍCIA. Aplica a mesma política de segurança (CSP) do arquivo public/_headers.
// Uso: node test/servidor-local.mjs [porta]   (supervisor de teste: R3 SUP001 / senha "Teste-Senha-123")
import http from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { extname, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import worker from "../src/index.js";
import { ambiente } from "./ambiente.js";

const PUBLIC = join(dirname(fileURLToPath(import.meta.url)), "..", "public");
const porta = Number(process.argv[2]) || 8787;
const amb = ambiente();
const kv = new Map();
amb.env.ARQUIVOS = { getWithMetadata: async () => null, put: async (k, v) => { kv.set(k, v); }, get: async k => kv.get(k) ?? null, delete: async k => { kv.delete(k); } };
amb.env.ASSETS = { fetch: async req => estatico(new URL(req.url).pathname) };

const cabecalhos = {};
for (const l of readFileSync(join(PUBLIC, "_headers"), "utf8").split("\n")) {
  const m = l.match(/^\s+([A-Za-z-]+):\s*(.+)$/);
  if (m && !/Cache-Control/.test(m[1])) cabecalhos[m[1]] = m[2];
}
const TIPOS = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml" };
function estatico(caminho) {
  let f = join(PUBLIC, decodeURIComponent(caminho));
  if (!f.startsWith(PUBLIC) || !existsSync(f) || statSync(f).isDirectory()) f = join(PUBLIC, "index.html");
  return new Response(readFileSync(f), { headers: { "Content-Type": TIPOS[extname(f)] || "application/octet-stream", ...cabecalhos } });
}

// conta de teste: supervisor com a senha já trocada
const sup = await amb.criarSupervisor("SUP001");
console.log("supervisor de teste pronto (R3 SUP001, senha Nova-SUP001-senha)");

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${porta}`);
  const corpo = ["GET", "HEAD"].includes(req.method) ? undefined : await new Promise(ok => { const p = []; req.on("data", c => p.push(c)); req.on("end", () => ok(Buffer.concat(p))); });
  const r = await worker.fetch(new Request(url, { method: req.method, headers: { ...req.headers, "cf-connecting-ip": "10.0.0.9" }, body: corpo }), amb.env);
  const h = Object.fromEntries(r.headers);
  if (!url.pathname.startsWith("/api")) Object.assign(h, cabecalhos);
  res.writeHead(r.status, h);
  res.end(Buffer.from(await r.arrayBuffer()));
}).listen(porta, () => console.log(`http://localhost:${porta}`));
