// Recuperar a senha por e-mail (25/11/2026).
// "Esqueci minha senha": a pessoa digita o usuário OU o e-mail; se houver e-mail cadastrado, mandamos um link que vale
// 1 hora e uma vez só. A resposta é sempre a mesma (não revela se o usuário/e-mail existe).
// E-mail: Resend (https://resend.com) com o segredo RESEND_API_KEY. Nos testes, env.EMAIL_FETCH substitui o fetch.
import { json, fail, readJson, b64url, random, sha256, hashPassword, auditoria, normalizarLogin, validLogin } from "./util.js";

const VALIDADE_MIN = 60;
const REMETENTE_PADRAO = "4blade <nao-responda@forblade.com.br>";
export const MSG_ENVIADO = "Se esse usuário ou e-mail tiver um e-mail cadastrado, enviamos agora um link para criar uma nova senha. Olhe a caixa de entrada (e o spam). O link vale 1 hora.";

export const emailAtivo = env => Boolean(env.RESEND_API_KEY);

export function normalizarEmail(v) {
  if (typeof v !== "string") return null;
  const e = v.trim().toLowerCase();
  if (e.length < 5 || e.length > 120 || !/^[^\s@<>"',;]+@[^\s@<>"',;]+\.[a-z]{2,}$/.test(e)) return null;
  return e;
}

const escapar = t => String(t).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

export async function enviarEmail(env, { para, assunto, texto, html }) {
  const buscar = env.EMAIL_FETCH || fetch;
  const r = await buscar("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({ from: env.EMAIL_REMETENTE || REMETENTE_PADRAO, to: [para], subject: assunto, text: texto, html })
  });
  if (!r.ok) throw new Error(`Falha no envio do e-mail (${r.status})`);
}

function mensagemLink(contas, origem) {
  const linhas = contas.map(c => `${c.nome} (usuário ${c.login}${c.barbearia ? `, ${c.barbearia}` : ""}): ${origem}/#/redefinir-senha/${c.token}`);
  const texto = [
    "Olá!",
    "",
    "Recebemos um pedido para criar uma nova senha no 4blade.",
    contas.length > 1 ? "Este e-mail está em mais de um acesso. Use o link do acesso que você quer recuperar:" : "Toque no link abaixo para criar a nova senha:",
    "",
    ...linhas,
    "",
    `O link vale ${VALIDADE_MIN} minutos e só pode ser usado uma vez.`,
    "Se não foi você, ignore este e-mail: sua senha continua a mesma.",
    "",
    "4blade · forblade.com.br"
  ].join("\n");
  const html = `<div style="font-family:Arial,sans-serif;font-size:16px;color:#222;max-width:520px">
<p>Olá!</p><p>Recebemos um pedido para criar uma nova senha no <b>4blade</b>.</p>
${contas.map(c => `<p style="margin:20px 0"><a href="${escapar(`${origem}/#/redefinir-senha/${c.token}`)}" style="background:#c8963e;color:#111;padding:12px 18px;border-radius:8px;text-decoration:none;font-weight:bold;display:inline-block">Criar nova senha</a><br><small>${escapar(c.nome)} · usuário <b>${escapar(c.login)}</b>${c.barbearia ? ` · ${escapar(c.barbearia)}` : ""}</small></p>`).join("")}
<p style="color:#666;font-size:14px">O link vale ${VALIDADE_MIN} minutos e só pode ser usado uma vez. Se não foi você, ignore este e-mail: sua senha continua a mesma.</p>
<p style="color:#666;font-size:14px">4blade · forblade.com.br</p></div>`;
  return { texto, html };
}

// Rotas públicas (sem login). `limitar(acao, id, max, segundos, maxIp)` = limite de tentativas do index.js.
export async function rotasRecuperarSenha({ db, request, env, ipHash, limitar }, path, method) {
  if (path === "/auth/esqueci" && method === "POST") {
    const input = await readJson(request);
    const bruto = typeof input.login === "string" ? input.login.trim() : "";
    if (!bruto || bruto.length > 120) return fail("Digite o seu usuário ou o e-mail cadastrado.");
    if (!emailAtivo(env)) return fail("A recuperação por e-mail ainda não está ligada. Peça uma nova senha ao gerente da barbearia (ou ao suporte do 4blade, se você for o dono).", 503);
    const porEmail = bruto.includes("@");
    const chave = porEmail ? normalizarEmail(bruto) : normalizarLogin(bruto);
    if (!chave || (!porEmail && !validLogin(chave))) return json({ mensagem: MSG_ENVIADO });
    const limite = await limitar("esqueci", chave, 3, 3600, 20);
    if (!limite.allowed) return fail("Muitos pedidos. Aguarde 1 hora e tente de novo.", 429);

    const contas = (await db.prepare(`
      SELECT u.id, u.login, u.nome, u.barbearia_id, e.email, b.nome AS barbearia
      FROM usuarios u JOIN usuarios_emails e ON e.usuario_id = u.id
      LEFT JOIN barbearias b ON b.id = u.barbearia_id
      WHERE u.ativo = 1 AND e.email IS NOT NULL AND (u.barbearia_id IS NULL OR b.bloqueada = 0) AND ${porEmail ? "e.email = ?" : "u.login = ?"}
      ORDER BY u.nome LIMIT 5`).bind(chave).all()).results;
    if (!contas.length) {
      await auditoria({ db, ipHash }, "senha_esqueci_sem_email", null, { porEmail }).run();
      return json({ mensagem: MSG_ENVIADO });
    }
    const expira = new Date(Date.now() + VALIDADE_MIN * 60 * 1000).toISOString();
    const cmds = [];
    for (const c of contas) {
      c.token = b64url(random(32));
      cmds.push(
        db.prepare("INSERT INTO senha_recuperacoes (id, usuario_id, token_hash, email, expira_em, ip_hash) VALUES (?, ?, ?, ?, ?, ?)")
          .bind(crypto.randomUUID(), c.id, await sha256(c.token), c.email, expira, ipHash),
        auditoria({ db, barbeariaId: c.barbearia_id, usuarioId: c.id, ipHash }, "senha_link_enviado", c.id, { email: c.email.replace(/^(.).*(@.*)$/, "$1***$2") })
      );
    }
    await db.batch(cmds);
    const origem = new URL(request.url).origin;
    const { texto, html } = mensagemLink(contas, origem);
    try {
      await enviarEmail(env, { para: contas[0].email, assunto: "4blade: criar uma nova senha", texto, html });
    } catch (e) {
      console.error("e-mail de recuperação", e.message);
      return fail("Não conseguimos enviar o e-mail agora. Tente de novo em alguns minutos.", 502);
    }
    return json({ mensagem: MSG_ENVIADO });
  }

  if (path === "/auth/redefinir" && method === "POST") {
    const input = await readJson(request);
    const token = typeof input.token === "string" ? input.token : "";
    if (!/^[A-Za-z0-9_-]{40,100}$/.test(token)) return fail("Link inválido. Peça um novo em \"Esqueci minha senha\".", 400);
    const limite = await limitar("redefinir", token.slice(0, 12), 10, 900, 30);
    if (!limite.allowed) return fail("Muitas tentativas. Aguarde 15 minutos.", 429);
    const r = await db.prepare(`
      SELECT r.id, r.usuario_id, r.expira_em, r.usado_em, u.login, u.barbearia_id
      FROM senha_recuperacoes r JOIN usuarios u ON u.id = r.usuario_id
      WHERE r.token_hash = ? AND u.ativo = 1`).bind(await sha256(token)).first();
    if (!r || r.usado_em || new Date(r.expira_em) < new Date()) return fail("Este link venceu ou já foi usado. Peça um novo em \"Esqueci minha senha\".", 410);
    const nova = input.novaSenha;
    if (typeof nova !== "string" || nova.length < 8 || nova.length > 128 || nova.toLowerCase() === r.login) {
      return fail("A nova senha precisa ter de 8 a 128 caracteres e ser diferente do usuário.", 400);
    }
    // Marca o link como usado na mesma gravação (só se ainda não foi usado: dois cliques ao mesmo tempo não valem duas vezes).
    // Marca única deste uso: a senha só muda se FOI ESTE pedido que marcou o link.
    const marca = `${new Date().toISOString()}#${b64url(random(6))}`;
    const res = await db.batch([
      db.prepare("UPDATE senha_recuperacoes SET usado_em = ? WHERE id = ? AND usado_em IS NULL").bind(marca, r.id),
      db.prepare(`UPDATE usuarios SET senha_hash = ?, trocar_senha = 0, atualizado_em = CURRENT_TIMESTAMP
                  WHERE id = ? AND EXISTS (SELECT 1 FROM senha_recuperacoes WHERE id = ? AND usado_em = ?)`)
        .bind(await hashPassword(nova), r.usuario_id, r.id, marca),
      // Outros links pendentes da mesma pessoa deixam de valer; sessões abertas são encerradas.
      db.prepare("UPDATE senha_recuperacoes SET usado_em = CURRENT_TIMESTAMP WHERE usuario_id = ? AND usado_em IS NULL").bind(r.usuario_id),
      db.prepare("UPDATE sessoes SET revogado_em = CURRENT_TIMESTAMP WHERE usuario_id = ? AND revogado_em IS NULL").bind(r.usuario_id),
      auditoria({ db, barbeariaId: r.barbearia_id, usuarioId: r.usuario_id, ipHash }, "senha_redefinida_por_email", r.usuario_id)
    ]);
    if (!res[1].meta?.changes) return fail("Este link já foi usado. Peça um novo em \"Esqueci minha senha\".", 410);
    return json({ mensagem: "Senha criada. Entre com o seu usuário e a nova senha.", login: r.login });
  }
  return null;
}

// Grava (ou tira: email = null) o e-mail de um usuário; nada é apagado. Devolve os comandos para o lote de quem chama.
export function comandosEmail(db, usuarioId, email, porQuem) {
  return [db.prepare(`INSERT INTO usuarios_emails (usuario_id, email, atualizado_por) VALUES (?, ?, ?)
    ON CONFLICT(usuario_id) DO UPDATE SET email = excluded.email, atualizado_em = CURRENT_TIMESTAMP, atualizado_por = excluded.atualizado_por`)
    .bind(usuarioId, email, porQuem)];
}

// Campo e-mail vindo da tela: undefined = não mexer; "" ou null = tirar; texto = validar.
export function lerEmail(v) {
  if (v === undefined) return undefined;
  if (v === null || (typeof v === "string" && !v.trim())) return null;
  const e = normalizarEmail(v);
  if (!e) return false;
  return e;
}
