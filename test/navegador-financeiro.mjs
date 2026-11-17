// Teste no navegador do RELATÓRIO FINANCEIRO (Playwright). Dados FICTÍCIOS (semana simulada de test/semana-simulada.mjs).
// Gerente abre Financeiro → Relatório financeiro: cartões com entradas/saídas/saldo/resultado conferidos à mão, gráfico de
// entradas e saídas (leitura ao tocar na barra e "Ver este dia"), saldo acumulado, divisões, profissionais, mais vendidos,
// movimentos com filtro, períodos Dia/Semana/Mês/Ano e navegação ‹ ›; tema escuro; barbeiro e caixa não veem o menu.
// Roda em computador (1366 px) e celular (390 px); prints em docs/prints/financeiro/.  Uso: node test/navegador-financeiro.mjs
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { ir } from "./navegacao.mjs";
import { hojeBrasil } from "../src/util.js";
import { somarDias } from "../src/agenda-util.js";

const { chromium } = createRequire(import.meta.url)("playwright");
const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
const PRINTS = join(RAIZ, "docs", "prints", "financeiro");
mkdirSync(PRINTS, { recursive: true });
const HOJE = hojeBrasil();
const dia = i => somarDias(HOJE, i - 6);
const SENHA = "Senha-Semana-2026";

