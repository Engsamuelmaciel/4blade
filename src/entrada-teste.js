// Entrada usada nas versões publicadas a partir do ambiente do Claude (OFICIAL: wrangler.toml; TESTE: wrangler.teste.toml):
// os arquivos da tela (public/) vão DENTRO do Worker em vez do "Static Assets" (o envio de assets não funciona
// através do proxy desse ambiente). Aplica os mesmos cabeçalhos de segurança de public/_headers.
import worker from "./index.js";
import indexHtml from "../public/index.html";
import appJs from "../public/app.js";
import temaJs from "../public/tema.js";
import legalJs from "../public/legal.js";
import ajudaJs from "../public/ajuda.js";
import { IMAGENS_TUTORIAIS } from "./arquivos-tutoriais.js";
import styleCss from "../public/style.css";
import visualNovoCss from "../public/visual-novo.css";
import paginaCss from "../public/pagina.css";
import paginaJs from "../public/pagina.js";
import swJs from "../public/sw.js";
import flyersJs from "../public/flyers.js";
import fonte_anton from "../public/fontes/anton.woff2";
import fonte_bebas_neue from "../public/fontes/bebas-neue.woff2";
import fonte_abril_fatface from "../public/fontes/abril-fatface.woff2";
import fonte_pacifico from "../public/fontes/pacifico.woff2";
import fonte_rye from "../public/fontes/rye.woff2";
import fonte_monoton from "../public/fontes/monoton.woff2";
import fonte_montserrat_500 from "../public/fontes/montserrat-500.woff2";
import fonte_montserrat_800 from "../public/fontes/montserrat-800.woff2";
import fonte_playfair_700 from "../public/fontes/playfair-700.woff2";
import fonte_playfair_700_italic from "../public/fontes/playfair-700-italic.woff2";
import manifest from "../public/manifest.json";
import marca from "../public/icons/marca.png";
import logo from "../public/icons/logo.png";
import icone192 from "../public/icons/icon-v2-192.png";
import icone512 from "../public/icons/icon-v2-512.png";
import iconeM192 from "../public/icons/icon-v2-maskable-192.png";
import iconeM512 from "../public/icons/icon-v2-maskable-512.png";
import iconeApple from "../public/icons/apple-touch-icon-v2.png";
import favicon from "../public/icons/favicon-v2.png";
import cabecalhosTexto from "../public/_headers";

const ARQUIVOS = {
  "/index.html": [indexHtml, "text/html; charset=utf-8"],
  "/app.js": [appJs, "text/javascript; charset=utf-8"],
  "/tema.js": [temaJs, "text/javascript; charset=utf-8"],
  "/legal.js": [legalJs, "text/javascript; charset=utf-8"],
  "/ajuda.js": [ajudaJs, "text/javascript; charset=utf-8"],
  "/style.css": [styleCss, "text/css; charset=utf-8"],
  "/visual-novo.css": [visualNovoCss, "text/css; charset=utf-8"],
  "/pagina.css": [paginaCss, "text/css; charset=utf-8"],
  "/pagina.js": [paginaJs, "text/javascript; charset=utf-8"],
  "/flyers.js": [flyersJs, "text/javascript; charset=utf-8"],
  "/fontes/anton.woff2": [fonte_anton, "font/woff2"],
  "/fontes/bebas-neue.woff2": [fonte_bebas_neue, "font/woff2"],
  "/fontes/abril-fatface.woff2": [fonte_abril_fatface, "font/woff2"],
  "/fontes/pacifico.woff2": [fonte_pacifico, "font/woff2"],
  "/fontes/rye.woff2": [fonte_rye, "font/woff2"],
  "/fontes/monoton.woff2": [fonte_monoton, "font/woff2"],
  "/fontes/montserrat-500.woff2": [fonte_montserrat_500, "font/woff2"],
  "/fontes/montserrat-800.woff2": [fonte_montserrat_800, "font/woff2"],
  "/fontes/playfair-700.woff2": [fonte_playfair_700, "font/woff2"],
  "/fontes/playfair-700-italic.woff2": [fonte_playfair_700_italic, "font/woff2"],
  "/sw.js": [swJs, "text/javascript; charset=utf-8"],
  "/manifest.json": [manifest, "application/manifest+json"],
  "/icons/marca.png": [marca, "image/png"],
  "/icons/logo.png": [logo, "image/png"],
  "/icons/icon-v2-192.png": [icone192, "image/png"],
  "/icons/icon-v2-512.png": [icone512, "image/png"],
  "/icons/icon-v2-maskable-192.png": [iconeM192, "image/png"],
  "/icons/icon-v2-maskable-512.png": [iconeM512, "image/png"],
  "/icons/apple-touch-icon-v2.png": [iconeApple, "image/png"],
  "/icons/favicon-v2.png": [favicon, "image/png"],
  // nomes antigos continuam respondendo (celulares com o app já instalado)
  "/icons/icon-192.png": [icone192, "image/png"],
  "/icons/icon-512.png": [icone512, "image/png"]
};
for (const [caminho, dados] of Object.entries(IMAGENS_TUTORIAIS)) ARQUIVOS[caminho] = [dados, "image/jpeg"];
const SEGURANCA = {};
for (const l of String(cabecalhosTexto).split("\n")) {
  const m = l.match(/^\s+([A-Za-z-]+):\s*(.+)$/);
  if (m && !/Cache-Control/i.test(m[1])) SEGURANCA[m[1]] = m[2].trim();
}

const ASSETS = {
  async fetch(request) {
    const caminho = new URL(request.url).pathname;
    // endereço desconhecido = a própria tela (aplicativo de uma página só)
    const [corpo, tipo] = ARQUIVOS[caminho] || ARQUIVOS["/index.html"];
    return new Response(corpo, { headers: { "Content-Type": tipo, "Cache-Control": "no-cache", ...SEGURANCA } });
  }
};

export default {
  fetch(request, env, ctx) {
    return worker.fetch(request, { ...env, ASSETS }, ctx);
  },
  scheduled(evento, env, ctx) {
    return worker.scheduled(evento, { ...env, ASSETS }, ctx);
  }
};
