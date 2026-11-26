// Teste no navegador da entrega E3 — base copiada do teste da E2 (Playwright). Dados FICTÍCIOS.
// Caminho: gerente dá entrada no estoque e faz ajuste → caixa abre, recebe 2 atendimentos, vende produto, faz sangria,
// suprimento e corrige uma forma de pagamento → fecha com R$ 5,00 de falta → barbeiro vê produto disponível/esgotado →
// gerente vê o histórico, reabre o caixa com motivo e faz inventário.
// Roda em computador (1366 px) e celular (390 px); prints em docs/prints/e3/.  Uso: node test/navegador-e3.mjs
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { ir, abrirItem, abrirCadastro, vitrine, forma, lancamentos, voltarVenda } from "./navegacao.mjs";
import { hojeBrasil } from "../src/util.js";
import { somarDias } from "../src/agenda-util.js";

const { chromium } = createRequire(import.meta.url)("playwright");
const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
const PRINTS = join(RAIZ, "docs", "prints", "e3");
mkdirSync(PRINTS, { recursive: true });
const HOJE = hojeBrasil();
const AMANHA = somarDias(HOJE, 1);

const TELAS = [
  { nome: "computador", largura: 1366, altura: 768, movel: false, porta: 8795 },
  { nome: "celular", largura: 390, altura: 844, movel: true, porta: 8796 }
];

async function subirServidor(porta) {
  const proc = spawn(process.execPath, ["--no-warnings", join(RAIZ, "test", "servidor-local.mjs"), String(porta)], { stdio: ["ignore", "pipe", "inherit"] });
  await new Promise((ok, falha) => {
    proc.stdout.on("data", d => { if (String(d).includes(`localhost:${porta}`)) ok(); });
    proc.on("exit", c => falha(new Error(`servidor saiu (${c})`)));
  });
  return proc;
}

// Prepara a barbearia pela API (o caminho de criação pela tela já é coberto no teste da E1).
async function preparar(base) {
  const chamar = async (caminho, corpo, token) => {
    const r = await fetch(`${base}/api${caminho}`, {
      method: corpo ? "POST" : "GET",
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: corpo ? JSON.stringify(corpo) : undefined
    });
    const d = await r.json();
    if (!r.ok) throw new Error(`${caminho}: ${d.erro}`);
    return d;
  };
  const ativar = async (login, prov, nova) => {
    const l = await chamar("/auth/login", { login, senha: prov });
    await chamar("/auth/trocar-senha", { senhaAtual: prov, novaSenha: nova }, l.token);
    return (await chamar("/auth/login", { login, senha: nova })).token;
  };
  const plat = (await chamar("/auth/login", { login: "suporte", senha: "Nova-suporte-senha" })).token;
  const b = await chamar("/plataforma/barbearias", { nome: "Barbearia Navalha Fictícia", proprietario: { nome: "Carlos Fictício", login: "carlos.navalha" } }, plat);
  const prop = await ativar("carlos.navalha", b.senhaProvisoria, "Senha-Carlos-2026");
  const pessoas = [["gerente", "Gabriel Gerente", "gabriel.navalha", 4000], ["barbeiro", "Bruno Barbeiro", "bruno.navalha", 5000], ["caixa", "Camila Caixa", "camila.navalha", 0]];
  for (const [perfil, nome, login, com] of pessoas) {
    const r = await chamar("/usuarios", { perfil, nome, login, comissaoServicoBp: com }, prop);
    await ativar(login, r.senhaProvisoria, `Senha-${nome.split(" ")[0]}-2026`);
  }
  const ger = (await chamar("/auth/login", { login: "gabriel.navalha", senha: "Senha-Gabriel-2026" })).token;
  await chamar("/servicos", { nome: "Corte masculino", precoCentavos: 4000, duracaoMin: 30 }, ger);
  await chamar("/servicos", { nome: "Barba completa", precoCentavos: 3000, duracaoMin: 20 }, ger);
  await chamar("/produtos", { nome: "Pomada modeladora", precoCentavos: 4500, estoqueMinimo: 3 }, ger);
  await chamar("/produtos", { nome: "Óleo para barba", precoCentavos: 3850, estoqueMinimo: 2 }, ger);
  await chamar("/produtos", { nome: "Shampoo anticaspa", precoCentavos: 3200, estoqueMinimo: 2 }, ger);
  const dias = [0, 1, 2, 3, 4, 5, 6].map(dia => ({ dia, aberto: true, abre: "08:00", fecha: "20:00" }));
  await chamar("/funcionamento/salvar", { dias }, ger);
  return { chamar, ger };
}

