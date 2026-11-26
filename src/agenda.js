// Agenda (seção 4.1) e finalização de atendimento (seção 4.2).
// Barbeiro: só a própria agenda. Gestão (proprietário/gerente): todas. Caixa: não acessa a agenda.
// Tudo filtrado pela barbearia da sessão; ids de outra barbearia = "não encontrado".
import {
  json, fail, HttpError, readJson, validId, textoLimpo, textoOpcional, validCentavos, normalizarTelefone,
  exigirMotivo, auditoria, auditoriaSe, hojeBrasil
} from "./util.js";
import { isGestao, atende, veTodasAgendas } from "./perfis.js";
import { exigirBarbearia } from "./usuarios.js";
import { conferirClienteParaMarcar, sinaisClientes } from "./notificacoes.js";
import { montarVenda } from "./estoque.js";
import { caixaParaLancar, sqlCaixaOk } from "./caixa.js";
import {
  horaParaMin, exigirData, exigirMomento, somarDias, regrasDoDia, conferirHorario, momento, carregarRegras, diaSemana, janelaDoDia, livreNaJanela,
  carregarModelos, linksWhatsapp, lerPagamentos, formaEfetiva, FORMAS,
  telefoneReal, PREFIXO_SEM_TELEFONE, minParaHora, NOME_DIA, mesFechado, MSG_MES_FECHADO
} from "./agenda-util.js";

export { FORMAS };
const erro = (msg, status = 400) => { throw new HttpError(msg, status); };

function exigirAgenda(ctx) {
  exigirBarbearia(ctx);
  if (!veTodasAgendas(ctx.user) && ctx.user.perfil !== "barbeiro") erro("Sem permissão", 403);
}

// Profissional da agenda: barbeiro só ele mesmo; gestão escolhe qualquer gerente/barbeiro ativo da barbearia.
async function profissional(ctx, barbeiroId) {
  const { user, db } = ctx;
  if (!veTodasAgendas(user)) {
    if (barbeiroId && barbeiroId !== user.id) erro("Você só pode mexer na sua própria agenda.", 403);
    return { id: user.id, nome: user.nome, comissao_servico_bp: user.comissao_servico_bp };
  }
  const id = barbeiroId || (atende(user.perfil) ? user.id : null);
  if (!id) erro("Escolha o profissional.");
  if (!validId(id)) erro("Profissional inválido.");
  const p = await db.prepare("SELECT id, nome, perfil, ativo, comissao_servico_bp FROM usuarios WHERE id = ? AND barbearia_id = ?")
    .bind(id, ctx.barbeariaId).first();
  if (!p) erro("Profissional não encontrado.", 404);
  if (!atende(p.perfil) || !p.ativo) erro("Escolha um gerente ou barbeiro ativo.");
  return p;
}

