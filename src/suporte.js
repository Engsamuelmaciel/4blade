// Suporte do 4blade: chamados (conversa) entre a barbearia (proprietário e gerente) e a plataforma (nós),
// e o contato do suporte (WhatsApp por link wa.me, e-mail, horário de atendimento) configurado pela plataforma.
// Multi-empresa: a barbearia só vê e mexe nos PRÓPRIOS chamados (filtro pela barbearia da sessão).
import { json, fail, readJson, validId, textoLimpo, normalizarTelefone, auditoria, HttpError } from "./util.js";

export const CATEGORIAS = { duvida: "Dúvida", problema: "Problema no sistema", assinatura: "Assinatura e pagamento", sugestao: "Sugestão" };
const MAX_ABERTOS = 10;   // chamados sem encerrar por barbearia (evita excesso)
const emailValido = v => typeof v === "string" && v.length <= 120 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.trim());

function textoMensagem(v) {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length >= 3 && t.length <= 3000 ? t : null;
}

async function contatoSuporte(db) {
  const r = await db.prepare("SELECT chave, valor FROM plataforma_config WHERE chave LIKE 'suporte_%'").all();
  const c = Object.fromEntries(r.results.map(x => [x.chave, x.valor]));
  return { whatsapp: c.suporte_whatsapp || null, email: c.suporte_email || null, horario: c.suporte_horario || null };
}

const chamadoPublico = c => ({
  id: c.id, numero: Number(c.numero), categoria: c.categoria, assunto: c.assunto, situacao: c.situacao, tela: c.tela || null,
  criadoEm: c.criado_em, atualizadoEm: c.atualizado_em, encerradoEm: c.encerrado_em || null,
  abertoPor: c.autor_nome || null, barbearia: c.barbearia_nome || null,
  ultima: c.ultima_texto ? { texto: c.ultima_texto.slice(0, 140), lado: c.ultima_lado } : null
});
const CAMPOS_LISTA = `
  c.*, u.nome AS autor_nome, b.nome AS barbearia_nome,
  (SELECT m.texto FROM suporte_mensagens m WHERE m.chamado_id = c.id ORDER BY m.criado_em DESC, m.rowid DESC LIMIT 1) AS ultima_texto,
  (SELECT m.lado FROM suporte_mensagens m WHERE m.chamado_id = c.id ORDER BY m.criado_em DESC, m.rowid DESC LIMIT 1) AS ultima_lado`;

async function conversa(db, chamadoId) {
  const r = await db.prepare(`
    SELECT m.lado, m.texto, m.criado_em, u.nome FROM suporte_mensagens m JOIN usuarios u ON u.id = m.autor_id
    WHERE m.chamado_id = ? ORDER BY m.criado_em, m.rowid
  `).bind(chamadoId).all();
  return r.results.map(m => ({ lado: m.lado, texto: m.texto, criadoEm: m.criado_em, autor: m.lado === "suporte" ? "Suporte 4blade" : m.nome }));
}

