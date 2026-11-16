// Teste no navegador das melhorias de layout (Playwright). Dados FICTÍCIOS (semana simulada).
// Caminho: menu lateral por categorias → barbeira marca horário FIXO toda semana → vê o selo "Fixo semanal" →
// agenda em visão Mês (cores por ocupação) e Ano → caixa (tela de PDV): cobra atendimento da fila, lança atendimento
// sem horário e vende produto pelo carrinho → gerente vê o painel organizado.
// Roda em computador (1366 px) e celular (390 px); prints em docs/prints/melhorias/.  Uso: node test/navegador-melhorias.mjs
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { ir } from "./navegacao.mjs";
import { hojeBrasil } from "../src/util.js";
import { somarDias } from "../src/agenda-util.js";

const { chromium } = createRequire(import.meta.url)("playwright");
const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
const PRINTS = join(RAIZ, "docs", "prints", "melhorias");
mkdirSync(PRINTS, { recursive: true });
const HOJE = hojeBrasil();
const AMANHA = somarDias(HOJE, 1);
const SENHA = "Senha-Semana-2026";

const TELAS = [
  { nome: "computador", largura: 1366, altura: 768, movel: false, porta: 8801 },
  { nome: "celular", largura: 390, altura: 844, movel: true, porta: 8802 }
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
  const page = await contexto.newPage();
  const problemas = [];
  page.on("console", m => {
    if (m.type() === "error" && !/^Failed to load resource: the server responded with a status of (400|403|409)\b/.test(m.text())) problemas.push(m.text());
  });
  page.on("pageerror", e => problemas.push(e.message));
  let n = 0;
  const print = async (nome, inteira = true) => {
    n++;
    const arq = `${tela.nome}-${String(n).padStart(2, "0")}-${nome}.png`;
    await page.waitForTimeout(300);
    if (inteira) await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: join(PRINTS, arq), fullPage: inteira });
    const texto = await page.locator("body").innerText();
    assert.ok(!/\bnull\b|\bundefined\b|NaN/.test(texto), `texto estranho na tela ${nome}`);
    console.log(`  print: docs/prints/melhorias/${arq}`);
  };
  const passo = t => console.log(`[${tela.nome}] ${t}`);
  const entrar = async login => {
    await page.fill("#c-login", login);
    await page.fill("#c-senha", SENHA);
    await page.click("button:has-text('Entrar')");
  };
  const sair = async () => { await page.click("#btn-conta"); await page.click("#btn-sair"); await page.waitForSelector("text=Você saiu do sistema."); };
  const ok = () => page.click("dialog[open] button[type=submit]");
  const chamar = async (rota, corpo, token) => {
    const r = await fetch(`${base}/api${rota}`, { method: corpo ? "POST" : "GET", headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: corpo ? JSON.stringify(corpo) : undefined });
    const d = await r.json();
    if (r.status >= 300) throw new Error(`${rota}: ${JSON.stringify(d)}`);
    return d;
  };
  const visao = async nome => { await page.click(`.barra-agenda .alterna button:has-text('${nome}')`); };

  try {
    await page.goto(base);
    passo("abertura com a logo e a frase; tela de entrada nova");
    await page.waitForSelector("[data-teste=slogan]");
    assert.equal((await page.textContent("[data-teste=slogan]")).trim(), "Gestão afiada para sua barbearia.");
    await page.waitForSelector("#carregador", { state: "hidden" });
    await print("entrada-com-logo-e-frase");

    // ---------- BARBEARIA NOVA (sem nada lançado) ----------
    passo("barbearia nova: painel e agenda vazios ocupam a tela, sem buracos");
    const ativar = async (login, prov, nova) => {
      const l = await chamar("/auth/login", { login, senha: prov });
      await chamar("/auth/trocar-senha", { senhaAtual: prov, novaSenha: nova }, l.token);
    };
    const plat = (await chamar("/auth/login", { login: "suporte", senha: "Nova-suporte-senha" })).token;
    const nova = await chamar("/plataforma/barbearias", { nome: "Barbearia Vazia Fictícia", proprietario: { nome: "Vitor Fictício", login: "vitor.vazia" } }, plat);
    await ativar("vitor.vazia", nova.senhaProvisoria, SENHA);
    await entrar("vitor.vazia");
    await page.waitForSelector("[data-cartao=lucro]");
    await page.waitForSelector("text=Ainda não há faturamento");
    if (tela.movel) {
      const [bruto, lucro] = await Promise.all(["bruto", "lucro"].map(c => page.locator(`[data-cartao=${c}]`).boundingBox()));
      assert.ok(lucro.width > bruto.width * 1.8, "no celular o lucro ocupa as 2 colunas");
    }
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), tela.largura);
    await print("barbearia-nova-painel");
    await ir(page, "Agenda");
    await page.waitForSelector("[data-teste=sem-profissionais]");
    if (tela.movel) {
      const larg = async sel => (await page.locator(sel).first().boundingBox()).width;
      assert.ok(await larg(".barra-agenda .alterna") > tela.largura - 60, "botões Dia/Semana/Mês/Ano na largura toda");
      assert.ok(await larg(".navega-data") > tela.largura - 60, "navegação de data na largura toda");
    }
    await print("barbearia-nova-agenda");
    await sair();

    // ---------- MENU ----------
    passo("menu lateral com categorias; cada opção abre a tela inteira");
    await entrar("ana.semana");
    await page.waitForSelector("h2:has-text('Minha agenda')");
    if (tela.movel) {
      assert.equal(await page.locator("#menu.aberto").count(), 0, "no celular o menu começa fechado");
      await page.click("#btn-menu");
      await page.waitForSelector("#menu.aberto");
      await page.waitForTimeout(300);
      await print("menu-aberto", false);
      await page.click("#fundo-menu", { position: { x: 370, y: 400 } });
      await page.waitForFunction(() => !document.getElementById("menu").classList.contains("aberto"));
    } else {
      assert.ok(await page.locator("#menu").isVisible(), "no computador o menu fica fixo");
    }
    const grupos = await page.locator("#menu .grupo-titulo").allInnerTexts();
    assert.ok(grupos.length >= 2, `categorias no menu: ${grupos.join(", ")}`);

    // ---------- HORÁRIO FIXO ----------
    passo("barbeira marca horário fixo toda semana");
    await page.click("button:has-text('+ Novo horário')");
    await page.fill("dialog[open] #c-data", AMANHA);
    // hora digitada (sem o relógio do celular, que ficava cortado): "930" vira 09:30
    assert.equal(await page.getAttribute("dialog[open] #c-hora", "type"), "text");
    await page.locator("dialog[open] #c-hora").pressSequentially("930");
    await page.locator("dialog[open] #c-hora").blur();
    assert.equal(await page.inputValue("dialog[open] #c-hora"), "09:30");
    await page.fill("dialog[open] #c-hora", "");
    await page.locator("dialog[open] #c-hora").pressSequentially("1000");
    assert.equal(await page.inputValue("dialog[open] #c-hora"), "10:00");
    await page.check("dialog[open] input[name=serv] >> nth=0");
    await page.locator("dialog[open] #c-cliTel").pressSequentially("11977776666");
    assert.equal(await page.inputValue("dialog[open] #c-cliTel"), "(11) 97777-6666");
    await page.waitForSelector("dialog[open] >> text=Cliente novo");
    await page.fill("dialog[open] #c-cliNome", "Fábio Fixo Fictício");
    await page.check("dialog[open] #c-cliLgpd");
    await page.selectOption("dialog[open] #c-repetir", "1");
    assert.equal(await page.inputValue("dialog[open] #c-repAte"), somarDias(AMANHA, 56));
    await print("marcar-horario-fixo", false);
    await ok();
    await page.waitForSelector("dialog[open] >> text=Horário fixo criado");
    assert.match(await page.textContent("dialog[open]"), /9 horário\(s\) marcado\(s\), toda .* às 10:00/);
    await print("horario-fixo-criado", false);
    await ok();
    await page.waitForSelector('[data-agendamento="Fábio Fixo Fictício"] >> text=Fixo semanal');

    passo("marca horário SEM telefone (só o nome)");
    await page.click("button:has-text('+ Novo horário')");
    await page.fill("dialog[open] #c-data", AMANHA);
    await page.fill("dialog[open] #c-hora", "15:00");
    await page.check("dialog[open] input[name=serv] >> nth=0");
    assert.equal(await page.locator("dialog[open] #c-cliTel").getAttribute("required"), null, "telefone não é obrigatório");
    assert.ok(await page.locator("dialog[open] #c-cliNome").isVisible(), "nome aparece mesmo sem telefone");
    await page.fill("dialog[open] #c-cliNome", "Seu Zé Fictício");
    await ok();
    await page.waitForSelector('[data-agendamento="Seu Zé Fictício"] >> text=sem telefone');
    assert.equal(await page.locator('[data-agendamento="Seu Zé Fictício"] [data-whats]').count(), 0, "sem telefone, sem botão de WhatsApp");
    await print("agenda-dia-com-fixo-e-sem-telefone");

    // ---------- MÊS e ANO ----------
    passo("agenda em visão Mês (cores) e Ano");
    await visao("Mês");
    await page.waitForSelector(".calendario .dia-cal");
    const celAmanha = page.locator(`.dia-cal[data-dia="${AMANHA}"]`);
    assert.match(await celAmanha.getAttribute("aria-label"), /2 marcado/);
    assert.ok(["livre", "poucos"].includes(await celAmanha.getAttribute("data-status")));
    assert.equal(await page.locator(".legenda >> text=Agenda cheia").count(), 1);
    await print("agenda-mes");
    await visao("Ano");
    await page.waitForSelector(".ano-grade .mes-mini");
    assert.equal(await page.locator(".mes-mini").count(), 12);
    await print("agenda-ano");
    await page.click(`.mes-mini[data-mes="${AMANHA.slice(0, 7)}"]`);
    await page.waitForSelector(`.dia-cal[data-dia="${AMANHA}"]`);
    await page.click(`.dia-cal[data-dia="${AMANHA}"]`);
    await page.waitForSelector('[data-agendamento="Fábio Fixo Fictício"]');
    await sair();

    // ---------- CAIXA (PDV) ----------
    passo("caixa cobra atendimento da fila, lança atendimento sem horário e vende pelo carrinho");
    const beto = (await chamar("/auth/login", { login: "beto.semana", senha: SENHA })).token;
    const servs = (await chamar("/servicos", null, beto)).servicos;
    const corte = servs.find(s => s.nome === "Corte");
    await chamar("/agenda", { data: HOJE, hora: "18:00", servicoIds: [corte.id], cliente: { telefone: "11 96666-5555", nome: "Gil Fila Fictício", aceiteLgpd: true } }, beto);
    await entrar("caixa.semana");
    await page.waitForSelector(".pdv-topo");
    await page.waitForSelector('[data-cobrar="Gil Fila Fictício"]');
    const entradas0 = await page.textContent("[data-teste=entradas]");
    await print("caixa-pdv-fila");
    await page.click('[data-cobrar="Gil Fila Fictício"] button:has-text("Cobrar")');
    await page.waitForSelector("dialog[open] [data-teste=total]:has-text('40,00')");
    await page.selectOption("dialog[open] #c-forma1", "dinheiro");
    await ok();
    await page.waitForSelector('[data-cobrar="Gil Fila Fictício"] >> text=Pago');
    assert.notEqual(await page.textContent("[data-teste=entradas]"), entradas0);

    await page.click("button:has-text('+ Atendimento sem horário')");
    await page.waitForSelector("dialog[open] >> text=Quem atendeu");
    await page.check("dialog[open] input[name=aserv] >> nth=0");
    await page.locator("dialog[open] #c-aTel").pressSequentially("11955554444");
    await page.fill("dialog[open] #c-aNome", "Hugo Avulso Fictício");
    await page.check("dialog[open] #c-aLgpd");
    await print("caixa-atendimento-sem-horario", false);
    await ok();
    await page.waitForSelector('[data-cobrar="Hugo Avulso Fictício"] >> text=Pago');
    await print("caixa-pdv-pagos");

    passo("caixa cobra atendimento sem telefone e sem nome");
    await page.click("button:has-text('+ Atendimento sem horário')");
    await page.waitForSelector("dialog[open] >> text=Quem atendeu");
    await page.check("dialog[open] input[name=aserv] >> nth=0");
    assert.equal(await page.locator("dialog[open] #c-aLgpd").isVisible(), false, "aceite LGPD só aparece com telefone");
    await ok();
    await page.waitForSelector('[data-cobrar="Cliente não identificado"] >> text=Pago');

    await page.click(".pdv-barra .alterna button:has-text('Vender')");
    await page.click('[data-produto-pdv="Pomada"]');
    await page.click('[data-produto-pdv="Pomada"]');
    await page.waitForSelector("[data-teste=total-venda]:has-text('90,00')");
    await print("caixa-pdv-carrinho");
    await page.click("[data-teste=carrinho] button[type=submit]");
    await page.waitForSelector("text=Venda registrada");
    await page.click(".pdv-barra .alterna button:has-text('Lançamentos')");
    await page.waitForSelector('[data-lancamento="Hugo Avulso Fictício"]');
    await print("caixa-lancamentos");

    passo("caixa (recepção) vê a agenda de todos, marca para um barbeiro e acessa clientes, mensagens e catálogo");
    const gruposCaixa = await page.locator("#menu .grupo-titulo").allInnerTexts();
    assert.ok(gruposCaixa.some(t => /Atendimento/.test(t)) && gruposCaixa.some(t => /Catálogo/.test(t)), `menu do caixa: ${gruposCaixa}`);
    await ir(page, "Agenda");
    await page.waitForSelector(".filtro-prof");
    assert.equal(await page.locator(".acoes-agenda button:has-text('Bloquear')").count(), 0, "caixa não bloqueia agenda");
    await page.click("button:has-text('+ Novo horário')");
    const nomesProf = await page.locator("dialog[open] #c-prof option").allInnerTexts();
    assert.ok(nomesProf.includes("Ana Barbeira") && nomesProf.includes("Beto Barbeiro"), `profissionais: ${nomesProf}`);
    await page.selectOption("dialog[open] #c-prof", { label: "Beto Barbeiro" });
    await page.fill("dialog[open] #c-data", AMANHA);
    await page.fill("dialog[open] #c-hora", "17:00");
    await page.check("dialog[open] input[name=serv] >> nth=0");
    await page.fill("dialog[open] #c-cliNome", "Ivo Recepção Fictício");
    await ok();
    await page.waitForSelector('[data-prof="Beto Barbeiro"] [data-agendamento="Ivo Recepção Fictício"]');
    assert.equal(await page.locator('[data-agendamento="Ivo Recepção Fictício"] button:has-text("Finalizar")').count(), 0, "caixa cobra pela tela do caixa");
    assert.ok(await page.locator('[data-prof="Ana Barbeira"]').isVisible(), "vê a agenda da Ana também");
    await print("caixa-agenda-todos");
    await ir(page, "Clientes");
    await page.waitForSelector('[data-cliente="Ivo Recepção Fictício"]');
    assert.equal(await page.locator('[data-cliente="Ivo Recepção Fictício"] button:has-text("Desativar")').count(), 0);
    await ir(page, "Mensagens");
    await page.waitForSelector("h2:has-text('Modelos de mensagem')");
    await ir(page, "Serviços");
    await page.waitForSelector("h2:has-text('Serviços')");
    await print("caixa-catalogo-servicos");
    await sair();

    // ---------- PAINEL ----------
    passo("gerente vê o painel sem espaços vazios e sem sobrar para os lados");
    await entrar("gerente.semana");
    await page.waitForSelector("[data-cartao=bruto]");
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), tela.largura, "nada passa da largura da tela");
    await print("gerente-painel");
    assert.ok(await page.locator(tela.movel ? ".topo-logo img" : ".menu-logo").isVisible(), "logo no topo/menu");
    await page.click("#btn-conta");
    await page.waitForSelector("dialog[open] .conta-cartao >> text=Gustavo Gerente");
    await print("minha-conta", false);
    await page.click("dialog[open] button:has-text('Fechar')");

    passo("gerente cadastra produto já com estoque e edita uma conta lançada");
    await ir(page, "Produtos");
    await page.fill("#c-nome", "Cera Fictícia");
    await page.fill("#c-preco", "35,00");
    await page.fill("#c-qtdInicial", "10");
    await page.fill("#c-custoInicial", "18,00");
    await page.click("form.cartao button:has-text('Salvar')");
    await page.waitForSelector('[data-produto="Cera Fictícia"] >> text=Custo médio: R$ 18,00');
    await ir(page, "Estoque");
    await page.waitForSelector('[data-estoque="Cera Fictícia"] [data-teste=saldo]:has-text("10 un.")');
    await ir(page, "Contas a pagar");
    await page.click('[data-conta="Conta de luz"] button:has-text("Editar")');
    await page.fill("dialog[open] #c-eValor", "215,40");
    await print("editar-conta", false);
    await ok();
    await page.waitForSelector('[data-conta="Conta de luz"] >> text=R$ 215,40');
    await ir(page, "Agenda");
    await page.waitForSelector(".barra-agenda");
    await visao("Mês");
    await page.waitForSelector(".calendario .dia-cal");
    await print("gerente-agenda-mes");
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
console.log("TESTE NO NAVEGADOR MELHORIAS: OK (computador 1366 px e celular 390 px)");
