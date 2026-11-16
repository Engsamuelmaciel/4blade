// Gera os prints dos TUTORIAIS (public/tutoriais/<id>.jpg) com dados FICTÍCIOS (demonstração + semana simulada)
// e o arquivo src/arquivos-tutoriais.js (lista das imagens que vão dentro do Worker).
// Celular 390 px, JPEG leve. Uso: node test/gerar-tutoriais.mjs   (refazer sempre que uma tela mudar)
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { ir, abrirHorarios } from "./navegacao.mjs";
import { hojeBrasil } from "../src/util.js";

const { chromium } = createRequire(import.meta.url)("playwright");
const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
const SAIDA = join(RAIZ, "public", "tutoriais");
mkdirSync(SAIDA, { recursive: true });
const PORTA = 8821;
const BASE = `http://localhost:${PORTA}`;
const DEMO = "Demo-4blade-2026";
const SEMANA = "Senha-Semana-2026";
const HOJE = hojeBrasil();

function gerarCpf(base9) {
  const d = base9.split("").map(Number);
  for (const t of [9, 10]) { let s = 0; for (let i = 0; i < t; i++) s += d[i] * (t + 1 - i); d.push(((s * 10) % 11) % 10); }
  return d.join("");
}

const proc = spawn(process.execPath, ["--no-warnings", join(RAIZ, "test", "servidor-local.mjs"), String(PORTA), "--demo", "--semana"], { stdio: ["ignore", "pipe", "inherit"] });
await new Promise((ok, falha) => {
  proc.stdout.on("data", d => { if (String(d).includes(`localhost:${PORTA}`)) ok(); });
  proc.on("exit", c => falha(new Error(`servidor saiu (${c})`)));
});

