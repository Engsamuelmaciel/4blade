// Agenda (seção 4.1) e finalização de atendimento (seção 4.2).
// Barbeiro: só a própria agenda. Gestão (proprietário/gerente): todas. Caixa: não acessa a agenda.
// Tudo filtrado pela barbearia da sessão; ids de outra barbearia = "não encontrado".
import {
  json, fail, HttpError, readJson, validId, textoLimpo, textoOpcional, validCentavos, normalizarTelefone,
  exigirMotivo, auditoria, auditoriaSe, hojeBrasil
} from "./util.js";
import { isGestao, atende } from "./perfis.js";
import { exigirBarbearia } from "./usuarios.js";
import {
  horaParaMin, exigirData, exigirMomento, somarDias, regrasDoDia, conferirHorario, momento,
  carregarModelos, linksWhatsapp, lerPagamentos, formaEfetiva, FORMAS
} from "./agenda-util.js";

export { FORMAS };
const erro = (msg, status = 400) => { throw new HttpError(msg, status); };

function exigirAgenda(ctx) {
  exigirBarbearia(ctx);
  if (!isGestao(ctx.user) && ctx.user.perfil !== "barbeiro") erro("Sem permissão", 403);
}

// Profissional da agenda: barbeiro só ele mesmo; gestão escolhe qualquer gerente/barbeiro ativo da barbearia.
async function profissional(ctx, barbeiroId) {
  const { user, db } = ctx;
  if (!isGestao(user)) {
    if (barbeiroId && barbeiroId !== user.id) erro("Você só pode mexer na sua própria agenda.", 403);
    return { id: user.id, nome: user.nome, comissao_servico_bp: user.comissao_servico_bp };
  }
  const id = barbeiroId || user.id;
  if (!validId(id)) erro("Profissional inválido.");
  const p = await db.prepare("SELECT id, nome, perfil, ativo, comissao_servico_bp FROM usuarios WHERE id = ? AND barbearia_id = ?")
    .bind(id, ctx.barbeariaId).first();
  if (!p) erro("Profissional não encontrado.", 404);
  if (!atende(p.perfil) || !p.ativo) erro("Escolha um gerente ou barbeiro ativo.");
  return p;
}

// Busca o horário marcado dentro da barbearia e confere se o usuário pode mexer nele.
async function agendamentoPermitido(ctx, id) {
  if (!validId(id)) erro("Horário inválido.");
  const a = await ctx.db.prepare(`
    SELECT a.*, c.nome AS cliente_nome, c.telefone AS cliente_telefone, u.nome AS barbeiro_nome,
      (SELECT group_concat(nome, ' + ') FROM (SELECT nome FROM agendamento_servicos s WHERE s.agendamento_id = a.id ORDER BY s.rowid)) AS servicos_nomes
    FROM agendamentos a JOIN clientes c ON c.id = a.cliente_id JOIN usuarios u ON u.id = a.barbeiro_id
    WHERE a.id = ? AND a.barbearia_id = ?
  `).bind(id, ctx.barbeariaId).first();
  if (!a) erro("Horário não encontrado.", 404);
  if (!isGestao(ctx.user) && a.barbeiro_id !== ctx.user.id) erro("Esse horário é da agenda de outro profissional.", 403);
  return a;
}

async function caixaDeHoje(ctx) {
  return ctx.db.prepare("SELECT * FROM caixas WHERE barbearia_id = ? AND data = ?").bind(ctx.barbeariaId, hojeBrasil()).first();
}