async function rodar(tela) {
  const servidor = await subirServidor(tela.porta);
  const base = `http://localhost:${tela.porta}`;
  const { chamar, ger } = await preparar(base);
  const navegador = await chromium.launch();
  const contexto = await navegador.newContext({
    viewport: { width: tela.largura, height: tela.altura },
    deviceScaleFactor: 2, isMobile: tela.movel, hasTouch: tela.movel, locale: "pt-BR", timezoneId: "America/Sao_Paulo"
  });
  // Agenda do dia: os testes antigos usam o modo "Lista" (a grade é testada à parte em navegador-e2).
  await contexto.addInitScript(() => { try { if (!localStorage.getItem("4blade.agendaModo")) localStorage.setItem("4blade.agendaModo", "lista"); } catch { /* about:blank */ } });
  const page = await contexto.newPage();
  const problemas = [];
  page.on("console", m => {
    if (m.type() === "error" && !/^Failed to load resource: the server responded with a status of (400|403|409)\b/.test(m.text())) problemas.push(m.text());
  });
  page.on("pageerror", e => problemas.push(e.message));
  let n = 0;
  const print = async nome => {
    n++;
    const arq = `${tela.nome}-${String(n).padStart(2, "0")}-${nome}.png`;
    await page.waitForTimeout(200);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: join(PRINTS, arq), fullPage: true });
    const texto = await page.locator("body").innerText();
    assert.ok(!/\bnull\b|\bundefined\b|NaN/.test(texto), `texto estranho na tela ${nome}`);
    console.log(`  print: docs/prints/e3/${arq}`);
  };
  const passo = t => console.log(`[${tela.nome}] ${t}`);
  const entrar = async (login, senha) => {
    await page.fill("#c-login", login);
    await page.fill("#c-senha", senha);
    await page.click("button:has-text('Entrar')");
  };
  const sair = async () => { await page.click("#btn-conta"); await page.click("#btn-sair"); await page.waitForSelector("text=Você saiu do sistema."); };
  const ok = () => page.click("dialog[open] button[type=submit]");
  const texto = sel => page.textContent(sel);

  try {
    await page.goto(`${base}/#/entrar`);

    // ---------- GERENTE: entradas e ajuste ----------
    passo("gerente dá entrada no estoque e registra uma quebra");
    await entrar("gabriel.navalha", "Senha-Gabriel-2026");
    await ir(page, "Produtos e estoque");
    await page.waitForSelector('[data-estoque="Pomada modeladora"]');
    for (const [nome, qtd, custo] of [["Pomada modeladora", "10", "20,00"], ["Óleo para barba", "6", "15,00"]]) {
      await abrirItem(page, `[data-estoque="${nome}"]`);
      await page.click(`[data-estoque="${nome}"] button:has-text("Entrada")`);
      await page.fill("dialog[open] [name=qtd]", qtd);
      await page.fill("dialog[open] [name=custo]", custo);
      await page.fill("dialog[open] [name=forn]", "Distribuidora Fictícia");
      if (nome.startsWith("Pomada")) await print("gerente-entrada-de-mercadoria");
      await ok();
      await page.waitForSelector(`[data-estoque="${nome}"] [data-teste=saldo]:has-text("${qtd} un.")`);
    }
    await abrirItem(page, '[data-estoque="Óleo para barba"]');
    await page.click('[data-estoque="Óleo para barba"] button:has-text("Ajuste")');
    await page.selectOption("dialog[open] [name=motivoAj]", "quebra");
    await page.fill("dialog[open] [name=qtd]", "1");
    await page.fill("dialog[open] [name=obsAj]", "Frasco caiu");
    await ok();
    await page.waitForSelector('[data-estoque="Óleo para barba"] [data-teste=saldo]:has-text("5 un.")');
    assert.match(await texto('[data-estoque="Shampoo anticaspa"]'), /Repor/);
    await print("gerente-estoque-com-avisos");
    await sair();

    // ---------- CAIXA ----------
    passo("caixa abre, recebe atendimentos, vende, faz sangria/suprimento e corrige forma");
    await entrar("camila.navalha", "Senha-Camila-2026");
    await ir(page, "Caixa");
    // Mensagens em destaque no menu do topo do caixa (26/11/2026) e a tela abre
    assert.deepEqual(await page.locator("#nav-topo [data-nav-topo]").allInnerTexts(), ["Hoje", "Caixa", "Agenda", "Clientes", "Mensagens", "Notas"]);
    await page.fill("#c-troco", "100,00");
    await page.click("button:has-text('Abrir caixa')");
    await page.waitForSelector(".pdv-topo");
    await page.click('#nav-topo [data-nav-topo="Mensagens"]');
    await page.waitForSelector(".zap");
    await ir(page, "Caixa");
    await page.waitForSelector(".pdv-topo");
    // 2 atendimentos finalizados pelo barbeiro (pela API): 40,00 dinheiro e 70,00 pix
    const barbTok = (await chamar("/auth/login", { login: "bruno.navalha", senha: "Senha-Bruno-2026" })).token;
    const servs = (await chamar("/servicos", null, ger)).servicos;
    const corte = servs.find(s => s.nome === "Corte masculino");
    const barba = servs.find(s => s.nome === "Barba completa");
    for (const [hora, itens, forma, valor, tel, nome] of [
      ["09:00", [corte], "dinheiro", 4000, "11 90000-1111", "Diego Cliente Fictício"],
      ["10:00", [corte, barba], "pix", 7000, "11 90000-2222", "Elias Cliente Fictício"]]) {
      const m = await chamar("/agenda", { data: HOJE, hora, servicoIds: itens.map(s => s.id), cliente: { telefone: tel, nome, aceiteLgpd: true } }, barbTok);
      await chamar("/agenda/finalizar", { id: m.agendamento.id, itens: itens.map(s => ({ servicoId: s.id, precoCobradoCentavos: s.precoCentavos })), pagamentos: [{ forma, valorCentavos: valor }] }, barbTok);
    }
    await lancamentos(page);
    await page.waitForSelector('[data-lancamento="Elias Cliente Fictício"]');

    // Vender | Lançamentos do dia em destaque no alto do Caixa (26/11/2026)
    await page.click("[data-aba-caixa=venda]");
    await page.waitForSelector(".fc-busca");
    assert.equal(await page.locator("[data-lancamento]").count(), 0, "Vender não mostra os lançamentos");
    assert.ok(Number((await page.locator("[data-aba-caixa=lancamentos] .aba-num").innerText()).trim()) >= 1, "contador de lançamentos na aba");
    await page.click("[data-aba-caixa=lancamentos]");
    await page.waitForSelector('[data-lancamento="Elias Cliente Fictício"]');
    assert.equal(await page.locator("[data-aba-caixa=lancamentos]").getAttribute("aria-selected"), "true");
    await print("caixa-abas-vender-lancamentos");

    // PDV: produtos em botões + carrinho
    await voltarVenda(page);
    await vitrine(page, "produtos");
    await page.waitForSelector('[data-produto-pdv="Pomada modeladora"]');
    assert.equal(await page.locator("[data-produto-pdv='Shampoo anticaspa']").count(), 0, "sem estoque não aparece para vender");
    await page.click('[data-produto-pdv="Pomada modeladora"]');
    await page.click('[data-produto-pdv="Pomada modeladora"]');
    await page.waitForSelector("[data-teste=total-venda]:has-text('90,00')");
    await forma(page, "dinheiro");
    await print("caixa-venda-de-produto");
    await page.click("[data-teste=carrinho] button:has-text('Finalizar venda')");
    await page.waitForSelector("text=Venda registrada");
    await lancamentos(page);
    await page.waitForSelector('[data-lancamento="2x Pomada modeladora"]');

    await page.click("button:has-text('Sangria')");
    await page.fill("dialog[open] [name=valor]", "50,00");
    await page.fill("dialog[open] [name=motivo]", "Depósito no banco");
    await ok();
    await page.waitForSelector('[data-lancamento="Depósito no banco (Camila Caixa)"]');
    await page.click("button:has-text('Suprimento')");
    await page.fill("dialog[open] [name=valor]", "20,00");
    await page.fill("dialog[open] [name=motivo]", "Troco extra");
    await ok();
    await page.waitForSelector('[data-lancamento="Troco extra (Camila Caixa)"]');

    await page.click('[data-lancamento="Elias Cliente Fictício"] button:has-text("Corrigir")');
    await page.click("dialog[open] [data-correcao=forma]");   // 19/11/2026: "Corrigir" pergunta se é só a forma ou o valor
    await page.waitForSelector("dialog[open] [name=nova]");
    await page.selectOption("dialog[open] [name=nova]", "debito");
    await page.fill("dialog[open] [name=motivo]", "Cliente pagou no débito");
    await ok();
    await page.waitForSelector('[data-lancamento="Elias Cliente Fictício"] >> text=Forma corrigida: Pix → Débito');
    // esperado = 100 (troco) + 40 + 90 (dinheiro) + 20 (suprimento) − 50 (sangria) = 200,00
    assert.match(await texto("[data-teste=esperado]"), /R\$\s?200,00/);
    assert.match(await texto("[data-teste=entradas]"), /R\$\s?200,00/, "40 + 70 + 90");
    assert.ok(!/comiss|custo|margem/i.test(await page.locator("main").innerText()), "caixa não vê comissão/custo");
    await print("caixa-lancamentos-do-dia");

    passo("caixa fecha com R$ 5,00 de falta");
    await page.click("button:has-text('Fechar caixa')");
    await page.fill("dialog[open] [name=contado]", "195,00");
    await page.waitForSelector("dialog[open] [data-teste=diferenca]:has-text('Falta de R$')");
    assert.match(await texto("dialog[open] [data-teste=diferenca]"), /Falta de R\$\s?5,00/);
    await ok();
    await page.waitForSelector("dialog[open] .erro:has-text('observação')");
    await page.fill("dialog[open] [name=obs]", "Troco dado a mais (fictício)");
    await print("caixa-fechamento-esperado-x-contado");
    await ok();
    // 19/11/2026: o caixa continua na tela de PDV (pode seguir lançando); o fechamento fica num aviso que abre ao tocar
    await page.waitForSelector("[data-teste=aviso-gerente-caixa]");
    await page.click("[data-teste=aviso-gerente-caixa] > summary");
    assert.match(await texto("[data-teste=diferenca-fechada]"), /Falta de R\$\s?5,00/);
    assert.equal(await page.locator("button:has-text('Reabrir caixa')").count(), 0, "caixa não reabre");
    assert.equal(await page.locator(".pdv-ferramentas button:has-text('Fechar caixa')").count(), 0, "já fechado");
    await print("caixa-fechado");
    await sair();

    // ---------- BARBEIRO ----------
    passo("barbeiro vê disponível/indisponível, sem custo");
    await entrar("bruno.navalha", "Senha-Bruno-2026");
    await ir(page, "Produtos");
    await page.waitForSelector('[data-produto="Shampoo anticaspa"]');
    assert.match(await texto('[data-produto="Shampoo anticaspa"]'), /Indisponível/);
    assert.match(await texto('[data-produto="Pomada modeladora"]'), /Disponível/);
    assert.ok(!/custo|margem/i.test(await page.locator("main").innerText()));
    await print("barbeiro-produtos-disponibilidade");
    await sair();

    // ---------- GERENTE: histórico, reabrir caixa, inventário ----------
    passo("gerente vê o histórico, reabre o caixa com motivo e faz inventário");
    await entrar("gabriel.navalha", "Senha-Gabriel-2026");
    await ir(page, "Caixa");
    // Gerente lança mesmo com o caixa fechado (17/11/2026): vê o aviso e vende.
    await page.waitForSelector("[data-teste=aviso-gerente-caixa]");
    assert.match(await texto("[data-teste=aviso-gerente-caixa]"), /já foi fechado/);
    await vitrine(page, "produtos");
    await page.waitForSelector('[data-produto-pdv="Pomada modeladora"]');
    await page.click('[data-produto-pdv="Pomada modeladora"]');
    await forma(page, "pix");
    await page.click("[data-teste=carrinho] button:has-text('Finalizar venda')");
    await page.waitForSelector("text=Venda registrada");
    await print("gerente-vende-com-caixa-fechado");
    await page.click(".pdv-ferramentas a:has-text('Outros dias')");
    await page.waitForSelector(`[data-caixa-dia="${HOJE}"]`);
    assert.match(await texto(`[data-caixa-dia="${HOJE}"]`), /falta R\$\s?5,00/);
    await print("gerente-historico-de-caixas");
    await page.click(`[data-caixa-dia="${HOJE}"] a`);
    await page.click("[data-teste=aviso-gerente-caixa] > summary");
    await page.click("button:has-text('Reabrir caixa')");
    await page.fill("dialog[open] #c-motivo", "Conferir venda lançada");
    await ok();
    await page.waitForSelector("button:has-text('Fechar caixa')");
    await page.waitForSelector("text=Reaberto 1x");
    await print("gerente-caixa-reaberto");

    await ir(page, "Produtos e estoque");
    await page.click("button:has-text('Inventário')");
    await page.fill("[aria-label='Contado de Pomada modeladora']", "6");
    await page.waitForSelector('dialog[open] [data-inventario="Pomada modeladora"] >> text=diferença -1');
    await print("gerente-inventario");
    await ok();
    await page.waitForSelector('[data-estoque="Pomada modeladora"] [data-teste=saldo]:has-text("6 un.")');
    await abrirItem(page, '[data-estoque="Pomada modeladora"]');
    await page.click('[data-estoque="Pomada modeladora"] button:has-text("Histórico")');
    await page.waitForSelector("dialog[open] >> text=Inventário");
    const hist = await page.locator("dialog[open]").innerText();
    assert.match(hist, /Venda/);
    assert.match(hist, /Entrada/);
    await print("gerente-historico-do-produto");
    await page.click("dialog[open] button:has-text('Fechar')");
    await sair();

    assert.deepEqual(problemas, [], `erros no console: ${problemas.join(" | ")}`);
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
console.log("TESTE NO NAVEGADOR E3: OK (computador 1366 px e celular 390 px)");
