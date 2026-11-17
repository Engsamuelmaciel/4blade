// Teste no navegador: NOTIFICAÇÕES (sino), NOTA VENCIDA (pop-up de aceite ao marcar), BLOQUEAR CLIENTE e VISÃO DO DIA.
// Pedido de 17/11/2026. Dados FICTÍCIOS (semana simulada + uma nota "antiga" criada pelo servidor local).
// Roda em computador (1366 px) e celular (390 px); prints em docs/prints/notificacoes/.  Uso: node test/navegador-notificacoes.mjs
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
const PRINTS = join(RAIZ, "docs", "prints", "notificacoes");
mkdirSync(PRINTS, { recursive: true });
const AMANHA = somarDias(hojeBrasil(), 1);
const SENHA = "Senha-Semana-2026";
const CLIENTE = "Cliente Fictício 1";

const TELAS = [
  { nome: "computador", largura: 1366, altura: 768, movel: false, porta: 8841 },
  { nome: "celular", largura: 390, altura: 844, movel: true, porta: 8842 }
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
    console.log(`  print: docs/prints/notificacoes/${arq}`);
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
    await fetch(`${base}/__teste/nota-antiga?login=caixa.semana&cliente=${encodeURIComponent(CLIENTE)}&dias=35&valor=4000`);

    passo("caixa: sino com número, Visão do dia com o resumo, semana e pendências");
    await entrar("caixa.semana");
    await page.waitForSelector("#btn-notif .sino-num:not([hidden])");
    assert.ok(Number(await page.textContent("#btn-notif .sino-num")) >= 1, "pelo menos a nota vencida");
    await ir(page, "Visão do dia");
    await page.waitForSelector("[data-teste=visao-resumo]");
    assert.equal(await page.locator("[data-teste=visao-semana] [data-dia]").count(), 7);
    await page.waitForSelector(`[data-nota-vencida="${CLIENTE}"]`);
    assert.match(await page.textContent(`[data-nota-vencida="${CLIENTE}"]`), /R\$\s?40,00/);
    await print("caixa-visao-do-dia");

    passo("caixa cobra no WhatsApp e bloqueia o cliente da nota vencida");
    await abrirItem(page, `[data-nota-vencida="${CLIENTE}"]`);
    const link = await page.getAttribute(`[data-nota-vencida="${CLIENTE}"] a:has-text("Cobrar no WhatsApp")`, "href");
    assert.match(link, /^https:\/\/wa\.me\/55\d+\?text=.*nota/);
    await print("caixa-nota-vencida-aberta", { inteira: false });
    await page.click(`[data-nota-vencida="${CLIENTE}"] button:has-text("Bloquear")`);
    await page.fill("dialog[open] #c-motivo", "Nota vencida há mais de 30 dias");
    await ok();
    await page.waitForSelector(`[data-bloqueado="${CLIENTE}"]`);
    await page.waitForSelector(`[data-nota-vencida="${CLIENTE}"] .etiqueta:has-text("Bloqueado")`);

    passo("bloqueado não marca horário");
    await ir(page, "Agenda");
    await page.click("button:has-text('+ Novo horário')");
    await page.fill("dialog[open] #cli-busca", "Cliente Fictício 1");
    await page.click(`dialog[open] [data-cliente-opcao="${CLIENTE}"]`);
    await page.waitForSelector("dialog[open] [data-teste=aviso-bloqueado]");
    await page.keyboard.press("Escape");

    passo("desbloqueia pela Visão do dia");
    await ir(page, "Visão do dia");
    await page.click(`[data-bloqueado="${CLIENTE}"] button:has-text("Desbloquear")`);
    await page.fill("dialog[open] #c-motivo", "Combinou pagar no próximo corte");
    await ok();
    await page.waitForSelector("text=desbloqueado");
    await page.waitForSelector(`[data-bloqueado="${CLIENTE}"]`, { state: "detached" });

    passo("marcar para cliente com nota vencida: aviso no cliente + pop-up de aceite");
    await ir(page, "Agenda");
    await page.click("button:has-text('+ Novo horário')");
    await page.selectOption("dialog[open] #c-prof", { label: "Ana Barbeira" });
    await page.fill("dialog[open] #c-data", AMANHA);
    await page.locator("dialog[open] #c-data").dispatchEvent("change");
    await page.waitForSelector('dialog[open] [data-teste=disponibilidade] [data-hora-livre="15:00"]');
    await page.click('dialog[open] [data-hora-livre="15:00"]');
    await page.check("dialog[open] input[name=serv] >> nth=0");
    await page.fill("dialog[open] #cli-busca", "Cliente Fictício 1");
    await page.waitForSelector(`dialog[open] [data-cliente-opcao="${CLIENTE}"] [data-selo=nota-vencida]`);
    await page.click(`dialog[open] [data-cliente-opcao="${CLIENTE}"]`);
    await page.waitForSelector("dialog[open] [data-teste=aviso-nota-vencida]");
    assert.match(await page.textContent("dialog[open] [data-teste=aviso-nota-vencida]"), /R\$\s?40,00.*35 dias/);
    await ok();
    await page.waitForSelector("[data-teste=alerta-aceite][open]");
    assert.match(await page.textContent("[data-teste=alerta-aceite]"), /nota vencida.*R\$\s?40,00/is);
    await print("pop-up-nota-vencida", { inteira: false });
    await page.click("[data-teste=alerta-aceite] [data-teste=aceitar]");
    await page.waitForSelector(`[data-agendamento="${CLIENTE}"]`);
    assert.ok(await page.locator(`[data-agendamento="${CLIENTE}"] [data-selo=nota-vencida]`).count() >= 1, "selo no cartão da agenda");
    if (await page.locator("dialog#janela[open]").count()) await page.keyboard.press("Escape");   // "Horário marcado" (confirmação no WhatsApp)
    await page.waitForSelector("dialog#janela[open]", { state: "detached" }).catch(() => {});
    await page.waitForFunction(() => !document.querySelector("dialog#janela").open);
    await print("agenda-com-selo-nota");

    passo("notificações pelo sino; marcar como vistas zera o número");
    await page.click("#btn-notif");
    await page.waitForSelector(".lista-notif .notif");
    await pronto();
    const titulos = await page.locator(".lista-notif .notif strong").allInnerTexts();
    assert.ok(titulos.includes("Nota vencida"), titulos.join(","));
    assert.ok(!titulos.includes("Despesa atrasada"), "caixa não vê despesas");
    await print("caixa-notificacoes");
    await page.click("button:has-text('Marcar todas como vistas')");
    await page.waitForSelector("#btn-notif .sino-num[hidden]", { state: "attached" });
    await page.click(`.lista-notif [data-notif=nota] a`);
    await page.waitForSelector(`[data-nota-cliente="${CLIENTE}"]`);
    await sair();

    passo("gerente: notificações com despesas e valores; Visão do dia também");
    await entrar("gerente.semana");
    await ir(page, "Notificações");
    await page.waitForSelector(".lista-notif .notif");
    const tg = await page.locator(".lista-notif .notif strong").allInnerTexts();
    for (const t of ["Nota vencida", "Despesa atrasada"]) assert.ok(tg.includes(t), `${t}: ${tg.join(",")}`);
    await page.click(".chips-filtro [data-filtro=despesa]");
    assert.ok(await page.locator(".lista-notif [data-notif=despesa]").count() >= 1);
    assert.equal(await page.locator(".lista-notif [data-notif=nota]").count(), 0, "filtro");
    await print("gerente-notificacoes");
    await ir(page, "Clientes");
    await page.click(".chips-filtro [data-filtro=pendencia]");
    await page.waitForSelector(`[data-cliente="${CLIENTE}"] [data-selo=nota-vencida]`);
    await print("gerente-clientes-pendencia");
    await sair();

    passo("barbeiro: sino e notificações só dos atendimentos dele; sem Visão do dia");
    await entrar("ana.semana");
    assert.equal(await page.locator("#menu a[href='#/visao-dia']").count(), 0);
    await page.click("#btn-notif");
    await page.waitForSelector("h2:has-text('Notificações')");
    await pronto();
    const tb = await page.locator(".lista-notif .notif").evaluateAll(l => l.map(x => x.dataset.notif));
    assert.ok(tb.every(t => t === "atendimento"), tb.join(","));
    await sair();

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
console.log("TESTE NO NAVEGADOR DAS NOTIFICAÇÕES E VISÃO DO DIA: OK (computador 1366 px e celular 390 px)");
