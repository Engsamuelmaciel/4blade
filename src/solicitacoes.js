// Pedidos de teste grátis (site → plataforma). Público: POST /api/solicitar-teste. Plataforma: listar, mudar situação.
// O cadastro da barbearia continua manual (POST /plataforma/barbearias com solicitacaoId marca o pedido como cadastrado).
import { json, fail, readJson, validId, textoLimpo, textoOpcional, normalizarTelefone, auditoria } from "./util.js";
import { PLANOS } from "./perfis.js";

const SITUACOES = ["nova", "em_contato", "cadastrada", "descartada"];

const pedidoPublico = s => ({
  id: s.id, numero: Number(s.numero), barbearia: s.barbearia_nome, nome: s.nome, telefone: s.telefone, cidade: s.cidade,
  barbeiros: Number(s.barbeiros), planoInteresse: s.plano_interesse || null, mensagem: s.mensagem || null,
  situacao: s.situacao, observacao: s.observacao || null, barbeariaId: s.barbearia_id || null,
  criadoEm: s.criado_em, atualizadoEm: s.atualizado_em
});

export async function rotaSolicitarTeste({ db, request, ipHash, limitar }) {
  if (!(await limitar(`teste:ip:${ipHash}`, 3, 3600))) return fail("Muitos pedidos deste aparelho. Aguarde 1 hora ou fale com a gente pelo WhatsApp.", 429);
  const input = await readJson(request);
  const barbearia = textoLimpo(input.barbearia, 2, 80);
  if (!barbearia) return fail("Informe o nome da barbearia.");
  const nome = textoLimpo(input.nome, 2, 100);
  if (!nome) return fail("Informe o seu nome.");
  const telefone = normalizarTelefone(input.telefone);
  if (!telefone) return fail("WhatsApp inválido (DDD + número).");
  const cidade = textoLimpo(input.cidade, 2, 80);
  if (!cidade) return fail("Informe a cidade.");
  const barbeiros = input.barbeiros;
  if (!Number.isInteger(barbeiros) || barbeiros < 1 || barbeiros > 99) return fail("Informe quantos barbeiros trabalham na barbearia.");
  const plano = input.planoInteresse || null;
  if (plano !== null && !PLANOS[plano]) return fail("Plano inválido.");
  const mensagem = textoOpcional(input.mensagem, 500);
  if (mensagem === false) return fail("Mensagem muito longa (até 500 letras).");
  if (input.aceite !== true) return fail("Para enviar, aceite que a gente entre em contato e leia a política de privacidade.");

  // Mesmo WhatsApp com pedido em aberto nos últimos 30 dias: não duplica.
  const aberto = await db.prepare(`
    SELECT numero FROM solicitacoes_teste WHERE telefone = ? AND situacao IN ('nova', 'em_contato')
      AND datetime(criado_em) > datetime('now', '-30 days')
  `).bind(telefone).first();
  if (aberto) return json({ numero: Number(aberto.numero), repetido: true, mensagem: "Já recebemos o seu pedido. Em breve falamos com você pelo WhatsApp." });

  const id = crypto.randomUUID();
  await db.batch([
    db.prepare(`
      INSERT INTO solicitacoes_teste (id, numero, barbearia_nome, nome, telefone, cidade, barbeiros, plano_interesse, mensagem, aceite_em, ip_hash)
      SELECT ?, COALESCE((SELECT MAX(numero) FROM solicitacoes_teste), 0) + 1, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?
    `).bind(id, barbearia, nome, telefone, cidade, barbeiros, plano, mensagem, ipHash),
    auditoria({ db, ipHash }, "teste_solicitado", id, { barbearia, cidade, barbeiros, plano })
  ]);
  const r = await db.prepare("SELECT numero FROM solicitacoes_teste WHERE id = ?").bind(id).first();
  return json({ numero: Number(r.numero), mensagem: "Em breve falamos com você pelo WhatsApp." }, 201);
}

export async function rotasSolicitacoesPlataforma(ctx, path, method) {
  const { db, request, user } = ctx;
  if (path === "/plataforma/solicitacoes" && method === "GET") {
    const f = new URL(request.url).searchParams.get("situacao") === "todas" ? "1 = 1" : "situacao IN ('nova', 'em_contato')";
    const r = await db.prepare(`SELECT * FROM solicitacoes_teste WHERE ${f} ORDER BY situacao <> 'nova', criado_em DESC LIMIT 300`).all();
    const n = await db.prepare("SELECT COUNT(*) AS n FROM solicitacoes_teste WHERE situacao = 'nova'").first();
    return json({ solicitacoes: r.results.map(pedidoPublico), novas: Number(n.n) });
  }
  if (path === "/plataforma/solicitacoes/situacao" && method === "POST") {
    const input = await readJson(request);
    if (!validId(input.id)) return fail("Pedido inválido.");
    if (!["em_contato", "descartada", "nova"].includes(input.situacao)) return fail("Situação inválida.");
    const obs = textoOpcional(input.observacao, 300);
    if (obs === false) return fail("Observação muito longa.");
    if (input.situacao === "descartada" && !obs) return fail("Informe o motivo para descartar.");
    const s = await db.prepare("SELECT * FROM solicitacoes_teste WHERE id = ?").bind(input.id).first();
    if (!s) return fail("Pedido não encontrado.", 404);
    if (s.situacao === "cadastrada") return fail("Esse pedido já virou barbearia cadastrada.", 409);
    await db.batch([
      db.prepare(`UPDATE solicitacoes_teste SET situacao = ?, observacao = COALESCE(?, observacao), atualizado_por = ?, atualizado_em = CURRENT_TIMESTAMP
        WHERE id = ? AND situacao <> 'cadastrada'`).bind(input.situacao, obs, user.id, s.id),
      auditoria({ ...ctx, barbeariaId: null }, "teste_situacao", s.id, { antes: s.situacao, depois: input.situacao, observacao: obs })
    ]);
    return json({ mensagem: "Pedido atualizado." });
  }
  return null;
}

export { SITUACOES };
