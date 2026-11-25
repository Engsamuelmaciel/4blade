// Histórico do cliente (pedido de 25/11/2026): tudo o que o cliente já fez na barbearia, numa leitura só.
// Notas (promissórias) em aberto, próximos atendimentos, atendimentos concluídos (com serviços, quem atendeu, valor e forma),
// faltas, cancelamentos e compras de produtos. SÓ LEITURA, só de cliente cadastrado da barbearia da sessão.
// Quem vê: gestão e caixa (os mesmos que veem a lista de Clientes). Nunca mostra comissão nem custo.
import { json, HttpError, validId, hojeBrasil } from "./util.js";
import { veTodasAgendas } from "./perfis.js";
import { exigirBarbearia } from "./usuarios.js";
import { telefoneReal, somarDias } from "./agenda-util.js";
import { DIAS_NOTA_VENCIDA } from "./notificacoes.js";

const erro = (msg, status = 400) => { throw new HttpError(msg, status); };
const LIMITE = { atendimentos: 60, proximos: 30, faltas: 20, cancelados: 20, compras: 30 };
const diasEntre = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);

// Um agendamento por linha, com os serviços (sem os que foram trocados na edição) e quem atendeu.
// Horário "excluído" não conta (some da agenda).
const SQL_AGENDAMENTOS = `
  SELECT a.id, a.data, substr(a.inicio, 12) AS hora, a.situacao, a.motivo, a.observacao, u.nome AS barbeiro,
         (SELECT group_concat(s.nome, ' + ') FROM agendamento_servicos s
            WHERE s.agendamento_id = a.id AND NOT EXISTS (SELECT 1 FROM agendamento_servicos_removidos r WHERE r.linha_id = s.id)) AS servicos
    FROM agendamentos a JOIN usuarios u ON u.id = a.barbeiro_id
   WHERE a.barbearia_id = ? AND a.cliente_id = ? AND a.situacao = ?
     AND NOT EXISTS (SELECT 1 FROM agendamentos_excluidos x WHERE x.agendamento_id = a.id)`;

