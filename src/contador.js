// Enviar ao contador (seção 4.10), contato do contador e cópia de todos os dados em planilhas (seção 4.11).
// Só proprietário e gerente. Não é nota fiscal.
import { json, fail, HttpError, readJson, sha256, textoOpcional, normalizarTelefone, auditoria, hojeBrasil } from "./util.js";
import { exigirGestao } from "./usuarios.js";
import { somarDias, formaEfetiva, FORMAS, telefoneReal } from "./agenda-util.js";
import { dadosPeriodo, resultado, porBarbeiro, somarMes, CATEGORIAS } from "./gestao.js";
import { gerarPdf, base64 } from "./pdf.js";
import { gerarCsv, dinheiroCsv, dataCsv } from "./csv.js";

const erro = (msg, status = 400) => { throw new HttpError(msg, status); };
const reais = c => `R$ ${(Number(c) / 100).toFixed(2).replace(".", ",").replace(/\B(?=(\d{3})+(?!\d))/g, ".")}`;
const NOME_FORMA = { dinheiro: "Dinheiro", pix: "Pix", debito: "Débito", credito: "Crédito" };
const dataLocal = col => `date(datetime(${col}, '-3 hours'))`;   // carimbo do banco (UTC) → dia em Brasília

export function lerReferencia(tipo, ref) {
  if (tipo === "mes" && /^\d{4}-(0[1-9]|1[0-2])$/.test(ref || "")) {
    const ini = `${ref}-01`;
    return { tipo, ref, ini, fim: somarDias(somarMes(ini, 1), -1), titulo: ref.split("-").reverse().join("/") };
  }
  if (tipo === "ano" && /^\d{4}$/.test(ref || "")) return { tipo, ref, ini: `${ref}-01-01`, fim: `${ref}-12-31`, titulo: ref };
  erro("Período inválido: escolha um mês (AAAA-MM) ou um ano (AAAA).");
}

