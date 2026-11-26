// Promissória ("notinha"): atendimentos/vendas lançados para o cliente pagar depois (pedido do responsável, 16/11/2026).
// A nota só sai de "em aberto" quando é quitada (recebimento no caixa aberto de hoje, nas formas de pagamento normais).
// Gestão e caixa. Estornar um recebimento (engano) só a gestão, com motivo, e com o caixa daquele dia ainda aberto.
import { json, HttpError, readJson, validId, exigirMotivo, auditoriaSe, hojeBrasil } from "./util.js";
import { isGestao } from "./perfis.js";
import { exigirBarbearia } from "./usuarios.js";
import { lerPagamentos, telefoneReal, linkWhatsapp, somarDias, mesFechado, MSG_MES_FECHADO } from "./agenda-util.js";
import { caixaParaLancar, sqlCaixaOk } from "./caixa.js";

const erro = (msg, status = 400) => { throw new HttpError(msg, status); };
const reais = c => `R$ ${(c / 100).toFixed(2).replace(".", ",").replace(/\B(?=(\d{3})+(?!\d))/g, ".")}`;

function exigirNotas(ctx) {
  exigirBarbearia(ctx);
  if (!isGestao(ctx.user) && ctx.user.perfil !== "caixa") erro("Sem permissão", 403);
}

// Resumo das notas em aberto (também usado no painel).
export async function resumoNotasAbertas(db, barbeariaId) {
  const r = await db.prepare(`SELECT COUNT(DISTINCT cliente_id) AS clientes, COUNT(*) AS notas, COALESCE(SUM(valor_centavos), 0) AS total
                              FROM promissorias WHERE barbearia_id = ? AND situacao = 'aberta'`).bind(barbeariaId).first();
  return { clientes: Number(r.clientes), notas: Number(r.notas), totalCentavos: Number(r.total) };
}

