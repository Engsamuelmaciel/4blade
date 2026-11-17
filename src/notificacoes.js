// Notificações, nota vencida, bloqueio de cliente e "Visão do dia" (pedido de 17/11/2026).
// Notificações são CALCULADAS na hora a partir dos dados (não há tabela): somem sozinhas quando o problema é resolvido.
//   Gestão: notas vencidas (30 dias), valores alterados (7 dias), produtos vencendo (60 dias) ou vencidos, estoque baixo,
//           despesas atrasadas/vencendo hoje, atendimentos não fechados, caixa de dia anterior aberto, comissão a pagar.
//   Caixa:  atendimentos não fechados, produtos vencendo/vencidos, notas vencidas.
//   Barbeiro: os atendimentos dele que não foram fechados.
// Tudo filtrado pela barbearia da sessão.
import { json, HttpError, readJson, validId, exigirMotivo, auditoria, hojeBrasil } from "./util.js";
import { isGestao, veTodasAgendas } from "./perfis.js";
import { exigirBarbearia } from "./usuarios.js";
import { somarDias, telefoneReal, linkWhatsapp } from "./agenda-util.js";
import { resumoCaixa } from "./caixa.js";

const erro = (msg, status = 400, extra = null) => { throw new HttpError(msg, status, extra); };
const reais = c => `R$ ${(c / 100).toFixed(2).replace(".", ",").replace(/\B(?=(\d{3})+(?!\d))/g, ".")}`;
const dataBR = d => (d ? d.slice(0, 10).split("-").reverse().join("/") : "");
export const DIAS_NOTA_VENCIDA = 30;
export const DIAS_VALIDADE = 60;
const agoraLocal = () => new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 16);   // America/Sao_Paulo (sem horário de verão)
const diasEntre = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);

// Notas (promissórias) em aberto feitas há 30 dias ou mais, por cliente. clienteId opcional.
export async function notasVencidas(db, barbeariaId, clienteId = null, hoje = hojeBrasil()) {
  const limite = somarDias(hoje, -DIAS_NOTA_VENCIDA);
  const r = await db.prepare(`SELECT p.cliente_id, c.nome, c.telefone, COUNT(*) AS qtd, SUM(p.valor_centavos) AS total, MIN(cx.data) AS desde
      FROM promissorias p JOIN caixas cx ON cx.id = p.caixa_id JOIN clientes c ON c.id = p.cliente_id
      WHERE p.barbearia_id = ? AND p.situacao = 'aberta' AND cx.data <= ? ${clienteId ? "AND p.cliente_id = ?" : ""}
      GROUP BY p.cliente_id ORDER BY desde`).bind(barbeariaId, limite, ...(clienteId ? [clienteId] : [])).all();
  return r.results.map(x => ({
    clienteId: x.cliente_id, cliente: x.nome, telefone: telefoneReal(x.telefone), qtd: Number(x.qtd), totalCentavos: Number(x.total),
    desde: x.desde, dias: diasEntre(x.desde, hoje)
  }));
}

// Bloqueio ativo do cliente (ou null).
export async function bloqueioDoCliente(db, barbeariaId, clienteId) {
  return db.prepare("SELECT motivo, bloqueado_em FROM clientes_bloqueios WHERE cliente_id = ? AND barbearia_id = ? AND ativo = 1").bind(clienteId, barbeariaId).first();
}

// Chamado ao marcar horário para cliente JÁ cadastrado: bloqueado → recusa; nota vencida → pede o aceite (pop-up na tela).
export async function conferirClienteParaMarcar(ctx, clienteId, aceite) {
  const b = await bloqueioDoCliente(ctx.db, ctx.barbeariaId, clienteId);
  if (b) erro(`Cliente bloqueado: ${b.motivo}. Para marcar, desbloqueie o cliente antes (Clientes ou Visão do dia).`, 409, { codigo: "cliente_bloqueado" });
  const [n] = await notasVencidas(ctx.db, ctx.barbeariaId, clienteId);
  if (n && aceite !== true) {
    erro(`${n.cliente} tem nota vencida: ${reais(n.totalCentavos)} em aberto desde ${dataBR(n.desde)} (${n.dias} dias).`, 409,
      { codigo: "nota_vencida", nota: { cliente: n.cliente, totalCentavos: n.totalCentavos, qtd: n.qtd, desde: n.desde, dias: n.dias } });
  }
  return n || null;
}