// ---------- LISTA DA AGENDA ----------
async function listarAgenda(ctx) {
  const { db, user, request } = ctx;
  const url = new URL(request.url);
  const data = exigirData(url.searchParams.get("data") || hojeBrasil());
  const dias = url.searchParams.get("dias") === "7" ? 7 : 1;
  const ate = somarDias(data, dias - 1);
  const gestao = isGestao(user);
  // Barbeiro: sempre a própria agenda, ignorando o que vier na tela.
  const filtro = gestao ? (url.searchParams.get("barbeiroId") || null) : user.id;
  if (filtro && !validId(filtro)) erro("Profissional inválido.");

  const condA = `a.barbearia_id = ? AND a.data BETWEEN ? AND ?${filtro ? " AND a.barbeiro_id = ?" : ""}`;
  const pa = [ctx.barbeariaId, data, ate, ...(filtro ? [filtro] : [])];
  const [prof, ags, servs, fins, itens, pags, coms, msgs, estornos, blq, modelos, caixa] = await Promise.all([
    db.prepare(`SELECT id, nome, perfil FROM usuarios WHERE barbearia_id = ? AND ativo = 1 AND perfil IN ('gerente','barbeiro')
                ${gestao ? "" : "AND id = ?"} ORDER BY CASE perfil WHEN 'gerente' THEN 0 ELSE 1 END, nome`)
      .bind(ctx.barbeariaId, ...(gestao ? [] : [user.id])).all(),
    db.prepare(`SELECT a.*, c.nome AS cliente_nome, c.telefone AS cliente_telefone, u.nome AS barbeiro_nome,
                  (SELECT group_concat(nome, ' + ') FROM (SELECT nome FROM agendamento_servicos s WHERE s.agendamento_id = a.id ORDER BY s.rowid)) AS servicos_nomes
                FROM agendamentos a JOIN clientes c ON c.id = a.cliente_id JOIN usuarios u ON u.id = a.barbeiro_id
                WHERE ${condA} ORDER BY a.inicio`).bind(...pa).all(),
    db.prepare(`SELECT s.* FROM agendamento_servicos s JOIN agendamentos a ON a.id = s.agendamento_id WHERE ${condA} ORDER BY s.rowid`).bind(...pa).all(),
    db.prepare(`SELECT f.* FROM finalizacoes f JOIN agendamentos a ON a.id = f.agendamento_id WHERE ${condA} AND f.estornada = 0`).bind(...pa).all(),
    db.prepare(`SELECT i.* FROM finalizacao_itens i JOIN finalizacoes f ON f.id = i.finalizacao_id JOIN agendamentos a ON a.id = f.agendamento_id
                WHERE ${condA} AND f.estornada = 0 ORDER BY i.rowid`).bind(...pa).all(),
    db.prepare(`SELECT l.id, l.finalizacao_id, l.valor_centavos, ${formaEfetiva("l.id", "l.forma")} AS forma FROM caixa_lancamentos l JOIN finalizacoes f ON f.id = l.finalizacao_id JOIN agendamentos a ON a.id = f.agendamento_id
                WHERE ${condA} AND f.estornada = 0 AND l.tipo = 'atendimento'`).bind(...pa).all(),
    db.prepare(`SELECT m.* FROM comissoes m JOIN finalizacoes f ON f.id = m.finalizacao_id JOIN agendamentos a ON a.id = f.agendamento_id
                WHERE ${condA} AND m.estornada = 0`).bind(...pa).all(),
    db.prepare(`SELECT m.agendamento_id, m.tipo, m.criado_em, u.nome FROM mensagens_enviadas m JOIN agendamentos a ON a.id = m.agendamento_id
                JOIN usuarios u ON u.id = m.usuario_id WHERE ${condA} ORDER BY m.criado_em`).bind(...pa).all(),
    db.prepare(`SELECT f.agendamento_id, COUNT(*) AS n FROM finalizacoes f JOIN agendamentos a ON a.id = f.agendamento_id
                WHERE ${condA} AND f.estornada = 1 GROUP BY f.agendamento_id`).bind(...pa).all(),
    db.prepare(`SELECT b.*, u.nome AS barbeiro_nome FROM bloqueios b JOIN usuarios u ON u.id = b.barbeiro_id
                WHERE b.barbearia_id = ? AND b.ativo = 1 AND b.inicio < ? AND b.fim > ?${filtro ? " AND b.barbeiro_id = ?" : ""} ORDER BY b.inicio`)
      .bind(ctx.barbeariaId, `${somarDias(ate, 1)}T00:00`, `${data}T00:00`, ...(filtro ? [filtro] : [])).all(),
    carregarModelos(db, ctx.barbeariaId),
    caixaDeHoje(ctx)
  ]);

  const agrupar = (lista, chave) => lista.reduce((m, x) => ((m[x[chave]] ||= []).push(x), m), {});
  const servPor = agrupar(servs.results, "agendamento_id");
  const finPor = Object.fromEntries(fins.results.map(f => [f.agendamento_id, f]));
  const itensPor = agrupar(itens.results, "finalizacao_id");
  const pagsPor = agrupar(pags.results, "finalizacao_id");
  const comPor = Object.fromEntries(coms.results.map(c => [c.finalizacao_id, c]));
  const msgPor = agrupar(msgs.results, "agendamento_id");
  const estPor = Object.fromEntries(estornos.results.map(e => [e.agendamento_id, Number(e.n)]));

  const agendamentos = ags.results.map(a => {
    const f = finPor[a.id];
    // Comissão: só para o barbeiro dono do atendimento e para a gestão.
    const veComissao = gestao || a.barbeiro_id === user.id;
    return {
      id: a.id, barbeiroId: a.barbeiro_id, barbeiroNome: a.barbeiro_nome, data: a.data,
      inicio: a.inicio.slice(11), fim: a.fim.slice(11), situacao: a.situacao, motivo: a.motivo || null,
      observacao: a.observacao || null,
      cliente: { id: a.cliente_id, nome: a.cliente_nome, telefone: a.cliente_telefone },
      servicos: (servPor[a.id] || []).map(s => ({ id: s.servico_id, nome: s.nome, duracaoMin: s.duracao_min })),
      whatsapp: linksWhatsapp(a, modelos, user.barbearia_nome),
      mensagens: (msgPor[a.id] || []).map(m => ({ tipo: m.tipo, em: m.criado_em, por: m.nome })),
      reaberturas: estPor[a.id] || 0,
      finalizacao: f ? {
        id: f.id,
        totalCentavos: f.total_centavos,
        valorAlterado: Boolean(f.valor_alterado),
        totalAnteriorCentavos: f.total_anterior_centavos,
        em: f.criado_em,
        itens: (itensPor[f.id] || []).map(i => ({ nome: i.nome, tabelaCentavos: i.preco_tabela_centavos, cobradoCentavos: i.preco_cobrado_centavos })),
        pagamentos: (pagsPor[f.id] || []).map(p => ({ forma: p.forma, valorCentavos: p.valor_centavos })),
        ...(veComissao && comPor[f.id] ? { comissaoCentavos: comPor[f.id].valor_centavos, comissaoBp: comPor[f.id].percentual_bp } : {})
      } : null
    };
  });

  return json({
    data, ate, dias, hoje: hojeBrasil(),
    caixaAberto: caixa?.situacao === "aberto",
    profissionais: prof.results.map(p => ({ id: p.id, nome: p.nome, perfil: p.perfil })),
    agendamentos,
    bloqueios: blq.results.map(b => ({ id: b.id, barbeiroId: b.barbeiro_id, barbeiroNome: b.barbeiro_nome, inicio: b.inicio, fim: b.fim, motivo: b.motivo || null }))
  });
}

