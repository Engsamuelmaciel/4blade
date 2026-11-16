// Mensagem livre pelo WhatsApp (pedido do responsável, 16/11/2026): escolher clientes do dia (com telefone) e enviar a
// mesma mensagem, personalizada para cada um, por link wa.me (sem API paga). Gestão e caixa (recepção).
import { json, HttpError, readJson, validId, auditoria, hojeBrasil } from "./util.js";
import { isGestao } from "./perfis.js";
import { exigirBarbearia } from "./usuarios.js";
import { exigirData, telefoneReal, linkWhatsapp, preencherModelo, camposMensagem } from "./agenda-util.js";

const erro = (msg, status = 400) => { throw new HttpError(msg, status); };
const CAMPOS = ["cliente", "data", "hora", "barbeiro", "servico", "barbearia"];

function exigirMensagens(ctx) {
  exigirBarbearia(ctx);
  if (!isGestao(ctx.user) && ctx.user.perfil !== "caixa") erro("Sem permissão", 403);
}

// Horários do dia (agendados ou atendidos), sempre da barbearia da sessão.
async function horariosDoDia(ctx, data, ids = null) {
  const r = await ctx.db.prepare(`
    SELECT a.id, a.data, a.inicio, a.situacao, a.cliente_id, c.nome AS cliente_nome, c.telefone AS cliente_telefone, c.ativo AS cliente_ativo,
           u.nome AS barbeiro_nome,
           (SELECT group_concat(nome, ' + ') FROM (SELECT nome FROM agendamento_servicos s WHERE s.agendamento_id = a.id AND NOT EXISTS (SELECT 1 FROM agendamento_servicos_removidos rm WHERE rm.linha_id = s.id) ORDER BY s.rowid)) AS servicos_nomes
    FROM agendamentos a JOIN clientes c ON c.id = a.cliente_id JOIN usuarios u ON u.id = a.barbeiro_id
    WHERE a.barbearia_id = ? AND a.data = ? AND a.situacao IN ('agendado', 'finalizado')
      ${ids ? `AND a.id IN (${ids.map(() => "?").join(",")})` : ""}
    ORDER BY a.inicio`).bind(ctx.barbeariaId, data, ...(ids || [])).all();
  return r.results;
}

export async function rotasMensagens(ctx, path, method) {
  if (path !== "/mensagens" && !path.startsWith("/mensagens/")) return null;
  exigirMensagens(ctx);
  const { db, user, request } = ctx;

  // Clientes do dia: quem tem telefone pode ser escolhido.
  if (path === "/mensagens/clientes-do-dia" && method === "GET") {
    const data = exigirData(new URL(request.url).searchParams.get("data") || hojeBrasil());
    const lista = await horariosDoDia(ctx, data);
    return json({
      data,
      clientes: lista.map(a => ({
        agendamentoId: a.id, hora: a.inicio.slice(11, 16), situacao: a.situacao, cliente: a.cliente_nome,
        telefone: telefoneReal(a.cliente_telefone), barbeiro: a.barbeiro_nome, servicos: a.servicos_nomes || "",
        podeReceber: Boolean(telefoneReal(a.cliente_telefone)) && Boolean(a.cliente_ativo)
      }))
    });
  }

  // Clientes cadastrados com telefone (para mandar mensagem a quem não tem horário no dia).
  if (path === "/mensagens/contatos" && method === "GET") {
    const r = await db.prepare(`SELECT id, nome, telefone FROM clientes WHERE barbearia_id = ? AND ativo = 1 AND telefone NOT LIKE 'sem:%'
                                AND id NOT IN (SELECT cliente_id FROM clientes_excluidos WHERE barbearia_id = ?) ORDER BY nome LIMIT 1000`)
      .bind(ctx.barbeariaId, ctx.barbeariaId).all();
    return json({ contatos: r.results.map(c => ({ clienteId: c.id, nome: c.nome, telefone: telefoneReal(c.telefone) })).filter(c => c.telefone) });
  }

  // Prepara o envio: guarda a mensagem e devolve um link wa.me por cliente, com o texto já personalizado.
  // Por horário do dia (agendamentoIds) ou para clientes cadastrados (clienteIds: só {cliente} e {barbearia}).
  if (path === "/mensagens/envios" && method === "POST") {
    const input = await readJson(request);
    const texto = typeof input.texto === "string" ? input.texto.trim() : "";
    if (texto.length < 2 || texto.length > 1000) erro("Escreva a mensagem (até 1000 letras).");
    for (const m of texto.matchAll(/\{([^{}]*)\}/g)) if (!CAMPOS.includes(m[1])) erro(`Campo {${m[1]}} não existe. Use: ${CAMPOS.map(c => `{${c}}`).join(" ")}.`);
    if (input.clienteIds !== undefined) return enviarParaContatos(ctx, texto, input.clienteIds);
    const data = exigirData(input.data || hojeBrasil());
    const ids = input.agendamentoIds;
    if (!Array.isArray(ids) || ids.length < 1 || ids.length > 100 || !ids.every(validId) || new Set(ids).size !== ids.length) erro("Escolha de 1 a 100 clientes.");
    const lista = await horariosDoDia(ctx, data, ids);
    if (lista.length !== ids.length) erro("Algum cliente escolhido não é deste dia. Atualize a lista.", 404);
    const semFone = lista.filter(a => !telefoneReal(a.cliente_telefone) || !a.cliente_ativo);
    if (semFone.length) erro(`Sem telefone (ou desativado): ${semFone.map(a => a.cliente_nome).join(", ")}.`);
    const id = crypto.randomUUID();
    const destinos = lista.map(a => ({ id: crypto.randomUUID(), a }));
    await db.batch([
      db.prepare("INSERT INTO mensagens_livres (id, barbearia_id, texto, data_ref, criado_por) VALUES (?, ?, ?, ?, ?)").bind(id, ctx.barbeariaId, texto, data, user.id),
      ...destinos.map(d => db.prepare("INSERT INTO mensagens_livres_destinos (id, barbearia_id, mensagem_id, agendamento_id, cliente_id) VALUES (?, ?, ?, ?, ?)")
        .bind(d.id, ctx.barbeariaId, id, d.a.id, d.a.cliente_id)),
      auditoria(ctx, "mensagem_livre_preparada", id, { data, destinatarios: lista.length, texto })
    ]);
    return json({
      envio: {
        id, data, total: destinos.length,
        destinos: destinos.map(d => ({
          id: d.id, cliente: d.a.cliente_nome, hora: d.a.inicio.slice(11, 16),
          link: linkWhatsapp(telefoneReal(d.a.cliente_telefone), preencherModelo(texto, camposMensagem(d.a, user.barbearia_nome)))
        }))
      }
    }, 201);
  }

  // Marca que o WhatsApp foi aberto para aquele cliente (o envio em si acontece no WhatsApp).
  if (path === "/mensagens/envios/aberto" && method === "POST") {
    const input = await readJson(request);
    if (!validId(input.destinoId)) erro("Destino inválido.");
    const agora = new Date().toISOString();
    let r = await db.prepare("UPDATE mensagens_livres_destinos SET aberto_em = COALESCE(aberto_em, ?), aberto_por = COALESCE(aberto_por, ?) WHERE id = ? AND barbearia_id = ?")
      .bind(agora, user.id, input.destinoId, ctx.barbeariaId).run();
    if (!r.meta?.changes) {
      r = await db.prepare("UPDATE mensagens_livres_contatos SET aberto_em = COALESCE(aberto_em, ?), aberto_por = COALESCE(aberto_por, ?) WHERE id = ? AND barbearia_id = ?")
        .bind(agora, user.id, input.destinoId, ctx.barbeariaId).run();
    }
    if (!r.meta?.changes) erro("Destino não encontrado.", 404);
    return json({ ok: true });
  }
  return null;
}

