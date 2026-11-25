// PÁGINA DA BARBEARIA (24/11/2026): página pública em forblade.com.br/<endereço>, para a bio do Instagram.
// Todos os planos (decisão do responsável). Sem agendamento pelo site: "Solicitar meu horário" abre o WhatsApp da
// barbearia com a mensagem pronta. Os horários livres só aparecem se o gerente ligar (e também levam ao WhatsApp).
// A página é montada aqui no servidor (Google e prévia de link no WhatsApp/Instagram leem o conteúdo).
// Segurança: tudo que vem do barbeiro é escapado; nunca mostra faturamento, clientes, comissões ou dados internos.
import { json, HttpError, readJson, validId, textoOpcional, normalizarTelefone, hojeBrasil, auditoria, diferenca } from "./util.js";
import { isGestao } from "./perfis.js";
import { carregarRegras, janelaDoDia, horaParaMin, minParaHora, somarDias, diaSemana, NOME_DIA } from "./agenda-util.js";
import { iniciosLivres } from "./agenda.js";
import { cobrancaAtiva, situacaoAssinatura } from "./assinatura.js";
import { contatoSuporte } from "./suporte.js";

const erro = (msg, status = 400, extra) => { throw new HttpError(msg, status, extra); };

// ---------- REGRAS ----------
export const TEMAS = ["classico", "claro", "vintage", "moderno"];
// Aparência (25/11/2026): cor de destaque × aparência. Sem linha em paginas_aparencia, vale o tema antigo.
export const CORES_PAGINA = ["navalha", "ferrugem", "indigo", "ganache", "berinjela", "violeta", "cereja", "oceano", "esmeralda", "bordo"];
export const MODOS_PAGINA = ["claro", "escuro", "pb"];
const TEMA_ANTIGO = { classico: ["navalha", "escuro"], claro: ["navalha", "claro"], vintage: ["ferrugem", "claro"], moderno: ["indigo", "escuro"] };
const aparenciaDe = p => (CORES_PAGINA.includes(p.ap_cor) && MODOS_PAGINA.includes(p.ap_modo)
  ? { cor: p.ap_cor, modo: p.ap_modo }
  : (([cor, modo]) => ({ cor, modo }))(TEMA_ANTIGO[p.tema] || TEMA_ANTIGO.classico));
const classeAparencia = p => { const a = aparenciaDe(p); return `modo-${a.modo} cor-${a.cor}`; };
const SQL_PAGINA = `SELECT p.*, a.cor AS ap_cor, a.modo AS ap_modo, COALESCE(o.mostrar_novidades, 1) AS mostrar_novidades FROM paginas p
  LEFT JOIN paginas_aparencia a ON a.barbearia_id = p.barbearia_id LEFT JOIN paginas_opcoes o ON o.barbearia_id = p.barbearia_id`;
export const FORMAS_PAGINA = { pix: "Pix", cartao: "Cartão", dinheiro: "Dinheiro" };
export const MAX_GALERIA = 12;
export const MAX_FOTO_BYTES = 700 * 1024;              // o celular já reduz para ~500 KB; folga para PNG pequeno
export const LIMITE_TOTAL_BYTES = 15 * 1024 * 1024;   // 15 MB por barbearia (decisão do responsável, 24/11/2026)
export const DIAS_SLUG_ANTIGO = 90;
const DIAS_HORARIOS = 7;
// Endereços que não podem virar página (rotas e arquivos do sistema + palavras reservadas do pedido).
export const RESERVADOS = new Set(["api", "entrar", "planos", "assinar", "duvidas", "suporte", "admin", "master", "icons", "tutoriais",
  "app", "sw", "manifest", "termos", "privacidade", "login", "cadastro", "ajuda", "contato", "www", "static", "assets", "b", "f",
  "inicio", "teste-gratis", "plataforma", "pedidos", "chamados", "pagina", "paginas", "index", "favicon", "robots", "sitemap",
  "style", "tema", "legal", "4blade", "forblade", "suporte-4blade", "agenda", "caixa", "painel", "clientes", "equipe"]);
// frame-src: só o mapa do Google (25/11/2026: mapa visível na Localização).
// Ícones simples em SVG (atributos, sem style: a CSP não deixa estilo embutido).
const ICONE_INSTA = '<svg class="pg-ico" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r="1.2" fill="currentColor" stroke="none"/></svg>';
const ICONE_WHATS = '<svg class="pg-ico" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round"><path d="M12 3.2a8.8 8.8 0 1 1-4.3 16.5L3.2 20.8l1.2-4.3A8.8 8.8 0 0 1 12 3.2z"/><path transform="translate(7.3 7.3) scale(.4)" fill="currentColor" stroke="none" d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2z"/></svg>';
const ICONE_TEL = '<svg class="pg-ico" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M5 3h4l2 5-2.5 1.5a11 11 0 0 0 6 6L16 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 5a2 2 0 0 1 2-2z"/></svg>';
const CSP = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; manifest-src 'self'; frame-src https://maps.google.com https://www.google.com; frame-ancestors 'none'; base-uri 'none'; form-action 'self'; object-src 'none'";
const CABECALHOS = { "Content-Security-Policy": CSP, "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer",
  "X-Frame-Options": "DENY", "Permissions-Policy": "geolocation=(), camera=(), microphone=()" };

export const validSlug = s => typeof s === "string" && /^[a-z0-9](?:[a-z0-9-]{1,38})[a-z0-9]$/.test(s) && !s.includes("--") && !RESERVADOS.has(s);
// Sugestão a partir do nome: "Navalha & Co." → "navalha-co"
export function sugerirSlug(nome) {
  const s = String(nome || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/&/g, " e ").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").replace(/-{2,}/g, "-").slice(0, 40).replace(/-+$/, "");
  return s.length >= 3 ? s : `barbearia-${s || "nova"}`.slice(0, 40);
}