const TELAS = [
  { nome: "computador", largura: 1366, altura: 768, movel: false, porta: 8831 },
  { nome: "celular", largura: 390, altura: 844, movel: true, porta: 8832 }
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
  const navegador = await chromium.launch();
  const contexto = await navegador.newContext({
    viewport: { width: tela.largura, height: tela.altura },
    deviceScaleFactor: 2, isMobile: tela.movel, hasTouch: tela.movel, locale: "pt-BR", timezoneId: "America/Sao_Paulo"
  });
  // Agenda do dia: os testes antigos usam o modo "Lista" (a grade é testada à parte em navegador-e2).
  await contexto.addInitScript(() => { try { if (!localStorage.getItem("4blade.agendaModo")) localStorage.setItem("4blade.agendaModo", "lista"); } catch { /* about:blank */ } });
  const page = await contexto.newPage();
  const problemas = [];
  page.on("console", m => { if (m.type() === "error") problemas.push(m.text()); });
  page.on("pageerror", e => problemas.push(e.message));
  let n = 0;
  const pronto = () => page.waitForFunction(() => !document.body.dataset.carregando);
  const print = async (nome, { inteira = true } = {}) => {
    n++;
    const arq = `${tela.nome}-${String(n).padStart(2, "0")}-${nome}.png`;
    await page.waitForTimeout(250);
    if (inteira) await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: join(PRINTS, arq), fullPage: inteira });
    const texto = await page.locator("body").innerText();
    assert.ok(!/\bnull\b|\bundefined\b|NaN/.test(texto), `texto estranho na tela ${nome}`);
    console.log(`  print: docs/prints/financeiro/${arq}`);
  };
  const passo = t => console.log(`[${tela.nome}] ${t}`);
  const entrar = async login => {
    await page.goto(`${base}/#/entrar`);
    await page.waitForSelector("#c-login");
    await page.fill("#c-login", login);
    await page.fill("#c-senha", SENHA);
    await page.click("button:has-text('Entrar')");
    await page.waitForSelector("#menu:not([hidden]) .grupo");
    await pronto();
  };
  const sair = async () => { await page.click("#btn-conta"); await page.click("#btn-sair"); await page.waitForSelector("text=Você saiu do sistema."); };
  const cartao = async id => (await page.textContent(`[data-cartao=${id}]`)).replace(/\s+/g, " ");
  const abrirSecao = async id => { const d = page.locator(`[data-secao-fin=${id}]`); if (await d.getAttribute("open") === null) await d.locator(":scope > summary").click(); };
  const periodo = async nome => { await page.click(`.fin-controles .alterna button:has-text('${nome}')`); await pronto(); };

  try {
    await entrar("gerente.semana");
    passo("abre o relatório pelo menu Financeiro");
    await ir(page, "Relatório financeiro");
    await page.waitForSelector(".fin-cartoes");
    // a semana simulada inteira cabe no ano (e no mês, quando não vira o mês)
    await periodo("Ano");
    assert.match(await page.textContent("[data-teste=periodo-fin]"), new RegExp(HOJE.slice(0, 4)));
    // Entradas 535,00 · saídas 1.990,00 (compra 120 + vales 70 + aluguel 1.500 + fornecedor 300) · saldo −1.455,00
    // Resultado = 535 − comissões 178 − custo 80 − contas 1.800 = −1.523,00
    assert.match(await cartao("entradas"), /R\$\s?535,00/);
    assert.match(await cartao("saidas"), /R\$\s?1\.990,00/);
    assert.match(await cartao("saldo"), /-R\$\s?1\.455,00|R\$\s?-1\.455,00|−/);
    assert.match(await cartao("resultado"), /1\.523,00/);
    assert.match(await cartao("faturamento"), /Serviços R\$\s?355,00 · produtos R\$\s?180,00/);
    assert.match(await cartao("atendimentos"), /8.*Ticket médio R\$\s?44,38/);
    assert.equal(await page.locator(".grafico-fin").count(), 2, "gráfico de barras + saldo acumulado");
    assert.equal(await page.locator(".grafico-fin .faixa[data-ponto]").count(), 12, "12 meses");
    assert.match(await page.textContent("[data-parte='Pix']"), /R\$\s?270,00 · 50%/);
    assert.match(await page.textContent("[data-parte='Conta: Aluguel']"), /R\$\s?1\.500,00/);
    assert.match(await page.textContent("[data-parte='Compra de mercadoria']"), /R\$\s?120,00/);
    assert.match(await page.textContent("[data-teste=demonstrativo]"), /Comissões da equipe\s*-?R\$\s?-?178,00/);
    assert.match(await page.textContent("[data-teste=fin-profissionais]"), /Beto Barbeiro.*Ana Barbeira/s);
    assert.match(await page.textContent(".fin-top"), /Corte\s*6 vez\(es\)\s*R\$\s?235,00/);
    await print("ano");

    passo("toca no mês no gráfico → leitura → Ver este mês");
    const mes = HOJE.slice(0, 7);
    await page.locator(`.grafico-fin .faixa[data-ponto='${mes}']`).scrollIntoViewIfNeeded();
    await page.click(`.grafico-fin .faixa[data-ponto='${mes}']`);
    await page.waitForSelector("[data-teste=leitura] button:has-text('Ver este mês')");
    assert.match(await page.textContent("[data-teste=leitura]"), /Entradas R\$\s?\d/);
    await print("ano-leitura-mes", { inteira: false });
    await page.click("[data-teste=leitura] button:has-text('Ver este mês')");
    await pronto();
    await page.waitForSelector(".fin-controles .alterna .botao.ativo:has-text('Mês')");
    if (dia(0).slice(0, 7) === mes) assert.match(await cartao("entradas"), /R\$\s?535,00/);
    await print("mes");

    passo("Dia: hoje (70,00 de entrada; conta do fornecedor 300,00) comparado com ontem (30,00)");
    await periodo("Dia");
    assert.match(await page.textContent("[data-teste=periodo-fin]"), new RegExp(HOJE.split("-").reverse().join("/")));
    assert.match(await cartao("entradas"), /R\$\s?70,00.*▲ 133% em relação ao dia anterior/);
    assert.match(await cartao("saidas"), /R\$\s?300,00/);
    assert.equal(await page.locator(".grafico-fin .faixa[data-ponto]").count(), 7, "7 dias que terminam hoje");
    await print("dia");
    passo("‹ volta um dia; leitura do gráfico; Hoje volta");
    await page.click(".fin-navega button[aria-label='Período anterior']");
    await pronto();
    assert.match(await page.textContent("[data-teste=periodo-fin]"), new RegExp(dia(5).split("-").reverse().join("/")));
    assert.match(await cartao("entradas"), /R\$\s?30,00/);
    await page.click(`.grafico-fin .faixa[data-ponto='${dia(3)}']`);
    await page.click("[data-teste=leitura] button:has-text('Ver este dia')");
    await pronto();
    assert.match(await cartao("saidas"), /R\$\s?1\.500,00/, "dia do aluguel");
    await page.click(".fin-navega button:has-text('Hoje')");
    await pronto();
    assert.match(await cartao("entradas"), /R\$\s?70,00/);

    passo("Semana: segunda a domingo");
    await periodo("Semana");
    assert.equal(await page.locator(".grafico-fin .faixa[data-ponto]").count() >= 7, true);
    await print("semana");

    passo("movimentos: filtro Saídas");
    await periodo("Ano");
    if (tela.movel) assert.equal(await page.locator("[data-secao-fin=movimentos]").getAttribute("open"), null, "no celular os blocos começam fechados");
    await abrirSecao("movimentos");
    await page.locator(".fin-movs").scrollIntoViewIfNeeded();
    await page.click(".fin-movs .alterna button:has-text('Saídas')");
    const tipos = await page.locator(".fin-mov-lista li").evaluateAll(l => l.map(x => x.dataset.mov));
    assert.ok(tipos.length >= 5 && tipos.every(t => /Conta paga|Compra de mercadoria|Vale|Comissão paga|Retirada/.test(t)), tipos.join(","));
    assert.ok(!tipos.includes("Sangria"));
    await page.click(".fin-movs .alterna button:has-text('Entradas')");
    assert.equal(await page.locator(".fin-mov-lista li.mov-entrada").count(), 11, "8 atendimentos + 3 vendas");
    await page.locator(".fin-movs").screenshot({ path: join(PRINTS, `${tela.nome}-${String(++n).padStart(2, "0")}-movimentos-entradas.png`) });
    console.log(`  print: docs/prints/financeiro/${tela.nome}-${String(n).padStart(2, "0")}-movimentos-entradas.png`);

    passo("tabela do gráfico e tema escuro");
    await page.click(".fin-tabela summary");
    assert.ok(await page.locator(".fin-tabela table tbody tr").count() === 12);
    await page.evaluate(() => { localStorage.setItem("4blade.aparencia", JSON.stringify({ paleta: "navalha", modo: "escuro" })); });
    await page.reload();
    await page.waitForSelector(".fin-cartoes");
    await pronto();
    assert.equal(await page.evaluate(() => document.documentElement.dataset.tema), "escuro");
    const cor = await page.evaluate(() => getComputedStyle(document.querySelector(".grafico-fin .barra-entrada")).fill);
    assert.equal(cor, "rgb(57, 135, 229)", "azul do tema escuro");
    await print("tema-escuro");
    await page.evaluate(() => localStorage.removeItem("4blade.aparencia"));
    await sair();

    passo("barbeiro e caixa não veem o relatório");
    for (const login of ["ana.semana", "caixa.semana"]) {
      await entrar(login);
      assert.equal(await page.locator("#menu a[href='#/financeiro']").count(), 0, login);
      await page.goto(`${base}/#/financeiro`);
      await pronto();
      assert.equal(await page.locator(".fin-cartoes").count(), 0, login);
      await sair();
    }

    const reais = problemas.filter(p => !/status of 403/.test(p));
    assert.deepEqual(reais, [], `erros no console: ${reais.join(" | ")}`);
    passo("OK — nenhum erro no console (inclui bloqueios de CSP)");
  } catch (e) {
    await page.screenshot({ path: join(PRINTS, `${tela.nome}-FALHA.png`), fullPage: true }).catch(() => {});
    throw e;
  } finally {
    await navegador.close();
    servidor.kill();
  }
}

for (const tela of TELAS) await rodar(tela);
console.log("TESTE NO NAVEGADOR DO RELATÓRIO FINANCEIRO: OK (computador 1366 px e celular 390 px)");
