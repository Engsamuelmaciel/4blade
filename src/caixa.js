// Caixa (seção 4.3): abertura, entradas do dia (atendimentos e vendas, valor BRUTO), sangria, suprimento,
// correção de forma de pagamento, fechamento (esperado × contado) e reabertura só pelo gerente, com motivo.
// O caixa NUNCA vê comissão, custo nem margem.
import { json, fail, HttpError, readJson, validCentavos, validDate, textoOpcional, exigirMotivo, auditoria, auditoriaSe, hojeBrasil } from "./util.js";
import { isGestao } from "./perfis.js";
import { exigirBarbearia } from "./usuarios.js";
import { FORMAS, formaEfetiva, telefoneReal, somarDias } from "./agenda-util.js";
import { finalizarDados, atendimentoAvulso } from "./agenda.js";

const erro = (msg, status = 400) => { throw new HttpError(msg, status); };
const NOME_FORMA = { dinheiro: "dinheiro", pix: "Pix", debito: "débito", credito: "crédito" };

// Lista e totais de um caixa. Totais por forma = atendimentos + vendas (já com estornos e correções).
export async function resumoCaixa(db, barbeariaId, caixa) {
  const [lanc, movs, vendas, notas, receb] = await Promise.all([
    db.prepare(`
      SELECT l.id, l.tipo, l.forma, l.valor_centavos, l.criado_em, l.finalizacao_id, f.estornada,
        ${formaEfetiva("l.id", "l.forma")} AS forma_atual,
        a.inicio, c.nome AS cliente, u.nome AS barbeiro,
        (SELECT group_concat(nome, ' + ') FROM (SELECT i.nome FROM finalizacao_itens i WHERE i.finalizacao_id = l.finalizacao_id ORDER BY i.rowid)) AS descricao
      FROM caixa_lancamentos l
      LEFT JOIN finalizacoes f ON f.id = l.finalizacao_id
      LEFT JOIN agendamentos a ON a.id = f.agendamento_id
      LEFT JOIN clientes c ON c.id = a.cliente_id
      LEFT JOIN usuarios u ON u.id = f.barbeiro_id
      WHERE l.caixa_id = ? AND l.barbearia_id = ?`).bind(caixa.id, barbeariaId).all(),
    db.prepare(`
      SELECT m.*, ${formaEfetiva("m.id", "m.forma")} AS forma_atual, u.nome AS usuario
      FROM caixa_movimentos m JOIN usuarios u ON u.id = m.criado_por
      WHERE m.caixa_id = ? AND m.barbearia_id = ?`).bind(caixa.id, barbeariaId).all(),
    db.prepare(`
      SELECT v.id, v.situacao, v.total_centavos, v.motivo_cancelamento, uv.nome AS vendedor, c.nome AS cliente,
        d.percentual_bp AS desconto_bp, d.valor_centavos AS desconto_centavos, d.bruto_centavos,
        (SELECT group_concat(nome, ', ') FROM (SELECT i.quantidade || 'x ' || i.nome AS nome FROM venda_itens i WHERE i.venda_id = v.id ORDER BY i.rowid)) AS itens
      FROM vendas v JOIN usuarios uv ON uv.id = v.vendedor_id LEFT JOIN clientes c ON c.id = v.cliente_id
      LEFT JOIN venda_descontos d ON d.venda_id = v.id
      WHERE v.caixa_id = ? AND v.barbearia_id = ?`).bind(caixa.id, barbeariaId).all(),
    // Notas (promissórias) lançadas neste caixa: não são dinheiro do dia.
    db.prepare(`SELECT p.id, p.origem, p.valor_centavos, p.descricao, p.situacao, p.criado_em, c.nome AS cliente
                FROM promissorias p JOIN clientes c ON c.id = p.cliente_id WHERE p.caixa_id = ? AND p.barbearia_id = ?`).bind(caixa.id, barbeariaId).all(),
    // Notas recebidas (quitadas) neste caixa: entram nas formas de pagamento.
    db.prepare(`SELECT pp.id, pp.forma, pp.valor_centavos, r.id AS recebimento_id, r.situacao, r.criado_em, c.nome AS cliente,
                  (SELECT COUNT(*) FROM promissorias x WHERE x.recebimento_id = r.id) AS notas
                FROM promissoria_pagamentos pp JOIN promissoria_recebimentos r ON r.id = pp.recebimento_id JOIN clientes c ON c.id = r.cliente_id
                WHERE pp.caixa_id = ? AND pp.barbearia_id = ?`).bind(caixa.id, barbeariaId).all()
  ]);
  const vendaPor = Object.fromEntries(vendas.results.map(v => [v.id, v]));
  const porForma = Object.fromEntries(FORMAS.map(f => [f, 0]));
  let atendimentos = 0, vendasTot = 0, sangrias = 0, suprimentos = 0, notasLancadas = 0, notasRecebidas = 0;

  const itens = [];
  for (const n of notas.results) {
    if (n.situacao !== "estornada") notasLancadas += n.valor_centavos;
    itens.push({
      id: n.id, tipo: "promissoria", em: n.criado_em, forma: "promissoria", formaAtual: "promissoria", valorCentavos: n.valor_centavos,
      hora: null, cliente: n.cliente, barbeiro: null, descricao: n.descricao, notaSituacao: n.situacao, corrigido: false, podeCorrigir: false
    });
  }
  for (const r of receb.results) {
    const ativo = r.situacao === "ativo";
    if (ativo) { porForma[r.forma] += r.valor_centavos; notasRecebidas += r.valor_centavos; }
    itens.push({
      id: r.id, tipo: "recebimento_promissoria", em: r.criado_em, forma: r.forma, formaAtual: r.forma, valorCentavos: r.valor_centavos,
      hora: null, cliente: r.cliente, barbeiro: null, descricao: `Pagamento de ${r.notas} nota(s)${ativo ? "" : " — estornado"}`,
      recebimentoEstornado: !ativo, corrigido: false, podeCorrigir: false
    });
  }
  for (const l of lanc.results) {
    porForma[l.forma] += l.valor_centavos;
    atendimentos += l.valor_centavos;
    itens.push({
      id: l.id, tipo: l.tipo, em: l.criado_em, forma: l.forma, formaAtual: l.forma_atual, valorCentavos: l.valor_centavos,
      hora: l.inicio ? l.inicio.slice(11) : null, cliente: l.cliente, barbeiro: l.barbeiro, descricao: l.descricao,
      corrigido: l.forma_atual !== l.forma,
      podeCorrigir: l.tipo === "atendimento" && !l.estornada && caixa.situacao === "aberto"
    });
  }
  for (const m of movs.results) {
    const v = m.venda_id ? vendaPor[m.venda_id] : null;
    if (m.tipo === "sangria") sangrias += -m.valor_centavos;
    else if (m.tipo === "suprimento") suprimentos += m.valor_centavos;
    else {
      porForma[m.forma] += m.valor_centavos;
      if (m.tipo === "venda" || m.tipo === "estorno_venda") vendasTot += m.valor_centavos;
    }
    if (m.tipo === "correcao_saida" || m.tipo === "correcao_entrada") continue;   // aparecem como "corrigido" no lançamento original
    itens.push({
      id: m.id, tipo: m.tipo, em: m.criado_em, forma: m.forma, formaAtual: m.forma_atual, valorCentavos: m.valor_centavos,
      hora: null, cliente: v?.cliente || null, barbeiro: v?.vendedor || null,
      descricao: m.tipo === "sangria" || m.tipo === "suprimento" ? `${m.motivo} (${m.usuario})` : v?.itens || null,
      vendaId: m.venda_id || null, vendaCancelada: v?.situacao === "cancelada",
      desconto: m.tipo === "venda" && v?.desconto_bp ? { percentualBp: v.desconto_bp, valorCentavos: v.desconto_centavos, brutoCentavos: v.bruto_centavos } : null,
      corrigido: m.forma_atual !== m.forma,
      podeCorrigir: m.tipo === "venda" && v?.situacao === "ativa" && caixa.situacao === "aberto",
      podeCancelarVenda: m.tipo === "venda" && v?.situacao === "ativa" && caixa.situacao === "aberto"
    });
  }
  itens.sort((a, b) => a.em.localeCompare(b.em));
  // Uma venda com 2 formas aparece em 2 linhas; o botão de cancelar fica só na primeira.
  const vistas = new Set();
  for (const i of itens) if (i.vendaId) { if (vistas.has(i.vendaId)) i.podeCancelarVenda = false; vistas.add(i.vendaId); }

  return {
    lancamentos: itens,
    vendas: vendas.results.map(v => ({ id: v.id, situacao: v.situacao, totalCentavos: v.total_centavos, itens: v.itens, vendedor: v.vendedor, cliente: v.cliente, motivoCancelamento: v.motivo_cancelamento,
      descontoBp: v.desconto_bp || 0, descontoCentavos: v.desconto_centavos || 0 })),
    totais: {
      porForma,
      atendimentosCentavos: atendimentos,
      vendasCentavos: vendasTot,
      entradasCentavos: atendimentos + vendasTot + notasRecebidas,
      notasLancadasCentavos: notasLancadas,          // ficou na promissória (não entrou dinheiro hoje)
      notasRecebidasCentavos: notasRecebidas,        // notas antigas pagas hoje (já somadas nas formas)
      sangriasCentavos: sangrias,
      suprimentosCentavos: suprimentos,
      // dinheiro esperado na gaveta = troco + entradas em dinheiro + suprimentos − sangrias
      dinheiroEsperadoCentavos: caixa.troco_centavos + porForma.dinheiro + suprimentos - sangrias,
      // Saldo negativo (17/11/2026): retiradas maiores que o dinheiro (ex.: lanche pago no Pix lançado como sangria).
      saldoNegativoCentavos: Math.max(0, -(caixa.troco_centavos + porForma.dinheiro + suprimentos - sangrias))
    }
  };
}

