// Teste no navegador: PAGAMENTO DA EQUIPE e COBRANÇA COM PRODUTO no relatório.
// Pedido de 17/11/2026. Dados FICTÍCIOS (semana simulada).
// Roda em computador (1366 px) e celular (390 px); prints em docs/prints/equipe/.  Uso: node test/navegador-notificacoes.mjs
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
const PRINTS = join(RAIZ, "docs", "prints", "equipe");
mkdirSync(PRINTS, { recursive: true });
const AMANHA = somarDias(hojeBrasil(), 1);
const SENHA = "Senha-Semana-2026";
const CLIENTE = "Cliente Fictício 1";

const TELAS = [
  { nome: "computador", largura: 1366, altura: 768, movel: false, porta: 8851 },
  { nome: "celular", largura: 390, altura: 844, movel: true, porta: 8852 }
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
    console.log(`  print: docs/prints/equipe/${arq}`);
  };
  const passo = t => console.log(`[${tela.nome}] ${t}`);
  const ok = () => page.click("dialog[open] button[type=submit]");
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

  try {
    passo("gerente abre Pagamento da equipe: produção, comissão, salário, vales e quanto falta pagar");
    await entrar("gerente.semana");
    await ir(page, "Pagamento da equipe");
    await page.waitForSelector("[data-teste=resumo-equipe]");
    await page.waitForSelector('[data-pessoa="Beto Barbeiro"]');
    await page.waitForSelector('[data-pessoa="Carla Caixa"]');
    await print("equipe-mes");

    passo("define o salário da Carla (caixa) e do Beto, paga o Beto no Pix");
    await abrirItem(page, '[data-pessoa="Carla Caixa"]');
    await page.click('[data-pessoa="Carla Caixa"] .item-x-acoes button:has-text("Definir salário")');
    await page.fill("dialog[open] #c-sal", "1200,00");
    await ok();
    await page.waitForSelector('[data-pessoa="Carla Caixa"] [data-teste=a-pagar]:has-text("1.200,00")');
    await abrirItem(page, '[data-pessoa="Beto Barbeiro"]');
    await page.click('[data-pessoa="Beto Barbeiro"] button:has-text("Definir salário")');
    await page.fill("dialog[open] #c-sal", "1500,00");
    await ok();
    await page.waitForSelector('[data-pessoa="Beto Barbeiro"] [data-teste=a-pagar]:has-text("1.5")');   // salário + comissão − vales
    const aPagarBeto = await page.textContent('[data-pessoa="Beto Barbeiro"] [data-teste=a-pagar]');
    assert.match(aPagarBeto, /R\$\s?1\.\d{3},\d\d/);
    await abrirItem(page, '[data-pessoa="Beto Barbeiro"]');
    assert.match(await page.textContent('[data-pessoa="Beto Barbeiro"] .quadro-pessoa'), /Produção.*Comissão.*Salário fixo.*R\$\s?1\.500,00.*Vales.*A pagar.*Custo para a barbearia/s);
    await print("equipe-beto-aberto", { inteira: false });
    await page.click('[data-pessoa="Beto Barbeiro"] .item-x-acoes button:has-text("Pagar")');
    await page.waitForSelector("dialog[open] .destaque-valor");
    assert.equal((await page.textContent("dialog[open] .destaque-valor")).replace(/\s/g, ""), aPagarBeto.replace(/\s/g, ""));
    await print("equipe-pagar", { inteira: false });
    await ok();
    await page.waitForSelector("text=Pagamento de Beto Barbeiro registrado");
    await page.waitForSelector('[data-pessoa="Beto Barbeiro"] .etiqueta:has-text("Pago")');
    await print("equipe-beto-pago");

    passo("o salário aparece no relatório financeiro (saídas e custo por pessoa) e no painel (gastos com pessoal)");
    await ir(page, "Relatório financeiro");
    await page.waitForSelector(".fin-cartoes");
    await page.click(".fin-controles .alterna button:has-text('Mês')");
    await pronto();
    assert.match(await page.textContent("[data-parte='Salários (equipe)']"), /R\$\s?1\.500,00/);
    assert.match(await page.textContent('[data-pessoa-fin="Beto Barbeiro"]'), /1\.500,00/);
    const d = page.locator("[data-secao-fin=profissionais]");
    if (await d.getAttribute("open") === null) await d.locator(":scope > summary").click();
    await d.scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(PRINTS, `${tela.nome}-${String(++n).padStart(2, "0")}-financeiro-equipe.png`) });
    await ir(page, "Painel");
    await page.waitForSelector("[data-cartao=pessoal]");
    await page.click("button:has-text('Mês')").catch(() => {});
    await pronto();
    assert.match(await page.textContent("[data-cartao=pessoal]"), /salários pagos R\$\s?1\.500,00/);
    await sair();

    passo("sangria maior que o dinheiro da gaveta: aviso de saldo negativo, aceite e saldo negativo no caixa");
    await entrar("caixa.semana");
    await ir(page, "Caixa");
    await page.waitForSelector(".pdv-topo");
    await page.click(".pdv-ferramentas button:has-text('Sangria')");
    await page.fill("dialog[open] #c-valor", "2.000,00");
    await page.fill("dialog[open] #c-motivo", "Fornecedor pago no Pix (fictício)");
    await ok();
    await page.waitForSelector("[data-teste=alerta-aceite][open]");
    assert.match(await page.textContent("[data-teste=alerta-aceite]"), /saldo negativo/i);
    await print("sangria-aviso-saldo-negativo", { inteira: false });
    await page.click("[data-teste=alerta-aceite] [data-teste=aceitar]");
    await page.waitForSelector("[data-teste=saldo-negativo]");
    assert.match(await page.textContent("[data-teste=esperado]"), /-/);
    await print("caixa-saldo-negativo");
    await sair();

    passo("barbeiro e caixa não veem o Pagamento da equipe");
    for (const login of ["ana.semana", "caixa.semana"]) {
      await entrar(login);
      assert.equal(await page.locator("#menu a[href='#/pagamento-equipe']").count(), 0, login);
      await sair();
    }

    const reais = problemas.filter(p => !/status of 40[39]/.test(p));
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
console.log("TESTE NO NAVEGADOR DO PAGAMENTO DA EQUIPE: OK (computador 1366 px e celular 390 px)");
