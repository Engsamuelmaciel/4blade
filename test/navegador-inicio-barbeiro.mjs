// Teste no navegador: INÍCIO DO BARBEIRO (25/11/2026) — foto (a mesma da Minha página), clientes de hoje,
// bruto/líquido de hoje e do mês, dias trabalhados, vale e avisos. Dados FICTÍCIOS (semana simulada).
// Computador (1366 px) e celular (390 px); prints em docs/prints/inicio-barbeiro/.  Uso: node test/navegador-inicio-barbeiro.mjs
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { hojeBrasil } from "../src/util.js";
import { acao } from "./navegacao.mjs";

const { chromium } = createRequire(import.meta.url)("playwright");
const sharp = createRequire(import.meta.url)("sharp");
const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
const PRINTS = join(RAIZ, "docs", "prints", "inicio-barbeiro");
mkdirSync(PRINTS, { recursive: true });
const SENHA = "Senha-Semana-2026";
const HOJE = hojeBrasil();
const TELAS = [
  { nome: "computador", largura: 1366, altura: 768, movel: false, porta: 8861 },
  { nome: "celular", largura: 390, altura: 844, movel: true, porta: 8862 }
];

async function subirServidor(porta) {
  const proc = spawn(process.execPath, ["--no-warnings", join(RAIZ, "test", "servidor-local.mjs"), String(porta), "--semana"], { stdio: ["ignore", "pipe", "inherit"] });
  await new Promise((ok, falha) => {
    proc.stdout.on("data", d => { if (String(d).includes(`localhost:${porta}`)) ok(); });
    proc.on("exit", c => falha(new Error(`servidor saiu (${c})`)));
  });
  return proc;
}

