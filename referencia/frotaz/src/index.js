/*
 * FrotaZ — API
 * Cloudflare Workers + D1 + Workers KV + Static Assets
 * Associações: DB (D1) | ARQUIVOS (KV dos documentos) | ASSETS (pasta ./public) | segredo ADMIN_SETUP_TOKEN
 *
 * Origem: módulos "Frota e manutenção" e "Documentos" do SIGEO v2.65.5 (login, perfis e auditoria também vieram de lá).
 * Todas as rotas da API começam com /api/. O resto é a tela (public/).
 */
import {
  json, fail, HttpError, random, b64url, sha256, safeEqual, hashPassword, checkPassword, ITERACOES, gerarSenhaProvisoria,
  validR3, validId, readJson, hojeBrasil, isManager, isSupervisorOuMaster, NIVEL, audit
} from "./util.js";
import { rotasDocumentos } from "./documentos.js";
import { rotasFrota } from "./frota.js";
import { rotasApontamentos } from "./apontamentos.js";
import { rotasPneus } from "./pneus.js";
import { rotasOrdens } from "./ordens.js";

const VERSAO = "0.4.0";
const PERFIS = ["operador", "mecanico", "gerente", "supervisor"];   // perfis que a tela de cadastro pode criar

async function rateLimit(db, key, max, windowSeconds) {
  const window = Math.floor(Date.now() / 1000 / windowSeconds);

  const result = await db.prepare(`
    INSERT INTO limites_acesso
      (chave, janela, quantidade)
    VALUES (?, ?, 1)
    ON CONFLICT(chave)
    DO UPDATE SET
      janela = excluded.janela,
      quantidade =
        CASE
          WHEN limites_acesso.janela = excluded.janela
          THEN limites_acesso.quantidade + 1
          ELSE 1
        END
    RETURNING quantidade
  `).bind(key, window).first();

  return Number(result?.quantidade || 0) <= max;
}

// Conta uma tentativa por IP e por identificador (R3).
// O limite por IP é bem maior porque muitos operadores dividem
// o mesmo Wi-Fi ou a mesma rede móvel (mesmo IP).
// Devolve { allowed, ipKey, userKey } para que um acerto possa
// devolver a tentativa (só os erros devem contar).
async function limitRequest(db, request, action, identifier, max, seconds, ipMax) {
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";

  const ipKey = `${action}:ip:${await sha256(ip)}`;
  const userKey =
    `${action}:user:${await sha256(String(identifier || "").toLowerCase())}`;

  const ipAllowed = await rateLimit(db, ipKey, ipMax, seconds);
  const userAllowed = await rateLimit(db, userKey, max, seconds);

  return { allowed: ipAllowed && userAllowed, ipKey, userKey };
}

// Login certo: a tentativa não conta contra o IP e zera o contador do R3.
async function refundAttempt(db, ipKey, userKey) {
  await db.batch([
    db.prepare(`
      UPDATE limites_acesso
      SET quantidade = MAX(quantidade - 1, 0)
      WHERE chave = ?
    `).bind(ipKey),
    db.prepare("DELETE FROM limites_acesso WHERE chave = ?").bind(userKey)
  ]);
}

async function auth(request, db) {
  const header = request.headers.get("authorization") || "";

  if (!header.startsWith("Bearer ")) {
    return null;
  }

  const token = header.slice(7);

  if (!/^[A-Za-z0-9_-]{40,100}$/.test(token)) {
    return null;
  }

  const digest = await sha256(token);

  return await db.prepare(`
    SELECT
      u.*,
      s.id AS sessao_id
    FROM sessoes s
    JOIN usuarios u
      ON u.id = s.usuario_id
    WHERE s.token_hash = ?
      AND s.revogado_em IS NULL
      AND datetime(s.expira_em) > CURRENT_TIMESTAMP
      AND u.ativo = 1
  `).bind(digest).first();
}

async function issueSession(db, user) {
  const token = b64url(random(32));

  const expires = new Date(
    Date.now() + 12 * 60 * 60 * 1000
  ).toISOString();

  await db.prepare(`
    INSERT INTO sessoes
      (id, usuario_id, token_hash, expira_em)
    VALUES (?, ?, ?, ?)
  `).bind(
    crypto.randomUUID(),
    user.id,
    await sha256(token),
    expires
  ).run();

  return {
    token,
    expiraEm: expires,
    usuario: publicUser(user)
  };
}

