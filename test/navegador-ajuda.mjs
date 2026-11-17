// Teste no navegador: Ajuda (dúvidas frequentes, tutoriais com prints, botão "?" de cada tela) e Suporte
// (gerente abre chamado → plataforma responde → gerente vê a resposta). Dados FICTÍCIOS (demonstração).
// Computador (1366 px) e celular (390 px); prints em docs/prints/ajuda/.  Uso: node test/navegador-ajuda.mjs
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { ir } from "./navegacao.mjs";

const { chromium } = createRequire(import.meta.url)("playwright");
const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
const PRINTS = join(RAIZ, "docs", "prints", "ajuda");
mkdirSync(PRINTS, { recursive: true });
const SENHA = "Demo-4blade-2026";
const TELAS = [
  { nome: "computador", largura: 1366, altura: 768, movel: false, porta: 8831 },
  { nome: "celular", largura: 390, altura: 844, movel: true, porta: 8832 }
];

async function subirServidor(porta) {
  const proc = spawn(process.execPath, ["--no-warnings", join(RAIZ, "test", "servidor-local.mjs"), String(porta), "--demo"], { stdio: ["ignore", "pipe", "inherit"] });
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
    if (m.type() === "error" && !/^Failed to load resource: the server responded with a status of (400|403|409)\b/.test(m.text())) problemas.push(m.text());
  });
  page.on("pageerror", e => problemas.push(e.message));
  let n = 0;
  const print = async (nome, inteira = true) => {
    n++;
    await page.waitForTimeout(300);
    await page.waitForSelector("#carregador", { state: "hidden" });
    if (inteira) await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: join(PRINTS, `${tela.nome}-${String(n).padStart(2, "0")}-${nome}.png`), fullPage: inteira });
    assert.ok(!/\bnull\b|undefined|NaN/.test(await page.locator("body").innerText()), `texto estranho (${nome})`);
  };
  const passo = t => console.log(`[${tela.nome}] ${t}`);
  const pronto = () => page.waitForFunction(() => !document.body.dataset.carregando);
  const entrar = async (login, senha = SENHA) => {
    await page.fill("#c-login", login);
    await page.fill("#c-senha", senha);
    await page.click("form.cartao button[type=submit]");
    await page.waitForSelector("#menu:not([hidden]) .grupo");
    await pronto();
  };
  const sair = async () => { await page.click("#btn-conta"); await page.click("#btn-sair"); await page.waitForSelector("text=Você saiu do sistema."); };
  const imagemCarregou = sel => page.locator(sel).first().evaluate(i => i.complete && i.naturalWidth > 0);

  try {
    // cobrança DESLIGADA (como está no ar): landing e planos sem preço, sem "assinar", app com "Meu plano"
    await page.request.get(`${base}/__teste/cobranca?on=0`);
    await page.goto(base);
    await page.waitForSelector("[data-teste=lp-entrar]");
    await pronto();
    const landing = await page.locator(".lp").innerText();
    assert.ok(!/R\$|dias grátis|mensalidade|Cancele quando quiser/.test(landing), "landing sem preço nem pagamento");
    assert.equal(await page.locator("[data-teste=lp-comecar]").count(), 0);
    assert.equal(await page.locator(".lp [data-plano]").count(), 3, "planos aparecem (sem preço)");
    assert.ok(await page.locator('.lp [data-plano="pro"]').innerText().then(t => /Até 10 barbeiros[\s\S]*lista de produtos/.test(t)));
    await print("landing-sem-precos");
    await page.goto(`${base}/#/assinar/pro`);
    await page.waitForFunction(() => location.hash === "#/planos");
    await page.waitForSelector('[data-plano="pro"]');
    assert.ok(!/R\$/.test(await page.locator("main").innerText()), "página de planos sem preço");
    passo("cobrança desligada: sem preço, sem cadastro on-line (assinar volta para planos)");

    // pedido de teste grátis pelo site
    await page.click('[data-teste-gratis="pro"]');
    await page.waitForSelector("form.form-assinar #c-barbearia");
    await pronto();
    assert.equal(await page.inputValue("#c-plano"), "pro");
    await page.fill("#c-barbearia", `Barbearia Pedido ${tela.nome}`);
    await page.fill("#c-nome", "Pessoa Interessada Fictícia");
    await page.locator("#c-telefone").pressSequentially(tela.movel ? "31900000071" : "31900000072");
    await page.fill("#c-cidade", "Cidade Fictícia - MG");
    await page.selectOption("#c-barbeiros", "6");
    await page.check("#c-aceite");
    await print("teste-gratis-form");
    await page.click("form.form-assinar button[type=submit]");
    await page.waitForSelector("[data-teste=teste-recebido]");
    await print("teste-gratis-recebido");
    passo("site: pedido de teste grátis enviado");

    // sem login: dúvidas pela página de planos
    await page.goto(`${base}/#/planos`);
    await page.waitForSelector('[data-plano="pro"]');
    await page.click("a:has-text('Dúvidas frequentes')");
    await page.waitForSelector(".duvida");
    passo("dúvidas frequentes abertas sem login (página de planos)");

    await page.goto(`${base}/#/entrar`);
    await page.waitForSelector("#c-login");
    await entrar("gerente.demo");
    await ir(page, "Dúvidas frequentes");
    const total = await page.locator(".duvida").count();
    assert.ok(total >= 24, `poucas dúvidas: ${total}`);
    assert.ok(!/mensalidade|Asaas/.test(await page.locator(".duvidas").innerText()), "dúvidas sem pagamento");
    await page.fill(".busca-ajuda", "senha");
    await page.waitForFunction(t => document.querySelectorAll(".duvida").length < t, total);
    await page.click('.duvida:has-text("Esqueci a minha senha") summary');
    await print("duvidas-busca");
    passo("dúvidas: busca e resposta abrindo");

    await ir(page, "Meu plano");
    await page.waitForSelector("[data-teste=meu-plano]");
    assert.match(await page.locator("[data-teste=meu-plano]").innerText(), /Plano Básico[\s\S]*2\/2[\s\S]*Barbeiros ativos/);
    assert.ok(!/R\$/.test(await page.locator("main").innerText()), "Meu plano sem valores");
    await print("meu-plano");
    passo("Meu plano: plano, vagas e o que inclui, sem valores");

    await ir(page, "Tutoriais");
    await page.waitForSelector("[data-tutorial]");
    assert.ok(await page.locator('[data-tutorial="meu-plano"]').count() === 1 && await page.locator('[data-tutorial="assinatura"]').count() === 0);
    assert.equal(await page.locator("[data-tutorial]").count(), 27, "gerente vê todos os tutoriais");
    await page.waitForFunction(() => [...document.querySelectorAll(".tutorial-cartao img")].slice(0, 4).every(i => i.complete && i.naturalWidth > 0));
    await print("tutoriais-lista");
    await page.click('[data-tutorial="marcar-horario"]');
    await page.waitForSelector('[data-tutorial-aberto="marcar-horario"]');
    await pronto();
    await page.waitForFunction(() => { const i = document.querySelector(".tutorial-print img"); return i && i.complete && i.naturalWidth > 0; });
    assert.ok(await imagemCarregou(".tutorial-print img"));
    await print("tutorial-marcar-horario");
    passo("tutorial com print, onde acessar, passos, exemplo e dica");

    // "?" na tela do caixa: tutoriais da própria tela
    await ir(page, "Caixa");
    await page.click("#btn-ajuda");
    await page.waitForSelector("dialog[open] [data-tutorial-aberto]");
    const titulos = await page.locator("dialog[open] [data-tutorial-aberto] h2").allInnerTexts();
    assert.deepEqual(titulos, ["Abrir o caixa do dia", "Cobrar um atendimento no caixa", "Vender produto (com desconto)", "Sangria, suprimento e fechamento do caixa"]);
    await print("ajuda-desta-tela", false);
    await page.click("dialog[open] a:has-text('Falar com o suporte')");
    await page.waitForSelector("text=Abrir chamado");
    await pronto();
    passo("botão ? abre a ajuda da tela; leva ao suporte");

    // suporte: abre chamado
    await page.selectOption("#c-categoria", "problema");
    await page.fill("#c-assunto", "Diferença no fechamento");
    await page.fill("#c-mensagem", "Fechei o caixa e apareceu falta de R$ 5,00. Como corrijo?");
    await page.click("button:has-text('Enviar chamado')");
    await page.waitForSelector('[data-chamado="101"]');
    await print("suporte-chamado-aberto");
    await sair();

    // plataforma: pedido de teste → cadastrar a barbearia
    await entrar("suporte", "Nova-suporte-senha");
    await ir(page, "Pedidos de teste");
    await page.waitForSelector(`[data-pedido] >> text=Barbearia Pedido ${tela.nome}`);
    await print("plataforma-pedidos");
    await page.click(`[data-pedido]:has-text("Barbearia Pedido ${tela.nome}") button:has-text("Cadastrar barbearia")`);
    await page.waitForSelector("dialog[open] #c-propLogin");
    assert.equal(await page.inputValue("dialog[open] #c-plano"), "pro");
    await page.click("dialog[open] button[type=submit]");
    await page.waitForSelector("dialog[open] [data-teste=senha]");
    await page.click("dialog[open] button[type=submit]");
    await page.waitForSelector("text=Nenhum pedido aguardando.");
    passo("plataforma: pedido virou barbearia cadastrada (senha provisória mostrada)");

    // plataforma responde
    await ir(page, "Chamados");
    await page.waitForSelector('[data-chamado="101"]');
    assert.match(await page.locator('[data-chamado="101"]').innerText(), /Barbearia Demonstração/);
    await page.click('[data-chamado="101"]');
    await page.waitForSelector(".balao.barbearia");
    assert.match(await page.locator("main").innerText(), /tela: caixa/);
    await page.fill("#c-msg", "A diferença fica registrada. Se foi troco errado, escreva isso na observação do fechamento.");
    await page.click("button:has-text('Responder')");
    await page.waitForSelector(".balao.suporte");
    await print("plataforma-responde");
    await sair();
    passo("plataforma vê a fila (com a tela de origem) e responde");

    await entrar("gerente.demo");
    await ir(page, "Suporte");
    await page.waitForSelector('[data-chamado="101"] >> text=Respondido');
    await page.click('[data-chamado="101"]');
    await page.waitForSelector(".balao.suporte");
    await print("suporte-resposta");
    await page.click("button:has-text('Encerrar chamado')");
    await page.waitForSelector('[data-situacao-chamado="encerrado"]');
    await sair();
    passo("gerente vê a resposta e encerra");

    // barbeiro: tem dúvidas e tutoriais (só os dele), sem suporte
    await entrar("barbeiro.demo");
    const ajuda = await page.locator('#menu [data-grupo="ajuda"] [data-nav]').evaluateAll(a => a.map(x => x.dataset.nav));
    assert.deepEqual(ajuda, ["Dúvidas frequentes", "Tutoriais"]);
    await ir(page, "Tutoriais");
    const ids = await page.locator("[data-tutorial]").evaluateAll(a => a.map(x => x.dataset.tutorial));
    assert.ok(ids.includes("finalizar") && !ids.includes("desempenho") && !ids.includes("comissoes") && !ids.includes("suporte"), ids.join(","));
    await page.goto(`${base}/#/suporte`);
    await pronto();
    assert.notEqual(await page.evaluate(() => location.hash), "#/suporte");
    passo("barbeiro: ajuda sem suporte; tutoriais só do perfil");

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
console.log("TESTE NO NAVEGADOR AJUDA: OK (computador 1366 px e celular 390 px)");
