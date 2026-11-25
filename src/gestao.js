// Gestão (seções 4.5 a 4.8): comissões e vales, fechamento de comissão, contas a pagar, painel do gerente,
// desempenho e extrato do barbeiro. Tudo filtrado pela barbearia da sessão. O dia de um lançamento = dia do caixa.
import { json, fail, HttpError, readJson, validId, validCentavos, validDate, textoLimpo, textoOpcional, exigirMotivo, auditoria, hojeBrasil } from "./util.js";
import { isGestao, atende } from "./perfis.js";
import { exigirBarbearia, exigirGestao } from "./usuarios.js";
import { resumoNotasAbertas } from "./promissorias.js";
import { somarDias } from "./agenda-util.js";
import { sangriaAutomatica } from "./caixa.js";
import { avisosProduto, comandosEntrada } from "./estoque.js";
import { gerarPdf, base64 } from "./pdf.js";
import { gerarCsv, dinheiroCsv, dataCsv } from "./csv.js";

const erro = (msg, status = 400) => { throw new HttpError(msg, status); };
export const CATEGORIAS = { aluguel: "Aluguel", luz: "Luz", agua: "Água", fornecedor: "Fornecedor", outros: "Outros" };
const reais = c => `R$ ${(Number(c) / 100).toFixed(2).replace(".", ",").replace(/\B(?=(\d{3})+(?!\d))/g, ".")}`;
const dataBR = d => (d ? d.slice(0, 10).split("-").reverse().join("/") : "");

// Período do painel: hoje; semana = hoje e os 6 dias anteriores; mês = do dia 1º até hoje.
export function periodo(nome, hoje = hojeBrasil()) {
  if (nome === "semana") return { nome, ini: somarDias(hoje, -6), fim: hoje };
  if (nome === "mes") return { nome, ini: `${hoje.slice(0, 7)}-01`, fim: hoje };
  return { nome: "hoje", ini: hoje, fim: hoje };
}

export function somarMes(data, n = 1) {
  const [a, m, d] = data.split("-").map(Number);
  const alvo = new Date(Date.UTC(a, m - 1 + n, 1));
  const ultimo = new Date(Date.UTC(alvo.getUTCFullYear(), alvo.getUTCMonth() + 1, 0)).getUTCDate();
  alvo.setUTCDate(Math.min(d, ultimo));   // 31/01 + 1 mês = 28 ou 29/02
  return alvo.toISOString().slice(0, 10);
}

export function lerPeriodo(url) {
  const ini = url.searchParams.get("dataIni");
  const fim = url.searchParams.get("dataFim");
  if (!validDate(ini) || !validDate(fim) || fim < ini) erro("Período inválido.");
  return { ini, fim };
}

// ---------- dados por período (base do painel, fechamento, contador e extrato) ----------
export async function dadosPeriodo(db, barbeariaId, ini, fim) {
  const [atend, vendas, comS, comP, vales, contasPagas, fechCaixa, alterados] = await Promise.all([
    db.prepare(`SELECT f.id, f.barbeiro_id, f.total_centavos, f.valor_alterado, c.data, u.nome AS barbeiro,
                  cl.nome AS cliente, (SELECT group_concat(nome, ' + ') FROM (SELECT i.nome FROM finalizacao_itens i WHERE i.finalizacao_id = f.id ORDER BY i.rowid)) AS servicos
                FROM finalizacoes f JOIN caixas c ON c.id = f.caixa_id JOIN usuarios u ON u.id = f.barbeiro_id
                JOIN agendamentos a ON a.id = f.agendamento_id JOIN clientes cl ON cl.id = a.cliente_id
                WHERE f.barbearia_id = ? AND f.estornada = 0 AND c.data BETWEEN ? AND ? ORDER BY c.data, f.criado_em`).bind(barbeariaId, ini, fim).all(),
    db.prepare(`SELECT v.id, v.vendedor_id, v.total_centavos, c.data, u.nome AS vendedor,
                  (SELECT COALESCE(SUM(quantidade * custo_unit_centavos), 0) FROM venda_itens WHERE venda_id = v.id) AS custo,
                  (SELECT COALESCE(SUM(quantidade), 0) FROM venda_itens WHERE venda_id = v.id) AS unidades,
                  (SELECT group_concat(nome, ', ') FROM (SELECT i.quantidade || 'x ' || i.nome AS nome FROM venda_itens i WHERE i.venda_id = v.id ORDER BY i.rowid)) AS itens
                FROM vendas v JOIN caixas c ON c.id = v.caixa_id JOIN usuarios u ON u.id = v.vendedor_id
                WHERE v.barbearia_id = ? AND v.situacao = 'ativa' AND c.data BETWEEN ? AND ? ORDER BY c.data, v.criado_em`).bind(barbeariaId, ini, fim).all(),
    db.prepare(`SELECT cm.id, cm.barbeiro_id, cm.valor_centavos, cm.base_centavos, cm.percentual_bp, c.data, f.id AS finalizacao_id
                FROM comissoes cm JOIN finalizacoes f ON f.id = cm.finalizacao_id JOIN caixas c ON c.id = f.caixa_id
                WHERE cm.barbearia_id = ? AND cm.estornada = 0 AND c.data BETWEEN ? AND ?`).bind(barbeariaId, ini, fim).all(),
    db.prepare(`SELECT cp.id, cp.barbeiro_id, cp.valor_centavos, cp.base_centavos, cp.percentual_bp, c.data, cp.venda_id
                FROM comissoes_produto cp JOIN vendas v ON v.id = cp.venda_id JOIN caixas c ON c.id = v.caixa_id
                WHERE cp.barbearia_id = ? AND cp.estornada = 0 AND c.data BETWEEN ? AND ?`).bind(barbeariaId, ini, fim).all(),
    db.prepare(`SELECT v.*, u.nome AS barbeiro FROM vales v JOIN usuarios u ON u.id = v.barbeiro_id
                WHERE v.barbearia_id = ? AND v.situacao = 'ativo' AND v.data BETWEEN ? AND ? ORDER BY v.data`).bind(barbeariaId, ini, fim).all(),
    db.prepare(`SELECT * FROM contas WHERE barbearia_id = ? AND situacao = 'paga' AND pago_em BETWEEN ? AND ? ORDER BY pago_em`).bind(barbeariaId, ini, fim).all(),
    db.prepare(`SELECT c.data, f.diferenca_centavos, f.observacao FROM caixa_fechamentos f JOIN caixas c ON c.id = f.caixa_id
                WHERE f.barbearia_id = ? AND f.ativo = 1 AND f.diferenca_centavos <> 0 AND c.data BETWEEN ? AND ? ORDER BY c.data`).bind(barbeariaId, ini, fim).all(),
    db.prepare(`SELECT COUNT(*) AS n FROM finalizacoes f JOIN caixas c ON c.id = f.caixa_id
                WHERE f.barbearia_id = ? AND f.estornada = 0 AND f.valor_alterado = 1 AND c.data BETWEEN ? AND ?`).bind(barbeariaId, ini, fim).first()
  ]);
  return {
    atendimentos: atend.results, vendas: vendas.results, comissoesServico: comS.results, comissoesProduto: comP.results,
    vales: vales.results, contasPagas: contasPagas.results, diferencasCaixa: fechCaixa.results, valoresAlterados: Number(alterados.n)
  };
}

