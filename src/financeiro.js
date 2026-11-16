// Relatório financeiro (ESPECIFICACAO.md seção 18): entradas e saídas da barbearia por dia, semana, mês ou ano,
// com série para gráfico, comparação com o período anterior, divisões e a lista de movimentos.
// Só proprietário e gerente. Tudo filtrado pela barbearia da sessão; o dia de um lançamento = dia do caixa.
import { json, fail, HttpError, validDate, hojeBrasil } from "./util.js";
import { exigirBarbearia, exigirGestao } from "./usuarios.js";
import { somarDias, FORMAS } from "./agenda-util.js";
import { somarMes, porBarbeiro, resultado, CATEGORIAS } from "./gestao.js";
import { relatorioComDados } from "./contador.js";

const erro = (msg, status = 400) => { throw new HttpError(msg, status); };
const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const dataBR = d => d.split("-").reverse().join("/");
const diaDaSemana = d => new Date(`${d}T12:00:00Z`).getUTCDay();   // 0 = domingo
const LIMITE_MOVIMENTOS = 400;

// Período escolhido: dia; semana de segunda a domingo; mês inteiro; ano inteiro. Mais o período anterior de mesmo tipo.
export function periodoFinanceiro(tipo, data) {
  if (tipo === "dia") {
    return { tipo, ini: data, fim: data, titulo: dataBR(data), anterior: { ini: somarDias(data, -1), fim: somarDias(data, -1) } };
  }
  if (tipo === "semana") {
    const ini = somarDias(data, -((diaDaSemana(data) + 6) % 7));
    const fim = somarDias(ini, 6);
    return { tipo, ini, fim, titulo: `${dataBR(ini)} a ${dataBR(fim)}`, anterior: { ini: somarDias(ini, -7), fim: somarDias(ini, -1) } };
  }
  if (tipo === "mes") {
    const ini = `${data.slice(0, 7)}-01`;
    const ant = somarMes(ini, -1);
    const [a, m] = data.split("-").map(Number);
    return { tipo, ini, fim: somarDias(somarMes(ini, 1), -1), titulo: `${MESES[m - 1]} de ${a}`, anterior: { ini: ant, fim: somarDias(ini, -1) } };
  }
  if (tipo === "ano") {
    const a = Number(data.slice(0, 4));
    return { tipo, ini: `${a}-01-01`, fim: `${a}-12-31`, titulo: String(a), anterior: { ini: `${a - 1}-01-01`, fim: `${a - 1}-12-31` } };
  }
  erro("Período inválido: escolha dia, semana, mês ou ano.");
}

// Classifica cada lançamento do relatório do contador em entrada, saída ou "outro" (não muda o resultado).
const TIPOS_ENTRADA = new Set(["Atendimento", "Estorno de atendimento", "Venda de produto", "Venda cancelada", "Promissória recebida"]);
function classe(tipo) {
  if (TIPOS_ENTRADA.has(tipo)) return "entrada";
  if (tipo.startsWith("Conta paga") || ["Compra de mercadoria", "Vale", "Comissão paga"].includes(tipo)) return "saida";
  return "outro";
}
// Lista de movimentos: as sangrias ligadas a contas/comissões já aparecem como "Conta paga"/"Comissão paga";
// as avulsas viram "Retirada do caixa" (saída).
function movimentos(rel) {
  return [
    ...rel.lancamentos.filter(l => l.tipo !== "Sangria").map(l => ({ ...l, classe: classe(l.tipo) })),
    ...rel.saidas.sangriasAvulsas.map(s => ({ data: s.data, tipo: "Retirada do caixa", descricao: s.motivo || "", forma: "dinheiro", valorCentavos: -s.valorCentavos, classe: "saida" }))
  ];
}

// Totais de um intervalo (pode ser parte do período do relatório: o dia anterior sai dos 7 dias do gráfico).
function totais(rel, d, ini = rel.periodo.ini, fim = rel.periodo.fim) {
  const dentro = x => String(x).slice(0, 10) >= ini && String(x).slice(0, 10) <= fim;
  const movs = movimentos(rel).filter(m => dentro(m.data));
  const entradas = movs.filter(m => m.classe === "entrada").reduce((t, m) => t + m.valorCentavos, 0);
  const saidas = -movs.filter(m => m.classe === "saida").reduce((t, m) => t + m.valorCentavos, 0);
  const parte = {
    atendimentos: d.atendimentos.filter(x => dentro(x.data)), vendas: d.vendas.filter(x => dentro(x.data)),
    comissoesServico: d.comissoesServico.filter(x => dentro(x.data)), comissoesProduto: d.comissoesProduto.filter(x => dentro(x.data)),
    contasPagas: d.contasPagas.filter(x => dentro(x.pago_em))
  };
  const res = resultado(parte, { descontarContas: true });
  return {
    faturamentoCentavos: res.brutoCentavos,
    entradasCentavos: entradas,
    saidasCentavos: saidas,
    saldoCentavos: entradas - saidas,
    resultadoCentavos: res.lucroCentavos,
    atendimentosQtd: parte.atendimentos.length,
    vendasQtd: parte.vendas.length
  };
}