async function enviarParaContatos(ctx, texto, ids) {
  const { db, user } = ctx;
  if (!Array.isArray(ids) || ids.length < 1 || ids.length > 300 || !ids.every(validId) || new Set(ids).size !== ids.length) erro("Escolha de 1 a 300 clientes.");
  const usados = [...texto.matchAll(/\{([^{}]*)\}/g)].map(m => m[1]).filter(c => !["cliente", "barbearia"].includes(c));
  if (usados.length) erro(`Para clientes sem horário use só {cliente} e {barbearia} (tire ${usados.map(c => `{${c}}`).join(", ")}).`);
  const r = await db.prepare(`SELECT id, nome, telefone FROM clientes WHERE barbearia_id = ? AND ativo = 1 AND id IN (${ids.map(() => "?").join(",")})
                              AND id NOT IN (SELECT cliente_id FROM clientes_excluidos WHERE barbearia_id = ?)`).bind(ctx.barbeariaId, ...ids, ctx.barbeariaId).all();
  if (r.results.length !== ids.length) erro("Algum cliente escolhido não foi encontrado. Atualize a lista.", 404);
  const semFone = r.results.filter(c => !telefoneReal(c.telefone));
  if (semFone.length) erro(`Sem telefone: ${semFone.map(c => c.nome).join(", ")}.`);
  const id = crypto.randomUUID();
  const destinos = r.results.sort((a, b) => a.nome.localeCompare(b.nome)).map(c => ({ id: crypto.randomUUID(), c }));
  await db.batch([
    db.prepare("INSERT INTO mensagens_livres (id, barbearia_id, texto, data_ref, criado_por) VALUES (?, ?, ?, ?, ?)").bind(id, ctx.barbeariaId, texto, hojeBrasil(), user.id),
    ...destinos.map(d => db.prepare("INSERT INTO mensagens_livres_contatos (id, barbearia_id, mensagem_id, cliente_id) VALUES (?, ?, ?, ?)").bind(d.id, ctx.barbeariaId, id, d.c.id)),
    auditoria(ctx, "mensagem_livre_preparada", id, { contatos: destinos.length, texto })
  ]);
  return json({
    envio: {
      id, total: destinos.length,
      destinos: destinos.map(d => ({
        id: d.id, cliente: d.c.nome, hora: "",
        link: linkWhatsapp(telefoneReal(d.c.telefone), preencherModelo(texto, { cliente: d.c.nome.split(" ")[0], barbearia: user.barbearia_nome }))
      }))
    }
  }, 201);
}