// Busca o horário marcado dentro da barbearia e confere se o usuário pode mexer nele.
async function agendamentoPermitido(ctx, id, { cobrar = false } = {}) {
  if (!validId(id)) erro("Horário inválido.");
  const a = await ctx.db.prepare(`
    SELECT a.*, c.nome AS cliente_nome, c.telefone AS cliente_telefone, u.nome AS barbeiro_nome,
      (SELECT group_concat(nome, ' + ') FROM (SELECT nome FROM agendamento_servicos s WHERE s.agendamento_id = a.id AND NOT EXISTS (SELECT 1 FROM agendamento_servicos_removidos rm WHERE rm.linha_id = s.id) ORDER BY s.rowid)) AS servicos_nomes
    FROM agendamentos a JOIN clientes c ON c.id = a.cliente_id JOIN usuarios u ON u.id = a.barbeiro_id
    WHERE a.id = ? AND a.barbearia_id = ?
  `).bind(id, ctx.barbeariaId).first();
  if (!a) erro("Horário não encontrado.", 404);
  // Caixa (recepção): mexe em qualquer agenda (marcar, remarcar, faltou, cancelar, WhatsApp); cobra de hoje ou de dias anteriores (entra no caixa de hoje).
  if (ctx.user.perfil === "caixa") {
    if (cobrar && a.data > hojeBrasil()) erro("Não dá para cobrar um atendimento de um dia que ainda não chegou.", 403);
    return a;
  }
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
  const dias = Math.min(42, Math.max(1, parseInt(url.searchParams.get("dias") || "1", 10) || 1));   // dia, semana ou mês (até 6 semanas)
  const ate = somarDias(data, dias - 1);
  const gestao = isGestao(user);
  const todas = veTodasAgendas(user);
  // Barbeiro: sempre a própria agenda, ignorando o que vier na tela.
  const filtro = todas ? (url.searchParams.get("barbeiroId") || null) : user.id;
  if (filtro && !validId(filtro)) erro("Profissional inválido.");

  // Horários excluídos (agendamentos_excluidos) não aparecem na agenda; continuam no banco.
  const condA = `a.barbearia_id = ? AND a.data BETWEEN ? AND ?${filtro ? " AND a.barbeiro_id = ?" : ""} AND NOT EXISTS (SELECT 1 FROM agendamentos_excluidos x WHERE x.agendamento_id = a.id)`;
  const pa = [ctx.barbeariaId, data, ate, ...(filtro ? [filtro] : [])];
  const [prof, ags, servs, fins, itens, pags, coms, msgs, estornos, blq, modelos, caixa] = await Promise.all([
    db.prepare(`SELECT id, nome, perfil FROM usuarios WHERE barbearia_id = ? AND ativo = 1 AND perfil IN ('proprietario','gerente','barbeiro')
                ${todas ? "" : "AND id = ?"} ORDER BY CASE perfil WHEN 'gerente' THEN 0 ELSE 1 END, nome`)
      .bind(ctx.barbeariaId, ...(todas ? [] : [user.id])).all(),
    db.prepare(`SELECT a.*, c.nome AS cliente_nome, c.telefone AS cliente_telefone, u.nome AS barbeiro_nome,
                  (SELECT group_concat(nome, ' + ') FROM (SELECT nome FROM agendamento_servicos s WHERE s.agendamento_id = a.id AND NOT EXISTS (SELECT 1 FROM agendamento_servicos_removidos rm WHERE rm.linha_id = s.id) ORDER BY s.rowid)) AS servicos_nomes,
                  si.serie_id, se.intervalo_semanas, se.data_fim AS serie_ate
                FROM agendamentos a JOIN clientes c ON c.id = a.cliente_id JOIN usuarios u ON u.id = a.barbeiro_id
                LEFT JOIN agendamento_serie_itens si ON si.agendamento_id = a.id LEFT JOIN agendamento_series se ON se.id = si.serie_id
                WHERE ${condA} ORDER BY a.inicio`).bind(...pa).all(),
    db.prepare(`SELECT s.* FROM agendamento_servicos s JOIN agendamentos a ON a.id = s.agendamento_id WHERE ${condA} AND NOT EXISTS (SELECT 1 FROM agendamento_servicos_removidos rm WHERE rm.linha_id = s.id) ORDER BY s.rowid`).bind(...pa).all(),
    db.prepare(`SELECT f.* FROM finalizacoes f JOIN agendamentos a ON a.id = f.agendamento_id WHERE ${condA} AND f.estornada = 0`).bind(...pa).all(),
    db.prepare(`SELECT i.* FROM finalizacao_itens i JOIN finalizacoes f ON f.id = i.finalizacao_id JOIN agendamentos a ON a.id = f.agendamento_id
                WHERE ${condA} AND f.estornada = 0 ORDER BY i.rowid`).bind(...pa).all(),
    db.prepare(`SELECT l.id, l.finalizacao_id, l.valor_centavos, ${formaEfetiva("l.id", "l.forma")} AS forma FROM caixa_lancamentos l JOIN finalizacoes f ON f.id = l.finalizacao_id JOIN agendamentos a ON a.id = f.agendamento_id
                WHERE ${condA} AND f.estornada = 0 AND l.tipo = 'atendimento'`).bind(...pa).all(),
    db.prepare(`SELECT m.* FROM comissoes m JOIN finalizacoes f ON f.id = m.finalizacao_id JOIN agendamentos a ON a.id = f.agendamento_id
                WHERE ${condA} AND m.estornada = 0`).bind(...pa).all(),
    db.prepare(`SELECT * FROM (
                  SELECT m.agendamento_id, m.tipo, m.criado_em, u.nome FROM mensagens_enviadas m JOIN agendamentos a ON a.id = m.agendamento_id
                  JOIN usuarios u ON u.id = m.usuario_id WHERE ${condA}
                  UNION ALL
                  SELECT m.agendamento_id, m.tipo, m.criado_em, u.nome FROM mensagens_enviadas_adicionais m JOIN agendamentos a ON a.id = m.agendamento_id
                  JOIN usuarios u ON u.id = m.usuario_id WHERE ${condA}) ORDER BY criado_em`).bind(...pa, ...pa).all(),
    db.prepare(`SELECT f.agendamento_id, COUNT(*) AS n FROM finalizacoes f JOIN agendamentos a ON a.id = f.agendamento_id
                WHERE ${condA} AND f.estornada = 1 GROUP BY f.agendamento_id`).bind(...pa).all(),
    db.prepare(`SELECT b.*, u.nome AS barbeiro_nome FROM bloqueios b JOIN usuarios u ON u.id = b.barbeiro_id
                WHERE b.barbearia_id = ? AND b.ativo = 1 AND b.inicio < ? AND b.fim > ?${filtro ? " AND b.barbeiro_id = ?" : ""} ORDER BY b.inicio`)
      .bind(ctx.barbeariaId, `${somarDias(ate, 1)}T00:00`, `${data}T00:00`, ...(filtro ? [filtro] : [])).all(),
    carregarModelos(db, ctx.barbeariaId),
    caixaDeHoje(ctx)
  ]);
  const sinais = await sinaisClientes(db, ctx.barbeariaId);

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
      serie: a.serie_id ? { id: a.serie_id, intervaloSemanas: a.intervalo_semanas, ate: a.serie_ate } : null,
      cliente: { id: a.cliente_id, nome: a.cliente_nome, telefone: telefoneReal(a.cliente_telefone), ...(sinais.get(a.cliente_id) || {}) },
      servicos: (servPor[a.id] || []).map(s => ({ id: s.servico_id, nome: s.nome, duracaoMin: s.duracao_min })),
      whatsapp: linksWhatsapp(a, modelos, user.barbearia_nome, { semNumero: true }),
      whatsappComNumero: Boolean(telefoneReal(a.cliente_telefone)),
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
// Cliente identificado pelo telefone (existe → usa; não existe → nasce aqui com aceite LGPD) ou, sem telefone, pelo nome.
// Põe em "comandos" o cadastro do cliente novo (para ir no mesmo lote) e devolve { id, nome, novo }.
export const CLIENTE_NAO_IDENTIFICADO = "Cliente não identificado";

async function clienteDaMarcacao(ctx, c = {}, comandos, origem = "agenda") {
  const { db, user } = ctx;
  // Cliente escolhido da base (cadastro): sempre conferido dentro da barbearia da sessão.
  if (c && c.id !== undefined) {
    if (!validId(c.id)) erro("Cliente inválido.");
    const cad = await db.prepare("SELECT id, nome, ativo FROM clientes WHERE id = ? AND barbearia_id = ?").bind(c.id, ctx.barbeariaId).first();
    if (!cad) erro("Cliente não encontrado.", 404);
    if (!cad.ativo) erro("Esse cliente está desativado. Peça ao gerente para reativar.", 409);
    return { id: cad.id, nome: cad.nome, novo: false };
  }
  const semTelefone = typeof c.telefone !== "string" || !c.telefone.replace(/\D/g, "");
  if (semTelefone) {
    // Telefone é opcional: sem ele o cliente é identificado pelo nome (mesmo nome sem telefone = mesmo cliente).
    // No caixa (atendimento sem horário) dá para cobrar sem identificar o cliente.
    const nome = textoLimpo(c.nome, 2, 80) || (origem === "caixa" ? CLIENTE_NAO_IDENTIFICADO : null);
    if (!nome) erro("Informe o telefone ou o nome do cliente.");
    const existente = await db.prepare(`SELECT id, nome, ativo FROM clientes WHERE barbearia_id = ? AND lower(nome) = lower(?)
                                        AND telefone LIKE '${PREFIXO_SEM_TELEFONE}%' AND id NOT IN (SELECT cliente_id FROM clientes_excluidos WHERE barbearia_id = ?)
                                        ORDER BY ativo DESC LIMIT 1`).bind(ctx.barbeariaId, nome, ctx.barbeariaId).first();
    if (existente && !existente.ativo) erro("Esse cliente está desativado. Peça ao gerente para reativar.", 409);
    if (existente) return { id: existente.id, nome: existente.nome, novo: false };
    const id = crypto.randomUUID();
    comandos.push(
      db.prepare(`INSERT INTO clientes (id, barbearia_id, nome, telefone, aceite_lgpd) VALUES (?, ?, ?, ?, 0)`)
        .bind(id, ctx.barbeariaId, nome, PREFIXO_SEM_TELEFONE + id),
      auditoria(ctx, "cliente_criado", id, { origem, depois: { nome, telefone: null } })
    );
    return { id, nome, novo: true };
  }
  const telefone = normalizarTelefone(c.telefone);
  if (!telefone) erro("Telefone do cliente inválido: DDD + número (ou deixe em branco).");
  const cliente = await db.prepare("SELECT id, nome, ativo FROM clientes WHERE barbearia_id = ? AND telefone = ?").bind(ctx.barbeariaId, telefone).first();
  if (cliente && !cliente.ativo) erro("Esse cliente está desativado. Peça ao gerente para reativar.", 409);
  if (cliente) return { id: cliente.id, nome: cliente.nome, novo: false };
  const nome = textoLimpo(c.nome, 2, 80);
  if (!nome) erro("Cliente novo: informe o nome.");
  if (c.aceiteLgpd !== true) erro("Cliente novo: é preciso o aceite do uso do telefone para o atendimento (LGPD).");
  const id = crypto.randomUUID();
  comandos.push(
    db.prepare(`INSERT INTO clientes (id, barbearia_id, nome, telefone, aceite_lgpd, aceite_lgpd_em, aceite_lgpd_por) VALUES (?, ?, ?, ?, 1, ?, ?)`)
      .bind(id, ctx.barbeariaId, nome, telefone, new Date().toISOString(), user.id),
    auditoria(ctx, "cliente_criado", id, { origem, depois: { nome, telefone, aceite_lgpd: 1 } })
  );
  return { id, nome, novo: true };
}

async function servicosEscolhidos(ctx, servicoIds) {
  if (!Array.isArray(servicoIds) || servicoIds.length < 1 || servicoIds.length > 6) erro("Escolha de 1 a 6 serviços.");
  if (new Set(servicoIds).size !== servicoIds.length || !servicoIds.every(validId)) erro("Serviços inválidos.");
  const r = await ctx.db.prepare(`SELECT id, nome, duracao_min, preco_centavos FROM servicos WHERE barbearia_id = ? AND ativo = 1
                                  AND id IN (${servicoIds.map(() => "?").join(",")})`).bind(ctx.barbeariaId, ...servicoIds).all();
  if (r.results.length !== servicoIds.length) erro("Serviço não encontrado ou desativado.", 404);
  const ordem = Object.fromEntries(servicoIds.map((id, i) => [id, i]));
  return r.results.sort((a, b) => ordem[a.id] - ordem[b.id]);
}

// Comandos para gravar UM horário, só se não houver sobreposição nem bloqueio (conferência e gravação no mesmo comando).
function comandosDoHorario(ctx, { id, prof, cliente, data, ini, fim, servs, observacao, serieId }) {
  const { db, user } = ctx;
  const inicio = momento(data, ini);
  const termino = momento(data, fim);
  const conflito = `
    NOT EXISTS (SELECT 1 FROM agendamentos WHERE barbearia_id = ? AND barbeiro_id = ? AND situacao IN ('agendado','finalizado') AND inicio < ? AND fim > ?)
    AND NOT EXISTS (SELECT 1 FROM bloqueios WHERE barbearia_id = ? AND barbeiro_id = ? AND ativo = 1 AND inicio < ? AND fim > ?)`;
  const pConflito = [ctx.barbeariaId, prof.id, termino, inicio, ctx.barbeariaId, prof.id, termino, inicio];
  const existe = ["EXISTS (SELECT 1 FROM agendamentos WHERE id = ?)", [id]];
  return [
    db.prepare(`INSERT INTO agendamentos (id, barbearia_id, barbeiro_id, cliente_id, data, inicio, fim, observacao, criado_por)
                SELECT ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE ${conflito}`)
      .bind(id, ctx.barbeariaId, prof.id, cliente.id, data, inicio, termino, observacao, user.id, ...pConflito),
    ...servs.map(sv => db.prepare(`INSERT INTO agendamento_servicos (id, barbearia_id, agendamento_id, servico_id, nome, duracao_min)
                SELECT ?, ?, ?, ?, ?, ? WHERE ${existe[0]}`)
      .bind(crypto.randomUUID(), ctx.barbeariaId, id, sv.id, sv.nome, sv.duracao_min, ...existe[1])),
    ...(serieId ? [db.prepare(`INSERT INTO agendamento_serie_itens (serie_id, agendamento_id, barbearia_id) SELECT ?, ?, ? WHERE ${existe[0]}`)
      .bind(serieId, id, ctx.barbeariaId, ...existe[1])] : []),
    auditoriaSe(ctx, ...existe, "agendamento_criado", id, {
      depois: { barbeiro: prof.id, cliente: cliente.id, inicio, fim: termino, servicos: servs.map(x => x.nome), serie: serieId || undefined }
    })
  ];
}

const NOME_DIA_SEMANA = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];