async function r3Existe(db, r3) {
  const row = await db
    .prepare("SELECT id FROM usuarios WHERE r3 = ?")
    .bind(r3)
    .first();

  return Boolean(row);
}

// A coluna "regional" das pessoas vem da migração 0009. Enquanto ela não existir,
// as rotas de pessoas continuam funcionando sem a regional.

function publicUser(user) {
  return {
    id: user.id,
    r3: user.r3,
    nome: user.nome,
    perfil: user.perfil,
    email: user.email || null,
    trocaObrigatoria: Boolean(user.trocar_senha)
  };
}

async function createUser(db, input, perfilForcado = null, { ativo = true } = {}) {
  const { r3, nome, email } = input;
  const perfil = perfilForcado || input.perfil;

  if (
    !validR3(r3) ||
    typeof nome !== "string" ||
    nome.trim().length < 2 ||
    nome.length > 120 ||
    !PERFIS.includes(perfil)
  ) {
    return null;
  }

  if (email != null && (typeof email !== "string" || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) {
    return null;
  }

  const id = crypto.randomUUID();
  // Senha inicial igual ao R3, com troca obrigatória no primeiro acesso.
  const senhaHash = await hashPassword(r3);
  const nomeLimpo = nome.trim().replace(/\s+/g, " ");

  await db.prepare(`
    INSERT INTO usuarios (id, r3, nome, email, perfil, senha_hash, trocar_senha, ativo)
    VALUES (?, ?, ?, ?, ?, ?, 1, ?)
  `).bind(id, r3, nomeLimpo, email || null, perfil, senhaHash, ativo ? 1 : 0).run();

  return { id, r3, nome: nomeLimpo, perfil, email: email || null, ativo, trocaObrigatoria: true };
}

// Gerenciar a conta de alguém (desativar, reativar, corrigir nome): só de quem está ABAIXO, nunca a própria.
function podeGerenciarConta(user, alvo) {
  return alvo.id !== user.id && canApproveRecovery(user, alvo.perfil);
}

function canApproveRecovery(approver, targetPerfil) {
  const a = NIVEL[approver.perfil] || 0;
  const t = NIVEL[targetPerfil];
  // Perfil desconhecido não é aprovado por ninguém.
  return isManager(approver) && t !== undefined && a > t;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const method = request.method;

    // Tudo que não é /api/ é a tela (arquivos da pasta public/).
    if (url.pathname !== "/api" && !url.pathname.startsWith("/api/")) {
      if (env.ASSETS) return env.ASSETS.fetch(request);
      return fail("Rota não encontrada", 404);
    }

    // Daqui para baixo, "path" é o caminho sem o prefixo /api.
    const path = url.pathname.slice(4) || "/";

    if (method === "GET" && path === "/") {
      return json({ sistema: "FrotaZ", servico: "API", status: "online", versao: VERSAO });
    }

    if (method === "GET" && path === "/health") {
      try {
        if (!env.DB) {
          return fail("Banco não configurado", 503);
        }

        await env.DB.prepare("SELECT 1").first();

        return json({
          sistema: "FrotaZ",
          api: "online",
          banco: "conectado"
        });
      } catch {
        return fail("Banco indisponível", 503);
      }
    }

    if (!env.DB) {
      return fail("Banco não configurado", 503);
    }


    if (!["GET", "POST"].includes(method)) {
      return fail("Método não permitido", 405);
    }

    try {
      // CRIAÇÃO INICIAL DO SUPERVISOR (só com zero usuários)
      // CRIAÇÃO INICIAL DO SUPERVISOR (só com zero usuários)
      if (path === "/setup/admin" && method === "POST") {
        const supplied = request.headers.get("x-setup-token");

        if (
          !env.ADMIN_SETUP_TOKEN ||
          !safeEqual(supplied, env.ADMIN_SETUP_TOKEN)
        ) {
          return fail("Não autorizado", 403);
        }

        const count = await env.DB.prepare(
          "SELECT COUNT(*) AS n FROM usuarios"
        ).first();

        if (Number(count.n) !== 0) {
          return fail("Inicialização encerrada", 409);
        }

        const input = await readJson(request);

        const created = await createUser(env.DB, input, "supervisor");

        if (!created) {
          return fail("Dados inválidos", 400);
        }

        return json({
          usuario: created,
          aviso: "A senha inicial é o R3. Troque-a no primeiro acesso."
        }, 201);
      }

      // LOGIN
      if (path === "/auth/login" && method === "POST") {
        const input = await readJson(request);
        const { r3, senha } = input;

        if (
          !validR3(r3) ||
          typeof senha !== "string" ||
          senha.length > 256
        ) {
          return fail("Credenciais inválidas", 401);
        }

        const limit = await limitRequest(
          env.DB,
          request,
          "login",
          r3,
          5,
          900,
          100
        );

        if (!limit.allowed) {
          return fail("Muitas tentativas. Aguarde 15 minutos.", 429);
        }

        const user = await env.DB.prepare(`
          SELECT *
          FROM usuarios
          WHERE r3 = ?
            AND ativo = 1
        `).bind(r3).first();

        const fallback =
          `pbkdf2$${ITERACOES}$` +
          "00000000000000000000000000000000$" +
          "0000000000000000000000000000000000000000000000000000000000000000";

        const correct = await checkPassword(
          senha,
          user?.senha_hash || fallback
        );

        if (!user || !correct) {
          await audit(env.DB, request, user?.id, "login_falha");
          return fail("Credenciais inválidas", 401);
        }

        await refundAttempt(env.DB, limit.ipKey, limit.userKey);
        await audit(env.DB, request, user.id, "login");

        return json(await issueSession(env.DB, user));
      }

      // SOLICITAÇÃO DE RECUPERAÇÃO
      if (path === "/auth/solicitar-recuperacao" && method === "POST") {
        const { r3 } = await readJson(request);

        const response = {
          mensagem:
            "Se o registro estiver cadastrado, " +
            "a solicitação será encaminhada " +
            "ao supervisor ou gerente para análise."
        };

        if (!validR3(r3)) {
          return json(response, 202);
        }

        const limit = await limitRequest(
          env.DB,
          request,
          "recuperacao",
          r3,
          3,
          3600,
          60
        );

        if (!limit.allowed) {
          return json(response, 202);
        }

        const account = await env.DB.prepare(`
          SELECT id
          FROM usuarios
          WHERE r3 = ?
            AND ativo = 1
        `).bind(r3).first();

        if (account) {
          await audit(env.DB, request, account.id, "recuperacao_solicitada");
          await env.DB.prepare(`
            INSERT INTO recuperacoes_senha
              (id, usuario_id, status)
            SELECT ?, ?, 'pendente'
            WHERE NOT EXISTS (
              SELECT 1
              FROM recuperacoes_senha
              WHERE usuario_id = ?
                AND status = 'pendente'
            )
          `).bind(
            crypto.randomUUID(),
            account.id,
            account.id
          ).run();
        }

        return json(response, 202);
      }

      // ROTAS AUTENTICADAS
      const user = await auth(request, env.DB);

      if (!user) {
        return fail("Autenticação necessária", 401);
      }

      if (path === "/auth/me" && method === "GET") {
        return json({ usuario: publicUser(user) });
      }

      // TROCA DE SENHA
      if (path === "/auth/trocar-senha" && method === "POST") {
        const { senhaAtual, novaSenha } = await readJson(request);

        const validCurrent =
          typeof senhaAtual === "string" &&
          await checkPassword(senhaAtual, user.senha_hash);

        if (!validCurrent) {
          return fail("Senha atual incorreta", 403);
        }

        if (
          typeof novaSenha !== "string" ||
          novaSenha.length < 8 ||
          novaSenha.length > 128 ||
          novaSenha === user.r3 ||
          novaSenha === senhaAtual
        ) {
          return fail(
            "Use uma senha diferente do R3, com 8 a 128 caracteres.",
            400
          );
        }

        const senhaHash = await hashPassword(novaSenha);

        await env.DB.batch([
          env.DB.prepare(`
            UPDATE usuarios
            SET senha_hash = ?,
                trocar_senha = 0,
                atualizado_em = CURRENT_TIMESTAMP
            WHERE id = ?
          `).bind(senhaHash, user.id),

          env.DB.prepare(`
            UPDATE sessoes
            SET revogado_em = CURRENT_TIMESTAMP
            WHERE usuario_id = ?
              AND revogado_em IS NULL
          `).bind(user.id)
        ]);

        await audit(env.DB, request, user.id, "senha_trocada");

        return json({
          mensagem: "Senha alterada com sucesso. Entre novamente."
        });
      }

      // LOGOUT
      if (path === "/auth/logout" && method === "POST") {
        await env.DB.prepare(`
          UPDATE sessoes
          SET revogado_em = CURRENT_TIMESTAMP
          WHERE id = ?
        `).bind(user.sessao_id).run();

        await audit(env.DB, request, user.id, "logout");

        return json({ mensagem: "Sessão encerrada" });
      }

      // BLOQUEIO ATÉ TROCA DA SENHA INICIAL
      if (user.trocar_senha) {
        return fail("Troca de senha obrigatória", 403);
      }


      // CONSULTAR RECUPERAÇÕES
      if (path === "/admin/recuperacoes" && method === "GET") {
        if (!isManager(user)) {
          return fail("Sem permissão", 403);
        }

        const result = await env.DB.prepare(`
          SELECT
            r.id,
            u.r3,
            u.nome,
            u.perfil,
            r.status,
            r.solicitado_em,
            r.analisado_em
          FROM recuperacoes_senha r
          JOIN usuarios u
            ON u.id = r.usuario_id
          ORDER BY r.solicitado_em DESC
          LIMIT 100
        `).all();

        // Mostra só os pedidos que este usuário pode analisar.
        const pedidos = result.results
          .filter(p => canApproveRecovery(user, p.perfil));

        return json({ pedidos });
      }

      // APROVAR OU REJEITAR RECUPERAÇÃO
      if (path === "/admin/recuperacoes/resolver" && method === "POST") {
        if (!isManager(user)) {
          return fail("Sem permissão", 403);
        }

        const { id, decisao } = await readJson(request);

        if (
          !validId(id) ||
          !["aprovar", "rejeitar"].includes(decisao)
        ) {
          return fail("Pedido inválido", 400);
        }

        const pending = await env.DB.prepare(`
          SELECT
            r.*,
            u.r3,
            u.perfil
          FROM recuperacoes_senha r
          JOIN usuarios u
            ON u.id = r.usuario_id
          WHERE r.id = ?
            AND r.status = 'pendente'
        `).bind(id).first();

        if (!pending) {
          return fail("Pedido não encontrado ou já analisado", 404);
        }

        // Ninguém analisa o pedido de alguém do mesmo nível ou acima,
        // nem o próprio pedido.
        if (
          pending.usuario_id === user.id ||
          !canApproveRecovery(user, pending.perfil)
        ) {
          return fail("Sem permissão para analisar este pedido", 403);
        }

        if (decisao === "rejeitar") {
          const result = await env.DB.prepare(`
            UPDATE recuperacoes_senha
            SET status = 'rejeitada',
                analisado_por = ?,
                analisado_em = CURRENT_TIMESTAMP
            WHERE id = ?
              AND status = 'pendente'
          `).bind(user.id, id).run();

          if (result.meta.changes !== 1) {
            return fail("Pedido já analisado", 409);
          }

          await audit(env.DB, request, user.id, "recuperacao_rejeitada", pending.usuario_id);

          return json({ mensagem: "Pedido rejeitado" });
        }

        // Reserva o pedido antes de trocar a senha: só um aprovador passa.
        const claim = await env.DB.prepare(`
          UPDATE recuperacoes_senha
          SET status = 'aprovada',
              analisado_por = ?,
              analisado_em = CURRENT_TIMESTAMP
          WHERE id = ?
            AND status = 'pendente'
        `).bind(user.id, id).run();

        if (claim.meta.changes !== 1) {
          return fail("Pedido já analisado", 409);
        }

        const temporaryPassword = gerarSenhaProvisoria();
        const senhaHash = await hashPassword(temporaryPassword);

        await env.DB.batch([
          env.DB.prepare(`
            UPDATE usuarios
            SET senha_hash = ?,
                trocar_senha = 1,
                atualizado_em = CURRENT_TIMESTAMP
            WHERE id = ?
          `).bind(senhaHash, pending.usuario_id),

          env.DB.prepare(`
            UPDATE sessoes
            SET revogado_em = CURRENT_TIMESTAMP
            WHERE usuario_id = ?
              AND revogado_em IS NULL
          `).bind(pending.usuario_id)
        ]);

        await audit(env.DB, request, user.id, "recuperacao_aprovada", pending.usuario_id);

        return json({
          mensagem:
            "Redefinição autorizada. Confirme a " +
            "identidade antes de entregar a credencial.",
          r3: pending.r3,
          senhaProvisoria: temporaryPassword
        });
      }

      // CADASTRO DE COLABORADORES
      if (path === "/usuarios" && method === "POST") {
        if (!isManager(user)) {
          return fail("Sem permissão", 403);
        }

        const input = await readJson(request);

        if (["supervisor", "gerente", "administrador"].includes(input.perfil)) {
          return fail(
            "Criação de administradores exige procedimento separado.",
            403
          );
        }

        const opcoesConta = { ativo: input.desativada !== true };
        if (input.desativada !== undefined && typeof input.desativada !== "boolean") {
          return fail("Campo 'desativada' inválido.", 400);
        }

        if (validR3(input.r3) && await r3Existe(env.DB, input.r3)) {
          return fail("R3 já cadastrado", 409);
        }

        const created = await createUser(env.DB, input, null, opcoesConta);

        if (!created) {
          return fail("Dados inválidos", 400);
        }

        await audit(env.DB, request, user.id, "usuario_criado", created.id, {
          perfil: created.perfil, ativo: created.ativo
        });

        return json({ usuario: created }, 201);
      }

      // CADASTRO DE APROVADORES (supervisor ou gerente), somente por supervisor
      if (path === "/usuarios/aprovador" && method === "POST") {
        if (!isSupervisorOuMaster(user)) {
          return fail("Sem permissão", 403);
        }

        const input = await readJson(request);

        if (!["supervisor", "gerente"].includes(input.perfil)) {
          return fail("Perfil deve ser supervisor ou gerente.", 400);
        }

        const opcoesConta = { ativo: input.desativada !== true };
        if (input.desativada !== undefined && typeof input.desativada !== "boolean") {
          return fail("Campo 'desativada' inválido.", 400);
        }

        if (validR3(input.r3) && await r3Existe(env.DB, input.r3)) {
          return fail("R3 já cadastrado", 409);
        }

        const created = await createUser(
          env.DB,
          { r3: input.r3, nome: input.nome, email: input.email },
          input.perfil,
          opcoesConta
        );

        if (!created) {
          return fail("Dados inválidos", 400);
        }

        await audit(env.DB, request, user.id, "usuario_criado", created.id, {
          perfil: created.perfil, ativo: created.ativo
        });

        return json({ usuario: created }, 201);
      }

      if (path === "/usuarios" && method === "GET") {
        if (!isManager(user)) {
          return fail("Sem permissão", 403);
        }

        const result = await env.DB.prepare(`
          SELECT
            u.id, u.r3, u.nome, u.perfil, u.ativo, u.trocar_senha, u.criado_em,
            (SELECT MAX(s.criado_em) FROM sessoes s WHERE s.usuario_id = u.id) AS ultimo_acesso
          FROM usuarios u
          ORDER BY u.nome
        `).all();

        return json({
          usuarios: result.results.map(u => ({
            id: u.id,
            r3: u.r3,
            nome: u.nome,
            perfil: u.perfil,
            ativo: Boolean(u.ativo),
            // ainda não entrou e trocou a senha inicial (ou a provisória)
            trocaPendente: Boolean(u.trocar_senha),
            criadoEm: u.criado_em,
            ultimoAcesso: u.ultimo_acesso || null,
            podeGerenciar: podeGerenciarConta(user, u)
          }))
        });
      }

      // ---------- ALTERAR CONTA: desativar, reativar, corrigir nome ----------
      // Nunca apaga. Desativar bloqueia o login e encerra as sessões abertas.
      if (path === "/usuarios/alterar" && method === "POST") {
        if (!isManager(user)) {
          return fail("Sem permissão", 403);
        }

        const input = await readJson(request);

        if (!validId(input.id)) {
          return fail("Pessoa inválida.", 400);
        }

        const motivo = typeof input.motivo === "string" ? input.motivo.trim() : "";

        if (motivo.length < 3 || motivo.length > 300) {
          return fail("Informe o motivo (3 a 300 caracteres).", 400);
        }

        const alvo = await env.DB.prepare(
          "SELECT id, r3, nome, perfil, ativo FROM usuarios WHERE id = ?"
        ).bind(input.id).first();

        if (!alvo) {
          return fail("Pessoa não encontrada.", 404);
        }

        if (!podeGerenciarConta(user, alvo)) {
          return fail("Sem permissão: só é possível alterar contas de quem está abaixo de você.", 403);
        }

        let nome = alvo.nome;
        if (input.nome !== undefined) {
          if (typeof input.nome !== "string") return fail("Nome inválido.", 400);
          nome = input.nome.trim().replace(/\s+/g, " ");
          if (nome.length < 2 || nome.length > 120) {
            return fail("Nome deve ter de 2 a 120 caracteres.", 400);
          }
        }

        let ativo = Boolean(alvo.ativo);
        if (input.ativo !== undefined) {
          if (typeof input.ativo !== "boolean") return fail("Situação inválida.", 400);
          ativo = input.ativo;
        }

        // troca de perfil só entre os de campo: operador e mecânico (com sessão encerrada)
        let perfil = alvo.perfil;
        if (input.perfil !== undefined) {
          const base = ["operador", "mecanico"];
          if (!base.includes(input.perfil) || !base.includes(alvo.perfil)) {
            return fail("Troca de perfil só entre operador e mecânico.", 400);
          }
          perfil = input.perfil;
        }

        if (nome === alvo.nome && ativo === Boolean(alvo.ativo) && perfil === alvo.perfil) {
          return fail("Nada foi alterado.", 400);
        }

        const comandos = [
          env.DB.prepare(`
            UPDATE usuarios
            SET nome = ?, ativo = ?, perfil = ?, atualizado_em = CURRENT_TIMESTAMP
            WHERE id = ?
          `).bind(nome, ativo ? 1 : 0, perfil, alvo.id)
        ];
        if ((perfil !== alvo.perfil && ativo && alvo.ativo) || (!ativo && alvo.ativo)) {
          // mudou o perfil ou desativou: encerra as sessões abertas na hora
          comandos.push(env.DB.prepare(`
            UPDATE sessoes SET revogado_em = CURRENT_TIMESTAMP
            WHERE usuario_id = ? AND revogado_em IS NULL
          `).bind(alvo.id));
        }

        await env.DB.batch(comandos);

        await audit(env.DB, request, user.id, "usuario_alterado", alvo.id, {
          motivo,
          antes: { nome: alvo.nome, ativo: Boolean(alvo.ativo), ...(perfil !== alvo.perfil ? { perfil: alvo.perfil } : {}) },
          depois: { nome, ativo, ...(perfil !== alvo.perfil ? { perfil } : {}) }
        });

        return json({ usuario: { id: alvo.id, r3: alvo.r3, nome, perfil, ativo } });
      }

      // ---------- FROTA E MANUTENÇÃO (equipamentos, frota, planos, leituras, manutenções) ----------
      if (path === "/equipamentos" || path.startsWith("/equipamentos/") || path === "/frota" || path.startsWith("/frota/") ||
          path === "/manutencoes" || path.startsWith("/manutencoes/")) {
        const rf = await rotasFrota({ path, method, request, env, user, json, fail, readJson, audit });
        if (rf) return rf;
      }

      // ---------- APONTAMENTOS DE KM e RELATÓRIOS ----------
      if (path === "/apontamentos" || path.startsWith("/apontamentos/") || path === "/relatorios") {
        const ra = await rotasApontamentos({ path, method, request, env, user, json, fail, readJson, audit });
        if (ra) return ra;
      }

      // ---------- ORDENS DE SERVIÇO ----------
      if (path === "/os" || path.startsWith("/os/")) {
        const ro = await rotasOrdens({ path, method, request, env, user, json, fail, readJson, audit });
        if (ro) return ro;
      }

      // ---------- PNEUS ----------
      if (path === "/pneus" || path.startsWith("/pneus/")) {
        const rp = await rotasPneus({ path, method, request, env, user, json, fail, readJson, audit });
        if (rp) return rp;
      }

      // ---------- DOCUMENTOS da frota e gerais ----------
      if (path === "/documentos" || path.startsWith("/documentos/")) {
        const rd = await rotasDocumentos({ path, method, request, env, user, json, fail, readJson, audit, agora: () => Date.now() });
        if (rd) return rd;
      }

      return fail("Rota não encontrada", 404);

    } catch (error) {
      if (error instanceof HttpError) {
        return fail(error.message, error.status);
      }

      console.error("Erro interno:", error?.name || "Error");

      return fail("Erro interno ou operação não permitida", 500);
    }
  }
};
