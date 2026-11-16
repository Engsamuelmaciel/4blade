// Servidor LOCAL só para testar a tela no navegador: API (Worker) + arquivos de public/, banco SQLite em memória.
// Aplica a mesma política de segurança (CSP) do arquivo public/_headers. Origem: FrotaZ.
// Uso: node test/servidor-local.mjs [porta] [--demo]   (plataforma de teste: usuário "suporte", senha "Nova-suporte-senha")
import http from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { extname, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import worker from "../src/index.js";
import { ambiente } from "./ambiente.js";

const PUBLIC = join(dirname(fileURLToPath(import.meta.url)), "..", "public");
const porta = Number(process.argv[2]) || 8787;
const amb = ambiente();
amb.env.ASSETS = { fetch: async req => estatico(new URL(req.url).pathname) };

const cabecalhos = {};
for (const l of readFileSync(join(PUBLIC, "_headers"), "utf8").split("\n")) {
  const m = l.match(/^\s+([A-Za-z-]+):\s*(.+)$/);
  if (m && !/Cache-Control/.test(m[1])) cabecalhos[m[1]] = m[2];
}
const TIPOS = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/manifest+json", ".png": "image/png", ".svg": "image/svg+xml" };
function estatico(caminho) {
  let f = join(PUBLIC, decodeURIComponent(caminho));
  if (!f.startsWith(PUBLIC) || !existsSync(f) || statSync(f).isDirectory()) f = join(PUBLIC, "index.html");
  return new Response(readFileSync(f), { headers: { "Content-Type": TIPOS[extname(f)] || "application/octet-stream", ...cabecalhos } });
}

await amb.criarPlataforma("suporte");
console.log("plataforma de teste pronta (usuário suporte, senha Nova-suporte-senha)");
if (process.argv.includes("--semana")) {
  const { semearSemana, SENHA_SEMANA } = await import("./semana-simulada.mjs");
  await semearSemana(amb);
  console.log(`semana simulada pronta: dono.semana, gerente.semana, ana.semana, beto.semana, caixa.semana (senha ${SENHA_SEMANA})`);
}
if (process.argv.includes("--demo")) {
  const { semearDemonstracao, SENHA_DEMO } = await import("./demonstracao.mjs");
  await semearDemonstracao(amb);
  console.log(`demonstração pronta: dono.demo, gerente.demo, barbeiro.demo, rafael.demo, caixa.demo (senha ${SENHA_DEMO})`);
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${porta}`);
  // Só neste servidor local: simula o tempo passando e o cliente pagando no Asaas (de mentira).
  if (url.pathname === "/__teste/pago-ate") {
    const u = await amb.env.DB.prepare("SELECT barbearia_id FROM usuarios WHERE login = ?").bind(url.searchParams.get("login")).first();
    await amb.env.DB.prepare("UPDATE assinaturas SET pago_ate = ? WHERE barbearia_id = ?").bind(url.searchParams.get("data"), u.barbearia_id).run();
    res.writeHead(200); return res.end("ok");
  }
  if (url.pathname === "/__teste/pagar") {
    const u = await amb.env.DB.prepare("SELECT a.asaas_assinatura_id AS sub FROM usuarios x JOIN assinaturas a ON a.barbearia_id = x.barbearia_id WHERE x.login = ?").bind(url.searchParams.get("login")).first();
    const ev = amb.asaas.pagar(u.sub);
    await amb.webhook(ev.pago);
    await amb.webhook(ev.criada);
    res.writeHead(200); return res.end("ok");
  }
  const corpo = ["GET", "HEAD"].includes(req.method) ? undefined : await new Promise(ok => { const p = []; req.on("data", c => p.push(c)); req.on("end", () => ok(Buffer.concat(p))); });
  const r = await worker.fetch(new Request(url, { method: req.method, headers: { ...req.headers, "cf-connecting-ip": "10.0.0.9" }, body: corpo }), amb.env);
  const h = Object.fromEntries(r.headers);
  if (!url.pathname.startsWith("/api")) Object.assign(h, cabecalhos);
  res.writeHead(r.status, h);
  res.end(Buffer.from(await r.arrayBuffer()));
}).listen(porta, () => console.log(`http://localhost:${porta}`));