// ---------- MARCAR ----------
async function marcar(ctx) {
  const { db, user, request } = ctx;
  const input = await readJson(request);
  const prof = await profissional(ctx, input.barbeiroId);
  const data = exigirData(input.data);
  if (data < somarDias(hojeBrasil(), -1) || data > somarDias(hojeBrasil(), 366)) erro("Escolha uma data entre ontem e daqui a um ano.");
  const ini = horaParaMin(input.hora);
  if (ini === null) erro("Hora inválida (HH:MM).");
  if (!Array.isArray(input.servicoIds) || input.servicoIds.length < 1 || input.servicoIds.length > 6) erro("Escolha de 1 a 6 serviços.");
  if (new Set(input.servicoIds).size !== input.servicoIds.length || !input.servicoIds.every(validId)) erro("Serviços inválidos.");
  const observacao = textoOpcional(input.observacao, 300);
  if (observacao === false) erro("Observação muito longa (até 300 letras).");

  const servs = await db.prepare(`SELECT id, nome, duracao_min FROM servicos WHERE barbearia_id = ? AND ativo = 1
                                  AND id IN (${input.servicoIds.map(() => "?").join(",")})`).bind(ctx.barbeariaId, ...input.servicoIds).all();
  if (servs.results.length !== input.servicoIds.length) erro("Serviço não encontrado ou desativado.", 404);
  const ordem = Object.fromEntries(input.servicoIds.map((id, i) => [id, i]));
  servs.results.sort((a, b) => ordem[a.id] - ordem[b.id]);
  const fim = ini + servs.results.reduce((s, x) => s + x.duracao_min, 0);
  if (fim > 24 * 60) erro("O horário passa da meia-noite.");
  conferirHorario(await regrasDoDia(db, ctx.barbeariaId, prof.id, data), ini, fim);

  // Cliente sempre identificado pelo telefone: existe → usa; não existe → nasce aqui (com aceite LGPD).
  const c = input.cliente || {};
  const telefone = normalizarTelefone(c.telefone);
  if (!telefone) erro("Telefone do cliente inválido: DDD + número.");
  const comandos = [];
  let cliente = await db.prepare("SELECT id, nome, ativo FROM clientes WHERE barbearia_id = ? AND telefone = ?").bind(ctx.barbeariaId, telefone).first();
  if (cliente && !cliente.ativo) erro("Esse cliente está desativado. Peça ao gerente para reativar.", 409);
  if (!cliente) {
    const nome = textoLimpo(c.nome, 2, 80);
    if (!nome) erro("Cliente novo: informe o nome.");
    if (c.aceiteLgpd !== true) erro("Cliente novo: é preciso o aceite do uso do telefone para o atendimento (LGPD).");
    cliente = { id: crypto.randomUUID(), nome, novo: true };
    comandos.push(
      db.prepare(`INSERT INTO clientes (id, barbearia_id, nome, telefone, aceite_lgpd, aceite_lgpd_em, aceite_lgpd_por) VALUES (?, ?, ?, ?, 1, ?, ?)`)
        .bind(cliente.id, ctx.barbeariaId, nome, telefone, new Date().toISOString(), user.id),
      auditoria(ctx, "cliente_criado", cliente.id, { origem: "agenda", depois: { nome, telefone, aceite_lgpd: 1 } })
    );
  }

  const id = crypto.randomUUID();
  const inicio = momento(data, ini);
  const termino = momento(data, fim);
  const conflito = `
    NOT EXISTS (SELECT 1 FROM agendamentos WHERE barbearia_id = ? AND barbeiro_id = ? AND situacao IN ('agendado','finalizado') AND inicio < ? AND fim > ?)
    AND NOT EXISTS (SELECT 1 FROM bloqueios WHERE barbearia_id = ? AND barbeiro_id = ? AND ativo = 1 AND inicio < ? AND fim > ?)`;
  const pConflito = [ctx.barbeariaId, prof.id, termino, inicio, ctx.barbeariaId, prof.id, termino, inicio];
  // Conferência de sobreposição e gravação no MESMO comando (dois toques ao mesmo tempo não marcam o mesmo horário).
  comandos.push(
    db.prepare(`INSERT INTO agendamentos (id, barbearia_id, barbeiro_id, cliente_id, data, inicio, fim, observacao, criado_por)
                SELECT ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE ${conflito}`)
      .bind(id, ctx.barbeariaId, prof.id, cliente.id, data, inicio, termino, observacao, user.id, ...pConflito),
    ...servs.results.map(s => db.prepare(`INSERT INTO agendamento_servicos (id, barbearia_id, agendamento_id, servico_id, nome, duracao_min)
                SELECT ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM agendamentos WHERE id = ?)`)
      .bind(crypto.randomUUID(), ctx.barbeariaId, id, s.id, s.nome, s.duracao_min, id)),
    auditoriaSe(ctx, "EXISTS (SELECT 1 FROM agendamentos WHERE id = ?)", [id], "agendamento_criado", id, {
      depois: { barbeiro: prof.id, cliente: cliente.id, inicio, fim: termino, servicos: servs.results.map(s => s.nome) }
    })
  );
  await db.batch(comandos);
  const criado = await db.prepare("SELECT id FROM agendamentos WHERE id = ?").bind(id).first();
  if (!criado) {
    const b = await db.prepare("SELECT 1 FROM bloqueios WHERE barbearia_id = ? AND barbeiro_id = ? AND ativo = 1 AND inicio < ? AND fim > ?")
      .bind(ctx.barbeariaId, prof.id, termino, inicio).first();
    erro(b ? "Esse horário está bloqueado na agenda do profissional." : "Já existe outro atendimento nesse horário para esse profissional.", 409);
  }
  return json({ agendamento: { id, inicio, fim: termino, barbeiroId: prof.id, cliente: { id: cliente.id, nome: cliente.nome, novo: Boolean(cliente.novo) } } }, 201);
}

