// Teste no navegador da entrega E4 (Playwright). Dados FICTÍCIOS.
// Caminho (com a semana simulada de test/semana-simulada.mjs): gerente vê o painel (Hoje/Semana/Mês) com os números
// conferidos à mão → lança e cancela um vale → fecha a comissão da semana e registra um pagamento → cadastra e paga conta com
// dinheiro do caixa → envia ao contador (PDF + planilha baixados) e vê o aviso de alteração → baixa uma planilha da cópia dos dados →
// barbeira não tem "Meu desempenho" (retirado em 17/11/2026).
// Roda em computador (1366 px) e celular (390 px); prints em docs/prints/e4/.  Uso: node test/navegador-e4.mjs
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { ir, abrirItem, abrirCadastro } from "./navegacao.mjs";
import { hojeBrasil } from "../src/util.js";
import { somarDias } from "../src/agenda-util.js";

const { chromium } = createRequire(import.meta.url)("playwright");
const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
const PRINTS = join(RAIZ, "docs", "prints", "e4");
mkdirSync(PRINTS, { recursive: true });
const HOJE = hojeBrasil();
const AMANHA = somarDias(HOJE, 1);

const TELAS = [
  { nome: "computador", largura: 1366, altura: 768, movel: false, porta: 8797 },
  { nome: "celular", largura: 390, altura: 844, movel: true, porta: 8798 }
];

async function subirServidor(porta) {
  const proc = spawn(process.execPath, ["--no-warnings", join(RAIZ, "test", "servidor-local.mjs"), String(porta), "--semana"], { stdio: ["ignore", "pipe", "inherit"] });
  await new Promise((ok, falha) => {
    proc.stdout.on("data", d => { if (String(d).includes(`localhost:${porta}`)) ok(); });
    proc.on("exit", c => falha(new Error(`servidor saiu (${c})`)));
  });
  return proc;
}

const SENHA = "Senha-Semana-2026";
const dia = i => somarDias(HOJE, i - 6);