// ---------- barbearia (proprietário e gerente) ----------
export async function rotasSuporte(ctx, path, method) {
  if (path !== "/suporte" && !path.startsWith("/suporte/")) return null;
  const { db, request, user } = ctx;
  if (!user.barbearia_id || (user.perfil !== "proprietario" && user.perfil !== "gerente")) throw new HttpError("Sem permissão", 403);

  if (path === "/suporte" && method === "GET") {
    const r = await db.prepare(`
      SELECT ${CAMPOS_LISTA} FROM suporte_chamados c JOIN usuarios u ON u.id = c.aberto_por JOIN barbearias b ON b.id = c.barbearia_id
      WHERE c.barbearia_id = ? ORDER BY c.situacao = 'encerrado', c.atualizado_em DESC LIMIT 100
    `).bind(ctx.barbeariaId).all();
    return json({ contato: await contatoSuporte(db), categorias: CATEGORIAS, chamados: r.results.map(chamadoPublico) });
  }

  if (path === "/suporte/chamado" && method === "GET") {
    const id = new URL(request.url).searchParams.get("id");
    if (!validId(id)) return fail("Chamado inválido.");
    const c = await db.prepare(`
      SELECT ${CAMPOS_LISTA} FROM suporte_chamados c JOIN usuarios u ON u.id = c.aberto_por JOIN barbearias b ON b.id = c.barbearia_id
      WHERE c.id = ? AND c.barbearia_id = ?
    `).bind(id, ctx.barbeariaId).first();
    if (!c) return fail("Chamado não encontrado.", 404);
    return json({ chamado: chamadoPublico(c), mensagens: await conversa(db, id) });
  }

  if (path === "/suporte/chamados" && method === "POST") {
    const input = await readJson(request);
    if (!CATEGORIAS[input.categoria]) return fail("Escolha o tipo do chamado.");
    const assunto = textoLimpo(input.assunto, 3, 100);
    if (!assunto) return fail("Escreva um assunto curto (3 a 100 letras).");
    const texto = textoMensagem(input.mensagem);
    if (!texto) return fail("Conte o que aconteceu (3 a 3000 letras).");
    const tela = typeof input.tela === "string" ? input.tela.replace(/[^a-z0-9/-]/gi, "").slice(0, 40) || null : null;
    const id = crypto.randomUUID();
    // Grava só se a barbearia tiver menos de MAX_ABERTOS chamados sem encerrar; número = maior + 1 (no mesmo comando).
    const r = await db.batch([
      db.prepare(`
        INSERT INTO suporte_chamados (id, numero, barbearia_id, aberto_por, categoria, assunto, tela)
        SELECT ?, COALESCE((SELECT MAX(numero) FROM suporte_chamados), 100) + 1, ?, ?, ?, ?, ?
        WHERE (SELECT COUNT(*) FROM suporte_chamados WHERE barbearia_id = ? AND situacao <> 'encerrado') < ?
      `).bind(id, ctx.barbeariaId, user.id, input.categoria, assunto, tela, ctx.barbeariaId, MAX_ABERTOS),
      db.prepare(`
        INSERT INTO suporte_mensagens (id, chamado_id, barbearia_id, autor_id, lado, texto)
        SELECT ?, ?, ?, ?, 'barbearia', ? WHERE EXISTS (SELECT 1 FROM suporte_chamados WHERE id = ?)
      `).bind(crypto.randomUUID(), id, ctx.barbeariaId, user.id, texto, id),
      auditoria(ctx, "suporte_chamado_aberto", id, { categoria: input.categoria, assunto })
    ]);
    if (r[0].meta.changes !== 1) return fail(`Você já tem ${MAX_ABERTOS} chamados em aberto. Encerre os resolvidos antes de abrir outro.`, 409);
    const c = await db.prepare("SELECT numero FROM suporte_chamados WHERE id = ?").bind(id).first();
    return json({ chamado: { id, numero: Number(c.numero) }, contato: await contatoSuporte(db) }, 201);
  }

  if ((path === "/suporte/responder" || path === "/suporte/encerrar") && method === "POST") {
    const input = await readJson(request);
    if (!validId(input.id)) return fail("Chamado inválido.");
    const c = await db.prepare("SELECT * FROM suporte_chamados WHERE id = ? AND barbearia_id = ?").bind(input.id, ctx.barbeariaId).first();
    if (!c) return fail("Chamado não encontrado.", 404);
    if (path === "/suporte/encerrar") {
      if (c.situacao === "encerrado") return fail("O chamado já está encerrado.", 409);
      await db.batch([
        db.prepare(`UPDATE suporte_chamados SET situacao = 'encerrado', encerrado_em = CURRENT_TIMESTAMP, encerrado_por = ?,
          atualizado_em = CURRENT_TIMESTAMP WHERE id = ? AND barbearia_id = ?`).bind(user.id, c.id, ctx.barbeariaId),
        auditoria(ctx, "suporte_chamado_encerrado", c.id)
      ]);
      return json({ mensagem: "Chamado encerrado." });
    }
    const texto = textoMensagem(input.mensagem);
    if (!texto) return fail("Escreva a mensagem (3 a 3000 letras).");
    // Responder um chamado encerrado reabre (volta para o suporte).
    await db.batch([
      db.prepare("INSERT INTO suporte_mensagens (id, chamado_id, barbearia_id, autor_id, lado, texto) VALUES (?, ?, ?, ?, 'barbearia', ?)")
        .bind(crypto.randomUUID(), c.id, ctx.barbeariaId, user.id, texto),
      db.prepare(`UPDATE suporte_chamados SET situacao = 'aguardando_suporte', encerrado_em = NULL, encerrado_por = NULL,
        atualizado_em = CURRENT_TIMESTAMP WHERE id = ? AND barbearia_id = ?`).bind(c.id, ctx.barbeariaId),
      auditoria(ctx, c.situacao === "encerrado" ? "suporte_chamado_reaberto" : "suporte_mensagem", c.id)
    ]);
    return json({ mensagem: "Mensagem enviada ao suporte." });
  }
  return null;
}