// Monta todos os números do período (base do PDF, da planilha e da "impressão digital" do envio).
export async function relatorioContador(ctx, per) {
  const { db } = ctx;
  const b = ctx.barbeariaId;
  const [d, formas, compras, sangrias, pagos, profs, estoque, lancs, notasLanc, notasReceb] = await Promise.all([
    dadosPeriodo(db, b, per.ini, per.fim),
    db.prepare(`
      SELECT 'servico' AS origem, l.forma, SUM(l.valor_centavos) AS total FROM caixa_lancamentos l JOIN caixas c ON c.id = l.caixa_id
      WHERE l.barbearia_id = ?1 AND c.data BETWEEN ?2 AND ?3 GROUP BY l.forma
      UNION ALL
      SELECT CASE WHEN m.tipo IN ('venda','estorno_venda') THEN 'produto'
                  WHEN EXISTS (SELECT 1 FROM caixa_lancamentos x WHERE x.id = m.referencia_id) THEN 'servico' ELSE 'produto' END AS origem,
             m.forma, SUM(m.valor_centavos) AS total
      FROM caixa_movimentos m JOIN caixas c ON c.id = m.caixa_id
      WHERE m.barbearia_id = ?1 AND c.data BETWEEN ?2 AND ?3 AND m.tipo IN ('venda','estorno_venda','correcao_saida','correcao_entrada')
      GROUP BY 1, 2`).bind(b, per.ini, per.fim).all(),
    db.prepare(`SELECT m.*, p.nome AS produto, ${dataLocal("m.criado_em")} AS dia FROM estoque_movimentos m JOIN produtos p ON p.id = m.produto_id
                WHERE m.barbearia_id = ? AND m.tipo = 'entrada' AND ${dataLocal("m.criado_em")} BETWEEN ? AND ? ORDER BY m.criado_em`).bind(b, per.ini, per.fim).all(),
    db.prepare(`SELECT m.valor_centavos, m.motivo, c.data FROM caixa_movimentos m JOIN caixas c ON c.id = m.caixa_id
                WHERE m.barbearia_id = ? AND m.tipo = 'sangria' AND c.data BETWEEN ? AND ?
                  AND NOT EXISTS (SELECT 1 FROM contas k WHERE k.caixa_movimento_id = m.id) AND m.motivo NOT LIKE 'Comissão paga:%'
                ORDER BY c.data`).bind(b, per.ini, per.fim).all(),
    db.prepare(`SELECT f.*, u.nome AS barbeiro FROM fechamentos_comissao f JOIN usuarios u ON u.id = f.barbeiro_id
                WHERE f.barbearia_id = ? AND f.pago_em BETWEEN ? AND ?`).bind(b, per.ini, per.fim).all(),
    db.prepare(`SELECT id, nome, perfil, ativo FROM usuarios WHERE barbearia_id = ? AND perfil IN ('proprietario','gerente','barbeiro') ORDER BY nome`).bind(b).all(),
    // estoque no fim do período = saldo de hoje − movimentos depois do fim
    db.prepare(`SELECT p.nome, p.custo_medio_centavos,
                  COALESCE(e.saldo, 0) - COALESCE((SELECT SUM(m.quantidade) FROM estoque_movimentos m WHERE m.produto_id = p.id AND ${dataLocal("m.criado_em")} > ?), 0) AS saldo_fim
                FROM produtos p LEFT JOIN produto_estoque e ON e.produto_id = p.id WHERE p.barbearia_id = ? ORDER BY p.nome`).bind(per.fim, b).all(),
    db.prepare(`
      SELECT c.data, l.criado_em AS em, CASE l.tipo WHEN 'atendimento' THEN 'Atendimento' ELSE 'Estorno de atendimento' END AS tipo,
        (SELECT group_concat(nome, ' + ') FROM (SELECT i.nome FROM finalizacao_itens i WHERE i.finalizacao_id = l.finalizacao_id ORDER BY i.rowid)) || ' - ' || u.nome AS descricao,
        ${formaEfetiva("l.id", "l.forma")} AS forma, l.valor_centavos AS valor
      FROM caixa_lancamentos l JOIN caixas c ON c.id = l.caixa_id JOIN finalizacoes f ON f.id = l.finalizacao_id JOIN usuarios u ON u.id = f.barbeiro_id
      WHERE l.barbearia_id = ?1 AND c.data BETWEEN ?2 AND ?3
      UNION ALL
      SELECT c.data, m.criado_em, CASE m.tipo WHEN 'venda' THEN 'Venda de produto' WHEN 'estorno_venda' THEN 'Venda cancelada'
             WHEN 'sangria' THEN 'Sangria' WHEN 'suprimento' THEN 'Suprimento' ELSE 'Correção de forma' END,
        COALESCE((SELECT group_concat(i.quantidade || 'x ' || i.nome, ', ') FROM venda_itens i WHERE i.venda_id = m.venda_id), m.motivo, ''),
        m.forma, m.valor_centavos
      FROM caixa_movimentos m JOIN caixas c ON c.id = m.caixa_id
      WHERE m.barbearia_id = ?1 AND c.data BETWEEN ?2 AND ?3
      ORDER BY 1, 2`).bind(b, per.ini, per.fim).all(),
    // Promissórias: lançadas no período (o cliente paga depois) e recebidas no período (entraram no caixa).
    db.prepare(`SELECT p.valor_centavos, p.descricao, p.origem, p.criado_em, cx.data, c.nome AS cliente FROM promissorias p
                JOIN caixas cx ON cx.id = p.caixa_id JOIN clientes c ON c.id = p.cliente_id
                WHERE p.barbearia_id = ? AND p.situacao <> 'estornada' AND cx.data BETWEEN ? AND ? ORDER BY cx.data, p.criado_em`).bind(b, per.ini, per.fim).all(),
    db.prepare(`SELECT pp.forma, pp.valor_centavos, r.criado_em, cx.data, c.nome AS cliente FROM promissoria_pagamentos pp
                JOIN promissoria_recebimentos r ON r.id = pp.recebimento_id JOIN caixas cx ON cx.id = pp.caixa_id JOIN clientes c ON c.id = r.cliente_id
                WHERE pp.barbearia_id = ? AND r.situacao = 'ativo' AND cx.data BETWEEN ? AND ? ORDER BY cx.data, r.criado_em`).bind(b, per.ini, per.fim).all()
  ]);
  const notasRecebidasPorForma = Object.fromEntries(FORMAS.map(f => [f, 0]));
  for (const r of notasReceb.results) notasRecebidasPorForma[r.forma] += r.valor_centavos;

  const entradas = { servico: Object.fromEntries(FORMAS.map(f => [f, 0])), produto: Object.fromEntries(FORMAS.map(f => [f, 0])) };
  for (const x of formas.results) entradas[x.origem][x.forma] += Number(x.total);
  const res = resultado(d, { descontarContas: true });
  const barbeiros = porBarbeiro(d, profs.results)
    .map(x => ({ ...x, pagoCentavos: pagos.results.filter(f => f.barbeiro_id === x.id).reduce((t, f) => t + f.a_pagar_centavos, 0) }))
    .filter(x => x.comissaoCentavos || x.valesCentavos || x.pagoCentavos || x.atendimentosQtd);
  const contasPorCategoria = Object.fromEntries(Object.keys(CATEGORIAS).map(k => [k, 0]));
  for (const c of d.contasPagas) contasPorCategoria[c.categoria] += c.valor_centavos;
  const comprasTotal = compras.results.reduce((t, m) => t + m.quantidade * m.custo_unit_centavos, 0);

  return {
    periodo: { tipo: per.tipo, referencia: per.ref, ini: per.ini, fim: per.fim, titulo: per.titulo },
    entradas: {
      servicosPorForma: entradas.servico, produtosPorForma: entradas.produto,
      servicosCentavos: res.atendimentosCentavos, produtosCentavos: res.vendasCentavos, totalCentavos: res.brutoCentavos
    },
    saidas: {
      contasPagasPorCategoria: contasPorCategoria, contasPagasCentavos: res.contasPagasCentavos,
      comprasMercadoriaCentavos: comprasTotal,
      sangriasAvulsas: sangrias.results.map(s => ({ data: s.data, valorCentavos: -s.valor_centavos, motivo: s.motivo })),
      sangriasAvulsasCentavos: sangrias.results.reduce((t, s) => t - s.valor_centavos, 0)
    },
    promissorias: {
      lancadasCentavos: notasLanc.results.reduce((t, n) => t + n.valor_centavos, 0),
      recebidasPorForma: notasRecebidasPorForma,
      recebidasCentavos: notasReceb.results.reduce((t, n) => t + n.valor_centavos, 0)
    },
    comissoes: {
      porBarbeiro: barbeiros.map(x => ({ nome: x.nome, servicoCentavos: x.comissaoServicoCentavos, produtoCentavos: x.comissaoProdutoCentavos, totalCentavos: x.comissaoCentavos, valesCentavos: x.valesCentavos, pagoCentavos: x.pagoCentavos })),
      totalCentavos: res.comissoesCentavos
    },
    resultado: {
      brutoCentavos: res.brutoCentavos, comissoesCentavos: res.comissoesCentavos, custoProdutosVendidosCentavos: res.custoProdutosCentavos,
      contasPagasCentavos: res.contasPagasCentavos, resultadoCentavos: res.lucroCentavos
    },
    // Lei 13.352/2016 (Salão-Parceiro): o contador confirma se a barbearia usa.
    cotaParte: { barbeariaCentavos: res.brutoCentavos - res.comissoesCentavos, profissionaisCentavos: res.comissoesCentavos },
    estoqueFim: estoque.results.filter(e => e.saldo_fim !== 0).map(e => ({ produto: e.nome, quantidade: e.saldo_fim, valorCentavos: e.saldo_fim * e.custo_medio_centavos })),
    diferencasCaixa: d.diferencasCaixa.map(x => ({ data: x.data, diferencaCentavos: x.diferenca_centavos, observacao: x.observacao })),
    lancamentos: [
      ...lancs.results.map(l => ({ data: l.data, tipo: l.tipo, descricao: l.descricao, forma: l.forma, valorCentavos: l.valor })),
      ...notasLanc.results.map(n => ({ data: n.data, tipo: "Promissória (a receber)", descricao: `${n.cliente} - ${n.descricao}`, forma: "promissoria", valorCentavos: n.valor_centavos })),
      ...notasReceb.results.map(n => ({ data: n.data, tipo: "Promissória recebida", descricao: n.cliente, forma: n.forma, valorCentavos: n.valor_centavos })),
      ...d.contasPagas.map(c => ({ data: c.pago_em, tipo: `Conta paga (${CATEGORIAS[c.categoria]})`, descricao: c.descricao, forma: c.caixa_movimento_id ? "dinheiro" : "", valorCentavos: -c.valor_centavos })),
      ...compras.results.map(m => ({ data: m.dia, tipo: "Compra de mercadoria", descricao: `${m.quantidade}x ${m.produto}${m.fornecedor ? ` (${m.fornecedor})` : ""}`, forma: "", valorCentavos: -(m.quantidade * m.custo_unit_centavos) })),
      ...d.vales.map(v => ({ data: v.data, tipo: "Vale", descricao: `${v.barbeiro}${v.descricao ? ` - ${v.descricao}` : ""}`, forma: "", valorCentavos: -v.valor_centavos })),
      ...pagos.results.map(f => ({ data: f.pago_em, tipo: "Comissão paga", descricao: `${f.barbeiro} (${dataCsv(f.data_ini)} a ${dataCsv(f.data_fim)})`, forma: f.pago_com_caixa ? "dinheiro" : "", valorCentavos: -f.a_pagar_centavos }))
    ].sort((x, y) => String(x.data).localeCompare(String(y.data)))
  };
}

