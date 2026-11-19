// Pagamento da equipe (pedido de 17/11/2026): por mês, para cada pessoa da equipe — produção (o que atendeu e vendeu),
// comissão, salário fixo, vales — e quanto falta pagar. "Pagar" registra tudo de uma vez:
//   • salário do mês → vira uma DESPESA paga ligada à pessoa (contas + contas_pessoal): entra sozinha no relatório
//     financeiro, no resultado e no relatório do contador;
//   • comissões ainda não fechadas do mês, menos os vales → um fechamento de comissão dessa pessoa, já pago;
//   • fechamentos do mês que estavam "a pagar" → pagos.
// "Com dinheiro do caixa" vira sangria do caixa de hoje (como em contas e comissões). Só proprietário e gerente.
import { json, HttpError, readJson, validId, validCentavos, auditoria, hojeBrasil } from "./util.js";
import { exigirGestao } from "./usuarios.js";
import { somarDias } from "./agenda-util.js";
import { dadosPeriodo, somarMes } from "./gestao.js";
import { sangriaAutomatica } from "./caixa.js";
import { podeGerenciarPerfil, atende } from "./perfis.js";

const erro = (msg, status = 400) => { throw new HttpError(msg, status); };
const reais = c => `R$ ${(c / 100).toFixed(2).replace(".", ",").replace(/\B(?=(\d{3})+(?!\d))/g, ".")}`;
const soma = (l, c = "valor_centavos") => l.reduce((t, x) => t + Number(x[c] || 0), 0);
const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
export const NOME_FORMAS_PAGAMENTO = ["dinheiro", "pix", "debito", "credito", "boleto", "transferencia"];

function lerMes(v) {
  const mes = v || hojeBrasil().slice(0, 7);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(mes)) erro("Mês inválido (AAAA-MM).");
  if (mes > hojeBrasil().slice(0, 7)) erro("Esse mês ainda não começou.");
  return mes;
}
const periodoDoMes = mes => ({ ini: `${mes}-01`, fim: somarDias(somarMes(`${mes}-01`, 1), -1) });

