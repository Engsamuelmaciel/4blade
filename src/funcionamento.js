// Funcionamento da barbearia (seção 4.9), datas fechadas e horário de trabalho de quem atende.
import { json, fail, readJson, validId, exigirMotivo, auditoria, hojeBrasil } from "./util.js";
import { isGestao, atende } from "./perfis.js";
import { exigirBarbearia, exigirGestao } from "./usuarios.js";
import {
  horaParaMin, minParaHora, exigirData, NOME_DIA, carregarModelos, linksWhatsapp
} from "./agenda-util.js";

function diaPublico(dia, f) {
  return {
    dia,
    aberto: Boolean(f?.aberto),
    abre: minParaHora(f?.abre_min ?? null),
    fecha: minParaHora(f?.fecha_min ?? null),
    intervaloIni: minParaHora(f?.intervalo_ini_min ?? null),
    intervaloFim: minParaHora(f?.intervalo_fim_min ?? null)
  };
}

// Lê os 7 dias enviados pela tela. Devolve linhas prontas para o banco ou lança erro com mensagem clara.
function lerDias(dias, { campoAberto, campoIni, campoFim, comIntervalo }) {
  if (!Array.isArray(dias) || dias.length !== 7) throw new Error("Envie os 7 dias da semana.");
  const vistos = new Set();
  return dias.map(d => {
    if (!d || !Number.isInteger(d.dia) || d.dia < 0 || d.dia > 6 || vistos.has(d.dia)) throw new Error("Dia da semana inválido.");
    vistos.add(d.dia);
    const nome = NOME_DIA[d.dia];
    if (typeof d[campoAberto] !== "boolean") throw new Error(`Informe se ${nome} está aberto/trabalha.`);
    if (!d[campoAberto]) return { dia: d.dia, ativo: 0, ini: null, fim: null, intIni: null, intFim: null };
    const ini = horaParaMin(d[campoIni]);
    const fim = horaParaMin(d[campoFim]);
    if (ini === null || fim === null || ini >= fim) throw new Error(`Horário de ${nome} inválido: o início precisa ser antes do fim.`);
    let intIni = null;
    let intFim = null;
    if (comIntervalo && (d.intervaloIni || d.intervaloFim)) {
      intIni = horaParaMin(d.intervaloIni);
      intFim = horaParaMin(d.intervaloFim);
      if (intIni === null || intFim === null || intIni >= intFim || intIni <= ini || intFim >= fim) {
        throw new Error(`Intervalo de ${nome} inválido: precisa ficar dentro do horário (ex.: 12:00 às 13:00).`);
      }
    }
    return { dia: d.dia, ativo: 1, ini, fim, intIni, intFim };
  }).sort((a, b) => a.dia - b.dia);
}

// Horários agendados (ainda não atendidos) dentro de um período: para avisar e remarcar.
export async function agendadosNoPeriodo(ctx, dataIni, dataFim) {
  const r = await ctx.db.prepare(`
    SELECT a.id, a.data, a.inicio, a.fim, a.barbeiro_id, u.nome AS barbeiro_nome,
           c.nome AS cliente_nome, c.telefone AS cliente_telefone,
           (SELECT group_concat(nome, ' + ') FROM (SELECT nome FROM agendamento_servicos s WHERE s.agendamento_id = a.id AND NOT EXISTS (SELECT 1 FROM agendamento_servicos_removidos rm WHERE rm.linha_id = s.id) ORDER BY s.rowid)) AS servicos_nomes
    FROM agendamentos a
    JOIN usuarios u ON u.id = a.barbeiro_id
    JOIN clientes c ON c.id = a.cliente_id
    WHERE a.barbearia_id = ? AND a.situacao = 'agendado' AND a.data BETWEEN ? AND ?
    ORDER BY a.inicio
  `).bind(ctx.barbeariaId, dataIni, dataFim).all();
  const modelos = await carregarModelos(ctx.db, ctx.barbeariaId);
  return r.results.map(a => ({
    id: a.id, data: a.data, hora: a.inicio.slice(11), barbeiro: a.barbeiro_nome, cliente: a.cliente_nome,
    servicos: a.servicos_nomes, whatsapp: linksWhatsapp(a, modelos, ctx.user.barbearia_nome)
  }));
}