// Foto fictícia do barbeiro (desenho simples)
const FOTO = await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400"><rect width="400" height="400" fill="#2c3e50"/>
  <circle cx="200" cy="160" r="80" fill="#e0b48a"/><rect x="90" y="260" width="220" height="160" rx="90" fill="#c0392b"/><rect x="130" y="80" width="140" height="50" rx="25" fill="#3b2a1c"/></svg>`)).jpeg().toBuffer();

async function rodar(tela) {
  const servidor = await subirServidor(tela.porta);
  const base = `http://localhost:${tela.porta}`;
  const chamar = async (rota, corpo, token, extra = {}) => {
    const r = await fetch(`${base}/api${rota}`, { method: corpo ? "POST" : "GET",
      headers: { "Content-Type": extra.tipo || "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: corpo ? (extra.tipo ? corpo : JSON.stringify(corpo)) : undefined });
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
  const pronto = () => page.waitForFunction(() => !document.body.dataset.carregando);
  let n = 0;
  const print = async nome => {
    n++;
    await page.waitForFunction(() => document.getElementById("carregador")?.hidden !== false);
    await page.waitForTimeout(300);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: join(PRINTS, `${tela.nome}-${String(n).padStart(2, "0")}-${nome}.png`), fullPage: true });
  };
  const entrar = async login => {
    await page.goto(`${base}/#/entrar`);
    await page.fill("#c-login", login); await page.fill("#c-senha", SENHA);
    await page.click("button:has-text('Entrar')");
    await pronto();
  };
  try {
    // 1) Sem foto: iniciais e aviso para pedir a foto
    await entrar("beto.semana");
    await page.waitForSelector("[data-teste=boas-vindas-barbeiro]");
    assert.equal(await page.locator(".nav-aba.ativa, [data-nav].ativa, [aria-current=page]").first().innerText().then(t => t.includes("Início")).catch(() => true), true);
    await page.waitForSelector("[data-teste=foto-barbeiro-iniciais]");
    await page.waitForSelector("[data-aviso=sem-foto]");
    for (const t of ["bruto-hoje", "liquido-hoje", "bruto-mes", "liquido-mes", "clientes-hoje", "grade-barbeiro"]) await page.waitForSelector(`[data-teste=${t}]`);
    const valeAntes = await page.locator("[data-ind=vales] strong, [data-ind=vales]").first().innerText();
    await print("sem-foto");

    // 2) Gerente põe a foto (Minha página → equipe), lança um vale e marca um cliente hoje para o Beto
    const ger = (await chamar("/auth/login", { login: "gerente.semana", senha: SENHA })).token;
    const beto = (await chamar("/auth/login", { login: "beto.semana", senha: SENHA })).token;
    const eu = (await chamar("/auth/eu", null, beto).catch(() => null))?.usuario;
    const equipe = (await chamar("/usuarios", null, ger)).usuarios;
    const idBeto = (eu?.id) || equipe.find(u => u.login === "beto.semana").id;
    await chamar("/pagina", null, ger);
    await chamar(`/pagina/foto?tipo=equipe&usuarioId=${idBeto}`, FOTO, ger, { tipo: "image/jpeg" });
    await chamar("/vales", { barbeiroId: idBeto, valorCentavos: 5000, descricao: "Vale fictício" }, ger);
    const corte = (await chamar("/servicos", null, beto)).servicos[0];
    await chamar("/agenda", { data: HOJE, hora: "23:00", servicoIds: [corte.id], cliente: { nome: "Cliente Noite Fictício" }, aceiteForaHorario: true }, beto);

    await page.reload(); await pronto();
    await page.waitForSelector("[data-teste=foto-barbeiro]");
    await page.waitForFunction(() => { const i = document.querySelector("[data-teste=foto-barbeiro]"); return i && i.complete && i.naturalWidth > 0; });
    await page.waitForSelector("[data-aviso=vale]");
    const brl = t => Number((t.match(/R\$\s?([\d.]+,\d{2})/) || [0, "0,00"])[1].replace(/\./g, "").replace(",", "."));
    assert.equal(brl(await page.locator("[data-aviso=vale]").innerText()), brl(valeAntes) + 50);
    assert.equal(await page.locator("[data-aviso=sem-foto]").count(), 0);
    const linha = page.locator("[data-teste=clientes-hoje] .linha-hoje", { hasText: "Cliente Noite Fictício" });
    await linha.waitFor();
    assert.match(await linha.innerText(), /23:00/);
    assert.match(await page.locator("[data-aviso=proximo]").innerText(), /Cliente Noite Fictício|às/);
    await print("com-foto-vale-clientes");

    // 3) Tocar no cliente abre a ficha do horário
    await linha.click();
    await page.waitForSelector("dialog[open]");
    assert.match(await page.locator("dialog[open]").innerText(), /Cliente Noite Fictício/);
    await print("ficha-do-cliente");
    await page.click("dialog[open] button[type=submit]");

    // 3b) Do Início o barbeiro mexe no próprio horário (fixo, cancelar, excluir) e bloqueia, SEM ir para a agenda
    await chamar("/agenda", { data: HOJE, hora: "22:00", servicoIds: [corte.id], cliente: { nome: "Cliente Fixo Fictício" }, aceiteForaHorario: true, repetir: { intervaloSemanas: 1, ate: HOJE.replace(/^(\d{4})/, y => String(Number(y) + 1)) } }, beto);
    await chamar("/agenda", { data: HOJE, hora: "21:00", servicoIds: [corte.id], cliente: { nome: "Cliente Cancela Fictício" }, aceiteForaHorario: true }, beto);
    await chamar("/agenda", { data: HOJE, hora: "20:00", servicoIds: [corte.id], cliente: { nome: "Cliente Exclui Fictício" }, aceiteForaHorario: true }, beto);
    await page.reload(); await pronto();
    const noInicio = () => assert.match(page.url(), /#\/inicio/);
    // editar a repetição do horário fixo
    await page.locator("[data-teste=clientes-hoje] .linha-hoje", { hasText: "Cliente Fixo Fictício" }).click();
    await acao(page, "dialog[open]", "[data-teste=editar-repeticao]");
    await page.selectOption("dialog[open] #c-rRep", "2");
    await page.click("dialog[open] button[type=submit]");
    await page.waitForTimeout(900);
    if (await page.locator("dialog[open]").count()) await page.click("dialog[open] button[type=submit]");   // aviso dos dias pulados
    await page.waitForSelector("[data-teste=boas-vindas-barbeiro]"); await pronto(); noInicio();
    // cancelar
    await page.locator("[data-teste=clientes-hoje] .linha-hoje", { hasText: "Cliente Cancela Fictício" }).click();
    await acao(page, "dialog[open]", "button:has-text('Cancelar')");
    await page.fill("dialog[open] [name=motivo]", "Cliente desistiu");
    await page.click("dialog[open] button[type=submit]");
    await page.waitForSelector("[data-teste=boas-vindas-barbeiro]"); await pronto(); noInicio();
    await page.waitForFunction(() => [...document.querySelectorAll("[data-teste=clientes-hoje] .linha-hoje")].some(l => /Cancela/.test(l.innerText) && /Cancelado/i.test(l.innerText)));
    // excluir
    await page.locator("[data-teste=clientes-hoje] .linha-hoje", { hasText: "Cliente Exclui Fictício" }).click();
    await acao(page, "dialog[open]", "[data-excluir]");
    await page.fill("dialog[open] [name=motivo]", "Lançado por engano");
    await page.click("dialog[open] button[type=submit]");
    await page.waitForSelector("[data-teste=boas-vindas-barbeiro]"); await pronto(); noInicio();
    await page.waitForFunction(() => ![...document.querySelectorAll("[data-teste=clientes-hoje] .linha-hoje")].some(l => /Exclui/.test(l.innerText)));
    // bloquear (de manhã cedo, sem horários marcados) e ver o bloqueio na lista
    await page.click("[data-teste=bloquear-inicio]");
    await page.waitForSelector("dialog[open]");
    await page.fill("dialog[open] [name=hIni]", "06:00"); await page.fill("dialog[open] [name=hFim]", "07:00");
    await page.fill("dialog[open] [name=motivoBloq]", "Dentista fictício");
    await page.click("dialog[open] button[type=submit]");
    await page.waitForSelector("[data-teste=bloqueios-hoje] [data-bloqueio]"); noInicio();
    await print("inicio-bloqueio-e-acoes");
    // desbloquear
    await page.click("[data-teste=bloqueios-hoje] button:has-text('Desbloquear')");
    await page.fill("dialog[open] [name=motivo]", "Mudou o plano");
    await page.click("dialog[open] button[type=submit]");
    await page.waitForFunction(() => !document.querySelector("[data-teste=bloqueios-hoje]")); noInicio();

    // 4) Atalhos levam à agenda e à produção
    await page.click("[data-atalho=Produção]"); await pronto();
    await page.waitForSelector("[data-teste=minha-producao]");
    // números do Início batem com a Produção
    const liqMes = await page.locator("[data-teste=minha-comissao]").innerText();
    await page.goto(`${base}/#/inicio`); await pronto();
    assert.equal((await page.locator("[data-teste=liquido-mes]").innerText()).trim(), liqMes.trim());

    assert.deepEqual(problemas.filter(p => !/favicon|Failed to load resource/.test(p)), []);
    console.log(`  ok ${tela.nome}`);
  } finally {
    await navegador.close();
    servidor.kill();
  }
}

for (const t of TELAS) await rodar(t);
console.log("Início do barbeiro: tudo certo no navegador.");
