// Caixa do dia — mínimo da E2: abrir com o troco e acompanhar as entradas (valor BRUTO).
// Fechamento, sangria, suprimento e vendas chegam na E3. O caixa NUNCA vê comissão.
import { json, fail, readJson, validCentavos, auditoria, hojeBrasil } from "./util.js";
import { isGestao } from "./perfis.js";
import { exigirBarbearia } from "./usuarios.js";
import { FORMAS } from "./agenda.js";

function exigirCaixa(ctx) {
  exigirBarbearia(ctx);
  if (!isGestao(ctx.user) && ctx.user.perfil !== "caixa") return fail("Sem permissão", 403);
  return null;
}

export async function rotasCaixa(ctx, path, method) {
  if (path !== "/caixa" && !path.startsWith("/caixa/")) return null;
  const negado = exigirCaixa(ctx);
  if (negado) return negado;
  const { db, user, request } = ctx;
  const hoje = hojeBrasil();

  if (path === "/caixa/hoje" && method === "GET") {
    const caixa = await db.prepare(`SELECT c.*, u.nome AS aberto_por_nome FROM caixas c JOIN usuarios u ON u.id = c.aberto_por
                                    WHERE c.barbearia_id = ? AND c.data = ?`).bind(ctx.barbeariaId, hoje).first();
    if (!caixa) return json({ data: hoje, caixa: null, lancamentos: [], totais: null });
    const r = await db.prepare(`
      SELECT l.id, l.tipo, l.forma, l.valor_centavos, l.criado_em, a.inicio, c.nome AS cliente, u.nome AS barbeiro,
        (SELECT group_concat(nome, ' + ') FROM (SELECT i.nome FROM finalizacao_itens i WHERE i.finalizacao_id = l.finalizacao_id ORDER BY i.rowid)) AS servicos
      FROM caixa_lancamentos l
      LEFT JOIN finalizacoes f ON f.id = l.finalizacao_id
      LEFT JOIN agendamentos a ON a.id = f.agendamento_id
      LEFT JOIN clientes c ON c.id = a.cliente_id
      LEFT JOIN usuarios u ON u.id = f.barbeiro_id
      WHERE l.caixa_id = ? AND l.barbearia_id = ?
      ORDER BY l.criado_em, l.rowid
    `).bind(caixa.id, ctx.barbeariaId).all();
    const porForma = Object.fromEntries(FORMAS.map(f => [f, 0]));
    for (const l of r.results) porForma[l.forma] += l.valor_centavos;
    const entradas = r.results.reduce((t, l) => t + l.valor_centavos, 0);
    return json({
      data: hoje,
      caixa: {
        situacao: caixa.situacao, trocoCentavos: caixa.troco_centavos,
        abertoEm: caixa.aberto_em, abertoPor: caixa.aberto_por_nome
      },
      lancamentos: r.results.map(l => ({
        id: l.id, tipo: l.tipo, forma: l.forma, valorCentavos: l.valor_centavos, em: l.criado_em,
        hora: l.inicio ? l.inicio.slice(11) : null, cliente: l.cliente, barbeiro: l.barbeiro, servicos: l.servicos
      })),
      totais: {
        porForma, entradasCentavos: entradas,
        // dinheiro esperado na gaveta = troco + entradas em dinheiro (sangria/suprimento chegam na E3)
        dinheiroEsperadoCentavos: caixa.troco_centavos + porForma.dinheiro
      }
    });
  }

  if (path === "/caixa/abrir" && method === "POST") {
    const input = await readJson(request);
    if (!validCentavos(input.trocoCentavos)) return fail("Valor do troco inválido.");
    const id = crypto.randomUUID();
    const r = await db.prepare(`INSERT INTO caixas (id, barbearia_id, data, troco_centavos, aberto_por) VALUES (?, ?, ?, ?, ?)
                                ON CONFLICT(barbearia_id, data) DO NOTHING`).bind(id, ctx.barbeariaId, hoje, input.trocoCentavos, user.id).run();
    if (r.meta.changes !== 1) return fail("O caixa de hoje já foi aberto.", 409);
    await auditoria(ctx, "caixa_aberto", id, { depois: { data: hoje, troco: input.trocoCentavos } }).run();
    return json({ mensagem: "Caixa aberto.", caixa: { id, data: hoje, trocoCentavos: input.trocoCentavos } }, 201);
  }

  return fail("Rota não encontrada", 404);
}
