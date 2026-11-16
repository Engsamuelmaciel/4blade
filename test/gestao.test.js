// E4 — semana simulada com 2 barbeiros (% diferentes), vales e 3 contas: painel, fechamento de comissão, contador.
// Todos os números conferidos à mão (contas nos comentários). Dados fictícios.
// O "hoje" do sistema é simulado trocando Date.now (os acessos são feitos antes, no horário real).
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import { ambiente } from "./ambiente.js";

import { emDia, voltar, SEMANA, semanaSimulada } from "./semana-gestao.js";
after(voltar);

describe("semana simulada (conferida à mão)", () => {
  test("painel: cartões, gráfico, ranking, contas e avisos; fechamento de comissão; contador", async () => {
    const s = await semanaSimulada();
    const { get, post, env, ger, A, B, cx, ids } = s;

    // ---------- PAINEL: SEMANA (02 a 08/11) ----------
    // atendimentos: A 40+70+40+30 = 180,00 (4) · B 30+35+40+70 = 175,00 (4) → 355,00 em 8 → ticket 44,375 → 44,38
    // vendas: 45 (A) + 90 (B) + 45 (caixa) = 180,00 em 3 vendas (4 unidades)
    // bruto = 355 + 180 = 535,00
    // comissões: A 50% de 180 = 90,00 + 10% de 45 = 4,50 → 94,50 · B 40% de 175 = 70,00 + 15% de 90 = 13,50 → 83,50 · total 178,00
    // custo dos produtos vendidos = 4 × 20,00 = 80,00 · lucro semana = 535 − 178 − 80 = 277,00
    const sem = (await get("/api/painel?periodo=semana", ger.token)).dados;
    assert.deepEqual(sem.periodo, { nome: "semana", ini: "2026-11-02", fim: "2026-11-08" });
    const c = sem.cartoes;
    assert.equal(c.brutoCentavos, 53500);
    assert.equal(c.atendimentosQtd, 8);
    assert.equal(c.atendimentosCentavos, 35500);
    assert.equal(c.ticketMedioCentavos, 4438);
    assert.equal(c.vendasCentavos, 18000);
    assert.equal(c.vendasQtd, 3);
    assert.equal(c.unidadesVendidas, 4);
    assert.equal(c.comissoesCentavos, 17800);
    assert.equal(c.custoProdutosCentavos, 8000);
    assert.equal(c.lucroCentavos, 27700, "semana não desconta contas");
    const com = Object.fromEntries(c.comissoesPorBarbeiro.map(x => [x.nome, x.comissaoCentavos]));
    assert.deepEqual(com, { "Dono alfa": 0, "Pessoa ana.alfa": 9450, "Pessoa beto.alfa": 8350, "Pessoa ger.alfa": 0 }, "o dono também atende (0% de comissão por padrão)");
    // gráfico por dia: 02: 40+30 = 70 · 03: 70+45 = 115 · 04: 35 · 05: 40+90 = 130 · 06: 40+45 = 85 · 07: 30 · 08: 70
    assert.deepEqual(sem.faturamentoPorDia.map(d => d.valorCentavos), [7000, 11500, 3500, 13000, 8500, 3000, 7000]);
    assert.deepEqual(sem.ranking.slice(0, 2).map(r => [r.nome, r.faturamentoCentavos, r.atendimentosQtd]), [["Pessoa ana.alfa", 18000, 4], ["Pessoa beto.alfa", 17500, 4]]);
    // contas: luz atrasada (200,00); fornecedor paga; aluguel de dezembro (05/12) fora dos 7 dias
    assert.deepEqual(sem.contas.atrasadas, { qtd: 1, totalCentavos: 20000 });
    assert.deepEqual(sem.contas.hoje, { qtd: 0, totalCentavos: 0 });
    assert.deepEqual(sem.contas.proximos7Dias, { qtd: 0, totalCentavos: 0 });
    // avisos: pomada 6 − 4 = 2 < mínimo 3; falta de 10,00 em 07/11; 1 valor alterado; caixa de 06/11 aberto
    assert.deepEqual(sem.avisos, {
      estoqueBaixo: ["Pomada"], produtosVencendo: [],
      diferencasCaixa: [{ data: "2026-11-07", diferencaCentavos: -1000, observacao: "Falta (fictícia)" }],
      valoresAlterados: 1, caixasAbertosDiasAnteriores: ["2026-11-06"],
      notasAbertas: { clientes: 0, notas: 0, totalCentavos: 0 }
    });

    // ---------- PAINEL: HOJE (08/11) ---------- B 70,00 pix; comissão 40% = 28,00; lucro 42,00
    const hoje = (await get("/api/painel?periodo=hoje", ger.token)).dados.cartoes;
    assert.deepEqual([hoje.brutoCentavos, hoje.atendimentosQtd, hoje.ticketMedioCentavos, hoje.vendasCentavos, hoje.comissoesCentavos, hoje.lucroCentavos],
      [7000, 1, 7000, 0, 2800, 4200]);

    // ---------- PAINEL: MÊS (01 a 08/11) ---------- mesmo movimento − contas pagas (1.500 + 300 = 1.800,00) = 277 − 1.800 = −1.523,00
    const mes = (await get("/api/painel?periodo=mes", ger.token)).dados;
    assert.equal(mes.cartoes.contasPagasCentavos, 180000);
    assert.equal(mes.cartoes.lucroCentavos, -152300);
    assert.equal(mes.faturamentoPorDia.length, 30);

    // conta recorrente gerou a de dezembro (05/12); conta paga com caixa virou sangria de 300,00 no caixa de hoje
    const contas = (await get("/api/contas?todas=1", ger.token)).dados.contas;
    assert.ok(contas.some(k => k.descricao === "Aluguel do salão" && k.vencimento === "2026-12-05" && k.situacao === "aberta"));
    const cxHoje = (await get("/api/caixa/hoje", cx.token)).dados;
    assert.equal(cxHoje.totais.sangriasCentavos, 30000);
    assert.equal(cxHoje.totais.dinheiroEsperadoCentavos, 50000 - 30000);

    // ---------- DESEMPENHO DO BARBEIRO (só dele) ----------
    const dA = (await get("/api/desempenho?periodo=semana", A.token)).dados;
    assert.deepEqual([dA.atendimentosQtd, dA.faturamentoCentavos, dA.comissaoCentavos, dA.valesCentavos], [4, 18000, 9450, 2000]);
    assert.deepEqual(dA.proximoFechamento, { desde: null, comissoesCentavos: 9450, valesCentavos: 2000, previstoCentavos: 7450 });
    const dAoutro = (await get(`/api/desempenho?periodo=semana&barbeiroId=${B.id}`, A.token)).dados;
    assert.equal(dAoutro.barbeiro.id, A.id, "barbeiro não vê o de outro (ignora o parâmetro)");

    // ---------- FECHAMENTO DE COMISSÃO (02 a 08/11) ----------
    // A: 94,50 − vale 20,00 = 74,50 · B: 83,50 − vale 50,00 (o de 10,00 foi cancelado) = 33,50
    const previa = (await get("/api/comissoes/previa?dataIni=2026-11-02&dataFim=2026-11-08", ger.token)).dados.barbeiros;
    const pv = Object.fromEntries(previa.map(x => [x.nome, [x.comissaoServicoCentavos, x.comissaoProdutoCentavos, x.valesCentavos, x.aPagarCentavos]]));
    assert.deepEqual(pv, { "Pessoa ana.alfa": [9000, 450, 2000, 7450], "Pessoa beto.alfa": [7000, 1350, 5000, 3350] });
    assert.equal((await post("/api/comissoes/fechar", ger.token, { dataIni: "2026-11-02", dataFim: "2026-11-09" })).status, 400, "período que não terminou");
    const fch = await post("/api/comissoes/fechar", ger.token, { dataIni: "2026-11-02", dataFim: "2026-11-08" });
    assert.equal(fch.status, 201, JSON.stringify(fch.dados));
    assert.deepEqual(fch.dados.fechamentos.map(f => [f.nome, f.aPagarCentavos]).sort(), [["Pessoa ana.alfa", 7450], ["Pessoa beto.alfa", 3350]]);

    // fechado não muda: novo fechamento sobreposto, reabrir atendimento, vale no período e cancelar vale fechado são recusados
    assert.equal((await post("/api/comissoes/fechar", ger.token, { dataIni: "2026-11-08", dataFim: "2026-11-08" })).status, 409);
    const re = await post("/api/agenda/reabrir", ger.token, { id: s.ids.ultimo, motivo: "teste" });
    assert.equal(re.status, 409);
    assert.match(re.dados.erro, /fechamento de comissão/);
    assert.equal((await post("/api/vales", ger.token, { barbeiroId: B.id, valorCentavos: 100, data: "2026-11-05" })).status, 409);
    const valeA = env.DB.raw.prepare("SELECT id FROM vales WHERE barbeiro_id = ? AND situacao = 'ativo'").get(A.id).id;
    assert.equal((await post("/api/vales/cancelar", ger.token, { id: valeA, motivo: "teste" })).status, 409);
    // pagar a comissão de A (registro do valor pago)
    const fA = fch.dados.fechamentos.find(f => f.barbeiroId === A.id);
    assert.equal((await post("/api/comissoes/fechamentos/pagar", ger.token, { id: fA.id })).status, 200);
    assert.equal((await post("/api/comissoes/fechamentos/pagar", ger.token, { id: fA.id })).status, 409);
    const dA2 = (await get("/api/desempenho?periodo=semana", A.token)).dados;
    assert.deepEqual(dA2.proximoFechamento, { desde: "2026-11-09", comissoesCentavos: 0, valesCentavos: 0, previstoCentavos: 0 });

    // ---------- ENVIAR AO CONTADOR (novembro/2026) ----------
    const env1 = await post("/api/contador/enviar", ger.token, { tipo: "mes", ref: "2026-11" });
    assert.equal(env1.status, 201);
    const r = env1.dados.relatorio;
    // entradas por forma: pix = 40 + 45 + 40 + 45 + 30 + 70 = 270 (serviços 180 + produtos 90) · dinheiro = 30 + 90 + 40 = 160 · crédito 70 · débito 35
    assert.deepEqual(r.entradas.servicosPorForma, { dinheiro: 7000, pix: 18000, debito: 3500, credito: 7000 });
    assert.deepEqual(r.entradas.produtosPorForma, { dinheiro: 9000, pix: 9000, debito: 0, credito: 0 });
    assert.equal(r.entradas.totalCentavos, 53500);
    assert.deepEqual(r.saidas.contasPagasPorCategoria, { aluguel: 150000, luz: 0, agua: 0, fornecedor: 30000, outros: 0 });
    assert.equal(r.saidas.comprasMercadoriaCentavos, 12000, "6 × 20,00");
    assert.equal(r.saidas.sangriasAvulsasCentavos, 0, "a sangria do fornecedor já está nas contas pagas");
    assert.deepEqual(r.comissoes.porBarbeiro.map(x => [x.nome, x.totalCentavos, x.valesCentavos, x.pagoCentavos]),
      [["Pessoa ana.alfa", 9450, 2000, 7450], ["Pessoa beto.alfa", 8350, 5000, 0]], "a comissão de A foi paga em 08/11");
    assert.equal(r.resultado.resultadoCentavos, -152300);
    assert.deepEqual(r.cotaParte, { barbeariaCentavos: 53500 - 17800, profissionaisCentavos: 17800 });
    assert.deepEqual(r.estoqueFim, [{ produto: "Pomada", quantidade: 2, valorCentavos: 4000 }]);
    assert.deepEqual(r.diferencasCaixa, [{ data: "2026-11-07", diferencaCentavos: -1000, observacao: "Falta (fictícia)" }]);
    // 8 atendimentos + 3 vendas + 1 sangria (do fornecedor) + 2 contas pagas + 1 compra + 2 vales + 1 comissão paga = 18
    assert.equal(r.lancamentos.length, 18);
    // arquivos: PDF válido e planilha com ponto e vírgula
    const pdf = Buffer.from(env1.dados.arquivos.pdfBase64, "base64").toString("latin1");
    assert.match(pdf, /^%PDF-1\.4/);
    assert.match(pdf, /%%EOF\n$/);
    assert.match(pdf, /Cota-parte da barbearia: R\$ 357,00/);
    assert.match(env1.dados.arquivos.csv, /^﻿Data;Tipo;Descrição;Forma;Valor \(R\$\)/);
    assert.match(env1.dados.arquivos.csv, /Conta paga \(Aluguel\);Aluguel do salão;;-1500,00/);

    // sem alteração depois do envio → sem aviso; mudou algo no período → aviso "gere de novo"
    assert.equal((await get("/api/contador/envios", ger.token)).dados.envios[0].alteradoDepois, false);
    emDia("2026-11-08");
    assert.equal((await post("/api/vendas/cancelar", cx.token, { id: ids.vendaCaixa, motivo: "Cliente devolveu" })).status, 200);
    voltar();
    const envios = (await get("/api/contador/envios", ger.token)).dados.envios;
    assert.equal(envios[0].alteradoDepois, true);
    assert.equal(envios[0].referencia, "2026-11");
  });
});