export async function marcar(ctx) {
  const { db, user, request } = ctx;
  const input = await readJson(request);
  const prof = await profissional(ctx, input.barbeiroId);
  const data = exigirData(input.data);
  if (data < somarDias(hojeBrasil(), -1) || data > somarDias(hojeBrasil(), 366)) erro("Escolha uma data entre ontem e daqui a um ano.");
  const ini = horaParaMin(input.hora);
  if (ini === null) erro("Hora inválida (HH:MM).");
  const observacao = textoOpcional(input.observacao, 300);
  if (observacao === false) erro("Observação muito longa (até 300 letras).");
  const servs = await servicosEscolhidos(ctx, input.servicoIds);
  const fim = ini + servs.reduce((t, x) => t + x.duracao_min, 0);
  if (fim > 24 * 60) erro("O horário passa da meia-noite.");

  // Horário fixo: repete a cada N semanas até a data final. Desde 25/11/2026 (pedido do responsável) até 2 anos
  // (antes: 6 meses); quem marcou encerra a repetição quando quiser (Cancelar → "também os próximos").
  let datas = [data];
  let rep = null;
  if (input.repetir) {
    rep = input.repetir;
    if (!Number.isInteger(rep.intervaloSemanas) || rep.intervaloSemanas < 1 || rep.intervaloSemanas > 4) erro("Repetição inválida: a cada 1, 2, 3 ou 4 semanas.");
    const ate = exigirData(rep.ate, "Data final da repetição");
    if (ate <= data) erro("A data final da repetição precisa ser depois do primeiro horário.");
    if (ate > somarDias(data, 731)) erro("Repetição de no máximo 2 anos. Depois é só renovar.");
    datas = [];
    for (let d = data; d <= ate; d = somarDias(d, 7 * rep.intervaloSemanas)) datas.push(d);
  }

  const regras = await carregarRegras(db, ctx.barbeariaId, data, datas.at(-1));
  // Fora do funcionamento / dia fechado / fora do horário do profissional (25/11/2026): marca mesmo assim se quem marca
  // confirmar (aceiteForaHorario), e fica auditado. Conflito com outro atendimento ou bloqueio continua recusado.
  const aceiteFora = input.aceiteForaHorario === true;
  const foraDoHorario = [];
  // O primeiro horário precisa ser válido (mensagem clara); os seguintes que não couberem são pulados e listados.
  try { conferirHorario(regras(data, prof.id), ini, fim); }
  catch (e) {
    if (!(e instanceof HttpError) || e.status !== 409) throw e;
    if (!aceiteFora) throw new HttpError(e.message, 409, { codigo: "fora_do_horario" });
  }
  const pulados = [];
  const validas = [];
  for (const d of datas) {
    try { conferirHorario(regras(d, prof.id), ini, fim); validas.push(d); }
    catch (e) {
      if (aceiteFora && e instanceof HttpError && e.status === 409) { validas.push(d); foraDoHorario.push({ data: d, motivo: e.message }); }
      else pulados.push({ data: d, motivo: e.message });
    }
  }

  const comandos = [];
  const cliente = await clienteDaMarcacao(ctx, input.cliente, comandos);
  // Cliente bloqueado não marca; nota vencida (30 dias) exige o aceite de quem marca (pop-up na tela), que fica auditado.
  const notaVencida = cliente.novo ? null : await conferirClienteParaMarcar(ctx, cliente.id, input.aceiteNotaVencida);
  if (notaVencida) comandos.push(auditoria(ctx, "marcou_com_nota_vencida", cliente.id, { totalCentavos: notaVencida.totalCentavos, desde: notaVencida.desde, data, hora: input.hora }));
  const serieId = rep ? crypto.randomUUID() : null;
  if (rep) {
    comandos.push(
      db.prepare(`INSERT INTO agendamento_series (id, barbearia_id, barbeiro_id, cliente_id, intervalo_semanas, hora, data_ini, data_fim, criado_por)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(serieId, ctx.barbeariaId, prof.id, cliente.id, rep.intervaloSemanas, input.hora, data, datas.at(-1), user.id),
      auditoria(ctx, "horario_fixo_criado", serieId, { depois: { barbeiro: prof.id, cliente: cliente.id, intervaloSemanas: rep.intervaloSemanas, hora: input.hora, de: data, ate: datas.at(-1) } })
    );
  }
  if (foraDoHorario.length) comandos.push(auditoria(ctx, "marcou_fora_do_horario", prof.id, { hora: input.hora, dias: foraDoHorario }));
  const ids = validas.map(d => [d, crypto.randomUUID()]);
  for (const [d, id] of ids) comandos.push(...comandosDoHorario(ctx, { id, prof, cliente, data: d, ini, fim, servs, observacao, serieId }));
  await db.batch(comandos);

  const criados = (await db.prepare(`SELECT id, data FROM agendamentos WHERE id IN (${ids.map(() => "?").join(",")})`).bind(...ids.map(x => x[1])).all()).results;
  const criadosSet = new Set(criados.map(x => x.id));
  for (const [d, id] of ids) if (!criadosSet.has(id)) pulados.push({ data: d, motivo: "Já existe outro atendimento ou bloqueio nesse horário." });
  pulados.sort((x, y) => x.data.localeCompare(y.data));

  const primeiro = ids.find(([d]) => d === data);
  if (!primeiro || !criadosSet.has(primeiro[1])) {
    if (rep && criados.length) { /* o 1º conflitou, mas a série seguiu */ } else {
      const b = await db.prepare("SELECT 1 FROM bloqueios WHERE barbearia_id = ? AND barbeiro_id = ? AND ativo = 1 AND inicio < ? AND fim > ?")
        .bind(ctx.barbeariaId, prof.id, momento(data, fim), momento(data, ini)).first();
      erro(b ? "Esse horário está bloqueado na agenda do profissional." : "Já existe outro atendimento nesse horário para esse profissional.", 409);
    }
  }
  // Link pronto para confirmar o horário com o cliente pelo WhatsApp. Sem telefone: abre o WhatsApp para escolher o contato.
  let confirmacao = null, confirmacaoComNumero = false;
  if (primeiro && criadosSet.has(primeiro[1])) {
    const novo = await agendamentoPermitido(ctx, primeiro[1]);
    confirmacao = linksWhatsapp(novo, { confirmacao: (await carregarModelos(db, ctx.barbeariaId)).confirmacao }, user.barbearia_nome, { semNumero: true })?.confirmacao || null;
    confirmacaoComNumero = Boolean(telefoneReal(novo.cliente_telefone));
  }
  return json({
    agendamento: primeiro && criadosSet.has(primeiro[1])
      ? { id: primeiro[1], inicio: momento(data, ini), fim: momento(data, fim), barbeiroId: prof.id, cliente }
      : null,
    whatsappConfirmacao: confirmacao, whatsappComNumero: confirmacaoComNumero,
    ...(rep ? {
      serie: {
        id: serieId, intervaloSemanas: rep.intervaloSemanas, diaSemana: NOME_DIA_SEMANA[diaSemana(data)], hora: input.hora,
        criados: criados.length, datas: criados.map(x => x.data).sort(), pulados
      }
    } : {})
  }, 201);
}

// ---------- FINALIZAR ----------
async function finalizar(ctx) {
  return finalizarDados(ctx, await readJson(ctx.request));
}

// Nota (promissória) só para cliente identificado e ativo: é para quem o caixa vai cobrar depois.
// Promissória só para cliente já cadastrado na base de clientes (pedido de 16/11/2026): cliente avulso não fica na nota.
export const MSG_NOTA_CADASTRO = "Para lançar promissória, o cliente precisa estar cadastrado na base de clientes. Escolha o cliente da lista (cliente avulso não pode ficar na nota).";
export async function exigirClienteDaNota(ctx, clienteId) {
  const c = clienteId ? await ctx.db.prepare("SELECT nome, ativo FROM clientes WHERE id = ? AND barbearia_id = ?").bind(clienteId, ctx.barbeariaId).first() : null;
  if (!c || c.nome === CLIENTE_NAO_IDENTIFICADO) erro(MSG_NOTA_CADASTRO);
  if (!c.ativo) erro("Esse cliente está desativado: não dá para lançar na promissória.", 409);
  return c;
}

export async function finalizarDados(ctx, input, { caixaId = null } = {}) {
  const { db, user } = ctx;
  const a = await agendamentoPermitido(ctx, input.id, { cobrar: true });
  if (a.situacao !== "agendado") erro(`Esse horário está "${a.situacao}"; só dá para finalizar um horário agendado.`, 409);
  const hoje = hojeBrasil();
  if (a.data > hoje) erro("Não dá para finalizar um horário de um dia que ainda não chegou.", 409);
  // Correção de um atendimento: a cobrança nova volta para o MESMO caixa da cobrança corrigida (o dia do lançamento não muda).
  // Cobrança normal: caixa de hoje (gerente/dono: também com o caixa fechado — 17/11/2026).
  const caixa = (caixaId && await db.prepare("SELECT * FROM caixas WHERE id = ? AND barbearia_id = ? AND situacao = 'aberto'").bind(caixaId, ctx.barbeariaId).first())
    || await caixaParaLancar(ctx);

  // Serviços e valores (o valor de tabela vem do cadastro; o cobrado pode ser alterado e fica registrado).
  const itensIn = input.itens;
  if (!Array.isArray(itensIn) || itensIn.length < 1 || itensIn.length > 6) erro("Informe de 1 a 6 serviços.");
  const ids = itensIn.map(i => i?.servicoId);
  if (!ids.every(validId) || new Set(ids).size !== ids.length) erro("Serviços inválidos.");
  const tab = await db.prepare(`SELECT id, nome, preco_centavos, ativo FROM servicos WHERE barbearia_id = ? AND id IN (${ids.map(() => "?").join(",")})`)
    .bind(ctx.barbeariaId, ...ids).all();
  const porId = Object.fromEntries(tab.results.map(s => [s.id, s]));
  const doHorario = new Set((await db.prepare("SELECT servico_id FROM agendamento_servicos WHERE agendamento_id = ? AND NOT EXISTS (SELECT 1 FROM agendamento_servicos_removidos rm WHERE rm.linha_id = agendamento_servicos.id)").bind(a.id).all()).results.map(x => x.servico_id));
  // Serviço repetido = quantidade (1 a 20; pedido de 17/11/2026): vira uma linha por unidade, com o valor de cada.
  const itens = itensIn.flatMap(i => {
    const s = porId[i.servicoId];
    if (!s || (!s.ativo && !doHorario.has(s.id))) erro("Serviço não encontrado ou desativado.", 404);
    if (!validCentavos(i.precoCobradoCentavos)) erro(`Valor cobrado de "${s.nome}" inválido.`);
    const q = i.quantidade ?? 1;
    if (!Number.isInteger(q) || q < 1 || q > 20) erro(`Quantidade de "${s.nome}" inválida (1 a 20).`);
    return Array.from({ length: q }, () => ({ servicoId: s.id, nome: s.nome, tabela: s.preco_centavos, cobrado: i.precoCobradoCentavos }));
  });
  const total = itens.reduce((t, i) => t + i.cobrado, 0);

  // Produtos levados junto (pedido de 17/11/2026: corte + pomada no mesmo pagamento). Vira uma venda ligada ao horário,
  // em nome do profissional que atendeu (comissão de produto dele), gravada no MESMO lote da finalização.
  // O pagamento informado vale para o total (serviços + produtos): primeiro cobre os serviços, o resto vai para a venda.
  let venda = null, pagIn;
  if (Array.isArray(input.produtos) && input.produtos.length) {
    const vendedor = await db.prepare("SELECT id, perfil, comissao_produto_bp FROM usuarios WHERE id = ? AND barbearia_id = ?").bind(a.barbeiro_id, ctx.barbeariaId).first();
    venda = await montarVenda(ctx, { caixa, vendedor, clienteId: a.cliente_id, agendamentoId: a.id, itens: input.produtos,
      pagamentosDe: totalProdutos => {
        const todos = lerPagamentos(input.pagamentos, total + totalProdutos, { promissoria: true });
        const servico = [], produto = [];
        let falta = total;
        for (const pg of todos) {
          const parte = Math.min(falta, pg.valorCentavos);
          if (parte > 0) servico.push({ ...pg, valorCentavos: parte });
          if (pg.valorCentavos - parte > 0) produto.push({ ...pg, valorCentavos: pg.valorCentavos - parte });
          falta -= parte;
        }
        pagIn = servico;
        return produto;
      } });
  } else {
    // Até 2 formas de pagamento; a soma tem de bater com o total. "Promissória" = o cliente paga depois (nota em aberto).
    pagIn = lerPagamentos(input.pagamentos, total, { promissoria: true });
  }
  const nota = pagIn.find(p => p.forma === "promissoria") || null;
  const pagCaixa = pagIn.filter(p => p.forma !== "promissoria");
  if (nota) await exigirClienteDaNota(ctx, a.cliente_id);

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
                  AND ${sqlCaixaOk(ctx)}`).bind(a.id, ctx.barbeariaId, caixa.id),
    db.prepare(`INSERT INTO finalizacoes (id, barbearia_id, agendamento_id, barbeiro_id, caixa_id, total_centavos, valor_alterado, total_anterior_centavos, criado_por)
                SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?
                WHERE EXISTS (SELECT 1 FROM agendamentos WHERE id = ? AND situacao = 'finalizado')
                  AND NOT EXISTS (SELECT 1 FROM finalizacoes WHERE agendamento_id = ? AND estornada = 0)`)
      .bind(fid, ctx.barbeariaId, a.id, a.barbeiro_id, caixa.id, total, valorAlterado ? 1 : 0, totalAnterior, user.id, a.id, a.id),
    ...itens.map(i => db.prepare(`INSERT INTO finalizacao_itens (id, barbearia_id, finalizacao_id, servico_id, nome, preco_tabela_centavos, preco_cobrado_centavos)
                SELECT ?, ?, ?, ?, ?, ?, ? WHERE ${existeFin[0]}`)
      .bind(crypto.randomUUID(), ctx.barbeariaId, fid, i.servicoId, i.nome, i.tabela, i.cobrado, ...existeFin[1])),
    ...pagCaixa.map(p => db.prepare(`INSERT INTO caixa_lancamentos (id, barbearia_id, caixa_id, tipo, finalizacao_id, forma, valor_centavos, criado_por)
                SELECT ?, ?, ?, 'atendimento', ?, ?, ?, ? WHERE ${existeFin[0]}`)
      .bind(crypto.randomUUID(), ctx.barbeariaId, caixa.id, fid, p.forma, p.valorCentavos, user.id, ...existeFin[1])),
    ...(nota ? [db.prepare(`INSERT INTO promissorias (id, barbearia_id, cliente_id, origem, finalizacao_id, caixa_id, valor_centavos, descricao, criado_por)
                SELECT ?, ?, ?, 'atendimento', ?, ?, ?, ?, ? WHERE ${existeFin[0]}`)
      .bind(crypto.randomUUID(), ctx.barbeariaId, a.cliente_id, fid, caixa.id, nota.valorCentavos, `${itens.map(i => i.nome).join(" + ")} (${a.barbeiro_nome})`, user.id, ...existeFin[1])] : []),
    db.prepare(`INSERT INTO comissoes (id, barbearia_id, barbeiro_id, finalizacao_id, tipo, base_centavos, percentual_bp, valor_centavos)
                SELECT ?, ?, ?, ?, 'servico', ?, ?, ? WHERE ${existeFin[0]}`)
      .bind(crypto.randomUUID(), ctx.barbeariaId, a.barbeiro_id, fid, total, bp, comissao, ...existeFin[1]),
    auditoriaSe(ctx, ...existeFin, "atendimento_finalizado", a.id, {
      finalizacao: fid, total, totalAnterior, valorAlterado,
      itens: itens.map(i => ({ nome: i.nome, tabela: i.tabela, cobrado: i.cobrado })),
      pagamentos: pagIn.map(p => ({ forma: p.forma, valor: p.valorCentavos })), venda: venda ? venda.id : undefined
    }),
    ...(venda ? venda.comandos : [])
  ]);
  if (!(await db.prepare("SELECT 1 FROM finalizacoes WHERE id = ?").bind(fid).first())) {
    erro("Não foi possível finalizar: o horário mudou ou o caixa foi fechado. Atualize a tela.", 409);
  }
  if (venda && !(await db.prepare("SELECT 1 FROM vendas WHERE id = ?").bind(venda.id).first())) {
    erro("O atendimento foi cobrado, mas os produtos não: o estoque acabou ou mudou. Registre a venda dos produtos em Vender.", 409);
  }
  // O caixa nunca vê comissão.
  return json({ finalizacao: { id: fid, totalCentavos: total, valorAlterado, ...(user.perfil === "caixa" ? {} : { comissaoCentavos: comissao }) },
    ...(venda ? { venda: { id: venda.id, totalCentavos: venda.total } } : {}) }, 201);
}

