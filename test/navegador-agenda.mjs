// Teste no navegador: AGENDA (refinamentos de 19/11/2026). Dados FICTÍCIOS (demonstração + agenda cheia criada aqui).
// Confere: barra enxuta (Grade/Lista junto do filtro), "+ Novo horário" flutuante no celular, horas fixas ao rolar
// para o lado, Semana com cartões na largura toda quando não se cruzam (e lado a lado quando se cruzam), Mês enxuto
// e Ano com os dias passados neutros. Roda em computador (1366 px) e celular (390 px); prints em docs/prints/agenda/.
// Uso: node test/navegador-agenda.mjs
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { hojeBrasil } from "../src/util.js";
import { somarDias } from "../src/agenda-util.js";
import { ir, forma, lancamentos } from "./navegacao.mjs";

const { chromium } = createRequire(import.meta.url)("playwright");
const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
const PRINTS = join(RAIZ, "docs", "prints", "agenda");
mkdirSync(PRINTS, { recursive: true });
const SENHA = "Demo-4blade-2026";
const HOJE = hojeBrasil();

const TELAS = [
  { nome: "computador", largura: 1366, altura: 800, movel: false, porta: 8861 },
  { nome: "celular", largura: 390, altura: 844, movel: true, porta: 8862 }
];

async function subirServidor(porta) {
  const proc = spawn(process.execPath, ["--no-warnings", join(RAIZ, "test", "servidor-local.mjs"), String(porta), "--demo"], { stdio: ["ignore", "pipe", "inherit"] });
  await new Promise((ok, falha) => {
    proc.stdout.on("data", d => { if (String(d).includes(`localhost:${porta}`)) ok(); });
    proc.on("exit", c => falha(new Error(`servidor saiu (${c})`)));
  });
  return proc;
}

// Agenda cheia pela API (como o gerente faria na tela): hoje e amanhã com horários que se cruzam e que não se cruzam.
async function popular(base) {
  const r = await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ login: "gerente.demo", senha: SENHA }) });
  const token = (await r.json()).token;
  const call = async (m, p, body) => { const x = await fetch(`${base}/api${p}`, { method: m, headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: body ? JSON.stringify(body) : undefined }); return { status: x.status, d: await x.json() }; };
  const us = (await call("GET", "/usuarios")).d.usuarios;
  const id = l => us.find(u => u.login === l).id;
  const sv = Object.fromEntries((await call("GET", "/servicos")).d.servicos.map(s => [s.nome, s.id]));
  let k = 0;
  const marcar = async (barb, data, hora, servico, nome) => {
    k++;
    const x = await call("POST", "/agenda", { barbeiroId: id(barb), data, hora, servicoIds: [sv[servico]], cliente: { telefone: `11 9${String(6000 + k).padStart(4, "0")}-${String(2000 + k)}`, nome, aceiteLgpd: true } });
    assert.equal(x.status, 201, `${nome}: ${JSON.stringify(x.d)}`);
  };
  const amanha = somarDias(HOJE, 1);
  // amanhã: às 11:00 dois barbeiros ao mesmo tempo (lado a lado); às 16:00 só um (largura toda)
  await marcar("barbeiro.demo", amanha, "11:00", "Corte masculino", "Lado Esquerdo Fictício");
  await marcar("rafael.demo", amanha, "11:00", "Corte masculino", "Lado Direito Fictício");
  await marcar("rafael.demo", amanha, "16:00", "Corte + barba", "Sozinho Fictício");
}

