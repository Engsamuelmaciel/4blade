// Teste no navegador: HISTÓRICO DO CLIENTE (25/11/2026) — Clientes → tocar no nome → resumo, notas em aberto, próximos,
// concluídos, faltas e compras; carrega só ao abrir. Computador (1366 px) e celular (390 px); prints em docs/prints/historico/.
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { ir, abrirItem } from "./navegacao.mjs";
import { hojeBrasil } from "../src/util.js";
import { somarDias } from "../src/agenda-util.js";

const { chromium } = createRequire(import.meta.url)("playwright");
const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
const PRINTS = join(RAIZ, "docs", "prints", "historico");
mkdirSync(PRINTS, { recursive: true });
const SENHA = "Senha-Semana-2026";
const HOJE = hojeBrasil();
const AMANHA = somarDias(HOJE, 1);
const CLIENTE = "Cliente Fictício 1";
const OUTRO = "Cliente Fictício 2";
const TELAS = [
  { nome: "computador", largura: 1366, altura: 768, movel: false, porta: 8871 },
  { nome: "celular", largura: 390, altura: 844, movel: true, porta: 8872 }
];

async function subirServidor(porta) {
  const proc = spawn(process.execPath, ["--no-warnings", join(RAIZ, "test", "servidor-local.mjs"), String(porta), "--semana"], { stdio: ["ignore", "pipe", "inherit"] });
  await new Promise((ok, falha) => {
    proc.stdout.on("data", d => { if (String(d).includes(`localhost:${porta}`)) ok(); });
    proc.on("exit", c => falha(new Error(`servidor saiu (${c})`)));
  });
  return proc;
}