// ---------- FINALIZAR ----------
async function finalizar(ctx) {
  const { db, user, request } = ctx;
  const input = await readJson(request);
  const a = await agendamentoPermitido(ctx, input.id);
  if (a.situacao !== "agendado") erro(`Esse horário está "${a.situacao}"; só dá para finalizar um horário agendado.`, 409);
  const hoje = hojeBrasil();
  if (a.data > hoje) erro("Não dá para finalizar um horário de um dia que ainda não chegou.", 409);
  const caixa = await caixaDeHoje(ctx);
  if (!caixa || caixa.situacao !== "aberto") erro("O caixa de hoje não está aberto. Peça para abrir o caixa.", 409);

  // Serviços e valores (o valor de tabela vem do cadastro; o cobrado pode ser alterado e fica registrado).
  const itensIn = input.itens;
  if (!Array.isArray(itensIn) || itensIn.length < 1 || itensIn.length > 6) erro("Informe de 1 a 6 serviços.");
  const ids = itensIn.map(i => i?.servicoId);
  if (!ids.every(validId) || new Set(ids).size !== ids.length) erro("Serviços inválidos.");
  const tab = await db.prepare(`SELECT id, nome, preco_centavos, ativo FROM servicos WHERE barbearia_id = ? AND id IN (${ids.map(() => "?").join(",")})`)
    .bind(ctx.barbeariaId, ...ids).all();
  const porId = Object.fromEntries(tab.results.map(s => [s.id, s]));
  const doHorario = new Set((await db.prepare("SELECT servico_id FROM agendamento_servicos WHERE agendamento_id = ?").bind(a.id).all()).results.map(x => x.servico_id));
  const itens = itensIn.map(i => {
    const s = porId[i.servicoId];
    if (!s || (!s.ativo && !doHorario.has(s.id))) erro("Serviço não encontrado ou desativado.", 404);
    if (!validCentavos(i.precoCobradoCentavos)) erro(`Valor cobrado de "${s.nome}" inválido.`);
    return { servicoId: s.id, nome: s.nome, tabela: s.preco_centavos, cobrado: i.precoCobradoCentavos };
  });
  const total = itens.reduce((t, i) => t + i.cobrado, 0);

  // Até 2 formas de pagamento; a soma tem de bater com o total.
  const pagIn = lerPagamentos(input.pagamentos, total);

  const anterior = await db.prepare("SELECT total_centavos FROM finalizacoes WHERE agendamento_id = ? AND estornada = 1 ORDER BY criado_em DESC, rowid DESC LIMIT 1")
    .bind(a.id).first();
  const totalAnterior = anterior ? anterior.total_centavos : null;
  const valorAlterado = itens.some(i => i.cobrado !== i.tabela) || (totalAnterior !== null && totalAnterior !== total);

  const barbeiro = await db.prepare("SELECT comissao_servico_bp FROM usuarios WHERE id = ? AND barbearia_id = ?").bind(a.barbeiro_id, ctx.barbeariaId).first();
  const bp = Number(barbeiro?.comissao_servico_bp || 0);
  const comissao = Math.round((total * bp) / 10000);

  const fid = crypto.randomUUID();
  const existeFin = ["EXISTS (SELECT 1 FROM finalizacoes WHERE id = ?)", [fid]];
  await db.batch([
    db.prepare(`UPDATE agendamentos SET situacao = 'finalizado', motivo = NULL, atualizado_em = CURRENT_TIMESTAMP
                WHERE id = ? AND barbearia_id = ? AND situacao = 'agendado'
                  AND EXISTS (SELECT 1 FROM caixas WHERE id = ? AND situacao = 'aberto')`).bind(a.id, ctx.barbeariaId, caixa.id),
    db.prepare(`INSERT INTO finalizacoes (id, barbearia_id, agendamento_id, barbeiro_id, caixa_id, total_centavos, valor_alterado, total_anterior_centavos, criado_por)
                SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?
                WHERE EXISTS (SELECT 1 FROM agendamentos WHERE id = ? AND situacao = 'finalizado')
                  AND NOT EXISTS (SELECT 1 FROM finalizacoes WHERE agendamento_id = ? AND estornada = 0)`)
      .bind(fid, ctx.barbeariaId, a.id, a.barbeiro_id, caixa.id, total, valorAlterado ? 1 : 0, totalAnterior, user.id, a.id, a.id),
    ...itens.map(i => db.prepare(`INSERT INTO finalizacao_itens (id, barbearia_id, finalizacao_id, servico_id, nome, preco_tabela_centavos, preco_cobrado_centavos)
                SELECT ?, ?, ?, ?, ?, ?, ? WHERE ${existeFin[0]}`)
      .bind(crypto.randomUUID(), ctx.barbeariaId, fid, i.servicoId, i.nome, i.tabela, i.cobrado, ...existeFin[1])),
    ...pagIn.map(p => db.prepare(`INSERT INTO caixa_lancamentos (id, barbearia_id, caixa_id, tipo, finalizacao_id, forma, valor_centavos, criado_por)
                SELECT ?, ?, ?, 'atendimento', ?, ?, ?, ? WHERE ${existeFin[0]}`)
      .bind(crypto.randomUUID(), ctx.barbeariaId, caixa.id, fid, p.forma, p.valorCentavos, user.id, ...existeFin[1])),
    db.prepare(`INSERT INTO comissoes (id, barbearia_id, barbeiro_id, finalizacao_id, tipo, base_centavos, percentual_bp, valor_centavos)
                SELECT ?, ?, ?, ?, 'servico', ?, ?, ? WHERE ${existeFin[0]}`)
      .bind(crypto.randomUUID(), ctx.barbeariaId, a.barbeiro_id, fid, total, bp, comissao, ...existeFin[1]),
    auditoriaSe(ctx, ...existeFin, "atendimento_finalizado", a.id, {
      finalizacao: fid, total, totalAnterior, valorAlterado,
      itens: itens.map(i => ({ nome: i.nome, tabela: i.tabela, cobrado: i.cobrado })),
      pagamentos: pagIn.map(p => ({ forma: p.forma, valor: p.valorCentavos }))
    })
  ]);
  if (!(await db.prepare("SELECT 1 FROM finalizacoes WHERE id = ?").bind(fid).first())) {
    erro("Não foi possível finalizar: o horário mudou ou o caixa foi fechado. Atualize a tela.", 409);
  }
  return json({ finalizacao: { id: fid, totalCentavos: total, valorAlterado, comissaoCentavos: comissao } }, 201);
}