describe("regras e permissões da gestão", () => {
  test("barbeiro e caixa não acessam painel, contas, vales, comissões, contador nem cópia dos dados", async () => {
    const s = await semanaSimulada();
    voltar();
    const { get, post, A, cx } = s;
    for (const t of [A.token, cx.token]) {
      for (const rota of ["/api/painel?periodo=hoje", "/api/contas", "/api/vales?dataIni=2026-11-01&dataFim=2026-11-30",
        "/api/comissoes/fechamentos", "/api/contador/envios", "/api/exportar/clientes", "/api/configuracoes/contador"]) {
        assert.equal((await get(rota, t)).status, 403, rota);
      }
      assert.equal((await post("/api/contas", t, { descricao: "x y", categoria: "luz", valorCentavos: 1, vencimento: "2026-11-10" })).status, 403);
    }
    assert.equal((await get("/api/desempenho", cx.token)).status, 403, "caixa não tem desempenho");
    assert.equal((await get("/api/extrato?mes=2026-11", cx.token)).status, 403);
  });

  test("extrato mensal do barbeiro: só o dele, com PDF e planilha", async () => {
    const s = await semanaSimulada();
    voltar();
    const { get, A, B, ger } = s;
    const e = (await get(`/api/extrato?mes=2026-11&barbeiroId=${B.id}`, A.token)).dados;
    assert.equal(e.barbeiro.id, A.id, "ignora o barbeiro de outro");
    assert.deepEqual([e.resumo.atendimentosQtd, e.resumo.faturamentoCentavos, e.resumo.comissaoCentavos, e.resumo.valesCentavos, e.resumo.saldoCentavos],
      [4, 18000, 9450, 2000, 7450]);
    assert.match(Buffer.from(e.arquivos.pdfBase64, "base64").toString("latin1"), /^%PDF/);
    const linhas = e.arquivos.csv.trim().split("\r\n");
    assert.equal(linhas.length, 1 + 4 + 1 + 1, "cabeçalho + 4 atendimentos + 1 venda + 1 vale");
    assert.ok(!e.arquivos.csv.includes("Cliente 2;"), "extrato não traz telefone nem nome completo de cliente");
    const eB = (await get(`/api/extrato?mes=2026-11&barbeiroId=${B.id}`, ger.token)).dados;
    assert.equal(eB.barbeiro.id, B.id, "gestão pode ver o de qualquer um");
    assert.equal((await get("/api/extrato?mes=2026-13", A.token)).status, 400);
  });

  test("contas: validações, cancelar com motivo, pagar com caixa exige caixa aberto e dinheiro", async () => {
    const s = await semanaSimulada();
    const { post, ger } = s;
    emDia("2026-11-09");   // caixa do dia 09 ainda não aberto
    assert.equal((await post("/api/contas", ger.token, { descricao: "X", categoria: "luz", valorCentavos: 100, vencimento: "2026-11-10" })).status, 400);
    assert.equal((await post("/api/contas", ger.token, { descricao: "Água", categoria: "gas", valorCentavos: 100, vencimento: "2026-11-10" })).status, 400);
    assert.equal((await post("/api/contas", ger.token, { descricao: "Água", categoria: "agua", valorCentavos: 0, vencimento: "2026-11-10" })).status, 400);
    assert.equal((await post("/api/contas", ger.token, { descricao: "Água", categoria: "agua", valorCentavos: 100, vencimento: "10/11/2026" })).status, 400);
    const agua = (await post("/api/contas", ger.token, { descricao: "Água", categoria: "agua", valorCentavos: 9000, vencimento: "2026-11-10" })).dados.conta;
    assert.equal(agua.status, "proxima");
    const r = await post("/api/contas/pagar", ger.token, { id: agua.id, comCaixa: true });
    assert.equal(r.status, 409);
    assert.match(r.dados.erro, /caixa de hoje precisa estar aberto/);
    assert.equal((await post("/api/contas/cancelar", ger.token, { id: agua.id })).status, 400);
    assert.equal((await post("/api/contas/cancelar", ger.token, { id: agua.id, motivo: "Lançada em duplicidade" })).status, 200);
    assert.equal((await post("/api/contas/pagar", ger.token, { id: agua.id })).status, 409);
    voltar();
  });

  test("cópia dos dados: planilhas CSV de cada parte, só da própria barbearia", async () => {
    const s = await semanaSimulada();
    voltar();
    const amb = ambiente();   // outra barbearia em outro banco não interfere; isolamento abaixo usa a mesma
    void amb;
    const { get, ger, criarBarbearia, criarUsuario, p } = s;
    const outra = await criarBarbearia(p, "beta");
    const gB = await criarUsuario(outra.prop, "ger.beta", "gerente");
    await s.post("/api/clientes", gB.token, { nome: "Cliente Só Da Beta", telefone: "21 98888-0000", aceiteLgpd: true });
    for (const t of ["clientes", "atendimentos", "caixa", "estoque", "estoque-movimentos", "contas", "comissoes"]) {
      const r = await get(`/api/exportar/${t}`, ger.token);
      assert.equal(r.status, 200, t);
      assert.ok(typeof r.dados === "string" && r.dados.split("\r\n")[0].includes(";"), t);   // (o leitor do teste remove o BOM)
      assert.ok(!r.dados.includes("Beta"), `${t} vazou dado da outra barbearia`);
    }
    const cli = (await get("/api/exportar/clientes", ger.token)).dados;
    assert.equal(cli.trim().split("\r\n").length, 1 + 8, "cabeçalho + 8 clientes");
    assert.equal((await get("/api/exportar/senhas", ger.token)).status, 404);
  });

  test("isolamento: ids da outra barbearia não funcionam em vales, contas e fechamentos", async () => {
    const s = await semanaSimulada();
    voltar();
    const { post, get, p, A, ids, criarBarbearia, criarUsuario } = s;
    const outra = await criarBarbearia(p, "beta");
    const gB = await criarUsuario(outra.prop, "ger.beta", "gerente");
    assert.equal((await post("/api/vales", gB.token, { barbeiroId: A.id, valorCentavos: 100 })).status, 404);
    assert.equal((await post("/api/contas/pagar", gB.token, { id: ids.luz })).status, 404);
    assert.equal((await post("/api/contas/cancelar", gB.token, { id: ids.luz, motivo: "sabotagem" })).status, 404);
    assert.equal((await get(`/api/extrato?mes=2026-11&barbeiroId=${A.id}`, gB.token)).status, 404);
    assert.equal((await get(`/api/desempenho?barbeiroId=${A.id}`, gB.token)).status, 404);
    const painelB = (await get("/api/painel?periodo=mes", gB.token)).dados;
    assert.equal(painelB.cartoes.brutoCentavos, 0);
    assert.equal(painelB.contas.lista.length, 0);
    assert.equal((await get("/api/contas?todas=1", gB.token)).dados.contas.length, 0);
    const relB = (await get("/api/contador/relatorio?tipo=mes&ref=2026-11", gB.token)).dados.relatorio;
    assert.equal(relB.entradas.totalCentavos, 0);
    assert.equal(relB.lancamentos.length, 0);
  });
});