export async function rotasFuncionamento(ctx, path, method) {
  const { db, request, user } = ctx;

  if (path === "/funcionamento" && method === "GET") {
    exigirBarbearia(ctx);
    const [f, d] = await Promise.all([
      db.prepare("SELECT * FROM funcionamento WHERE barbearia_id = ?").bind(ctx.barbeariaId).all(),
      db.prepare(`SELECT id, data_ini, data_fim, motivo FROM datas_fechadas
                  WHERE barbearia_id = ? AND ativo = 1 AND data_fim >= ? ORDER BY data_ini`).bind(ctx.barbeariaId, hojeBrasil()).all()
    ]);
    const porDia = Object.fromEntries(f.results.map(x => [x.dia_semana, x]));
    return json({
      configurado: f.results.length === 7,
      dias: [0, 1, 2, 3, 4, 5, 6].map(i => diaPublico(i, porDia[i])),
      datasFechadas: d.results.map(x => ({ id: x.id, dataIni: x.data_ini, dataFim: x.data_fim, motivo: x.motivo }))
    });
  }

  if (path === "/funcionamento/salvar" && method === "POST") {
    exigirGestao(ctx);
    const input = await readJson(request);
    let linhas;
    try {
      linhas = lerDias(input.dias, { campoAberto: "aberto", campoIni: "abre", campoFim: "fecha", comIntervalo: true });
    } catch (e) { return fail(e.message); }

    // O horário de cada profissional precisa continuar DENTRO do funcionamento.
    const trab = await db.prepare(`
      SELECT h.*, u.nome FROM horario_trabalho h JOIN usuarios u ON u.id = h.usuario_id
      WHERE h.barbearia_id = ? AND h.trabalha = 1 AND u.ativo = 1
    `).bind(ctx.barbeariaId).all();
    for (const t of trab.results) {
      const l = linhas[t.dia_semana];
      if (!l.ativo || t.ini_min < l.ini || t.fim_min > l.fim) {
        return fail(`${t.nome} trabalha às ${NOME_DIA[t.dia_semana]}s das ${minParaHora(t.ini_min)} às ${minParaHora(t.fim_min)}, fora do novo funcionamento. Ajuste o horário dele(a) antes (Equipe → Horário).`, 409);
      }
    }

    const antes = await db.prepare("SELECT * FROM funcionamento WHERE barbearia_id = ? ORDER BY dia_semana").bind(ctx.barbeariaId).all();
    await db.batch([
      ...linhas.map(l => db.prepare(`
        INSERT INTO funcionamento (barbearia_id, dia_semana, aberto, abre_min, fecha_min, intervalo_ini_min, intervalo_fim_min)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(barbearia_id, dia_semana) DO UPDATE SET aberto = excluded.aberto, abre_min = excluded.abre_min,
          fecha_min = excluded.fecha_min, intervalo_ini_min = excluded.intervalo_ini_min,
          intervalo_fim_min = excluded.intervalo_fim_min, atualizado_em = CURRENT_TIMESTAMP
      `).bind(ctx.barbeariaId, l.dia, l.ativo, l.ini, l.fim, l.intIni, l.intFim)),
      auditoria(ctx, "funcionamento_alterado", ctx.barbeariaId, {
        antes: antes.results.map(x => diaPublico(x.dia_semana, x)),
        depois: linhas.map(l => diaPublico(l.dia, { aberto: l.ativo, abre_min: l.ini, fecha_min: l.fim, intervalo_ini_min: l.intIni, intervalo_fim_min: l.intFim }))
      })
    ]);
    return json({ mensagem: "Funcionamento salvo." });
  }

  // Antes de fechar um dia/período: quantos horários marcados existem (para remarcar).
  if (path === "/funcionamento/afetados" && method === "GET") {
    exigirGestao(ctx);
    const url = new URL(request.url);
    const ini = exigirData(url.searchParams.get("dataIni"), "Data inicial");
    const fim = exigirData(url.searchParams.get("dataFim") || ini, "Data final");
    if (fim < ini) return fail("A data final precisa ser igual ou depois da inicial.");
    return json({ afetados: await agendadosNoPeriodo(ctx, ini, fim) });
  }

  if (path === "/funcionamento/datas-fechadas" && method === "POST") {
    exigirGestao(ctx);
    const input = await readJson(request);
    const ini = exigirData(input.dataIni, "Data inicial");
    const fim = exigirData(input.dataFim || ini, "Data final");
    if (fim < ini) return fail("A data final precisa ser igual ou depois da inicial.");
    const motivo = exigirMotivo(input.motivo);
    const id = crypto.randomUUID();
    await db.batch([
      db.prepare("INSERT INTO datas_fechadas (id, barbearia_id, data_ini, data_fim, motivo, criado_por) VALUES (?, ?, ?, ?, ?, ?)")
        .bind(id, ctx.barbeariaId, ini, fim, motivo, user.id),
      auditoria(ctx, "data_fechada_criada", id, { depois: { dataIni: ini, dataFim: fim, motivo } })
    ]);
    // Não cancela nada sozinho: devolve a lista para remarcar.
    return json({ dataFechada: { id, dataIni: ini, dataFim: fim, motivo }, afetados: await agendadosNoPeriodo(ctx, ini, fim) }, 201);
  }

  if (path === "/funcionamento/datas-fechadas/desativar" && method === "POST") {
    exigirGestao(ctx);
    const input = await readJson(request);
    if (!validId(input.id)) return fail("Registro inválido.");
    const motivo = exigirMotivo(input.motivo);
    const atual = await db.prepare("SELECT * FROM datas_fechadas WHERE id = ? AND barbearia_id = ? AND ativo = 1").bind(input.id, ctx.barbeariaId).first();
    if (!atual) return fail("Data fechada não encontrada.", 404);
    await db.batch([
      db.prepare("UPDATE datas_fechadas SET ativo = 0, motivo_desativacao = ? WHERE id = ? AND barbearia_id = ?").bind(motivo, atual.id, ctx.barbeariaId),
      auditoria(ctx, "data_fechada_desativada", atual.id, { motivo, antes: { ativo: 1 }, depois: { ativo: 0 } })
    ]);
    return json({ mensagem: "A agenda volta a aceitar horários nesse período." });
  }

  // ---------- horário de trabalho de quem atende ----------
  if (path === "/horarios-trabalho" && method === "GET") {
    exigirBarbearia(ctx);
    const url = new URL(request.url);
    const id = isGestao(user) ? url.searchParams.get("id") : user.id;   // barbeiro só vê o próprio
    if (!validId(id)) return fail("Pessoa inválida.");
    const alvo = await db.prepare("SELECT id, perfil FROM usuarios WHERE id = ? AND barbearia_id = ?").bind(id, ctx.barbeariaId).first();
    if (!alvo) return fail("Pessoa não encontrada.", 404);
    if (!atende(alvo.perfil)) return fail("Só gerente e barbeiro têm horário de trabalho.");
    const r = await db.prepare("SELECT * FROM horario_trabalho WHERE usuario_id = ? AND barbearia_id = ?").bind(id, ctx.barbeariaId).all();
    const porDia = Object.fromEntries(r.results.map(x => [x.dia_semana, x]));
    return json({
      configurado: r.results.length > 0,
      dias: [0, 1, 2, 3, 4, 5, 6].map(i => ({
        dia: i, trabalha: Boolean(porDia[i]?.trabalha), ini: minParaHora(porDia[i]?.ini_min ?? null), fim: minParaHora(porDia[i]?.fim_min ?? null)
      }))
    });
  }

  if (path === "/horarios-trabalho" && method === "POST") {
    exigirGestao(ctx);
    const input = await readJson(request);
    if (!validId(input.id)) return fail("Pessoa inválida.");
    const alvo = await db.prepare("SELECT id, nome, perfil FROM usuarios WHERE id = ? AND barbearia_id = ?").bind(input.id, ctx.barbeariaId).first();
    if (!alvo) return fail("Pessoa não encontrada.", 404);
    if (!atende(alvo.perfil)) return fail("Só gerente e barbeiro têm horário de trabalho.");
    if (alvo.perfil === "gerente" && user.perfil !== "proprietario" && alvo.id !== user.id) return fail("Só o proprietário altera o horário de outro gerente.", 403);
    if (alvo.perfil === "proprietario" && alvo.id !== user.id) return fail("Só o próprio dono altera o horário dele.", 403);
    let linhas;
    try {
      linhas = lerDias(input.dias, { campoAberto: "trabalha", campoIni: "ini", campoFim: "fim", comIntervalo: false });
    } catch (e) { return fail(e.message); }
    const f = await db.prepare("SELECT * FROM funcionamento WHERE barbearia_id = ?").bind(ctx.barbeariaId).all();
    if (f.results.length !== 7) return fail("Cadastre primeiro o funcionamento da barbearia.", 409);
    const func = Object.fromEntries(f.results.map(x => [x.dia_semana, x]));
    for (const l of linhas.filter(x => x.ativo)) {
      const fd = func[l.dia];
      if (!fd.aberto) return fail(`A barbearia não abre às ${NOME_DIA[l.dia]}s.`, 409);
      if (l.ini < fd.abre_min || l.fim > fd.fecha_min) {
        return fail(`Às ${NOME_DIA[l.dia]}s a barbearia funciona das ${minParaHora(fd.abre_min)} às ${minParaHora(fd.fecha_min)}: o horário precisa ficar dentro.`, 409);
      }
    }
    const antesH = await db.prepare("SELECT dia_semana, trabalha, ini_min, fim_min FROM horario_trabalho WHERE usuario_id = ? AND barbearia_id = ? ORDER BY dia_semana")
      .bind(alvo.id, ctx.barbeariaId).all();
    await db.batch([
      ...linhas.map(l => db.prepare(`
        INSERT INTO horario_trabalho (barbearia_id, usuario_id, dia_semana, trabalha, ini_min, fim_min) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(usuario_id, dia_semana) DO UPDATE SET trabalha = excluded.trabalha, ini_min = excluded.ini_min,
          fim_min = excluded.fim_min, atualizado_em = CURRENT_TIMESTAMP
      `).bind(ctx.barbeariaId, alvo.id, l.dia, l.ativo, l.ini, l.fim)),
      auditoria(ctx, "horario_trabalho_alterado", alvo.id, {
        antes: antesH.results.map(x => ({ dia: x.dia_semana, trabalha: Boolean(x.trabalha), ini: minParaHora(x.ini_min), fim: minParaHora(x.fim_min) })),
        depois: linhas.map(l => ({ dia: l.dia, trabalha: Boolean(l.ativo), ini: minParaHora(l.ini), fim: minParaHora(l.fim) }))
      })
    ]);
    return json({ mensagem: `Horário de ${alvo.nome} salvo.` });
  }

  return null;
}