const soma = (lista, campo = "valor_centavos") => lista.reduce((t, x) => t + Number(x[campo] || 0), 0);

// Resultado do período: bruto − comissões − custo dos produtos vendidos (− contas pagas, se pedido).
export function resultado(d, { descontarContas }) {
  const atendimentos = soma(d.atendimentos, "total_centavos");
  const vendas = soma(d.vendas, "total_centavos");
  const bruto = atendimentos + vendas;
  const comissoes = soma(d.comissoesServico) + soma(d.comissoesProduto);
  const custoProdutos = soma(d.vendas, "custo");
  const contasPagas = soma(d.contasPagas);
  return {
    brutoCentavos: bruto, atendimentosCentavos: atendimentos, atendimentosQtd: d.atendimentos.length,
    ticketMedioCentavos: d.atendimentos.length ? Math.round(atendimentos / d.atendimentos.length) : 0,
    vendasCentavos: vendas, vendasQtd: d.vendas.length, unidadesVendidas: soma(d.vendas, "unidades"),
    comissoesCentavos: comissoes, custoProdutosCentavos: custoProdutos, contasPagasCentavos: contasPagas,
    lucroCentavos: bruto - comissoes - custoProdutos - (descontarContas ? contasPagas : 0)
  };
}

// Comissões e vales por profissional.
export function porBarbeiro(d, profissionais) {
  return profissionais.map(p => {
    const serv = soma(d.comissoesServico.filter(c => c.barbeiro_id === p.id));
    const prod = soma(d.comissoesProduto.filter(c => c.barbeiro_id === p.id));
    const vales = soma(d.vales.filter(v => v.barbeiro_id === p.id));
    const at = d.atendimentos.filter(a => a.barbeiro_id === p.id);
    return {
      id: p.id, nome: p.nome, atendimentosQtd: at.length, faturamentoCentavos: soma(at, "total_centavos"),
      comissaoServicoCentavos: serv, comissaoProdutoCentavos: prod, comissaoCentavos: serv + prod, valesCentavos: vales
    };
  });
}

async function profissionaisDa(db, barbeariaId) {
  return (await db.prepare(`SELECT id, nome, perfil, ativo FROM usuarios WHERE barbearia_id = ? AND perfil IN ('proprietario','gerente','barbeiro')
                            ORDER BY ativo DESC, nome`).bind(barbeariaId).all()).results;
}

async function profissionalDaBarbearia(ctx, id) {
  if (!validId(id)) erro("Profissional inválido.");
  const p = await ctx.db.prepare("SELECT id, nome, perfil, ativo FROM usuarios WHERE id = ? AND barbearia_id = ?").bind(id, ctx.barbeariaId).first();
  if (!p) erro("Profissional não encontrado.", 404);
  if (!atende(p.perfil)) erro("Escolha um gerente ou barbeiro.");
  return p;
}

// Fechamento que cobre uma data para um barbeiro (vale nessa data não pode mais ser lançado/cancelado).
async function fechamentoQueCobre(db, barbeariaId, barbeiroId, data) {
  return db.prepare(`SELECT id FROM fechamentos_comissao WHERE barbearia_id = ? AND barbeiro_id = ? AND data_ini <= ? AND data_fim >= ?`)
    .bind(barbeariaId, barbeiroId, data, data).first();
}

// ---------- PRÉVIA E FECHAMENTO DE COMISSÃO ----------
async function previaComissao(ctx, ini, fim) {
  const { db } = ctx;
  const [d, profs, jaFechados] = await Promise.all([
    dadosPeriodo(db, ctx.barbeariaId, ini, fim),
    profissionaisDa(db, ctx.barbeariaId),
    db.prepare(`SELECT tipo, ref_id FROM fechamento_comissao_itens WHERE barbearia_id = ?`).bind(ctx.barbeariaId).all()
  ]);
  const fechado = new Set(jaFechados.results.map(x => `${x.tipo}:${x.ref_id}`));
  // Só o que ainda não entrou em fechamento.
  const livre = {
    ...d,
    comissoesServico: d.comissoesServico.filter(c => !fechado.has(`servico:${c.id}`)),
    comissoesProduto: d.comissoesProduto.filter(c => !fechado.has(`produto:${c.id}`)),
    vales: d.vales.filter(v => !fechado.has(`vale:${v.id}`))
  };
  const sobrepostos = (await db.prepare(`SELECT barbeiro_id FROM fechamentos_comissao WHERE barbearia_id = ? AND data_ini <= ? AND data_fim >= ?`)
    .bind(ctx.barbeariaId, fim, ini).all()).results.map(x => x.barbeiro_id);
  const linhas = porBarbeiro(livre, profs).map(b => ({
    ...b, aPagarCentavos: b.comissaoCentavos - b.valesCentavos, jaFechadoNoPeriodo: sobrepostos.includes(b.id)
  })).filter(b => b.comissaoCentavos || b.valesCentavos || b.jaFechadoNoPeriodo);
  return { livre, linhas };
}

