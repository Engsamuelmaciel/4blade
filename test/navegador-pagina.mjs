// Teste no navegador: PÁGINA DA BARBEARIA (24/11/2026). Dados e fotos FICTÍCIOS (desenhos gerados aqui).
// Gerente monta a página (fotos, textos, contato, serviços, equipe, horários livres, endereço), publica, baixa o QR Code,
// abre o link público (escolhe 2 serviços → WhatsApp com a mensagem certa, amplia foto) e tira do ar.
// Roda em computador (1366 px) e celular (390 px); prints em docs/prints/pagina/.  Uso: node test/navegador-pagina.mjs
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import sharp from "sharp";
import { ir, acao } from "./navegacao.mjs";

const { chromium } = createRequire(import.meta.url)("playwright");
const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
const PRINTS = join(RAIZ, "docs", "prints", "pagina");
mkdirSync(PRINTS, { recursive: true });
const SENHA = "Senha-Semana-2026";
const FOTOS = join(tmpdir(), "4blade-pagina-fotos");
mkdirSync(FOTOS, { recursive: true });

// Fotos fictícias (desenhos simples): capa larga, logo quadrada e 4 da galeria.
async function desenho(nome, largura, altura, svgCorpo) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${largura}" height="${altura}">${svgCorpo}</svg>`;
  const arq = join(FOTOS, nome);
  writeFileSync(arq, await sharp(Buffer.from(svg)).jpeg({ quality: 88 }).toBuffer());
  return arq;
}
const capa = await desenho("capa.jpg", 1600, 900, `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#3a2a1c"/><stop offset="1" stop-color="#0f0d0c"/></linearGradient></defs>
  <rect width="1600" height="900" fill="url(#g)"/><rect x="120" y="120" width="420" height="660" rx="24" fill="#5b4330"/><rect x="160" y="170" width="340" height="300" rx="16" fill="#d9c7a6" opacity=".55"/>
  <circle cx="1180" cy="330" r="170" fill="#e0a330" opacity=".85"/><rect x="900" y="560" width="560" height="40" rx="20" fill="#e0a330" opacity=".6"/>
  <rect x="700" y="640" width="180" height="200" rx="18" fill="#7a2e1d"/><rect x="660" y="600" width="260" height="60" rx="30" fill="#9b3d27"/>`);
const logo = await desenho("logo.jpg", 512, 512, `<rect width="512" height="512" fill="#1f2328"/><circle cx="256" cy="256" r="210" fill="none" stroke="#e0a330" stroke-width="18"/>
  <text x="256" y="300" font-family="Arial" font-weight="bold" font-size="150" fill="#e0a330" text-anchor="middle">SF</text>`);
const galeria = [];
for (const [i, cor, txt] of [[1, "#7a4a2a", "Degradê"], [2, "#2f3b4a", "Barba"], [3, "#5a2d4a", "Ambiente"], [4, "#2e4a3a", "Pigmentação"]]) {
  galeria.push(await desenho(`galeria-${i}.jpg`, 1200, 1200, `<rect width="1200" height="1200" fill="${cor}"/><circle cx="600" cy="520" r="280" fill="#ffffff" opacity=".15"/>
    <text x="600" y="1000" font-family="Arial" font-weight="bold" font-size="110" fill="#ffffff" text-anchor="middle">${txt}</text>`));
}