// Calcula o quadro do mês (todas as pessoas, ou só uma).
export async function quadroEquipe(ctx, mes, usuarioId = null) {
  const { db } = ctx;
  const b = ctx.barbeariaId;
  const { ini, fim } = periodoDoMes(mes);
  const [d, pessoas, fechados, fechamentos, salarios, pagos] = await Promise.all([
    dadosPeriodo(db, b, ini, fim),
    db.prepare(`SELECT id, nome, perfil, ativo, comissao_servico_bp, comissao_produto_bp FROM usuarios WHERE barbearia_id = ? AND perfil IN ('proprietario','gerente','barbeiro','caixa')
                ${usuarioId ? "AND id = ?" : ""} ORDER BY ativo DESC, CASE perfil WHEN 'proprietario' THEN 0 WHEN 'gerente' THEN 1 WHEN 'barbeiro' THEN 2 ELSE 3 END, nome`)
      .bind(b, ...(usuarioId ? [usuarioId] : [])).all(),
    db.prepare("SELECT tipo, ref_id FROM fechamento_comissao_itens WHERE barbearia_id = ?").bind(b).all(),
    db.prepare(`SELECT * FROM fechamentos_comissao WHERE barbearia_id = ? AND data_fim >= ? AND data_ini <= ? ORDER BY data_ini`).bind(b, ini, fim).all(),
    db.prepare("SELECT usuario_id, salario_centavos FROM usuarios_salarios WHERE barbearia_id = ?").bind(b).all(),
    db.prepare(`SELECT cp.usuario_id, k.id, k.valor_centavos, k.pago_em, k.caixa_movimento_id FROM contas_pessoal cp JOIN contas k ON k.id = cp.conta_id
                WHERE cp.barbearia_id = ? AND cp.competencia = ? AND k.situacao = 'paga'`).bind(b, mes).all()
  ]);
  const fechado = new Set(fechados.results.map(x => `${x.tipo}:${x.ref_id}`));
  const salarioDe = Object.fromEntries(salarios.results.map(s => [s.usuario_id, Number(s.salario_centavos)]));
  const linhas = pessoas.results.map(p => {
    const at = d.atendimentos.filter(a => a.barbeiro_id === p.id);
    const vd = d.vendas.filter(v => v.vendedor_id === p.id);
    const cs = d.comissoesServico.filter(c => c.barbeiro_id === p.id);
    const cpd = d.comissoesProduto.filter(c => c.barbeiro_id === p.id);
    const vl = d.vales.filter(v => v.barbeiro_id === p.id);
    const livres = {
      servico: cs.filter(c => !fechado.has(`servico:${c.id}`)), produto: cpd.filter(c => !fechado.has(`produto:${c.id}`)),
      vales: vl.filter(v => !fechado.has(`vale:${v.id}`))
    };
    const fechs = fechamentos.results.filter(f => f.barbeiro_id === p.id);
    const pendentes = fechs.filter(f => !f.pago_em);
    const salario = salarioDe[p.id] || 0;
    const salPago = pagos.results.find(x => x.usuario_id === p.id) || null;
    const comLivre = soma(livres.servico) + soma(livres.produto);
    const valesLivres = soma(livres.vales);
    const salarioAPagar = salPago ? 0 : salario;
    const comissaoAPagar = comLivre - valesLivres + soma(pendentes, "a_pagar_centavos");
    const comissaoTotal = soma(cs) + soma(cpd);
    // dias trabalhados = dias com atendimento ou venda dele (dia do caixa)
    const dias = new Set([...at.map(a => a.data), ...vd.map(v => v.data)]);
    const totalProd = soma(at, "total_centavos") + soma(vd, "total_centavos");
    return {
      id: p.id, nome: p.nome, perfil: p.perfil, ativo: Boolean(p.ativo),
      comissaoServicoBp: Number(p.comissao_servico_bp || 0), comissaoProdutoBp: Number(p.comissao_produto_bp || 0),
      producao: { atendimentosQtd: at.length, servicosCentavos: soma(at, "total_centavos"), produtosCentavos: soma(vd, "total_centavos"),
        totalCentavos: totalProd, vendasQtd: vd.length, unidadesVendidas: soma(vd, "unidades"), diasTrabalhados: dias.size,
        ticketMedioCentavos: at.length ? Math.round(soma(at, "total_centavos") / at.length) : 0,
        mediaPorDiaCentavos: dias.size ? Math.round(totalProd / dias.size) : 0 },
      comissao: { servicoCentavos: soma(cs), produtoCentavos: soma(cpd), totalCentavos: comissaoTotal,
        abertaCentavos: comLivre, fechadaAPagarCentavos: soma(pendentes, "a_pagar_centavos"), pagaCentavos: soma(fechs.filter(f => f.pago_em), "a_pagar_centavos") },
      vales: { totalCentavos: soma(vl), aDescontarCentavos: valesLivres, qtd: vl.length },
      salario: { valorCentavos: salario, pago: salPago ? { contaId: salPago.id, valorCentavos: salPago.valor_centavos, em: salPago.pago_em, comCaixa: Boolean(salPago.caixa_movimento_id) } : null },
      aPagar: { salarioCentavos: salarioAPagar, comissaoCentavos: comissaoAPagar, totalCentavos: salarioAPagar + comissaoAPagar },
      custoCentavos: (salPago ? salPago.valor_centavos : salario) + comissaoTotal,
      _livres: livres, _pendentes: pendentes, _at: at, _vd: vd, _fechs: fechs
    };
  }).filter(x => x.ativo || x.producao.totalCentavos || x.comissao.totalCentavos || x.vales.totalCentavos || x.salario.pago);
  return { mes, ini, fim, linhas };
}

const publico = x => { const { _livres, _pendentes, _at, _vd, _fechs, ...r } = x; return r; };