async function rodar(tela) {
  const servidor = await subirServidor(tela.porta);
  const base = `http://localhost:${tela.porta}`;
  const navegador = await chromium.launch();
  const contexto = await navegador.newContext({
    viewport: { width: tela.largura, height: tela.altura },
    deviceScaleFactor: 2, isMobile: tela.movel, hasTouch: tela.movel, locale: "pt-BR", timezoneId: "America/Sao_Paulo", acceptDownloads: true
  });
  await contexto.route(/wa\.me/, r => r.fulfill({ status: 200, contentType: "text/html", body: "<p>WhatsApp (simulado)</p>" }));
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
    await page.waitForTimeout(250);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: join(PRINTS, arq), fullPage: true });
    const texto = await page.locator("body").innerText();
    assert.ok(!/\bnull\b|\bundefined\b|NaN/.test(texto), `texto estranho na tela ${nome}`);
    console.log(`  print: docs/prints/e4/${arq}`);
  };
  const passo = t => console.log(`[${tela.nome}] ${t}`);
  const entrar = async login => {
    await page.fill("#c-login", login);
    await page.fill("#c-senha", SENHA);
    await page.click("button:has-text('Entrar')");
  };
  const sair = async () => { await page.click("#btn-conta"); await page.click("#btn-sair"); await page.waitForSelector("text=Você saiu do sistema."); };
  const ok = () => page.click("dialog[open] button[type=submit]");
  const texto = sel => page.textContent(sel);
  const R = v => new RegExp(`R\\$\\s?${v.replace(".", "\\.")}`);
  // Baixa e confere o começo do arquivo.
  const baixados = async (acao, qtd) => {
    const lista = [];
    const espera = new Promise(ok => { page.on("download", function h(d) { lista.push(d); if (lista.length === qtd) { page.off("download", h); ok(); } }); });
    await acao();
    await espera;
    const saida = [];
    for (const d of lista) saida.push([d.suggestedFilename(), (await import("node:fs")).readFileSync(await d.path())]);
    return saida;
  };

  try {
    await page.goto(`${base}/#/entrar`);

    // ---------- PAINEL ----------
    passo("gerente vê o painel com os números conferidos à mão");
    await entrar("gerente.semana");
    await ir(page, "Painel");
    await page.waitForSelector("[data-cartao=bruto]");
    // hoje: Beto 70,00; comissão 40% = 28,00; lucro 42,00
    assert.match(await texto("[data-cartao=bruto]"), R("70,00"));
    assert.match(await texto("[data-cartao=lucro]"), R("42,00"));
    await print("gerente-painel-hoje");
    await page.click(".filtro-periodo button:has-text('Semana')");
    await page.waitForSelector("[data-cartao=bruto] >> text=535,00");
    assert.match(await texto("[data-cartao=atendimentos]"), /8\s*Ticket médio R\$\s?44,38/);
    assert.match(await texto("[data-cartao=vendas]"), R("180,00"));
    assert.match(await texto("[data-cartao=comissoes]"), R("178,00"));
    assert.match(await texto("[data-cartao=comissoes]"), /Ana R\$\s?94,50 · Beto R\$\s?83,50/);
    assert.match(await texto("[data-cartao=lucro]"), R("277,00"));
    assert.match(await texto("[data-cartao=contas]"), /Atrasadas: 1 · R\$\s?200,00/);
    const avisos = await texto(".lista-avisos");
    assert.match(avisos, new RegExp(`Caixa de ${dia(4).split("-").reverse().join("/")} ainda aberto`));
    assert.match(avisos, /falta de R\$\s?10,00/);
    assert.match(avisos, /1 atendimento\(s\) com valor alterado/);
    assert.match(avisos, /Estoque baixo: Pomada/);
    assert.equal(await page.locator("svg.grafico rect.barra").count(), 7, "7 barras, uma por dia");
    assert.match(await texto('[data-ranking="Ana Barbeira"]'), /1º Ana Barbeira\s*R\$\s?180,00 · 4 atend\./);
    await print("gerente-painel-semana");
    await page.click(".filtro-periodo button:has-text('Mês')");
    await page.waitForSelector("text=contas pagas");
    await print("gerente-painel-mes");

    // ---------- COMISSÕES E VALES ----------
    passo("gerente lança e cancela um vale, fecha a comissão da semana e registra um pagamento");
    // Comissões e vales ficam numa aba do Pagamento da equipe (17/11/2026)
    assert.equal(await page.locator("#menu [data-nav='Comissões e vales']").count(), 0, "sem item próprio no menu");
    await ir(page, "Pagamento da equipe");
    await page.click("[data-aba-equipe=comissoes]");
    await page.waitForSelector("[data-teste=previa-comissao]");
    await page.click("button:has-text('+ Lançar vale')");
    await page.selectOption("dialog[open] #c-barb", { label: "Beto Barbeiro" });
    await page.fill("dialog[open] #c-valor", "10,00");
    await ok();
    await page.waitForSelector("text=Vale lançado.");
    await abrirItem(page, '[data-vale="Beto Barbeiro"] >> nth=0');
    await page.click('[data-vale="Beto Barbeiro"] button:has-text("Cancelar vale") >> nth=0');
    await page.fill("dialog[open] #c-motivo", "Lançado por engano");
    await ok();
    await page.waitForSelector("text=Vale cancelado.");
    await page.click("[data-filtro=todos]");
    await page.waitForSelector('[data-vale="Beto Barbeiro"] .etiqueta:has-text("Cancelado")');
    await page.click("[data-periodo=outro]");
    await page.waitForSelector("form.periodo-outro:not([hidden])");
    await page.fill("#c-ini", dia(0));
    await page.fill("#c-fim", dia(6));
    await page.click("button:has-text('Ver período')");
    await page.waitForSelector(`[data-teste=periodo-comissao]:has-text("${dia(6).split("-").reverse().join("/")}")`);
    await page.waitForSelector('[data-previa="Ana Barbeira"]');
    // Ana: 94,50 − 20,00 = 74,50 · Beto: 83,50 − 50,00 = 33,50 (o vale de 10,00 foi cancelado)
    assert.match(await texto('[data-previa="Ana Barbeira"]'), /R\$\s?74,50/);
    assert.match(await texto('[data-previa="Beto Barbeiro"]'), /R\$\s?33,50/);
    assert.match(await texto(".total-comissao"), /R\$\s?108,00/);
    await print("gerente-comissoes-previa");
    await page.click("button:has-text('Fechar comissão do período')");
    await ok();
    await page.waitForSelector('[data-fechamento="Ana Barbeira"]');
    await abrirItem(page, '[data-fechamento="Ana Barbeira"]');
    await page.click('[data-fechamento="Ana Barbeira"] button:has-text("Registrar pagamento")');
    await ok();
    await page.waitForSelector("text=Pagamento registrado.");
    await page.click("[data-filtro=pagos]");
    await page.waitForSelector('[data-fechamento="Ana Barbeira"] .etiqueta:has-text("Pago")');
    await print("gerente-comissoes-fechadas");

    // ---------- CONTAS ----------
    passo("gerente cadastra conta e paga a atrasada com dinheiro do caixa");
    await ir(page, "Despesas");
    await abrirCadastro(page);
    await page.fill("#c-desc", "Água (fictícia)");
    await page.selectOption("#c-cat", "agua");
    await page.fill("#c-valor", "90,00");
    await page.fill("#c-venc", somarDias(HOJE, 3));
    await page.click("button:has-text('Salvar despesa')");
    await page.waitForSelector('[data-conta="Água (fictícia)"] >> text=Próximos 7 dias');
    assert.match(await texto('[data-conta="Conta de luz"]'), /Atrasada/);
    assert.match(await texto("[data-teste=resumo-despesas]"), /Atrasadas\s*R\$\s?200,00/);
    await print("gerente-contas");
    passo("despesa no cartão de crédito em 3x (descrição em branco = nome da categoria)");
    await abrirCadastro(page);
    await page.selectOption("#c-cat", "fornecedor");
    await page.fill("#c-valor", "300,00");
    await page.selectOption("#c-forma", "credito");
    await page.selectOption("#c-parc", "3");
    await page.waitForSelector("[data-teste=resumo-parcelas]:has-text('3x de R$')");
    await page.locator("[data-teste=resumo-parcelas]").scrollIntoViewIfNeeded();
    await print("despesa-cartao-3x", false);
    await page.click("button:has-text('Salvar despesa')");
    await page.waitForSelector("text=Despesa lançada em 3 parcelas.");
    await page.waitForSelector('[data-conta="Fornecedor (1/3)"]');
    assert.match(await texto('[data-conta="Fornecedor (1/3)"]'), /Crédito/);
    assert.equal(await page.locator('[data-conta^="Fornecedor ("]').count(), 3);
    await abrirItem(page, '[data-conta="Conta de luz"]');
    await page.click('[data-conta="Conta de luz"] button:has-text("Pagar")');
    await page.check("dialog[open] #c-comCaixa");
    await ok();
    await page.click("[data-filtro=pagas]");
    await abrirItem(page, '[data-conta="Conta de luz"]');
    await page.waitForSelector('[data-conta="Conta de luz"] >> text=com dinheiro do caixa');
    await print("gerente-despesa-paga", false);

    // ---------- MATERIAL DE USO + DESPESA QUE LANÇA NO ESTOQUE ----------
    passo("gerente cadastra material de uso no estoque e lança a compra pela conta (vai direto para o estoque)");
    await ir(page, "Estoque");
    await page.click("button:has-text('+ Material de uso')");
    await page.fill("dialog[open] #c-mNome", "Creme para progressiva");
    await page.fill("dialog[open] #c-mMin", "2");
    await print("material-de-uso-novo", false);
    await ok();
    await page.waitForSelector('[data-estoque="Creme para progressiva"] >> text=Uso da barbearia');
    await ir(page, "Despesas");
    await abrirCadastro(page);
    await page.fill("#c-desc", "Caixa de creme (fictícia)");
    await page.selectOption("#c-cat", "fornecedor");
    await page.fill("#c-valor", "150,00");
    await page.click(".mais-opcoes summary");
    await page.check("#c-lancaEst");
    await page.waitForSelector("[data-teste=conta-estoque]:visible");
    const opCreme = await page.locator("#c-estProd option", { hasText: "Creme para progressiva" }).getAttribute("value");
    await page.selectOption("#c-estProd", opCreme);
    await page.fill("#c-estQtd", "10");
    await page.waitForSelector("[data-teste=custo-unidade]:has-text('15,00')");
    await page.locator("[data-teste=conta-estoque]").scrollIntoViewIfNeeded();
    await print("conta-lanca-no-estoque", false);
    await page.click("button:has-text('Salvar despesa')");
    await abrirItem(page, '[data-conta="Caixa de creme (fictícia)"]');
    await page.waitForSelector('[data-conta="Caixa de creme (fictícia)"] [data-teste=conta-no-estoque]:has-text("+10 Creme para progressiva")');
    await ir(page, "Estoque");
    assert.match(await texto('[data-estoque="Creme para progressiva"] [data-teste=saldo]'), /10 un\./);
    assert.match(await texto('[data-estoque="Creme para progressiva"]'), /Custo médio R\$\s?15,00/);
    await abrirItem(page, '[data-estoque="Creme para progressiva"]');
    await page.click('[data-estoque="Creme para progressiva"] button:has-text("Usei (dar baixa)")');
    await page.fill("dialog[open] #c-qtd", "1");
    await ok();
    await page.waitForSelector('[data-estoque="Creme para progressiva"] [data-teste=saldo]:has-text("9 un.")');
    await print("estoque-com-material");

    // ---------- CONTADOR ----------
    passo("gerente envia ao contador (PDF + planilha) e vê o aviso de alteração");
    await ir(page, "Contador e dados");
    await page.fill("#c-nome", "Contabilidade Fictícia");
    await page.fill("#c-tel", "(11) 95555-0000");
    await page.click("button:has-text('Salvar contato')");
    await page.waitForSelector("text=Contato salvo.");
    await page.fill("#ref-mes", dia(4).slice(0, 7));
    await page.click("button:has-text('Gerar e enviar')");
    await page.waitForSelector("dialog[open] [data-teste=resultado]");
    await print("gerente-contador-relatorio");
    const arqs = await baixados(() => page.click("dialog[open] button:has-text('PDF e planilha')"), 2);
    const pdf = arqs.find(([n]) => n.endsWith(".pdf"));
    const csv = arqs.find(([n]) => n.endsWith(".csv"));
    assert.ok(pdf && pdf[1].subarray(0, 5).toString() === "%PDF-", "PDF baixado");
    assert.ok(csv && csv[1].toString("utf8").startsWith("﻿Data;Tipo;Descrição;Forma;Valor (R$)"), "planilha baixada");
    await page.click("dialog[open] button:has-text('Fechar')");
    await page.waitForSelector(`[data-envio="${dia(4).slice(0, 7)}"]`);
    assert.equal(await page.locator(`[data-envio="${dia(4).slice(0, 7)}"] >> text=Alterado depois do envio`).count(), 0);
    // muda um lançamento do período (venda do caixa de um dia que ficou aberto) → aviso "gere de novo"
    const tCaixa = (await (await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ login: "caixa.semana", senha: SENHA }) })).json()).token;
    const tGer = await page.evaluate(() => localStorage.getItem("4blade.token"));
    const cxDia = await (await fetch(`${base}/api/caixa/dia?data=${dia(4)}`, { headers: { Authorization: `Bearer ${tGer}` } })).json();
    const vendaId = cxDia.lancamentos.find(l => l.tipo === "venda").vendaId;
    const canc = await fetch(`${base}/api/vendas/cancelar`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${tCaixa}` }, body: JSON.stringify({ id: vendaId, motivo: "Cliente devolveu" }) });
    assert.equal(canc.status, 200);
    await ir(page, "Contador e dados");
    await page.waitForSelector(`[data-envio="${dia(4).slice(0, 7)}"] >> text=Alterado depois do envio`);
    await print("gerente-contador-aviso-alteracao");
    await page.click("[data-teste=copia-dados] > summary");
    const planilha = await baixados(() => page.click(".botoes-planilha button:has-text('Clientes')"), 1);
    assert.match(planilha[0][0], /^4blade-clientes-\d{4}-\d{2}-\d{2}\.csv$/);
    assert.match(planilha[0][1].toString("utf8"), /^﻿Nome;Telefone/);

    passo("gerente baixa o extrato da Ana no Relatório financeiro (antes ficava em Meu desempenho)");
    await ir(page, "Relatório financeiro");
    await page.click("[data-aba-fin=equipe]");   // 19/11/2026: relatórios em abas; o extrato fica na aba Equipe (já aberto)
    await page.waitForSelector("[data-teste=extrato-profissional][open]");
    await page.waitForSelector("#extrato-pessoa option:has-text('Ana Barbeira')", { state: "attached" });
    await page.selectOption("#extrato-pessoa", { label: "Ana Barbeira" });
    await page.fill("#mes-extrato", dia(4).slice(0, 7));
    await print("gerente-financeiro-extrato", { inteira: false });
    const ext = await baixados(() => page.click("[data-teste=extrato-profissional] button:has-text('Baixar extrato')"), 2);
    assert.ok(ext.some(([nome, b]) => /^extrato-ana-\d{4}-\d{2}\.pdf$/.test(nome) && b.subarray(0, 5).toString() === "%PDF-"), ext.map(x => x[0]).join(","));
    assert.ok(ext.some(([nome, b]) => nome.endsWith(".csv") && /Atendimento/.test(b.toString("utf8"))));
    await page.waitForSelector("text=Extrato baixado");
    await sair();

    // ---------- BARBEIRA ----------
    passo("barbeira não tem Meu desempenho (retirado); endereço antigo volta para a agenda");
    await entrar("ana.semana");
    assert.equal(await page.locator("#menu [data-nav='Meu desempenho']").count(), 0);
    await page.goto(`${base}/#/desempenho`);
    await page.waitForFunction(() => !/desempenho/.test(location.hash) && !document.body.dataset.carregando);
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
console.log("TESTE NO NAVEGADOR E4: OK (computador 1366 px e celular 390 px)");