// Mapa clienteId → { notaVencida, bloqueado } para marcar as listas (agenda, busca, clientes).
export async function sinaisClientes(db, barbeariaId, hoje = hojeBrasil()) {
  const [notas, blq] = await Promise.all([
    notasVencidas(db, barbeariaId, null, hoje),
    db.prepare("SELECT cliente_id, motivo FROM clientes_bloqueios WHERE barbearia_id = ? AND ativo = 1").bind(barbeariaId).all()
  ]);
  const m = new Map();
  for (const n of notas) m.set(n.clienteId, { notaVencida: { totalCentavos: n.totalCentavos, desde: n.desde, dias: n.dias } });
  for (const b of blq.results) m.set(b.cliente_id, { ...(m.get(b.cliente_id) || {}), bloqueado: { motivo: b.motivo } });
  return m;
}

// Horários que já terminaram e não foram fechados (nem falta/cancelado), dos últimos 7 dias.
async function naoFechados(db, barbeariaId, barbeiroId = null) {
  const hoje = hojeBrasil();
  const r = await db.prepare(`SELECT a.id, a.data, a.inicio, a.fim, c.nome AS cliente, u.nome AS barbeiro FROM agendamentos a
      JOIN clientes c ON c.id = a.cliente_id JOIN usuarios u ON u.id = a.barbeiro_id
      WHERE a.barbearia_id = ? AND a.situacao = 'agendado' AND a.fim < ? AND a.data >= ? ${barbeiroId ? "AND a.barbeiro_id = ?" : ""}
      AND a.id NOT IN (SELECT agendamento_id FROM agendamentos_excluidos WHERE barbearia_id = ?)
      ORDER BY a.inicio`).bind(barbeariaId, agoraLocal(), somarDias(hoje, -7), ...(barbeiroId ? [barbeiroId] : []), barbeariaId).all();
  return r.results;
}

async function produtosAVencer(db, barbeariaId, hoje) {
  const r = await db.prepare(`SELECT p.nome, p.validade, COALESCE(e.saldo, 0) AS saldo FROM produtos p LEFT JOIN produto_estoque e ON e.produto_id = p.id
      WHERE p.barbearia_id = ? AND p.ativo = 1 AND p.validade IS NOT NULL AND p.validade <= ? AND COALESCE(e.saldo, 0) > 0 ORDER BY p.validade`)
    .bind(barbeariaId, somarDias(hoje, DIAS_VALIDADE)).all();
  return r.results;
}