// Panorama de UMA pessoa no mês (pedido de 17/11/2026): desempenho completo + pagamento + comparação com o mês anterior.
async function panoramaPessoa(ctx, usuarioId, mes) {
  const { db } = ctx;
  const b = ctx.barbeariaId;
  const mesAnt = somarMes(`${mes}-01`, -1).slice(0, 7);
  const { ini, fim } = periodoDoMes(mes);
  const [atual, anterior, servicos, faltas, clientes] = await Promise.all([
    quadroEquipe(ctx, mes, usuarioId),
    quadroEquipe(ctx, mesAnt, usuarioId),
    db.prepare(`SELECT i.nome, COUNT(*) AS qtd, SUM(i.preco_cobrado_centavos) AS total FROM finalizacao_itens i
                JOIN finalizacoes f ON f.id = i.finalizacao_id JOIN caixas c ON c.id = f.caixa_id
                WHERE f.barbearia_id = ? AND f.barbeiro_id = ? AND f.estornada = 0 AND c.data BETWEEN ? AND ?
                GROUP BY i.nome ORDER BY total DESC LIMIT 6`).bind(b, usuarioId, ini, fim).all(),
    db.prepare(`SELECT SUM(situacao = 'faltou') AS faltou, SUM(situacao = 'cancelado') AS cancelado FROM agendamentos
                WHERE barbearia_id = ? AND barbeiro_id = ? AND data BETWEEN ? AND ?`).bind(b, usuarioId, ini, fim).first(),
    db.prepare(`SELECT COUNT(DISTINCT a.cliente_id) AS n FROM finalizacoes f JOIN agendamentos a ON a.id = f.agendamento_id JOIN caixas c ON c.id = f.caixa_id
                WHERE f.barbearia_id = ? AND f.barbeiro_id = ? AND f.estornada = 0 AND c.data BETWEEN ? AND ?`).bind(b, usuarioId, ini, fim).first()
  ]);
  const p = atual.linhas[0];
  if (!p) erro("Pessoa não encontrada.", 404);
  const ant = anterior.linhas[0] || null;
  // produção por dia do mês (serviços + produtos), para o gráfico
  const porDia = {};
  for (let x = ini; x <= fim; x = somarDias(x, 1)) porDia[x] = { data: x, servicosCentavos: 0, produtosCentavos: 0, atendimentos: 0 };
  for (const a of p._at) { porDia[a.data].servicosCentavos += Number(a.total_centavos); porDia[a.data].atendimentos++; }
  for (const v of p._vd) porDia[v.data].produtosCentavos += Number(v.total_centavos);
  const dias = Object.values(porDia);
  const melhor = dias.reduce((m, x) => (x.servicosCentavos + x.produtosCentavos > (m ? m.servicosCentavos + m.produtosCentavos : 0) ? x : m), null);
  return {
    mes, titulo: `${MESES[Number(mes.slice(5)) - 1]} de ${mes.slice(0, 4)}`, pessoa: publico(p),
    indicadores: {
      clientesAtendidos: Number(clientes?.n || 0), faltas: Number(faltas?.faltou || 0), cancelados: Number(faltas?.cancelado || 0),
      melhorDia: melhor ? { data: melhor.data, totalCentavos: melhor.servicosCentavos + melhor.produtosCentavos, atendimentos: melhor.atendimentos } : null
    },
    porDia: dias,
    servicos: servicos.results.map(s => ({ nome: s.nome, qtd: Number(s.qtd), totalCentavos: Number(s.total) })),
    anterior: ant ? { mes: mesAnt, producaoCentavos: ant.producao.totalCentavos, atendimentosQtd: ant.producao.atendimentosQtd,
      comissaoCentavos: ant.comissao.totalCentavos, diasTrabalhados: ant.producao.diasTrabalhados } : null,
    pagamentos: [
      ...(p.salario.pago ? [{ tipo: "Salário", valorCentavos: p.salario.pago.valorCentavos, em: p.salario.pago.em }] : []),
      ...p._fechs.filter(f => f.pago_em).map(f => ({ tipo: `Comissão ${f.data_ini.split("-").reverse().slice(0, 2).join("/")} a ${f.data_fim.split("-").reverse().slice(0, 2).join("/")}`, valorCentavos: f.a_pagar_centavos, em: f.pago_em }))
    ]
  };
}