// ---------- REABRIR (finalizado por engano) ----------
async function reabrir(ctx) {
  const { db, user, request } = ctx;
  const input = await readJson(request);
  const a = await agendamentoPermitido(ctx, input.id);
  if (a.situacao !== "finalizado") erro("Só dá para reabrir um atendimento finalizado.", 409);
  const motivo = exigirMotivo(input.motivo);
  const f = await db.prepare("SELECT f.*, c.situacao AS caixa_situacao FROM finalizacoes f JOIN caixas c ON c.id = f.caixa_id WHERE f.agendamento_id = ? AND f.estornada = 0")
    .bind(a.id).first();
  if (!f) erro("Finalização não encontrada.", 404);
  if (await db.prepare(`SELECT 1 FROM comissoes c JOIN fechamento_comissao_itens i ON i.tipo = 'servico' AND i.ref_id = c.id
                        WHERE c.finalizacao_id = ?`).bind(f.id).first()) {
    erro("A comissão desse atendimento já entrou num fechamento de comissão: não dá para reabrir.", 409);
  }
  if (f.caixa_situacao !== "aberto") {
    erro(isGestao(user)
      ? "O caixa desse dia já foi fechado: reabra o caixa (com motivo) antes de reabrir o atendimento."
      : "O caixa desse dia já foi fechado: só o gerente pode reabrir.", 409);
  }
  const estornoId = crypto.randomUUID();
  const feito = ["EXISTS (SELECT 1 FROM finalizacoes WHERE id = ? AND estorno_id = ?)", [f.id, estornoId]];
  await db.batch([
    db.prepare(`UPDATE finalizacoes SET estornada = 1, estorno_id = ?, estornada_por = ?, estornada_em = CURRENT_TIMESTAMP, motivo_estorno = ?
                WHERE id = ? AND barbearia_id = ? AND estornada = 0 AND EXISTS (SELECT 1 FROM caixas WHERE id = ? AND situacao = 'aberto')`)
      .bind(estornoId, user.id, motivo, f.id, ctx.barbeariaId, f.caixa_id),
    // Estorno da entrada: lançamentos negativos no mesmo caixa (nada é apagado).
    db.prepare(`INSERT INTO caixa_lancamentos (id, barbearia_id, caixa_id, tipo, finalizacao_id, forma, valor_centavos, criado_por)
                SELECT 'est-' || lower(hex(randomblob(16))), barbearia_id, caixa_id, 'estorno_atendimento', finalizacao_id,
                  ${formaEfetiva("caixa_lancamentos.id", "caixa_lancamentos.forma")}, -valor_centavos, ?
                FROM caixa_lancamentos WHERE finalizacao_id = ? AND tipo = 'atendimento' AND ${feito[0]}`).bind(user.id, f.id, ...feito[1]),
    db.prepare(`UPDATE comissoes SET estornada = 1 WHERE finalizacao_id = ? AND ${feito[0]}`).bind(f.id, ...feito[1]),
    db.prepare(`UPDATE agendamentos SET situacao = 'agendado', atualizado_em = CURRENT_TIMESTAMP WHERE id = ? AND ${feito[0]}`).bind(a.id, ...feito[1]),
    auditoriaSe(ctx, ...feito, "atendimento_reaberto", a.id, { motivo, finalizacao: f.id, totalEstornado: f.total_centavos })
  ]);
  if (!(await db.prepare(`SELECT 1 FROM finalizacoes WHERE id = ? AND estorno_id = ?`).bind(f.id, estornoId).first())) {
    erro("Não foi possível reabrir: o caixa foi fechado ou o atendimento já foi reaberto.", 409);
  }
  return json({ mensagem: "Atendimento reaberto: entrada e comissão estornadas. O horário voltou para agendado." });
}