export async function listarNotificacoes(ctx) {
  const { db, user } = ctx;
  const b = ctx.barbeariaId;
  const hoje = hojeBrasil();
  const gestao = isGestao(user);
  const itens = [];
  const add = (id, nivel, tipo, titulo, texto, rota) => itens.push({ id, nivel, tipo, titulo, texto, rota });

  if (user.perfil === "barbeiro") {
    for (const a of await naoFechados(db, b, user.id)) {
      add(`aberto:${a.id}`, "aviso", "atendimento", "Atendimento não fechado", `${a.cliente} · ${dataBR(a.data)} às ${a.inicio.slice(11)}. Finalize ou marque falta.`, "agenda");
    }
    return { itens };
  }
  if (!gestao && user.perfil !== "caixa") erro("Sem permissão", 403);

  const [abertos, notas, produtos] = await Promise.all([naoFechados(db, b), notasVencidas(db, b, null, hoje), produtosAVencer(db, b, hoje)]);
  for (const n of notas) {
    add(`nota:${n.clienteId}:${n.desde}`, "alerta", "nota", "Nota vencida",
      `${n.cliente} deve ${reais(n.totalCentavos)} desde ${dataBR(n.desde)} (${n.dias} dias).`, "notas");
  }
  for (const a of abertos) {
    add(`aberto:${a.id}`, "aviso", "atendimento", "Atendimento não fechado",
      `${a.cliente} com ${a.barbeiro} · ${dataBR(a.data)} às ${a.inicio.slice(11)}. Cobre no caixa ou marque falta.`, user.perfil === "caixa" ? "caixa" : "agenda");
  }
  for (const p of produtos) {
    const vencido = p.validade < hoje;
    add(`validade:${p.nome}:${p.validade}`, vencido ? "alerta" : "aviso", "produto", vencido ? "Produto vencido" : "Produto perto de vencer",
      `${p.nome}: validade ${dataBR(p.validade)}${vencido ? "" : ` (faltam ${diasEntre(hoje, p.validade)} dias)`} · ${p.saldo} un. no estoque.`, "estoque");
  }

  if (gestao) {
    const desde = somarDias(hoje, -7);
    const [alterados, descontos, baixos, contas, caixas, comissoes] = await Promise.all([
      db.prepare(`SELECT f.id, f.total_centavos, f.total_anterior_centavos, cx.data, c.nome AS cliente, u.nome AS barbeiro,
                    (SELECT SUM(i.preco_tabela_centavos) FROM finalizacao_itens i WHERE i.finalizacao_id = f.id) AS tabela
                  FROM finalizacoes f JOIN caixas cx ON cx.id = f.caixa_id JOIN agendamentos a ON a.id = f.agendamento_id
                  JOIN clientes c ON c.id = a.cliente_id JOIN usuarios u ON u.id = f.barbeiro_id
                  WHERE f.barbearia_id = ? AND f.estornada = 0 AND f.valor_alterado = 1 AND cx.data >= ? ORDER BY cx.data DESC`).bind(b, desde).all(),
      db.prepare(`SELECT v.id, v.total_centavos, d.bruto_centavos, d.percentual_bp, cx.data, u.nome AS vendedor FROM venda_descontos d
                  JOIN vendas v ON v.id = d.venda_id JOIN caixas cx ON cx.id = v.caixa_id JOIN usuarios u ON u.id = v.vendedor_id
                  WHERE d.barbearia_id = ? AND v.situacao = 'ativa' AND cx.data >= ? ORDER BY cx.data DESC`).bind(b, desde).all(),
      db.prepare(`SELECT p.nome, p.estoque_minimo, COALESCE(e.saldo, 0) AS saldo FROM produtos p LEFT JOIN produto_estoque e ON e.produto_id = p.id
                  WHERE p.barbearia_id = ? AND p.ativo = 1 AND p.estoque_minimo > 0 AND COALESCE(e.saldo, 0) < p.estoque_minimo ORDER BY p.nome`).bind(b).all(),
      db.prepare("SELECT id, descricao, valor_centavos, vencimento FROM contas WHERE barbearia_id = ? AND situacao = 'aberta' AND vencimento <= ? ORDER BY vencimento").bind(b, hoje).all(),
      db.prepare("SELECT data FROM caixas WHERE barbearia_id = ? AND situacao = 'aberto' AND data < ? ORDER BY data").bind(b, hoje).all(),
      db.prepare(`SELECT f.id, f.a_pagar_centavos, f.data_fim, u.nome FROM fechamentos_comissao f JOIN usuarios u ON u.id = f.barbeiro_id
                  WHERE f.barbearia_id = ? AND f.pago_em IS NULL ORDER BY f.data_fim`).bind(b).all()
    ]);
    for (const f of alterados.results) {
      const ref = f.total_anterior_centavos !== null && f.total_anterior_centavos !== f.total_centavos
        ? `antes ${reais(f.total_anterior_centavos)}` : `tabela ${reais(Number(f.tabela || 0))}`;
      add(`valor:${f.id}`, "aviso", "valor", "Valor alterado no atendimento", `${f.cliente} com ${f.barbeiro} (${dataBR(f.data)}): cobrado ${reais(f.total_centavos)}, ${ref}.`, "caixa");
    }
    for (const v of descontos.results) {
      add(`desconto:${v.id}`, "info", "valor", "Venda com desconto", `${v.vendedor} (${dataBR(v.data)}): ${reais(v.bruto_centavos)} → ${reais(v.total_centavos)} (${v.percentual_bp / 100}% de desconto).`, "caixa");
    }
    for (const p of baixos.results) add(`repor:${p.nome}`, "aviso", "produto", "Estoque baixo", `${p.nome}: ${p.saldo} un. (mínimo ${p.estoque_minimo}).`, "estoque");
    for (const c of contas.results) {
      add(`conta:${c.id}`, c.vencimento < hoje ? "alerta" : "aviso", "despesa", c.vencimento < hoje ? "Despesa atrasada" : "Despesa vence hoje",
        `${c.descricao}: ${reais(c.valor_centavos)} · vencimento ${dataBR(c.vencimento)}.`, "contas");
    }
    for (const c of caixas.results) add(`caixa:${c.data}`, "alerta", "caixa", "Caixa não fechado", `O caixa de ${dataBR(c.data)} continua aberto. Feche no Caixa.`, "caixa");
    for (const f of comissoes.results) add(`comissao:${f.id}`, "info", "comissao", "Comissão a pagar", `${f.nome}: ${reais(f.a_pagar_centavos)} (fechada até ${dataBR(f.data_fim)}).`, "comissoes");
  }
  const ordem = { alerta: 0, aviso: 1, info: 2 };
  itens.sort((x, y) => ordem[x.nivel] - ordem[y.nivel]);
  return { itens };
}