async function fecharComissao(ctx) {
  const { db, user, request } = ctx;
  const input = await readJson(request);
  if (!validDate(input.dataIni) || !validDate(input.dataFim) || input.dataFim < input.dataIni) erro("Período inválido.");
  if (input.dataFim > hojeBrasil()) erro("Não dá para fechar um período que ainda não terminou.");
  const { livre, linhas } = await previaComissao(ctx, input.dataIni, input.dataFim);
  const fechar = linhas.filter(b => !b.jaFechadoNoPeriodo && (b.comissaoCentavos || b.valesCentavos));
  if (linhas.some(b => b.jaFechadoNoPeriodo)) {
    erro(`Já existe fechamento nesse período para: ${linhas.filter(b => b.jaFechadoNoPeriodo).map(b => b.nome).join(", ")}. Escolha outro período.`, 409);
  }
  if (!fechar.length) erro("Nada para fechar nesse período.", 409);
  const comandos = [];
  const criados = [];
  for (const b of fechar) {
    const id = crypto.randomUUID();
    criados.push({ ...b, fechamentoId: id });
    comandos.push(db.prepare(`INSERT INTO fechamentos_comissao (id, barbearia_id, barbeiro_id, data_ini, data_fim, comissao_servico_centavos,
                              comissao_produto_centavos, vales_centavos, a_pagar_centavos, criado_por) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(id, ctx.barbeariaId, b.id, input.dataIni, input.dataFim, b.comissaoServicoCentavos, b.comissaoProdutoCentavos, b.valesCentavos, b.aPagarCentavos, user.id));
    const itens = [
      ...livre.comissoesServico.filter(c => c.barbeiro_id === b.id).map(c => ["servico", c.id, c.valor_centavos]),
      ...livre.comissoesProduto.filter(c => c.barbeiro_id === b.id).map(c => ["produto", c.id, c.valor_centavos]),
      ...livre.vales.filter(v => v.barbeiro_id === b.id).map(v => ["vale", v.id, v.valor_centavos])
    ];
    for (const [tipo, ref, valor] of itens) {
      comandos.push(db.prepare("INSERT INTO fechamento_comissao_itens (fechamento_id, barbearia_id, tipo, ref_id, valor_centavos) VALUES (?, ?, ?, ?, ?)")
        .bind(id, ctx.barbeariaId, tipo, ref, valor));
    }
    comandos.push(auditoria(ctx, "comissao_fechada", id, {
      barbeiro: b.id, periodo: [input.dataIni, input.dataFim], servico: b.comissaoServicoCentavos, produto: b.comissaoProdutoCentavos,
      vales: b.valesCentavos, aPagar: b.aPagarCentavos
    }));
  }
  try {
    await db.batch(comandos);   // UNIQUE(tipo, ref_id): nada entra em dois fechamentos
  } catch (e) {
    if (/UNIQUE|constraint/i.test(String(e?.message))) erro("Outro fechamento acabou de ser feito. Atualize a tela.", 409);
    throw e;
  }
  return json({
    fechamentos: criados.map(c => ({
      id: c.fechamentoId, barbeiroId: c.id, nome: c.nome, comissaoServicoCentavos: c.comissaoServicoCentavos, comissaoProdutoCentavos: c.comissaoProdutoCentavos,
      valesCentavos: c.valesCentavos, aPagarCentavos: c.aPagarCentavos
    }))
  }, 201);
}

function fechamentoPublico(f) {
  return {
    id: f.id, barbeiroId: f.barbeiro_id, barbeiro: f.barbeiro, dataIni: f.data_ini, dataFim: f.data_fim,
    comissaoServicoCentavos: f.comissao_servico_centavos, comissaoProdutoCentavos: f.comissao_produto_centavos,
    valesCentavos: f.vales_centavos, aPagarCentavos: f.a_pagar_centavos, pagoEm: f.pago_em || null, pagoComCaixa: Boolean(f.pago_com_caixa),
    criadoEm: f.criado_em
  };
}

async function rotasComissoes(ctx, path, method) {
  const { db, user, request } = ctx;
  const url = new URL(request.url);

  if (path === "/comissoes/previa" && method === "GET") {
    const { ini, fim } = lerPeriodo(url);
    const { linhas } = await previaComissao(ctx, ini, fim);
    return json({ dataIni: ini, dataFim: fim, barbeiros: linhas });
  }
  if (path === "/comissoes/fechar" && method === "POST") return fecharComissao(ctx);
  if (path === "/comissoes/fechamentos" && method === "GET") {
    const r = await db.prepare(`SELECT f.*, u.nome AS barbeiro FROM fechamentos_comissao f JOIN usuarios u ON u.id = f.barbeiro_id
                                WHERE f.barbearia_id = ? ORDER BY f.data_fim DESC, u.nome LIMIT 200`).bind(ctx.barbeariaId).all();
    return json({ fechamentos: r.results.map(fechamentoPublico) });
  }
  if (path === "/comissoes/fechamentos/pagar" && method === "POST") {
    const input = await readJson(request);
    if (!validId(input.id)) erro("Fechamento inválido.");
    const f = await db.prepare(`SELECT f.*, u.nome AS barbeiro FROM fechamentos_comissao f JOIN usuarios u ON u.id = f.barbeiro_id
                                WHERE f.id = ? AND f.barbearia_id = ?`).bind(input.id, ctx.barbeariaId).first();
    if (!f) erro("Fechamento não encontrado.", 404);
    if (f.pago_em) erro("Esse fechamento já foi pago.", 409);
    const comandos = [];
    if (input.comCaixa === true && f.a_pagar_centavos > 0) {
      comandos.push((await sangriaAutomatica(ctx, f.a_pagar_centavos, `Comissão paga: ${f.barbeiro} (${dataBR(f.data_ini)} a ${dataBR(f.data_fim)})`)).comando);
    }
    comandos.push(
      db.prepare("UPDATE fechamentos_comissao SET pago_em = ?, pago_por = ?, pago_com_caixa = ? WHERE id = ? AND barbearia_id = ? AND pago_em IS NULL")
        .bind(hojeBrasil(), user.id, input.comCaixa === true ? 1 : 0, f.id, ctx.barbeariaId),
      auditoria(ctx, "comissao_paga", f.id, { valor: f.a_pagar_centavos, comCaixa: input.comCaixa === true })
    );
    await db.batch(comandos);
    return json({ mensagem: "Pagamento registrado." });
  }
  return null;
}

// ---------- VALES ----------
async function rotasVales(ctx, path, method) {
  const { db, user, request } = ctx;
  if (path === "/vales" && method === "GET") {
    const { ini, fim } = lerPeriodo(new URL(request.url));
    const r = await db.prepare(`SELECT v.*, u.nome AS barbeiro,
                                  EXISTS (SELECT 1 FROM fechamento_comissao_itens i WHERE i.tipo = 'vale' AND i.ref_id = v.id) AS fechado
                                FROM vales v JOIN usuarios u ON u.id = v.barbeiro_id
                                WHERE v.barbearia_id = ? AND v.data BETWEEN ? AND ? ORDER BY v.data DESC, v.criado_em DESC`).bind(ctx.barbeariaId, ini, fim).all();
    return json({
      vales: r.results.map(v => ({
        id: v.id, barbeiroId: v.barbeiro_id, barbeiro: v.barbeiro, data: v.data, valorCentavos: v.valor_centavos, descricao: v.descricao,
        situacao: v.situacao, motivoCancelamento: v.motivo_cancelamento, fechado: Boolean(v.fechado)
      }))
    });
  }
  if (path === "/vales" && method === "POST") {
    const input = await readJson(request);
    const p = await profissionalDaBarbearia(ctx, input.barbeiroId);
    if (!validCentavos(input.valorCentavos) || input.valorCentavos <= 0) erro("Valor inválido.");
    const data = input.data || hojeBrasil();
    if (!validDate(data)) erro("Data inválida.");
    if (data > hojeBrasil()) erro("Vale com data futura não é aceito.");
    if (await fechamentoQueCobre(db, ctx.barbeariaId, p.id, data)) erro("A comissão desse período já foi fechada para esse profissional.", 409);
    const descricao = textoOpcional(input.descricao, 120);
    if (descricao === false) erro("Descrição muito longa.");
    const id = crypto.randomUUID();
    await db.batch([
      db.prepare("INSERT INTO vales (id, barbearia_id, barbeiro_id, data, valor_centavos, descricao, criado_por) VALUES (?, ?, ?, ?, ?, ?, ?)")
        .bind(id, ctx.barbeariaId, p.id, data, input.valorCentavos, descricao, user.id),
      auditoria(ctx, "vale_lancado", id, { depois: { barbeiro: p.id, data, valor: input.valorCentavos, descricao } })
    ]);
    return json({ vale: { id, barbeiroId: p.id, data, valorCentavos: input.valorCentavos } }, 201);
  }
  if (path === "/vales/cancelar" && method === "POST") {
    const input = await readJson(request);
    if (!validId(input.id)) erro("Vale inválido.");
    const motivo = exigirMotivo(input.motivo);
    const v = await db.prepare("SELECT * FROM vales WHERE id = ? AND barbearia_id = ?").bind(input.id, ctx.barbeariaId).first();
    if (!v) erro("Vale não encontrado.", 404);
    if (v.situacao !== "ativo") erro("Esse vale já foi cancelado.", 409);
    if (await db.prepare("SELECT 1 FROM fechamento_comissao_itens WHERE tipo = 'vale' AND ref_id = ?").bind(v.id).first()) {
      erro("Esse vale já entrou num fechamento de comissão: não dá para cancelar.", 409);
    }
    await db.batch([
      db.prepare("UPDATE vales SET situacao = 'cancelado', motivo_cancelamento = ? WHERE id = ? AND barbearia_id = ? AND situacao = 'ativo'").bind(motivo, v.id, ctx.barbeariaId),
      auditoria(ctx, "vale_cancelado", v.id, { motivo, antes: { situacao: "ativo" }, depois: { situacao: "cancelado" } })
    ]);
    return json({ mensagem: "Vale cancelado." });
  }
  return null;
}

// ---------- CONTAS A PAGAR ----------
function statusConta(c, hoje) {
  if (c.situacao !== "aberta") return c.situacao;
  if (c.vencimento < hoje) return "atrasada";
  if (c.vencimento === hoje) return "hoje";
  if (c.vencimento <= somarDias(hoje, 7)) return "proxima";
  return "futura";
}
export const FORMAS_CONTA = { dinheiro: "Dinheiro", pix: "Pix", debito: "Cartão de débito", credito: "Cartão de crédito", boleto: "Boleto", transferencia: "Transferência" };
const contaPublica = (c, hoje) => ({
  id: c.id, descricao: c.descricao, categoria: c.categoria, valorCentavos: c.valor_centavos, vencimento: c.vencimento,
  recorrente: Boolean(c.recorrente), situacao: c.situacao, status: statusConta(c, hoje), pagoEm: c.pago_em || null,
  pagoComCaixa: Boolean(c.caixa_movimento_id), motivoCancelamento: c.motivo_cancelamento || null,
  estoque: c.est_produto ? { produto: c.est_produto, quantidade: c.est_qtd } : null,
  forma: c.det_forma || null, parcela: c.det_parcela || 1, parcelas: c.det_parcelas || 1, grupoId: c.det_grupo || null
});
// Conta com o material lançado no estoque (quando houver).
const SELECT_CONTAS = `SELECT k.*, (SELECT p.nome FROM contas_estoque ce JOIN produtos p ON p.id = ce.produto_id WHERE ce.conta_id = k.id) AS est_produto,
  (SELECT ce.quantidade FROM contas_estoque ce WHERE ce.conta_id = k.id) AS est_qtd,
  d.forma AS det_forma, d.parcela AS det_parcela, d.parcelas AS det_parcelas, d.grupo_id AS det_grupo
  FROM contas k LEFT JOIN contas_detalhes d ON d.conta_id = k.id`;
const formaValida = f => f === undefined || f === null || Object.hasOwn(FORMAS_CONTA, f);
const upsertForma = (ctx, contaId, forma) => ctx.db.prepare(`INSERT INTO contas_detalhes (conta_id, barbearia_id, forma) VALUES (?, ?, ?)
  ON CONFLICT(conta_id) DO UPDATE SET forma = excluded.forma`).bind(contaId, ctx.barbeariaId, forma);

async function rotasContas(ctx, path, method) {
  const { db, user, request } = ctx;
  const hoje = hojeBrasil();
  if (path === "/contas" && method === "GET") {
    const todas = new URL(request.url).searchParams.get("todas") === "1";
    const r = await db.prepare(`${SELECT_CONTAS} WHERE k.barbearia_id = ? ${todas ? "" : "AND (k.situacao = 'aberta' OR k.pago_em >= ?)"}
                                ORDER BY CASE k.situacao WHEN 'aberta' THEN 0 ELSE 1 END, k.vencimento LIMIT 300`)
      .bind(ctx.barbeariaId, ...(todas ? [] : [somarDias(hoje, -31)])).all();
    return json({ contas: r.results.map(c => contaPublica(c, hoje)), categorias: CATEGORIAS, formas: FORMAS_CONTA });
  }
  if (path === "/contas" && method === "POST") {
    const input = await readJson(request);
    if (!Object.hasOwn(CATEGORIAS, input.categoria)) erro("Categoria inválida (aluguel, luz, água, fornecedor ou outros).");
    // Descrição opcional (pedido de 17/11/2026): em branco vira o nome da categoria (ou "Compra: <produto>").
    const semDescricao = input.descricao === undefined || input.descricao === null || String(input.descricao).trim() === "";
    let descricao = semDescricao ? CATEGORIAS[input.categoria] : textoLimpo(input.descricao, 2, 100);
    if (!descricao) erro("Descrição muito curta ou longa (2 a 100 letras). Pode deixar em branco.");
    if (!validCentavos(input.valorCentavos) || input.valorCentavos <= 0) erro("Valor inválido.");
    if (!validDate(input.vencimento)) erro("Vencimento inválido.");
    if (input.recorrente !== undefined && typeof input.recorrente !== "boolean") erro("Recorrente inválido.");
    // Despesa que já lança o material/produto no estoque (pedido de 16/11/2026): custo unitário = valor ÷ quantidade.
    let est = null;
    if (input.estoque) {
      if (input.recorrente) erro("Conta recorrente não lança no estoque. Lance a compra do material como conta normal.");
      const q = input.estoque.quantidade;
      if (!Number.isInteger(q) || q < 1 || q > 100000) erro("Quantidade para o estoque inválida.");
      const precoIn = input.estoque.precoVendaCentavos;
      if (precoIn !== undefined && precoIn !== null && (!validCentavos(precoIn) || precoIn > 100000000)) erro("Preço de venda inválido.");
      if (input.estoque.novo) {
        // Produto novo criado na própria despesa (pedido de 26/11/2026): evita lançar duas vezes (cadastro + compra).
        const n = input.estoque.novo;
        const nome = textoLimpo(n.nome, 2, 80);
        if (!nome) erro("Informe o nome do produto (2 a 80 letras).");
        const usoInterno = n.usoInterno === true;
        const preco = usoInterno ? 0 : precoIn;
        if (!usoInterno && (!Number.isInteger(preco) || preco <= 0)) erro("Informe o preço de venda do produto novo (ou marque que é material de uso, que não é vendido).");
        if (await db.prepare("SELECT 1 FROM produtos WHERE barbearia_id = ? AND lower(nome) = lower(?)").bind(ctx.barbeariaId, nome).first())
          erro("Já existe um produto ou material com esse nome. Escolha ele na lista, em vez de criar de novo.", 409);
        const idNovo = crypto.randomUUID();
        est = { p: { id: idNovo, nome, saldo: 0, custo_medio_centavos: 0 }, q, c: Math.round(input.valorCentavos / q), mov: crypto.randomUUID(), novo: true, usoInterno, preco };
      } else {
        if (!validId(input.estoque.produtoId)) erro("Escolha o produto ou material do estoque.");
        const p = await db.prepare(`SELECT p.*, COALESCE(e.saldo, 0) AS saldo, EXISTS (SELECT 1 FROM produtos_uso_interno ui WHERE ui.produto_id = p.id) AS uso_interno
                                    FROM produtos p LEFT JOIN produto_estoque e ON e.produto_id = p.id
                                    WHERE p.id = ? AND p.barbearia_id = ?`).bind(input.estoque.produtoId, ctx.barbeariaId).first();
        if (!p) erro("Produto não encontrado.", 404);
        if (!p.ativo) erro("Produto desativado. Reative antes.");
        const usoInterno = Boolean(p.uso_interno);
        // Preço de venda atualizado junto (só produto de venda): fica registrado no histórico de auditoria.
        const mudaPreco = !usoInterno && Number.isInteger(precoIn) && precoIn > 0 && precoIn !== p.preco_centavos;
        est = { p, q, c: Math.round(input.valorCentavos / q), mov: crypto.randomUUID(), usoInterno, preco: mudaPreco ? precoIn : p.preco_centavos, mudaPreco, precoAntes: p.preco_centavos };
      }
      if (semDescricao) descricao = `Compra: ${est.p.nome}`.slice(0, 100);
    }
    // Forma de pagamento e parcelamento (pedido de 17/11/2026): cada parcela vira uma conta, vencendo de mês em mês.
    if (!formaValida(input.forma)) erro("Forma de pagamento inválida.");
    const forma = input.forma || null;
    const parcelas = input.parcelas === undefined ? 1 : input.parcelas;
    if (!Number.isInteger(parcelas) || parcelas < 1 || parcelas > 48) erro("Parcelas inválidas (1 a 48).");
    if (parcelas > 1 && input.recorrente) erro("Conta parcelada não pode ser recorrente.");
    if (parcelas > 1 && input.valorCentavos < parcelas) erro("Valor pequeno demais para tantas parcelas.");
    if (input.jaPaga !== undefined && typeof input.jaPaga !== "boolean") erro("Pagamento inválido.");
    // "Já paga" vale para a 1ª parcela (compra à vista no Pix, dinheiro, débito… ou a entrada).
    const jaPaga = input.jaPaga === true;
    const base = Math.floor(input.valorCentavos / parcelas);
    const valores = Array.from({ length: parcelas }, (_, i) => base + (i === 0 ? input.valorCentavos - base * parcelas : 0));
    const grupo = parcelas > 1 ? crypto.randomUUID() : null;
    const ids = valores.map(() => crypto.randomUUID());
    const id = ids[0];
    const comandos = [];
    let movCaixa = null;
    if (jaPaga && input.comCaixa === true) {
      const s = await sangriaAutomatica(ctx, valores[0], `Conta paga: ${descricao}${parcelas > 1 ? ` (1/${parcelas})` : ""}`);
      movCaixa = s.id;
      comandos.push(s.comando);
    }
    ids.forEach((cid, i) => {
      const desc = parcelas > 1 ? `${descricao.slice(0, 92)} (${i + 1}/${parcelas})` : descricao;
      const venc = i === 0 ? input.vencimento : somarMes(input.vencimento, i);
      const paga = i === 0 && jaPaga;
      comandos.push(
        db.prepare(`INSERT INTO contas (id, barbearia_id, descricao, categoria, valor_centavos, vencimento, recorrente, situacao, pago_em, pago_por, caixa_movimento_id, criado_por)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .bind(cid, ctx.barbeariaId, desc, input.categoria, valores[i], venc, input.recorrente ? 1 : 0, paga ? "paga" : "aberta",
            paga ? hoje : null, paga ? user.id : null, paga ? movCaixa : null, user.id));
      if (forma || parcelas > 1) {
        comandos.push(db.prepare("INSERT INTO contas_detalhes (conta_id, barbearia_id, forma, parcela, parcelas, grupo_id) VALUES (?, ?, ?, ?, ?, ?)")
          .bind(cid, ctx.barbeariaId, forma, i + 1, parcelas, grupo));
      }
    });
    comandos.push(auditoria(ctx, "conta_criada", id, { depois: { descricao, categoria: input.categoria, valor: input.valorCentavos, vencimento: input.vencimento, recorrente: Boolean(input.recorrente),
      forma, parcelas, jaPaga, contas: parcelas > 1 ? ids : undefined,
      estoque: est ? { produto: est.p.nome, quantidade: est.q, custoUnit: est.c } : undefined } }));
    // O material entra no estoque pelo valor TOTAL da compra, ligado à 1ª parcela.
    if (est) {
      if (est.novo) {
        comandos.push(
          db.prepare(`INSERT INTO produtos (id, barbearia_id, nome, preco_centavos, estoque_minimo, mostrar_site) VALUES (?, ?, ?, ?, 0, 0)`).bind(est.p.id, ctx.barbeariaId, est.p.nome, est.preco),
          ...(est.usoInterno ? [db.prepare("INSERT INTO produtos_uso_interno (produto_id, barbearia_id) VALUES (?, ?)").bind(est.p.id, ctx.barbeariaId)] : []),
          auditoria(ctx, est.usoInterno ? "material_criado" : "produto_criado", est.p.id, { depois: { nome: est.p.nome, precoVenda: est.preco, origem: "despesa" } }));
      } else if (est.mudaPreco) {
        comandos.push(
          db.prepare("UPDATE produtos SET preco_centavos = ?, atualizado_em = CURRENT_TIMESTAMP WHERE id = ? AND barbearia_id = ?").bind(est.preco, est.p.id, ctx.barbeariaId),
          auditoria(ctx, "produto_preco_alterado", est.p.id, { antes: { preco: est.precoAntes }, depois: { preco: est.preco }, origem: "despesa" }));
      }
      comandos.push(
        ...comandosEntrada(ctx, est.p, { q: est.q, c: est.c, fornecedor: textoLimpo(descricao, 2, 80) || null, id: est.mov }),
        db.prepare(`INSERT INTO contas_estoque (id, barbearia_id, conta_id, produto_id, quantidade, custo_unit_centavos, movimento_id) VALUES (?, ?, ?, ?, ?, ?, ?)`)
          .bind(crypto.randomUUID(), ctx.barbeariaId, id, est.p.id, est.q, est.c, est.mov));
    }
    await db.batch(comandos);
    const lucroUnit = est && !est.usoInterno && est.preco > 0 ? est.preco - est.c : null;
    return json({ conta: contaPublica(await db.prepare(`${SELECT_CONTAS} WHERE k.id = ?`).bind(id).first(), hoje), contasCriadas: parcelas,
      ...(est ? { estoque: { produto: est.p.nome, criado: Boolean(est.novo), quantidade: est.q, custoUnitCentavos: est.c, precoVendaCentavos: est.usoInterno ? null : est.preco,
        lucroUnitCentavos: lucroUnit, margemBp: lucroUnit === null ? null : Math.round((lucroUnit * 10000) / est.preco), lucroTotalCentavos: lucroUnit === null ? null : lucroUnit * est.q } } : {}) }, 201);
  }
  if (path === "/contas/pagar" && method === "POST") {
    const input = await readJson(request);
    if (!validId(input.id)) erro("Conta inválida.");
    const c = await db.prepare("SELECT * FROM contas WHERE id = ? AND barbearia_id = ?").bind(input.id, ctx.barbeariaId).first();
    if (!c) erro("Conta não encontrada.", 404);
    if (c.situacao !== "aberta") erro("Essa conta não está em aberto.", 409);
    if (!formaValida(input.forma)) erro("Forma de pagamento inválida.");
    const comandos = [];
    let movId = null;
    if (input.forma) comandos.push(upsertForma(ctx, c.id, input.forma));
    // "Pago com dinheiro do caixa" → vira sangria do caixa aberto.
    if (input.comCaixa === true) {
      const s = await sangriaAutomatica(ctx, c.valor_centavos, `Conta paga: ${c.descricao}`);
      movId = s.id;
      comandos.push(s.comando);
    }
    comandos.push(
      db.prepare("UPDATE contas SET situacao = 'paga', pago_em = ?, pago_por = ?, caixa_movimento_id = ? WHERE id = ? AND barbearia_id = ? AND situacao = 'aberta'")
        .bind(hoje, user.id, movId, c.id, ctx.barbeariaId),
      auditoria(ctx, "conta_paga", c.id, { valor: c.valor_centavos, comCaixa: Boolean(movId), antes: { situacao: "aberta" }, depois: { situacao: "paga", pagoEm: hoje } })
    );
    // Recorrente mensal: já deixa a do mês seguinte em aberto (uma vez só).
    if (c.recorrente) {
      comandos.push(db.prepare(`INSERT OR IGNORE INTO contas (id, barbearia_id, descricao, categoria, valor_centavos, vencimento, recorrente, conta_origem_id, criado_por)
                                VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`)
        .bind(crypto.randomUUID(), ctx.barbeariaId, c.descricao, c.categoria, c.valor_centavos, somarMes(c.vencimento, 1), c.id, user.id));
    }
    await db.batch(comandos);
    return json({ mensagem: movId ? "Conta paga com dinheiro do caixa (sangria registrada)." : "Conta paga." });
  }
  // Editar conta lançada. Em aberto: tudo. Paga: só descrição e categoria (valor e data já entraram no caixa e nos relatórios).
  if (path === "/contas/alterar" && method === "POST") {
    const input = await readJson(request);
    if (!validId(input.id)) erro("Conta inválida.");
    const c = await db.prepare("SELECT * FROM contas WHERE id = ? AND barbearia_id = ?").bind(input.id, ctx.barbeariaId).first();
    if (!c) erro("Conta não encontrada.", 404);
    if (c.situacao === "cancelada") erro("Conta cancelada não pode ser editada.", 409);
    const antes = { descricao: c.descricao, categoria: c.categoria, valor_centavos: c.valor_centavos, vencimento: c.vencimento, recorrente: c.recorrente };
    const novo = { ...antes };
    if (input.categoria !== undefined) { if (!Object.hasOwn(CATEGORIAS, input.categoria)) erro("Categoria inválida."); novo.categoria = input.categoria; }
    if (input.descricao !== undefined) {
      const vazia = input.descricao === null || String(input.descricao).trim() === "";
      novo.descricao = vazia ? CATEGORIAS[novo.categoria] : textoLimpo(input.descricao, 2, 100);
      if (!novo.descricao) erro("Descrição muito curta ou longa (2 a 100 letras). Pode deixar em branco.");
    }
    const mudaValores = ["valorCentavos", "vencimento", "recorrente"].some(k => input[k] !== undefined
      && input[k] !== { valorCentavos: c.valor_centavos, vencimento: c.vencimento, recorrente: Boolean(c.recorrente) }[k]);
    if (mudaValores && c.situacao !== "aberta") erro("Conta já paga: só dá para mudar a descrição e a categoria.", 409);
    if (input.valorCentavos !== undefined && input.valorCentavos !== c.valor_centavos
      && await db.prepare("SELECT 1 FROM contas_estoque WHERE conta_id = ?").bind(c.id).first()) {
      erro("Essa conta lançou material no estoque com o custo do valor: para mudar o valor, cancele a conta e lance de novo.", 409);
    }
    if (input.valorCentavos !== undefined) { if (!validCentavos(input.valorCentavos) || input.valorCentavos <= 0) erro("Valor inválido."); novo.valor_centavos = input.valorCentavos; }
    if (input.vencimento !== undefined) { if (!validDate(input.vencimento)) erro("Vencimento inválido."); novo.vencimento = input.vencimento; }
    if (input.recorrente !== undefined) { if (typeof input.recorrente !== "boolean") erro("Recorrente inválido."); novo.recorrente = input.recorrente ? 1 : 0; }
    const mudou = Object.keys(novo).filter(k => novo[k] !== antes[k]);
    if (!formaValida(input.forma)) erro("Forma de pagamento inválida.");
    const formaAntes = (await db.prepare("SELECT forma FROM contas_detalhes WHERE conta_id = ?").bind(c.id).first())?.forma || null;
    const mudaForma = input.forma !== undefined && (input.forma || null) !== formaAntes;
    if (!mudou.length && !mudaForma) erro("Nada foi alterado.");
    if (mudaForma) { mudou.push("forma"); antes.forma = formaAntes; novo.forma = input.forma || null; }
    await db.batch([
      ...(mudaForma ? [upsertForma(ctx, c.id, input.forma || null)] : []),
      db.prepare(`UPDATE contas SET descricao = ?, categoria = ?, valor_centavos = ?, vencimento = ?, recorrente = ?
                  WHERE id = ? AND barbearia_id = ? AND situacao = ?`)
        .bind(novo.descricao, novo.categoria, novo.valor_centavos, novo.vencimento, novo.recorrente, c.id, ctx.barbeariaId, c.situacao),
      auditoria(ctx, "conta_alterada", c.id, { antes: Object.fromEntries(mudou.map(k => [k, antes[k]])), depois: Object.fromEntries(mudou.map(k => [k, novo[k]])) })
    ]);
    return json({ conta: contaPublica(await db.prepare(`${SELECT_CONTAS} WHERE k.id = ?`).bind(c.id).first(), hoje) });
  }
  if (path === "/contas/cancelar" && method === "POST") {
    const input = await readJson(request);
    if (!validId(input.id)) erro("Conta inválida.");
    const motivo = exigirMotivo(input.motivo);
    const c = await db.prepare("SELECT k.*, d.grupo_id FROM contas k LEFT JOIN contas_detalhes d ON d.conta_id = k.id WHERE k.id = ? AND k.barbearia_id = ?")
      .bind(input.id, ctx.barbeariaId).first();
    if (!c) erro("Conta não encontrada.", 404);
    if (c.situacao !== "aberta") erro("Só conta em aberto pode ser cancelada.", 409);
    // Parcelada: "todasParcelas" cancela esta e as outras parcelas ainda em aberto da mesma compra.
    const alvos = input.todasParcelas === true && c.grupo_id
      ? (await db.prepare(`SELECT k.* FROM contas k JOIN contas_detalhes d ON d.conta_id = k.id
                           WHERE d.grupo_id = ? AND k.barbearia_id = ? AND k.situacao = 'aberta' ORDER BY k.vencimento`).bind(c.grupo_id, ctx.barbeariaId).all()).results
      : [c];
    const comandos = [];
    const saiu = [];
    for (const k of alvos) {
      // Material que entrou no estoque por esta conta sai de novo (ajuste "Correção"), se ainda houver saldo.
      const ce = await db.prepare(`SELECT ce.*, p.nome, COALESCE(e.saldo, 0) AS saldo, p.custo_medio_centavos FROM contas_estoque ce JOIN produtos p ON p.id = ce.produto_id
                                   LEFT JOIN produto_estoque e ON e.produto_id = p.id WHERE ce.conta_id = ? AND ce.estornado_movimento_id IS NULL`).bind(k.id).first();
      if (ce && ce.saldo < ce.quantidade) erro(`Não dá para cancelar: ${ce.quantidade} de ${ce.nome} entraram por esta conta, mas só há ${ce.saldo} no estoque. Ajuste o estoque antes.`, 409);
      const movEst = ce ? crypto.randomUUID() : null;
      if (ce) saiu.push(`${ce.quantidade} de ${ce.nome}`);
      comandos.push(
        db.prepare("UPDATE contas SET situacao = 'cancelada', motivo_cancelamento = ? WHERE id = ? AND barbearia_id = ? AND situacao = 'aberta'").bind(motivo, k.id, ctx.barbeariaId),
        auditoria(ctx, "conta_cancelada", k.id, { motivo, antes: { situacao: "aberta" }, depois: { situacao: "cancelada" }, estoque: ce ? { produto: ce.nome, quantidade: -ce.quantidade } : undefined }),
        ...(ce ? [
          db.prepare("UPDATE produto_estoque SET saldo = saldo - ?, atualizado_em = CURRENT_TIMESTAMP WHERE produto_id = ? AND barbearia_id = ?").bind(ce.quantidade, ce.produto_id, ctx.barbeariaId),
          db.prepare(`INSERT INTO estoque_movimentos (id, barbearia_id, produto_id, tipo, quantidade, custo_unit_centavos, motivo, criado_por) VALUES (?, ?, ?, 'ajuste', ?, ?, ?, ?)`)
            .bind(movEst, ctx.barbeariaId, ce.produto_id, -ce.quantidade, ce.custo_unit_centavos, `Correção: conta cancelada (${k.descricao})`, user.id),
          db.prepare("UPDATE contas_estoque SET estornado_movimento_id = ? WHERE id = ?").bind(movEst, ce.id)
        ] : []));
    }
    try {
      await db.batch(comandos);
    } catch (e) {
      if (/CHECK constraint failed|constraint failed/i.test(String(e?.message))) erro("Saldo do estoque insuficiente para desfazer a entrada desta conta.", 409);
      throw e;
    }
    const txt = alvos.length > 1 ? `${alvos.length} parcelas canceladas.` : "Conta cancelada.";
    return json({ mensagem: saiu.length ? `${txt} ${saiu.join(", ")} saíram do estoque.` : txt, canceladas: alvos.length });
  }
  return null;
}