// ---------- REABRIR (finalizado por engano) ----------
async function reabrir(ctx) {
  await reabrirDados(ctx, await readJson(ctx.request));
  return json({ mensagem: "Atendimento reaberto: entrada e comissão estornadas. O horário voltou para agendado." });
}
// Estorna a finalização (entrada, comissão e nota em aberto), com motivo; o horário volta para "agendado".
// Usado por "Reabrir" (agenda) e por "Corrigir" (caixa: estorna e cobra de novo com o valor certo).
export async function reabrirDados(ctx, input) {
  const { db, user } = ctx;
  const a = await agendamentoPermitido(ctx, input.id);
  if (a.situacao !== "finalizado") erro("Só dá para reabrir um atendimento finalizado.", 409);
  const motivo = exigirMotivo(input.motivo);
  const f = await db.prepare("SELECT f.*, c.situacao AS caixa_situacao, c.data AS caixa_data FROM finalizacoes f JOIN caixas c ON c.id = f.caixa_id WHERE f.agendamento_id = ? AND f.estornada = 0")
    .bind(a.id).first();
  if (!f) erro("Finalização não encontrada.", 404);
  if (await db.prepare(`SELECT 1 FROM comissoes c JOIN fechamento_comissao_itens i ON i.tipo = 'servico' AND i.ref_id = c.id
                        WHERE c.finalizacao_id = ?`).bind(f.id).first()) {
    erro("A comissão desse atendimento já entrou num fechamento de comissão: não dá para reabrir.", 409);
  }
  if (mesFechado(f.caixa_data)) erro(MSG_MES_FECHADO, 409);
  if (f.caixa_situacao !== "aberto") {
    erro(isGestao(user)
      ? "O caixa desse dia já foi fechado: reabra o caixa (com motivo) antes de reabrir o atendimento."
      : "O caixa desse dia já foi fechado: só o gerente pode reabrir.", 409);
  }
  if (!isGestao(user) && await db.prepare("SELECT 1 FROM promissorias WHERE finalizacao_id = ? AND situacao = 'aberta'").bind(f.id).first()) {
    erro("Esse atendimento está numa nota (promissória) em aberto: só o gerente pode reabrir (a nota é cancelada junto).", 403);
  }
  if (await db.prepare("SELECT 1 FROM promissorias WHERE finalizacao_id = ? AND situacao = 'quitada'").bind(f.id).first()) {
    erro("Esse atendimento foi na promissória e a nota já foi paga: estorne o recebimento da nota antes de reabrir.", 409);
  }
  const estornoId = crypto.randomUUID();
  const feito = ["EXISTS (SELECT 1 FROM finalizacoes WHERE id = ? AND estorno_id = ?)", [f.id, estornoId]];
  await db.batch([
    db.prepare(`UPDATE finalizacoes SET estornada = 1, estorno_id = ?, estornada_por = ?, estornada_em = CURRENT_TIMESTAMP, motivo_estorno = ?
                WHERE id = ? AND barbearia_id = ? AND estornada = 0 AND EXISTS (SELECT 1 FROM caixas WHERE id = ? AND situacao = 'aberto')
                  AND NOT EXISTS (SELECT 1 FROM promissorias WHERE finalizacao_id = ? AND situacao = 'quitada')`)
      .bind(estornoId, user.id, motivo, f.id, ctx.barbeariaId, f.caixa_id, f.id),
    // Nota (promissória) em aberto desse atendimento: estornada junto (nada é apagado).
    db.prepare(`UPDATE promissorias SET situacao = 'estornada', motivo_estorno = ? WHERE finalizacao_id = ? AND situacao = 'aberta' AND ${feito[0]}`)
      .bind(`Atendimento reaberto: ${motivo}`, f.id, ...feito[1]),
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
  return { caixaId: f.caixa_id };
}

// ---------- REMARCAR (remanejar um horário agendado: outra hora, outro dia e/ou outro profissional) ----------
// Mantém cliente e serviços (mesma duração). Confere funcionamento/horário/datas fechadas e, na gravação, conflito e bloqueio.
async function remarcar(ctx) {
  const { db, user, request } = ctx;
  const input = await readJson(request);
  const a = await agendamentoPermitido(ctx, input.id);
  if (a.situacao !== "agendado") erro("Só dá para remarcar um horário agendado.", 409);
  const data = exigirData(input.data);
  if (data < hojeBrasil() || data > somarDias(hojeBrasil(), 366)) erro("Escolha uma data de hoje até daqui a um ano.");
  const ini = horaParaMin(input.hora);
  if (ini === null) erro("Hora inválida (HH:MM).");
  const prof = input.barbeiroId && input.barbeiroId !== a.barbeiro_id ? await profissional(ctx, input.barbeiroId)
    : { id: a.barbeiro_id };
  const dur = horaParaMin(a.fim.slice(11)) - horaParaMin(a.inicio.slice(11));
  const fim = ini + dur;
  if (fim > 24 * 60) erro("O horário passa da meia-noite.");
  const inicio = momento(data, ini), termino = momento(data, fim);
  if (prof.id === a.barbeiro_id && inicio === a.inicio) erro("Escolha outro horário, dia ou profissional.");
  conferirHorario(await regrasDoDia(db, ctx.barbeariaId, prof.id, data), ini, fim);
  const depois = ["EXISTS (SELECT 1 FROM agendamentos WHERE id = ? AND barbeiro_id = ? AND inicio = ? AND fim = ?)", [a.id, prof.id, inicio, termino]];
  const r = await db.batch([
    db.prepare(`UPDATE agendamentos SET barbeiro_id = ?, data = ?, inicio = ?, fim = ?, atualizado_em = CURRENT_TIMESTAMP
                WHERE id = ? AND barbearia_id = ? AND situacao = 'agendado'
                  AND NOT EXISTS (SELECT 1 FROM agendamentos o WHERE o.barbearia_id = ? AND o.barbeiro_id = ? AND o.id <> ? AND o.situacao IN ('agendado','finalizado') AND o.inicio < ? AND o.fim > ?)
                  AND NOT EXISTS (SELECT 1 FROM bloqueios WHERE barbearia_id = ? AND barbeiro_id = ? AND ativo = 1 AND inicio < ? AND fim > ?)`)
      .bind(prof.id, data, inicio, termino, a.id, ctx.barbeariaId, ctx.barbeariaId, prof.id, a.id, termino, inicio, ctx.barbeariaId, prof.id, termino, inicio),
    auditoriaSe(ctx, ...depois, "agendamento_remarcado", a.id, {
      antes: { barbeiro: a.barbeiro_id, inicio: a.inicio, fim: a.fim }, depois: { barbeiro: prof.id, inicio, fim: termino }
    })
  ]);
  if (!r[0].meta?.changes) {
    const b = await db.prepare("SELECT 1 FROM bloqueios WHERE barbearia_id = ? AND barbeiro_id = ? AND ativo = 1 AND inicio < ? AND fim > ?").bind(ctx.barbeariaId, prof.id, termino, inicio).first();
    erro(b ? "Esse horário está bloqueado na agenda do profissional." : "Já existe outro atendimento nesse horário. Escolha um horário livre.", 409);
  }
  // Link pronto para avisar o cliente do novo horário (lembrete), se ele tiver telefone.
  const novo = await agendamentoPermitido(ctx, a.id);
  const modelos = await carregarModelos(db, ctx.barbeariaId);
  return json({
    mensagem: `Horário remarcado para ${data.split("-").reverse().slice(0, 2).join("/")} às ${minParaHora(ini)}.`,
    agendamento: { id: a.id, data, inicio: minParaHora(ini), fim: minParaHora(fim), barbeiroId: prof.id },
    whatsapp: linksWhatsapp(novo, { lembrete: modelos.lembrete }, user.barbearia_nome)?.lembrete || null
  });
}

// ---------- FALTOU / CANCELADO ----------
async function mudarSituacao(ctx) {
  const { db, request } = ctx;
  const input = await readJson(request);
  const a = await agendamentoPermitido(ctx, input.id);
  if (!["faltou", "cancelado"].includes(input.situacao)) erro("Situação inválida (faltou ou cancelado).");
  if (a.situacao !== "agendado") erro("Só um horário agendado pode virar falta ou cancelamento.", 409);
  const motivo = input.situacao === "cancelado" ? exigirMotivo(input.motivo) : (textoLimpo(input.motivo, 3, 300) || null);
  // Horário fixo: cancelar "este e os próximos" da série.
  if (input.situacao === "cancelado" && input.serie === true) {
    const it = await db.prepare("SELECT serie_id FROM agendamento_serie_itens WHERE agendamento_id = ? AND barbearia_id = ?").bind(a.id, ctx.barbeariaId).first();
    if (!it) erro("Esse horário não faz parte de um horário fixo.");
    const proximos = `id IN (SELECT agendamento_id FROM agendamento_serie_itens WHERE serie_id = ?) AND barbearia_id = ? AND situacao = 'agendado' AND inicio >= ?`;
    const qtd = await db.prepare(`SELECT COUNT(*) AS n FROM agendamentos WHERE ${proximos}`).bind(it.serie_id, ctx.barbeariaId, a.inicio).first();
    await db.batch([
      db.prepare(`UPDATE agendamentos SET situacao = 'cancelado', motivo = ?, atualizado_em = CURRENT_TIMESTAMP WHERE ${proximos}`).bind(motivo, it.serie_id, ctx.barbeariaId, a.inicio),
      db.prepare("UPDATE agendamento_series SET ativo = 0, motivo_encerramento = ?, data_fim = ? WHERE id = ? AND barbearia_id = ?").bind(motivo, somarDias(a.data, -1), it.serie_id, ctx.barbeariaId),
      auditoria(ctx, "horario_fixo_encerrado", it.serie_id, { motivo, aPartirDe: a.data, cancelados: Number(qtd.n) })
    ]);
    return json({ mensagem: `Horário fixo encerrado: ${qtd.n} horário(s) cancelado(s) a partir de ${a.data.split("-").reverse().join("/")}.`, cancelados: Number(qtd.n) });
  }
  await db.batch([
    db.prepare("UPDATE agendamentos SET situacao = ?, motivo = ?, atualizado_em = CURRENT_TIMESTAMP WHERE id = ? AND barbearia_id = ? AND situacao = 'agendado'")
      .bind(input.situacao, motivo, a.id, ctx.barbeariaId),
    auditoria(ctx, input.situacao === "cancelado" ? "agendamento_cancelado" : "agendamento_falta", a.id, { motivo, antes: { situacao: "agendado" }, depois: { situacao: input.situacao } })
  ]);
  return json({ mensagem: input.situacao === "cancelado" ? "Horário cancelado." : "Falta registrada." });
}

// ---------- EDITAR (serviços, cliente, observação) / DESFAZER FALTA OU CANCELAMENTO / EXCLUIR ----------
async function editar(ctx) {
  const { db, request } = ctx;
  const input = await readJson(request);
  const a = await agendamentoPermitido(ctx, input.id);
  if (await db.prepare("SELECT 1 FROM agendamentos_excluidos WHERE agendamento_id = ?").bind(a.id).first()) erro("Esse horário foi excluído.", 409);
  if (a.situacao !== "agendado") erro("Só dá para editar um horário agendado. Finalizado: use Reabrir; falta ou cancelado: use Desfazer.", 409);
  const observacao = textoOpcional(input.observacao, 300);
  if (observacao === false) erro("Observação muito longa (até 300 letras).");
  const servs = await servicosEscolhidos(ctx, input.servicoIds);
  const ini = horaParaMin(a.inicio.slice(11));
  const fim = ini + servs.reduce((t, x) => t + x.duracao_min, 0);
  if (fim > 24 * 60) erro("O horário passa da meia-noite.");
  conferirHorario(await regrasDoDia(db, ctx.barbeariaId, a.barbeiro_id, a.data), ini, fim);
  const comandos = [];
  const cliente = input.cliente ? await clienteDaMarcacao(ctx, input.cliente, comandos) : { id: a.cliente_id, nome: a.cliente_nome };
  // Trocou para outro cliente já cadastrado: mesmas regras de marcar (bloqueado não; nota vencida pede o aceite).
  if (!cliente.novo && cliente.id !== a.cliente_id) {
    const nv = await conferirClienteParaMarcar(ctx, cliente.id, input.aceiteNotaVencida);
    if (nv) comandos.push(auditoria(ctx, "marcou_com_nota_vencida", cliente.id, { totalCentavos: nv.totalCentavos, desde: nv.desde, agendamento: a.id, edicao: true }));
  }
  const termino = momento(a.data, fim);
  const antes = (await db.prepare("SELECT servico_id, nome FROM agendamento_servicos WHERE agendamento_id = ? AND NOT EXISTS (SELECT 1 FROM agendamento_servicos_removidos rm WHERE rm.linha_id = agendamento_servicos.id) ORDER BY rowid").bind(a.id).all()).results;
  const marca = new Date().toISOString();
  // Tudo só acontece se o horário continua agendado e o novo fim não bate em outro atendimento ou bloqueio.
  const pode = `EXISTS (SELECT 1 FROM agendamentos WHERE id = ? AND barbearia_id = ? AND situacao = 'agendado' AND fim = ? AND cliente_id = ?)`;
  comandos.push(
    db.prepare(`UPDATE agendamentos SET fim = ?, cliente_id = ?, observacao = ?, atualizado_em = CURRENT_TIMESTAMP
                WHERE id = ? AND barbearia_id = ? AND situacao = 'agendado'
                  AND NOT EXISTS (SELECT 1 FROM agendamentos o WHERE o.barbearia_id = ? AND o.barbeiro_id = ? AND o.id <> ? AND o.situacao IN ('agendado','finalizado') AND o.inicio < ? AND o.fim > ?)
                  AND NOT EXISTS (SELECT 1 FROM bloqueios WHERE barbearia_id = ? AND barbeiro_id = ? AND ativo = 1 AND inicio < ? AND fim > ?)`)
      .bind(termino, cliente.id, observacao || null, a.id, ctx.barbeariaId, ctx.barbeariaId, a.barbeiro_id, a.id, termino, a.inicio, ctx.barbeariaId, a.barbeiro_id, termino, a.inicio),
    db.prepare(`INSERT INTO agendamento_servicos_removidos (linha_id, barbearia_id, agendamento_id, removido_em, removido_por)
                SELECT s.id, s.barbearia_id, s.agendamento_id, ?, ? FROM agendamento_servicos s
                WHERE s.agendamento_id = ? AND NOT EXISTS (SELECT 1 FROM agendamento_servicos_removidos rm WHERE rm.linha_id = s.id) AND ${pode}`)
      .bind(marca, ctx.user.id, a.id, a.id, ctx.barbeariaId, termino, cliente.id),
    ...servs.map(sv => db.prepare(`INSERT INTO agendamento_servicos (id, barbearia_id, agendamento_id, servico_id, nome, duracao_min) SELECT ?, ?, ?, ?, ?, ? WHERE ${pode}`)
      .bind(crypto.randomUUID(), ctx.barbeariaId, a.id, sv.id, sv.nome, sv.duracao_min, a.id, ctx.barbeariaId, termino, cliente.id)),
    auditoriaSe(ctx, pode, [a.id, ctx.barbeariaId, termino, cliente.id], "agendamento_editado", a.id, {
      antes: { cliente: a.cliente_id, fim: a.fim, observacao: a.observacao || null, servicos: antes.map(x => x.nome) },
      depois: { cliente: cliente.id, fim: termino, observacao: observacao || null, servicos: servs.map(x => x.nome) }
    })
  );
  await db.batch(comandos);
  // Conferência: se o UPDATE não passou (conflito), o fim/cliente não mudaram e nada foi trocado.
  if (!(await db.prepare(`SELECT 1 FROM agendamentos WHERE id = ? AND fim = ? AND cliente_id = ?`).bind(a.id, termino, cliente.id).first())) {
    erro("Com esses serviços o horário passa a bater em outro atendimento ou bloqueio. Remarque ou escolha menos serviços.", 409);
  }
  return json({ mensagem: "Horário atualizado.", fim: minParaHora(fim) });
}

async function desfazer(ctx) {
  const { db, request } = ctx;
  const input = await readJson(request);
  const a = await agendamentoPermitido(ctx, input.id);
  if (await db.prepare("SELECT 1 FROM agendamentos_excluidos WHERE agendamento_id = ?").bind(a.id).first()) erro("Esse horário foi excluído.", 409);
  if (!["faltou", "cancelado"].includes(a.situacao)) erro("Só dá para desfazer uma falta ou um cancelamento.", 409);
  const r = await db.batch([
    db.prepare(`UPDATE agendamentos SET situacao = 'agendado', motivo = NULL, atualizado_em = CURRENT_TIMESTAMP
                WHERE id = ? AND barbearia_id = ? AND situacao = ?
                  AND NOT EXISTS (SELECT 1 FROM agendamentos o WHERE o.barbearia_id = ? AND o.barbeiro_id = ? AND o.id <> ? AND o.situacao IN ('agendado','finalizado') AND o.inicio < ? AND o.fim > ?)
                  AND NOT EXISTS (SELECT 1 FROM bloqueios WHERE barbearia_id = ? AND barbeiro_id = ? AND ativo = 1 AND inicio < ? AND fim > ?)`)
      .bind(a.id, ctx.barbeariaId, a.situacao, ctx.barbeariaId, a.barbeiro_id, a.id, a.fim, a.inicio, ctx.barbeariaId, a.barbeiro_id, a.fim, a.inicio),
    auditoriaSe(ctx, "EXISTS (SELECT 1 FROM agendamentos WHERE id = ? AND situacao = 'agendado')", [a.id], "agendamento_desfeito", a.id, {
      antes: { situacao: a.situacao, motivo: a.motivo || null }, depois: { situacao: "agendado" }
    })
  ]);
  if (!r[0].meta?.changes) erro("Esse horário já foi ocupado por outro atendimento ou bloqueio. Marque um novo horário.", 409);
  return json({ mensagem: a.situacao === "faltou" ? "Falta desfeita: o horário voltou para agendado." : "Cancelamento desfeito: o horário voltou para agendado." });
}

async function excluir(ctx) {
  const { db, user, request } = ctx;
  const input = await readJson(request);
  const a = await agendamentoPermitido(ctx, input.id);
  const motivo = exigirMotivo(input.motivo);
  if (await db.prepare("SELECT 1 FROM agendamentos_excluidos WHERE agendamento_id = ?").bind(a.id).first()) erro("Esse horário já foi excluído.", 409);
  if (a.situacao === "finalizado") erro("Atendimento finalizado não pode ser excluído: o valor já entrou no caixa. Reabra antes, se foi lançado errado.", 409);
  const r = await db.batch([
    db.prepare(`INSERT INTO agendamentos_excluidos (agendamento_id, barbearia_id, motivo, situacao_antes, excluido_por)
                SELECT id, barbearia_id, ?, situacao, ? FROM agendamentos WHERE id = ? AND barbearia_id = ? AND situacao <> 'finalizado'`)
      .bind(motivo, user.id, a.id, ctx.barbeariaId),
    db.prepare(`UPDATE agendamentos SET situacao = 'cancelado', motivo = ?, atualizado_em = CURRENT_TIMESTAMP
                WHERE id = ? AND barbearia_id = ? AND situacao = 'agendado' AND EXISTS (SELECT 1 FROM agendamentos_excluidos WHERE agendamento_id = ?)`)
      .bind(`Excluído: ${motivo}`, a.id, ctx.barbeariaId, a.id),
    auditoriaSe(ctx, "EXISTS (SELECT 1 FROM agendamentos_excluidos WHERE agendamento_id = ?)", [a.id], "agendamento_excluido", a.id, {
      motivo, antes: { situacao: a.situacao, inicio: a.inicio, cliente: a.cliente_id }, depois: { excluido: true }
    })
  ]);
  if (!r[0].meta?.changes) erro("Não foi possível excluir: o horário mudou. Atualize a agenda.", 409);
  return json({ mensagem: "Horário excluído da agenda." });
}

// ---------- EDITAR A REPETIÇÃO DE UM HORÁRIO FIXO (25/11/2026) ----------
// Vale "deste horário em diante": os próximos da série (ainda agendados) saem da agenda (excluídos com motivo, nada apagado)
// e são criados de novo com a nova frequência até a nova data. intervaloSemanas 0 = parar de repetir (este fica).
// Mesmas regras do marcar: conflito/bloqueio pula a data; fora do funcionamento pula, a não ser com aceiteForaHorario.
async function editarSerie(ctx) {
  const { db, user, request } = ctx;
  const input = await readJson(request);
  const a = await agendamentoPermitido(ctx, input.id);
  if (a.situacao !== "agendado") erro("Só dá para mudar a repetição a partir de um horário agendado.", 409);
  const se = await db.prepare(`SELECT s.* FROM agendamento_serie_itens i JOIN agendamento_series s ON s.id = i.serie_id
                               WHERE i.agendamento_id = ? AND i.barbearia_id = ?`).bind(a.id, ctx.barbeariaId).first();
  if (!se) erro("Esse horário não faz parte de um horário fixo.");
  const n = input.intervaloSemanas;
  if (!Number.isInteger(n) || n < 0 || n > 4) erro("Repetição inválida: não repetir, toda semana, a cada 15 dias, 3 ou 4 semanas.");
  let ate = null;
  if (n > 0) {
    ate = exigirData(input.ate, "Data final da repetição");
    if (ate <= a.data) erro("A data final da repetição precisa ser depois deste horário.");
    if (ate > somarDias(a.data, 731)) erro("Repetição de no máximo 2 anos. Depois é só renovar.");
  }
  const motivo = "Repetição alterada";
  const proximos = `id IN (SELECT agendamento_id FROM agendamento_serie_itens WHERE serie_id = ?) AND barbearia_id = ? AND situacao = 'agendado' AND inicio > ?
                    AND id NOT IN (SELECT agendamento_id FROM agendamentos_excluidos)`;
  const qtd = Number((await db.prepare(`SELECT COUNT(*) AS n FROM agendamentos WHERE ${proximos}`).bind(se.id, ctx.barbeariaId, a.inicio).first()).n);
  const comandos = [
    db.prepare(`INSERT INTO agendamentos_excluidos (agendamento_id, barbearia_id, motivo, situacao_antes, excluido_por)
                SELECT id, barbearia_id, ?, situacao, ? FROM agendamentos WHERE ${proximos}`).bind(motivo, user.id, se.id, ctx.barbeariaId, a.inicio),
    db.prepare(`UPDATE agendamentos SET situacao = 'cancelado', motivo = ?, atualizado_em = CURRENT_TIMESTAMP
                WHERE id IN (SELECT agendamento_id FROM agendamentos_excluidos WHERE motivo = ? AND excluido_por = ?)
                  AND id IN (SELECT agendamento_id FROM agendamento_serie_itens WHERE serie_id = ?) AND situacao = 'agendado' AND inicio > ?`)
      .bind(`Excluído: ${motivo}`, motivo, user.id, se.id, a.inicio)
  ];
  const antes = { intervaloSemanas: se.intervalo_semanas, ate: se.data_fim };
  if (n === 0) {
    comandos.push(
      db.prepare("UPDATE agendamento_series SET ativo = 0, motivo_encerramento = ?, data_fim = ? WHERE id = ? AND barbearia_id = ?").bind("Parou de repetir", a.data, se.id, ctx.barbeariaId),
      auditoria(ctx, "horario_fixo_alterado", se.id, { aPartirDe: a.data, antes, depois: { repete: false }, removidos: qtd })
    );
    await db.batch(comandos);
    return json({ mensagem: `Não repete mais: ${qtd} horário(s) seguinte(s) saíram da agenda. Este continua marcado.`, removidos: qtd, criados: 0, pulados: [] });
  }
  // Novas datas depois deste horário
  const datas = [];
  for (let d = somarDias(a.data, 7 * n); d <= ate; d = somarDias(d, 7 * n)) datas.push(d);
  const ini = horaParaMin(a.inicio.slice(11, 16));
  const fim = horaParaMin(a.fim.slice(11, 16));
  const servs = (await db.prepare(`SELECT servico_id AS id, nome, duracao_min FROM agendamento_servicos s WHERE s.agendamento_id = ? AND s.barbearia_id = ?
                                  AND NOT EXISTS (SELECT 1 FROM agendamento_servicos_removidos rm WHERE rm.linha_id = s.id) ORDER BY s.rowid`).bind(a.id, ctx.barbeariaId).all()).results;
  const pulados = [];
  const validas = [];
  const foraDoHorario = [];
  if (datas.length) {
    const regras = await carregarRegras(db, ctx.barbeariaId, datas[0], datas.at(-1));
    for (const d of datas) {
      try { conferirHorario(regras(d, a.barbeiro_id), ini, fim); validas.push(d); }
      catch (e) {
        if (input.aceiteForaHorario === true && e instanceof HttpError && e.status === 409) { validas.push(d); foraDoHorario.push({ data: d, motivo: e.message }); }
        else pulados.push({ data: d, motivo: e.message });
      }
    }
  }
  const ids = validas.map(d => [d, crypto.randomUUID()]);
  for (const [d, id] of ids) {
    comandos.push(...comandosDoHorario(ctx, { id, prof: { id: a.barbeiro_id }, cliente: { id: a.cliente_id }, data: d, ini, fim, servs, observacao: a.observacao, serieId: se.id }));
  }
  comandos.push(
    db.prepare("UPDATE agendamento_series SET intervalo_semanas = ?, data_fim = ?, ativo = 1, motivo_encerramento = NULL WHERE id = ? AND barbearia_id = ?").bind(n, ate, se.id, ctx.barbeariaId),
    auditoria(ctx, "horario_fixo_alterado", se.id, { aPartirDe: a.data, antes, depois: { intervaloSemanas: n, ate }, removidos: qtd, datas: validas.length }),
    ...(foraDoHorario.length ? [auditoria(ctx, "marcou_fora_do_horario", a.barbeiro_id, { hora: a.inicio.slice(11, 16), dias: foraDoHorario })] : [])
  );
  await db.batch(comandos);
  const criados = ids.length ? (await db.prepare(`SELECT data FROM agendamentos WHERE id IN (${ids.map(() => "?").join(",")})`).bind(...ids.map(x => x[1])).all()).results.map(x => x.data) : [];
  const criadosSet = new Set(criados);
  for (const [d] of ids) if (!criadosSet.has(d)) pulados.push({ data: d, motivo: "Já existe outro atendimento ou bloqueio nesse horário." });
  pulados.sort((x, y) => x.data.localeCompare(y.data));
  return json({
    mensagem: `Repetição alterada: ${criados.length} horário(s) daqui para frente.`,
    removidos: qtd, criados: criados.length, datas: criados.sort(), pulados, diaSemana: NOME_DIA_SEMANA[diaSemana(a.data)], intervaloSemanas: n
  });
}

// ---------- MENSAGEM (registro do envio pelo WhatsApp) ----------
async function registrarMensagem(ctx) {
  const { db, user, request } = ctx;
  const input = await readJson(request);
  const a = await agendamentoPermitido(ctx, input.id);
  if (!["lembrete", "proposta", "confirmacao"].includes(input.tipo)) erro("Tipo de mensagem inválido.");
  const modelos = await carregarModelos(db, ctx.barbeariaId);
  const url = linksWhatsapp(a, { [input.tipo]: modelos[input.tipo] }, user.barbearia_nome, { semNumero: true })[input.tipo];
  const id = crypto.randomUUID();
  await db.batch([
    db.prepare(`INSERT INTO ${input.tipo === "confirmacao" ? "mensagens_enviadas_adicionais" : "mensagens_enviadas"} (id, barbearia_id, agendamento_id, tipo, usuario_id) VALUES (?, ?, ?, ?, ?)`)
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

// Busca de cliente cadastrado (nome ou telefone) para marcar horário: só ativos, só desta barbearia.
async function buscarClientes(ctx) {
  const busca = (new URL(ctx.request.url).searchParams.get("busca") || "").trim().slice(0, 60);
  if (busca.length < 2) return json({ clientes: [] });
  const digitos = busca.replace(/\D/g, "");
  const nome = `%${busca.replace(/[%_]/g, "")}%`;
  // Busca por nome, apelido (migração 0016) ou telefone.
  const r = await ctx.db.prepare(`SELECT c.id, c.nome, c.telefone, ap.apelido FROM clientes c LEFT JOIN clientes_apelidos ap ON ap.cliente_id = c.id
      WHERE c.barbearia_id = ? AND c.ativo = 1
      AND (c.nome LIKE ? OR ap.apelido LIKE ? ${digitos.length >= 3 ? "OR (c.telefone LIKE ? AND c.telefone NOT LIKE 'sem:%')" : ""}) ORDER BY c.nome LIMIT 8`)
    .bind(ctx.barbeariaId, nome, nome, ...(digitos.length >= 3 ? [`%${digitos}%`] : [])).all();
  const sinais = r.results.length ? await sinaisClientes(ctx.db, ctx.barbeariaId) : new Map();
  return json({ clientes: r.results.map(c => ({ id: c.id, nome: c.nome, apelido: c.apelido || null, telefone: telefoneReal(c.telefone), ...(sinais.get(c.id) || {}) })) });
}

// ---------- DISPONIBILIDADE DE UM DIA (para quem vai marcar): situação de cada profissional, ocupados e horários livres ----------
// Livres = inícios de 30 em 30 minutos (a partir da abertura) em que cabe a duração pedida; hoje, só a partir de agora.
// Horários livres de um profissional num dia: de 30 em 30 minutos (pedido de 16/11/2026) + logo depois de cada
// atendimento/bloqueio/intervalo (um serviço de 1h30 às 10:00 libera 11:30), onde cabe a duração; hoje, só a partir de agora.
export function iniciosLivres(janela, ocupados, duracao, data, hoje, agoraMin) {
  if (data < hoje) return [];
  const inicios = new Set();
  for (let t = janela.ini; t < janela.fim; t += 30) inicios.add(t);
  for (const o of ocupados) if (o.fim > janela.ini && o.fim < janela.fim) inicios.add(o.fim);
  return [...inicios].sort((a, b) => a - b).filter(t => t + duracao <= janela.fim
    && !(data === hoje && t < agoraMin)
    && !ocupados.some(o => t < o.fim && t + duracao > o.ini));
}

async function disponibilidade(ctx) {
  const { db, user, request } = ctx;
  const url = new URL(request.url);
  const data = exigirData(url.searchParams.get("data") || hojeBrasil());
  const filtro = veTodasAgendas(user) ? (url.searchParams.get("barbeiroId") || null) : user.id;
  if (filtro && !validId(filtro)) erro("Profissional inválido.");
  const durPedida = Number(url.searchParams.get("duracao") || 0);
  const [profsR, ags, blqs, minDur, regras] = await Promise.all([
    db.prepare(`SELECT id, nome FROM usuarios WHERE barbearia_id = ? AND ativo = 1 AND perfil IN ('proprietario','gerente','barbeiro')${filtro ? " AND id = ?" : ""}
                ORDER BY CASE perfil WHEN 'gerente' THEN 0 ELSE 1 END, nome`).bind(ctx.barbeariaId, ...(filtro ? [filtro] : [])).all(),
    db.prepare(`SELECT a.barbeiro_id, a.inicio, a.fim, a.situacao, c.nome AS cliente FROM agendamentos a JOIN clientes c ON c.id = a.cliente_id
                WHERE a.barbearia_id = ? AND a.data = ? AND a.situacao IN ('agendado','finalizado') ORDER BY a.inicio`).bind(ctx.barbeariaId, data).all(),
    db.prepare("SELECT barbeiro_id, inicio, fim, motivo FROM bloqueios WHERE barbearia_id = ? AND ativo = 1 AND inicio < ? AND fim > ?")
      .bind(ctx.barbeariaId, `${somarDias(data, 1)}T00:00`, `${data}T00:00`).all(),
    db.prepare("SELECT MIN(duracao_min) AS m FROM servicos WHERE barbearia_id = ? AND ativo = 1").bind(ctx.barbeariaId).first(),
    carregarRegras(db, ctx.barbeariaId, data, data)
  ]);
  const duracao = Number.isInteger(durPedida) && durPedida >= 5 && durPedida <= 600 ? durPedida : Number(minDur?.m || 30);
  const hoje = hojeBrasil();
  const agoraMin = (() => { const d = new Date(Date.now() - 3 * 3600 * 1000); return d.getUTCHours() * 60 + d.getUTCMinutes(); })();
  const minDoDia = m => (m.slice(0, 10) < data ? 0 : m.slice(0, 10) > data ? 1440 : horaParaMin(m.slice(11)));
  const profissionais = profsR.results.map(p => {
    const r = regras(data, p.id);
    let situacao = "aberto", motivo = null;
    if (r.fechada) { situacao = "fechado"; motivo = r.fechada.motivo; }
    else if (!r.func) { situacao = "sem_funcionamento"; motivo = "Funcionamento da barbearia não cadastrado"; }
    else if (!r.func.aberto) { situacao = "fechado"; motivo = `A barbearia não abre às ${NOME_DIA[r.dia]}s`; }
    else if (r.trab && !r.trab.trabalha) { situacao = "folga"; motivo = `Não trabalha às ${NOME_DIA[r.dia]}s`; }
    const janela = situacao === "aberto" ? janelaDoDia(r) : null;
    const ocupados = [
      ...ags.results.filter(a => a.barbeiro_id === p.id).map(a => ({ ini: horaParaMin(a.inicio.slice(11)), fim: horaParaMin(a.fim.slice(11)), tipo: "horario", texto: a.cliente })),
      ...blqs.results.filter(b => b.barbeiro_id === p.id).map(b => ({ ini: minDoDia(b.inicio), fim: minDoDia(b.fim), tipo: "bloqueio", texto: b.motivo || "Bloqueado" })),
      ...(janela?.intervalo ? [{ ini: janela.intervalo[0], fim: janela.intervalo[1], tipo: "intervalo", texto: "Intervalo" }] : [])
    ].sort((a, b) => a.ini - b.ini);
    const livres = janela ? iniciosLivres(janela, ocupados, duracao, data, hoje, agoraMin) : [];
    const diaInteiroBloqueado = janela && ocupados.some(o => o.tipo === "bloqueio" && o.ini <= janela.ini && o.fim >= janela.fim);
    if (diaInteiroBloqueado) { situacao = "bloqueado"; motivo = ocupados.find(o => o.tipo === "bloqueio").texto; }
    return {
      id: p.id, nome: p.nome, situacao, motivo,
      janela: janela ? { ini: minParaHora(janela.ini), fim: minParaHora(janela.fim) } : null,
      ocupados: ocupados.map(o => ({ ini: minParaHora(Math.max(0, o.ini)), fim: minParaHora(Math.min(1439, o.fim)), tipo: o.tipo, texto: o.texto })),
      livres: livres.map(minParaHora)
    };
  });
  const esp = regras(data, null).func?.especial;
  return json({ data, passado: data < hoje, duracao, profissionais, ...(esp ? { especial: { motivo: esp.motivo } } : {}) });
}

// ---------- OCUPAÇÃO POR DIA (calendário Mês/Ano): livre, poucos horários, cheio, fechado ----------
async function ocupacao(ctx) {
  const { db, user, request } = ctx;
  const url = new URL(request.url);
  const ini = exigirData(url.searchParams.get("inicio"), "Início");
  const fim = exigirData(url.searchParams.get("fim"), "Fim");
  if (fim < ini || fim > somarDias(ini, 400)) erro("Período inválido (até 1 ano).");
  const filtro = veTodasAgendas(user) ? (url.searchParams.get("barbeiroId") || null) : user.id;
  if (filtro && !validId(filtro)) erro("Profissional inválido.");
  const [profsR, ags, blqs, minDur, regras] = await Promise.all([
    db.prepare(`SELECT id, nome FROM usuarios WHERE barbearia_id = ? AND ativo = 1 AND perfil IN ('proprietario','gerente','barbeiro')${filtro ? " AND id = ?" : ""}`)
      .bind(ctx.barbeariaId, ...(filtro ? [filtro] : [])).all(),
    db.prepare(`SELECT barbeiro_id, data, inicio, fim FROM agendamentos WHERE barbearia_id = ? AND situacao IN ('agendado','finalizado') AND data BETWEEN ? AND ?`)
      .bind(ctx.barbeariaId, ini, fim).all(),
    db.prepare(`SELECT barbeiro_id, inicio, fim FROM bloqueios WHERE barbearia_id = ? AND ativo = 1 AND inicio < ? AND fim > ?`)
      .bind(ctx.barbeariaId, `${somarDias(fim, 1)}T00:00`, `${ini}T00:00`).all(),
    db.prepare("SELECT MIN(duracao_min) AS m FROM servicos WHERE barbearia_id = ? AND ativo = 1").bind(ctx.barbeariaId).first(),
    carregarRegras(db, ctx.barbeariaId, ini, fim)
  ]);
  const profs = profsR.results;
  const duracaoMinima = Number(minDur?.m || 30);
  const minDoDia = (m, data) => (m.slice(0, 10) < data ? 0 : m.slice(0, 10) > data ? 1440 : horaParaMin(m.slice(11)));
  const agsPor = {};
  for (const a of ags.results) (agsPor[`${a.barbeiro_id}|${a.data}`] ||= []).push(a);
  const hoje = hojeBrasil();
  const agoraMin = (() => { const x = new Date(Date.now() - 3 * 3600 * 1000); return x.getUTCHours() * 60 + x.getUTCMinutes(); })();
  const dias = [];
  for (let d = ini; d <= fim; d = somarDias(d, 1)) {
    let total = 0, livre = 0, maior = 0, agendados = 0, trabalham = 0, livres = 0;
    for (const p of profs) {
      const janela = janelaDoDia(regras(d, p.id));
      const doDia = agsPor[`${p.id}|${d}`] || [];
      agendados += doDia.length;
      if (!janela) continue;
      trabalham++;
      const ocup = [
        ...doDia.map(a => [horaParaMin(a.inicio.slice(11)), horaParaMin(a.fim.slice(11))]),
        ...blqs.results.filter(b => b.barbeiro_id === p.id && b.inicio.slice(0, 10) <= d && b.fim.slice(0, 10) >= d).map(b => [minDoDia(b.inicio, d), minDoDia(b.fim, d)])
      ];
      const l = livreNaJanela(janela, ocup);
      total += l.totalMin; livre += l.livreMin; maior = Math.max(maior, l.maiorLivreMin);
      livres += iniciosLivres(janela, [...ocup.map(([i, f]) => ({ ini: i, fim: f })), ...(janela.intervalo ? [{ ini: janela.intervalo[0], fim: janela.intervalo[1] }] : [])],
        duracaoMinima, d, hoje, agoraMin).length;
    }
    const status = !trabalham ? "fechado" : maior < duracaoMinima ? "cheio" : livre / Math.max(total, 1) < 0.34 ? "poucos" : "livre";
    const esp = regras(d, null).func?.especial;
    dias.push({ data: d, status, passado: d < hoje, livreMin: livre, totalMin: total, agendados, horariosLivres: Math.floor(livre / duracaoMinima), livres, ...(esp ? { especial: esp.motivo } : {}) });
  }
  return json({ inicio: ini, fim, duracaoMinima, profissionais: profs.map(p => ({ id: p.id, nome: p.nome })), dias });
}

// ---------- ATENDIMENTO SEM HORÁRIO (lançado no caixa): registra e já finaliza ----------
export async function atendimentoAvulso(ctx) {
  const { db, user, request } = ctx;
  const input = await readJson(request);
  if (!validId(input.barbeiroId)) erro("Escolha o profissional que atendeu.");
  const prof = await db.prepare("SELECT id, nome, perfil, ativo FROM usuarios WHERE id = ? AND barbearia_id = ?").bind(input.barbeiroId, ctx.barbeariaId).first();
  if (!prof) erro("Profissional não encontrado.", 404);
  if (!atende(prof.perfil) || !prof.ativo) erro("Escolha um gerente ou barbeiro ativo.");
  const itens = Array.isArray(input.itens) ? input.itens : erro("Escolha os serviços.");
  const servs = await servicosEscolhidos(ctx, itens.map(i => i?.servicoId));
  const total = itens.reduce((t, i) => t + (validCentavos(i.precoCobradoCentavos) ? i.precoCobradoCentavos : erro("Valor cobrado inválido.")) * (i.quantidade ?? 1), 0);
  // confere antes de gravar (com produtos, a soma é conferida na cobrança: serviços + produtos)
  const temProdutos = Array.isArray(input.produtos) && input.produtos.length > 0;
  const pagConf = temProdutos ? (Array.isArray(input.pagamentos) ? input.pagamentos : []) : lerPagamentos(input.pagamentos, total, { promissoria: true });
  // Promissória no atendimento sem horário: só com cliente escolhido da base (não cria cliente na hora).
  if (pagConf.some(p => p.forma === "promissoria") && !(input.cliente && input.cliente.id !== undefined)) erro(MSG_NOTA_CADASTRO);
  await caixaParaLancar(ctx, "O caixa de hoje não está aberto.");
  // horário = agora (Brasília), arredondado para 5 min
  const agora = new Date(Date.now() - 3 * 3600000);
  const dur = servs.reduce((t, x) => t + x.duracao_min, 0);
  let ini = Math.floor((agora.getUTCHours() * 60 + agora.getUTCMinutes()) / 5) * 5;
  if (ini + dur > 1440) ini = 1440 - dur;
  const data = hojeBrasil();
  const comandos = [];
  const cliente = await clienteDaMarcacao(ctx, input.cliente, comandos, "caixa");
  const id = crypto.randomUUID();
  comandos.push(
    db.prepare(`INSERT INTO agendamentos (id, barbearia_id, barbeiro_id, cliente_id, data, inicio, fim, observacao, criado_por) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(id, ctx.barbeariaId, prof.id, cliente.id, data, momento(data, ini), momento(data, ini + dur), "Atendimento sem horário marcado (lançado no caixa)", user.id),
    ...servs.map(sv => db.prepare("INSERT INTO agendamento_servicos (id, barbearia_id, agendamento_id, servico_id, nome, duracao_min) VALUES (?, ?, ?, ?, ?, ?)")
      .bind(crypto.randomUUID(), ctx.barbeariaId, id, sv.id, sv.nome, sv.duracao_min)),
    auditoria(ctx, "atendimento_sem_horario", id, { barbeiro: prof.id, cliente: cliente.id, servicos: servs.map(x => x.nome) })
  );
  await db.batch(comandos);
  try {
    return await finalizarDados(ctx, { id, itens, pagamentos: input.pagamentos, ...(temProdutos ? { produtos: input.produtos } : {}) });
  } catch (e) {
    // não deixa um "agendado" solto se a cobrança falhar
    await db.prepare("UPDATE agendamentos SET situacao = 'cancelado', motivo = ? WHERE id = ? AND situacao = 'agendado'").bind("Cobrança não concluída no caixa", id).run();
    throw e;
  }
}

export async function rotasAgenda(ctx, path, method) {
  if (path !== "/agenda" && !path.startsWith("/agenda/")) return null;
  exigirAgenda(ctx);
  // Caixa: cobra pela tela do caixa; não reabre atendimento nem bloqueia agenda de profissional.
  if (ctx.user.perfil === "caixa" && ["/agenda/finalizar", "/agenda/reabrir", "/agenda/bloqueios", "/agenda/bloqueios/cancelar"].includes(path)) erro("Sem permissão", 403);
  if (path === "/agenda" && method === "GET") return listarAgenda(ctx);
  if (path === "/agenda/ocupacao" && method === "GET") return ocupacao(ctx);
  if (path === "/agenda/disponibilidade" && method === "GET") return disponibilidade(ctx);
  if (path === "/agenda" && method === "POST") return marcar(ctx);
  if (path === "/agenda/cliente" && method === "GET") return clientePorTelefone(ctx);
  if (path === "/agenda/clientes" && method === "GET") return buscarClientes(ctx);
  if (path === "/agenda/finalizar" && method === "POST") return finalizar(ctx);
  if (path === "/agenda/reabrir" && method === "POST") return reabrir(ctx);
  if (path === "/agenda/situacao" && method === "POST") return mudarSituacao(ctx);
  if (path === "/agenda/remarcar" && method === "POST") return remarcar(ctx);
  if (path === "/agenda/editar" && method === "POST") return editar(ctx);
  if (path === "/agenda/serie/editar" && method === "POST") return editarSerie(ctx);
  if (path === "/agenda/desfazer" && method === "POST") return desfazer(ctx);
  if (path === "/agenda/excluir" && method === "POST") return excluir(ctx);
  if (path === "/agenda/mensagem" && method === "POST") return registrarMensagem(ctx);
  if (path === "/agenda/bloqueios" && method === "POST") return bloquear(ctx);
  if (path === "/agenda/bloqueios/cancelar" && method === "POST") return cancelarBloqueio(ctx);
  return fail("Rota não encontrada", 404);
}