async function rodar(tela) {
  const servidor = await subirServidor(tela.porta);
  const base = `http://localhost:${tela.porta}`;
  const navegador = await chromium.launch();
  try {
    await popular(base);
    const contexto = await navegador.newContext({ viewport: { width: tela.largura, height: tela.altura }, deviceScaleFactor: 2, isMobile: tela.movel, hasTouch: tela.movel, locale: "pt-BR", timezoneId: "America/Sao_Paulo" });
    await contexto.addInitScript(() => { try { localStorage.setItem("4blade.agendaModo", "grade"); } catch { /* about:blank */ } });
    const page = await contexto.newPage();
    const problemas = [];
    page.on("console", m => { if (m.type() === "error") problemas.push(m.text()); });
    page.on("pageerror", e => problemas.push(e.message));
    let n = 0;
    const pronto = () => page.waitForFunction(() => !document.body.dataset.carregando);
    const print = async nome => {
      const arq = `${tela.nome}-${String(++n).padStart(2, "0")}-${nome}.png`;
      await page.waitForTimeout(250);
      await page.screenshot({ path: join(PRINTS, arq), fullPage: true });
      const texto = await page.locator("body").innerText();
      assert.ok(!/\bnull\b|\bundefined\b|NaN/.test(texto), `texto estranho na tela ${nome}`);
      console.log(`  print: docs/prints/agenda/${arq}`);
    };
    const passo = t => console.log(`[${tela.nome}] ${t}`);
    const visao = async nome => { await page.click(`.visoes-agenda button:text-is('${nome}')`); await pronto(); };

    await page.goto(`${base}/#/entrar`);
    await page.fill("#c-login", "gerente.demo");
    await page.fill("#c-senha", SENHA);
    await page.click("button:has-text('Entrar')");
    await page.waitForFunction(() => document.querySelector("#nav-topo:not([hidden]) .nav-aba") || document.querySelector("#menu:not([hidden]) .grupo"));
    await ir(page, "Agenda");
    await page.waitForSelector(".grade-agenda");
    await pronto();

    passo("barra enxuta: Grade/Lista junto do filtro; + Novo horário flutuante no celular");
    assert.equal(await page.locator(".linha-filtros-agenda .modo-dia").count(), 1);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), tela.largura, "a barra da agenda não alarga a página");
    const novo = page.locator(".acoes-agenda .novo-horario");
    const pos = await novo.evaluate(e => getComputedStyle(e).position);
    assert.equal(pos, tela.movel ? "fixed" : "static", "no celular o botão flutua");
    passo("Dia: horas fixas ao rolar para o lado");
    assert.equal(await page.locator(".grade-hora").first().evaluate(e => getComputedStyle(e).position), "sticky");
    await print("dia-grade");

    passo("sem zoom no celular: viewport travado e sem zoom de toque duplo");
    assert.match(await page.getAttribute("meta[name=viewport]", "content"), /maximum-scale=1, user-scalable=no/);
    assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).touchAction), "manipulation");

    passo("Lista com vários profissionais: a agenda de quem está usando aberta, a dos outros recolhida (só no celular)");
    await page.click(".linha-filtros-agenda .modo-dia button:text-is('Lista')");
    await pronto();
    await page.waitForSelector(".recolhivel-prof");
    const blocos = await page.locator(".recolhivel-prof").count();
    assert.ok(blocos >= 2, "vários profissionais");
    assert.match(await page.textContent(".recolhivel-prof.aberta .prof-cabeca"), /\(você\)/, "o seu bloco é o aberto");
    assert.equal(await page.locator(".recolhivel-prof.aberta").count(), 1);
    const outro = page.locator(".recolhivel-prof.recolhida").first();
    const nomeOutro = await outro.getAttribute("data-prof");
    assert.match(await outro.locator(".prof-cabeca small").textContent(), /\d+ marcados? · \d+ livres?/);
    if (tela.movel) {
      assert.equal(await outro.locator(".prof-conteudo").isVisible(), false, "no celular o do outro fica recolhido");
      await print("lista-por-profissional");
      await outro.locator(".prof-cabeca").click();
      await pronto();
      await page.waitForSelector(`.recolhivel-prof.aberta[data-prof="${nomeOutro}"] .prof-conteudo`);
      assert.ok(await page.locator(`.recolhivel-prof[data-prof="${nomeOutro}"] .prof-conteudo`).isVisible());
      await print("lista-outro-aberto");
    } else {
      assert.ok(await outro.locator(".prof-conteudo").isVisible(), "no computador as colunas ficam todas abertas");
      await print("lista-por-profissional");
    }
    await page.click(".linha-filtros-agenda .modo-dia button:text-is('Grade')");
    await pronto();
    await page.waitForSelector(".grade-agenda");

    passo("Semana: cartão sozinho usa a largura toda do dia; quem se cruza fica lado a lado");
    await visao("Semana");
    await page.waitForSelector(".grade-semana [data-evento='Sozinho Fictício']");
    const larg = async nome => (await page.locator(`.grade-semana [data-evento='${nome}']`).boundingBox()).width;
    const sozinho = await larg("Sozinho Fictício"), esq = await larg("Lado Esquerdo Fictício"), dir = await larg("Lado Direito Fictício");
    assert.ok(sozinho > esq * 1.6 && sozinho > dir * 1.6, `sozinho ${sozinho} × lado a lado ${esq}/${dir}`);
    const [be, bd] = [await page.locator(".grade-semana [data-evento='Lado Esquerdo Fictício']").boundingBox(), await page.locator(".grade-semana [data-evento='Lado Direito Fictício']").boundingBox()];
    assert.ok(Math.abs(be.y - bd.y) < 2 && Math.abs(be.x - bd.x) > 20, "mesmo horário, lado a lado");
    assert.match(await page.textContent(".grade-semana [data-evento='Sozinho Fictício']"), /Sozinho Fictício/, "nome aparece");
    await print("semana-grade");

    passo("Mês: célula enxuta; Ano: dias passados neutros");
    await visao("Mês");
    await page.waitForSelector(".mes-calendario");
    if (tela.movel) assert.equal(await page.locator(".mes-mais").first().evaluate(e => getComputedStyle(e).display).catch(() => "none"), "none");
    await print("mes");
    await visao("Ano");
    await page.waitForSelector(".ano-grade");
    const passado = page.locator(".mes-mini .pt.passado:not(.fechado)").first();
    if (await passado.count()) {
      const cor = await passado.evaluate(e => getComputedStyle(e).backgroundColor);
      assert.notEqual(cor, "rgb(74, 222, 128)", "dia que já passou não aparece verde (livre)");
    }
    await print("ano");

    passo("Vários de uma vez (24/11/2026: saiu do menu; entra pelo Novo cliente ou pelo Novo horário): 4 linhas, 1 certa e 3 com problema; corrige e salva de novo");
    if (tela.movel) {   // celular: pelo cadastro de cliente
      await ir(page, "Clientes");
      await page.locator("details.painel-novo > summary").click();
      await page.click("[data-teste=clientes-lote]");
    } else {   // computador: pelo Novo horário
      await page.click("button:has-text('+ Novo horário')");
      await page.click("dialog[open] [data-teste=link-lote]");
    }
    await page.waitForSelector("[data-lote-linha='3']");
    const dia = somarDias(HOJE, 2);
    const linha = n => page.locator(`[data-lote-linha='${n}']`);
    const preencher = async (n, campo, valor) => { const c = linha(n).locator(`[data-campo=${campo}]`); await c.fill(valor); await c.dispatchEvent("input"); };
    for (const n of [1, 2, 3]) {
      await preencher(n, "data", dia);
      await linha(n).locator("[data-campo=barbeiroId]").selectOption({ label: "Rafael Barbeiro" });
      await linha(n).locator("[data-campo=servicoId]").selectOption({ label: "Corte masculino (30 min)" });
    }
    await preencher(1, "hora", "09:00"); await preencher(1, "nome", "Lote Um Fictício");
    await preencher(2, "hora", "10:00"); await preencher(2, "nome", "Lote Dois Fictício"); await preencher(2, "telefone", "11 95555-0102");   // cliente novo com telefone: falta o aceite LGPD
    await preencher(3, "hora", "25:99"); await preencher(3, "nome", "Lote Tres Fictício");   // hora inválida
    await page.click("button:has-text('+ Linha')");
    await preencher(4, "hora", ""); await preencher(4, "nome", "Lote Quatro Fictício"); await preencher(4, "telefone", "11 95555-0104");   // sem hora: só cadastrar (falta o aceite LGPD)
    assert.match(await page.textContent("[data-teste=enviar-lote]"), /Salvar 4 linhas/);
    await page.click("[data-teste=enviar-lote]");
    await page.waitForSelector("[data-teste=lote-resumo].com-erro");
    assert.match(await page.textContent("[data-teste=lote-resumo]"), /1 salvo\(s\)\. 3 com problema/);
    assert.ok((await linha(1).getAttribute("class")).includes("ok"));
    assert.match(await linha(2).locator(".lote-msg").textContent(), /LGPD/);
    assert.match(await linha(3).locator(".lote-msg").textContent(), /Hora inválida/);
    assert.match(await linha(4).locator(".lote-msg").textContent(), /LGPD/);
    await print("lote-com-erros");
    // corrige: aceite LGPD e hora certa → envia só as 2 que faltam
    await page.check("#c-loteLgpd");
    await preencher(3, "hora", "11:00");
    assert.match(await page.textContent("[data-teste=enviar-lote]"), /Salvar 3 linhas/);
    await page.click("[data-teste=enviar-lote]");
    await page.waitForSelector("[data-teste=lote-resumo].tudo-ok");
    assert.match(await page.textContent("[data-teste=lote-resumo]"), /Pronto: 3 salvo/);
    await print("lote-enviado");
    // na agenda do dia, os três estão lá
    await page.click("a:has-text('Ver na agenda')");
    await page.waitForSelector(".visoes-agenda");
    await pronto();
    await page.click(".visoes-agenda button:text-is('Dia')");
    await pronto();
    await page.fill(".data-agenda", dia);
    await page.locator(".data-agenda").dispatchEvent("change");
    await page.waitForSelector(".grade-agenda [data-evento='Lote Tres Fictício']");
    for (const nome of ["Lote Um Fictício", "Lote Dois Fictício"]) assert.equal(await page.locator(`.grade-agenda [data-evento='${nome}']`).count(), 1, nome);
    await print("lote-na-agenda");
    // a linha sem hora virou só cadastro de cliente
    await ir(page, "Clientes");
    await page.waitForSelector('[data-cliente="Lote Quatro Fictício"]');

    passo("caixa: cobra no crédito em 3x (mostra o valor da parcela) e depois corrige o valor do lançamento");
    await ir(page, "Caixa");
    await page.waitForSelector(".pdv-topo");
    await page.waitForSelector('button[data-cobrar="Diego Cliente Fictício"]');
    await page.click('button[data-cobrar="Diego Cliente Fictício"]');
    await page.waitForSelector("[data-teste=comanda-atendimento]");
    await forma(page, "credito");
    await page.waitForSelector("[data-teste=carrinho] [data-teste=parcelas]:not([hidden])");
    await page.selectOption("[data-teste=carrinho] #c-parcelas", "3");
    await page.waitForFunction(() => /3x de R\$\s?13,34/.test(document.querySelector("[data-teste=carrinho] [data-teste=parcelas-valor]")?.textContent || ""));
    assert.match(await page.textContent("[data-teste=carrinho] [data-teste=parcelas-valor]"), /no caixa entra R\$\s?40,00 no crédito/);
    await page.locator("[data-teste=carrinho] [data-teste=parcelas]").screenshot({ path: join(PRINTS, `${tela.nome}-${String(++n).padStart(2, "0")}-credito-3x.png`) });
    await page.click("[data-teste=carrinho] button:has-text('Finalizar venda')");
    await page.waitForSelector("text=Atendimento lançado");
    await lancamentos(page);
    await page.waitForSelector('[data-lancamento="Diego Cliente Fictício"] button:has-text("Corrigir")');
    await page.click('[data-lancamento="Diego Cliente Fictício"] button:has-text("Corrigir")');
    await page.click("dialog[open] [data-correcao=valor]");
    await page.waitForSelector("dialog[open] [data-teste=correcao-antes]");
    const valor = page.locator("dialog[open] [data-servico-final] input[inputmode=decimal]").first();
    await valor.fill("35,00"); await valor.dispatchEvent("input");
    await page.selectOption("dialog[open] #c-forma1", "dinheiro");
    await page.fill("dialog[open] #c-motivoCorrecao", "Valor combinado era 35");
    // quem atendeu também pode ser corrigido (gerente/caixa): troca para outro profissional livre
    const quem = page.locator("dialog[open] [data-teste=corrigir-quem]");
    await quem.waitFor();
    const atual = await quem.inputValue();
    const outros = await quem.locator("option").evaluateAll((os, a) => os.map(o => o.value).filter(v => v !== a), atual);
    assert.ok(outros.length >= 1, "há outro profissional para escolher");
    await quem.selectOption(outros[outros.length - 1]);
    // o cliente também pode ser corrigido: o campo mostra o cliente atual com "Trocar"
    await page.waitForSelector("dialog[open] [data-teste=corrigir-cliente] [data-teste=corr-cli-escolhido]");
    assert.match(await page.textContent("dialog[open] [data-teste=corrigir-cliente]"), /Diego Cliente Fictício/);
    await print("caixa-corrigir-valor");
    await page.click("dialog[open] button[type=submit]");
    await page.waitForSelector("text=Atendimento corrigido");
    await pronto();
    await page.waitForSelector("[data-lancamento='Diego Cliente Fictício'] [data-teste=lancamento-corrigido]");   // a lista recarrega depois do aviso
    const lancs = await page.locator("[data-lancamento='Diego Cliente Fictício']").allInnerTexts();
    assert.equal(lancs.length, 1, `só o lançamento certo aparece (sem estorno): ${lancs.join(" | ")}`);
    assert.ok(/R\$\s?35,00/.test(lancs[0]) && /Dinheiro/.test(lancs[0]) && /Corrigido: Valor combinado era 35/.test(lancs[0]) && !/estorno/i.test(lancs[0]), lancs[0]);
    assert.equal(await page.locator("[data-lancamento='Diego Cliente Fictício'] button:has-text('Corrigir')").count(), 1, "dá para corrigir de novo");
    await print("caixa-lancamento-corrigido");

    const reais = problemas.filter(p => !/status of 40[039]/.test(p));   // 400 esperado: linha do lote sem o aceite LGPD
    assert.deepEqual(reais, [], `erros no console: ${reais.join(" | ")}`);
    passo("relógio às 17:29 (minuto fora do passo de 5 min): a linha de agora fica entre 17:00 e 18:00 e a grade não prende a rolagem");
    {
      const p2 = await contexto.newPage();
      await p2.clock.setFixedTime(new Date(`${HOJE}T20:29:00Z`));   // 17:29 em São Paulo
      await p2.goto(`${base}/#/agenda`);
      await p2.waitForSelector(".grade-agenda .grade-agora");
      await p2.waitForFunction(() => !document.body.dataset.carregando);
      const info = await p2.evaluate(() => {
        const g = document.querySelector(".grade-rolagem");
        const linha = document.querySelector(".grade-agora").getBoundingClientRect().top;
        const horas = [...document.querySelectorAll(".grade-hora")].map(h => [h.textContent.trim(), h.getBoundingClientRect().top]);
        return { sobra: g.scrollHeight - g.clientHeight, oy: getComputedStyle(g).overflowY, linha, h17: horas.find(h => h[0] === "17:00")?.[1], h18: horas.find(h => h[0] === "18:00")?.[1] };
      });
      console.log("  medida:", JSON.stringify(info));
      assert.equal(info.oy, "hidden", "a grade só rola para o lado");
      assert.ok(info.sobra <= 1, `grade sem altura sobrando (${info.sobra}px)`);
      assert.ok(info.h17 !== undefined && info.linha > info.h17 && info.linha < info.h18, `linha de agora entre 17:00 e 18:00 (${JSON.stringify(info)})`);
      await p2.close();
    }
    passo("OK — nenhum erro no console (inclui bloqueios de CSP)");
  } finally {
    await navegador.close();
    servidor.kill();
  }
}

for (const tela of TELAS) await rodar(tela);
console.log("TESTE NO NAVEGADOR DA AGENDA: OK (computador 1366 px e celular 390 px)");
