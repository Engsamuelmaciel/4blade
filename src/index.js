/*
 * 4blade — API
 * Cloudflare Workers + D1 + Static Assets
 * Associações: DB (D1) | ASSETS (pasta ./public) | segredo ADMIN_SETUP_TOKEN (só para criar o 1º usuário da plataforma)
 *
 * Login, sessão, limite de tentativas e auditoria: adaptados do FrotaZ (referencia/frotaz/).
 * Multi-empresa: tudo que é dado de barbearia é filtrado pela barbearia DA SESSÃO (user.barbearia_id),
 * nunca por um id vindo da tela.
 */
import {
  json, fail, HttpError, random, b64url, sha256, safeEqual, hashPassword, checkPassword, ITERACOES,
  gerarSenhaProvisoria, validLogin, normalizarLogin, readJson, textoLimpo, auditoria
} from "./util.js";
import { TELA_INICIAL } from "./perfis.js";
import { rotasPlataforma } from "./plataforma.js";
import { rotasUsuarios } from "./usuarios.js";
import { rotasCadastros } from "./cadastros.js";
import { rotasFuncionamento } from "./funcionamento.js";
import { rotasAgenda } from "./agenda.js";
import { rotasMensagens } from "./mensagens.js";
import { rotasPromissorias } from "./promissorias.js";
import { rotasNotificacoes } from "./notificacoes.js";
import { rotasCaixa } from "./caixa.js";
import { rotasEstoque, rotasVendas } from "./estoque.js";
import { rotasGestao } from "./gestao.js";
import { rotasContador } from "./contador.js";
import { rotasFinanceiro } from "./financeiro.js";
import { rotasSuporte, rotasSuportePlataforma } from "./suporte.js";
import { rotaSolicitarTeste, rotasSolicitacoesPlataforma } from "./solicitacoes.js";
import { rotasPublicasAssinatura, rotasAssinatura, situacaoAssinatura, SQL_PLANO, cobrancaAtiva } from "./assinatura.js";

export const VERSAO = "0.4.0";
const SESSAO_HORAS = 12;

async function rateLimit(db, key, max, windowSeconds) {
  const window = Math.floor(Date.now() / 1000 / windowSeconds);
  const result = await db.prepare(`
    INSERT INTO limites_acesso (chave, janela, quantidade)
    VALUES (?, ?, 1)
    ON CONFLICT(chave) DO UPDATE SET
      janela = excluded.janela,
      quantidade = CASE WHEN limites_acesso.janela = excluded.janela THEN limites_acesso.quantidade + 1 ELSE 1 END
    RETURNING quantidade
  `).bind(key, window).first();
  return Number(result?.quantidade || 0) <= max;
}

// Conta uma tentativa por IP e por usuário. O limite por IP é maior (várias pessoas no mesmo Wi-Fi).
async function limitRequest(db, ipHash, action, identifier, max, seconds, ipMax) {
  const ipKey = `${action}:ip:${ipHash}`;
  const userKey = `${action}:user:${await sha256(String(identifier || "").toLowerCase())}`;
  const ipAllowed = await rateLimit(db, ipKey, ipMax, seconds);
  const userAllowed = await rateLimit(db, userKey, max, seconds);
  return { allowed: ipAllowed && userAllowed, ipKey, userKey };
}

// Login certo: a tentativa não conta contra o IP e zera o contador do usuário.
async function refundAttempt(db, ipKey, userKey) {
  await db.batch([
    db.prepare("UPDATE limites_acesso SET quantidade = MAX(quantidade - 1, 0) WHERE chave = ?").bind(ipKey),
    db.prepare("DELETE FROM limites_acesso WHERE chave = ?").bind(userKey)
  ]);
}

// Campos da barbearia e da assinatura lidos junto com o usuário (sessão e login).
const CAMPOS_BARBEARIA = `
  b.nome AS barbearia_nome, ${SQL_PLANO} AS barbearia_plano, b.plano AS barbearia_plano_coluna,
  b.barbeiros_adicionais AS barbearia_adicionais, b.bloqueada AS barbearia_bloqueada,
  a.origem AS a_origem, a.pago_ate AS a_pago_ate, a.teste_ate AS a_teste_ate,
  a.ultimo_pagamento_em AS a_ultimo_pagamento_em, a.cancelada AS a_cancelada`;