// Sangria automática (conta paga ou comissão paga com dinheiro do caixa): confere caixa de hoje aberto e dinheiro suficiente.
// Devolve { id, comando } para ir no mesmo lote da operação.
// Caixa onde entra um lançamento de HOJE (pedido de 17/11/2026: o gerente/dono lança com o caixa aberto ou não).
// Equipe (caixa/barbeiro): só com o caixa de hoje aberto. Gestão: se o caixa de hoje ainda não existe, abre sozinho
// (troco R$ 0,00, fica registrado); se já foi fechado, o lançamento entra nele mesmo ("depois do fechamento").
export async function caixaParaLancar(ctx, msgFechado = "O caixa de hoje não está aberto. Peça para abrir o caixa.") {
  const hoje = hojeBrasil();
  let c = await caixaDoDia(ctx.db, ctx.barbeariaId, hoje);
  if (c && c.situacao === "aberto") return c;
  // 19/11/2026 (pedido do responsável): qualquer pessoa lança com o caixa fechado ou ainda não aberto.
  // Fechado: o lançamento entra no caixa de hoje depois do fechamento. Não aberto: abre sozinho (troco R$ 0,00).
  void msgFechado;
  if (!c) {
    const id = crypto.randomUUID();
    await ctx.db.batch([
      ctx.db.prepare("INSERT INTO caixas (id, barbearia_id, data, troco_centavos, aberto_por) VALUES (?, ?, ?, 0, ?) ON CONFLICT(barbearia_id, data) DO NOTHING")
        .bind(id, ctx.barbeariaId, hoje, ctx.user.id),
      auditoria(ctx, "caixa_aberto", id, { depois: { data: hoje, troco: 0 }, motivo: "Aberto automaticamente pelo primeiro lançamento do dia" })
    ]);
    c = await caixaDoDia(ctx.db, ctx.barbeariaId, hoje);
  }
  return c;
}
// Condição SQL do caixa no momento de gravar: o caixa precisa existir (aberto ou fechado: todos lançam, 19/11/2026).
// eslint-disable-next-line no-unused-vars
export const sqlCaixaOk = ctx => "EXISTS (SELECT 1 FROM caixas WHERE id = ?)";

