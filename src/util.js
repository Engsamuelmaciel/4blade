// Utilitários compartilhados. Origem: FrotaZ (referencia/frotaz/src/util.js), adaptado ao 4blade.
export const encoder = new TextEncoder();
export const ITERACOES = 100000;

export const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff"
    }
  });

export const fail = (message, status = 400) => json({ erro: message }, status);

export class HttpError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

export const hex = bytes =>
  Array.from(new Uint8Array(bytes)).map(b => b.toString(16).padStart(2, "0")).join("");

export const random = (size = 32) => crypto.getRandomValues(new Uint8Array(size));

// Senha provisória fácil de ditar e digitar no celular: 10 caracteres sem os que se confundem (0/O, 1/I/L).
const ALFABETO_PROVISORIA = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export function gerarSenhaProvisoria(tamanho = 10) {
  const n = ALFABETO_PROVISORIA.length;
  const limite = 256 - (256 % n);
  let saida = "";
  while (saida.length < tamanho) {
    for (const b of random(32)) {
      if (b < limite && saida.length < tamanho) saida += ALFABETO_PROVISORIA[b % n];
    }
  }
  return saida;
}

export const b64url = bytes =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

export async function sha256(value) {
  return hex(await crypto.subtle.digest("SHA-256", encoder.encode(value)));
}

export function safeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const aa = encoder.encode(a);
  const bb = encoder.encode(b);
  let difference = aa.length ^ bb.length;
  for (let i = 0; i < Math.max(aa.length, bb.length); i++) difference |= (aa[i] || 0) ^ (bb[i] || 0);
  return difference === 0;
}

function fromHex(value) {
  if (typeof value !== "string" || !/^(?:[a-f0-9]{2})+$/i.test(value)) throw new Error("Salt inválido");
  return new Uint8Array(value.match(/.{2}/g).map(x => parseInt(x, 16)));
}

export async function derive(password, salt, iterations = ITERACOES) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: fromHex(salt), iterations, hash: "SHA-256" }, key, 256
  );
  return hex(bits);
}

export async function hashPassword(password) {
  const salt = hex(random(16));
  return `pbkdf2$${ITERACOES}$${salt}$${await derive(password, salt)}`;
}

export async function checkPassword(password, encoded) {
  const parts = String(encoded || "").split("$");
  if (parts.length !== 4 || parts[0] !== "pbkdf2" || parts[1] !== String(ITERACOES)) return false;
  try {
    return safeEqual(await derive(password, parts[2]), parts[3]);
  } catch {
    return false;
  }
}

export async function readJson(request, max = 8192) {
  const length = Number(request.headers.get("content-length") || 0);
  if (length > max) throw new HttpError("Dados grandes demais", 413);
  const text = await request.text();
  if (text.length > max) throw new HttpError("Dados grandes demais", 413);
  let data;
  try {
    data = JSON.parse(text || "{}");
  } catch {
    throw new HttpError("JSON inválido", 400);
  }
  if (data === null || typeof data !== "object" || Array.isArray(data)) {
    throw new HttpError("O corpo deve ser um objeto JSON", 400);
  }
  return data;
}

// ---------- VALIDAÇÕES ----------
// Usuário de acesso: minúsculas, números, ponto, hífen e sublinhado (3 a 30). Ex.: joao.barbeariax
export const validLogin = v => typeof v === "string" && /^[a-z0-9][a-z0-9._-]{2,29}$/.test(v);
export const normalizarLogin = v => (typeof v === "string" ? v.trim().toLowerCase() : v);
export const validId = v => typeof v === "string" && /^[a-f0-9-]{36}$/i.test(v);

// Texto curto obrigatório: espaços extras removidos. Devolve null se inválido.
export function textoLimpo(v, min = 2, max = 120) {
  if (typeof v !== "string") return null;
  const t = v.trim().replace(/\s+/g, " ");
  return t.length >= min && t.length <= max ? t : null;
}

// Texto opcional (observação etc.). undefined/null/"" → null. Devolve false se inválido.
export function textoOpcional(v, max = 500) {
  if (v === undefined || v === null) return null;
  if (typeof v !== "string") return false;
  const t = v.trim();
  if (!t) return null;
  return t.length <= max ? t : false;
}

// Dinheiro sempre em centavos (inteiro). Até R$ 100.000,00.
export const validCentavos = v => Number.isInteger(v) && v >= 0 && v <= 10_000_000;
// Percentual em centésimos (0 a 10000 = 0% a 100%).
export const validBp = v => Number.isInteger(v) && v >= 0 && v <= 10000;

// Telefone brasileiro: só dígitos, com DDD (10 ou 11). Aceita +55 na frente. Devolve null se inválido.
export function normalizarTelefone(v) {
  if (typeof v !== "string") return null;
  let d = v.replace(/\D/g, "");
  if ((d.length === 12 || d.length === 13) && d.startsWith("55")) d = d.slice(2);
  if (d.length !== 10 && d.length !== 11) return null;
  if (d[0] === "0") return null;
  return d;
}

// Fuso America/Sao_Paulo (sem horário de verão desde 2019: UTC−3).
export function hojeBrasil(now = Date.now()) {
  return new Date(now - 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export function validDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T12:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

// Motivo obrigatório (desativar, bloquear, redefinir senha).
export function exigirMotivo(v) {
  const m = textoLimpo(v, 3, 300);
  if (!m) throw new HttpError("Informe o motivo (3 a 300 caracteres).", 400);
  return m;
}

// ---------- AUDITORIA ----------
// Devolve o comando de gravação (para ir no mesmo lote da alteração). Nunca recebe senha nem token.
export function auditoria(ctx, acao, alvo = null, detalhes = null) {
  return ctx.db.prepare(`
    INSERT INTO auditoria (barbearia_id, usuario_id, acao, alvo, detalhes, ip_hash)
    VALUES (?, ?, ?, ?, ?, ?)
  `).bind(
    ctx.barbeariaId ?? null,
    ctx.usuarioId ?? null,
    acao,
    alvo,
    detalhes ? JSON.stringify(detalhes).slice(0, 4000) : null,
    ctx.ipHash ?? null
  );
}

// Diferença antes/depois só dos campos que mudaram.
export function diferenca(antes, depois) {
  const a = {};
  const d = {};
  for (const k of Object.keys(depois)) {
    if (antes[k] !== depois[k]) {
      a[k] = antes[k];
      d[k] = depois[k];
    }
  }
  return { antes: a, depois: d, mudou: Object.keys(d).length > 0 };
}

// Igual a auditoria(), mas só grava se a condição SQL for verdadeira (para lotes em que a operação pode não acontecer).
export function auditoriaSe(ctx, condicaoSql, condicaoParams, acao, alvo = null, detalhes = null) {
  return ctx.db.prepare(`
    INSERT INTO auditoria (barbearia_id, usuario_id, acao, alvo, detalhes, ip_hash)
    SELECT ?, ?, ?, ?, ?, ? WHERE ${condicaoSql}
  `).bind(
    ctx.barbeariaId ?? null, ctx.usuarioId ?? null, acao, alvo,
    detalhes ? JSON.stringify(detalhes).slice(0, 4000) : null, ctx.ipHash ?? null, ...condicaoParams
  );
}
