// Ambiente de teste: Worker + banco SQLite em memória (dados FICTÍCIOS). Origem: FrotaZ, adaptado ao 4blade.
import assert from "node:assert/strict";
import worker from "../src/index.js";
import { criarBanco, LIMITE_CONSULTAS } from "./d1-local.js";
import { asaasFalso } from "./asaas-falso.mjs";

export const TOKEN_SETUP = "token-de-teste-apenas-local";

export const TOKEN_WEBHOOK = "webhook-de-teste-apenas-local";

export function ambiente() {
  const asaas = asaasFalso();
  const env = {
    DB: criarBanco(),
    ADMIN_SETUP_TOKEN: TOKEN_SETUP,
    COBRANCA_ON_LINE: "sim",   // os testes de assinatura precisam da cobrança ligada (desligada = padrão em produção)
    ASAAS_API_KEY: "chave-falsa-de-teste",
    ASAAS_WEBHOOK_TOKEN: TOKEN_WEBHOOK,
    ASAAS_FETCH: asaas.buscar,
    ASSETS: { fetch: async () => new Response("TELA", { status: 200 }) }
  };

  async function chamar(caminho, { metodo = "GET", corpo, token, ip = "10.0.0.1", headers = {} } = {}) {
    const h = { "CF-Connecting-IP": ip, ...headers };
    if (corpo !== undefined) h["Content-Type"] = "application/json";
    if (token) h.Authorization = `Bearer ${token}`;
    env.DB.contador.n = 0;
    const resp = await worker.fetch(
      new Request(`https://4blade.teste${caminho}`, {
        method: metodo, headers: h, body: corpo !== undefined ? JSON.stringify(corpo) : undefined
      }),
      env
    );
    const consultas = env.DB.contador.n;
    assert.ok(consultas <= LIMITE_CONSULTAS, `${metodo} ${caminho} fez ${consultas} consultas (limite ${LIMITE_CONSULTAS})`);
    const texto = await resp.text();
    let dados;
    try { dados = JSON.parse(texto); } catch { dados = texto; }
    return { status: resp.status, dados };
  }

  const post = (caminho, token, corpo) => chamar(caminho, { metodo: "POST", token, corpo });
  const get = (caminho, token) => chamar(caminho, { token });

  const login = (usuario, senha, ip) =>
    chamar("/api/auth/login", { metodo: "POST", corpo: { login: usuario, senha }, ip });

  // Entra com a senha provisória, troca e devolve um token pronto para uso.
  async function ativar(usuario, provisoria, novaSenha = `Nova-${usuario}-senha`) {
    const l1 = await login(usuario, provisoria);
    assert.equal(l1.status, 200, JSON.stringify(l1.dados));
    const t = await post("/api/auth/trocar-senha", l1.dados.token, { senhaAtual: provisoria, novaSenha });
    assert.equal(t.status, 200, JSON.stringify(t.dados));
    const l2 = await login(usuario, novaSenha);
    assert.equal(l2.status, 200);
    return l2.dados.token;
  }

  async function criarPlataforma(usuario = "suporte") {
    const r = await chamar("/api/setup/plataforma", {
      metodo: "POST", headers: { "x-setup-token": TOKEN_SETUP }, corpo: { login: usuario, nome: "Suporte Teste" }
    });
    assert.equal(r.status, 201, JSON.stringify(r.dados));
    return ativar(usuario, r.dados.senhaProvisoria);
  }

  // Cria uma barbearia pela plataforma e devolve { id, prop (token) }.
  async function criarBarbearia(plataforma, sufixo, plano = "basico") {
    const r = await post("/api/plataforma/barbearias", plataforma, {
      nome: `Barbearia Teste ${sufixo}`, plano,
      proprietario: { nome: `Dono ${sufixo}`, login: `dono.${sufixo}` }
    });
    assert.equal(r.status, 201, JSON.stringify(r.dados));
    const prop = await ativar(`dono.${sufixo}`, r.dados.senhaProvisoria);
    return { id: r.dados.barbearia.id, prop };
  }

  // Cria usuário de equipe e devolve { id, token }.
  async function criarUsuario(tokenCriador, login, perfil, extra = {}) {
    const r = await post("/api/usuarios", tokenCriador, { nome: `Pessoa ${login}`, login, perfil, ...extra });
    assert.equal(r.status, 201, JSON.stringify(r.dados));
    const token = await ativar(login, r.dados.senhaProvisoria);
    return { id: r.dados.usuario.id, token };
  }

  // Aviso do Asaas (webhook) com a senha certa (ou outra, para testar recusa).
  const webhook = (evento, token = TOKEN_WEBHOOK) =>
    chamar("/api/asaas/webhook", { metodo: "POST", corpo: evento, headers: token ? { "asaas-access-token": token } : {} });

  return { env, asaas, webhook, chamar, post, get, login, ativar, criarPlataforma, criarBarbearia, criarUsuario };
}