export const impressaoDigital = rel => sha256(JSON.stringify(rel));

function arquivos(rel, barbeariaNome) {
  const L = [];
  const t = (texto, o = {}) => L.push({ texto, ...o });
  t(`${barbeariaNome} — Relatório para o contador`, { tamanho: 15, negrito: true });
  t(`Período: ${rel.periodo.titulo} (${dataCsv(rel.periodo.ini)} a ${dataCsv(rel.periodo.fim)}) · gerado em ${dataCsv(hojeBrasil())}`, { tamanho: 9 });
  t("Entradas (valor bruto)", { tamanho: 12, negrito: true, espaco: 10 });
  for (const f of FORMAS) t(`${NOME_FORMA[f]}: serviços ${reais(rel.entradas.servicosPorForma[f])} · produtos ${reais(rel.entradas.produtosPorForma[f])}`);
  t(`Total: serviços ${reais(rel.entradas.servicosCentavos)} + produtos ${reais(rel.entradas.produtosCentavos)} = ${reais(rel.entradas.totalCentavos)}`, { negrito: true });
  if (rel.promissorias.lancadasCentavos || rel.promissorias.recebidasCentavos) {
    t(`Promissórias (notas): lançadas no período ${reais(rel.promissorias.lancadasCentavos)} (já incluídas no total acima, sem entrada de dinheiro) · recebidas no período ${reais(rel.promissorias.recebidasCentavos)}`);
    t(`Recebidas por forma: ${FORMAS.map(f => `${NOME_FORMA[f]} ${reais(rel.promissorias.recebidasPorForma[f])}`).join(" · ")}`);
  }
  t("Saídas", { tamanho: 12, negrito: true, espaco: 10 });
  for (const [k, v] of Object.entries(rel.saidas.contasPagasPorCategoria)) if (v) t(`Contas pagas - ${CATEGORIAS[k]}: ${reais(v)}`);
  t(`Total de contas pagas: ${reais(rel.saidas.contasPagasCentavos)}`);
  t(`Compras de mercadoria: ${reais(rel.saidas.comprasMercadoriaCentavos)}`);
  t(`Sangrias (retiradas avulsas): ${reais(rel.saidas.sangriasAvulsasCentavos)}`);
  t("Comissões e vales", { tamanho: 12, negrito: true, espaco: 10 });
  for (const c of rel.comissoes.porBarbeiro) t(`${c.nome}: comissões ${reais(c.totalCentavos)} (serviços ${reais(c.servicoCentavos)} + produtos ${reais(c.produtoCentavos)}) · vales ${reais(c.valesCentavos)} · pago ${reais(c.pagoCentavos)}`);
  t(`Total de comissões: ${reais(rel.comissoes.totalCentavos)}`, { negrito: true });
  t("Resultado do período", { tamanho: 12, negrito: true, espaco: 10 });
  t(`Bruto ${reais(rel.resultado.brutoCentavos)} − comissões ${reais(rel.resultado.comissoesCentavos)} − custo dos produtos vendidos ${reais(rel.resultado.custoProdutosVendidosCentavos)} − contas pagas ${reais(rel.resultado.contasPagasCentavos)}`);
  t(`Resultado: ${reais(rel.resultado.resultadoCentavos)}`, { negrito: true });
  t("Cota-parte (Lei 13.352/2016 - Salão-Parceiro; o contador confirma se a barbearia usa)", { tamanho: 12, negrito: true, espaco: 10 });
  t(`Cota-parte da barbearia: ${reais(rel.cotaParte.barbeariaCentavos)} · cota-parte dos profissionais: ${reais(rel.cotaParte.profissionaisCentavos)}`);
  t("Estoque no fim do período (pelo custo médio)", { tamanho: 12, negrito: true, espaco: 10 });
  if (rel.estoqueFim.length) for (const e of rel.estoqueFim) t(`${e.produto}: ${e.quantidade} un. · ${reais(e.valorCentavos)}`); else t("Sem estoque.");
  t("Diferenças de caixa", { tamanho: 12, negrito: true, espaco: 10 });
  if (rel.diferencasCaixa.length) for (const x of rel.diferencasCaixa) t(`${dataCsv(x.data)}: ${x.diferencaCentavos > 0 ? "sobra" : "falta"} de ${reais(Math.abs(x.diferencaCentavos))}${x.observacao ? ` (${x.observacao})` : ""}`); else t("Nenhuma.");
  t("Lista de lançamentos", { tamanho: 12, negrito: true, espaco: 10 });
  for (const l of rel.lancamentos) t(`${dataCsv(l.data)}  ${l.tipo}  ${l.descricao || ""}  ${NOME_FORMA[l.forma] || ""}  ${reais(l.valorCentavos)}`, { tamanho: 8 });
  t("Documento gerencial para conferência; não é nota fiscal.", { tamanho: 8, espaco: 12 });
  const pdf = gerarPdf(L, { rodape: `4blade · ${barbeariaNome} · ${rel.periodo.titulo}` });
  const csv = gerarCsv(["Data", "Tipo", "Descrição", "Forma", "Valor (R$)"],
    rel.lancamentos.map(l => [dataCsv(l.data), l.tipo, l.descricao, NOME_FORMA[l.forma] || "", dinheiroCsv(l.valorCentavos)]));
  return { nomeBase: `contador-${rel.periodo.referencia}`, pdfBase64: base64(pdf), csv };
}

