// Relatório financeiro (seção 18): entradas, saídas, série do gráfico, comparação, divisões e permissões.
// Base: a semana simulada de 02 a 08/11/2026 (mesma do teste da gestão), números conferidos à mão.
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import { emDia, voltar, semanaSimulada } from "./semana-gestao.js";
import { periodoFinanceiro } from "../src/financeiro.js";
after(voltar);

describe("relatório financeiro", () => {
  test("períodos: dia, semana (segunda a domingo), mês e ano, com o período anterior", () => {
    assert.deepEqual(periodoFinanceiro("dia", "2026-11-05"), { tipo: "dia", ini: "2026-11-05", fim: "2026-11-05", titulo: "05/11/2026", anterior: { ini: "2026-11-04", fim: "2026-11-04" } });
    const s = periodoFinanceiro("semana", "2026-11-05");   // quinta → semana de 02 (segunda) a 08 (domingo)
    assert.deepEqual([s.ini, s.fim, s.anterior.ini, s.anterior.fim], ["2026-11-02", "2026-11-08", "2026-10-26", "2026-11-01"]);
    assert.equal(periodoFinanceiro("semana", "2026-11-08").ini, "2026-11-02", "domingo fica na semana que começou na segunda");
    const m = periodoFinanceiro("mes", "2026-03-15");
    assert.deepEqual([m.ini, m.fim, m.titulo, m.anterior.ini, m.anterior.fim], ["2026-03-01", "2026-03-31", "março de 2026", "2026-02-01", "2026-02-28"]);
    const a = periodoFinanceiro("ano", "2026-07-01");
    assert.deepEqual([a.ini, a.fim, a.anterior.ini, a.anterior.fim], ["2026-01-01", "2026-12-31", "2025-01-01", "2025-12-31"]);
    assert.throws(() => periodoFinanceiro("trimestre", "2026-11-05"), /Período inválido/);
  });

  test("semana simulada: entradas, saídas, saldo, resultado, gráfico e divisões", async () => {
    const s = await semanaSimulada();
    const { get, ger } = s;
    emDia("2026-11-08");
    const r = await get("/api/financeiro?periodo=semana&data=2026-11-05", ger.token);
    assert.equal(r.status, 200, JSON.stringify(r.dados));
    const f = r.dados;
    assert.equal(f.periodo.ini, "2026-11-02");
    // Entradas (caixa): 70 + 115 + 35 + 130 + 85 + 30 + 70 = 535,00
    // Saídas: compra de 6 pomadas × 20,00 = 120,00 · vales 20,00 + 50,00 (o de 10,00 foi cancelado) · contas 1.500,00 + 300,00
    //   = 1.990,00 (a sangria da conta do fornecedor não conta duas vezes)
    // Resultado = bruto 535 − comissões 178 − custo dos produtos 80 − contas pagas 1.800 = −1.523,00
    assert.deepEqual(f.totais, {
      faturamentoCentavos: 53500, entradasCentavos: 53500, saidasCentavos: 199000, saldoCentavos: -145500,
      resultadoCentavos: -152300, atendimentosQtd: 8, vendasQtd: 3
    });
    assert.deepEqual(f.anterior, { faturamentoCentavos: 0, entradasCentavos: 0, saidasCentavos: 0, saldoCentavos: 0, resultadoCentavos: 0, atendimentosQtd: 0, vendasQtd: 0 });
    assert.deepEqual(f.serie.pontos.map(p => [p.chave.slice(8), p.entradasCentavos, p.saidasCentavos]), [
      ["02", 7000, 12000], ["03", 11500, 0], ["04", 3500, 2000], ["05", 13000, 150000], ["06", 8500, 5000], ["07", 3000, 0], ["08", 7000, 30000]
    ]);
    // Por forma: pix serviços 40+40+30+70 / produtos 45+45 · dinheiro 30+40 / 90 · crédito 70 · débito 35
    assert.deepEqual(f.entradas.porForma, {
      dinheiro: { servicosCentavos: 7000, produtosCentavos: 9000, notasCentavos: 0 },
      pix: { servicosCentavos: 18000, produtosCentavos: 9000, notasCentavos: 0 },
      debito: { servicosCentavos: 3500, produtosCentavos: 0, notasCentavos: 0 },
      credito: { servicosCentavos: 7000, produtosCentavos: 0, notasCentavos: 0 }
    });
    assert.equal(f.entradas.servicosCentavos, 35500);
    assert.equal(f.entradas.produtosCentavos, 18000);
    assert.deepEqual(f.saidas.contasPorCategoria.filter(c => c.valorCentavos).map(c => [c.nome, c.valorCentavos]), [["Aluguel", 150000], ["Fornecedor", 30000]]);
    assert.equal(f.saidas.comprasMercadoriaCentavos, 12000);
    assert.equal(f.saidas.valesCentavos, 7000);
    assert.equal(f.saidas.comissoesPagasCentavos, 0);
    assert.equal(f.saidas.retiradasCentavos, 0);
    // Destaques: ticket médio 355,00 / 8 = 44,375 → 44,38 · média por dia 535 / 7 = 76,43 · melhor dia 05/11 (130,00)
    assert.equal(f.destaques.ticketMedioCentavos, 4438);
    assert.equal(f.destaques.mediaPorDiaCentavos, 7643);
    assert.deepEqual(f.destaques.melhor, { chave: "2026-11-05", entradasCentavos: 13000 });
    assert.equal(f.destaques.comissoesCentavos, 17800);
    assert.equal(f.destaques.diferencasCaixa.length, 1, "falta de 10,00 no dia 07");
    // Mais vendidos: Corte 6× (40+40+35+40+40+40 = 235,00), Barba 4× (120,00); Pomada 4 un. (180,00)
    assert.deepEqual(f.maisVendidos.servicos.map(x => [x.nome, x.qtd, x.totalCentavos]), [["Corte", 6, 23500], ["Barba", 4, 12000]]);
    assert.deepEqual(f.maisVendidos.produtos.map(x => [x.nome, x.qtd, x.totalCentavos]), [["Pomada", 4, 18000]]);
    // Profissionais: beto 175 + 90 = 265 · ana 180 + 45 = 225 (a venda do caixa não tem profissional)
    assert.deepEqual(f.profissionais.map(p => [p.nome, p.atendimentosQtd, p.servicosCentavos, p.produtosCentavos]),
      [["Pessoa beto.alfa", 4, 17500, 9000], ["Pessoa ana.alfa", 4, 18000, 4500]]);
    // Movimentos: a soma das entradas e das saídas bate com os totais
    const soma = c => f.movimentos.filter(m => m.classe === c).reduce((t, m) => t + m.valorCentavos, 0);
    assert.equal(soma("entrada"), 53500);
    assert.equal(soma("saida"), -199000);
    assert.equal(f.movimentosTotal, f.movimentos.length);
    assert.ok(f.movimentos.some(m => m.tipo === "Conta paga (Fornecedor)"));
    assert.ok(!f.movimentos.some(m => m.tipo === "Sangria"), "sangria da conta não aparece repetida");
    assert.ok(f.movimentos[0].data >= f.movimentos[f.movimentos.length - 1].data, "mais recentes primeiro");
  });

  test("dia, mês e ano: comparação com o anterior e gráfico", async () => {
    const s = await semanaSimulada();
    const { get, ger } = s;
    emDia("2026-11-08");
    const d = (await get("/api/financeiro?periodo=dia&data=2026-11-05", ger.token)).dados;
    assert.deepEqual([d.totais.entradasCentavos, d.totais.saidasCentavos], [13000, 150000]);
    assert.deepEqual([d.anterior.entradasCentavos, d.anterior.saidasCentavos], [3500, 2000], "dia anterior (04/11)");
    assert.deepEqual(d.serie.pontos.map(p => p.entradasCentavos), [0, 0, 0, 7000, 11500, 3500, 13000], "7 dias que terminam no dia escolhido");
    assert.equal(d.destaques.melhor, null);
    const m = (await get("/api/financeiro?periodo=mes&data=2026-11-20", ger.token)).dados;
    assert.equal(m.serie.pontos.length, 30);
    assert.deepEqual([m.totais.entradasCentavos, m.totais.saidasCentavos], [53500, 199000]);
    assert.equal(m.destaques.mediaPorDiaCentavos, Math.round(53500 / 8), "mês: média até hoje (8 dias)");
    const a = (await get("/api/financeiro?periodo=ano&data=2026-11-20", ger.token)).dados;
    assert.equal(a.serie.porMes, true);
    assert.equal(a.serie.pontos.length, 12);
    assert.deepEqual(a.serie.pontos[10], { chave: "2026-11", entradasCentavos: 53500, saidasCentavos: 199000 });
    assert.ok(a.serie.pontos.filter((p, i) => i !== 10).every(p => !p.entradasCentavos && !p.saidasCentavos));
    // o dono (que também é gerente) vê o mesmo
    assert.equal((await get("/api/financeiro?periodo=ano&data=2026-11-20", s.b.prop)).dados.totais.entradasCentavos, 53500);
  });

  test("permissões, validação e isolamento entre barbearias", async () => {
    const s = await semanaSimulada();
    const { get, ger, A, cx, p, criarBarbearia } = s;
    voltar();
    for (const quem of [A, cx]) assert.equal((await get("/api/financeiro?periodo=mes&data=2026-11-05", quem.token)).status, 403);
    assert.equal((await get("/api/financeiro?periodo=mes&data=2026-11-05", null)).status, 401);
    assert.equal((await get("/api/financeiro?periodo=trimestre&data=2026-11-05", ger.token)).status, 400);
    assert.equal((await get("/api/financeiro?periodo=mes&data=05/11/2026", ger.token)).status, 400);
    assert.equal((await get("/api/financeiro?periodo=mes", ger.token)).status, 200, "sem data = hoje");
    // outra barbearia (mesmo banco) não vê nada da alfa
    const beta = await criarBarbearia(p, "beta");
    const fb = (await get("/api/financeiro?periodo=mes&data=2026-11-05", beta.prop)).dados;
    assert.deepEqual([fb.totais.entradasCentavos, fb.totais.saidasCentavos, fb.movimentos.length, fb.profissionais.length, fb.maisVendidos.servicos.length], [0, 0, 0, 0, 0]);
  });
});
