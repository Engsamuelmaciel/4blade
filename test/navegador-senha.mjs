// Teste no navegador: ESQUECI MINHA SENHA (link por e-mail) e "Meu e-mail" em Minha conta. 25/11/2026.
// E-mail de mentira do servidor local (/__teste/ultimo-email). Dados FICTÍCIOS (semana simulada).
// Computador (1366 px) e celular (390 px); prints em docs/prints/senha/.  Uso: node test/navegador-senha.mjs
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const { chromium } = createRequire(import.meta.url)("playwright");
const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
const PRINTS = join(RAIZ, "docs", "prints", "senha");
mkdirSync(PRINTS, { recursive: true });
const SENHA = "Senha-Semana-2026";
const TELAS = [
  { nome: "computador", largura: 1366, altura: 768, movel: false, porta: 8881 },
  { nome: "celular", largura: 390, altura: 844, movel: true, porta: 8882 }
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
  const contexto = await navegador.newContext({ viewport: { width: tela.largura, height: tela.altura }, deviceScaleFactor: 2,
    isMobile: tela.movel, hasTouch: tela.movel, locale: "pt-BR", timezoneId: "America/Sao_Paulo" });
  const page = await contexto.newPage();
  const problemas = [];
  page.on("console", m => { if (m.type() === "error") problemas.push(m.text()); });
  page.on("pageerror", e => problemas.push(e.message));
  let n = 0;
  const pronto = () => page.waitForFunction(() => !document.body.dataset.carregando);
  const passo = t => console.log(`[${tela.nome}] ${t}`);
  const print = async nome => {
    const arq = `${tela.nome}-${String(++n).padStart(2, "0")}-${nome}.png`;
    await page.waitForTimeout(250);
    await page.screenshot({ path: join(PRINTS, arq), fullPage: true });
    assert.ok(!/\bnull\b|\bundefined\b|NaN/.test(await page.locator("body").innerText()), `texto estranho na tela ${nome}`);
    console.log(`  print: docs/prints/senha/${arq}`);
  };
  const entrar = async (login, senha) => {
    await page.goto(`${base}/#/entrar`);
    await page.waitForSelector("#c-login");
    await page.fill("#c-login", login);
    await page.fill("#c-senha", senha);
    await page.click("button:has-text('Entrar')");
    await page.waitForSelector("#btn-conta:not([hidden])");
    await pronto();
  };
  const sair = async () => { await page.click("#btn-conta"); await page.click("#btn-sair"); await page.waitForSelector("text=Você saiu do sistema."); };
  try {
    passo("gerente cadastra o próprio e-mail em Minha conta");
    await entrar("gerente.semana", SENHA);
    await page.click("#btn-conta");
    await page.click("[data-teste=meu-email]");
    await page.fill("dialog[open] input[name=email]", "gerente.semana@exemplo.com");
    await page.click("dialog[open] button[type=submit]");
    await page.waitForSelector("text=E-mail salvo.");
    await page.click("#btn-conta");
    assert.match(await page.textContent("[data-teste=meu-email]"), /gerente\.semana@exemplo\.com/);
    await print("minha-conta-com-email");
    await page.keyboard.press("Escape");
    await sair();

    passo("esqueci minha senha: pede o link pelo usuário");
    await page.click("[data-teste=link-esqueci]");
    await page.waitForSelector("text=Enviar o link");
    await page.fill("input[name=login]", "gerente.semana");
    await page.click("button:has-text('Enviar o link')");
    await page.waitForSelector("[data-teste=esqueci-resposta] .info");
    assert.match(await page.textContent("[data-teste=esqueci-resposta]"), /enviamos agora um link/);
    await print("esqueci-link-enviado");

    passo("abre o link do e-mail, cria a nova senha e já entra");
    const email = await (await fetch(`${base}/__teste/ultimo-email`)).json();
    assert.deepEqual(email.to, ["gerente.semana@exemplo.com"]);
    const link = email.text.match(/(#\/redefinir-senha\/[A-Za-z0-9_-]+)/)[1];
    await page.goto(`${base}/${link}`);
    await page.waitForSelector("text=Criar nova senha");
    await pronto();
    await page.fill("input[name=nova]", "Nova-Senha-Gerente-1");
    await page.fill("input[name=nova2]", "Nova-Senha-Gerente-1");
    await print("criar-nova-senha");
    await page.click("button:has-text('Salvar nova senha')");
    await page.waitForSelector("text=Senha criada. Você já está dentro.");
    await pronto();
    assert.ok(!/redefinir-senha/.test(page.url()), "o link sai do endereço");
    await print("entrou-com-a-nova-senha");
    await sair();

    passo("o link não vale de novo; senha antiga não entra; nova entra");
    await page.goto(`${base}/${link}`);
    await page.waitForSelector("text=Criar nova senha");
    await page.fill("input[name=nova]", "Outra-Senha-Gerente-2");
    await page.fill("input[name=nova2]", "Outra-Senha-Gerente-2");
    await page.click("button:has-text('Salvar nova senha')");
    await page.waitForSelector("text=já foi usado");
    await print("link-usado");
    await page.goto(`${base}/#/entrar`);
    await page.fill("#c-login", "gerente.semana");
    await page.fill("#c-senha", SENHA);
    await page.click("button:has-text('Entrar')");
    await page.waitForSelector("text=Usuário ou senha incorretos");
    await entrar("gerente.semana", "Nova-Senha-Gerente-1");

    passo("cadastro da equipe tem o campo e-mail");
    await page.goto(`${base}/#/equipe`);
    await pronto();
    assert.ok(await page.locator("input[name=email]").count() >= 1);

    const reais = problemas.filter(p => !/status of 4(01|10)/.test(p));   // 401: senha antiga; 410: link já usado (esperados)
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