export async function historicoDoCliente(ctx, clienteId) {
  const { db, barbeariaId: b } = ctx;
  if (!validId(clienteId)) erro("Cliente inválido.");
  const c = await db.prepare("SELECT id, nome, telefone, ativo, criado_em FROM clientes WHERE id = ? AND barbearia_id = ?").bind(clienteId, b).first();
  if (!c) erro("Cliente não encontrado.", 404);
  const hoje = hojeBrasil();
  const [apelido, bloqueio, notas, proximos, concluidos, faltas, cancelados, compras] = await Promise.all([
    db.prepare("SELECT apelido FROM clientes_apelidos WHERE cliente_id = ? AND barbearia_id = ?").bind(c.id, b).first(),
    db.prepare("SELECT motivo, bloqueado_em FROM clientes_bloqueios WHERE cliente_id = ? AND barbearia_id = ? AND ativo = 1").bind(c.id, b).first(),
    db.prepare(`SELECT p.id, p.valor_centavos, p.descricao, cx.data FROM promissorias p JOIN caixas cx ON cx.id = p.caixa_id
                 WHERE p.barbearia_id = ? AND p.cliente_id = ? AND p.situacao = 'aberta' ORDER BY cx.data, p.criado_em`).bind(b, c.id).all(),
    db.prepare(`${SQL_AGENDAMENTOS} AND a.data >= ? ORDER BY a.data, a.inicio LIMIT ${LIMITE.proximos}`).bind(b, c.id, "agendado", hoje).all(),
    db.prepare(`${SQL_AGENDAMENTOS} ORDER BY a.data DESC, a.inicio DESC`).bind(b, c.id, "finalizado").all(),
    db.prepare(`${SQL_AGENDAMENTOS} ORDER BY a.data DESC, a.inicio DESC LIMIT ${LIMITE.faltas}`).bind(b, c.id, "faltou").all(),
    db.prepare(`${SQL_AGENDAMENTOS} ORDER BY a.data DESC, a.inicio DESC LIMIT ${LIMITE.cancelados}`).bind(b, c.id, "cancelado").all(),
    db.prepare(`SELECT v.id, v.total_centavos, cx.data, substr(v.criado_em, 12, 5) AS hora,
                       (SELECT group_concat(i.quantidade || 'x ' || i.nome, ', ') FROM venda_itens i WHERE i.venda_id = v.id) AS itens
                  FROM vendas v JOIN caixas cx ON cx.id = v.caixa_id
                 WHERE v.barbearia_id = ? AND v.cliente_id = ? AND v.situacao = 'ativa' ORDER BY cx.data DESC, v.criado_em DESC LIMIT ${LIMITE.compras}`).bind(b, c.id).all()
  ]);

  // Valor e forma de cada atendimento concluído (a finalização válida do horário; estornada não conta).
  const ids = concluidos.results.map(a => a.id);
  const porAg = {};
  if (ids.length) {
    const marcas = ids.map(() => "?").join(",");
    const f = await db.prepare(`SELECT f.agendamento_id, f.total_centavos, f.valor_alterado,
                  (SELECT group_concat(DISTINCT l.forma) FROM caixa_lancamentos l WHERE l.finalizacao_id = f.id AND l.valor_centavos > 0) AS formas,
                  EXISTS (SELECT 1 FROM promissorias p WHERE p.finalizacao_id = f.id) AS nota
             FROM finalizacoes f WHERE f.barbearia_id = ? AND f.estornada = 0 AND f.agendamento_id IN (${marcas})`).bind(b, ...ids).all();
    for (const x of f.results) porAg[x.agendamento_id] = x;
  }
  const atendimentos = concluidos.results.map(a => {
    const f = porAg[a.id];
    const formas = [...(f?.formas ? String(f.formas).split(",") : []), ...(f?.nota ? ["promissoria"] : [])];
    return { id: a.id, data: a.data, hora: a.hora, barbeiro: a.barbeiro, servicos: a.servicos || "—", totalCentavos: f ? Number(f.total_centavos) : 0, formas };
  });
  const soma = atendimentos.reduce((t, a) => t + a.totalCentavos, 0);
  const comprasTotal = compras.results.reduce((t, v) => t + Number(v.total_centavos), 0);
  const datas = atendimentos.map(a => a.data).sort();
  const ultima = datas.at(-1) || null;
  const primeira = datas[0] || null;
  const limite = somarDias(hoje, -DIAS_NOTA_VENCIDA);
  const notasLista = notas.results.map(n => ({ id: n.id, data: n.data, valorCentavos: Number(n.valor_centavos), descricao: n.descricao, vencida: n.data <= limite, dias: diasEntre(n.data, hoje) }));
  const [contagem] = (await db.prepare(`SELECT
        SUM(CASE WHEN situacao = 'faltou' THEN 1 ELSE 0 END) AS faltas,
        SUM(CASE WHEN situacao = 'cancelado' THEN 1 ELSE 0 END) AS cancelados
      FROM agendamentos a WHERE a.barbearia_id = ? AND a.cliente_id = ?
        AND NOT EXISTS (SELECT 1 FROM agendamentos_excluidos x WHERE x.agendamento_id = a.id)`).bind(b, c.id).all()).results;
  const mapa = a => ({ id: a.id, data: a.data, hora: a.hora, barbeiro: a.barbeiro, servicos: a.servicos || "—", motivo: a.motivo || null });
  return {
    cliente: { id: c.id, nome: c.nome, apelido: apelido?.apelido || null, telefone: telefoneReal(c.telefone), desde: String(c.criado_em).slice(0, 10), ativo: Boolean(c.ativo),
      bloqueado: bloqueio ? { motivo: bloqueio.motivo, em: String(bloqueio.bloqueado_em).slice(0, 10) } : null },
    resumo: {
      atendimentos: atendimentos.length, gastoCentavos: soma, ticketMedioCentavos: atendimentos.length ? Math.round(soma / atendimentos.length) : 0,
      comprasCentavos: comprasTotal, primeiraVisita: primeira, ultimaVisita: ultima, diasSemVir: ultima ? diasEntre(ultima, hoje) : null,
      faltas: Number(contagem?.faltas || 0), cancelamentos: Number(contagem?.cancelados || 0)
    },
    notasAbertas: { totalCentavos: notasLista.reduce((t, n) => t + n.valorCentavos, 0), notas: notasLista },
    proximos: proximos.results.map(mapa),
    atendimentos: atendimentos.slice(0, LIMITE.atendimentos),
    atendimentosTotal: atendimentos.length,
    faltas: faltas.results.map(mapa),
    cancelados: cancelados.results.map(mapa),
    compras: compras.results.map(v => ({ id: v.id, data: v.data, hora: v.hora, itens: v.itens || "—", totalCentavos: Number(v.total_centavos) }))
  };
}

export async function rotasHistoricoCliente(ctx, path, method) {
  if (path === "/clientes/historico" && method === "GET") {
    exigirBarbearia(ctx);
    if (!veTodasAgendas(ctx.user)) erro("Sem permissão", 403);
    return json(await historicoDoCliente(ctx, new URL(ctx.request.url).searchParams.get("id")));
  }
  return null;
}