// ---------- PAINEL DO GERENTE ----------
async function painel(ctx) {
  const { db } = ctx;
  const url = new URL(ctx.request.url);
  const hoje = hojeBrasil();
  const p = periodo(url.searchParams.get("periodo") || "hoje", hoje);
  const diasGrafico = p.nome === "mes" ? 30 : 7;
  const iniGrafico = somarDias(hoje, -(diasGrafico - 1));
  const [d, dGraf, profs, contas, produtos, caixasAbertos, salarios] = await Promise.all([
    dadosPeriodo(db, ctx.barbeariaId, p.ini, p.fim),
    dadosPeriodo(db, ctx.barbeariaId, iniGrafico, hoje),
    profissionaisDa(db, ctx.barbeariaId),
    db.prepare("SELECT * FROM contas WHERE barbearia_id = ? AND situacao = 'aberta' AND vencimento <= ? ORDER BY vencimento").bind(ctx.barbeariaId, somarDias(hoje, 7)).all(),
    db.prepare(`SELECT p.*, COALESCE(e.saldo, 0) AS saldo FROM produtos p LEFT JOIN produto_estoque e ON e.produto_id = p.id
                WHERE p.barbearia_id = ? AND p.ativo = 1`).bind(ctx.barbeariaId).all(),
    db.prepare("SELECT data FROM caixas WHERE barbearia_id = ? AND situacao = 'aberto' AND data < ? ORDER BY data").bind(ctx.barbeariaId, hoje).all(),
    db.prepare(`SELECT COALESCE(SUM(k.valor_centavos), 0) AS total FROM contas_pessoal cp JOIN contas k ON k.id = cp.conta_id
                WHERE cp.barbearia_id = ? AND k.situacao = 'paga' AND k.pago_em BETWEEN ? AND ?`).bind(ctx.barbeariaId, p.ini, p.fim).first()
  ]);
  // lucro: dia/semana = bruto − comissões − custo dos produtos; mês = também − contas pagas
  const res = resultado(d, { descontarContas: p.nome === "mes" });
  const porDia = {};
  for (let i = 0; i < diasGrafico; i++) porDia[somarDias(iniGrafico, i)] = 0;
  for (const a of dGraf.atendimentos) porDia[a.data] += a.total_centavos;
  for (const v of dGraf.vendas) porDia[v.data] += v.total_centavos;
  const barbeiros = porBarbeiro(d, profs).filter(b => b.atendimentosQtd || b.comissaoCentavos || profs.find(x => x.id === b.id)?.ativo);
  const ct = contas.results.map(c => contaPublica(c, hoje));
  const grupo = s => ({ qtd: ct.filter(c => c.status === s).length, totalCentavos: soma(ct.filter(c => c.status === s), "valorCentavos") });
  const estoque = produtos.results.map(x => ({ nome: x.nome, avisos: avisosProduto(x, hoje) })).filter(x => x.avisos.length);
  return json({
    periodo: p,
    // Gastos com pessoal (17/11/2026) = comissões do período + salários pagos no período.
    cartoes: { ...res, salariosCentavos: Number(salarios.total), pessoalCentavos: res.comissoesCentavos + Number(salarios.total), comissoesPorBarbeiro: barbeiros.map(b => ({ id: b.id, nome: b.nome, comissaoCentavos: b.comissaoCentavos })) },
    contas: { atrasadas: grupo("atrasada"), hoje: grupo("hoje"), proximos7Dias: grupo("proxima"), lista: ct },
    faturamentoPorDia: Object.entries(porDia).map(([data, valorCentavos]) => ({ data, valorCentavos })),
    ranking: [...barbeiros].sort((a, b) => b.faturamentoCentavos - a.faturamentoCentavos)
      .map(b => ({ id: b.id, nome: b.nome, faturamentoCentavos: b.faturamentoCentavos, atendimentosQtd: b.atendimentosQtd })),
    avisos: {
      estoqueBaixo: estoque.filter(x => x.avisos.includes("repor")).map(x => x.nome),
      produtosVencendo: estoque.filter(x => x.avisos.includes("vencendo") || x.avisos.includes("vencido")).map(x => x.nome),
      diferencasCaixa: d.diferencasCaixa.map(x => ({ data: x.data, diferencaCentavos: x.diferenca_centavos, observacao: x.observacao })),
      valoresAlterados: d.valoresAlterados,
      caixasAbertosDiasAnteriores: caixasAbertos.results.map(x => x.data),
      notasAbertas: await resumoNotasAbertas(db, ctx.barbeariaId)
    }
  });
}