async function rodar(tela) {
  const servidor = await subirServidor(tela.porta);
  const base = `http://localhost:${tela.porta}`;
  const chamar = async (rota, corpo, token) => {
    const r = await fetch(`${base}/api${rota}`, { method: corpo ? "POST" : "GET", headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: corpo ? JSON.stringify(corpo) : undefined });
    const d = await r.json();
    if (r.status >= 300) throw new Error(`${rota}: ${JSON.stringify(d)}`);
    return d;
  };
  const navegador = await chromium.launch();
  const contexto = await navegador.newContext({ viewport: { width: tela.largura, height: tela.altura }, deviceScaleFactor: 2, isMobile: tela.movel, hasTouch: tela.movel, locale: "pt-BR", timezoneId: "America/Sao_Paulo" });
  const page = await contexto.newPage();
  const problemas = [];
  page.on("console", m => { if (m.type() === "error") problemas.push(m.text()); });
  page.on("pageerror", e => problemas.push(e.message));
  const chamadasHistorico = [];
  page.on("request", r => { if (r.url().includes("/api/clientes/historico")) chamadasHistorico.push(r.url()); });
  const pronto = () => page.waitForFunction(() => !document.body.dataset.carregando);
  let n = 0;
  const print = async (nome, alvo = null) => {
    n++;
    await page.waitForFunction(() => document.getElementById("carregador")?.hidden !== false);
    await page.waitForTimeout(300);
    const arq = join(PRINTS, `${tela.nome}-${String(n).padStart(2, "0")}-${nome}.png`);
    if (alvo) await page.locator(alvo).screenshot({ path: arq }); else { await page.evaluate(() => window.scrollTo(0, 0)); await page.screenshot({ path: arq, fullPage: true }); }
    console.log(`  print: docs/prints/historico/${tela.nome}-${String(n).padStart(2, "0")}-${nome}.png`);
  };
  try {
    console.log(`[${tela.nome}] histórico do cliente`);
    const ger = (await chamar("/auth/login", { login: "gerente.semana", senha: SENHA })).token;
    const beto = (await chamar("/auth/login", { login: "beto.semana", senha: SENHA })).token;
    const cli = (await chamar("/clientes", null, ger)).clientes.find(c => c.nome === CLIENTE);
    const corte = (await chamar("/servicos", null, ger)).servicos.find(s => s.nome === "Corte");
    // monta o histórico: nota em aberto, falta, próximo horário e uma compra
    const nota = (await chamar("/agenda", { barbeiroId: (await chamar("/usuarios", null, ger)).usuarios.find(u => u.login === "beto.semana").id, data: HOJE, hora: "08:10", servicoIds: [corte.id], cliente: { id: cli.id } }, ger)).agendamento;
    await chamar("/caixa/cobrar", { id: nota.id, itens: [{ servicoId: corte.id, precoCobradoCentavos: 4000 }], pagamentos: [{ forma: "promissoria", valorCentavos: 4000 }] }, ger);
    const falta = (await chamar("/agenda", { barbeiroId: nota.barbeiroId, data: HOJE, hora: "08:45", servicoIds: [corte.id], cliente: { id: cli.id } }, ger)).agendamento;
    await chamar("/agenda/situacao", { id: falta.id, situacao: "faltou" }, ger);
    await chamar("/agenda", { barbeiroId: nota.barbeiroId, data: AMANHA, hora: "11:00", servicoIds: [corte.id], cliente: { id: cli.id } }, ger);
    const prod = (await chamar("/produtos", null, ger)).produtos.find(p => p.nome === "Pomada");
    await chamar("/vendas", { itens: [{ produtoId: prod.id, quantidade: 1 }], pagamentos: [{ forma: "pix", valorCentavos: prod.precoCentavos }], clienteId: cli.id }, ger);

    await page.goto(`${base}/#/entrar`);
    await page.fill("#c-login", "gerente.semana"); await page.fill("#c-senha", SENHA);
    await page.click("button:has-text('Entrar')"); await pronto();
    await ir(page, "Clientes");
    await page.waitForSelector(`[data-cliente="${CLIENTE}"]`);
    assert.equal(chamadasHistorico.length, 0, "nada é carregado antes de abrir o cliente");

    await abrirItem(page, `[data-cliente="${CLIENTE}"]`);
    await page.waitForSelector(`[data-cliente="${CLIENTE}"] [data-teste=hist-resumo]`);
    assert.equal(chamadasHistorico.length, 1, "só o cliente aberto é carregado");
    const hist = page.locator(`[data-cliente="${CLIENTE}"] [data-teste=historico-cliente]`);
    // notas em aberto
    assert.match(await hist.locator("[data-teste=hist-notas]").innerText(), /R\$\s?40,00/);
    // próximos horários
    assert.match(await hist.locator("[data-teste=hist-proximos]").innerText(), /Corte/);
    // atendimentos concluídos (os da semana simulada)
    const concluidos = await hist.locator("[data-teste=hist-atendimentos] .hist-linha:not(.extra)").count();
    assert.ok(concluidos >= 1, "tem atendimento concluído");
    assert.match(await hist.locator("[data-teste=hist-resumo]").innerText(), /FALTAS\s*1|Faltas\s*1/i);
    // faltas e compras ficam recolhidas, mas existem; ao tocar, abrem
    await hist.locator("[data-teste=hist-faltas] > summary").click();
    assert.match(await hist.locator("[data-teste=hist-faltas]").innerText(), /Faltou/);
    await hist.locator("[data-teste=hist-compras] > summary").click();
    assert.match(await hist.locator("[data-teste=hist-compras]").innerText(), /Pomada/);
    assert.ok(!/\bnull\b|\bundefined\b|NaN/.test(await hist.innerText()), "sem texto estranho no histórico");
    await print("historico-cliente-aberto");

    // abrir outro cliente carrega só o dele
    await abrirItem(page, `[data-cliente="${OUTRO}"]`);
    await page.waitForSelector(`[data-cliente="${OUTRO}"] [data-teste=hist-resumo]`);
    assert.equal(chamadasHistorico.length, 2);
    assert.equal(await page.locator(`[data-cliente="${OUTRO}"] [data-teste=hist-notas]`).count(), 0, "sem nota: sem a seção");

    // caixa também vê; barbeiro não tem a tela de clientes
    assert.deepEqual(problemas.filter(p => !/status of 40[039]/.test(p)), [], `erros no console: ${problemas.join(" | ")}`);
    console.log(`  ok ${tela.nome}`);
  } finally {
    await navegador.close();
    servidor.kill();
  }
}

for (const t of TELAS) await rodar(t);
console.log("Histórico do cliente: tudo certo no navegador.");