// Série do gráfico: um ponto por dia (ou por mês, no ano), com entradas e saídas.
function serie(rel, ini, fim, porMes) {
  const pontos = new Map();
  if (porMes) for (let m = ini.slice(0, 7); m <= fim.slice(0, 7); m = somarMes(`${m}-01`, 1).slice(0, 7)) pontos.set(m, { chave: m, entradasCentavos: 0, saidasCentavos: 0 });
  else for (let x = ini; x <= fim; x = somarDias(x, 1)) pontos.set(x, { chave: x, entradasCentavos: 0, saidasCentavos: 0 });
  for (const m of movimentos(rel)) {
    const p = pontos.get(porMes ? String(m.data).slice(0, 7) : String(m.data).slice(0, 10));
    if (!p || m.classe === "outro") continue;
    if (m.classe === "entrada") p.entradasCentavos += m.valorCentavos;
    else p.saidasCentavos -= m.valorCentavos;
  }
  return [...pontos.values()];
}

async function maisVendidos(db, b, ini, fim) {
  const [serv, prod] = await Promise.all([
    db.prepare(`SELECT i.nome, COUNT(*) AS qtd, SUM(i.preco_cobrado_centavos) AS total FROM finalizacao_itens i
                JOIN finalizacoes f ON f.id = i.finalizacao_id JOIN caixas c ON c.id = f.caixa_id
                WHERE i.barbearia_id = ? AND f.estornada = 0 AND c.data BETWEEN ? AND ? GROUP BY i.nome ORDER BY total DESC, qtd DESC LIMIT 10`).bind(b, ini, fim).all(),
    // valor do item com o desconto da venda repartido entre os itens
    db.prepare(`SELECT i.nome, SUM(i.quantidade) AS qtd,
                  ROUND(SUM(i.quantidade * i.preco_unit_centavos * 1.0 * v.total_centavos /
                    MAX(1, (SELECT SUM(x.quantidade * x.preco_unit_centavos) FROM venda_itens x WHERE x.venda_id = v.id)))) AS total
                FROM venda_itens i JOIN vendas v ON v.id = i.venda_id JOIN caixas c ON c.id = v.caixa_id
                WHERE i.barbearia_id = ? AND v.situacao = 'ativa' AND c.data BETWEEN ? AND ? GROUP BY i.nome ORDER BY total DESC, qtd DESC LIMIT 10`).bind(b, ini, fim).all()
  ]);
  const lista = r => r.results.map(x => ({ nome: x.nome, qtd: Number(x.qtd), totalCentavos: Number(x.total) }));
  return { servicos: lista(serv), produtos: lista(prod) };
}