// ---------- DESEMPENHO DO BARBEIRO (só os dados dele) ----------
async function desempenho(ctx) {
  const { db, user } = ctx;
  const url = new URL(ctx.request.url);
  const alvo = isGestao(user) && url.searchParams.get("barbeiroId") ? await profissionalDaBarbearia(ctx, url.searchParams.get("barbeiroId")) : user;
  if (!atende(alvo.perfil)) erro("Desempenho é de quem atende (gerente ou barbeiro).");
  const p = periodo(url.searchParams.get("periodo") || "semana");
  const [d, ultimo, abertas] = await Promise.all([
    dadosPeriodo(db, ctx.barbeariaId, p.ini, p.fim),
    db.prepare("SELECT data_fim FROM fechamentos_comissao WHERE barbearia_id = ? AND barbeiro_id = ? ORDER BY data_fim DESC LIMIT 1").bind(ctx.barbeariaId, alvo.id).first(),
    // comissões e vales que ainda não entraram em fechamento (o "próximo fechamento")
    db.prepare(`SELECT
        (SELECT COALESCE(SUM(c.valor_centavos), 0) FROM comissoes c WHERE c.barbearia_id = ?1 AND c.barbeiro_id = ?2 AND c.estornada = 0
           AND NOT EXISTS (SELECT 1 FROM fechamento_comissao_itens i WHERE i.tipo = 'servico' AND i.ref_id = c.id)) +
        (SELECT COALESCE(SUM(c.valor_centavos), 0) FROM comissoes_produto c WHERE c.barbearia_id = ?1 AND c.barbeiro_id = ?2 AND c.estornada = 0
           AND NOT EXISTS (SELECT 1 FROM fechamento_comissao_itens i WHERE i.tipo = 'produto' AND i.ref_id = c.id)) AS comissoes,
        (SELECT COALESCE(SUM(v.valor_centavos), 0) FROM vales v WHERE v.barbearia_id = ?1 AND v.barbeiro_id = ?2 AND v.situacao = 'ativo'
           AND NOT EXISTS (SELECT 1 FROM fechamento_comissao_itens i WHERE i.tipo = 'vale' AND i.ref_id = v.id)) AS vales`)
      .bind(ctx.barbeariaId, alvo.id).first()
  ]);
  const b = porBarbeiro(d, [alvo])[0];
  return json({
    periodo: p, barbeiro: { id: alvo.id, nome: alvo.nome },
    atendimentosQtd: b.atendimentosQtd, faturamentoCentavos: b.faturamentoCentavos,
    comissaoServicoCentavos: b.comissaoServicoCentavos, comissaoProdutoCentavos: b.comissaoProdutoCentavos,
    comissaoCentavos: b.comissaoCentavos, valesCentavos: b.valesCentavos,
    proximoFechamento: {
      desde: ultimo ? somarDias(ultimo.data_fim, 1) : null,
      comissoesCentavos: Number(abertas.comissoes), valesCentavos: Number(abertas.vales),
      previstoCentavos: Number(abertas.comissoes) - Number(abertas.vales)
    }
  });
}