export async function sangriaAutomatica(ctx, valorCentavos, motivo) {
  // Sai dinheiro da gaveta (despesa ou comissão paga "com dinheiro do caixa"). 19/11/2026: sem trava — o caixa de hoje
  // abre sozinho se preciso, vale fechado, e sem dinheiro suficiente fica com saldo negativo (quem marcou "saiu do caixa" confirmou).
  const caixa = await caixaParaLancar(ctx);
  const id = crypto.randomUUID();
  return {
    id,
    comando: ctx.db.prepare(`INSERT INTO caixa_movimentos (id, barbearia_id, caixa_id, tipo, forma, valor_centavos, motivo, criado_por)
                             VALUES (?, ?, ?, 'sangria', 'dinheiro', ?, ?, ?)`).bind(id, ctx.barbeariaId, caixa.id, -valorCentavos, motivo, ctx.user.id)
  };
}

async function caixaDoDia(db, barbeariaId, data) {
  return db.prepare(`SELECT c.*, u.nome AS aberto_por_nome FROM caixas c JOIN usuarios u ON u.id = c.aberto_por
                     WHERE c.barbearia_id = ? AND c.data = ?`).bind(barbeariaId, data).first();
}

async function respostaCaixa(ctx, data) {
  const { db } = ctx;
  const caixa = await caixaDoDia(db, ctx.barbeariaId, data);
  if (!caixa) return { data, caixa: null, lancamentos: [], totais: null, fechamento: null };
  const [resumo, fech] = await Promise.all([
    resumoCaixa(db, ctx.barbeariaId, caixa),
    db.prepare(`SELECT f.*, u.nome AS fechado_por_nome FROM caixa_fechamentos f JOIN usuarios u ON u.id = f.fechado_por
                WHERE f.caixa_id = ? ORDER BY f.fechado_em DESC, f.rowid DESC`).bind(caixa.id).all()
  ]);
  const ativo = fech.results.find(f => f.ativo);
  return {
    data,
    caixa: { id: caixa.id, situacao: caixa.situacao, trocoCentavos: caixa.troco_centavos, abertoEm: caixa.aberto_em, abertoPor: caixa.aberto_por_nome },
    ...resumo,
    fechamento: ativo ? {
      esperadoCentavos: ativo.esperado_dinheiro_centavos, contadoCentavos: ativo.contado_dinheiro_centavos,
      diferencaCentavos: ativo.diferenca_centavos, observacao: ativo.observacao, fechadoPor: ativo.fechado_por_nome, fechadoEm: ativo.fechado_em
    } : null,
    reaberturas: fech.results.filter(f => !f.ativo).map(f => ({ fechadoEm: f.fechado_em, reabertoEm: f.reaberto_em, motivo: f.motivo_reabertura }))
  };
}