const TELAS = [
  { nome: "computador", largura: 1366, altura: 768, movel: false, porta: 8871 },
  { nome: "celular", largura: 390, altura: 844, movel: true, porta: 8872 }
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
    deviceScaleFactor: 2, isMobile: tela.movel, hasTouch: tela.movel, locale: "pt-BR", timezoneId: "America/Sao_Paulo", acceptDownloads: true
  });
  const page = await contexto.newPage();
  const problemas = [];
  const vigiar = pg => {
    pg.on("console", m => { if (m.type() === "error" && !/status of 40[349]/.test(m.text())) problemas.push(m.text()); });
    pg.on("pageerror", e => problemas.push(e.message));
  };
  vigiar(page);
  let n = 0;
  const pronto = () => page.waitForFunction(() => !document.body.dataset.carregando);
  const print = async (nome, { inteira = true, pg = page } = {}) => {
    n++;
    const arq = `${tela.nome}-${String(n).padStart(2, "0")}-${nome}.png`;
    await pg.waitForTimeout(300);
    if (inteira) await pg.evaluate(() => window.scrollTo(0, 0));
    await pg.screenshot({ path: join(PRINTS, arq), fullPage: inteira });
    const texto = await pg.locator("body").innerText();
    assert.ok(!/\bnull\b|\bundefined\b|NaN/.test(texto), `texto estranho na tela ${nome}`);
    console.log(`  print: docs/prints/pagina/${arq}`);
  };
  const passo = t => console.log(`[${tela.nome}] ${t}`);
  const ok = () => page.click("dialog[open] button[type=submit]");
  const abrirSecao = async id => {
    const d = page.locator(`[data-secao-pagina=${id}]`);
    if (await d.getAttribute("open") === null) await d.locator(":scope > summary").click();
    return d;
  };
  const enviarArquivos = async (botao, arquivos) => {
    const [escolha] = await Promise.all([page.waitForEvent("filechooser"), botao.click()]);
    await escolha.setFiles(arquivos);
    await page.waitForFunction(() => !document.body.dataset.carregando);
    await page.waitForSelector("text=/fotos? enviadas?|Foto enviada/");
    await pronto();
  };

  try {
    passo("gerente abre Minha página: nasce como rascunho com o endereço sugerido pelo nome");
    await page.goto(`${base}/#/entrar`);
    await page.waitForSelector("#c-login");
    await page.fill("#c-login", "gerente.semana");
    await page.fill("#c-senha", SENHA);
    await page.click("button:has-text('Entrar')");
    await page.waitForFunction(() => document.querySelector("#menu:not([hidden]) .grupo"));
    await pronto();
    await ir(page, "Minha página");
    await page.waitForSelector("[data-teste=mp-topo]");
    assert.match(await page.textContent("[data-teste=mp-situacao]"), /Rascunho/);
    assert.match(await page.textContent("[data-teste=mp-link]"), /\/barbearia-semana-ficticia$/);
    await print("minha-pagina-inicio");

    passo("envia logo, capa e 4 fotos da galeria (reduzidas no aparelho)");
    let sec = await abrirSecao("fotos");
    await enviarArquivos(sec.locator('[data-foto-tipo=logo] button:has-text("Enviar")'), [logo]);
    sec = await abrirSecao("fotos");
    await enviarArquivos(sec.locator('[data-foto-tipo=capa] button:has-text("Enviar")'), [capa]);
    sec = await abrirSecao("fotos");
    await enviarArquivos(sec.locator('button:has-text("+ Adicionar fotos")'), galeria);
    await page.waitForSelector("[data-teste=mp-galeria] [data-galeria='3']");
    assert.equal(await page.locator("[data-foto-tipo=logo] img").count(), 1);
    await print("fotos-enviadas");

    passo("textos e tema");
    sec = await abrirSecao("textos");
    await sec.locator("[name=frase]").fill("Corte de respeito desde 2012.");
    await sec.locator("[name=sobre]").fill("Barbearia de bairro, com atendimento sem pressa, café passado na hora e profissionais que entendem de degradê, barba e pigmentação.");
    await sec.locator('[data-tema-pagina="classico"]').click();
    await sec.locator('button:has-text("Salvar textos e tema")').click();
    await page.waitForSelector("text=Salvo.");
    await pronto();

    passo("contato e endereço (fictícios)");
    sec = await abrirSecao("contato");
    await sec.locator("[name=whatsapp]").fill("11900000000");
    await sec.locator("[name=instagram]").fill("@barbeariasemana");
    await sec.locator("[name=endRua]").fill("Rua Exemplo");
    await sec.locator("[name=endNumero]").fill("123");
    await sec.locator("[name=endBairro]").fill("Centro");
    await sec.locator("[name=endCep]").fill("01000-000");
    await sec.locator("[name=endCidade]").fill("São Paulo");
    await sec.locator("[name=endUf]").fill("SP");
    await sec.locator("#mp-forma-pix").check();
    await sec.locator("#mp-forma-cartao").check();
    await sec.locator("#mp-forma-dinheiro").check();
    await sec.locator('button:has-text("Salvar contato e endereço")').click();
    await page.waitForSelector("text=Salvo.");
    await pronto();

    passo("serviços: descrição curta; equipe: Ana e Beto com especialidade; horários livres ligados");
    sec = await abrirSecao("servicos");
    await sec.locator('[data-servico-pagina="Barba"] .mp-descricao').fill("Toalha quente e navalha");
    await sec.locator('button:has-text("Salvar serviços")').click();
    await page.waitForSelector("text=Salvo.");
    await pronto();
    sec = await abrirSecao("equipe");
    for (const [nome, esp] of [["Ana Barbeira", "Degradê e desenhos"], ["Beto Barbeiro", "Barba e pigmentação"]]) {
      await sec.locator(`[data-equipe-pagina="${nome}"] input[type=checkbox]`).check();
      await sec.locator(`[data-equipe-pagina="${nome}"] .mp-descricao`).fill(esp);
    }
    await sec.locator('button:has-text("Salvar equipe")').click();
    await page.waitForSelector("text=Salvo.");
    await pronto();
    sec = await abrirSecao("horarios");
    await sec.locator("#mp-horarios").check();
    await sec.locator('button:has-text("Salvar")').click();
    await page.waitForSelector("text=Salvo.");
    await pronto();

    passo("endereço do link: reservado é recusado; troca para um livre");
    sec = await abrirSecao("endereco");
    await sec.locator("#mp-slug").fill("api");
    await page.waitForSelector("#mp-slug-aviso:has-text('reservado')");
    await sec.locator("#mp-slug").fill("semana-ficticia");
    await page.waitForSelector("#mp-slug-aviso:has-text('Livre')");
    await sec.locator('button:has-text("Salvar endereço")').click();
    await page.waitForSelector("text=/Endereço alterado/");
    await pronto();
    assert.match(await page.textContent("[data-teste=mp-link]"), /\/semana-ficticia$/);

    passo("publica e baixa o QR Code");
    await page.click("[data-teste=mp-topo] button:has-text('Publicar')");
    await page.waitForSelector("[data-teste=mp-situacao]:has-text('No ar')");
    await pronto();
    await print("minha-pagina-publicada");
    const [download] = await Promise.all([page.waitForEvent("download"), acao(page, "[data-teste=mp-topo]", 'button:has-text("Baixar QR Code")')]);
    const qrArq = join(PRINTS, `${tela.nome}-qrcode.png`);
    await download.saveAs(qrArq);
    const meta = await sharp(readFileSync(qrArq)).metadata();
    assert.equal(meta.format, "png");
    assert.ok(meta.width > 300);
    console.log(`  QR Code: docs/prints/pagina/${tela.nome}-qrcode.png (${meta.width}x${meta.height})`);

    // Catálogo grande (como o da foto do responsável): +6 serviços → 8 no total; a página mostra 6 e o resto em "Ver mais"
    await page.evaluate(async () => {
      const t = localStorage.getItem("4blade.token");
      for (const [nome, preco, dur] of [["Corte degradê", 4000, 30], ["Corte social", 3500, 30], ["Corte e barba", 6000, 60], ["Pigmentação", 3000, 30], ["Sobrancelha", 1500, 15], ["Progressiva", 9000, 90]]) {
        await fetch("/api/servicos", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${t}` }, body: JSON.stringify({ nome, precoCentavos: preco, duracaoMin: dur }) });
      }
    });

    passo("abre o link público: capa, serviços, horários, fotos, equipe, endereço; escolhe 2 serviços → WhatsApp");
    const pub = await contexto.newPage();
    vigiar(pub);
    // O Google Maps não abre neste ambiente de teste: o mapa é trocado por uma imitação (no celular de verdade carrega o mapa)
    await pub.route("https://maps.google.com/**", r => r.fulfill({ contentType: "text/html; charset=utf-8",
      body: "<html><body style='margin:0;display:grid;place-items:center;height:100vh;background:#cfe3d4;font:16px sans-serif'>MAPA (imitação do Google Maps)</body></html>" }));
    await pub.goto(`${base}/semana-ficticia`);
    await pub.waitForSelector("h1:has-text('Barbearia Semana Fictícia')");
    assert.match(await pub.textContent(".pg-frase"), /Corte de respeito desde 2012/);
    assert.equal(await pub.locator(".pg-galeria li").count(), 4);
    assert.equal(await pub.locator(".pg-pessoa").count(), 2);
    assert.match(await pub.textContent(".pg-equipe"), /Degradê e desenhos/);
    assert.ok(await pub.locator("text=Horários livres").count());
    assert.match(await pub.textContent(".pg-local"), /Rua Exemplo, 123/);
    const mapa = pub.locator(".pg-mapa iframe");
    assert.match(await mapa.getAttribute("src"), /^https:\/\/maps\.google\.com\/maps\?q=Rua%20Exemplo%2C%20123.*output=embed$/);
    const caixaMapa = await mapa.boundingBox();
    assert.ok(caixaMapa.height > 150 && caixaMapa.width > 300, `mapa visível (${JSON.stringify(caixaMapa)})`);
    await pub.locator(".pg-mapa").scrollIntoViewIfNeeded();
    await pub.evaluate(() => window.scrollBy(0, 120));
    await pub.waitForFunction(() => document.querySelector(".pg-mapa iframe")?.contentDocument?.body?.textContent.includes("MAPA") ?? true);
    await print("pagina-localizacao-mapa", { inteira: false, pg: pub });
    assert.match(await pub.textContent(".pg-servicos"), /Toalha quente e navalha/);
    assert.equal(await pub.locator(".pg-secao > .pg-servicos > .pg-servico").count(), 6, "catálogo enxuto: 6 à vista");
    assert.match(await pub.textContent(".pg-mais > summary"), /Ver mais 2 serviços/);
    assert.equal(await pub.locator(".pg-servicos a:has-text('Agendar')").count(), 0, "sem um botão Agendar por linha");
    const yGaleria = await pub.locator("#t-gal").evaluate(e => e.getBoundingClientRect().top + window.scrollY);
    const yServ = await pub.locator("#t-serv").evaluate(e => e.getBoundingClientRect().top + window.scrollY);
    console.log(`  distância Serviços → Fotos: ${Math.round(yGaleria - yServ)} px`);
    assert.equal(await pub.locator(".pg-dia details[open]").count(), 1, "só o primeiro dia de horários aberto");
    await pub.evaluate(() => document.querySelectorAll("img[loading=lazy]").forEach(i => { i.loading = "eager"; }));
    await pub.waitForFunction(() => [...document.images].filter(i => i.getAttribute("src")).every(i => i.complete && i.naturalWidth > 0));
    await pub.evaluate(() => Promise.all([...document.images].filter(i => i.getAttribute("src")).map(i => i.decode().catch(() => null))));
    await print("pagina-publica", { pg: pub });
    await pub.click('[data-nome="Corte"] .pg-escolher');
    await pub.click('[data-nome="Barba"] .pg-servico-txt');   // tocar na linha também escolhe
    await pub.waitForSelector("#pg-escolhidos:not([hidden])");
    assert.match(await pub.textContent("#pg-escolhidos"), /2 serviços escolhidos · R\$ 70,00 · 1h/);
    const href = decodeURIComponent((await pub.getAttribute("#pg-solicitar", "href")).split("?text=")[1]);
    assert.equal(href, "Olá, Barbearia Semana Fictícia! Vim pela sua página e quero agendar: Barba + Corte (R$ 70,00, 1h). Qual horário vocês têm?");
    assert.match(await pub.getAttribute("#pg-solicitar", "href"), /^https:\/\/wa\.me\/5511900000000\?text=/);
    await pub.click(".pg-mais > summary");
    await pub.waitForSelector(".pg-mais[open] [data-nome='Progressiva']");
    await pub.locator("#t-serv").scrollIntoViewIfNeeded();
    await pub.evaluate(() => window.scrollBy(0, -20));
    await print("pagina-publica-servicos-escolhidos", { inteira: false, pg: pub });
    await pub.click(".pg-foto >> nth=0");
    await pub.waitForSelector("#pg-ampliar[open]");
    await print("pagina-publica-foto-ampliada", { inteira: false, pg: pub });
    await pub.click("#pg-ampliar .pg-fechar");

    passo("tira do ar: o link mostra a página neutra");
    await page.click("[data-teste=mp-topo] button:has-text('Tirar do ar')");
    await page.waitForSelector("[data-teste=mp-situacao]:has-text('Rascunho')");
    await pub.goto(`${base}/semana-ficticia`);
    await pub.waitForSelector("text=Esta página não está disponível no momento.");
    await print("pagina-fora-do-ar", { pg: pub });
    await pub.close();

    assert.deepEqual(problemas, [], `erros no console (CSP etc.): ${problemas.join(" | ")}`);
    passo("OK — nenhum erro no console (inclui bloqueios de CSP)");
  } finally {
    await navegador.close();
    servidor.kill();
  }
}

for (const tela of TELAS) await rodar(tela);
console.log("TESTE NO NAVEGADOR DA PÁGINA DA BARBEARIA: OK (computador 1366 px e celular 390 px)");