// ---------- cópia dos dados (planilhas) ----------
const EXPORTAR = {
  clientes: {
    sql: "SELECT nome, telefone, observacao, aceite_lgpd, aceite_lgpd_em, ativo, criado_em FROM clientes WHERE barbearia_id = ? ORDER BY nome",
    cab: ["Nome", "Telefone", "Observação", "Aceite LGPD", "Aceite em", "Ativo", "Cadastrado em"],
    linha: r => [r.nome, telefoneReal(r.telefone), r.observacao, r.aceite_lgpd ? "sim" : "não", dataCsv(r.aceite_lgpd_em), r.ativo ? "sim" : "não", dataCsv(r.criado_em)]
  },
  atendimentos: {
    sql: `SELECT a.data, substr(a.inicio, 12) AS hora, u.nome AS barbeiro, c.nome AS cliente, c.telefone, a.situacao, a.motivo,
            (SELECT group_concat(nome, ' + ') FROM agendamento_servicos s WHERE s.agendamento_id = a.id) AS servicos,
            f.total_centavos, f.valor_alterado, cm.valor_centavos AS comissao
          FROM agendamentos a JOIN usuarios u ON u.id = a.barbeiro_id JOIN clientes c ON c.id = a.cliente_id
          LEFT JOIN finalizacoes f ON f.agendamento_id = a.id AND f.estornada = 0 LEFT JOIN comissoes cm ON cm.finalizacao_id = f.id
          WHERE a.barbearia_id = ? ORDER BY a.inicio`,
    cab: ["Data", "Hora", "Profissional", "Cliente", "Telefone", "Situação", "Motivo", "Serviços", "Valor (R$)", "Valor alterado", "Comissão (R$)"],
    linha: r => [dataCsv(r.data), r.hora, r.barbeiro, r.cliente, telefoneReal(r.telefone), r.situacao, r.motivo, r.servicos, dinheiroCsv(r.total_centavos), r.valor_alterado ? "sim" : "", dinheiroCsv(r.comissao)]
  },
  caixa: {
    sql: `SELECT c.data, l.criado_em AS em, l.tipo, l.forma, l.valor_centavos, '' AS motivo FROM caixa_lancamentos l JOIN caixas c ON c.id = l.caixa_id WHERE l.barbearia_id = ?1
          UNION ALL SELECT c.data, m.criado_em, m.tipo, m.forma, m.valor_centavos, m.motivo FROM caixa_movimentos m JOIN caixas c ON c.id = m.caixa_id WHERE m.barbearia_id = ?1
          UNION ALL SELECT c.data, c.aberto_em, 'abertura (troco)', 'dinheiro', c.troco_centavos, '' FROM caixas c WHERE c.barbearia_id = ?1
          UNION ALL SELECT c.data, f.fechado_em, CASE f.ativo WHEN 1 THEN 'fechamento' ELSE 'fechamento (reaberto)' END, 'dinheiro', f.diferenca_centavos, f.observacao
            FROM caixa_fechamentos f JOIN caixas c ON c.id = f.caixa_id WHERE f.barbearia_id = ?1
          ORDER BY 1, 2`,
    cab: ["Dia do caixa", "Registrado em (UTC)", "Tipo", "Forma", "Valor (R$)", "Motivo / observação"],
    linha: r => [dataCsv(r.data), r.em, r.tipo, r.forma, dinheiroCsv(r.valor_centavos), r.motivo]
  },
  estoque: {
    sql: `SELECT p.nome, p.codigo, p.preco_centavos, p.custo_medio_centavos, COALESCE(e.saldo, 0) AS saldo, p.estoque_minimo, p.validade, p.ativo
          FROM produtos p LEFT JOIN produto_estoque e ON e.produto_id = p.id WHERE p.barbearia_id = ? ORDER BY p.nome`,
    cab: ["Produto", "Código", "Preço (R$)", "Custo médio (R$)", "Saldo", "Mínimo", "Validade", "Ativo"],
    linha: r => [r.nome, r.codigo, dinheiroCsv(r.preco_centavos), dinheiroCsv(r.custo_medio_centavos), r.saldo, r.estoque_minimo, dataCsv(r.validade), r.ativo ? "sim" : "não"]
  },
  "estoque-movimentos": {
    sql: `SELECT m.criado_em, p.nome, m.tipo, m.quantidade, m.custo_unit_centavos, m.fornecedor, m.validade, m.motivo, u.nome AS usuario
          FROM estoque_movimentos m JOIN produtos p ON p.id = m.produto_id JOIN usuarios u ON u.id = m.criado_por WHERE m.barbearia_id = ? ORDER BY m.criado_em`,
    cab: ["Registrado em (UTC)", "Produto", "Tipo", "Quantidade", "Custo unit. (R$)", "Fornecedor", "Validade", "Motivo", "Quem"],
    linha: r => [r.criado_em, r.nome, r.tipo, r.quantidade, dinheiroCsv(r.custo_unit_centavos), r.fornecedor, dataCsv(r.validade), r.motivo, r.usuario]
  },
  contas: {
    sql: "SELECT descricao, categoria, valor_centavos, vencimento, recorrente, situacao, pago_em, caixa_movimento_id, motivo_cancelamento FROM contas WHERE barbearia_id = ? ORDER BY vencimento",
    cab: ["Descrição", "Categoria", "Valor (R$)", "Vencimento", "Recorrente", "Situação", "Pago em", "Pago com caixa", "Motivo cancelamento"],
    linha: r => [r.descricao, CATEGORIAS[r.categoria], dinheiroCsv(r.valor_centavos), dataCsv(r.vencimento), r.recorrente ? "sim" : "não", r.situacao, dataCsv(r.pago_em), r.caixa_movimento_id ? "sim" : "", r.motivo_cancelamento]
  },
  comissoes: {
    sql: `SELECT c.data, u.nome, 'serviço' AS tipo, cm.base_centavos, cm.percentual_bp, cm.valor_centavos, cm.estornada FROM comissoes cm
            JOIN finalizacoes f ON f.id = cm.finalizacao_id JOIN caixas c ON c.id = f.caixa_id JOIN usuarios u ON u.id = cm.barbeiro_id WHERE cm.barbearia_id = ?1
          UNION ALL SELECT c.data, u.nome, 'produto', cp.base_centavos, cp.percentual_bp, cp.valor_centavos, cp.estornada FROM comissoes_produto cp
            JOIN vendas v ON v.id = cp.venda_id JOIN caixas c ON c.id = v.caixa_id JOIN usuarios u ON u.id = cp.barbeiro_id WHERE cp.barbearia_id = ?1
          UNION ALL SELECT v.data, u.nome, 'vale', NULL, NULL, -v.valor_centavos, CASE v.situacao WHEN 'cancelado' THEN 1 ELSE 0 END FROM vales v
            JOIN usuarios u ON u.id = v.barbeiro_id WHERE v.barbearia_id = ?1
          ORDER BY 1, 2`,
    cab: ["Data", "Profissional", "Tipo", "Base (R$)", "Percentual", "Valor (R$)", "Estornado/cancelado"],
    linha: r => [dataCsv(r.data), r.nome, r.tipo, dinheiroCsv(r.base_centavos), r.percentual_bp === null ? "" : `${(r.percentual_bp / 100).toString().replace(".", ",")}%`, dinheiroCsv(r.valor_centavos), r.estornada ? "sim" : ""]
  }
};