// ---------- EXTRATO MENSAL DO BARBEIRO (PDF + planilha) ----------
async function extrato(ctx) {
  const { db, user } = ctx;
  const url = new URL(ctx.request.url);
  const mes = url.searchParams.get("mes") || hojeBrasil().slice(0, 7);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(mes)) erro("Mês inválido (AAAA-MM).");
  const alvo = isGestao(user) && url.searchParams.get("barbeiroId") ? await profissionalDaBarbearia(ctx, url.searchParams.get("barbeiroId")) : user;
  if (!atende(alvo.perfil)) erro("Extrato é de quem atende (gerente ou barbeiro).");
  const ini = `${mes}-01`;
  const fim = somarDias(somarMes(ini, 1), -1);
  const d = await dadosPeriodo(db, ctx.barbeariaId, ini, fim);
  const comPorFin = Object.fromEntries(d.comissoesServico.map(c => [c.finalizacao_id, c]));
  const comPorVenda = Object.fromEntries(d.comissoesProduto.map(c => [c.venda_id, c]));
  const atend = d.atendimentos.filter(a => a.barbeiro_id === alvo.id);
  const vendas = d.vendas.filter(v => v.vendedor_id === alvo.id);
  const vales = d.vales.filter(v => v.barbeiro_id === alvo.id);
  const b = porBarbeiro(d, [alvo])[0];
  const pagos = (await db.prepare(`SELECT * FROM fechamentos_comissao WHERE barbearia_id = ? AND barbeiro_id = ? AND pago_em BETWEEN ? AND ?`)
    .bind(ctx.barbeariaId, alvo.id, ini, fim).all()).results;

  const linhasCsv = [
    ...atend.map(a => [dataCsv(a.data), "Atendimento", `${a.cliente.split(" ")[0]} - ${a.servicos}`, dinheiroCsv(a.total_centavos), dinheiroCsv(comPorFin[a.id]?.valor_centavos ?? 0)]),
    ...vendas.map(v => [dataCsv(v.data), "Venda de produto", v.itens, dinheiroCsv(v.total_centavos), dinheiroCsv(comPorVenda[v.id]?.valor_centavos ?? 0)]),
    ...vales.map(v => [dataCsv(v.data), "Vale", v.descricao || "", dinheiroCsv(-v.valor_centavos), ""]),
    ...pagos.map(f => [dataCsv(f.pago_em), "Comissão paga", `${dataCsv(f.data_ini)} a ${dataCsv(f.data_fim)}`, dinheiroCsv(f.a_pagar_centavos), ""])
  ];
  const csv = gerarCsv(["Data", "Tipo", "Descrição", "Valor (R$)", "Comissão (R$)"], linhasCsv);
  const titulo = `Extrato de ${alvo.nome} - ${mes.split("-").reverse().join("/")}`;
  const pdf = gerarPdf([
    { texto: titulo, tamanho: 16, negrito: true },
    { texto: `${user.barbearia_nome} · gerado em ${dataBR(hojeBrasil())}`, tamanho: 9 },
    { texto: "Resumo", tamanho: 12, negrito: true, espaco: 10 },
    { texto: `Atendimentos: ${b.atendimentosQtd} · faturamento bruto ${reais(b.faturamentoCentavos)}` },
    { texto: `Comissão de serviços: ${reais(b.comissaoServicoCentavos)} · comissão de produtos: ${reais(b.comissaoProdutoCentavos)}` },
    { texto: `Total de comissões: ${reais(b.comissaoCentavos)} · vales: ${reais(b.valesCentavos)} · saldo do mês: ${reais(b.comissaoCentavos - b.valesCentavos)}`, negrito: true },
    { texto: `Comissões pagas no mês: ${reais(soma(pagos, "a_pagar_centavos"))}` },
    { texto: "Lançamentos", tamanho: 12, negrito: true, espaco: 10 },
    ...(linhasCsv.length ? linhasCsv.map(l => ({ texto: `${l[0]}  ${l[1]}  ${l[2]}  R$ ${l[3]}${l[4] ? `  (comissão R$ ${l[4]})` : ""}`, tamanho: 9 })) : [{ texto: "Sem lançamentos no mês." }]),
    { texto: "Documento informativo; não é nota fiscal.", tamanho: 8, espaco: 12 }
  ], { rodape: `4blade · ${titulo}` });
  return json({
    mes, barbeiro: { id: alvo.id, nome: alvo.nome },
    resumo: { ...b, saldoCentavos: b.comissaoCentavos - b.valesCentavos, pagoCentavos: soma(pagos, "a_pagar_centavos") },
    arquivos: { nomeBase: `extrato-${alvo.nome.split(" ")[0].toLowerCase()}-${mes}`, pdfBase64: base64(pdf), csv }
  });
}

export async function rotasGestao(ctx, path, method) {
  const raiz = path.split("/")[1];
  if (!["comissoes", "vales", "contas", "painel", "desempenho", "extrato"].includes(raiz)) return null;
  exigirBarbearia(ctx);
  if (raiz === "desempenho" || raiz === "extrato") {
    if (!isGestao(ctx.user) && ctx.user.perfil !== "barbeiro") erro("Sem permissão", 403);
    if (method !== "GET") return fail("Rota não encontrada", 404);
    return raiz === "desempenho" ? desempenho(ctx) : extrato(ctx);
  }
  exigirGestao(ctx);
  if (raiz === "painel" && method === "GET" && path === "/painel") return painel(ctx);
  const r = (raiz === "comissoes" && await rotasComissoes(ctx, path, method)) ||
    (raiz === "vales" && await rotasVales(ctx, path, method)) ||
    (raiz === "contas" && await rotasContas(ctx, path, method));
  return r || fail("Rota não encontrada", 404);
}
