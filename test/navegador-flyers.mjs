// Teste no navegador: DIVULGAÇÃO / FLYERS (25/11/2026). Dados e fotos FICTÍCIOS (desenhos gerados aqui).
// Gerente coloca a logo (Minha página) e vê no Início; abre Atendimento → Divulgação: modelos prontos (marcar horário,
// promoção, aviso…), 12 estilos, 3 formatos, foto com efeito e zoom, logo e WhatsApp no flyer; publica, compartilha,
// abre o link público (?promo=) e tira do catálogo. Computador (1366 px) e celular (390 px); prints em docs/prints/flyers/.
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import sharp from "sharp";
import { ir } from "./navegacao.mjs";

const { chromium } = createRequire(import.meta.url)("playwright");
const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
const PRINTS = join(RAIZ, "docs", "prints", "flyers");
mkdirSync(PRINTS, { recursive: true });
const SENHA = "Senha-Semana-2026";
const PASTA = join(tmpdir(), "4blade-flyers-fotos");
mkdirSync(PASTA, { recursive: true });

// Foto fictícia (desenho): cadeira de barbeiro estilizada.
const foto = join(PASTA, "foto.jpg");
writeFileSync(foto, await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1500">
  <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#6b4a33"/><stop offset="1" stop-color="#1b1411"/></linearGradient></defs>
  <rect width="1200" height="1500" fill="url(#g)"/><circle cx="600" cy="480" r="230" fill="#e9c9a3"/><path d="M370 470 Q600 160 830 470 Q780 330 600 320 Q420 330 370 470z" fill="#1d1d1d"/>
  <path d="M430 600 Q600 820 770 600 Q760 760 600 800 Q440 760 430 600z" fill="#2a2a2a"/><rect x="260" y="820" width="680" height="560" rx="80" fill="#f2f2f2"/>
  <rect x="200" y="1180" width="800" height="120" rx="40" fill="#8b1e1e"/><circle cx="980" cy="260" r="60" fill="#e0a330" opacity=".8"/></svg>`)).jpeg({ quality: 88 }).toBuffer());

const TELAS = [
  { nome: "computador", largura: 1366, altura: 768, movel: false, porta: 8881 },
  { nome: "celular", largura: 390, altura: 844, movel: true, porta: 8882 }
];
const ESTILOS = ["moderno", "contemporaneo", "retro", "vintage", "neon", "luxo", "urbano", "editorial", "minimal", "giz", "tropical", "polaroid"];
const MODELOS = ["marque-horario", "vagas-hoje", "fim-de-semana", "promocao", "combo", "primeira-vez", "indique", "novidade", "barbeiro", "feriado", "dia-dos-pais", "contratando"];
const logoArq = join(PASTA, "logo.jpg");
writeFileSync(logoArq, await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512"><rect width="512" height="512" fill="#1f2328"/>
  <circle cx="256" cy="256" r="200" fill="none" stroke="#e0a330" stroke-width="20"/><text x="256" y="300" font-family="Arial" font-weight="bold" font-size="150" fill="#e0a330" text-anchor="middle">BF</text></svg>`)).jpeg().toBuffer());
