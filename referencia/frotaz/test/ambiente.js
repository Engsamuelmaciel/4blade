// Ambiente de teste compartilhado: Worker + banco SQLite em memória (dados fictícios; frota de teste semeada aqui).
import assert from "node:assert/strict";
import worker from "../src/index.js";
import { criarBanco, LIMITE_CONSULTAS } from "./d1-local.js";

export const TOKEN_SETUP = "token-de-teste-apenas-local";

// Frota FICTÍCIA de teste (o produto novo nasce sem equipamentos: cada cliente cadastra a sua).
export const FROTA_TESTE = [
  ["CB6013", "basculante", "RCA"], ["CB6027", "basculante", "RCA"], ["CP6022", "pipa", "RCA"], ["CP6025", "pipa", "RCA"],
  ["PC798", "pa_carregadeira", "RCA"], ["PC894", "pa_carregadeira", "RCA"], ["MT637", "motoniveladora", "RCA"], ["MT638", "motoniveladora", "RCA"],
  ["TE700", "trator_esteira", "RCA"], ["CB6018", "basculante", "RIT"], ["CB6026", "basculante", "RIT"], ["CP6019", "pipa", "RIT"],
  ["CP6024", "pipa", "RIT"], ["PC789", "pa_carregadeira", "RIT"], ["8058", "escavadeira", "RIT"], ["MT636", "motoniveladora", "RIT"]
];
function semearFrota(db) {
  for (const [codigo, tipo, regional] of FROTA_TESTE) {
    db.raw.prepare("INSERT INTO equipamentos (id, codigo, tipo, regional) VALUES (?, ?, ?, ?)").run(crypto.randomUUID(), codigo, tipo, regional);
  }
}

export function ambiente() {
  const env = {
    DB: criarBanco(),
    ADMIN_SETUP_TOKEN: TOKEN_SETUP,
    ASSETS: { fetch: async () => new Response("TELA", { status: 200 }) }
  };
  semearFrota(env.DB);

  async function chamar(caminho, { metodo = "GET", corpo, token, ip = "10.0.0.1", headers = {} } = {}) {
    const h = { "CF-Connecting-IP": ip, ...headers };
    if (corpo !== undefined) h["Content-Type"] = "application/json";
    if (token) h.Authorization = `Bearer ${token}`;
    env.DB.contador.n = 0;
    const resp = await worker.fetch(
      new Request(`https://frotaz.teste${caminho}`, {
        method: metodo,
        headers: h,
        body: corpo !== undefined ? JSON.stringify(corpo) : undefined
      }),
      env
    );
    const consultas = env.DB.contador.n;
    if (process.env.MEDIR_CONSULTAS) console.log(`CONSULTAS ${consultas} ${metodo} ${caminho.split("?")[0].replace(/[0-9a-f-]{36}|[A-Za-z0-9_-]{40,}/g, ":id")}`);
    assert.ok(consultas <= LIMITE_CONSULTAS || process.env.MEDIR_CONSULTAS,
      `${metodo} ${caminho} fez ${consultas} consultas ao banco (limite do Cloudflare grátis: ${LIMITE_CONSULTAS})`);
    const texto = await resp.text();
    let dados;
    try { dados = JSON.parse(texto); } catch { dados = texto; }
    return { status: resp.status, dados };
  }

  const login = (r3, senha, ip) =>
    chamar("/api/auth/login", { metodo: "POST", corpo: { r3, senha }, ip });

  // Cria a conta (senha inicial = R3), faz a troca obrigatória e devolve um token pronto.
  async function ativar(r3, novaSenha = `Nova-${r3}-senha`) {
    const l1 = await login(r3, r3);
    assert.equal(l1.status, 200, JSON.stringify(l1.dados));
    const t = await chamar("/api/auth/trocar-senha", {
      metodo: "POST", token: l1.dados.token, corpo: { senhaAtual: r3, novaSenha }
    });
    assert.equal(t.status, 200, JSON.stringify(t.dados));
    const l2 = await login(r3, novaSenha);
    assert.equal(l2.status, 200);
    return l2.dados.token;
  }

  async function criarSupervisor(r3 = "SUP001") {
    const r = await chamar("/api/setup/admin", {
      metodo: "POST",
      headers: { "x-setup-token": TOKEN_SETUP },
      corpo: { r3, nome: "Supervisor Teste" }
    });
    assert.equal(r.status, 201);
    return ativar(r3);
  }

  return { env, chamar, login, ativar, criarSupervisor };
}

