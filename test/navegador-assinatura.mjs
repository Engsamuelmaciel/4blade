// Teste no navegador: página de planos → Assinar (cadastro da própria barbearia) → boas-vindas → Minha assinatura →
// atraso (faixa de aviso) → bloqueio (só a assinatura) → pagamento confirmado pelo Asaas (de mentira) → liberado →
// plataforma vê a barbearia que assinou sozinha. Dados FICTÍCIOS (CPF gerado só com dígitos válidos).
// Roda em computador (1366 px) e celular (390 px); prints em docs/prints/assinatura/.  Uso: node test/navegador-assinatura.mjs
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { ir } from "./navegacao.mjs";
import { hojeBrasil } from "../src/util.js";
import { somaDias } from "../src/assinatura.js";

const { chromium } = createRequire(import.meta.url)("playwright");
const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
const PRINTS = join(RAIZ, "docs", "prints", "assinatura");
mkdirSync(PRINTS, { recursive: true });
const HOJE = hojeBrasil();
const dataBR = d => d.split("-").reverse().join("/");

function gerarCpf(base9) {
  const d = base9.split("").map(Number);
  for (const t of [9, 10]) { let s = 0; for (let i = 0; i < t; i++) s += d[i] * (t + 1 - i); d.push(((s * 10) % 11) % 10); }
  return d.join("");
}

const TELAS = [
  { nome: "computador", largura: 1366, altura: 768, movel: false, porta: 8811, cpf: gerarCpf("246813570") },
  { nome: "celular", largura: 390, altura: 844, movel: true, porta: 8812, cpf: gerarCpf("135792460") }
];