// ---------- ARMAZENAMENTO DAS FOTOS (R2 da Cloudflare: binding FOTOS) ----------
const chaveFoto = (barbeariaId, id) => `paginas/${barbeariaId}/${id}`;
// Flyers duram 24 horas, como um story (pedido do responsável): depois disso somem de tudo e a limpeza apaga o arquivo do R2.
export const HORAS_FLYER = 24;
const FLYER_VIVO = `criado_em > datetime('now', '-${HORAS_FLYER} hours')`;
// Flyers (25/11/2026): imagem pronta gerada no aparelho; até 12 no ar por barbearia, 1,2 MB cada.
export const ESTILOS_FLYER = ["moderno", "contemporaneo", "retro", "vintage", "neon", "luxo", "urbano", "editorial", "minimal", "giz", "tropical", "polaroid"];
export const FORMATOS_FLYER = ["story", "quadrado", "retrato"];
export const MAX_FLYERS = 12;
export const MAX_FLYER_BYTES = 1200 * 1024;
// Tipo pelo CONTEÚDO (não pelo nome do arquivo).
export function tipoImagem(b) {
  if (b.length > 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return "image/webp";
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  return null;
}
// Tira dados de localização/câmera (EXIF): JPEG = segmentos APP1; WEBP = bloco EXIF; PNG = bloco eXIf.
export function semExif(b, mime) {
  if (mime === "image/jpeg") {
    const partes = [b.subarray(0, 2)];
    let i = 2;
    while (i + 4 <= b.length && b[i] === 0xff) {
      const marca = b[i + 1];
      if (marca === 0xda) break;   // começo da imagem: o resto vai inteiro
      const tam = (b[i + 2] << 8) | b[i + 3];
      if (marca !== 0xe1) partes.push(b.subarray(i, i + 2 + tam));
      i += 2 + tam;
    }
    partes.push(b.subarray(i));
    return juntar(partes);
  }
  if (mime === "image/webp" || mime === "image/png") {
    const ehWebp = mime === "image/webp";
    const partes = [b.subarray(0, ehWebp ? 12 : 8)];
    let i = ehWebp ? 12 : 8;
    while (i + 8 <= b.length) {
      const nome = String.fromCharCode(b[i + (ehWebp ? 0 : 4)], b[i + (ehWebp ? 1 : 5)], b[i + (ehWebp ? 2 : 6)], b[i + (ehWebp ? 3 : 7)]);
      const tam = ehWebp ? (b[i + 4] | (b[i + 5] << 8) | (b[i + 6] << 16) | (b[i + 7] << 24)) >>> 0
        : ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;
      const total = ehWebp ? 8 + tam + (tam % 2) : 12 + tam;
      if (nome !== (ehWebp ? "EXIF" : "eXIf")) partes.push(b.subarray(i, i + total));
      i += total;
    }
    const saida = juntar(partes);
    if (ehWebp) new DataView(saida.buffer).setUint32(4, saida.length - 8, true);   // tamanho do RIFF
    return saida;
  }
  return b;
}
function juntar(partes) {
  const out = new Uint8Array(partes.reduce((s, p) => s + p.length, 0));
  let o = 0;
  for (const p of partes) { out.set(p, o); o += p.length; }
  return out;
}
const armazenamento = env => env.FOTOS || null;

// ---------- DADOS ----------
const escapar = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const reais = c => `R$ ${(c / 100).toFixed(2).replace(".", ",").replace(/\B(?=(\d{3})+(?!\d))/g, ".")}`;
const duracaoTexto = m => (m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? String(m % 60).padStart(2, "0") : ""}` : `${m} min`);
const agoraMinBrasil = () => { const d = new Date(Date.now() - 3 * 3600 * 1000); return d.getUTCHours() * 60 + d.getUTCMinutes(); };
const urlFoto = (origem, id) => `${origem}/f/${id}`;

async function lerPagina(db, barbeariaId) {
  return db.prepare(`${SQL_PAGINA} WHERE p.barbearia_id = ?`).bind(barbeariaId).first();
}

// Cria a página (não publicada) na primeira vez que o gerente abre "Minha página", com um endereço livre sugerido.
async function garantirPagina(ctx) {
  const { db } = ctx;
  let p = await lerPagina(db, ctx.barbeariaId);
  if (p) return p;
  const b = await db.prepare("SELECT nome FROM barbearias WHERE id = ?").bind(ctx.barbeariaId).first();
  const base = sugerirSlug(b?.nome);
  let slug = validSlug(base) ? base : `${base}-barbearia`.slice(0, 40);
  for (let n = 2; !(await slugLivre(db, slug, ctx.barbeariaId)); n++) slug = `${base.slice(0, 36)}-${n}`;
  await db.batch([
    db.prepare("INSERT OR IGNORE INTO paginas (barbearia_id, slug) VALUES (?, ?)").bind(ctx.barbeariaId, slug),
    auditoria(ctx, "pagina_criada", ctx.barbeariaId, { slug })
  ]);
  return lerPagina(db, ctx.barbeariaId);
}

async function slugLivre(db, slug, barbeariaId) {
  if (!validSlug(slug)) return false;
  const [p, antigo] = await Promise.all([
    db.prepare("SELECT barbearia_id FROM paginas WHERE slug = ?").bind(slug).first(),
    db.prepare("SELECT barbearia_id FROM paginas_slugs_antigos WHERE slug = ? AND valido_ate >= ?").bind(slug, hojeBrasil()).first()
  ]);
  if (p && p.barbearia_id !== barbeariaId) return false;
  if (antigo && antigo.barbearia_id !== barbeariaId) return false;
  return true;
}

// Tudo que a página pública mostra (e a prévia do editor): só dados de vitrine.
async function conteudoPagina(db, p) {
  const id = p.barbearia_id;
  const [b, servs, equipe, fotos, func, flyers, especiais] = await Promise.all([
    db.prepare("SELECT nome, telefone FROM barbearias WHERE id = ?").bind(id).first(),
    db.prepare(`SELECT s.id, s.nome, s.preco_centavos, s.duracao_min, ps.visivel, ps.ordem, ps.descricao
                FROM servicos s LEFT JOIN paginas_servicos ps ON ps.servico_id = s.id AND ps.barbearia_id = s.barbearia_id
                WHERE s.barbearia_id = ? AND s.ativo = 1 ORDER BY COALESCE(ps.ordem, 9999), s.nome`).bind(id).all(),
    db.prepare(`SELECT u.id, u.nome, pe.ordem, pe.especialidade FROM paginas_equipe pe JOIN usuarios u ON u.id = pe.usuario_id
                WHERE pe.barbearia_id = ? AND pe.visivel = 1 AND u.ativo = 1 AND u.barbearia_id = ? ORDER BY pe.ordem, u.nome`).bind(id, id).all(),
    db.prepare(`SELECT id, tipo, usuario_id, legenda, ordem FROM paginas_fotos WHERE barbearia_id = ? AND removida_em IS NULL
                ORDER BY tipo, ordem, criado_em`).bind(id).all(),
    db.prepare("SELECT * FROM funcionamento WHERE barbearia_id = ? ORDER BY dia_semana").bind(id).all(),
    db.prepare(`SELECT id, titulo, texto, formato FROM paginas_flyers WHERE barbearia_id = ? AND removido_em IS NULL AND publicado = 1
                AND (validade IS NULL OR validade >= ?) AND ${FLYER_VIVO} ORDER BY criado_em DESC LIMIT ?`).bind(id, hojeBrasil(), MAX_FLYERS).all(),
    // Aberturas em caráter especial dos próximos 90 dias (dias que a barbearia normalmente não abre, ou com horário diferente).
    db.prepare("SELECT data, abre_min, fecha_min, intervalo_ini_min, intervalo_fim_min, motivo FROM aberturas_especiais WHERE barbearia_id = ? AND ativo = 1 AND data >= ? AND data <= ? ORDER BY data")
      .bind(id, hojeBrasil(), somarDias(hojeBrasil(), 90)).all()
  ]);
  const ultima = tipo => fotos.results.filter(f => f.tipo === tipo).at(-1) || null;
  const fotoDe = uid => fotos.results.filter(f => f.tipo === "equipe" && f.usuario_id === uid).at(-1) || null;
  return {
    barbearia: b,
    nome: p.nome_exibicao || b?.nome || "Barbearia",
    whatsapp: normalizarTelefone(p.whatsapp || "") || normalizarTelefone(b?.telefone || "") || null,
    servicos: servs.results.filter(s => s.visivel !== 0).map(s => ({ id: s.id, nome: s.nome, precoCentavos: s.preco_centavos, duracaoMin: s.duracao_min, descricao: s.descricao || null })),
    equipe: equipe.results.map(u => ({ id: u.id, nome: u.nome, especialidade: u.especialidade || null, foto: fotoDe(u.id)?.id || null })),
    logo: ultima("logo")?.id || null,
    capa: ultima("capa")?.id || null,
    galeria: fotos.results.filter(f => f.tipo === "galeria").map(f => ({ id: f.id, legenda: f.legenda || "" })),
    funcionamento: func.results,
    especiais: especiais.results,
    flyers: flyers.results,
    formas: (() => { try { return JSON.parse(p.formas || "[]").filter(f => FORMAS_PAGINA[f]); } catch { return []; } })()
  };
}

// "Aberto agora" pelo horário de Brasília (funcionamento + intervalo + datas fechadas).
async function abertoAgora(db, barbeariaId, func, especiais = []) {
  const hoje = hojeBrasil();
  const esp = especiais.find(x => x.data === hoje);
  const f = esp ? { aberto: 1, abre_min: esp.abre_min, fecha_min: esp.fecha_min, intervalo_ini_min: esp.intervalo_ini_min, intervalo_fim_min: esp.intervalo_fim_min } : func.find(x => x.dia_semana === diaSemana(hoje));
  if (!f || !f.aberto) return false;
  const fechada = await db.prepare("SELECT 1 FROM datas_fechadas WHERE barbearia_id = ? AND ativo = 1 AND data_ini <= ? AND data_fim >= ? LIMIT 1")
    .bind(barbeariaId, hoje, hoje).first();
  if (fechada) return false;
  const m = agoraMinBrasil();
  if (m < f.abre_min || m >= f.fecha_min) return false;
  if (f.intervalo_ini_min !== null && f.intervalo_ini_min !== undefined && m >= f.intervalo_ini_min && m < f.intervalo_fim_min) return false;
  return true;
}

// Horários livres dos próximos dias (juntando todos os profissionais), só para VER; tocar leva ao WhatsApp.
async function horariosLivres(db, barbeariaId) {
  const hoje = hojeBrasil();
  const fim = somarDias(hoje, DIAS_HORARIOS - 1);
  const [profs, ags, blqs, minDur, regras] = await Promise.all([
    db.prepare("SELECT id FROM usuarios WHERE barbearia_id = ? AND ativo = 1 AND perfil IN ('proprietario','gerente','barbeiro')").bind(barbeariaId).all(),
    db.prepare("SELECT barbeiro_id, data, inicio, fim FROM agendamentos WHERE barbearia_id = ? AND situacao IN ('agendado','finalizado') AND data BETWEEN ? AND ?")
      .bind(barbeariaId, hoje, fim).all(),
    db.prepare("SELECT barbeiro_id, inicio, fim FROM bloqueios WHERE barbearia_id = ? AND ativo = 1 AND inicio < ? AND fim > ?")
      .bind(barbeariaId, `${somarDias(fim, 1)}T00:00`, `${hoje}T00:00`).all(),
    db.prepare("SELECT MIN(duracao_min) AS m FROM servicos WHERE barbearia_id = ? AND ativo = 1").bind(barbeariaId).first(),
    carregarRegras(db, barbeariaId, hoje, fim)
  ]);
  const duracao = Number(minDur?.m || 30);
  const agoraMin = agoraMinBrasil();
  const minDoDia = (m, d) => (m.slice(0, 10) < d ? 0 : m.slice(0, 10) > d ? 1440 : horaParaMin(m.slice(11)));
  const dias = [];
  for (let d = hoje; d <= fim; d = somarDias(d, 1)) {
    const livres = new Set();
    for (const p of profs.results) {
      const janela = janelaDoDia(regras(d, p.id));
      if (!janela) continue;
      const ocup = [
        ...ags.results.filter(a => a.barbeiro_id === p.id && a.data === d).map(a => ({ ini: horaParaMin(a.inicio.slice(11)), fim: horaParaMin(a.fim.slice(11)) })),
        ...blqs.results.filter(b => b.barbeiro_id === p.id && b.inicio.slice(0, 10) <= d && b.fim.slice(0, 10) >= d).map(b => ({ ini: minDoDia(b.inicio, d), fim: minDoDia(b.fim, d) })),
        ...(janela.intervalo ? [{ ini: janela.intervalo[0], fim: janela.intervalo[1] }] : [])
      ];
      for (const t of iniciosLivres(janela, ocup, duracao, d, hoje, agoraMin)) livres.add(t);
    }
    dias.push({ data: d, horas: [...livres].sort((a, b) => a - b).map(minParaHora) });
  }
  return dias;
}

// ---------- PÁGINA PÚBLICA (sem login) ----------
const BOTS = /bot|crawl|spider|slurp|facebookexternalhit|whatsapp|telegram|preview|embedly|quora|pinterest|vkshare|discord|skype/i;

export async function rotaPublicaPagina(request, env) {
  const url = new URL(request.url);
  if (request.method !== "GET" && request.method !== "HEAD") return null;
  const db = env.DB;
  if (!db) return null;
  // Fotos: /f/<id>
  const mFoto = url.pathname.match(/^\/f\/([a-f0-9-]{36})$/);
  if (mFoto) return servirFoto(db, env, mFoto[1]);
  const m = url.pathname.match(/^\/([a-z0-9-]{1,60})\/?$/);
  if (!m || RESERVADOS.has(m[1])) return null;
  const slug = m[1];
  const p = await db.prepare(`${SQL_PAGINA} WHERE p.slug = ?`).bind(slug).first();
  if (!p) {
    const antigo = await db.prepare(`SELECT p.slug FROM paginas_slugs_antigos a JOIN paginas p ON p.barbearia_id = a.barbearia_id
                                     WHERE a.slug = ? AND a.valido_ate >= ?`).bind(slug, hojeBrasil()).first();
    if (antigo) return new Response(null, { status: 301, headers: { Location: `/${antigo.slug}`, ...CABECALHOS } });
    return paginaIndisponivel();
  }
  const previa = url.searchParams.get("previa");
  const ehPrevia = Boolean(previa && p.previa_token && previa === p.previa_token && p.previa_ate >= new Date().toISOString());
  if (!p.publicada && !ehPrevia) return paginaIndisponivel();
  if (!(await barbeariaNoAr(db, env, p.barbearia_id))) return paginaIndisponivel();
  const c = await conteudoPagina(db, p);
  const [aberto, horarios, suporte] = await Promise.all([
    abertoAgora(db, p.barbearia_id, c.funcionamento, c.especiais),
    p.mostrar_horarios ? horariosLivres(db, p.barbearia_id) : null,
    contatoSuporte(db).catch(() => ({}))
  ]);
  if (!ehPrevia && !BOTS.test(request.headers.get("user-agent") || "")) await contarEvento(db, p.barbearia_id, "visita");
  // Link de um flyer: mostra a arte na prévia do WhatsApp mesmo se ele não estiver no carrossel (ou se o carrossel estiver oculto).
  const idPromo = url.searchParams.get("promo");
  let promo = c.flyers.find(f => f.id === idPromo) || null;
  if (!promo && idPromo && validId(idPromo)) {
    promo = await db.prepare(`SELECT id, titulo, texto, formato FROM paginas_flyers WHERE id = ? AND barbearia_id = ? AND removido_em IS NULL
                              AND (validade IS NULL OR validade >= ?) AND ${FLYER_VIVO}`).bind(idPromo, p.barbearia_id, hojeBrasil()).first() || null;
  }
  const html = montarHtml({ p, c, aberto, horarios, origem: url.origin, previa: ehPrevia, promo, suporte });
  return new Response(request.method === "HEAD" ? null : html, {
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": ehPrevia ? "no-store" : "no-cache", ...CABECALHOS,
      ...(ehPrevia ? { "X-Robots-Tag": "noindex" } : {}) }
  });
}

async function barbeariaNoAr(db, env, barbeariaId) {
  const b = await db.prepare(`SELECT b.bloqueada, a.origem, a.pago_ate, a.teste_ate, a.ultimo_pagamento_em, a.cancelada
                              FROM barbearias b LEFT JOIN assinaturas a ON a.barbearia_id = b.id WHERE b.id = ?`).bind(barbeariaId).first();
  if (!b || b.bloqueada) return false;
  if (cobrancaAtiva(env) && situacaoAssinatura(b).bloqueada) return false;   // inadimplente além da tolerância
  return true;
}

function paginaIndisponivel() {
  const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>Página indisponível</title><link rel="stylesheet" href="/pagina.css"></head>
<body class="modo-escuro cor-navalha indisponivel"><main class="pg-indisponivel"><img src="/icons/logo.png" alt="4blade" width="120" height="49">
<h1>Esta página não está disponível no momento.</h1><p>Confira o endereço ou fale direto com a barbearia.</p>
<a class="pg-botao" href="/">Conhecer o 4Blade</a></main></body></html>`;
  return new Response(html, { status: 404, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Robots-Tag": "noindex", ...CABECALHOS } });
}

async function servirFoto(db, env, id) {
  const f = await db.prepare(`SELECT f.barbearia_id, f.mime FROM paginas_fotos f WHERE f.id = ? AND f.removida_em IS NULL
                              UNION ALL SELECT x.barbearia_id, x.mime FROM paginas_flyers x WHERE x.id = ? AND x.removido_em IS NULL AND x.${FLYER_VIVO} LIMIT 1`).bind(id, id).first();
  const r2 = armazenamento(env);
  if (!f || !r2) return new Response("Não encontrada", { status: 404, headers: CABECALHOS });
  const obj = await r2.get(chaveFoto(f.barbearia_id, id));
  if (!obj) return new Response("Não encontrada", { status: 404, headers: CABECALHOS });
  return new Response(obj.body, { headers: { "Content-Type": f.mime, "Cache-Control": "public, max-age=31536000, immutable", ...CABECALHOS } });
}

export async function contarEvento(db, barbeariaId, tipo) {
  await db.prepare(`INSERT INTO paginas_eventos (barbearia_id, dia, tipo, quantidade) VALUES (?, ?, ?, 1)
                    ON CONFLICT(barbearia_id, dia, tipo) DO UPDATE SET quantidade = quantidade + 1`).bind(barbeariaId, hojeBrasil(), tipo).run();
}

// Toques nos botões (WhatsApp, Como chegar, Instagram): anônimo, com limite por aparelho.
export async function rotaEventoPagina({ db, request, limitar }) {
  const input = await readJson(request, 512);
  const tipo = ["whatsapp", "rota", "instagram"].includes(input.tipo) ? input.tipo : null;
  if (!tipo || typeof input.slug !== "string" || !/^[a-z0-9-]{3,40}$/.test(input.slug)) return json({ ok: false }, 400);
  if (!(await limitar("pagina-evento", 120, 3600))) return json({ ok: true });
  const p = await db.prepare("SELECT barbearia_id FROM paginas WHERE slug = ? AND publicada = 1").bind(input.slug).first();
  if (p) await contarEvento(db, p.barbearia_id, tipo);
  return json({ ok: true });
}

// ---------- HTML DA PÁGINA ----------
function linkWhats(numero, texto) {
  return `https://wa.me/55${numero}?text=${encodeURIComponent(texto)}`;
}
export function mensagemWhats(nome, servicos, padrao) {
  if (servicos?.length) {
    const total = servicos.reduce((s, x) => s + x.precoCentavos, 0);
    const dur = servicos.reduce((s, x) => s + x.duracaoMin, 0);
    return `Olá, ${nome}! Vim pela sua página e quero agendar: ${servicos.map(s => s.nome).join(" + ")} (${reais(total)}, ${duracaoTexto(dur)}). Qual horário vocês têm?`;
  }
  return padrao || `Olá, ${nome}! Vim pela sua página e quero agendar um horário.`;
}
function endereco(p) {
  const l1 = [p.end_rua, p.end_numero].filter(Boolean).join(", ");
  const l2 = [p.end_bairro, [p.end_cidade, p.end_uf].filter(Boolean).join("/")].filter(Boolean).join(" — ");
  return { linha1: l1, linha2: l2, completo: [l1, p.end_bairro, p.end_cidade, p.end_uf, p.end_cep].filter(Boolean).join(", ") };
}
const DIAS_CURTOS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

function montarHtml({ p, c, aberto, horarios, origem, previa, promo = null, suporte = {} }) {
  const e = escapar;
  const nome = c.nome;
  const end = endereco(p);
  const cidade = p.end_cidade ? ` em ${p.end_cidade}` : "";
  const titulo = `${nome} — Barbearia${cidade} | Agende seu horário`;
  const descricao = p.frase || `Conheça a ${nome}: serviços, preços, horários e localização. Agende pelo WhatsApp.`;
  const url = `${origem}/${p.slug}`;
  // Link de um flyer (?promo=<id>): a prévia do WhatsApp/Instagram mostra o próprio flyer.
  const imagem = promo ? urlFoto(origem, promo.id) : c.capa || c.logo ? urlFoto(origem, c.capa || c.logo) : `${origem}/icons/icon-v2-512.png`;
  const ogTitulo = promo ? `${promo.titulo} — ${nome}` : titulo;
  const ogDescricao = promo ? (promo.texto || `${nome}: toque para ver e agendar pelo WhatsApp.`) : descricao;
  const ogUrl = promo ? `${url}?promo=${promo.id}` : url;
  const promosHtml = c.flyers.map(f => `<li id="promo-${e(f.id)}" class="pg-promo ${e(f.formato)}${promo && promo.id === f.id ? " destaque" : ""}">
      <button type="button" class="pg-foto" aria-label="Ampliar: ${e(f.titulo)}"><img src="/f/${e(f.id)}" alt="${e(f.titulo)}${f.texto ? ` — ${e(f.texto)}` : ""}" loading="lazy"></button>
      </li>`).join("");
  const msgPadrao = mensagemWhats(nome, null, p.mensagem_padrao);
  const whats = c.whatsapp ? linkWhats(c.whatsapp, msgPadrao) : null;
  const mapa = p.maps_url && /^https:\/\//.test(p.maps_url) ? p.maps_url
    : end.completo ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(end.completo)}` : null;
  // Mapa dentro da página (sem chave de API): o endereço vira o alvo do mapa do Google.
  const mapaEmbutido = end.completo ? `https://maps.google.com/maps?q=${encodeURIComponent(end.completo)}&z=16&hl=pt-BR&output=embed` : null;
  const waze = end.completo ? `https://waze.com/ul?q=${encodeURIComponent(end.completo)}&navigate=yes` : null;
  const insta = p.instagram ? `https://instagram.com/${encodeURIComponent(p.instagram)}` : null;
  // 25/11/2026: o "Telefone" só aparece se o gerente preencher em Minha página (antes caía no telefone do cadastro).
  const telDigitado = normalizarTelefone(p.telefone || "");
  const rodape4blade = normalizarTelefone(suporte?.whatsapp || "")
    ? linkWhats(normalizarTelefone(suporte.whatsapp), `Olá, equipe 4blade! Vi a página da ${nome} e quero uma página assim para a minha barbearia.`)
    : "/#/teste-gratis";
  const tel = telDigitado && telDigitado !== c.whatsapp ? telDigitado : null;
  const foneTexto = t => (t ? `(${t.slice(0, 2)}) ${t.length === 11 ? `${t.slice(2, 7)}-${t.slice(7)}` : `${t.slice(2, 6)}-${t.slice(6)}`}` : "");
  const funcPor = Object.fromEntries(c.funcionamento.map(f => [f.dia_semana, f]));
  const hojeDia = diaSemana(hojeBrasil());
  const linhasHorario = [1, 2, 3, 4, 5, 6, 0].map(d => {
    const f = funcPor[d];
    const txt = !f || !f.aberto ? "Fechado"
      : `${minParaHora(f.abre_min)} – ${minParaHora(f.fecha_min)}${f.intervalo_ini_min !== null && f.intervalo_ini_min !== undefined ? ` (intervalo ${minParaHora(f.intervalo_ini_min)}–${minParaHora(f.intervalo_fim_min)})` : ""}`;
    return `<li${d === hojeDia ? ' class="hoje"' : ""}><span>${NOME_DIA[d][0].toUpperCase() + NOME_DIA[d].slice(1)}</span><span>${e(txt)}</span></li>`;
  }).join("");
  const temFuncionamento = c.funcionamento.some(f => f.aberto);
  // Aberturas em caráter especial (26/11/2026): "Dom, 21/12 · 09:00 – 14:00 · Natal".
  const linhasEspeciais = c.especiais.map(x => {
    const [ano, mes, dia] = x.data.split("-");
    const quando = `${NOME_DIA[diaSemana(x.data)].slice(0, 3)}, ${dia}/${mes}`;
    const horas = `${minParaHora(x.abre_min)} – ${minParaHora(x.fecha_min)}`;
    return `<li class="pg-especial" data-especial="${e(x.data)}"><span><strong>${e(quando.charAt(0).toUpperCase() + quando.slice(1))}</strong> · ${e(x.motivo)}</span><span>${e(horas)}</span></li>`;
  }).join("");

  // Dados estruturados (Google). "<" vira <: texto do barbeiro nunca fecha o <script>.
  const ld = {
    "@context": "https://schema.org", "@type": "HairSalon", name: nome, url, image: imagem,
    ...(p.frase ? { description: p.frase } : {}),
    ...(tel || c.whatsapp ? { telephone: `+55${tel || c.whatsapp}` } : {}),
    ...(end.completo ? { address: { "@type": "PostalAddress", streetAddress: end.linha1, addressLocality: p.end_cidade || undefined, addressRegion: p.end_uf || undefined, postalCode: p.end_cep || undefined, addressCountry: "BR" } } : {}),
    openingHoursSpecification: c.funcionamento.filter(f => f.aberto).map(f => ({ "@type": "OpeningHoursSpecification",
      dayOfWeek: ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][f.dia_semana], opens: minParaHora(f.abre_min), closes: minParaHora(f.fecha_min) })),
    ...(c.especiais.length ? { specialOpeningHoursSpecification: c.especiais.map(x => ({ "@type": "OpeningHoursSpecification", validFrom: x.data, validThrough: x.data,
      opens: minParaHora(x.abre_min), closes: minParaHora(x.fecha_min) })) } : {}),
    makesOffer: c.servicos.map(s => ({ "@type": "Offer", price: (s.precoCentavos / 100).toFixed(2), priceCurrency: "BRL", itemOffered: { "@type": "Service", name: s.nome } }))
  };
  const ldJson = JSON.stringify(ld).replace(/</g, "\\u003c");

  // Catálogo enxuto (25/11/2026): linha compacta (nome · tempo · preço · +), 2 colunas no computador; os 6 primeiros
  // aparecem e o resto fica em "Ver mais N serviços" (sem JavaScript: <details>), para a galeria não ficar lá embaixo.
  // Pedido: escolher com + e tocar em "Solicitar meu horário" (a mensagem leva os serviços escolhidos).
  const VISIVEIS = 6;
  const itemServico = s => `
      <li class="pg-servico" data-servico="${e(s.id)}" data-nome="${e(s.nome)}" data-preco="${s.precoCentavos}" data-dur="${s.duracaoMin}">
        <div class="pg-servico-txt"><strong>${e(s.nome)}</strong>
          <span class="pg-servico-info">${e(duracaoTexto(s.duracaoMin))}${s.descricao ? ` · ${e(s.descricao)}` : ""}</span></div>
        <span class="pg-preco">${e(reais(s.precoCentavos))}</span>
        ${c.whatsapp ? `<button type="button" class="pg-escolher" aria-pressed="false" aria-label="Escolher ${e(s.nome)}">+</button>` : ""}
      </li>`;
  const servicosHtml = `<ul class="pg-servicos">${c.servicos.slice(0, VISIVEIS).map(itemServico).join("")}</ul>` +
    (c.servicos.length > VISIVEIS ? `<details class="pg-mais"><summary><span class="pg-mais-abrir">Ver mais ${c.servicos.length - VISIVEIS} serviço${c.servicos.length - VISIVEIS === 1 ? "" : "s"}</span><span class="pg-mais-fechar">Mostrar menos</span></summary>
      <ul class="pg-servicos">${c.servicos.slice(VISIVEIS).map(itemServico).join("")}</ul></details>` : "");
  const galeriaHtml = c.galeria.map((f, i) => `<li><button type="button" class="pg-foto" data-foto="${i}" aria-label="Ampliar foto ${i + 1}${f.legenda ? `: ${e(f.legenda)}` : ""}">
      <img src="/f/${e(f.id)}" alt="${e(f.legenda || `Foto ${i + 1} da ${nome}`)}" loading="lazy"></button></li>`).join("");
  const equipeHtml = c.equipe.map(u => `<li class="pg-pessoa">${u.foto ? `<img src="/f/${e(u.foto)}" alt="${e(u.nome)}" loading="lazy">`
      : `<span class="pg-inicial" aria-hidden="true">${e(u.nome.trim().charAt(0).toUpperCase())}</span>`}
      <strong>${e(u.nome.split(" ")[0])}</strong>${u.especialidade ? `<small>${e(u.especialidade)}</small>` : ""}</li>`).join("");
  // Um dia por linha, recolhido (só o primeiro aberto): a lista não toma a página inteira.
  const horariosHtml = horarios ? horarios.filter(d => d.horas.length).map((d, i) => {
    const dt = new Date(`${d.data}T12:00:00Z`);
    const rotulo = `${DIAS_CURTOS[dt.getUTCDay()]} ${d.data.slice(8, 10)}/${d.data.slice(5, 7)}`;
    return `<li class="pg-dia"><details${i === 0 ? " open" : ""}><summary><strong>${e(rotulo)}</strong><span>${d.horas.length} ${d.horas.length === 1 ? "horário" : "horários"}</span></summary><div class="pg-horas">${d.horas.slice(0, 24).map(h => c.whatsapp
      ? `<a class="pg-hora" data-evento="whatsapp" href="${e(linkWhats(c.whatsapp, `Olá, ${nome}! Vim pela sua página. Vocês têm horário ${rotulo} às ${h}?`))}" target="_blank" rel="noopener">${h}</a>`
      : `<span class="pg-hora">${h}</span>`).join("")}</div></details></li>`;
  }).join("") : "";

  return `<!doctype html>
<html lang="pt-BR" class="${e(classeAparencia(p))}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${e(titulo)}</title>
<meta name="description" content="${e(descricao)}">
${previa ? '<meta name="robots" content="noindex">' : `<link rel="canonical" href="${e(url)}">`}
<meta property="og:type" content="website">
<meta property="og:title" content="${e(ogTitulo)}">
<meta property="og:description" content="${e(ogDescricao)}">
<meta property="og:url" content="${e(ogUrl)}">
<meta property="og:image" content="${e(imagem)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="theme-color" content="#24272c">
<link rel="icon" href="${c.logo ? `/f/${e(c.logo)}` : "/icons/favicon-v2.png"}">
<link rel="stylesheet" href="/pagina.css">
<script src="/pagina.js" defer></script>
<script type="application/ld+json">${ldJson}</script>
</head>
<body class="${e(classeAparencia(p))}" data-slug="${e(p.slug)}" data-nome="${e(nome)}"
  ${c.whatsapp ? `data-whats="${e(c.whatsapp)}" data-msg-padrao="${e(msgPadrao)}"` : ""}>
${previa ? '<div class="pg-faixa-previa" role="status">Prévia: só você está vendo. Publique em "Minha página" para todos verem.</div>' : ""}
<header class="pg-capa${c.capa ? "" : " sem-foto"}">
  ${c.capa ? `<img class="pg-capa-img" src="/f/${e(c.capa)}" alt="" fetchpriority="high">` : ""}
  <div class="pg-capa-conteudo">
    ${c.logo ? `<img class="pg-logo" src="/f/${e(c.logo)}" alt="Logo da ${e(nome)}" width="112" height="112">` : `<span class="pg-logo pg-logo-letra" aria-hidden="true">${e(nome.trim().charAt(0).toUpperCase())}</span>`}
    <h1>${e(nome)}</h1>
    ${p.frase ? `<p class="pg-frase">${e(p.frase)}</p>` : ""}
    <p class="pg-selos">${temFuncionamento ? `<span class="pg-aberto ${aberto ? "sim" : "nao"}">${aberto ? "Aberto agora" : "Fechado agora"}</span>` : ""}
      ${insta ? `<a class="pg-insta" data-evento="instagram" href="${e(insta)}" target="_blank" rel="noopener">${ICONE_INSTA}@${e(p.instagram)}</a>` : ""}</p>
  </div>
</header>
<main class="pg-corpo">
  ${whats ? `<div class="pg-cta"><a class="pg-botao grande" id="pg-solicitar" data-evento="whatsapp" href="${e(whats)}" target="_blank" rel="noopener">Solicitar meu horário</a>
    <p class="pg-cta-ajuda" id="pg-escolhidos" hidden></p></div>` : ""}
  ${promosHtml && p.mostrar_novidades !== 0 ? `<section class="pg-secao" aria-labelledby="t-promo"><h2 id="t-promo">Novidades e promoções</h2><ul class="pg-promos">${promosHtml}</ul>${c.flyers.length > 1 ? '<p class="pg-promos-dica">Deslize para ver mais · toque para ampliar</p>' : ""}</section>` : ""}
  ${c.servicos.length ? `<section class="pg-secao" aria-labelledby="t-serv"><h2 id="t-serv">Serviços</h2>
    ${c.whatsapp ? '<p class="pg-dica">Toque nos serviços que você quer e depois em <b>Solicitar meu horário</b>.</p>' : ""}
    ${servicosHtml}</section>` : ""}
  ${horariosHtml ? `<section class="pg-secao" aria-labelledby="t-hor"><h2 id="t-hor">Horários livres</h2>
    <p class="pg-dica">Toque no horário para pedir pelo WhatsApp. A barbearia confirma com você.</p><ul class="pg-dias">${horariosHtml}</ul></section>` : ""}
  ${galeriaHtml ? `<section class="pg-secao" aria-labelledby="t-gal"><h2 id="t-gal">Fotos</h2><ul class="pg-galeria">${galeriaHtml}</ul></section>` : ""}
  ${equipeHtml ? `<section class="pg-secao" aria-labelledby="t-eq"><h2 id="t-eq">Equipe</h2><ul class="pg-equipe">${equipeHtml}</ul></section>` : ""}
  ${p.sobre ? `<section class="pg-secao" aria-labelledby="t-sobre"><h2 id="t-sobre">Sobre</h2><p class="pg-sobre">${e(p.sobre)}</p></section>` : ""}
  ${temFuncionamento || linhasEspeciais ? `<section class="pg-secao" aria-labelledby="t-func"><h2 id="t-func">Horário de funcionamento</h2>${temFuncionamento ? `<ul class="pg-funcionamento">${linhasHorario}</ul>` : ""}
    ${linhasEspeciais ? `<div class="pg-especiais" data-teste="aberturas-especiais"><h3>Abertura em caráter especial</h3><ul class="pg-funcionamento">${linhasEspeciais}</ul></div>` : ""}</section>` : ""}
  ${end.completo ? `<section class="pg-secao" aria-labelledby="t-local"><h2 id="t-local">Localização</h2>
    ${mapaEmbutido ? `<div class="pg-mapa"><iframe src="${e(mapaEmbutido)}" title="Mapa: ${e(end.completo)}" loading="lazy" referrerpolicy="no-referrer-when-downgrade" allowfullscreen></iframe></div>` : ""}
    <div class="pg-local"><p><strong>${e(end.linha1)}</strong>${end.linha2 ? `<br>${e(end.linha2)}` : ""}${p.end_cep ? `<br>CEP ${e(p.end_cep)}` : ""}</p>
    <div class="pg-acoes">${mapa ? `<a class="pg-botao" data-evento="rota" href="${e(mapa)}" target="_blank" rel="noopener">Como chegar (Google Maps)</a>` : ""}
      ${waze ? `<a class="pg-botao contorno" data-evento="rota" href="${e(waze)}" target="_blank" rel="noopener">Abrir no Waze</a>` : ""}</div></div></section>` : ""}
  ${insta || c.whatsapp || tel ? `<section class="pg-secao" aria-labelledby="t-cont"><h2 id="t-cont">Contato</h2><ul class="pg-contato">
    ${c.whatsapp ? `<li><a data-evento="whatsapp" href="${e(whats)}" target="_blank" rel="noopener">${ICONE_WHATS}WhatsApp ${e(foneTexto(c.whatsapp))}</a></li>` : ""}
    ${tel ? `<li><a href="tel:+55${e(tel)}">${ICONE_TEL}Telefone ${e(foneTexto(tel))}</a></li>` : ""}
    ${insta ? `<li><a data-evento="instagram" href="${e(insta)}" target="_blank" rel="noopener">${ICONE_INSTA}Instagram @${e(p.instagram)}</a></li>` : ""}</ul></section>` : ""}
  ${c.formas.length ? `<section class="pg-secao" aria-labelledby="t-pag"><h2 id="t-pag">Formas de pagamento</h2>
    <p class="pg-formas">${c.formas.map(f => `<span>${e(FORMAS_PAGINA[f])}</span>`).join("")}</p></section>` : ""}
</main>
<footer class="pg-rodape" aria-label="Sobre o 4blade">
  <div class="pg-4b">
    <a class="pg-4b-marca" href="/" aria-label="4blade: conhecer o sistema"><img src="/icons/logo.png" alt="4blade" width="88" height="36" loading="lazy"></a>
    <p class="pg-4b-texto">Página feita com o <strong>4blade</strong>: agenda, caixa, comissões e WhatsApp num só app para barbearias.</p>
    <p class="pg-4b-acoes"><span>Gostou desta página?</span>
      <a class="pg-4b-link" href="${e(rodape4blade)}" ${rodape4blade.startsWith("https://wa.me") ? 'target="_blank" rel="noopener"' : ""}>Fale com a equipe 4blade</a></p>
  </div>
</footer>
<dialog class="pg-ampliar" id="pg-ampliar" aria-label="Foto ampliada"><button type="button" class="pg-fechar" aria-label="Fechar">×</button><img alt=""><p></p></dialog>
</body>
</html>`;
}