async function relatorioFinanceiro(ctx) {
  const url = new URL(ctx.request.url);
  const hoje = hojeBrasil();
  const data = url.searchParams.get("data") || hoje;
  if (!validDate(data)) erro("Data inválida.");
  const per = periodoFinanceiro(url.searchParams.get("periodo") || "mes", data);
  // No dia, o gráfico mostra os 7 dias que terminam nele (um dia sozinho não faz gráfico); o dia anterior sai desses 7.
  // (Duas leituras do período, no máximo: o Worker tem limite de consultas por acesso.)
  const iniSerie = per.tipo === "dia" ? somarDias(per.ini, -6) : per.ini;
  const [atual, outro, top] = await Promise.all([
    relatorioComDados(ctx, { tipo: per.tipo, ref: data, ini: per.ini, fim: per.fim, titulo: per.titulo }),
    per.tipo === "dia"
      ? relatorioComDados(ctx, { tipo: "dia", ref: data, ini: iniSerie, fim: per.fim, titulo: "" })
      : relatorioComDados(ctx, { tipo: per.tipo, ref: data, ini: per.anterior.ini, fim: per.anterior.fim, titulo: "" }),
    maisVendidos(ctx.db, ctx.barbeariaId, per.ini, per.fim)
  ]);
  const anterior = per.tipo === "dia" ? totais(outro.rel, outro.d, per.anterior.ini, per.anterior.fim) : totais(outro.rel, outro.d);
  const { rel, d } = atual;
  const t = totais(rel, d);
  const formas = Object.fromEntries(FORMAS.map(f => [f, {
    servicosCentavos: rel.entradas.servicosPorForma[f], produtosCentavos: rel.entradas.produtosPorForma[f],
    notasCentavos: rel.promissorias.recebidasPorForma[f]
  }]));
  const movs = movimentos(rel);
  const somaTipo = tipo => -movs.filter(m => m.tipo === tipo).reduce((s, m) => s + m.valorCentavos, 0);
  const pontos = serie(per.tipo === "dia" ? outro.rel : rel, iniSerie, per.fim, per.tipo === "ano");
  const comMovimento = pontos.filter(p => p.entradasCentavos);
  const melhor = comMovimento.reduce((m, p) => (!m || p.entradasCentavos > m.entradasCentavos ? p : m), null);
  const diasNoPeriodo = Math.max(1, Math.min(
    (Date.parse(`${per.fim}T12:00:00Z`) - Date.parse(`${per.ini}T12:00:00Z`)) / 864e5 + 1,
    (Date.parse(`${hoje}T12:00:00Z`) - Date.parse(`${per.ini}T12:00:00Z`)) / 864e5 + 1));
  const profissionais = porBarbeiro(d, atual.profissionais).map(p => ({
    nome: p.nome, atendimentosQtd: p.atendimentosQtd, servicosCentavos: p.faturamentoCentavos,
    produtosCentavos: d.vendas.filter(v => v.vendedor_id === p.id).reduce((s, v) => s + v.total_centavos, 0),
    comissaoCentavos: p.comissaoCentavos
  })).filter(p => p.atendimentosQtd || p.produtosCentavos || p.comissaoCentavos)
    .sort((a, b) => (b.servicosCentavos + b.produtosCentavos) - (a.servicosCentavos + a.produtosCentavos));
  const ordenados = [...movs].sort((a, b) => String(b.data).localeCompare(String(a.data)));

  return json({
    periodo: { tipo: per.tipo, data, ini: per.ini, fim: per.fim, titulo: per.titulo, anterior: per.anterior, hoje },
    totais: t,
    anterior,
    resultado: rel.resultado,
    entradas: {
      servicosCentavos: rel.entradas.servicosCentavos, produtosCentavos: rel.entradas.produtosCentavos,
      notasRecebidasCentavos: rel.promissorias.recebidasCentavos, notasLancadasCentavos: rel.promissorias.lancadasCentavos,
      porForma: formas
    },
    saidas: {
      contasPorCategoria: Object.entries(rel.saidas.contasPagasPorCategoria).map(([id, valorCentavos]) => ({ id, nome: CATEGORIAS[id], valorCentavos })),
      contasCentavos: rel.saidas.contasPagasCentavos,
      comprasMercadoriaCentavos: rel.saidas.comprasMercadoriaCentavos,
      comissoesPagasCentavos: somaTipo("Comissão paga"),
      valesCentavos: somaTipo("Vale"),
      retiradasCentavos: rel.saidas.sangriasAvulsasCentavos
    },
    serie: { porMes: per.tipo === "ano", ini: iniSerie, fim: per.fim, pontos },
    destaques: {
      ticketMedioCentavos: d.atendimentos.length ? Math.round(rel.entradas.servicosCentavos / d.atendimentos.length) : 0,
      mediaPorDiaCentavos: Math.round(t.entradasCentavos / diasNoPeriodo),
      melhor: melhor && per.tipo !== "dia" ? { chave: melhor.chave, entradasCentavos: melhor.entradasCentavos } : null,
      comissoesCentavos: rel.comissoes.totalCentavos,
      custoProdutosCentavos: rel.resultado.custoProdutosVendidosCentavos,
      diferencasCaixa: rel.diferencasCaixa
    },
    profissionais,
    maisVendidos: top,
    movimentos: ordenados.slice(0, LIMITE_MOVIMENTOS),
    movimentosTotal: ordenados.length
  });
}

export async function rotasFinanceiro(ctx, path, method) {
  if (path !== "/financeiro") return null;
  exigirBarbearia(ctx);
  exigirGestao(ctx);
  if (method !== "GET") return fail("Rota não encontrada", 404);
  return relatorioFinanceiro(ctx);
}