const JUNTA_BARBEARIA = "LEFT JOIN barbearias b ON b.id = u.barbearia_id LEFT JOIN assinaturas a ON a.barbearia_id = u.barbearia_id";

// Cobrança desligada: ninguém é bloqueado nem avisado por mensalidade.
const situacaoDoUsuario = (u, env) => (u.barbearia_id && cobrancaAtiva(env) ? situacaoAssinatura({
  origem: u.a_origem, pago_ate: u.a_pago_ate, teste_ate: u.a_teste_ate,
  ultimo_pagamento_em: u.a_ultimo_pagamento_em, cancelada: u.a_cancelada
}) : { situacao: "manual", bloqueada: false });

// Com a mensalidade atrasada além da tolerância, só o proprietário entra, e só para ver/pagar a assinatura.
const ROTAS_LIBERADAS_NO_ATRASO = new Set(["/auth/me", "/auth/logout", "/auth/trocar-senha", "/assinatura", "/assinatura/cancelar",
  "/suporte", "/suporte/chamado", "/suporte/chamados", "/suporte/responder", "/suporte/encerrar"]);
const MSG_ATRASO_EQUIPE = "O acesso da barbearia está suspenso por mensalidade do 4blade em atraso. Fale com o proprietário.";

// Sessão válida + usuário ativo + barbearia não bloqueada (pela plataforma).
async function auth(request, db) {
  const header = request.headers.get("authorization") || "";
  if (!header.startsWith("Bearer ")) return null;
  const token = header.slice(7);
  if (!/^[A-Za-z0-9_-]{40,100}$/.test(token)) return null;
  return await db.prepare(`
    SELECT u.*, s.id AS sessao_id, ${CAMPOS_BARBEARIA}
    FROM sessoes s
    JOIN usuarios u ON u.id = s.usuario_id
    ${JUNTA_BARBEARIA}
    WHERE s.token_hash = ?
      AND s.revogado_em IS NULL
      AND datetime(s.expira_em) > CURRENT_TIMESTAMP
      AND u.ativo = 1
      AND (u.barbearia_id IS NULL OR b.bloqueada = 0)
  `).bind(await sha256(token)).first();
}

export function publicUser(user, env) {
  const sit = situacaoDoUsuario(user, env);
  return {
    id: user.id,
    login: user.login,
    nome: user.nome,
    perfil: user.perfil,
    trocaObrigatoria: Boolean(user.trocar_senha),
    telaInicial: TELA_INICIAL[user.perfil],
    cobrancaAtiva: cobrancaAtiva(env),
    barbearia: user.barbearia_id
      ? { nome: user.barbearia_nome, plano: user.barbearia_plano }
      : null,
    // Situação da mensalidade (só quem cuida da barbearia vê; a equipe não).
    assinatura: user.barbearia_id && (user.perfil === "proprietario" || user.perfil === "gerente") && sit.situacao !== "manual"
      ? sit : null
  };
}

async function issueSession(db, user, env) {
  const token = b64url(random(32));
  const expires = new Date(Date.now() + SESSAO_HORAS * 60 * 60 * 1000).toISOString();
  await db.prepare(`
    INSERT INTO sessoes (id, usuario_id, token_hash, expira_em) VALUES (?, ?, ?, ?)
  `).bind(crypto.randomUUID(), user.id, await sha256(token), expires).run();
  return { token, expiraEm: expires, usuario: publicUser(user, env) };
}

