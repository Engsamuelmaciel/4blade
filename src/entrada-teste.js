// Entrada usada nas versões publicadas a partir do ambiente do Claude (OFICIAL: wrangler.toml; TESTE: wrangler.teste.toml):
// os arquivos da tela (public/) vão DENTRO do Worker em vez do "Static Assets" (o envio de assets não funciona
// através do proxy desse ambiente). Aplica os mesmos cabeçalhos de segurança de public/_headers.
import worker from "./index.js";
import indexHtml from "../public/index.html";
import appJs from "../public/app.js";
import temaJs from "../public/tema.js";
import legalJs from "../public/legal.js";
import styleCss from "../public/style.css";
import swJs from "../public/sw.js";
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
  "/style.css": [styleCss, "text/css; charset=utf-8"],
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
  }
};