export async function rotasContador(ctx, path, method) {
  const raiz = path.split("/")[1];
  if (!["contador", "configuracoes", "exportar"].includes(raiz)) return null;
  exigirGestao(ctx);
  const { db, user, request } = ctx;

  if (path === "/configuracoes/contador" && method === "GET") {
    const c = await db.prepare("SELECT * FROM configuracoes WHERE barbearia_id = ?").bind(ctx.barbeariaId).first();
    return json({ contador: { nome: c?.contador_nome || null, telefone: c?.contador_telefone || null, email: c?.contador_email || null } });
  }
  if (path === "/configuracoes/contador" && method === "POST") {
    const input = await readJson(request);
    const nome = textoOpcional(input.nome, 80);
    const email = textoOpcional(input.email, 120);
    if (nome === false || email === false) erro("Texto muito longo.");
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) erro("E-mail inválido.");
    let telefone = null;
    if (input.telefone) { telefone = normalizarTelefone(input.telefone); if (!telefone) erro("WhatsApp inválido (DDD + número)."); }
    const antes = await db.prepare("SELECT contador_nome, contador_telefone, contador_email FROM configuracoes WHERE barbearia_id = ?").bind(ctx.barbeariaId).first();
    await db.batch([
      db.prepare(`INSERT INTO configuracoes (barbearia_id, contador_nome, contador_telefone, contador_email) VALUES (?, ?, ?, ?)
                  ON CONFLICT(barbearia_id) DO UPDATE SET contador_nome = excluded.contador_nome, contador_telefone = excluded.contador_telefone,
                  contador_email = excluded.contador_email, atualizado_em = CURRENT_TIMESTAMP`).bind(ctx.barbeariaId, nome, telefone, email),
      auditoria(ctx, "contador_alterado", ctx.barbeariaId, { antes: antes || null, depois: { nome, telefone, email } })
    ]);
    return json({ contador: { nome, telefone, email } });
  }

  // Prévia dos números (sem registrar envio).
  if (path === "/contador/relatorio" && method === "GET") {
    const url = new URL(request.url);
    const per = lerReferencia(url.searchParams.get("tipo"), url.searchParams.get("ref"));
    return json({ relatorio: await relatorioContador(ctx, per) });
  }

  // Gera PDF + planilha e registra o envio (com a impressão digital dos dados).
  if (path === "/contador/enviar" && method === "POST") {
    const input = await readJson(request);
    const per = lerReferencia(input.tipo, input.ref);
    const rel = await relatorioContador(ctx, per);
    const impressao = await impressaoDigital(rel);
    const id = crypto.randomUUID();
    await db.batch([
      db.prepare("INSERT INTO envios_contador (id, barbearia_id, tipo, referencia, data_ini, data_fim, impressao, criado_por) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
        .bind(id, ctx.barbeariaId, per.tipo, per.ref, per.ini, per.fim, impressao, user.id),
      auditoria(ctx, "envio_contador", id, { tipo: per.tipo, referencia: per.ref })
    ]);
    const contador = await db.prepare("SELECT contador_nome, contador_telefone, contador_email FROM configuracoes WHERE barbearia_id = ?").bind(ctx.barbeariaId).first();
    return json({
      envio: { id, tipo: per.tipo, referencia: per.ref },
      relatorio: rel,
      contador: contador ? { nome: contador.contador_nome, telefone: contador.contador_telefone, email: contador.contador_email } : null,
      arquivos: arquivos(rel, user.barbearia_nome)
    }, 201);
  }

  // Envios registrados; avisa se os dados do período mudaram depois do envio.
  if (path === "/contador/envios" && method === "GET") {
    const r = await db.prepare(`SELECT e.*, u.nome AS usuario FROM envios_contador e JOIN usuarios u ON u.id = e.criado_por
                                WHERE e.barbearia_id = ? ORDER BY e.criado_em DESC, e.rowid DESC LIMIT 12`).bind(ctx.barbeariaId).all();
    const atuais = {};
    const envios = [];
    for (const e of r.results) {
      const chave = `${e.tipo}:${e.referencia}`;
      // recalcula no máximo 2 períodos por consulta (limite de consultas por pedido)
      if (!(chave in atuais) && Object.keys(atuais).length < 2) {
        atuais[chave] = await impressaoDigital(await relatorioContador(ctx, lerReferencia(e.tipo, e.referencia)));
      }
      const ultimoDoPeriodo = !envios.some(x => x.chave === chave);
      envios.push({
        chave, id: e.id, tipo: e.tipo, referencia: e.referencia, em: e.criado_em, por: e.usuario,
        alteradoDepois: ultimoDoPeriodo && chave in atuais ? atuais[chave] !== e.impressao : null
      });
    }
    return json({ envios: envios.map(({ chave, ...x }) => x) });
  }

  if (raiz === "exportar" && method === "GET") {
    const nome = path.split("/")[2];
    const def = EXPORTAR[nome];
    if (!def) return fail("Planilha não encontrada.", 404);
    const r = await db.prepare(def.sql).bind(ctx.barbeariaId).all();
    await auditoria(ctx, "dados_exportados", nome).run();
    return new Response(gerarCsv(def.cab, r.results.map(def.linha)), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="4blade-${nome}-${hojeBrasil()}.csv"`,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff"
      }
    });
  }

  return fail("Rota não encontrada", 404);
}

export const PLANILHAS = Object.keys(EXPORTAR);