// Caixa aberto de um lançamento/movimento (para corrigir forma).
async function lancamentoCorrigivel(ctx, id) {
  const { db } = ctx;
  if (typeof id !== "string" || id.length > 60) erro("Lançamento inválido.");
  const l = await db.prepare(`SELECT l.id, l.caixa_id, l.valor_centavos, l.tipo, f.estornada, NULL AS venda_situacao, ${formaEfetiva("l.id", "l.forma")} AS forma_atual
                              FROM caixa_lancamentos l LEFT JOIN finalizacoes f ON f.id = l.finalizacao_id WHERE l.id = ? AND l.barbearia_id = ?`).bind(id, ctx.barbeariaId).first()
    || await db.prepare(`SELECT m.id, m.caixa_id, m.valor_centavos, m.tipo, 0 AS estornada, v.situacao AS venda_situacao, ${formaEfetiva("m.id", "m.forma")} AS forma_atual
                         FROM caixa_movimentos m LEFT JOIN vendas v ON v.id = m.venda_id WHERE m.id = ? AND m.barbearia_id = ?`).bind(id, ctx.barbeariaId).first();
  if (!l) erro("Lançamento não encontrado.", 404);
  const ok = (l.tipo === "atendimento" && !l.estornada) || (l.tipo === "venda" && l.venda_situacao === "ativa");
  if (!ok) erro("Só dá para corrigir a forma de um atendimento ou venda válidos.", 409);
  const caixa = await db.prepare("SELECT situacao FROM caixas WHERE id = ?").bind(l.caixa_id).first();
  if (caixa.situacao !== "aberto") erro("Caixa já fechado: não dá para corrigir.", 409);
  return l;
}