// ---------- VISÃO DO DIA (caixa e gestão): o dia e a semana num lugar só, com ações ----------
async function visaoDoDia(ctx) {
  const { db, user } = ctx;
  const b = ctx.barbeariaId;
  const hoje = hojeBrasil();
  const fimSemana = somarDias(hoje, 6);
  const [ags, semana, abertos, notas, faltas, caixa, , produtos, bloqueados] = await Promise.all([
    db.prepare(`SELECT a.id, a.inicio, a.fim, a.situacao, c.id AS cliente_id, c.nome AS cliente, c.telefone, u.nome AS barbeiro FROM agendamentos a
                JOIN clientes c ON c.id = a.cliente_id JOIN usuarios u ON u.id = a.barbeiro_id
                WHERE a.barbearia_id = ? AND a.data = ? AND a.situacao <> 'cancelado'
                AND a.id NOT IN (SELECT agendamento_id FROM agendamentos_excluidos WHERE barbearia_id = ?) ORDER BY a.inicio`).bind(b, hoje, b).all(),
    db.prepare(`SELECT data, COUNT(*) AS qtd FROM agendamentos WHERE barbearia_id = ? AND data BETWEEN ? AND ? AND situacao IN ('agendado','finalizado')
                AND id NOT IN (SELECT agendamento_id FROM agendamentos_excluidos WHERE barbearia_id = ?) GROUP BY data`).bind(b, hoje, fimSemana, b).all(),
    naoFechados(db, b),
    notasVencidas(db, b, null, hoje),
    db.prepare(`SELECT a.id, a.data, a.inicio, c.id AS cliente_id, c.nome AS cliente, c.telefone, u.nome AS barbeiro FROM agendamentos a
                JOIN clientes c ON c.id = a.cliente_id JOIN usuarios u ON u.id = a.barbeiro_id
                WHERE a.barbearia_id = ? AND a.situacao = 'faltou' AND a.data BETWEEN ? AND ? ORDER BY a.inicio DESC LIMIT 20`).bind(b, somarDias(hoje, -7), hoje).all(),
    db.prepare("SELECT * FROM caixas WHERE barbearia_id = ? AND data = ?").bind(b, hoje).first(),
    null,
    produtosAVencer(db, b, hoje),
    db.prepare(`SELECT k.cliente_id, k.motivo, k.bloqueado_em, c.nome FROM clientes_bloqueios k JOIN clientes c ON c.id = k.cliente_id
                WHERE k.barbearia_id = ? AND k.ativo = 1 ORDER BY c.nome`).bind(b).all()
  ]);
  const recebidoCentavos = caixa ? (await resumoCaixa(db, b, caixa)).totais.entradasCentavos : 0;
  const sinais = await sinaisClientes(db, b, hoje);
  const primeiro = n => (n || "").split(" ")[0];
  const nomeB = user.barbearia_nome || "barbearia";
  const porDia = Object.fromEntries(semana.results.map(x => [x.data, Number(x.qtd)]));
  const cont = s => ags.results.filter(a => a.situacao === s).length;
  return json({
    hoje,
    resumo: {
      marcados: ags.results.length, finalizados: cont("finalizado"), aguardando: cont("agendado"), faltas: cont("faltou"),
      recebidoCentavos, caixa: caixa ? caixa.situacao : "nao_aberto"
    },
    semana: Array.from({ length: 7 }, (_, i) => { const d = somarDias(hoje, i); return { data: d, marcados: porDia[d] || 0 }; }),
    agenda: ags.results.map(a => ({
      id: a.id, hora: a.inicio.slice(11), fim: a.fim.slice(11), situacao: a.situacao, cliente: a.cliente, clienteId: a.cliente_id, barbeiro: a.barbeiro,
      ...(sinais.get(a.cliente_id) || {}),
      whatsapp: linkWhatsapp(telefoneReal(a.telefone), `Olá, ${primeiro(a.cliente)}! Seu horário hoje na ${nomeB} é às ${a.inicio.slice(11)} com ${primeiro(a.barbeiro)}. Te esperamos!`), comNumero: Boolean(telefoneReal(a.telefone))
    })),
    naoFechados: abertos.map(a => ({ id: a.id, data: a.data, hora: a.inicio.slice(11), cliente: a.cliente, barbeiro: a.barbeiro })),
    notasVencidas: notas.map(n => ({
      ...n, bloqueado: Boolean(sinais.get(n.clienteId)?.bloqueado),
      whatsapp: linkWhatsapp(n.telefone, `Olá, ${primeiro(n.cliente)}! Passando para lembrar da sua nota na ${nomeB}: ${reais(n.totalCentavos)} em aberto desde ${dataBR(n.desde)}. Podemos acertar na sua próxima visita ou por Pix? Obrigado!`), comNumero: Boolean(n.telefone)
    })),
    faltas: faltas.results.map(f => ({
      id: f.id, data: f.data, hora: f.inicio.slice(11), cliente: f.cliente, clienteId: f.cliente_id, barbeiro: f.barbeiro,
      bloqueado: Boolean(sinais.get(f.cliente_id)?.bloqueado),
      whatsapp: linkWhatsapp(telefoneReal(f.telefone), `Olá, ${primeiro(f.cliente)}! Sentimos sua falta no horário de ${dataBR(f.data)} na ${nomeB}. Quer marcar um novo horário?`), comNumero: Boolean(telefoneReal(f.telefone))
    })),
    produtosAVencer: produtos.map(p => ({ nome: p.nome, validade: p.validade, saldo: p.saldo, vencido: p.validade < hoje })),
    bloqueados: bloqueados.results.map(x => ({ clienteId: x.cliente_id, cliente: x.nome, motivo: x.motivo, desde: x.bloqueado_em.slice(0, 10) }))
  });
}