const FALLBACK_HASH = `pbkdf2$${ITERACOES}$00000000000000000000000000000000$` + "0".repeat(64);

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const method = request.method;

    // Tudo que não é /api/ é a tela (arquivos da pasta public/).
    if (url.pathname !== "/api" && !url.pathname.startsWith("/api/")) {
      if (env.ASSETS) return env.ASSETS.fetch(request);
      return fail("Rota não encontrada", 404);
    }

    const path = url.pathname.slice(4) || "/";

    if (method === "GET" && path === "/") {
      return json({ sistema: "4blade", servico: "API", status: "online", versao: VERSAO });
    }

    if (!env.DB) return fail("Banco não configurado", 503);

    if (method === "GET" && path === "/health") {
      try {
        await env.DB.prepare("SELECT 1").first();
        return json({ sistema: "4blade", api: "online", banco: "conectado" });
      } catch {
        return fail("Banco indisponível", 503);
      }
    }

    if (!["GET", "POST"].includes(method)) return fail("Método não permitido", 405);

    const db = env.DB;
    const ipHash = (await sha256(request.headers.get("CF-Connecting-IP") || "unknown")).slice(0, 16);

    try {
      // ---------- PLANOS, ASSINAR e AVISOS DO ASAAS (sem sessão) ----------
      const publica = await rotasPublicasAssinatura({
        db, request, env, ipHash, limitar: (chave, max, seg) => rateLimit(db, chave, max, seg)
      }, path, method);
      if (publica) return publica;
      if (path === "/solicitar-teste" && method === "POST") {
        return rotaSolicitarTeste({ db, request, ipHash, limitar: (chave, max, seg) => rateLimit(db, chave, max, seg) });
      }

      // ---------- 1º USUÁRIO DA PLATAFORMA (só com o segredo e só se ainda não existir nenhum) ----------
      if (path === "/setup/plataforma" && method === "POST") {
        const supplied = request.headers.get("x-setup-token");
        if (!env.ADMIN_SETUP_TOKEN || !safeEqual(supplied, env.ADMIN_SETUP_TOKEN)) {
          return fail("Não autorizado", 403);
        }
        const count = await db.prepare("SELECT COUNT(*) AS n FROM usuarios WHERE perfil = 'plataforma'").first();
        if (Number(count.n) !== 0) return fail("Inicialização encerrada", 409);

        const input = await readJson(request);
        const login = normalizarLogin(input.login);
        const nome = textoLimpo(input.nome);
        if (!validLogin(login) || !nome) return fail("Dados inválidos", 400);

        const id = crypto.randomUUID();
        const senha = gerarSenhaProvisoria();
        await db.batch([
          db.prepare(`
            INSERT INTO usuarios (id, barbearia_id, login, nome, perfil, senha_hash, trocar_senha)
            VALUES (?, NULL, ?, ?, 'plataforma', ?, 1)
          `).bind(id, login, nome, await hashPassword(senha)),
          auditoria({ db, usuarioId: id, ipHash }, "plataforma_setup", id, { login })
        ]);
        return json({ usuario: { id, login, nome, perfil: "plataforma" }, senhaProvisoria: senha }, 201);
      }

      // ---------- LOGIN ----------
      if (path === "/auth/login" && method === "POST") {
        const input = await readJson(request);
        const login = normalizarLogin(input.login);
        const { senha } = input;
        if (!validLogin(login) || typeof senha !== "string" || senha.length > 256) {
          return fail("Usuário ou senha incorretos", 401);
        }

        const limit = await limitRequest(db, ipHash, "login", login, 5, 900, 100);
        if (!limit.allowed) return fail("Muitas tentativas. Aguarde 15 minutos.", 429);

        const user = await db.prepare(`
          SELECT u.*, ${CAMPOS_BARBEARIA}
          FROM usuarios u ${JUNTA_BARBEARIA}
          WHERE u.login = ? AND u.ativo = 1
        `).bind(login).first();

        const correct = await checkPassword(senha, user?.senha_hash || FALLBACK_HASH);
        if (!user || !correct) {
          await auditoria({ db, barbeariaId: user?.barbearia_id, usuarioId: user?.id, ipHash }, "login_falha").run();
          return fail("Usuário ou senha incorretos", 401);
        }

        // Só revela o bloqueio para quem acertou a senha.
        if (user.barbearia_id && user.barbearia_bloqueada) {
          await auditoria({ db, barbeariaId: user.barbearia_id, usuarioId: user.id, ipHash }, "login_barbearia_bloqueada").run();
          return fail("Acesso bloqueado. Fale com o suporte do 4blade.", 403);
        }
        if (user.perfil !== "proprietario" && situacaoDoUsuario(user, env).bloqueada) {
          await auditoria({ db, barbeariaId: user.barbearia_id, usuarioId: user.id, ipHash }, "login_assinatura_atrasada").run();
          return fail(MSG_ATRASO_EQUIPE, 403);
        }

        await refundAttempt(db, limit.ipKey, limit.userKey);
        await auditoria({ db, barbeariaId: user.barbearia_id, usuarioId: user.id, ipHash }, "login").run();
        return json(await issueSession(db, user, env));
      }

      // ---------- DAQUI PARA BAIXO: SÓ COM SESSÃO ----------
      const user = await auth(request, db);
      if (!user) return fail("Entre novamente (sessão expirada ou inválida).", 401);

      const ctx = { db, request, env, user, ipHash, barbeariaId: user.barbearia_id, usuarioId: user.id };

      // Mensalidade atrasada além da tolerância: equipe fora; proprietário só na tela da assinatura.
      if (user.barbearia_id && situacaoDoUsuario(user, env).bloqueada) {
        if (user.perfil !== "proprietario") return fail(MSG_ATRASO_EQUIPE, 401);
        if (!ROTAS_LIBERADAS_NO_ATRASO.has(path)) return fail("Acesso suspenso: mensalidade do 4blade em atraso. Pague em Minha assinatura.", 402);
      }

      if (path === "/auth/me" && method === "GET") {
        return json({ usuario: publicUser(user, env) });
      }

      if (path === "/auth/trocar-senha" && method === "POST") {
        const { senhaAtual, novaSenha } = await readJson(request);
        const validCurrent = typeof senhaAtual === "string" && await checkPassword(senhaAtual, user.senha_hash);
        if (!validCurrent) return fail("Senha atual incorreta", 403);
        if (
          typeof novaSenha !== "string" || novaSenha.length < 8 || novaSenha.length > 128 ||
          novaSenha.toLowerCase() === user.login || novaSenha === senhaAtual
        ) {
          return fail("A nova senha precisa ter de 8 a 128 caracteres e ser diferente do usuário e da senha atual.", 400);
        }
        await db.batch([
          db.prepare(`
            UPDATE usuarios SET senha_hash = ?, trocar_senha = 0, atualizado_em = CURRENT_TIMESTAMP WHERE id = ?
          `).bind(await hashPassword(novaSenha), user.id),
          db.prepare(`
            UPDATE sessoes SET revogado_em = CURRENT_TIMESTAMP WHERE usuario_id = ? AND revogado_em IS NULL
          `).bind(user.id),
          auditoria(ctx, "senha_trocada", user.id)
        ]);
        return json({ mensagem: "Senha alterada. Entre novamente com a nova senha." });
      }

      if (path === "/auth/logout" && method === "POST") {
        await db.batch([
          db.prepare("UPDATE sessoes SET revogado_em = CURRENT_TIMESTAMP WHERE id = ?").bind(user.sessao_id),
          auditoria(ctx, "logout")
        ]);
        return json({ mensagem: "Sessão encerrada" });
      }

      // Bloqueio até a troca da senha inicial/provisória.
      if (user.trocar_senha) return fail("Troca de senha obrigatória", 403);

      // ---------- PLATAFORMA (nós) ----------
      if (path.startsWith("/plataforma/")) {
        if (user.perfil !== "plataforma") return fail("Sem permissão", 403);
        const r = (await rotasSuportePlataforma(ctx, path, method)) || (await rotasSolicitacoesPlataforma(ctx, path, method)) || (await rotasPlataforma(ctx, path, method));
        if (r) return r;
        return fail("Rota não encontrada", 404);
      }

      // ---------- DADOS DA BARBEARIA: exige usuário de barbearia ----------
      const r = (await rotasFuncionamento(ctx, path, method)) || (await rotasAgenda(ctx, path, method)) ||
        (await rotasCaixa(ctx, path, method)) || (await rotasEstoque(ctx, path, method)) || (await rotasVendas(ctx, path, method)) ||
        (await rotasGestao(ctx, path, method)) || (await rotasFinanceiro(ctx, path, method)) || (await rotasContador(ctx, path, method)) || (await rotasMensagens(ctx, path, method)) || (await rotasPromissorias(ctx, path, method)) || (await rotasNotificacoes(ctx, path, method)) || (await rotasAssinatura(ctx, path, method)) || (await rotasSuporte(ctx, path, method)) || (await rotasUsuarios(ctx, path, method)) || (await rotasCadastros(ctx, path, method));
      if (r) {
        return r;
      }

      return fail("Rota não encontrada", 404);
    } catch (error) {
      if (error instanceof HttpError) return error.extra ? json({ erro: error.message, ...error.extra }, error.status) : fail(error.message, error.status);
      console.error("Erro interno:", error?.message || error);
      return fail("Erro interno ou operação não permitida", 500);
    }
  }
};