async function api(caminho, corpo, token) {
  const r = await fetch(`${BASE}/api${caminho}`, {
    method: corpo ? "POST" : "GET",
    headers: { ...(corpo ? { "Content-Type": "application/json" } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: corpo ? JSON.stringify(corpo) : undefined
  });
  const d = await r.json();
  if (!r.ok) throw new Error(`${caminho}: ${JSON.stringify(d)}`);
  return d;
}
const tok = async (login, senha) => (await api("/auth/login", { login, senha })).token;

// Preparação pelos bastidores (API): nota em aberto, barbearia que assinou pelo site, chamado de suporte.
const cxDemo = await tok("caixa.demo", DEMO);
const at = (await api("/caixa/atendimentos", null, cxDemo)).atendimentos.find(a => a.cliente.nome.startsWith("Gilberto"));
await api("/caixa/cobrar", { id: at.id, itens: at.servicos.map(s => ({ servicoId: s.id, precoCobradoCentavos: s.precoCentavos })), pagamentos: [{ forma: "promissoria", valorCentavos: at.servicos.reduce((t, s) => t + s.precoCentavos, 0) }] }, cxDemo);
await api("/assinar", { plano: "standard", ciclo: "mensal", barbearia: "Barbearia Nova Fictícia", nome: "Nelson Dono Fictício", documento: gerarCpf("314159260"),
  telefone: "11900000077", email: "nova@exemplo.test", login: "dono.nova", senha: "Senha-Nova-2026", aceiteTermos: true });
const donoNova = await tok("dono.nova", "Senha-Nova-2026");
const novo = await api("/usuarios", { perfil: "barbeiro", nome: "João Novo Fictício", login: "joao.nova", comissaoServicoBp: 5000, comissaoProdutoBp: 1000 }, donoNova);
const plat = await tok("suporte", "Nova-suporte-senha");
await api("/plataforma/contato-suporte", { whatsapp: "11900000000", email: "suporte@forblade.com.br", horario: "Segunda a sexta, 9h às 18h" }, plat);
const ch = await api("/suporte/chamados", { categoria: "duvida", assunto: "Como dar desconto na venda?", mensagem: "Quero dar 10% de desconto numa pomada. Onde faço isso?" }, donoNova);
await api("/plataforma/chamados/responder", { id: ch.chamado.id, mensagem: "Em Caixa → Vender, coloque a pomada no carrinho e digite 10 em Desconto (%). O total já aparece com o desconto." }, plat);

const navegador = await chromium.launch();
const contexto = await navegador.newContext({ viewport: { width: 390, height: 760 }, deviceScaleFactor: 1.5, isMobile: true, hasTouch: true, locale: "pt-BR", timezoneId: "America/Sao_Paulo" });
await contexto.route(/wa\.me/, r => r.fulfill({ status: 200, contentType: "text/html", body: "<p>WhatsApp (simulado)</p>" }));
const page = await contexto.newPage();
const problemas = [];
page.on("pageerror", e => problemas.push(e.message));
const pronto = () => page.waitForFunction(() => !document.body.dataset.carregando);
let logado = null;

async function entrar(login, senha) {
  if (logado === login) return;
  await page.evaluate(() => localStorage.clear());
  await page.goto("about:blank");
  await page.goto(`${BASE}/#/entrar`);
  await page.waitForSelector("#c-login");
  await page.fill("#c-login", login);
  await page.fill("#c-senha", senha);
  await page.click("form.cartao button[type=submit]");
  await page.waitForSelector("#menu:not([hidden]) .grupo");
  await pronto();
  logado = login;
}
// Print: só a parte de cima (até 1100 px de altura), JPEG leve.
async function foto(id, { janela = false } = {}) {
  await page.waitForTimeout(350);
  await page.waitForSelector("#carregador", { state: "hidden" });
  const texto = await page.locator("body").innerText();
  assert.ok(!/\bnull\b|undefined|NaN/.test(texto), `texto estranho na tela (${id})`);
  if (!janela) await page.evaluate(() => window.scrollTo(0, 0));
  const altura = janela ? 760 : Math.min(1100, await page.evaluate(() => document.documentElement.scrollHeight));
  await page.screenshot({ path: join(SAIDA, `${id}.jpg`), type: "jpeg", quality: 62, fullPage: !janela, clip: { x: 0, y: 0, width: 390, height: altura } });
  console.log(`print: ${id}`);
}

try {
  // instalar o app: o site aberto no celular (é o que a pessoa vê antes de "Adicionar à Tela de Início")
  await page.goto(`${BASE}/#/`);
  await page.waitForSelector("[data-teste=lp-entrar]");
  await foto("instalar-app", { janela: true });

  // 1º acesso (barbeiro novo com senha provisória)
  logado = null;
  await page.goto(`${BASE}/#/entrar`);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.fill("#c-login", "joao.nova");
  await page.fill("#c-senha", novo.senhaProvisoria);
  await page.click("form.cartao button[type=submit]");
  await page.waitForSelector("text=Crie sua senha");
  await page.fill("#c-nova", "Navalha-2026");
  await page.fill("#c-nova2", "Navalha-2026");
  await foto("primeiro-acesso");

  await entrar("gerente.demo", DEMO);
  await ir(page, "Funcionamento"); await foto("funcionamento");
  await ir(page, "Serviços"); await foto("servicos");
  await ir(page, "Agenda");
  await page.waitForSelector(".barra-agenda");
  await foto("agenda-dia");
  await page.click("button:has-text('+ Novo horário')");
  await page.waitForSelector("dialog[open]");
  await page.check(`dialog[open] input[name=serv] >> nth=0`);
  await page.waitForTimeout(500);
  await foto("marcar-horario", { janela: true });
  await page.keyboard.press("Escape");
  await ir(page, "Clientes"); await foto("clientes");
  await ir(page, "Mensagens"); await foto("mensagens");
  await ir(page, "Estoque"); await foto("produtos-estoque");
  await page.click("#btn-conta");
  await page.waitForSelector("[data-teste=aparencia]");
  await foto("aparencia", { janela: true });
  await page.keyboard.press("Escape");

  await entrar("dono.demo", DEMO);
  await ir(page, "Equipe"); await foto("equipe");

  await entrar("barbeiro.demo", DEMO);
  await ir(page, "Minha agenda");
  await abrirHorarios(page);
  await page.click("button:has-text('Finalizar') >> nth=0");
  await page.waitForSelector("dialog[open]");
  await foto("finalizar", { janela: true });
  await page.keyboard.press("Escape");

  await entrar("caixa.demo", DEMO);
  await ir(page, "Caixa"); await foto("cobrar");
  await page.click(".pdv-barra button:has-text('Vender')");
  await page.waitForSelector("[data-produto-pdv]");
  await page.click('[data-produto-pdv="Pomada modeladora"]');
  await page.fill("#c-desconto", "10");
  await page.waitForTimeout(300);
  await page.locator("#c-desconto").scrollIntoViewIfNeeded();
  await page.evaluate(() => window.scrollBy(0, 220));
  await foto("vender", { janela: true });
  await page.click(".pdv-barra button:has-text('Lançamentos')");
  await page.waitForTimeout(300);
  await page.click("button:has-text('Fechar caixa')");
  await page.waitForSelector("dialog[open]");
  await foto("fechar-caixa", { janela: true });
  await page.keyboard.press("Escape");
  await ir(page, "Notas em aberto"); await foto("notas");

  await entrar("gerente.semana", SEMANA);
  await ir(page, "Painel");
  await page.click("button:has-text('Semana')").catch(() => {});
  await pronto();
  await foto("painel");
  await ir(page, "Relatório financeiro");
  await page.click(".fin-controles button:has-text('Semana')");
  await pronto();
  await page.waitForSelector(".grafico-fin");
  await foto("financeiro");
  await ir(page, "Comissões e vales"); await foto("comissoes");
  await ir(page, "Contas a pagar"); await foto("contas");
  await ir(page, "Contador e dados"); await foto("contador");

  await entrar("ana.semana", SEMANA);
  await ir(page, "Meu desempenho"); await foto("desempenho");

  await entrar("dono.nova", "Senha-Nova-2026");
  await ir(page, "Caixa"); await foto("abrir-caixa");
  await ir(page, "Meu plano"); await foto("assinatura");
  // Meu plano (cobrança desligada, como está em produção)
  await fetch(`${BASE}/__teste/cobranca?on=0`);
  logado = null;
  await entrar("dono.demo", DEMO);
  await ir(page, "Meu plano"); await foto("meu-plano");
  await fetch(`${BASE}/__teste/cobranca?on=1`);
  logado = null;
  await entrar("dono.nova", "Senha-Nova-2026");
  await ir(page, "Suporte");
  await page.locator("text=Meus chamados").scrollIntoViewIfNeeded();
  await page.evaluate(() => window.scrollBy(0, 300));
  await foto("suporte", { janela: true });

  assert.deepEqual(problemas, [], problemas.join(" | "));
} finally {
  await navegador.close();
  proc.kill();
}

// Lista das imagens para o Worker (versões publicadas: a tela vai dentro do Worker).
const arquivos = readdirSync(SAIDA).filter(f => f.endsWith(".jpg")).sort();
const nome = f => `img_${f.replace(/\W/g, "_")}`;
writeFileSync(join(RAIZ, "src", "arquivos-tutoriais.js"),
  "// GERADO por test/gerar-tutoriais.mjs — não editar à mão. Prints dos tutoriais (dados fictícios).\n" +
  arquivos.map(f => `import ${nome(f)} from "../public/tutoriais/${f}";`).join("\n") +
  `\n\nexport const IMAGENS_TUTORIAIS = {\n${arquivos.map(f => `  "/tutoriais/${f}": ${nome(f)}`).join(",\n")}\n};\n`);
const total = arquivos.reduce((t, f) => t + statSync(join(SAIDA, f)).size, 0);
console.log(`${arquivos.length} prints, ${(total / 1024).toFixed(0)} KB no total`);