async function clienteDaBarbearia(ctx, id) {
  if (!validId(id)) erro("Cliente inválido.");
  const c = await ctx.db.prepare("SELECT id, nome FROM clientes WHERE id = ? AND barbearia_id = ?").bind(id, ctx.barbeariaId).first();
  if (!c) erro("Cliente não encontrado.", 404);
  return c;
}

export async function rotasNotificacoes(ctx, path, method) {
  if (path === "/notificacoes" && method === "GET") {
    exigirBarbearia(ctx);
    return json(await listarNotificacoes(ctx));
  }
  if (path === "/visao-dia" && method === "GET") {
    exigirBarbearia(ctx);
    if (!veTodasAgendas(ctx.user)) erro("Sem permissão", 403);
    return visaoDoDia(ctx);
  }
  // Bloquear / desbloquear cliente (caixa e gestão), sempre com motivo; nada é apagado.
  if ((path === "/clientes/bloquear" || path === "/clientes/desbloquear") && method === "POST") {
    exigirBarbearia(ctx);
    if (!veTodasAgendas(ctx.user)) erro("Sem permissão", 403);
    const input = await readJson(ctx.request);
    const c = await clienteDaBarbearia(ctx, input.clienteId);
    const motivo = exigirMotivo(input.motivo);
    const atual = await bloqueioDoCliente(ctx.db, ctx.barbeariaId, c.id);
    if (path === "/clientes/bloquear") {
      if (atual) erro("Esse cliente já está bloqueado.", 409);
      await ctx.db.batch([
        ctx.db.prepare(`INSERT INTO clientes_bloqueios (cliente_id, barbearia_id, ativo, motivo, bloqueado_por, bloqueado_em) VALUES (?, ?, 1, ?, ?, CURRENT_TIMESTAMP)
                        ON CONFLICT(cliente_id) DO UPDATE SET ativo = 1, motivo = excluded.motivo, bloqueado_por = excluded.bloqueado_por, bloqueado_em = CURRENT_TIMESTAMP,
                        desbloqueado_por = NULL, desbloqueado_em = NULL, motivo_desbloqueio = NULL`).bind(c.id, ctx.barbeariaId, motivo, ctx.user.id),
        auditoria(ctx, "cliente_bloqueado", c.id, { motivo, antes: { bloqueado: false }, depois: { bloqueado: true } })
      ]);
      return json({ mensagem: `${c.nome} bloqueado: não marca horário novo até ser desbloqueado.` });
    }
    if (!atual) erro("Esse cliente não está bloqueado.", 409);
    await ctx.db.batch([
      ctx.db.prepare(`UPDATE clientes_bloqueios SET ativo = 0, desbloqueado_por = ?, desbloqueado_em = CURRENT_TIMESTAMP, motivo_desbloqueio = ?
                      WHERE cliente_id = ? AND barbearia_id = ? AND ativo = 1`).bind(ctx.user.id, motivo, c.id, ctx.barbeariaId),
      auditoria(ctx, "cliente_desbloqueado", c.id, { motivo, antes: { bloqueado: true, motivo: atual.motivo }, depois: { bloqueado: false } })
    ]);
    return json({ mensagem: `${c.nome} desbloqueado.` });
  }
  return null;
}
