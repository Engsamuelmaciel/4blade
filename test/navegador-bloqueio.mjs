// Teste no navegador: o caixa bloqueia a agenda de TODOS pelo "Novo horário" e desbloqueia o grupo (27/11/2026).
// Uso: node test/navegador-bloqueio.mjs   (prints em docs/prints/agenda/)
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { ir } from "./navegacao.mjs";

const { chromium } = createRequire(import.meta.url)("playwright");
const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
const PRINTS = join(RAIZ, "docs", "prints", "agenda");
mkdirSync(PRINTS, { recursive: true });
const SENHA = "Demo-4blade-2026";
const TELAS = [
  { nome: "computador", largura: 1366, altura: 800, movel: false, porta: 8871 },
  { nome: "celular", largura: 390, altura: 844, movel: true, porta: 8872 }
];

for (const tela of TELAS) {
  const proc = spawn(process.execPath, ["--no-warnings", join(RAIZ, "test", "servidor-local.mjs"), String(tela.porta), "--demo"], { stdio: ["ignore", "pipe", "inherit"] });
  await new Promise((ok, falha) => { proc.stdout.on("data", d => { if (String(d).includes(`localhost:${tela.porta}`)) ok(); }); proc.on("exit", c => falha(new Error(`servidor saiu (${c})`))); });
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: tela.largura, height: tela.altura }, isMobile: tela.movel, hasTouch: tela.movel });
  const page = await ctx.newPage();
  const pronto = () => page.waitForFunction(() => !document.body.dataset.carregando);
  try {
    await page.goto(`http://localhost:${tela.porta}/#/entrar`);
    await page.fill("#c-login", "caixa.demo");
    await page.fill("#c-senha", SENHA);
    await page.click("button:has-text('Entrar')");
    await page.waitForFunction(() => document.querySelector("#nav-topo:not([hidden]) .nav-aba"));
    await ir(page, "Agenda");
    await pronto();
    // o caixa tem o botão Bloquear na barra
    await page.click(".barra-agenda button:text-is('Bloquear'), .acoes-agenda button:text-is('Bloquear')");
    await page.waitForSelector("#janela[open]");
    const opcoes = await page.locator("#janela select[name=prof] option").allInnerTexts();
    assert.ok(opcoes.includes("Todos os profissionais"), "opção Todos os profissionais");
    await page.close();
    const page2 = await ctx.newPage();
    await page2.goto(`http://localhost:${tela.porta}/#/agenda`);
    await page2.waitForFunction(() => !document.body.dataset.carregando);
    // Novo horário → "Bloquear este horário" leva profissional/dia/hora
    await page2.click(".novo-horario");
    await page2.waitForSelector("[data-teste=bloquear-do-novo]");
    await page2.fill("#janela input[name=hora]", "12:30");
    await page2.screenshot({ path: join(PRINTS, `${tela.nome}-novo-horario-bloquear.png`) });
    await page2.click("[data-teste=bloquear-do-novo]");
    await page2.waitForSelector("#janela select[name=prof]");
    assert.equal(await page2.inputValue("#janela input[name=hIni]"), "12:30", "hora levada");
    assert.equal(await page2.inputValue("#janela input[name=hFim]"), "13:30");
    await page2.selectOption("#janela select[name=prof]", "todos");
    await page2.fill("#janela input[name=motivoBloq]", "Almoço da equipe");
    await page2.screenshot({ path: join(PRINTS, `${tela.nome}-bloquear-todos.png`) });
    await page2.click("#janela button[type=submit]");
    await page2.waitForSelector("text=Agenda de todos bloqueada.");
    await page2.waitForFunction(() => !document.body.dataset.carregando);
    console.log(`[${tela.nome}] caixa bloqueou todos: ok`);
  } finally { await browser.close(); proc.kill(); }
}