// ---------- FALTOU / CANCELADO ----------
async function mudarSituacao(ctx) {
  const { db, request } = ctx;
  const input = await readJson(request);
  const a = await agendamentoPermitido(ctx, input.id);
  if (!["faltou", "cancelado"].includes(input.situacao)) erro("Situação inválida (faltou ou cancelado).");
  if (a.situacao !== "agendado") erro("Só um horário agendado pode virar falta ou cancelamento.", 409);
  const motivo = input.situacao === "cancelado" ? exigirMotivo(input.motivo) : (textoLimpo(input.motivo, 3, 300) || null);
  await db.batch([
    db.prepare("UPDATE agendamentos SET situacao = ?, motivo = ?, atualizado_em = CURRENT_TIMESTAMP WHERE id = ? AND barbearia_id = ? AND situacao = 'agendado'")
      .bind(input.situacao, motivo, a.id, ctx.barbeariaId),
    auditoria(ctx, input.situacao === "cancelado" ? "agendamento_cancelado" : "agendamento_falta", a.id, { motivo, antes: { situacao: "agendado" }, depois: { situacao: input.situacao } })
  ]);
  return json({ mensagem: input.situacao === "cancelado" ? "Horário cancelado." : "Falta registrada." });
}

// ---------- MENSAGEM (registro do envio pelo WhatsApp) ----------
async function registrarMensagem(ctx) {
  const { db, user, request } = ctx;
  const input = await readJson(request);
  const a = await agendamentoPermitido(ctx, input.id);
  if (!["lembrete", "proposta"].includes(input.tipo)) erro("Tipo de mensagem inválido.");
  const modelos = await carregarModelos(db, ctx.barbeariaId);
  const url = linksWhatsapp(a, { [input.tipo]: modelos[input.tipo] }, user.barbearia_nome)[input.tipo];
  const id = crypto.randomUUID();
  await db.batch([
    db.prepare("INSERT INTO mensagens_enviadas (id, barbearia_id, agendamento_id, tipo, usuario_id) VALUES (?, ?, ?, ?, ?)")
      .bind(id, ctx.barbeariaId, a.id, input.tipo, user.id),
    auditoria(ctx, "mensagem_whatsapp", a.id, { tipo: input.tipo })
  ]);
  return json({ url }, 201);
}