export async function rotasCaixa(ctx, path, method) {
  if (path !== "/caixa" && !path.startsWith("/caixa/")) return null;
  exigirBarbearia(ctx);
  const { db, user, request } = ctx;
  const gestao = isGestao(user);
  if (!gestao && user.perfil !== "caixa") return fail("Sem permissão", 403);
  const hoje = hojeBrasil();

  if (path === "/caixa/hoje" && method === "GET") return json(await respostaCaixa(ctx, hoje));

  // PDV: atendimentos de hoje para cobrar (sem comissão) + profissionais e serviços para o atendimento sem horário.
  if (path === "/caixa/atendimentos" && method === "GET") {
    const [ags, servs, profs] = await Promise.all([
      db.prepare(`SELECT a.id, a.inicio, a.fim, a.situacao, a.barbeiro_id, u.nome AS barbeiro, c.nome AS cliente, c.telefone,
                    f.total_centavos
                  FROM agendamentos a JOIN usuarios u ON u.id = a.barbeiro_id JOIN clientes c ON c.id = a.cliente_id
                  LEFT JOIN finalizacoes f ON f.agendamento_id = a.id AND f.estornada = 0
                  WHERE a.barbearia_id = ? AND ((a.data = ? AND a.situacao IN ('agendado','finalizado'))
                    OR (a.data BETWEEN ? AND ? AND a.situacao = 'agendado'))   -- atendimentos dos últimos 30 dias que ficaram sem cobrar
                  ORDER BY a.inicio`).bind(ctx.barbeariaId, hoje, somarDias(hoje, -30), somarDias(hoje, -1)).all(),
      db.prepare(`SELECT s.agendamento_id, s.servico_id, s.nome, sv.preco_centavos FROM agendamento_servicos s JOIN agendamentos a ON a.id = s.agendamento_id
                  LEFT JOIN servicos sv ON sv.id = s.servico_id WHERE a.barbearia_id = ? AND a.data BETWEEN ? AND ? AND NOT EXISTS (SELECT 1 FROM agendamento_servicos_removidos rm WHERE rm.linha_id = s.id) ORDER BY s.rowid`).bind(ctx.barbeariaId, somarDias(hoje, -30), hoje).all(),
      db.prepare(`SELECT id, nome FROM usuarios WHERE barbearia_id = ? AND ativo = 1 AND perfil IN ('proprietario','gerente','barbeiro') ORDER BY nome`).bind(ctx.barbeariaId).all()
    ]);
    return json({
      profissionais: profs.results,
      atendimentos: ags.results.map(a => ({
        id: a.id, data: a.inicio.slice(0, 10), atrasado: a.inicio.slice(0, 10) < hoje,
        inicio: a.inicio.slice(11), fim: a.fim.slice(11), situacao: a.situacao, barbeiroId: a.barbeiro_id, barbeiro: a.barbeiro,
        cliente: { nome: a.cliente, telefone: telefoneReal(a.telefone) }, totalCentavos: a.total_centavos ?? null,
        servicos: servs.results.filter(s => s.agendamento_id === a.id).map(s => ({ id: s.servico_id, nome: s.nome, precoCentavos: s.preco_centavos ?? 0 }))
      }))
    });
  }
  if (path === "/caixa/cobrar" && method === "POST") return finalizarDados(ctx, await readJson(request));
  if (path === "/caixa/atendimento-avulso" && method === "POST") return atendimentoAvulso(ctx);

  // Histórico de caixas de outros dias: só gestão.
  if (path === "/caixa/dia" && method === "GET") {
    if (!gestao) return fail("Sem permissão", 403);
    const data = new URL(request.url).searchParams.get("data");
    if (!validDate(data)) return fail("Data inválida.");
    return json(await respostaCaixa(ctx, data));
  }
  if (path === "/caixa/historico" && method === "GET") {
    if (!gestao) return fail("Sem permissão", 403);
    const r = await db.prepare(`
      SELECT c.data, c.situacao, c.troco_centavos,
        (SELECT COALESCE(SUM(valor_centavos), 0) FROM caixa_lancamentos WHERE caixa_id = c.id) +
        (SELECT COALESCE(SUM(valor_centavos), 0) FROM caixa_movimentos WHERE caixa_id = c.id AND tipo IN ('venda','estorno_venda')) AS entradas,
        f.diferenca_centavos, f.observacao
      FROM caixas c LEFT JOIN caixa_fechamentos f ON f.caixa_id = c.id AND f.ativo = 1
      WHERE c.barbearia_id = ? ORDER BY c.data DESC LIMIT 90`).bind(ctx.barbeariaId).all();
    return json({
      caixas: r.results.map(c => ({
        data: c.data, situacao: c.situacao, trocoCentavos: c.troco_centavos, entradasCentavos: c.entradas,
        diferencaCentavos: c.diferenca_centavos ?? null, observacao: c.observacao || null
      }))
    });
  }

  if (path === "/caixa/abrir" && method === "POST") {
    const input = await readJson(request);
    if (!validCentavos(input.trocoCentavos)) return fail("Valor do troco inválido.");
    const id = crypto.randomUUID();
    const r = await db.prepare(`INSERT INTO caixas (id, barbearia_id, data, troco_centavos, aberto_por) VALUES (?, ?, ?, ?, ?)
                                ON CONFLICT(barbearia_id, data) DO NOTHING`).bind(id, ctx.barbeariaId, hoje, input.trocoCentavos, user.id).run();
    if (r.meta.changes !== 1) {
      // Caixa aberto automaticamente pelo 1º lançamento do dia (troco R$ 0,00): aqui só se informa o troco da gaveta,
      // mesmo que já tenha lançamentos (19/11/2026 — sem trava). Informado uma vez; depois, só com suprimento/sangria.
      const c = await caixaDoDia(db, ctx.barbeariaId, hoje);
      const semTroco = c && c.situacao === "aberto" && c.troco_centavos === 0;
      if (!semTroco || !input.trocoCentavos) return fail("O caixa de hoje já foi aberto.", 409);
      await db.batch([
        db.prepare("UPDATE caixas SET troco_centavos = ? WHERE id = ? AND barbearia_id = ? AND troco_centavos = 0").bind(input.trocoCentavos, c.id, ctx.barbeariaId),
        auditoria(ctx, "caixa_troco_definido", c.id, { antes: { troco: 0 }, depois: { troco: input.trocoCentavos } })
      ]);
      return json({ mensagem: "Caixa aberto.", caixa: { id: c.id, data: hoje, trocoCentavos: input.trocoCentavos } }, 201);
    }
    await auditoria(ctx, "caixa_aberto", id, { depois: { data: hoje, troco: input.trocoCentavos } }).run();
    return json({ mensagem: "Caixa aberto.", caixa: { id, data: hoje, trocoCentavos: input.trocoCentavos } }, 201);
  }

  // Sangria (retirada) e suprimento (reforço), sempre em dinheiro e com motivo.
  if (path === "/caixa/movimento" && method === "POST") {
    const input = await readJson(request);
    if (!["sangria", "suprimento"].includes(input.tipo)) return fail("Tipo inválido (sangria ou suprimento).");
    if (!validCentavos(input.valorCentavos) || input.valorCentavos <= 0) return fail("Valor inválido.");
    const motivo = exigirMotivo(input.motivo);
    let caixa = await caixaDoDia(db, ctx.barbeariaId, hoje);
    const aceite = input.aceiteSaldoNegativo === true;
    const fmt = c => `R$ ${(c / 100).toFixed(2).replace(".", ",").replace(/\B(?=(\d{3})+(?!\d))/g, ".")}`;
    // Sangria sem dinheiro suficiente (pedido de 17/11/2026): é aceita, mas só com o aceite de quem lança (aviso na tela);
    // o caixa fica com saldo negativo e a retirada entra como saída no relatório financeiro.
    if (input.tipo === "sangria" && !caixa) {
      if (!aceite) {
        return json({ erro: `O caixa de hoje ainda não foi aberto. Ele será aberto (troco R$ 0,00) e ficará com saldo negativo de ${fmt(input.valorCentavos)}.`,
          codigo: "saldo_negativo", caixaSeraAberto: true, naGavetaCentavos: 0, ficaCentavos: -input.valorCentavos }, 409);
      }
      const cid = crypto.randomUUID();
      await db.batch([
        db.prepare(`INSERT INTO caixas (id, barbearia_id, data, troco_centavos, aberto_por) VALUES (?, ?, ?, 0, ?) ON CONFLICT(barbearia_id, data) DO NOTHING`)
          .bind(cid, ctx.barbeariaId, hoje, user.id),
        auditoria(ctx, "caixa_aberto", cid, { depois: { data: hoje, troco: 0 }, motivo: "Aberto pela sangria (saldo negativo aceito)" })
      ]);
      caixa = await caixaDoDia(db, ctx.barbeariaId, hoje);
    }
    if (!caixa || caixa.situacao !== "aberto") caixa = await caixaParaLancar(ctx);   // todos lançam com o caixa fechado (ou abre o do dia)
    let negativo = false;
    if (input.tipo === "sangria") {
      const { totais } = await resumoCaixa(db, ctx.barbeariaId, caixa);
      if (input.valorCentavos > totais.dinheiroEsperadoCentavos) {
        negativo = true;
        if (!aceite) {
          const fica = totais.dinheiroEsperadoCentavos - input.valorCentavos;
          return json({ erro: `Na gaveta há ${fmt(Math.max(0, totais.dinheiroEsperadoCentavos))} em dinheiro. Com esta retirada o caixa continua aberto com saldo negativo de ${fmt(-fica)}.`,
            codigo: "saldo_negativo", caixaSeraAberto: false, naGavetaCentavos: totais.dinheiroEsperadoCentavos, ficaCentavos: fica }, 409);
        }
      }
    }
    const id = crypto.randomUUID();
    const valor = input.tipo === "sangria" ? -input.valorCentavos : input.valorCentavos;
    await db.batch([
      db.prepare(`INSERT INTO caixa_movimentos (id, barbearia_id, caixa_id, tipo, forma, valor_centavos, motivo, criado_por)
                  SELECT ?, ?, ?, ?, 'dinheiro', ?, ?, ? WHERE ${sqlCaixaOk(ctx)}`)
        .bind(id, ctx.barbeariaId, caixa.id, input.tipo, valor, motivo, user.id, caixa.id),
      auditoriaSe(ctx, "EXISTS (SELECT 1 FROM caixa_movimentos WHERE id = ?)", [id], `caixa_${input.tipo}`, caixa.id, { valor: input.valorCentavos, motivo, ...(negativo ? { saldoNegativoAceito: true } : {}) })
    ]);
    if (!(await db.prepare("SELECT 1 FROM caixa_movimentos WHERE id = ?").bind(id).first())) return fail("O caixa foi fechado.", 409);
    return json({ mensagem: input.tipo === "sangria" ? (negativo ? "Sangria registrada. O caixa está com saldo negativo." : "Sangria registrada.") : "Suprimento registrado." }, 201);
  }

  // Corrigir forma de pagamento antes do fechamento: sai da forma antiga e entra na nova (registrado).
  if (path === "/caixa/corrigir-forma" && method === "POST") {
    const input = await readJson(request);
    if (!FORMAS.includes(input.novaForma)) return fail("Forma de pagamento inválida.");
    const motivo = exigirMotivo(input.motivo);
    const l = await lancamentoCorrigivel(ctx, input.id);
    if (l.forma_atual === input.novaForma) return fail(`Esse lançamento já está em ${NOME_FORMA[input.novaForma]}.`);
    const aberto = "EXISTS (SELECT 1 FROM caixas WHERE id = ? AND situacao = 'aberto')";
    await db.batch([
      db.prepare(`INSERT INTO caixa_movimentos (id, barbearia_id, caixa_id, tipo, forma, valor_centavos, referencia_id, motivo, criado_por)
                  SELECT ?, ?, ?, 'correcao_saida', ?, ?, ?, ?, ? WHERE ${aberto}`)
        .bind(crypto.randomUUID(), ctx.barbeariaId, l.caixa_id, l.forma_atual, -l.valor_centavos, l.id, motivo, user.id, l.caixa_id),
      db.prepare(`INSERT INTO caixa_movimentos (id, barbearia_id, caixa_id, tipo, forma, valor_centavos, referencia_id, motivo, criado_por)
                  SELECT ?, ?, ?, 'correcao_entrada', ?, ?, ?, ?, ? WHERE ${aberto}`)
        .bind(crypto.randomUUID(), ctx.barbeariaId, l.caixa_id, input.novaForma, l.valor_centavos, l.id, motivo, user.id, l.caixa_id),
      auditoria(ctx, "caixa_forma_corrigida", l.id, { motivo, antes: { forma: l.forma_atual }, depois: { forma: input.novaForma }, valor: l.valor_centavos })
    ]);
    return json({ mensagem: `Forma corrigida para ${NOME_FORMA[input.novaForma]}.` });
  }

  // Fechamento: esperado × contado → diferença (sobra/falta) com observação. Fechado não muda.
  if (path === "/caixa/fechar" && method === "POST") {
    const input = await readJson(request);
    if (!validCentavos(input.contadoCentavos)) return fail("Valor contado inválido.");
    const caixa = await caixaDoDia(db, ctx.barbeariaId, input.data && gestao ? input.data : hoje);
    if (!caixa) return fail("Não há caixa aberto nesse dia.", 404);
    if (caixa.situacao !== "aberto") return fail("Esse caixa já está fechado.", 409);
    const { totais } = await resumoCaixa(db, ctx.barbeariaId, caixa);
    // Com saldo negativo, na gaveta deveria haver R$ 0,00: a diferença é contra zero (o negativo já é saída registrada).
    const diferenca = input.contadoCentavos - Math.max(0, totais.dinheiroEsperadoCentavos);
    const observacao = textoOpcional(input.observacao, 300);
    if (observacao === false) return fail("Observação muito longa (até 300 letras).");
    if (diferenca !== 0 && !observacao) return fail("Há diferença no caixa: escreva uma observação (ex.: troco dado errado).");
    const id = crypto.randomUUID();
    const momento = new Date().toISOString();
    await db.batch([
      db.prepare("UPDATE caixas SET situacao = 'fechado', fechado_por = ?, fechado_em = ? WHERE id = ? AND barbearia_id = ? AND situacao = 'aberto'")
        .bind(user.id, momento, caixa.id, ctx.barbeariaId),
      db.prepare(`INSERT INTO caixa_fechamentos (id, barbearia_id, caixa_id, esperado_dinheiro_centavos, contado_dinheiro_centavos, diferenca_centavos, totais_json, observacao, fechado_por)
                  SELECT ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM caixas WHERE id = ? AND fechado_em = ? AND fechado_por = ?)`)
        .bind(id, ctx.barbeariaId, caixa.id, totais.dinheiroEsperadoCentavos, input.contadoCentavos, diferenca, JSON.stringify(totais), observacao, user.id, caixa.id, momento, user.id),
      auditoriaSe(ctx, "EXISTS (SELECT 1 FROM caixa_fechamentos WHERE id = ?)", [id], "caixa_fechado", caixa.id, {
        esperado: totais.dinheiroEsperadoCentavos, contado: input.contadoCentavos, diferenca, observacao, totais
      })
    ]);
    if (!(await db.prepare("SELECT 1 FROM caixa_fechamentos WHERE id = ?").bind(id).first())) return fail("Não foi possível fechar: o caixa já foi fechado.", 409);
    return json({ fechamento: { esperadoCentavos: totais.dinheiroEsperadoCentavos, contadoCentavos: input.contadoCentavos, diferencaCentavos: diferenca }, totais });
  }

  // Reabrir caixa fechado: só gerente/proprietário, com motivo.
  if (path === "/caixa/reabrir" && method === "POST") {
    if (!gestao) return fail("Só o gerente reabre o caixa.", 403);
    const input = await readJson(request);
    const data = input.data || hoje;
    if (!validDate(data)) return fail("Data inválida.");
    const motivo = exigirMotivo(input.motivo);
    const caixa = await caixaDoDia(db, ctx.barbeariaId, data);
    if (!caixa) return fail("Caixa não encontrado.", 404);
    if (caixa.situacao !== "fechado") return fail("Esse caixa está aberto.", 409);
    await db.batch([
      db.prepare("UPDATE caixas SET situacao = 'aberto', fechado_por = NULL, fechado_em = NULL WHERE id = ? AND barbearia_id = ? AND situacao = 'fechado'")
        .bind(caixa.id, ctx.barbeariaId),
      db.prepare(`UPDATE caixa_fechamentos SET ativo = 0, reaberto_por = ?, reaberto_em = CURRENT_TIMESTAMP, motivo_reabertura = ?
                  WHERE caixa_id = ? AND ativo = 1`).bind(user.id, motivo, caixa.id),
      auditoria(ctx, "caixa_reaberto", caixa.id, { data, motivo })
    ]);
    return json({ mensagem: "Caixa reaberto. Lembre-se de fechar de novo." });
  }

  return fail("Rota não encontrada", 404);
}

