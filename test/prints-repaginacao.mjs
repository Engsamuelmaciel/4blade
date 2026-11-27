// Prints da repaginação visual (docs/PROMPT-REPAGINACAO.md). Dados FICTÍCIOS (npm run demo).
// Uso: node test/prints-repaginacao.mjs <pasta-de-saída> [--ganache]
// Gera telas-chave de cada perfil em navalha claro/escuro (e ganache, se pedido), 390 e 1366 px,
// + Caixa a 1100 e 960 px e telas de celular a 360 px. Também confere: sem rolagem lateral, sem erro no console, sem style="".
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ir } from "./navegacao.mjs";

const { chromium } = createRequire(import.meta.url)("playwright");
const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
const SAIDA = resolve(process.argv[2] || join(RAIZ, "docs", "prints", "repaginacao", "tmp"));
const GANACHE = process.argv.includes("--ganache");
const SENHA = "Demo-4blade-2026";
const PORTA = 8799;
mkdirSync(SAIDA, { recursive: true });

const proc = spawn(process.execPath, ["--no-warnings", join(RAIZ, "test", "servidor-local.mjs"), String(PORTA), "--demo"], { stdio: ["ignore", "pipe", "inherit"] });
await new Promise((ok, falha) => {
  proc.stdout.on("data", d => { if (String(d).includes("demonstração pronta")) ok(); });
  proc.on("exit", c => falha(new Error(`servidor saiu (${c})`)));
});
const base = `http://localhost:${PORTA}`;
const navegador = await chromium.launch();
const problemas = [];

// [perfil, login, telas[], larguras]
const TELAS = [
  ["gerente", "gerente.demo", ["Início", "Mensagens", "Agenda", "Caixa", "novo-horario"], [390, 1366]],
  ["barbeiro", "barbeiro.demo", ["Início", "Agenda", "novo-horario"], [360, 390, 1366]],
  ["caixa", "caixa.demo", ["Hoje", "Caixa"], [390, 960, 1100, 1366]]
];
const TEMAS = [["navalha", "claro"], ["navalha", "escuro"], ...(GANACHE ? [["ganache", "claro"], ["ganache", "escuro"]] : [])];
const slug = s => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-");

async function sessao(login, largura, paleta, modo) {
  const movel = largura < 700;
  const contexto = await navegador.newContext({ viewport: { width: largura, height: movel ? 844 : 768 }, deviceScaleFactor: 1, isMobile: movel, hasTouch: movel, locale: "pt-BR" });
  await contexto.addInitScript(([p, m]) => { try { localStorage.setItem("4blade.aparencia", JSON.stringify({ paleta: p, modo: m })); } catch { /* */ } }, [paleta, modo]);
  const page = await contexto.newPage();
  page.on("console", m => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) problemas.push(`${login} ${largura}: ${m.text()}`); });
  page.on("pageerror", e => problemas.push(`${login} ${largura}: ${e.message}`));
  await page.goto(`${base}/#/entrar`);
  await page.fill("#c-login", login); await page.fill("#c-senha", SENHA);
  await page.click("button:has-text('Entrar')");
  await page.waitForFunction(() => !document.body.dataset.carregando && !location.hash.includes("entrar"));
  await page.waitForTimeout(300);
  return { contexto, page };
}

async function conferir(page, nome) {
  const r = await page.evaluate(() => ({
    lateral: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    estilos: document.querySelectorAll("#app [style]:not(.grade-evento):not([class*=grade]):not(svg *)").length
  }));
  if (r.lateral > 1) problemas.push(`${nome}: rolagem lateral de ${r.lateral}px`);
}

for (const [perfil, login, telas, larguras] of TELAS) {
  for (const [paleta, modo] of TEMAS) {
    for (const largura of larguras) {
      // ganache e 360/960 px: só o essencial
      if (paleta === "ganache" && ![390, 1366].includes(largura)) continue;
      const { contexto, page } = await sessao(login, largura, paleta, modo);
      for (const tela of telas) {
        if (perfil === "caixa" && tela === "Hoje" && [960, 1100].includes(largura)) continue;
        if (largura === 360 && tela === "novo-horario") continue;
        const nome = `${slug(tela)}-${perfil}-${largura}px-${paleta}-${modo}`;
        try {
          if (tela === "novo-horario") {
            await ir(page, "Agenda");
            await page.click("button:has-text('+ Novo horário')");
            await page.waitForSelector("dialog[open]");
            await page.waitForTimeout(350);
            await page.screenshot({ path: join(SAIDA, `${nome}.jpg`), quality: 82 });
            await page.keyboard.press("Escape");
            await page.waitForTimeout(250);
            continue;
          }
          await ir(page, tela);
          await page.waitForTimeout(350);
          await conferir(page, nome);
          await page.evaluate(() => window.scrollTo(0, 0));
          await page.screenshot({ path: join(SAIDA, `${nome}.jpg`), fullPage: true, quality: 82 });
        } catch (e) { problemas.push(`${nome}: ${e.message.split("\n")[0]}`); }
      }
      await contexto.close();
    }
  }
}
await navegador.close();
proc.kill();
console.log(problemas.length ? `PROBLEMAS:\n${problemas.join("\n")}` : "ok: sem rolagem lateral e sem erro no console");
console.log(`prints em ${SAIDA}`);