// quadro com várias prévias lado a lado (para mostrar ao responsável)
async function quadro(arquivos, colunas, nome) {
  const w = 300, h = 533, m = 16;
  const imgs = await Promise.all(arquivos.map(a => sharp(a).resize(w, h, { fit: "cover" }).toBuffer()));
  const linhas = Math.ceil(imgs.length / colunas);
  await sharp({ create: { width: colunas * w + (colunas + 1) * m, height: linhas * h + (linhas + 1) * m, channels: 3, background: "#e9e6e1" } })
    .composite(imgs.map((b, i) => ({ input: b, left: m + (i % colunas) * (w + m), top: m + Math.floor(i / colunas) * (h + m) })))
    .png().toFile(join(PRINTS, nome));
  console.log(`  print: docs/prints/flyers/${nome}`);
}

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
    deviceScaleFactor: 2, isMobile: tela.movel, hasTouch: tela.movel, locale: "pt-BR", timezoneId: "America/Sao_Paulo", acceptDownloads: true
  });
  await contexto.route(/maps\.google\.com/, r => r.fulfill({ status: 200, contentType: "text/html", body: "<p>mapa</p>" }));
  const page = await contexto.newPage();
  const problemas = [];
  const vigiar = pg => {
    pg.on("console", m => { if (m.type() === "error" && !/status of 40[349]/.test(m.text())) problemas.push(m.text()); });
    pg.on("pageerror", e => problemas.push(e.message));
  };
  vigiar(page);
  let n = 0;
  const pronto = () => page.waitForFunction(() => !document.body.dataset.carregando);
  const print = async (nome, { inteira = true, pg = page, alvo = null } = {}) => {
    n++;
    const arq = `${tela.nome}-${String(n).padStart(2, "0")}-${nome}.png`;
    await pg.waitForTimeout(300);
    if (alvo) { await pg.evaluate(() => { document.getElementById("aviso").hidden = true; }); await pg.locator(alvo).screenshot({ path: join(PRINTS, arq) }); }
    else {
      if (inteira) await pg.evaluate(() => window.scrollTo(0, 0));
      await pg.screenshot({ path: join(PRINTS, arq), fullPage: inteira });
    }
    const texto = await pg.locator("body").innerText();
    assert.ok(!/\bnull\b|\bundefined\b|NaN/.test(texto), `texto estranho na tela ${nome}`);
    console.log(`  print: docs/prints/flyers/${arq}`);
    return join(PRINTS, arq);
  };
  const passo = t => console.log(`[${tela.nome}] ${t}`);
  const previaCom = (estilo, formato) => page.waitForFunction(([e, f]) => {
    const c = document.querySelector("[data-teste=flyer-previa]");
    return c && c.dataset.estilo === e && c.dataset.formato === f && c.width > 100;
  }, [estilo, formato]);

  try {
    passo("gerente entra, liga o WhatsApp e publica a página");
    await page.goto(`${base}/#/entrar`);
    await page.waitForSelector("#c-login");
    await page.fill("#c-login", "gerente.semana");
    await page.fill("#c-senha", SENHA);
    await page.click("button:has-text('Entrar')");
    await page.waitForFunction(() => document.querySelector("#menu:not([hidden]) .grupo") || document.querySelector("#nav-topo"));
    await pronto();
    await ir(page, "Minha página");
    await page.waitForSelector("[data-teste=mp-topo]");
    const sec = page.locator("[data-secao-pagina=contato]");
    if (await sec.getAttribute("open") === null) await sec.locator(":scope > summary").click();
    await sec.locator("[name=whatsapp]").fill("11900000000");
    await sec.locator('button:has-text("Salvar contato e endereço")').click();
    await page.waitForSelector("text=Salvo.");
    await pronto();
    await page.click('[data-teste=mp-topo] button:has-text("Publicar")');
    await page.waitForSelector("[data-teste=mp-situacao]:has-text('No ar')");
    await pronto();
    passo("abre Atendimento → Divulgação: começa pelo modelo \"Marque seu horário\" (sem preço)");
    await ir(page, "Divulgação");
    await page.waitForSelector("[data-teste=flyer-previa]");
    await previaCom("moderno", "story");
    assert.equal(await page.inputValue("#fl-titulo"), "Marque já seu horário");
    assert.equal(await page.inputValue("#fl-precoPor"), "");
    assert.equal(await page.locator("[data-estilo-flyer]").count(), 12, "12 estilos");
    assert.equal(await page.locator("[data-formato-flyer]").count(), 3, "3 formatos");
    assert.equal(await page.locator("[data-modelo-flyer]").count(), 12, "12 modelos");
    passo("sem logo ainda: envia a logo pela própria Divulgação");
    await page.waitForSelector("[data-teste=logo-flyer] button:has-text('Enviar minha logo')");
    await print("logo-ainda-nao-enviada", { alvo: "[data-teste=logo-flyer]" });
    const [escLogo] = await Promise.all([page.waitForEvent("filechooser"), page.click("[data-teste=logo-flyer] button:has-text('Enviar minha logo')")]);
    await escLogo.setFiles([logoArq]);
    await page.waitForSelector("[data-teste=logo-flyer] .fl-logo-amostra");
    await pronto();
    assert.equal(await page.getAttribute("[data-logo-flyer=sim]", "aria-checked"), "true", "com logo depois de enviar");
    await print("logo-com-ou-sem", { alvo: "[data-teste=logo-flyer]" });

    passo("Início mostra a logo da barbearia e as boas-vindas");
    await ir(page, "Início");
    await page.waitForSelector("[data-teste=boas-vindas] [data-teste=logo-barbearia]");
    await page.waitForFunction(() => document.querySelector("[data-teste=logo-barbearia]").naturalWidth > 0);
    await print("inicio-com-logo", { inteira: false });
    await ir(page, "Divulgação");
    await page.waitForSelector("[data-teste=flyer-previa]");
    assert.equal(await page.inputValue("#fl-titulo"), "Marque já seu horário", "o editor guarda o que estava");
    await page.click("[data-logo-flyer=nao]");
    assert.equal(await page.getAttribute("[data-logo-flyer=nao]", "aria-checked"), "true");
    await page.click("[data-logo-flyer=sim]");
    assert.ok(await page.isChecked("#fl-whats"), "WhatsApp ligado no modelo de marcar");
    await page.click("[data-objetivo=marcar]");
    assert.equal(await page.locator("[data-modelo-flyer]").count(), 3, "filtro: marcar horário");
    await page.click("[data-objetivo=todos]");
    await page.waitForTimeout(500);
    await print("gerador-inicio");

    passo("escolhe a foto, efeito preto e branco e aproxima");
    const [escolha] = await Promise.all([page.waitForEvent("filechooser"), page.click("button:has-text('Escolher foto do celular')")]);
    await escolha.setFiles([foto]);
    await page.waitForSelector("[data-teste=flyer-foto-nome]");
    await page.click("[data-filtro-foto=pb]");
    await page.locator("#fl-zoom").fill("140");
    await page.waitForTimeout(400);

    passo("os 12 modelos prontos (cada um com seu estilo e texto)");
    const modelosPrints = [];
    for (const m of MODELOS) {
      await page.click(`[data-modelo-flyer=${m}]`);
      await page.waitForSelector(`[data-modelo-flyer=${m}].ativo`);
      const est = await page.evaluate(() => document.querySelector("[data-estilo-flyer].ativo").dataset.estiloFlyer);
      await previaCom(est, "story");
      if (!tela.movel) modelosPrints.push(await print(`modelo-${m}`, { alvo: "[data-teste=flyer-previa]" }));
    }
    if (!tela.movel) await quadro(modelosPrints, 6, "quadro-12-modelos.png");
    assert.equal(await page.inputValue("#fl-titulo"), "Procuramos barbeiro");

    passo("modelo Promoção, editado: serviço, preço e chamada");
    await page.click("[data-modelo-flyer=promocao]");
    await page.waitForSelector("[data-modelo-flyer=promocao].ativo");
    await page.selectOption("#fl-servico", { index: 1 });
    assert.notEqual(await page.inputValue("#fl-titulo"), "");
    assert.notEqual(await page.inputValue("#fl-precoDe"), "");
    await page.fill("#fl-titulo", "Corte + barba");
    await page.fill("#fl-precoPor", "49,90");
    await page.fill("#fl-detalhe", "Terça e quarta · agende pelo WhatsApp");
    await page.click("[data-chamada='Semana especial']");
    assert.equal(await page.inputValue("#fl-chamada"), "Semana especial");
    await page.waitForTimeout(400);

    passo("os 12 estilos (story) renderizam sem erro");
    const estilosPrints = [];
    for (const e of ESTILOS) {
      await page.click(`[data-estilo-flyer=${e}]`);
      await previaCom(e, "story");
      if (!tela.movel) estilosPrints.push(await print(`estilo-${e}`, { alvo: "[data-teste=flyer-previa]" }));
    }
    if (!tela.movel) await quadro(estilosPrints, 6, "quadro-12-estilos.png");

    passo("formatos quadrado e retrato");
    await page.click("[data-estilo-flyer=retro]");
    await page.click("[data-formato-flyer=quadrado]");
    await previaCom("retro", "quadrado");
    const dims = await page.evaluate(() => { const c = document.querySelector("[data-teste=flyer-previa]"); return [c.width, c.height]; });
    assert.deepEqual(dims, [540, 540]);
    if (!tela.movel) await print("retro-quadrado", { alvo: "[data-teste=flyer-previa]" });
    await page.click("[data-formato-flyer=retrato]");
    await previaCom("retro", "retrato");
    if (!tela.movel) await print("retro-retrato", { alvo: "[data-teste=flyer-previa]" });

    passo("volta para Story + Luxo, cor dourada, e publica no catálogo");
    await page.click("[data-formato-flyer=story]");
    await page.click("[data-estilo-flyer=luxo]");
    await page.click("[data-cor='#d4af37']");
    await previaCom("luxo", "story");
    await print("gerador-preenchido");
    await page.click("[data-teste=publicar-flyer]");
    await page.waitForSelector("dialog[open] [data-teste=compartilhar-flyer]");
    const whats = await page.getAttribute("[data-teste=flyer-whats]", "href");
    const textoWhats = decodeURIComponent(whats.split("text=")[1]);
    assert.match(textoWhats, /Corte \+ barba/);
    const linkPromo = textoWhats.match(/https?:\/\/\S+\?promo=[\w-]+/)?.[0];
    assert.ok(linkPromo, "link da promoção na mensagem");
    assert.ok(linkPromo.startsWith(`${base}/barbearia-semana-ficticia?promo=`));
    await print("compartilhar", { inteira: false });
    await page.click("dialog[open] button[type=submit]");
    await page.waitForSelector("[data-teste=flyers-lista] [data-flyer='Corte + barba']");
    assert.match(await page.textContent("[data-flyer='Corte + barba'] [data-teste=flyer-situacao]"), /No catálogo/);
    await print("lista-flyers");

    passo("baixar imagem gera um JPG");
    const [baixa] = await Promise.all([page.waitForEvent("download"), page.click(".fl-botoes button:has-text('Baixar imagem')")]);
    assert.match(baixa.suggestedFilename(), /\.jpg$/);

    passo("link público da promoção: aparece em destaque, com o flyer na prévia do WhatsApp");
    const pub = await contexto.newPage();
    vigiar(pub);
    await pub.goto(linkPromo);
    await pub.waitForSelector(".pg-promo.destaque img");
    const og = await pub.getAttribute('meta[property="og:image"]', "content");
    assert.match(og, /\/f\/[\w-]+$/);
    const ogTitulo = await pub.getAttribute('meta[property="og:title"]', "content");
    assert.match(ogTitulo, /^Corte \+ barba — /);
    const carregou = await pub.evaluate(() => { const i = document.querySelector(".pg-promo.destaque img"); return i.complete && i.naturalWidth; });
    assert.equal(carregou, 1080);
    const queroHref = await pub.getAttribute(".pg-promo.destaque .pg-promo-whats", "href");
    assert.match(decodeURIComponent(queroHref), /Vi "Corte \+ barba" na sua página/);
    await pub.waitForTimeout(400);
    await pub.screenshot({ path: join(PRINTS, `${tela.nome}-${String(++n).padStart(2, "0")}-pagina-promocao.png`), fullPage: false });
    console.log(`  print: docs/prints/flyers/${tela.nome}-${String(n).padStart(2, "0")}-pagina-promocao.png`);
    await pub.click(".pg-promo.destaque .pg-foto");
    await pub.waitForSelector("#pg-ampliar[open] img");
    await pub.close();

    passo("tira do catálogo: some da página pública");
    await page.click("[data-flyer='Corte + barba'] [data-grupo=mais]");
    await page.click("[data-flyer='Corte + barba'] button:has-text('Tirar do catálogo')");
    await page.waitForSelector("[data-flyer='Corte + barba'] [data-teste=flyer-situacao]:has-text('Fora do catálogo')");
    const html = await (await fetch(`${base}/barbearia-semana-ficticia`)).text();
    assert.ok(!/class="pg-promo/.test(html), "sem promoções na página depois de tirar");

    assert.deepEqual(problemas, [], `erros no navegador: ${problemas.join(" | ")}`);
    passo("OK");
  } finally {
    await navegador.close();
    servidor.kill();
  }
}

for (const t of TELAS) await rodar(t);
console.log("Flyers no navegador: tudo certo.");