// ---------- plataforma (nós) ----------
export async function rotasSuportePlataforma(ctx, path, method) {
  const { db, request, user } = ctx;

  if (path === "/plataforma/contato-suporte" && method === "GET") return json({ contato: await contatoSuporte(db) });
  if (path === "/plataforma/contato-suporte" && method === "POST") {
    const input = await readJson(request);
    const whatsapp = input.whatsapp ? normalizarTelefone(input.whatsapp) : null;
    if (input.whatsapp && !whatsapp) return fail("WhatsApp inválido (DDD + número).");
    const email = input.email ? String(input.email).trim().toLowerCase() : null;
    if (email && !emailValido(email)) return fail("E-mail inválido.");
    const horario = input.horario ? textoLimpo(input.horario, 3, 120) : null;
    if (input.horario && !horario) return fail("Horário de atendimento: 3 a 120 letras.");
    const grava = (chave, valor) => valor
      ? db.prepare(`INSERT INTO plataforma_config (chave, valor, atualizado_por) VALUES (?, ?, ?)
          ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor, atualizado_por = excluded.atualizado_por, atualizado_em = CURRENT_TIMESTAMP`)
        .bind(chave, valor, user.id)
      : db.prepare("DELETE FROM plataforma_config WHERE chave = ?").bind(chave);   // configuração (não é dado de barbearia)
    const antes = await contatoSuporte(db);
    await db.batch([grava("suporte_whatsapp", whatsapp), grava("suporte_email", email), grava("suporte_horario", horario),
      auditoria({ ...ctx, barbeariaId: null }, "suporte_contato_alterado", null, { antes, depois: { whatsapp, email, horario } })]);
    return json({ contato: await contatoSuporte(db) });
  }

  if (path === "/plataforma/chamados" && method === "GET") {
    const sit = new URL(request.url).searchParams.get("situacao") || "abertos";
    const filtro = sit === "encerrados" ? "c.situacao = 'encerrado'" : "c.situacao <> 'encerrado'";
    const r = await db.prepare(`
      SELECT ${CAMPOS_LISTA} FROM suporte_chamados c JOIN usuarios u ON u.id = c.aberto_por JOIN barbearias b ON b.id = c.barbearia_id
      WHERE ${filtro} ORDER BY c.situacao <> 'aguardando_suporte', c.atualizado_em ${sit === "encerrados" ? "DESC" : "ASC"} LIMIT 200
    `).all();
    const n = await db.prepare("SELECT COUNT(*) AS n FROM suporte_chamados WHERE situacao = 'aguardando_suporte'").first();
    return json({ chamados: r.results.map(chamadoPublico), aguardando: Number(n.n) });
  }

  if (path === "/plataforma/chamado" && method === "GET") {
    const id = new URL(request.url).searchParams.get("id");
    if (!validId(id)) return fail("Chamado inválido.");
    const c = await db.prepare(`
      SELECT ${CAMPOS_LISTA}, u.telefone AS autor_tel, u.perfil AS autor_perfil FROM suporte_chamados c
      JOIN usuarios u ON u.id = c.aberto_por JOIN barbearias b ON b.id = c.barbearia_id WHERE c.id = ?
    `).bind(id).first();
    if (!c) return fail("Chamado não encontrado.", 404);
    return json({ chamado: { ...chamadoPublico(c), telefone: c.autor_tel || null, perfil: c.autor_perfil }, mensagens: await conversa(db, id) });
  }

  if ((path === "/plataforma/chamados/responder" || path === "/plataforma/chamados/encerrar") && method === "POST") {
    const input = await readJson(request);
    if (!validId(input.id)) return fail("Chamado inválido.");
    const c = await db.prepare("SELECT * FROM suporte_chamados WHERE id = ?").bind(input.id).first();
    if (!c) return fail("Chamado não encontrado.", 404);
    const actx = { ...ctx, barbeariaId: c.barbearia_id };
    if (path.endsWith("/encerrar")) {
      if (c.situacao === "encerrado") return fail("O chamado já está encerrado.", 409);
      await db.batch([
        db.prepare(`UPDATE suporte_chamados SET situacao = 'encerrado', encerrado_em = CURRENT_TIMESTAMP, encerrado_por = ?,
          atualizado_em = CURRENT_TIMESTAMP WHERE id = ?`).bind(user.id, c.id),
        auditoria(actx, "suporte_chamado_encerrado", c.id)
      ]);
      return json({ mensagem: "Chamado encerrado." });
    }
    const texto = textoMensagem(input.mensagem);
    if (!texto) return fail("Escreva a resposta (3 a 3000 letras).");
    const encerrar = input.encerrar === true;
    await db.batch([
      db.prepare("INSERT INTO suporte_mensagens (id, chamado_id, barbearia_id, autor_id, lado, texto) VALUES (?, ?, ?, ?, 'suporte', ?)")
        .bind(crypto.randomUUID(), c.id, c.barbearia_id, user.id, texto),
      db.prepare(`UPDATE suporte_chamados SET situacao = ?, encerrado_em = ?, encerrado_por = ?, atualizado_em = CURRENT_TIMESTAMP WHERE id = ?`)
        .bind(encerrar ? "encerrado" : "respondido", encerrar ? new Date().toISOString().slice(0, 19).replace("T", " ") : null, encerrar ? user.id : null, c.id),
      auditoria(actx, "suporte_resposta", c.id, { encerrar })
    ]);
    return json({ mensagem: encerrar ? "Resposta enviada e chamado encerrado." : "Resposta enviada." });
  }
  return null;
}
