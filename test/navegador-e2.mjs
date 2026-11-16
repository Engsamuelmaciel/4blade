// Teste no navegador da entrega E2 (Playwright). Dados FICTÍCIOS.
// Caminho: gerente cadastra o funcionamento → caixa abre o caixa → barbeiro marca horário (cliente novo pelo telefone),
// bloqueia um horário, envia lembrete (wa.me, registrado) e finaliza com valor alterado em 2 formas →
// caixa vê o valor BRUTO e não vê comissão → gerente vê a alteração destacada → gerente fecha um dia e recebe a lista para remarcar.
// Roda em computador (1366 px) e celular (390 px); prints em docs/prints/e2/.  Uso: node test/navegador-e2.mjs
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { hojeBrasil } from "../src/util.js";
import { somarDias } from "../src/agenda-util.js";

const { chromium } = createRequire(import.meta.url)("playwright");
const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
const PRINTS = join(RAIZ, "docs", "prints", "e2");
mkdirSync(PRINTS, { recursive: true });
const HOJE = hojeBrasil();
const AMANHA = somarDias(HOJE, 1);

const TELAS = [
  { nome: "computador", largura: 1366, altura: 768, movel: false, porta: 8793 },
  { nome: "celular", largura: 390, altura: 844, movel: true, porta: 8794 }
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
  // O WhatsApp de verdade não é aberto no teste: a aba nova é interceptada e conferida.
  await contexto.route(/wa\.me/, r => r.fulfill({ status: 200, contentType: "text/html", body: "<p>WhatsApp (simulado no teste)</p>" }));
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
    console.log(`  print: docs/prints/e2/${arq}`);
  };
  const passo = t => console.log(`[${tela.nome}] ${t}`);
  const entrar = async (login, senha) => {
    await page.fill("#c-login", login);
    await page.fill("#c-senha", senha);
    await page.click("button:has-text('Entrar')");
  };
  const sair = async () => {
    await page.click("#btn-sair");
    await page.waitForSelector("text=Você saiu do sistema.");
  };
  const ok = () => page.click("dialog[open] button[type=submit]");

  try {
    await page.goto(base);

    // ---------- GERENTE: funcionamento ----------
    passo("gerente cadastra o funcionamento");
    await entrar("gabriel.navalha", "Senha-Gabriel-2026");
    await page.click("a.menu-item:has-text('Funcionamento')");
    await page.waitForSelector("text=Dias e horários da semana");
    for (let d = 0; d < 7; d++) {
      if (d === 0) { await page.uncheck("#d0-aberto"); continue; }   // domingo fechado
      await page.check(`#d${d}-aberto`);
      await page.fill(`[name=d${d}-abre]`, "08:00");
      await page.fill(`[name=d${d}-fecha]`, "20:00");
      await page.fill(`[name=d${d}-ii]`, "12:00");
      await page.fill(`[name=d${d}-if]`, "13:00");
    }
    // hoje e amanhã abertos mesmo se for domingo (o teste roda em qualquer dia)
    for (const d of [new Date(`${HOJE}T12:00:00Z`).getUTCDay(), new Date(`${AMANHA}T12:00:00Z`).getUTCDay()]) {
      await page.check(`#d${d}-aberto`);
      await page.fill(`[name=d${d}-abre]`, "08:00");
      await page.fill(`[name=d${d}-fecha]`, "20:00");
    }
    await page.click("button:has-text('Salvar funcionamento')");
    await page.waitForSelector("text=Funcionamento salvo.");
    await print("gerente-funcionamento");
    // um horário de amanhã (para o teste de fechar a agenda), marcado pela API
    const servs = (await chamar("/servicos", null, ger)).servicos;
    const barbeiroId = (await chamar("/usuarios", null, ger)).usuarios.find(u => u.login === "bruno.navalha").id;
    await chamar("/agenda", { barbeiroId, data: AMANHA, hora: "09:00", servicoIds: [servs.find(s => s.nome === "Corte masculino").id],
      cliente: { telefone: "11 93333-4444", nome: "Elias Cliente Fictício", aceiteLgpd: true } }, ger);
    await sair();

    // ---------- CAIXA: abre o caixa ----------
    passo("caixa abre o caixa do dia");
    await entrar("camila.navalha", "Senha-Camila-2026");
    await page.waitForSelector("text=Abrir o caixa de hoje");
    await page.fill("#c-troco", "100,00");
    await print("caixa-abrir");
    await page.click("button:has-text('Abrir caixa')");
    await page.waitForSelector("text=Nenhuma entrada ainda");
    await sair();

    // ---------- BARBEIRO: marca, bloqueia, envia lembrete, finaliza com valor alterado ----------
    passo("barbeiro marca horário com cliente novo pelo telefone");
    await entrar("bruno.navalha", "Senha-Bruno-2026");
    await page.click("a.menu-item:has-text('Minha agenda')");
    await page.waitForSelector("text=+ Novo horário");
    await page.click("text=+ Novo horário");
    await page.fill("dialog[open] [name=hora]", "10:00");
    await page.check("dialog[open] label:has-text('Corte masculino')");
    await page.check("dialog[open] label:has-text('Barba completa')");
    await page.fill("#c-cliTel", "(11) 90000-1234");
    await page.waitForSelector("text=Cliente novo: informe o nome.");
    await page.fill("#c-cliNome", "Diego Cliente Fictício");
    await page.check("#c-cliLgpd");
    await print("barbeiro-novo-horario");
    await ok();
    await page.waitForSelector('[data-agendamento="Diego Cliente Fictício"]');
    // horário sobreposto é recusado
    await page.click("text=+ Novo horário");
    await page.fill("dialog[open] [name=hora]", "10:30");
    await page.check("dialog[open] label:has-text('Corte masculino')");
    await page.fill("#c-cliTel", "(11) 90000-1234");
    await page.waitForSelector("text=Cliente: Diego Cliente Fictício");
    await ok();
    await page.waitForSelector("dialog[open] .erro:has-text('outro atendimento')");
    await print("barbeiro-horario-sobreposto-recusado");
    await page.click("dialog[open] button:has-text('Cancelar')");

    passo("barbeiro bloqueia um horário");
    await page.click("text=Bloquear horário");
    await page.fill("[name=hIni]", "15:00");
    await page.fill("[name=hFim]", "16:00");
    await page.fill("#c-motivoBloq", "Dentista");
    await ok();
    await page.waitForSelector('[data-bloqueio="Dentista"]');

    passo("barbeiro envia lembrete pelo WhatsApp");
    const [aba] = await Promise.all([
      contexto.waitForEvent("page"),
      page.click('[data-agendamento="Diego Cliente Fictício"] [data-whats=lembrete]')
    ]);
    await aba.waitForLoadState();
    const urlWhats = decodeURIComponent(aba.url());
    assert.match(urlWhats, /^https:\/\/wa\.me\/5511900001234\?text=Olá, Diego!/);
    assert.match(urlWhats, /10:00 com Bruno \(Barba completa \+ Corte masculino\)/);
    await aba.close();
    await page.waitForSelector('[data-agendamento="Diego Cliente Fictício"] >> text=Lembrete aberto no WhatsApp por Bruno');
    await print("barbeiro-agenda-lembrete-enviado");

    passo("barbeiro finaliza com valor alterado em 2 formas");
    await page.click('[data-agendamento="Diego Cliente Fictício"] button:has-text("Finalizar")');
    await page.fill("[aria-label='Valor cobrado de Corte masculino']", "35,00");
    await page.waitForSelector("dialog[open] [data-teste=total]:has-text('65,00')");
    await page.check("#c-dividir");
    await page.fill("#c-valor1", "40,00");
    await page.selectOption("#c-forma1", "pix");
    await page.selectOption("#c-forma2", "dinheiro");
    await page.waitForSelector("dialog[open] [data-teste=valor2]:has-text('25,00')");
    await print("barbeiro-finalizar-valor-alterado");
    await ok();
    await page.waitForSelector('[data-agendamento="Diego Cliente Fictício"] .etiqueta:has-text("Finalizado")');
    const cartao = await page.textContent('[data-agendamento="Diego Cliente Fictício"]');
    assert.match(cartao, /Sua comissão: R\$\s?32,50 \(50%\)/);
    assert.ok(!/Valor alterado/.test(cartao), "o destaque é para o gerente");
    await print("barbeiro-atendimento-finalizado");
    await sair();

    // ---------- CAIXA: vê o valor bruto, sem comissão ----------
    passo("caixa vê a entrada com valor bruto e sem comissão");
    await entrar("camila.navalha", "Senha-Camila-2026");
    await page.waitForSelector('[data-lancamento="Diego Cliente Fictício"]');
    const textoCaixa = await page.locator("main").innerText();
    assert.match(await page.textContent("[data-teste=entradas]"), /R\$\s?65,00/);
    assert.match(textoCaixa, /Pix: R\$\s?40,00/);
    assert.match(textoCaixa, /Dinheiro: R\$\s?25,00/);
    assert.ok(!/comiss/i.test(textoCaixa), "caixa viu comissão!");
    await print("caixa-entradas-valor-bruto");
    await sair();

    // ---------- GERENTE: vê a alteração destacada; fecha amanhã e recebe a lista para remarcar ----------
    passo("gerente vê o valor alterado destacado");
    await entrar("gabriel.navalha", "Senha-Gabriel-2026");
    await page.click("a.menu-item:has-text('Agenda')");
    await page.waitForSelector('[data-agendamento="Diego Cliente Fictício"].destaque');
    const cg = await page.textContent('[data-agendamento="Diego Cliente Fictício"]');
    assert.match(cg, /Valor alterado/);
    assert.match(cg, /Corte masculino: tabela R\$\s?40,00 → cobrado R\$\s?35,00/);
    assert.match(cg, /Comissão: R\$\s?32,50/);
    await print("gerente-agenda-valor-alterado-destacado");
    await page.click("button:has-text('Semana')");
    await page.waitForSelector('[data-agendamento="Elias Cliente Fictício"]');
    await print("gerente-agenda-semana");

    passo("gerente fecha amanhã e recebe a lista para remarcar");
    await page.click("#btn-inicio");
    await page.click("a.menu-item:has-text('Funcionamento')");
    await page.fill("#c-fIni", AMANHA);
    await page.fill("#c-fMotivo", "Feriado municipal (fictício)");
    await page.click("button:has-text('Fechar agenda')");
    await page.waitForSelector("dialog[open] >> text=Há 1 horário(s) marcado(s)");
    await ok();
    await page.waitForSelector('dialog[open] [data-afetado="Elias Cliente Fictício"]');
    assert.match(await page.getAttribute('dialog[open] [data-afetado="Elias Cliente Fictício"] a', "href"), /^https:\/\/wa\.me\/5511933334444\?text=/);
    await print("gerente-fechar-dia-lista-para-remarcar");
    await page.click("dialog[open] button:has-text('Pronto')");
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
console.log("TESTE NO NAVEGADOR E2: OK (computador 1366 px e celular 390 px)");