// ---------- EDIÇÃO ("Minha página": dono e gerente) ----------
const CAMPOS_TEXTO = {
  nomeExibicao: ["nome_exibicao", 80], frase: ["frase", 120], sobre: ["sobre", 600], mensagemPadrao: ["mensagem_padrao", 300],
  endRua: ["end_rua", 120], endNumero: ["end_numero", 20], endBairro: ["end_bairro", 80], endCidade: ["end_cidade", 80]
};

function lerCamposPagina(input, atual) {
  const novo = {};
  for (const [k, [col, max]] of Object.entries(CAMPOS_TEXTO)) {
    if (input[k] === undefined) continue;
    const v = textoOpcional(input[k], max);
    if (v === false) erro(`Texto grande demais (máximo ${max} caracteres).`);
    novo[col] = v;
  }
  if (input.endUf !== undefined) {
    const uf = String(input.endUf || "").trim().toUpperCase();
    if (uf && !/^[A-Z]{2}$/.test(uf)) erro("UF inválida (ex.: SP).");
    novo.end_uf = uf || null;
  }
  if (input.endCep !== undefined) {
    const d = String(input.endCep || "").replace(/\D/g, "");
    if (d && d.length !== 8) erro("CEP inválido (8 números).");
    novo.end_cep = d ? `${d.slice(0, 5)}-${d.slice(5)}` : null;
  }
  for (const [k, col] of [["whatsapp", "whatsapp"], ["telefone", "telefone"]]) {
    if (input[k] === undefined) continue;
    const t = String(input[k] || "").trim();
    if (!t) { novo[col] = null; continue; }
    const n = normalizarTelefone(t);
    if (!n) erro(`${k === "whatsapp" ? "WhatsApp" : "Telefone"} inválido: informe DDD + número.`);
    novo[col] = n;
  }
  if (input.instagram !== undefined) {
    const i = String(input.instagram || "").trim().replace(/^@/, "").replace(/^https?:\/\/(www\.)?instagram\.com\//i, "").replace(/\/.*$/, "");
    if (i && !/^[A-Za-z0-9._]{1,30}$/.test(i)) erro("Instagram inválido (ex.: @navalhaeco).");
    novo.instagram = i || null;
  }
  if (input.mapsUrl !== undefined) {
    const u = String(input.mapsUrl || "").trim();
    if (u && (!/^https:\/\/(www\.)?(google\.[a-z.]+\/maps|maps\.google\.[a-z.]+|maps\.app\.goo\.gl|goo\.gl\/maps)/i.test(u) || u.length > 500)) {
      erro("Link do mapa inválido: cole o link do Google Maps (começa com https://).");
    }
    novo.maps_url = u || null;
  }
  if (input.formas !== undefined) {
    if (!Array.isArray(input.formas) || input.formas.some(f => !FORMAS_PAGINA[f])) erro("Formas de pagamento inválidas.");
    novo.formas = JSON.stringify([...new Set(input.formas)]);
  }
  if (input.tema !== undefined) {
    if (!TEMAS.includes(input.tema)) erro("Tema inválido.");
    novo.tema = input.tema;
  }
  if (input.mostrarHorarios !== undefined) novo.mostrar_horarios = input.mostrarHorarios ? 1 : 0;
  const antes = {};
  for (const k of Object.keys(novo)) antes[k] = atual[k] ?? null;
  return { novo, antes };
}

async function dadosEditor(ctx, p) {
  const { db } = ctx;
  const id = ctx.barbeariaId;
  const hoje = hojeBrasil();
  const [b, servs, profs, equipe, fotos, ev, antigos, flyersNoAr] = await Promise.all([
    db.prepare("SELECT nome, telefone FROM barbearias WHERE id = ?").bind(id).first(),
    db.prepare(`SELECT s.id, s.nome, s.preco_centavos, s.duracao_min, ps.visivel, ps.ordem, ps.descricao
                FROM servicos s LEFT JOIN paginas_servicos ps ON ps.servico_id = s.id AND ps.barbearia_id = s.barbearia_id
                WHERE s.barbearia_id = ? AND s.ativo = 1 ORDER BY COALESCE(ps.ordem, 9999), s.nome`).bind(id).all(),
    db.prepare(`SELECT id, nome, perfil FROM usuarios WHERE barbearia_id = ? AND ativo = 1 AND perfil IN ('proprietario','gerente','barbeiro') ORDER BY nome`).bind(id).all(),
    db.prepare("SELECT usuario_id, visivel, ordem, especialidade FROM paginas_equipe WHERE barbearia_id = ?").bind(id).all(),
    db.prepare("SELECT id, tipo, usuario_id, legenda, ordem, bytes FROM paginas_fotos WHERE barbearia_id = ? AND removida_em IS NULL ORDER BY tipo, ordem, criado_em").bind(id).all(),
    db.prepare("SELECT tipo, SUM(quantidade) AS q FROM paginas_eventos WHERE barbearia_id = ? AND dia >= ? GROUP BY tipo").bind(id, somarDias(hoje, -6)).all(),
    db.prepare("SELECT slug, valido_ate FROM paginas_slugs_antigos WHERE barbearia_id = ? AND valido_ate >= ? ORDER BY criado_em DESC").bind(id, hoje).all(),
    db.prepare(`SELECT COUNT(*) AS n FROM paginas_flyers WHERE barbearia_id = ? AND removido_em IS NULL AND publicado = 1 AND ${FLYER_VIVO}
                AND (validade IS NULL OR validade >= ?)`).bind(id, hoje).first()
  ]);
  const eqPor = Object.fromEntries(equipe.results.map(e => [e.usuario_id, e]));
  const fotoEquipe = uid => fotos.results.filter(f => f.tipo === "equipe" && f.usuario_id === uid).at(-1)?.id || null;
  const numeros7 = Object.fromEntries(ev.results.map(r => [r.tipo, Number(r.q)]));
  let formas = [];
  try { formas = JSON.parse(p.formas || "[]"); } catch { /* vazio */ }
  return {
    pagina: {
      slug: p.slug, publicada: Boolean(p.publicada), publicadaEm: p.publicada_em, tema: p.tema, aparencia: aparenciaDe(p), mostrarHorarios: Boolean(p.mostrar_horarios), mostrarNovidades: p.mostrar_novidades !== 0,
      nomeExibicao: p.nome_exibicao, frase: p.frase, sobre: p.sobre, whatsapp: p.whatsapp, mensagemPadrao: p.mensagem_padrao,
      instagram: p.instagram, telefone: p.telefone, endRua: p.end_rua, endNumero: p.end_numero, endBairro: p.end_bairro,
      endCidade: p.end_cidade, endUf: p.end_uf, endCep: p.end_cep, mapsUrl: p.maps_url, formas
    },
    barbearia: { nome: b?.nome, telefone: b?.telefone || null },
    caminho: `/${p.slug}`,
    slugsAntigos: antigos.results.map(a => ({ slug: a.slug, validoAte: a.valido_ate })),
    servicos: servs.results.map(s => ({ id: s.id, nome: s.nome, precoCentavos: s.preco_centavos, duracaoMin: s.duracao_min, visivel: s.visivel !== 0, descricao: s.descricao || "" })),
    equipe: profs.results.map(u => ({ id: u.id, nome: u.nome, visivel: Boolean(eqPor[u.id]?.visivel), especialidade: eqPor[u.id]?.especialidade || "", ordem: eqPor[u.id]?.ordem ?? 999, foto: fotoEquipe(u.id) }))
      .sort((a, b) => a.ordem - b.ordem || a.nome.localeCompare(b.nome)),
    fotos: {
      logo: fotos.results.filter(f => f.tipo === "logo").at(-1)?.id || null,
      capa: fotos.results.filter(f => f.tipo === "capa").at(-1)?.id || null,
      galeria: fotos.results.filter(f => f.tipo === "galeria").map(f => ({ id: f.id, legenda: f.legenda || "" })),
      usoBytes: fotos.results.reduce((s, f) => s + f.bytes, 0), limiteBytes: LIMITE_TOTAL_BYTES, maxGaleria: MAX_GALERIA,
      armazenamento: Boolean(armazenamento(ctx.env))
    },
    numeros7: { visita: numeros7.visita || 0, whatsapp: numeros7.whatsapp || 0, rota: numeros7.rota || 0, instagram: numeros7.instagram || 0 },
    temas: TEMAS, cores: CORES_PAGINA, modos: MODOS_PAGINA, formasDisponiveis: FORMAS_PAGINA,
    flyersNoAr: Number(flyersNoAr?.n || 0)
  };
}

export async function rotasPagina(ctx, path, method) {
  if (path !== "/pagina" && !path.startsWith("/pagina/")) return null;
  if (!ctx.barbeariaId || !isGestao(ctx.user)) erro("Só o dono e o gerente editam a página.", 403);
  const { db } = ctx;

  if (path === "/pagina" && method === "GET") {
    const p = await garantirPagina(ctx);
    return json(await dadosEditor(ctx, p));
  }
  if (path === "/pagina/slug-livre" && method === "GET") {
    const slug = new URL(ctx.request.url).searchParams.get("slug") || "";
    return json({ slug, valido: validSlug(slug), livre: await slugLivre(db, slug, ctx.barbeariaId), reservado: RESERVADOS.has(slug) });
  }
  if (path === "/pagina/numeros" && method === "GET") return json(await numerosPagina(ctx));

  const p = await garantirPagina(ctx);
  if (path === "/pagina/salvar" && method === "POST") return salvarPagina(ctx, p);
  if (path === "/pagina/slug" && method === "POST") {
    const { slug } = await readJson(ctx.request);
    if (!validSlug(slug)) erro(RESERVADOS.has(slug) ? "Esse endereço é reservado pelo sistema. Escolha outro." : "Endereço inválido: use de 3 a 40 letras minúsculas, números ou hífen (sem acento e sem espaço).");
    if (slug === p.slug) return json({ slug });
    if (!(await slugLivre(db, slug, ctx.barbeariaId))) erro("Esse endereço já está em uso. Escolha outro.", 409);
    await db.batch([
      db.prepare("UPDATE paginas SET slug = ?, atualizado_em = CURRENT_TIMESTAMP WHERE barbearia_id = ?").bind(slug, ctx.barbeariaId),
      db.prepare(`INSERT INTO paginas_slugs_antigos (slug, barbearia_id, valido_ate) VALUES (?, ?, ?)
                  ON CONFLICT(slug) DO UPDATE SET barbearia_id = excluded.barbearia_id, valido_ate = excluded.valido_ate`)
        .bind(p.slug, ctx.barbeariaId, somarDias(hojeBrasil(), DIAS_SLUG_ANTIGO)),
      // Voltar a um endereço antigo: ele deixa de ser "antigo" (vence hoje - 1).
      db.prepare("UPDATE paginas_slugs_antigos SET valido_ate = ? WHERE slug = ? AND barbearia_id = ?").bind(somarDias(hojeBrasil(), -1), slug, ctx.barbeariaId),
      auditoria(ctx, "pagina_endereco_alterado", ctx.barbeariaId, { antes: p.slug, depois: slug })
    ]);
    return json({ slug, mensagem: `Endereço alterado. O antigo (/${p.slug}) continua levando para o novo por ${DIAS_SLUG_ANTIGO} dias.` });
  }
  if (path === "/pagina/publicar" && method === "POST") {
    const { publicar } = await readJson(ctx.request);
    const v = publicar ? 1 : 0;
    await db.batch([
      db.prepare(`UPDATE paginas SET publicada = ?, publicada_em = CASE WHEN ? = 1 THEN CURRENT_TIMESTAMP ELSE publicada_em END,
                  atualizado_em = CURRENT_TIMESTAMP WHERE barbearia_id = ?`).bind(v, v, ctx.barbeariaId),
      auditoria(ctx, v ? "pagina_publicada" : "pagina_despublicada", ctx.barbeariaId, { slug: p.slug })
    ]);
    return json({ publicada: Boolean(v), mensagem: v ? "Página publicada: já pode divulgar o link." : "Página fora do ar. Ninguém mais consegue abrir o link." });
  }
  if (path === "/pagina/previa" && method === "POST") {
    const token = crypto.randomUUID().replace(/-/g, "");
    const ate = new Date(Date.now() + 30 * 60000).toISOString();
    await db.prepare("UPDATE paginas SET previa_token = ?, previa_ate = ? WHERE barbearia_id = ?").bind(token, ate, ctx.barbeariaId).run();
    return json({ caminho: `/${p.slug}?previa=${token}`, validoAte: ate });
  }
  if (path === "/pagina/flyers" && method === "GET") return listarFlyers(ctx, p);
  if (path === "/pagina/flyers" && method === "POST") return enviarFlyer(ctx, p);
  if (path === "/pagina/flyers/alterar" && method === "POST") return alterarFlyer(ctx);
  if (path === "/pagina/flyers/excluir" && method === "POST") return excluirFlyer(ctx);
  if (path === "/pagina/foto" && method === "POST") return enviarFoto(ctx, p);
  if (path === "/pagina/foto/alterar" && method === "POST") return alterarFoto(ctx);
  if (path === "/pagina/foto/excluir" && method === "POST") return excluirFoto(ctx);
  return null;
}

async function salvarPagina(ctx, p) {
  const { db } = ctx;
  const input = await readJson(ctx.request, 24 * 1024);
  const { novo, antes } = lerCamposPagina(input, p);
  const cmds = [];
  const dif = diferenca(antes, novo);
  if (dif.mudou) {
    const cols = Object.keys(dif.depois);
    cmds.push(db.prepare(`UPDATE paginas SET ${cols.map(c => `${c} = ?`).join(", ")}, atualizado_em = CURRENT_TIMESTAMP WHERE barbearia_id = ?`)
      .bind(...cols.map(c => dif.depois[c]), ctx.barbeariaId));
  }
  let mudouServicos = false, mudouEquipe = false, mudouAparencia = null, mudouNovidades = null;
  if (input.mostrarNovidades !== undefined) {
    const nv = input.mostrarNovidades ? 1 : 0;
    if (nv !== p.mostrar_novidades) {
      cmds.push(db.prepare(`INSERT INTO paginas_opcoes (barbearia_id, mostrar_novidades, atualizado_por) VALUES (?, ?, ?)
                            ON CONFLICT(barbearia_id) DO UPDATE SET mostrar_novidades = excluded.mostrar_novidades, atualizado_por = excluded.atualizado_por, atualizado_em = CURRENT_TIMESTAMP`)
        .bind(ctx.barbeariaId, nv, ctx.user.id));
      mudouNovidades = { antes: Boolean(p.mostrar_novidades), depois: Boolean(nv) };
    }
  }
  if (input.cor !== undefined || input.modo !== undefined || input.tema !== undefined) {
    const atual = aparenciaDe(p);
    const base = input.tema !== undefined && TEMA_ANTIGO[input.tema] ? { cor: TEMA_ANTIGO[input.tema][0], modo: TEMA_ANTIGO[input.tema][1] } : atual;
    const nova = { cor: input.cor ?? base.cor, modo: input.modo ?? base.modo };
    if (!CORES_PAGINA.includes(nova.cor)) erro("Cor inválida.");
    if (!MODOS_PAGINA.includes(nova.modo)) erro("Aparência inválida.");
    if (nova.cor !== atual.cor || nova.modo !== atual.modo || !p.ap_cor) {
      cmds.push(db.prepare(`INSERT INTO paginas_aparencia (barbearia_id, cor, modo, atualizado_por) VALUES (?, ?, ?, ?)
                            ON CONFLICT(barbearia_id) DO UPDATE SET cor = excluded.cor, modo = excluded.modo, atualizado_por = excluded.atualizado_por, atualizado_em = CURRENT_TIMESTAMP`)
        .bind(ctx.barbeariaId, nova.cor, nova.modo, ctx.user.id));
      if (nova.cor !== atual.cor || nova.modo !== atual.modo) mudouAparencia = { antes: atual, depois: nova };
    }
  }
  if (input.servicos !== undefined) {
    if (!Array.isArray(input.servicos) || input.servicos.length > 200) erro("Lista de serviços inválida.");
    const meus = new Set((await db.prepare("SELECT id FROM servicos WHERE barbearia_id = ?").bind(ctx.barbeariaId).all()).results.map(s => s.id));
    input.servicos.forEach((s, i) => {
      if (!s || !validId(s.id) || !meus.has(s.id)) erro("Serviço inválido.");
      const desc = textoOpcional(s.descricao, 140);
      if (desc === false) erro("Descrição do serviço grande demais (até 140 caracteres).");
      cmds.push(db.prepare(`INSERT INTO paginas_servicos (barbearia_id, servico_id, visivel, ordem, descricao) VALUES (?, ?, ?, ?, ?)
                            ON CONFLICT(barbearia_id, servico_id) DO UPDATE SET visivel = excluded.visivel, ordem = excluded.ordem, descricao = excluded.descricao`)
        .bind(ctx.barbeariaId, s.id, s.visivel === false ? 0 : 1, i, desc));
    });
    mudouServicos = true;
  }
  if (input.equipe !== undefined) {
    if (!Array.isArray(input.equipe) || input.equipe.length > 100) erro("Lista da equipe inválida.");
    const meus = new Set((await db.prepare("SELECT id FROM usuarios WHERE barbearia_id = ? AND perfil IN ('proprietario','gerente','barbeiro')").bind(ctx.barbeariaId).all()).results.map(u => u.id));
    input.equipe.forEach((u, i) => {
      if (!u || !validId(u.id) || !meus.has(u.id)) erro("Profissional inválido.");
      const esp = textoOpcional(u.especialidade, 60);
      if (esp === false) erro("Especialidade grande demais (até 60 caracteres).");
      cmds.push(db.prepare(`INSERT INTO paginas_equipe (barbearia_id, usuario_id, visivel, ordem, especialidade) VALUES (?, ?, ?, ?, ?)
                            ON CONFLICT(barbearia_id, usuario_id) DO UPDATE SET visivel = excluded.visivel, ordem = excluded.ordem, especialidade = excluded.especialidade`)
        .bind(ctx.barbeariaId, u.id, u.visivel ? 1 : 0, i, esp));
    });
    mudouEquipe = true;
  }
  if (!cmds.length) return json({ mensagem: "Nada mudou." });
  cmds.push(auditoria(ctx, "pagina_editada", ctx.barbeariaId, {
    ...(dif.mudou ? { antes: dif.antes, depois: dif.depois } : {}),
    ...(mudouServicos ? { servicos: input.servicos.map(s => `${s.visivel === false ? "-" : "+"}${s.id.slice(0, 8)}`) } : {}),
    ...(mudouEquipe ? { equipe: input.equipe.map(u => `${u.visivel ? "+" : "-"}${u.id.slice(0, 8)}`) } : {}),
    ...(mudouAparencia ? { aparencia: mudouAparencia } : {}),
    ...(mudouNovidades ? { mostrarNovidades: mudouNovidades } : {})
  }));
  await db.batch(cmds);
  return json({ mensagem: "Página salva." });
}

// Foto: o corpo é o arquivo (já reduzido no celular). Tipo conferido pelo conteúdo; EXIF removido.
async function enviarFoto(ctx, p) {
  const { db, env, request } = ctx;
  const r2 = armazenamento(env);
  if (!r2) erro("O envio de fotos ainda não está ligado neste servidor. Fale com o suporte.", 503);
  const url = new URL(request.url);
  const tipo = url.searchParams.get("tipo");
  if (!["logo", "capa", "galeria", "equipe"].includes(tipo)) erro("Tipo de foto inválido.");
  const usuarioId = tipo === "equipe" ? url.searchParams.get("usuarioId") : null;
  if (tipo === "equipe") {
    if (!validId(usuarioId)) erro("Profissional inválido.");
    const u = await db.prepare("SELECT 1 FROM usuarios WHERE id = ? AND barbearia_id = ?").bind(usuarioId, ctx.barbeariaId).first();
    if (!u) erro("Profissional não encontrado.", 404);
  }
  const legenda = textoOpcional(url.searchParams.get("legenda") || "", 140);
  if (legenda === false) erro("Legenda grande demais (até 140 caracteres).");
  const tam = Number(request.headers.get("content-length") || 0);
  if (tam > MAX_FOTO_BYTES) erro("Foto grande demais (máximo 700 KB). Escolha outra ou diminua.", 413);
  const bruto = new Uint8Array(await request.arrayBuffer());
  if (bruto.length > MAX_FOTO_BYTES) erro("Foto grande demais (máximo 700 KB). Escolha outra ou diminua.", 413);
  if (bruto.length < 100) erro("Arquivo vazio ou inválido.");
  const mime = tipoImagem(bruto);
  if (!mime) erro("Arquivo não é uma imagem aceita (JPG, PNG ou WEBP).", 415);
  const bytes = semExif(bruto, mime);
  const ativas = (await db.prepare("SELECT id, tipo, usuario_id, bytes FROM paginas_fotos WHERE barbearia_id = ? AND removida_em IS NULL").bind(ctx.barbeariaId).all()).results;
  // Logo, capa e foto do profissional: a nova substitui a anterior (a anterior é apagada do armazenamento).
  const substituidas = tipo === "galeria" ? [] : ativas.filter(f => f.tipo === tipo && (tipo !== "equipe" || f.usuario_id === usuarioId));
  if (tipo === "galeria" && ativas.filter(f => f.tipo === "galeria").length >= MAX_GALERIA) erro(`A galeria já tem ${MAX_GALERIA} fotos. Exclua uma para enviar outra.`, 409);
  const uso = ativas.reduce((s, f) => s + f.bytes, 0) - substituidas.reduce((s, f) => s + f.bytes, 0);
  if (uso + bytes.length > LIMITE_TOTAL_BYTES) erro("Limite de 15 MB de fotos da barbearia atingido. Exclua alguma foto antes.", 409);
  const id = crypto.randomUUID();
  const ordem = tipo === "galeria" ? ativas.filter(f => f.tipo === "galeria").length : 0;
  await r2.put(chaveFoto(ctx.barbeariaId, id), bytes, { httpMetadata: { contentType: mime } });
  await db.batch([
    db.prepare(`INSERT INTO paginas_fotos (id, barbearia_id, tipo, usuario_id, mime, bytes, legenda, ordem, criado_por) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(id, ctx.barbeariaId, tipo, usuarioId, mime, bytes.length, legenda, ordem, ctx.user.id),
    ...substituidas.map(f => db.prepare("UPDATE paginas_fotos SET removida_em = CURRENT_TIMESTAMP, removida_por = ? WHERE id = ?").bind(ctx.user.id, f.id)),
    auditoria(ctx, "pagina_foto_enviada", id, { tipo, bytes: bytes.length, ...(substituidas.length ? { substituiu: substituidas.map(f => f.id) } : {}) })
  ]);
  for (const f of substituidas) await r2.delete(chaveFoto(ctx.barbeariaId, f.id));
  return json({ foto: { id, tipo, bytes: bytes.length, mime }, mensagem: "Foto enviada." }, 201);
}

async function fotoDaBarbearia(ctx, id) {
  if (!validId(id)) erro("Foto inválida.");
  const f = await ctx.db.prepare("SELECT * FROM paginas_fotos WHERE id = ? AND barbearia_id = ? AND removida_em IS NULL").bind(id, ctx.barbeariaId).first();
  if (!f) erro("Foto não encontrada.", 404);
  return f;
}

async function alterarFoto(ctx) {
  const { db } = ctx;
  const input = await readJson(ctx.request);
  const f = await fotoDaBarbearia(ctx, input.id);
  const cmds = [];
  if (input.legenda !== undefined) {
    const legenda = textoOpcional(input.legenda, 140);
    if (legenda === false) erro("Legenda grande demais (até 140 caracteres).");
    cmds.push(db.prepare("UPDATE paginas_fotos SET legenda = ? WHERE id = ?").bind(legenda, f.id));
  }
  if (input.mover === -1 || input.mover === 1) {
    if (f.tipo !== "galeria") erro("Só as fotos da galeria mudam de ordem.");
    const lista = (await db.prepare("SELECT id FROM paginas_fotos WHERE barbearia_id = ? AND tipo = 'galeria' AND removida_em IS NULL ORDER BY ordem, criado_em")
      .bind(ctx.barbeariaId).all()).results.map(x => x.id);
    const i = lista.indexOf(f.id), j = i + input.mover;
    if (j >= 0 && j < lista.length) [lista[i], lista[j]] = [lista[j], lista[i]];
    lista.forEach((id, k) => cmds.push(db.prepare("UPDATE paginas_fotos SET ordem = ? WHERE id = ?").bind(k, id)));
  }
  if (!cmds.length) return json({ mensagem: "Nada mudou." });
  cmds.push(auditoria(ctx, "pagina_foto_alterada", f.id, { legenda: input.legenda !== undefined ? { antes: f.legenda, depois: input.legenda } : undefined, mover: input.mover }));
  await db.batch(cmds);
  return json({ mensagem: "Foto atualizada." });
}

// Excluir foto: o arquivo é apagado do armazenamento (decisão do responsável); o registro fica, com quem e quando.
async function excluirFoto(ctx) {
  const { db, env } = ctx;
  const input = await readJson(ctx.request);
  const f = await fotoDaBarbearia(ctx, input.id);
  await db.batch([
    db.prepare("UPDATE paginas_fotos SET removida_em = CURRENT_TIMESTAMP, removida_por = ? WHERE id = ?").bind(ctx.user.id, f.id),
    auditoria(ctx, "pagina_foto_excluida", f.id, { tipo: f.tipo, legenda: f.legenda, bytes: f.bytes })
  ]);
  const r2 = armazenamento(env);
  if (r2) await r2.delete(chaveFoto(ctx.barbeariaId, f.id));
  return json({ mensagem: "Foto excluída." });
}

// ---------- FLYERS (25/11/2026) ----------
// A imagem é desenhada no aparelho (tela "Flyers"); aqui o servidor só confere, guarda no R2 e publica no catálogo.
const flyerPublico = (f, p, origem) => ({
  id: f.id, titulo: f.titulo, texto: f.texto || null, estilo: f.estilo, formato: f.formato, validade: f.validade || null,
  publicado: Boolean(f.publicado), noAr: Boolean(f.publicado) && (!f.validade || f.validade >= hojeBrasil()),
  criadoEm: f.criado_em, expiraEm: new Date(Date.parse(`${String(f.criado_em).replace(" ", "T")}Z`) + HORAS_FLYER * 3600e3).toISOString(),
  bytes: f.bytes, imagem: `/f/${f.id}`, link: `${origem}/${p.slug}?promo=${f.id}`,
  dados: (() => { try { return JSON.parse(f.dados || "null"); } catch { return null; } })()
});

async function listarFlyers(ctx, p) {
  await limparFlyersExpirados(ctx.db, ctx.env, ctx.barbeariaId);   // limpeza também ao abrir a Divulgação (além da de hora em hora)
  const r = await ctx.db.prepare(`SELECT * FROM paginas_flyers WHERE barbearia_id = ? AND removido_em IS NULL AND ${FLYER_VIVO} ORDER BY criado_em DESC`)
    .bind(ctx.barbeariaId).all();
  const origem = new URL(ctx.request.url).origin;
  return json({ flyers: r.results.map(f => flyerPublico(f, p, origem)), limite: MAX_FLYERS, estilos: ESTILOS_FLYER, formatos: FORMATOS_FLYER,
    paginaPublicada: Boolean(p.publicada), mostrarNovidades: p.mostrar_novidades !== 0, slug: p.slug });
}

function lerValidade(v) {
  if (v === undefined) return undefined;
  if (v === null || v === "") return null;
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) erro("Data de validade inválida.");
  if (v < hojeBrasil()) erro("A validade não pode ser uma data que já passou.");
  return v;
}

async function enviarFlyer(ctx, p) {
  const { db, env, request } = ctx;
  const r2 = armazenamento(env);
  if (!r2) erro("O envio de imagens ainda não está ligado neste servidor. Fale com o suporte.", 503);
  let meta;
  try { meta = JSON.parse(new URL(request.url).searchParams.get("meta") || "{}"); } catch { erro("Dados do flyer inválidos."); }
  const titulo = textoOpcional(meta.titulo, 80);
  if (!titulo) erro("Escreva o texto principal do flyer (até 80 caracteres).");
  const texto = textoOpcional(meta.texto || "", 200);
  if (texto === false) erro("Texto grande demais (até 200 caracteres).");
  if (!ESTILOS_FLYER.includes(meta.estilo)) erro("Estilo inválido.");
  if (!FORMATOS_FLYER.includes(meta.formato)) erro("Formato inválido.");
  const validade = lerValidade(meta.validade ?? null);
  const dados = meta.dados && typeof meta.dados === "object" ? JSON.stringify(meta.dados).slice(0, 4000) : null;
  const tam = Number(request.headers.get("content-length") || 0);
  if (tam > MAX_FLYER_BYTES) erro("Imagem do flyer grande demais (máximo 1,2 MB).", 413);
  const bruto = new Uint8Array(await request.arrayBuffer());
  if (bruto.length > MAX_FLYER_BYTES) erro("Imagem do flyer grande demais (máximo 1,2 MB).", 413);
  if (bruto.length < 100) erro("Arquivo vazio ou inválido.");
  const mime = tipoImagem(bruto);
  if (!mime) erro("Arquivo não é uma imagem aceita (JPG, PNG ou WEBP).", 415);
  const bytes = semExif(bruto, mime);
  const ativos = await db.prepare(`SELECT COUNT(*) AS n FROM paginas_flyers WHERE barbearia_id = ? AND removido_em IS NULL AND ${FLYER_VIVO}`).bind(ctx.barbeariaId).first();
  if (Number(ativos.n) >= MAX_FLYERS) erro(`Você já tem ${MAX_FLYERS} flyers guardados. Exclua um antigo para publicar outro.`, 409);
  const noCarrossel = meta.noCarrossel !== false;   // 25/11/2026: o gerente escolhe se vai para "Novidades e promoções"
  const id = crypto.randomUUID();
  await r2.put(chaveFoto(ctx.barbeariaId, id), bytes, { httpMetadata: { contentType: mime } });
  await db.batch([
    db.prepare(`INSERT INTO paginas_flyers (id, barbearia_id, titulo, texto, estilo, formato, dados, mime, bytes, validade, criado_por, publicado)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(id, ctx.barbeariaId, titulo, texto || null, meta.estilo, meta.formato, dados, mime, bytes.length, validade, ctx.user.id, noCarrossel ? 1 : 0),
    auditoria(ctx, "flyer_publicado", id, { titulo, estilo: meta.estilo, formato: meta.formato, validade, bytes: bytes.length, noCarrossel })
  ]);
  const f = await db.prepare("SELECT * FROM paginas_flyers WHERE id = ?").bind(id).first();
  return json({ flyer: flyerPublico(f, p, new URL(request.url).origin), paginaPublicada: Boolean(p.publicada),
    mensagem: !noCarrossel ? "Flyer guardado (fora do carrossel da página). Já pode compartilhar."
      : p.publicada ? "Flyer publicado nas Novidades da sua página." : "Flyer guardado. Ele aparece nas Novidades quando a sua página estiver publicada." }, 201);
}

async function flyerDaBarbearia(ctx, id) {
  if (!validId(id)) erro("Flyer inválido.");
  const f = await ctx.db.prepare(`SELECT * FROM paginas_flyers WHERE id = ? AND barbearia_id = ? AND removido_em IS NULL AND ${FLYER_VIVO}`).bind(id, ctx.barbeariaId).first();
  if (!f) erro("Flyer não encontrado.", 404);
  return f;
}

async function alterarFlyer(ctx) {
  const { db } = ctx;
  const input = await readJson(ctx.request);
  const f = await flyerDaBarbearia(ctx, input.id);
  const novo = { publicado: f.publicado, validade: f.validade || null };
  if (input.publicado !== undefined) novo.publicado = input.publicado ? 1 : 0;
  const v = lerValidade(input.validade);
  if (v !== undefined) novo.validade = v;
  const dif = diferenca({ publicado: f.publicado, validade: f.validade || null }, novo);
  if (!dif.mudou) erro("Nada foi alterado.");
  await db.batch([
    db.prepare("UPDATE paginas_flyers SET publicado = ?, validade = ?, atualizado_em = CURRENT_TIMESTAMP WHERE id = ? AND barbearia_id = ?")
      .bind(novo.publicado, novo.validade, f.id, ctx.barbeariaId),
    auditoria(ctx, "flyer_alterado", f.id, { antes: dif.antes, depois: dif.depois })
  ]);
  return json({ mensagem: novo.publicado ? "Flyer de volta nas Novidades da página." : "Flyer oculto da página (continua guardado aqui)." });
}

async function excluirFlyer(ctx) {
  const { db, env } = ctx;
  const input = await readJson(ctx.request);
  const f = await flyerDaBarbearia(ctx, input.id);
  await db.batch([
    db.prepare("UPDATE paginas_flyers SET removido_em = CURRENT_TIMESTAMP, removido_por = ? WHERE id = ?").bind(ctx.user.id, f.id),
    auditoria(ctx, "flyer_excluido", f.id, { titulo: f.titulo, estilo: f.estilo, bytes: f.bytes })
  ]);
  const r2 = armazenamento(env);
  if (r2) await r2.delete(chaveFoto(ctx.barbeariaId, f.id));
  return json({ mensagem: "Flyer excluído." });
}

async function numerosPagina(ctx) {
  const url = new URL(ctx.request.url);
  const periodo = url.searchParams.get("periodo") || "7";
  const hoje = hojeBrasil();
  const ini = periodo === "30" ? somarDias(hoje, -29) : periodo === "mes" ? `${hoje.slice(0, 8)}01` : somarDias(hoje, -6);
  const r = await ctx.db.prepare("SELECT dia, tipo, quantidade FROM paginas_eventos WHERE barbearia_id = ? AND dia BETWEEN ? AND ? ORDER BY dia")
    .bind(ctx.barbeariaId, ini, hoje).all();
  const dias = [];
  for (let d = ini; d <= hoje; d = somarDias(d, 1)) dias.push({ dia: d, visita: 0, whatsapp: 0, rota: 0, instagram: 0 });
  const por = Object.fromEntries(dias.map(x => [x.dia, x]));
  const totais = { visita: 0, whatsapp: 0, rota: 0, instagram: 0 };
  for (const x of r.results) { if (por[x.dia]) por[x.dia][x.tipo] = x.quantidade; totais[x.tipo] += x.quantidade; }
  return { periodo, inicio: ini, fim: hoje, dias, totais };
}

// Limpeza dos flyers com mais de 24 h: marca como removido (nada some do histórico) e apaga a imagem do R2.
// Roda de hora em hora (scheduled em index.js) e ao abrir a Divulgação. barbeariaId = só daquela barbearia.
export async function limparFlyersExpirados(db, env, barbeariaId = null, limite = 200) {
  const r = await db.prepare(`SELECT id, barbearia_id, titulo, bytes FROM paginas_flyers WHERE removido_em IS NULL AND NOT (${FLYER_VIVO})
                              ${barbeariaId ? "AND barbearia_id = ?" : ""} LIMIT ?`).bind(...(barbeariaId ? [barbeariaId, limite] : [limite])).all();
  if (!r.results.length) return 0;
  // primeiro apaga os arquivos (se falhar, o flyer continua para a próxima limpeza tentar de novo)
  const r2 = armazenamento(env);
  const apagados = [];
  for (const f of r.results) { try { if (r2) await r2.delete(chaveFoto(f.barbearia_id, f.id)); apagados.push(f); } catch { /* fica para a próxima */ } }
  if (!apagados.length) return 0;
  await db.batch(apagados.flatMap(f => [
    db.prepare("UPDATE paginas_flyers SET removido_em = CURRENT_TIMESTAMP, removido_por = NULL WHERE id = ? AND removido_em IS NULL").bind(f.id),
    db.prepare("INSERT INTO auditoria (barbearia_id, usuario_id, acao, alvo, detalhes) VALUES (?, NULL, 'flyer_expirado', ?, ?)")
      .bind(f.barbearia_id, f.id, JSON.stringify({ titulo: f.titulo, bytes: f.bytes, horas: HORAS_FLYER }))
  ]));
  return apagados.length;
}
