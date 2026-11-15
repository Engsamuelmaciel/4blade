// Utilitários compartilhados (copiados do SIGEO v2.65.5: src/index.js).
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

export const fail = (message, status = 400) =>
  json({ erro: message }, status);

export class HttpError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

export const hex = bytes =>
  Array.from(new Uint8Array(bytes))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");


export const random = (size = 32) =>
  crypto.getRandomValues(new Uint8Array(size));

// Senha provisória fácil de ditar e digitar no celular: 10 caracteres sem os que
// se confundem (0/O, 1/I/L). ~50 bits; com o limite de 5 tentativas por R3 a cada
// 15 minutos e a troca obrigatória no 1º acesso, é suficiente.
const ALFABETO_PROVISORIA = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export function gerarSenhaProvisoria(tamanho = 10) {
  const n = ALFABETO_PROVISORIA.length;
  const limite = 256 - (256 % n);  // descarta sobras para não viciar o sorteio
  let saida = "";
  while (saida.length < tamanho) {
    for (const b of random(32)) {
      if (b < limite && saida.length < tamanho) saida += ALFABETO_PROVISORIA[b % n];
    }
  }
  return saida;
}

export const b64url = bytes =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");


export async function sha256(value) {
  return hex(
    await crypto.subtle.digest("SHA-256", encoder.encode(value))
  );
}

export function safeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string") {
    return false;
  }

  const aa = encoder.encode(a);
  const bb = encoder.encode(b);

  let difference = aa.length ^ bb.length;

  for (let i = 0; i < Math.max(aa.length, bb.length); i++) {
    difference |= (aa[i] || 0) ^ (bb[i] || 0);
  }

  return difference === 0;
}
function fromHex(value) {
  if (typeof value !== "string" || !/^(?:[a-f0-9]{2})+$/i.test(value)) {
    throw new Error("Salt inválido");
  }

  return new Uint8Array(
    value.match(/.{2}/g).map(x => parseInt(x, 16))
  );
}

export async function derive(password, salt, iterations = ITERACOES) {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );

  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: fromHex(salt),
      iterations,
      hash: "SHA-256"
    },
    key,
    256
  );

  return hex(bits);
}

export async function hashPassword(password) {
  const salt = hex(random(16));
  const hash = await derive(password, salt);

  return `pbkdf2$${ITERACOES}$${salt}$${hash}`;
}

export async function checkPassword(password, encoded) {
  const parts = String(encoded || "").split("$");

  if (
    parts.length !== 4 ||
    parts[0] !== "pbkdf2" ||
    parts[1] !== String(ITERACOES)
  ) {
    return false;
  }

  try {
    return safeEqual(await derive(password, parts[2]), parts[3]);
  } catch {
    return false;
  }
}

export const validR3 = value =>
  typeof value === "string" && /^[A-Za-z0-9-]{3,24}$/.test(value);

export const validId = value =>
  typeof value === "string" && /^[a-f0-9-]{36}$/i.test(value);
export async function readJson(request, max = 4096) {
  const length = Number(request.headers.get("content-length") || 0);

  if (length > max) {
    throw new HttpError("Payload excede limite", 413);
  }

  const text = await request.text();

  if (text.length > max) {
    throw new HttpError("Payload excede limite", 413);
  }

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

export function hojeBrasil(now = Date.now()) {
  return new Date(now - 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export function somarDias(isoDate, dias) {
  const d = new Date(`${isoDate}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

export function validDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const d = new Date(`${value}T12:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

// ---------- PERFIS ----------
// Perfil "administrador" no banco = usuário MASTER na tela (nível mais alto).
export const isManager = user => ["supervisor", "gerente", "administrador"].includes(user.perfil);
// Supervisor ou Master: cadastram frota, planos e aprovadores.
export const isSupervisorOuMaster = user => ["supervisor", "administrador"].includes(user.perfil);
export const isGestao = isManager;

// Hierarquia: Master > supervisor > gerente > demais. Só se aprova recuperação de quem está ABAIXO do aprovador.
export const NIVEL = { operador: 1, mecanico: 1, gerente: 2, supervisor: 3, administrador: 4 };

// ---------- AUDITORIA ----------
// Registra quem fez o quê. Nunca recebe senha nem token. Falha na auditoria não derruba a operação principal.
export async function audit(db, request, usuarioId, acao, alvo = null, detalhes = null) {
  try {
    const ip = request.headers.get("CF-Connecting-IP") || "unknown";
    await db.prepare(`
      INSERT INTO auditoria (usuario_id, acao, alvo, detalhes, ip_hash)
      VALUES (?, ?, ?, ?, ?)
    `).bind(
      usuarioId || null,
      acao,
      alvo,
      detalhes ? JSON.stringify(detalhes).slice(0, 1000) : null,
      (await sha256(ip)).slice(0, 16)
    ).run();
  } catch (error) {
    console.error("Falha ao gravar auditoria:", acao, error?.message || error);
  }
}
