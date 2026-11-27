// Contraste dos tokens de cor em todas as paletas × claro/escuro (repaginação visual). Mínimo AA: 4,5 para texto.
// Uso: node test/contraste-temas.mjs   (sai com erro se algum par ficar abaixo do mínimo)
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const { chromium } = createRequire(import.meta.url)("playwright");
const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
const PORTA = 8798;
const proc = spawn(process.execPath, ["--no-warnings", join(RAIZ, "test", "servidor-local.mjs"), String(PORTA)], { stdio: ["ignore", "pipe", "inherit"] });
await new Promise((ok, falha) => { proc.stdout.on("data", d => { if (String(d).includes(`localhost:${PORTA}`)) ok(); }); proc.on("exit", c => falha(new Error(`servidor saiu (${c})`))); });
const navegador = await chromium.launch();
const page = await navegador.newPage();
await page.goto(`http://localhost:${PORTA}/#/entrar`);
// [frente, fundo, mínimo]
const PARES = [["--texto", "--fundo", 4.5], ["--texto", "--cartao", 4.5], ["--suave", "--fundo", 4.5], ["--suave", "--cartao", 4.5],
  ["--destaque", "--cartao", 4.5], ["--botao-principal-texto", "--botao-principal", 4.5], ["--sobre-dourado", "--dourado", 4.5],
  ["--ok", "--ok-fundo", 4.5], ["--erro", "--erro-fundo", 4.5], ["--info-texto", "--info-fundo", 4.5], ["--texto", "--campo", 4.5]];
const falhas = [];
const linhas = [];
for (const paleta of ["navalha", "ganache", "berinjela", "violeta", "indigo", "cereja"]) {
  for (const tema of ["claro", "escuro"]) {
    const r = await page.evaluate(([paleta, tema, pares]) => {
      const raiz = document.documentElement; raiz.dataset.paleta = paleta; raiz.dataset.tema = tema;
      const sonda = document.createElement("div"); document.body.append(sonda);
      const rgb = v => { sonda.style.color = `var(${v})`; const m = getComputedStyle(sonda).color.match(/[\d.]+/g).map(Number); return m.slice(0, 3); };
      const lum = c => { const [r, g, b] = c.map(x => { x /= 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
      const res = pares.map(([a, b, min]) => { const la = lum(rgb(a)), lb = lum(rgb(b)); const c = (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05); return [a, b, Math.round(c * 100) / 100, min]; });
      sonda.remove(); return res;
    }, [paleta, tema, PARES]);
    for (const [a, b, c, min] of r) { if (c < min) falhas.push(`${paleta}/${tema}: ${a} sobre ${b} = ${c} (mín. ${min})`); }
    linhas.push(`${paleta.padEnd(9)} ${tema.padEnd(6)} ` + r.map(([a, , c]) => `${a.replace("--", "")}:${c}`).join(" "));
  }
}
await navegador.close(); proc.kill();
console.log(linhas.join("\n"));
if (falhas.length) { console.log(`\nABAIXO DO MÍNIMO:\n${falhas.join("\n")}`); process.exit(1); }
console.log("\nok: todos os pares com contraste ≥ 4,5");