async function subirServidor(porta) {
  const proc = spawn(process.execPath, ["--no-warnings", join(RAIZ, "test", "servidor-local.mjs"), String(porta)], { stdio: ["ignore", "pipe", "inherit"] });
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
  page.on("console", m => {
    if (m.type() === "error" && !/^Failed to load resource: the server responded with a status of (400|401|402|403|409)\b/.test(m.text())) problemas.push(m.text());
  });
  page.on("pageerror", e => problemas.push(e.message));
  let n = 0;
  const print = async (nome, inteira = true) => {
    n++;
    await page.waitForTimeout(300);
    await page.waitForSelector("#carregador", { state: "hidden" });
    if (inteira) await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: join(PRINTS, `${tela.nome}-${String(n).padStart(2, "0")}-${nome}.png`), fullPage: inteira });
    const texto = await page.locator("body").innerText();
    assert.ok(!/\bnull\b|undefined|NaN/.test(texto), `texto estranho na tela (${nome})`);
  };
  const passo = t => console.log(`[${tela.nome}] ${t}`);
  const pronto = () => page.waitForFunction(() => !document.body.dataset.carregando);
  const login = `dono.${tela.nome}`;

  try {
    // landing page (forblade.com.br)
    await page.goto(base);
    await page.waitForSelector("[data-teste=lp-comecar]");
    await pronto();
    await page.waitForFunction(() => [...document.querySelectorAll(".lp img")].slice(0, 2).every(i => i.complete && i.naturalWidth > 0));
    assert.equal(await page.locator('.lp [data-plano]').count(), 3, "planos na landing");
    assert.equal(await page.locator(".lp .duvida").count(), 4, "dúvidas comuns na landing");
    assert.equal(await page.locator("[data-teste=lp-caderno] .lp-dor").count(), 4, "seção do caderninho");
    await print("landing");
    await page.click("[data-teste=lp-entrar]");
    await page.waitForSelector("[data-teste=link-planos]");
    await page.click("[data-teste=link-planos]");
    await page.waitForSelector('[data-plano="pro"]');
    await pronto();
    assert.match(await page.locator('[data-plano="basico"]').innerText(), /Até 2 barbeiros[\s\S]*R\$\s79/);
    assert.match(await page.locator('[data-plano="standard"]').innerText(), /Até 4 barbeiros[\s\S]*R\$\s109,90[\s\S]*ver os horários livres \(só consulta\)/);
    assert.match(await page.locator('[data-plano="pro"]').innerText(), /Até 10 barbeiros[\s\S]*R\$\s149,90[\s\S]*Site completo, integrado à agenda[\s\S]*lista de produtos/);
    await print("planos-mensal");
    await page.click('[data-ciclo="anual"]');
    await page.waitForSelector('[data-plano="standard"] >> text=/R\\$\\s1\\.099/');
    await print("planos-anual");
    passo("página de planos: 3 planos, mensal e anual");

    await page.click('[data-assinar="standard"]');
    await page.waitForSelector("form.form-assinar");
    await pronto();
    assert.equal(await page.inputValue("#c-plano"), "standard");
    assert.equal(await page.inputValue("#c-ciclo"), "anual", "lembra a escolha da página de planos");
    await page.selectOption("#c-ciclo", "mensal");
    await page.waitForSelector('[data-teste=resumo-assinatura] >> text=/R\\$\\s109,90 por mês/');
    assert.match(await page.locator("[data-teste=resumo-assinatura]").innerText(), new RegExp(`Grátis até ${dataBR(somaDias(HOJE, 13))}`));
    assert.equal(await page.locator("#c-site").count(), 0, "sem adicional de site");
    await print("assinar-vazio");
    await page.click('[data-legal="termos"]');
    await page.waitForSelector("dialog[open] .texto-legal");
    await print("termos", false);
    await page.click("dialog[open] button[type=submit]");

    await page.fill("#c-barbearia", `Barbearia ${tela.nome} Fictícia`);
    await page.fill("#c-nome", "Pessoa Dona Fictícia");
    await page.locator("#c-documento").pressSequentially(tela.cpf);
    assert.match(await page.inputValue("#c-documento"), /^\d{3}\.\d{3}\.\d{3}-\d{2}$/);
    await page.locator("#c-telefone").pressSequentially("11900000099");
    await page.fill("#c-email", `${tela.nome}@exemplo.test`);
    await page.fill("#c-login", login);
    await page.fill("#c-senha", "Senha-Dona-2026");
    await page.fill("#c-senha2", "Senha-Dona-2026");
    // sem aceitar os termos o navegador não deixa enviar
    await page.click("form.form-assinar button[type=submit]");
    assert.equal(await page.locator("[data-teste=boas-vindas]").count(), 0);
    await page.check("#c-aceite");
    await print("assinar-preenchido");
    await page.click("form.form-assinar button[type=submit]");
    await page.waitForSelector("[data-teste=boas-vindas]");
    assert.match(await page.locator("[data-teste=boas-vindas]").innerText(), new RegExp(`teste grátis vai até ${dataBR(somaDias(HOJE, 13))}`));
    await print("boas-vindas");
    passo("assinou sozinho e já entrou (14 dias grátis)");

    await ir(page, "Meu plano");
    await page.waitForSelector('[data-situacao="teste"]');
    assert.equal(await page.locator("[data-teste=pagar]").count(), 1, "link para deixar pago");
    await print("minha-assinatura-teste");

    // a equipe: Standard tem 4 vagas de barbeiro; gerentes e caixas sem limite
    await ir(page, "Equipe");
    await page.waitForSelector('[data-vaga="barbeiro"] >> text=0/4');
    await page.waitForSelector('[data-vaga="gerente"] >> text=sem limite');

    // 3 dias de atraso: faixa de aviso
    await page.request.get(`${base}/__teste/pago-ate?login=${login}&data=${somaDias(HOJE, -3)}`);
    await page.reload();
    await page.waitForSelector("#faixa-assinatura:not([hidden]) >> text=suspenso em 3 dia(s)");
    await print("faixa-atraso");
    passo("atraso: aviso no alto da tela");

    // 7 dias de atraso: só a assinatura
    await page.request.get(`${base}/__teste/pago-ate?login=${login}&data=${somaDias(HOJE, -7)}`);
    await page.goto(`${base}/#/agenda`);
    await page.waitForSelector('[data-situacao="bloqueada"]');
    await pronto();
    assert.equal(await page.evaluate(() => location.hash), "#/assinatura");
    assert.deepEqual(await page.locator("#menu .nav-item").allInnerTexts(), ["Minha assinatura", "Suporte"], "menu só com a assinatura e o suporte");
    await print("bloqueada");
    passo("bloqueio: o dono só vê a assinatura para pagar");

    // pagou: o Asaas avisa e libera
    await page.request.get(`${base}/__teste/pagar?login=${login}`);
    await page.reload();
    await page.waitForSelector('[data-situacao="em_dia"]');
    assert.equal(await page.locator("#faixa-assinatura").isHidden(), true);
    assert.ok(await page.locator("#menu .nav-item").count() > 5);
    await print("paga-em-dia");
    passo("pagamento confirmado: liberado na hora");

    // plataforma vê quem assinou pelo site
    await page.click("#btn-conta");
    await page.click("#btn-sair");
    await page.waitForSelector("text=Você saiu do sistema.");
    await page.fill("#c-login", "suporte");
    await page.fill("#c-senha", "Nova-suporte-senha");
    await page.click("form.cartao button[type=submit]");
    await page.waitForSelector(`[data-barbearia="Barbearia ${tela.nome} Fictícia"] >> text=Assinou pelo site`);
    await print("plataforma");
    passo("plataforma: barbearia com plano e situação da assinatura");

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
console.log("TESTE NO NAVEGADOR ASSINATURA: OK (computador 1366 px e celular 390 px)");