async function pagar(ctx) {
  const { db, user } = ctx;
  const input = await readJson(ctx.request);
  if (!validId(input.usuarioId)) erro("Escolha a pessoa da equipe.");
  const mes = lerMes(input.mes);
  if (input.forma !== undefined && input.forma !== null && !NOME_FORMAS_PAGAMENTO.includes(input.forma)) erro("Forma de pagamento inválida.");
  const comCaixa = input.comCaixa === true;
  if (comCaixa && input.forma && input.forma !== "dinheiro") erro("Dinheiro do caixa só vale para pagamento em dinheiro.");
  const { linhas, ini, fim } = await quadroEquipe(ctx, mes, input.usuarioId);
  const p = linhas[0];
  if (!p) erro("Pessoa não encontrada.", 404);
  if (p.aPagar.totalCentavos <= 0 && !p.aPagar.salarioCentavos && !p._livres.vales.length && !p._pendentes.length) erro("Nada a pagar para essa pessoa neste mês.", 409);
  const hoje = hojeBrasil();
  const titulo = `${MESES[Number(mes.slice(5)) - 1]}/${mes.slice(0, 4)}`;
  const comandos = [];
  const feito = [];

  // 1) Salário do mês → despesa paga, ligada à pessoa
  if (p.aPagar.salarioCentavos > 0) {
    const contaId = crypto.randomUUID();
    let movId = null;
    if (comCaixa) {
      const s = await sangriaAutomatica(ctx, p.aPagar.salarioCentavos, `Conta paga: Salário ${p.nome} (${titulo})`);
      movId = s.id; comandos.push(s.comando);
    }
    comandos.push(
      db.prepare(`INSERT INTO contas (id, barbearia_id, descricao, categoria, valor_centavos, vencimento, recorrente, situacao, pago_em, pago_por, caixa_movimento_id, criado_por)
                  SELECT ?, ?, ?, 'outros', ?, ?, 0, 'paga', ?, ?, ?, ?
                  WHERE NOT EXISTS (SELECT 1 FROM contas_pessoal cp JOIN contas k ON k.id = cp.conta_id WHERE cp.usuario_id = ? AND cp.competencia = ? AND k.situacao = 'paga')`)
        .bind(contaId, ctx.barbeariaId, `Salário ${p.nome} (${titulo})`.slice(0, 100), p.aPagar.salarioCentavos, hoje, hoje, user.id, movId, user.id, p.id, mes),
      db.prepare("INSERT INTO contas_pessoal (conta_id, barbearia_id, usuario_id, competencia) SELECT ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM contas WHERE id = ?)")
        .bind(contaId, ctx.barbeariaId, p.id, mes, contaId),
      ...(input.forma ? [db.prepare("INSERT INTO contas_detalhes (conta_id, barbearia_id, forma) SELECT ?, ?, ? WHERE EXISTS (SELECT 1 FROM contas WHERE id = ?)")
        .bind(contaId, ctx.barbeariaId, input.forma, contaId)] : []),
      auditoria(ctx, "salario_pago", p.id, { mes, valor: p.aPagar.salarioCentavos, conta: contaId, comCaixa, forma: input.forma || null })
    );
    feito.push(`salário ${reais(p.aPagar.salarioCentavos)}`);
  }

  // 2) Comissões ainda não fechadas no mês (− vales) → fechamento dessa pessoa, já pago
  const L = p._livres;
  const totalComissaoNova = soma(L.servico) + soma(L.produto) - soma(L.vales);
  let fechNovo = null;
  if (L.servico.length || L.produto.length || L.vales.length) {
    fechNovo = crypto.randomUUID();
    const fimFech = fim < hoje ? fim : hoje;
    comandos.push(
      db.prepare(`INSERT INTO fechamentos_comissao (id, barbearia_id, barbeiro_id, data_ini, data_fim, comissao_servico_centavos, comissao_produto_centavos,
                    vales_centavos, a_pagar_centavos, pago_em, pago_por, pago_com_caixa, criado_por) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(fechNovo, ctx.barbeariaId, p.id, ini, fimFech, soma(L.servico), soma(L.produto), soma(L.vales), totalComissaoNova, hoje, user.id, comCaixa ? 1 : 0, user.id),
      ...[...L.servico.map(c => ["servico", c]), ...L.produto.map(c => ["produto", c]), ...L.vales.map(v => ["vale", v])].map(([tipo, x]) =>
        db.prepare("INSERT INTO fechamento_comissao_itens (fechamento_id, barbearia_id, tipo, ref_id, valor_centavos) VALUES (?, ?, ?, ?, ?)")
          .bind(fechNovo, ctx.barbeariaId, tipo, x.id, x.valor_centavos)),
      auditoria(ctx, "comissao_fechada", fechNovo, { barbeiro: p.id, periodo: [ini, fimFech], aPagar: totalComissaoNova, pagoJunto: true, origem: "pagamento_equipe" })
    );
  }
  // 3) Fechamentos do mês que estavam "a pagar"
  for (const f of p._pendentes) {
    comandos.push(
      db.prepare("UPDATE fechamentos_comissao SET pago_em = ?, pago_por = ?, pago_com_caixa = ? WHERE id = ? AND barbearia_id = ? AND pago_em IS NULL")
        .bind(hoje, user.id, comCaixa ? 1 : 0, f.id, ctx.barbeariaId),
      auditoria(ctx, "comissao_paga", f.id, { valor: f.a_pagar_centavos, comCaixa, origem: "pagamento_equipe" }));
  }
  const comissaoPaga = totalComissaoNova + soma(p._pendentes, "a_pagar_centavos");
  if (comCaixa && comissaoPaga > 0) {
    comandos.push((await sangriaAutomatica(ctx, comissaoPaga, `Comissão paga: ${p.nome} (${titulo})`)).comando);
  }
  if (fechNovo || p._pendentes.length) feito.push(`comissão ${reais(comissaoPaga)}`);
  try {
    await db.batch(comandos);
  } catch (e) {
    if (/UNIQUE|constraint/i.test(String(e?.message))) erro("Outro pagamento acabou de ser feito. Atualize a tela.", 409);
    throw e;
  }
  return json({ mensagem: `Pagamento de ${p.nome} registrado (${feito.join(" + ")}).`, totalCentavos: p.aPagar.salarioCentavos + comissaoPaga });
}

export async function rotasEquipe(ctx, path, method) {
  if (!path.startsWith("/equipe/")) return null;
  // Minha produção (19/11/2026): quem atende vê SÓ a própria produção e comissão do mês (sempre o usuário da sessão).
  if (path === "/equipe/minha-producao" && method === "GET") {
    if (!atende(ctx.user.perfil)) erro("Sem permissão", 403);
    const r = await panoramaPessoa(ctx, ctx.user.id, lerMes(new URL(ctx.request.url).searchParams.get("mes")));
    const { custoCentavos, ...pessoa } = r.pessoa;   // custo para a barbearia é assunto da gestão
    void custoCentavos;
    return json({ ...r, pessoa });
  }
  exigirGestao(ctx);
  if (path === "/equipe/pagamento" && method === "GET") {
    const mes = lerMes(new URL(ctx.request.url).searchParams.get("mes"));
    const q = await quadroEquipe(ctx, mes);
    const linhas = q.linhas.map(publico);
    const t = k => linhas.reduce((s, x) => s + k(x), 0);
    return json({
      mes, titulo: `${MESES[Number(mes.slice(5)) - 1]} de ${mes.slice(0, 4)}`, ini: q.ini, fim: q.fim, pessoas: linhas,
      totais: {
        producaoCentavos: t(x => x.producao.totalCentavos), comissaoCentavos: t(x => x.comissao.totalCentavos),
        salariosCentavos: t(x => x.salario.pago ? x.salario.pago.valorCentavos : x.salario.valorCentavos),
        valesCentavos: t(x => x.vales.totalCentavos), aPagarCentavos: t(x => Math.max(0, x.aPagar.totalCentavos)), custoCentavos: t(x => x.custoCentavos),
        pagoCentavos: t(x => (x.salario.pago ? x.salario.pago.valorCentavos : 0) + x.comissao.pagaCentavos),
        atendimentosQtd: t(x => x.producao.atendimentosQtd)
      }
    });
  }
  if (path === "/equipe/pagar" && method === "POST") return pagar(ctx);
  if (path === "/equipe/pessoa" && method === "GET") {
    const url = new URL(ctx.request.url);
    const id = url.searchParams.get("id");
    if (!validId(id)) erro("Pessoa inválida.");
    return json(await panoramaPessoa(ctx, id, lerMes(url.searchParams.get("mes"))));
  }
  // Salário fixo: proprietário define de todos (inclusive o próprio pró-labore); gerente define de barbeiro e caixa.
  if (path === "/equipe/salario" && method === "POST") {
    const input = await readJson(ctx.request);
    if (!validId(input.usuarioId)) erro("Pessoa inválida.");
    if (!validCentavos(input.salarioCentavos) || input.salarioCentavos < 0) erro("Salário inválido.");
    const alvo = await ctx.db.prepare("SELECT id, nome, perfil FROM usuarios WHERE id = ? AND barbearia_id = ?").bind(input.usuarioId, ctx.barbeariaId).first();
    if (!alvo) erro("Pessoa não encontrada.", 404);
    const pode = ctx.user.perfil === "proprietario" || (alvo.id !== ctx.user.id && podeGerenciarPerfil(ctx.user, alvo.perfil));
    if (!pode) erro("Só o dono define o salário de gerentes.", 403);
    const antes = await ctx.db.prepare("SELECT salario_centavos FROM usuarios_salarios WHERE usuario_id = ?").bind(alvo.id).first();
    await ctx.db.batch([
      ctx.db.prepare(`INSERT INTO usuarios_salarios (usuario_id, barbearia_id, salario_centavos, atualizado_por) VALUES (?, ?, ?, ?)
                      ON CONFLICT(usuario_id) DO UPDATE SET salario_centavos = excluded.salario_centavos, atualizado_em = CURRENT_TIMESTAMP, atualizado_por = excluded.atualizado_por`)
        .bind(alvo.id, ctx.barbeariaId, input.salarioCentavos, ctx.user.id),
      auditoria(ctx, "salario_alterado", alvo.id, { antes: { salario: antes ? Number(antes.salario_centavos) : 0 }, depois: { salario: input.salarioCentavos } })
    ]);
    return json({ mensagem: `Salário de ${alvo.nome} salvo.` });
  }
  return null;
}
