// Teste no navegador: PAGAMENTO DA EQUIPE e COBRANÇA COM PRODUTO no relatório.
// Pedido de 17/11/2026. Dados FICTÍCIOS (semana simulada).
// Roda em computador (1366 px) e celular (390 px); prints em docs/prints/equipe/.  Uso: node test/navegador-notificacoes.mjs
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { ir, abrirItem, movimentacao } from "./navegacao.mjs";
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
    await page.waitForFunction(() => document.querySelector("#nav-topo:not([hidden]) .nav-aba") || document.querySelector("#menu:not([hidden]) .grupo"));
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
    let aPagarBeto = await page.textContent('[data-pessoa="Beto Barbeiro"] [data-teste=a-pagar]');
    assert.match(aPagarBeto, /R\$\s?1\.\d{3},\d\d/);
    await abrirItem(page, '[data-pessoa="Beto Barbeiro"]');
    assert.match(await page.textContent('[data-pessoa="Beto Barbeiro"] [data-teste=mini-grade]'), /Dias trabalhados.*Atendimentos.*Produção.*Comissão.*R\$\s?83,50/s);
    assert.match(await page.textContent('[data-pessoa="Beto Barbeiro"] .quadro-pessoa'), /Salário fixo.*R\$\s?1\.500,00.*Vales.*A pagar.*Custo para a barbearia/s);
    await print("equipe-beto-aberto", { inteira: false });
    passo("abre o desempenho completo do Beto: dias, atendimentos, produção, comissão, indicadores, gráfico e recibo");
    await page.click('[data-pessoa="Beto Barbeiro"] [data-teste=ver-desempenho]');
    await page.waitForSelector("[data-teste=pessoa-hero]");
    await pronto();
    assert.match(await page.textContent("[data-teste=pessoa-comissao]"), /R\$\s?83,50/);
    assert.match(await page.textContent("[data-teste=pessoa-cards]"), /Produção.*Atendimentos.*Comissão.*Dias trabalhados/s);
    assert.match(await page.textContent("[data-teste=recibo]"), /Salário fixo.*R\$\s?1\.500,00.*Comissão de serviços \(40%\).*R\$\s?70,00.*Vales.*Total do mês.*Falta pagar/s);
    assert.ok(await page.locator(".grafico-dias .dia-servico").count() >= 1, "gráfico por dia");
    assert.ok(await page.locator('[data-ind="ticket"]').count() === 1 && await page.locator('[data-ind="melhor-dia"]').count() === 1);
    await page.locator(".grafico-dias .dia-alvo >> nth=0").dispatchEvent("click");
    await print("equipe-beto-desempenho");
    await page.click("a.voltar");
    await page.waitForSelector("[data-teste=resumo-equipe]");
    passo("lança um vale para o Beto direto do cartão dele (vales ficam no Pagamento da equipe)");
    await abrirItem(page, '[data-pessoa="Beto Barbeiro"]');
    await page.click('[data-pessoa="Beto Barbeiro"] .item-x-acoes button:has-text("Lançar vale")');
    assert.match(await page.locator("dialog[open] #c-barb option:checked").innerText(), /Beto Barbeiro/);
    await page.fill("dialog[open] #c-valor", "10,00");
    await ok();
    await page.waitForSelector("text=Vale lançado.");
    await page.waitForFunction(antes => document.querySelector('[data-pessoa="Beto Barbeiro"] [data-teste=a-pagar]')?.textContent !== antes, aPagarBeto);
    aPagarBeto = await page.textContent('[data-pessoa="Beto Barbeiro"] [data-teste=a-pagar]');   // − R$ 10,00 do vale
    assert.equal(await page.locator("[data-teste=resumo-equipe]").count(), 1, "continua na aba do mês");
    passo("aba Comissões e vales dentro do Pagamento da equipe");
    await page.click("[data-aba-equipe=comissoes]");
    await page.waitForSelector("[data-teste=previa-comissao]");
    await page.waitForSelector('[data-vale="Beto Barbeiro"]');
    await print("equipe-aba-comissoes-vales");
    await page.click("[data-aba-equipe=mes]");
    await page.waitForSelector("[data-teste=resumo-equipe]");
    await pronto();
    await abrirItem(page, '[data-pessoa="Beto Barbeiro"]');
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
    await page.click("[data-aba-fin=equipe]");   // relatórios em abas (19/11/2026)
    await pronto();
    assert.match(await page.textContent('[data-pessoa-fin="Beto Barbeiro"]'), /1\.500,00/);
    const d = page.locator("[data-secao-fin=profissionais]");
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
    await movimentacao(page, "sangria");
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

    passo("suporte (plataforma) vê o uso do app da barbearia: on-line, acessos, duração e telas — sem dados de clientes");
    await page.goto(`${base}/#/entrar`);
    await page.waitForSelector("#c-login");
    await page.fill("#c-login", "suporte");
    await page.fill("#c-senha", "Nova-suporte-senha");
    await page.click("button:has-text('Entrar')");
    await page.waitForSelector('[data-barbearia="Barbearia Semana Fictícia"] [data-teste=uso-resumo]');
    assert.match(await page.textContent('[data-barbearia="Barbearia Semana Fictícia"] [data-teste=uso-resumo]'), /Último uso|on-line/);
    await page.click('[data-barbearia="Barbearia Semana Fictícia"] [data-teste=ver-uso]');
    await page.waitForSelector("[data-teste=uso-topo]");
    await pronto();
    assert.ok(await page.locator('[data-uso-pessoa="Gustavo Gerente"]').count() === 1);
    assert.match(await page.textContent('[data-uso-pessoa="Gustavo Gerente"]'), /\d+ acesso/);
    await page.waitForSelector('[data-teste=uso-telas] [data-uso-tela="pagamento-equipe"]');
    assert.match(await page.textContent('[data-uso-tela="pagamento-equipe"]'), /Pagamento da equipe/);
    await abrirItem(page, '[data-uso-acesso="Gustavo Gerente"]');
    await page.waitForSelector('[data-uso-acesso="Gustavo Gerente"] .uso-caminho li');
    const corpo = await page.textContent("main, body");
    assert.ok(!/Cliente Fictício/.test(corpo), "nenhum dado de cliente na tela de uso");
    await print("suporte-uso-do-app");

    passo("suporte cadastra clientes em lote na barbearia (implantação): prévia, LGPD, repetidos pulados");
    await page.goto(`${base}/#/plataforma`);
    await page.click('[data-barbearia="Barbearia Semana Fictícia"] [data-teste=clientes-lote-suporte]');
    await page.waitForSelector("#c-listaClientes");
    await pronto();
    await page.fill("#c-listaClientes", "Lote Fictício Um; (11) 97777-0001; Unzinho\nLote Fictício Dois 11 97777-0002\n\tLote Fictício Três\t\nLote Fictício Quatro\t11977770001");
    assert.match(await page.textContent("[data-teste=previa-clientes-lote]"), /4 linha\(s\) · 3 com telefone · 1 sem telefone/);
    assert.match(await page.textContent("[data-teste=enviar-clientes-lote]"), /Cadastrar 4 clientes/);
    await print("suporte-clientes-lote-previa");
    await page.check("#c-loteSuporteLgpd");
    await page.click("[data-teste=enviar-clientes-lote]");
    await page.waitForSelector("[data-teste=resumo-clientes-lote]");
    await pronto();
    assert.match(await page.textContent("[data-teste=resumo-clientes-lote]"), /3 cadastrado\(s\) · 1 já existia/);
    assert.equal(await page.inputValue("#c-listaClientes"), "", "nada com erro fica na caixa");
    await print("suporte-clientes-lote-resultado");
    passo("suporte marca horários em lote na barbearia (passar a agenda que ela já tem)");
    await page.goto(`${base}/#/plataforma`);
    await page.click('[data-barbearia="Barbearia Semana Fictícia"] [data-teste=horarios-lote-suporte]');
    await page.waitForSelector("[data-lote-linha='3']");
    await pronto();
    assert.match(await page.textContent("h2"), /Horários em lote · Barbearia Semana Fictícia/);
    assert.equal(await page.locator("[data-teste=sem-funcionamento]").count(), 0);
    const diaLote = somarDias(hojeBrasil(), 20);
    const linhaL = k => page.locator(`[data-lote-linha='${k}']`);
    const preencher = async (k, campo, valor) => { const c = linhaL(k).locator(`[data-campo=${campo}]`); await c.fill(valor); await c.dispatchEvent("input"); };
    for (const k of [1, 2, 3]) await preencher(k, "data", diaLote);
    await preencher(1, "hora", "09:00"); await preencher(1, "nome", "Agenda Lote Um"); await preencher(1, "telefone", "11 96666-0001");
    await preencher(2, "hora", "09:00"); await preencher(2, "nome", "Agenda Lote Dois");   // mesmo horário do mesmo profissional: conflito
    await preencher(3, "hora", ""); await preencher(3, "nome", "Agenda Lote Três"); await preencher(3, "telefone", "11 96666-0003");   // sem hora: só cadastra
    await page.check("#c-loteLgpd");
    await page.click("[data-teste=enviar-lote]");
    await page.waitForSelector("[data-teste=lote-resumo].com-erro");
    assert.match(await page.textContent("[data-teste=lote-resumo]"), /2 salvo\(s\)\. 1 com problema/);
    assert.match(await linhaL(2).locator(".lote-msg").textContent(), /já tem Agenda Lote Um/);
    await print("suporte-horarios-lote");

    passo("horário fixo pelo lote, fora do funcionamento: avisa e marca com o aceite");
    await page.click("button:has-text('Tirar os já marcados')");
    await page.waitForSelector("[data-lote-linha='1'] [data-campo=repetir]");
    await preencher(1, "hora", "21:00");
    assert.match(await linhaL(1).locator("[data-campo=repetir]").textContent(), /A cada 15 dias \(quinzenal\)/);
    await linhaL(1).locator("[data-campo=repetir]").selectOption("2");   // a cada 15 dias = quinzenal no mesmo dia da semana
    await page.waitForSelector("[data-lote-linha='1'] [data-campo=ate]");
    assert.equal(await linhaL(1).locator("[data-campo=ate]").inputValue(), somarDias(diaLote, 365), "padrão: 1 ano");
    await preencher(1, "ate", somarDias(diaLote, 28));
    await page.click("[data-teste=enviar-lote]");
    await page.waitForSelector("[data-lote-linha='1'] .lote-msg:has-text('Fora do funcionamento')");
    assert.match(await linhaL(1).locator(".lote-msg").textContent(), /Fora do funcionamento.*Marcar mesmo fora do funcionamento/);
    await page.check("#c-loteFora");
    await page.click("[data-teste=enviar-lote]");
    await page.waitForSelector("[data-teste=lote-resumo].tudo-ok");
    assert.match(await linhaL(1).locator(".lote-msg").textContent(), /Horário fixo: 3 marcado\(s\), a cada 15 dias \((.+) sim, \1 não\) às 21:00/);
    await print("suporte-horario-fixo-fora-do-horario");

    // Aparecem para o gerente da barbearia
    await sair();
    await entrar("gerente.semana");
    await page.goto(`${base}/#/clientes`); await pronto();
    await page.fill("input.busca-viva", "Lote Fictício");
    await page.waitForSelector('[data-cliente="Lote Fictício Três"]');
    assert.equal(await page.locator('[data-cliente^="Lote Fictício"]').count(), 3);
    await page.fill("input.busca-viva", "Agenda Lote");
    await page.waitForSelector('[data-cliente="Agenda Lote Três"]');
    assert.equal(await page.locator('[data-cliente^="Agenda Lote"]').count(), 3, "o marcado, o só cadastrado e o da linha em conflito (a marcação já cadastra o cliente, como no Novo horário)");
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
console.log("TESTE NO NAVEGADOR DO PAGAMENTO DA EQUIPE: OK (computador 1366 px e celular 390 px)");