export async function rotasPromissorias(ctx, path, method) {
  if (path !== "/promissorias" && !path.startsWith("/promissorias/")) return null;
  exigirNotas(ctx);
  const { db, user, request } = ctx;

  // Clientes com nota em aberto (e cada nota).
  if (path === "/promissorias" && method === "GET") {
    const r = await db.prepare(`
      SELECT p.id, p.cliente_id, p.origem, p.valor_centavos, p.descricao, p.criado_em, cx.data,
             c.nome AS cliente, c.telefone
      FROM promissorias p JOIN clientes c ON c.id = p.cliente_id JOIN caixas cx ON cx.id = p.caixa_id
      WHERE p.barbearia_id = ? AND p.situacao = 'aberta' ORDER BY c.nome, cx.data, p.criado_em`).bind(ctx.barbeariaId).all();
    const porCliente = new Map();
    for (const n of r.results) {
      const c = porCliente.get(n.cliente_id) || { clienteId: n.cliente_id, cliente: n.cliente, telefone: telefoneReal(n.telefone), totalCentavos: 0, desde: n.data, notas: [] };
      c.totalCentavos += n.valor_centavos;
      if (n.data < c.desde) c.desde = n.data;
      c.notas.push({ id: n.id, data: n.data, origem: n.origem, descricao: n.descricao, valorCentavos: n.valor_centavos });
      porCliente.set(n.cliente_id, c);
    }
    const clientes = [...porCliente.values()].map(c => ({
      ...c,
      // Lembrete de cobrança pronto no WhatsApp (só se o cliente tiver telefone).
      whatsapp: linkWhatsapp(c.telefone, `Olá, ${c.cliente.split(" ")[0]}! Passando para lembrar da sua nota na ${user.barbearia_nome}: ${reais(c.totalCentavos)} (${c.notas.length} lançamento(s) desde ${c.desde.split("-").reverse().join("/")}). Obrigado!`), comNumero: Boolean(c.telefone)
    })).sort((a, b) => b.totalCentavos - a.totalCentavos);
    return json({ clientes, resumo: await resumoNotasAbertas(db, ctx.barbeariaId) });
  }

  // Histórico de notas: pagas (com a data do pagamento) ou canceladas, dos últimos 90 dias. Nada some do sistema.
  if (path === "/promissorias/historico" && method === "GET") {
    const situacao = new URL(request.url).searchParams.get("situacao") === "canceladas" ? "estornada" : "quitada";
    const r = await db.prepare(`
      SELECT p.id, p.origem, p.valor_centavos, p.descricao, p.motivo_estorno, cx.data, c.nome AS cliente,
             r.criado_em AS pago_em, (SELECT cr.data FROM caixas cr WHERE cr.id = r.caixa_id) AS pago_dia
      FROM promissorias p JOIN caixas cx ON cx.id = p.caixa_id JOIN clientes c ON c.id = p.cliente_id
      LEFT JOIN promissoria_recebimentos r ON r.id = p.recebimento_id
      WHERE p.barbearia_id = ? AND p.situacao = ? AND cx.data >= ? ORDER BY COALESCE(r.criado_em, p.criado_em) DESC LIMIT 300`)
      .bind(ctx.barbeariaId, situacao, somarDias(hojeBrasil(), -90)).all();
    return json({
      notas: r.results.map(n => ({ id: n.id, cliente: n.cliente, data: n.data, origem: n.origem, descricao: n.descricao, valorCentavos: n.valor_centavos,
        situacao: situacao === "quitada" ? "paga" : "cancelada", pagoEm: n.pago_dia || null, motivo: n.motivo_estorno || null }))
    });
  }

  // Cancelar uma nota em aberto (perdoar a dívida ou lançamento errado): só gerente/proprietário, com motivo.
  // O atendimento/venda continua registrado; a nota fica como "cancelada" (nada é apagado).
  if (path === "/promissorias/cancelar" && method === "POST") {
    if (!isGestao(user)) erro("Só o gerente ou o proprietário cancela uma nota.", 403);
    const input = await readJson(request);
    if (!validId(input.id)) erro("Nota inválida.");
    const motivo = exigirMotivo(input.motivo);
    const n = await db.prepare("SELECT id, situacao, valor_centavos, cliente_id FROM promissorias WHERE id = ? AND barbearia_id = ?").bind(input.id, ctx.barbeariaId).first();
    if (!n) erro("Nota não encontrada.", 404);
    if (n.situacao === "quitada") erro("Essa nota já foi paga: fica registrada como paga. Para desfazer o pagamento, estorne o recebimento.", 409);
    if (n.situacao !== "aberta") erro("Essa nota já foi cancelada.", 409);
    const r = await db.batch([
      db.prepare("UPDATE promissorias SET situacao = 'estornada', motivo_estorno = ? WHERE id = ? AND barbearia_id = ? AND situacao = 'aberta'")
        .bind(`Cancelada pelo gerente: ${motivo}`, n.id, ctx.barbeariaId),
      auditoriaSe(ctx, "EXISTS (SELECT 1 FROM promissorias WHERE id = ? AND situacao = 'estornada' AND motivo_estorno = ?)", [n.id, `Cancelada pelo gerente: ${motivo}`],
        "promissoria_cancelada", n.id, { motivo, valor: n.valor_centavos, antes: { situacao: "aberta" }, depois: { situacao: "cancelada" } })
    ]);
    if (!r[0].meta?.changes) erro("Essa nota não está mais em aberto. Atualize a tela.", 409);
    return json({ mensagem: "Nota cancelada." });
  }

  // Notas quitadas (recebimentos) dos últimos 30 dias.
  if (path === "/promissorias/recebimentos" && method === "GET") {
    const r = await db.prepare(`
      SELECT r.id, r.total_centavos, r.situacao, r.motivo_estorno, r.criado_em, cx.data, cx.situacao AS caixa_situacao, c.nome AS cliente, u.nome AS usuario,
             (SELECT group_concat(forma || ':' || valor_centavos, ',') FROM promissoria_pagamentos WHERE recebimento_id = r.id) AS formas,
             (SELECT COUNT(*) FROM promissorias WHERE recebimento_id = r.id) AS notas
      FROM promissoria_recebimentos r JOIN caixas cx ON cx.id = r.caixa_id JOIN clientes c ON c.id = r.cliente_id JOIN usuarios u ON u.id = r.criado_por
      WHERE r.barbearia_id = ? AND cx.data >= ? ORDER BY r.criado_em DESC LIMIT 200`).bind(ctx.barbeariaId, somarDias(hojeBrasil(), -30)).all();
    return json({
      recebimentos: r.results.map(x => ({
        id: x.id, data: x.data, cliente: x.cliente, totalCentavos: x.total_centavos, notas: Number(x.notas), situacao: x.situacao,
        motivoEstorno: x.motivo_estorno || null, por: x.usuario,
        pagamentos: (x.formas || "").split(",").filter(Boolean).map(f => ({ forma: f.split(":")[0], valorCentavos: Number(f.split(":")[1]) })),
        podeEstornar: isGestao(user) && x.situacao === "ativo" && x.caixa_situacao === "aberto" && !mesFechado(x.data)
      }))
    });
  }

  // Receber (quitar) notas de um cliente: o valor entra no caixa aberto de HOJE, nas formas escolhidas.
  if (path === "/promissorias/receber" && method === "POST") {
    const input = await readJson(request);
    if (!validId(input.clienteId)) erro("Cliente inválido.");
    const ids = input.promissoriaIds;
    if (!Array.isArray(ids) || ids.length < 1 || ids.length > 200 || !ids.every(validId) || new Set(ids).size !== ids.length) erro("Escolha as notas a quitar.");
    const caixa = await caixaParaLancar(ctx, "Abra o caixa de hoje para receber a nota.");   // gerente: também com o caixa fechado
    const notas = (await db.prepare(`SELECT id, valor_centavos FROM promissorias WHERE barbearia_id = ? AND cliente_id = ? AND situacao = 'aberta'
                                     AND id IN (${ids.map(() => "?").join(",")})`).bind(ctx.barbeariaId, input.clienteId, ...ids).all()).results;
    if (notas.length !== ids.length) erro("Alguma nota não está mais em aberto (ou é de outro cliente). Atualize a tela.", 409);
    const total = notas.reduce((t, n) => t + n.valor_centavos, 0);
    const pagamentos = lerPagamentos(input.pagamentos, total);
    const id = crypto.randomUUID();
    const existe = ["EXISTS (SELECT 1 FROM promissoria_recebimentos WHERE id = ?)", [id]];
    const marcas = ids.map(() => "?").join(",");
    await db.batch([
      // O recebimento só nasce se TODAS as notas ainda estão em aberto e o caixa está aberto (sem pagar duas vezes).
      db.prepare(`INSERT INTO promissoria_recebimentos (id, barbearia_id, cliente_id, caixa_id, total_centavos, criado_por)
                  SELECT ?, ?, ?, ?, ?, ? WHERE ${sqlCaixaOk(ctx)}
                    AND (SELECT COUNT(*) FROM promissorias WHERE barbearia_id = ? AND cliente_id = ? AND situacao = 'aberta' AND id IN (${marcas})) = ?`)
        .bind(id, ctx.barbeariaId, input.clienteId, caixa.id, total, user.id, caixa.id, ctx.barbeariaId, input.clienteId, ...ids, ids.length),
      db.prepare(`UPDATE promissorias SET situacao = 'quitada', recebimento_id = ? WHERE barbearia_id = ? AND situacao = 'aberta' AND id IN (${marcas}) AND ${existe[0]}`)
        .bind(id, ctx.barbeariaId, ...ids, ...existe[1]),
      ...pagamentos.map(p => db.prepare(`INSERT INTO promissoria_pagamentos (id, barbearia_id, recebimento_id, caixa_id, forma, valor_centavos)
                  SELECT ?, ?, ?, ?, ?, ? WHERE ${existe[0]}`).bind(crypto.randomUUID(), ctx.barbeariaId, id, caixa.id, p.forma, p.valorCentavos, ...existe[1])),
      auditoriaSe(ctx, ...existe, "promissoria_recebida", input.clienteId, { recebimento: id, notas: ids, total, pagamentos })
    ]);
    if (!(await db.prepare("SELECT 1 FROM promissoria_recebimentos WHERE id = ?").bind(id).first())) {
      erro("Não foi possível receber: alguma nota já foi paga ou o caixa foi fechado. Atualize a tela.", 409);
    }
    return json({ recebimento: { id, totalCentavos: total, notas: ids.length } }, 201);
  }

  // Estornar um recebimento lançado por engano: as notas voltam a ficar em aberto. Só gestão, com o caixa do dia aberto.
  if (path === "/promissorias/estornar-recebimento" && method === "POST") {
    if (!isGestao(user)) erro("Só o gerente ou o proprietário estorna um recebimento.", 403);
    const input = await readJson(request);
    if (!validId(input.recebimentoId)) erro("Recebimento inválido.");
    const motivo = exigirMotivo(input.motivo);
    const r = await db.prepare(`SELECT r.*, cx.situacao AS caixa_situacao, cx.data AS caixa_data FROM promissoria_recebimentos r JOIN caixas cx ON cx.id = r.caixa_id
                                WHERE r.id = ? AND r.barbearia_id = ?`).bind(input.recebimentoId, ctx.barbeariaId).first();
    if (!r) erro("Recebimento não encontrado.", 404);
    if (r.situacao !== "ativo") erro("Esse recebimento já foi estornado.", 409);
    if (mesFechado(r.caixa_data)) erro(MSG_MES_FECHADO, 409);
    if (r.caixa_situacao !== "aberto") erro("O caixa do dia desse recebimento já foi fechado: reabra o caixa antes.", 409);
    const momento = new Date().toISOString();
    const feito = ["EXISTS (SELECT 1 FROM promissoria_recebimentos WHERE id = ? AND estornado_em = ?)", [r.id, momento]];
    await db.batch([
      db.prepare(`UPDATE promissoria_recebimentos SET situacao = 'estornado', motivo_estorno = ?, estornado_por = ?, estornado_em = ?
                  WHERE id = ? AND barbearia_id = ? AND situacao = 'ativo' AND EXISTS (SELECT 1 FROM caixas WHERE id = ? AND situacao = 'aberto')`)
        .bind(motivo, user.id, momento, r.id, ctx.barbeariaId, r.caixa_id),
      db.prepare(`UPDATE promissorias SET situacao = 'aberta', recebimento_id = NULL WHERE recebimento_id = ? AND barbearia_id = ? AND ${feito[0]}`)
        .bind(r.id, ctx.barbeariaId, ...feito[1]),
      auditoriaSe(ctx, ...feito, "promissoria_recebimento_estornado", r.id, { motivo, total: r.total_centavos, antes: { situacao: "ativo" }, depois: { situacao: "estornado" } })
    ]);
    if (!(await db.prepare("SELECT 1 FROM promissoria_recebimentos WHERE id = ? AND estornado_em = ?").bind(r.id, momento).first())) {
      erro("Não foi possível estornar: o caixa foi fechado ou já foi estornado.", 409);
    }
    return json({ mensagem: "Recebimento estornado: as notas voltaram a ficar em aberto." });
  }
  return null;
}