// ---------- BLOQUEIOS ----------
async function bloquear(ctx) {
  const { db, user, request } = ctx;
  const input = await readJson(request);
  const prof = await profissional(ctx, input.barbeiroId);
  const inicio = exigirMomento(input.inicio, "Início");
  const fim = exigirMomento(input.fim, "Fim");
  if (fim <= inicio) erro("O fim precisa ser depois do início.");
  if (fim.slice(0, 10) > somarDias(inicio.slice(0, 10), 60)) erro("Bloqueio de no máximo 60 dias.");
  const motivo = textoOpcional(input.motivo, 120);
  if (motivo === false) erro("Motivo muito longo (até 120 letras).");
  const marcados = await db.prepare(`SELECT COUNT(*) AS n FROM agendamentos WHERE barbearia_id = ? AND barbeiro_id = ? AND situacao = 'agendado' AND inicio < ? AND fim > ?`)
    .bind(ctx.barbeariaId, prof.id, fim, inicio).first();
  if (Number(marcados.n) > 0) erro(`Há ${marcados.n} atendimento(s) marcado(s) nesse período. Remarque ou cancele antes de bloquear.`, 409);
  const id = crypto.randomUUID();
  await db.batch([
    db.prepare("INSERT INTO bloqueios (id, barbearia_id, barbeiro_id, inicio, fim, motivo, criado_por) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .bind(id, ctx.barbeariaId, prof.id, inicio, fim, motivo, user.id),
    auditoria(ctx, "bloqueio_criado", id, { depois: { barbeiro: prof.id, inicio, fim, motivo } })
  ]);
  return json({ bloqueio: { id, barbeiroId: prof.id, inicio, fim, motivo } }, 201);
}

async function cancelarBloqueio(ctx) {
  const { db, user, request } = ctx;
  const input = await readJson(request);
  if (!validId(input.id)) erro("Bloqueio inválido.");
  const b = await db.prepare("SELECT * FROM bloqueios WHERE id = ? AND barbearia_id = ? AND ativo = 1").bind(input.id, ctx.barbeariaId).first();
  if (!b) erro("Bloqueio não encontrado.", 404);
  if (!isGestao(user) && b.barbeiro_id !== user.id) erro("Esse bloqueio é da agenda de outro profissional.", 403);
  const motivo = exigirMotivo(input.motivo);
  await db.batch([
    db.prepare("UPDATE bloqueios SET ativo = 0, motivo_cancelamento = ? WHERE id = ? AND barbearia_id = ?").bind(motivo, b.id, ctx.barbeariaId),
    auditoria(ctx, "bloqueio_cancelado", b.id, { motivo, antes: { ativo: 1 }, depois: { ativo: 0 } })
  ]);
  return json({ mensagem: "Bloqueio cancelado." });
}

// ---------- CLIENTE PELO TELEFONE (na hora de marcar) ----------
async function clientePorTelefone(ctx) {
  const url = new URL(ctx.request.url);
  const telefone = normalizarTelefone(url.searchParams.get("telefone") || "");
  if (!telefone) erro("Telefone inválido: DDD + número.");
  const c = await ctx.db.prepare("SELECT id, nome, telefone, ativo FROM clientes WHERE barbearia_id = ? AND telefone = ?").bind(ctx.barbeariaId, telefone).first();
  return json({ telefone, cliente: c ? { id: c.id, nome: c.nome, telefone: c.telefone, ativo: Boolean(c.ativo) } : null });
}

export async function rotasAgenda(ctx, path, method) {
  if (path !== "/agenda" && !path.startsWith("/agenda/")) return null;
  exigirAgenda(ctx);
  if (path === "/agenda" && method === "GET") return listarAgenda(ctx);
  if (path === "/agenda" && method === "POST") return marcar(ctx);
  if (path === "/agenda/cliente" && method === "GET") return clientePorTelefone(ctx);
  if (path === "/agenda/finalizar" && method === "POST") return finalizar(ctx);
  if (path === "/agenda/reabrir" && method === "POST") return reabrir(ctx);
  if (path === "/agenda/situacao" && method === "POST") return mudarSituacao(ctx);
  if (path === "/agenda/mensagem" && method === "POST") return registrarMensagem(ctx);
  if (path === "/agenda/bloqueios" && method === "POST") return bloquear(ctx);
  if (path === "/agenda/bloqueios/cancelar" && method === "POST") return cancelarBloqueio(ctx);
  return fail("Rota não encontrada", 404);
}

