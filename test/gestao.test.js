// E4 — semana simulada com 2 barbeiros (% diferentes), vales e 3 contas: painel, fechamento de comissão, contador.
// Todos os números conferidos à mão (contas nos comentários). Dados fictícios.
// O "hoje" do sistema é simulado trocando Date.now (os acessos são feitos antes, no horário real).
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import { ambiente } from "./ambiente.js";

const AGORA_REAL = Date.now;
const emDia = data => { Date.now = () => Date.parse(`${data}T15:00:00Z`); };   // 12h em Brasília
const voltar = () => { Date.now = AGORA_REAL; };
after(voltar);
const SEMANA = ["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06", "2026-11-07", "2026-11-08"];

async function semanaSimulada() {
  voltar();
  const amb = ambiente();
  const { post, get, criarPlataforma, criarBarbearia, criarUsuario } = amb;
  const p = await criarPlataforma();
  const b = await criarBarbearia(p, "alfa");
  const ger = await criarUsuario(b.prop, "ger.alfa", "gerente", { comissaoServicoBp: 4000, comissaoProdutoBp: 1000 });
  const A = await criarUsuario(ger.token, "ana.alfa", "barbeiro", { comissaoServicoBp: 5000, comissaoProdutoBp: 1000 });   // 50% / 10%
  const B = await criarUsuario(ger.token, "beto.alfa", "barbeiro", { comissaoServicoBp: 4000, comissaoProdutoBp: 1500 });  // 40% / 15%
  const cx = await criarUsuario(ger.token, "cx.alfa", "caixa");
  await post("/api/funcionamento/salvar", ger.token, { dias: [0, 1, 2, 3, 4, 5, 6].map(dia => ({ dia, aberto: true, abre: "08:00", fecha: "20:00" })) });
  const corte = (await post("/api/servicos", ger.token, { nome: "Corte", precoCentavos: 4000, duracaoMin: 30 })).dados.servico;
  const barba = (await post("/api/servicos", ger.token, { nome: "Barba", precoCentavos: 3000, duracaoMin: 30 })).dados.servico;
  const pomada = (await post("/api/produtos", ger.token, { nome: "Pomada", precoCentavos: 4500, estoqueMinimo: 3 })).dados.produto;
  await post("/api/estoque/entrada", ger.token, { produtoId: pomada.id, quantidade: 6, custoUnitCentavos: 2000 });
  amb.env.DB.raw.prepare("UPDATE estoque_movimentos SET criado_em = '2026-11-02 12:00:00'").run();   // compra no início da semana

  let n = 0;
  const atender = async (quem, itens, pagamentos) => {
    n++;
    const m = await post("/api/agenda", quem.token, {
      data: new Date(Date.now() - 3 * 3600000).toISOString().slice(0, 10), hora: `${String(8 + (n % 10)).padStart(2, "0")}:00`,
      servicoIds: itens.map(([s]) => s.id), cliente: { telefone: `11 9${String(n).padStart(4, "0")}-1111`, nome: `Cliente ${n}`, aceiteLgpd: true }
    });
    assert.equal(m.status, 201, JSON.stringify(m.dados));
    const f = await post("/api/agenda/finalizar", quem.token, {
      id: m.dados.agendamento.id, itens: itens.map(([s, v]) => ({ servicoId: s.id, precoCobradoCentavos: v })),
      pagamentos: pagamentos.map(([forma, valorCentavos]) => ({ forma, valorCentavos }))
    });
    assert.equal(f.status, 201, JSON.stringify(f.dados));
    return m.dados.agendamento.id;
  };
  const vender = async (quem, q, forma) => {
    const r = await post("/api/vendas", quem.token, { itens: [{ produtoId: pomada.id, quantidade: q }], pagamentos: [{ forma, valorCentavos: 4500 * q }] });
    assert.equal(r.status, 201, JSON.stringify(r.dados));
    return r.dados.venda.id;
  };
  const abrir = (troco = 0) => post("/api/caixa/abrir", cx.token, { trocoCentavos: troco });
  const fechar = async (falta = 0) => {
    const esperado = (await get("/api/caixa/hoje", cx.token)).dados.totais.dinheiroEsperadoCentavos;
    const r = await post("/api/caixa/fechar", cx.token, { contadoCentavos: esperado - falta, observacao: falta ? "Falta (fictícia)" : null });
    assert.equal(r.status, 200, JSON.stringify(r.dados));
  };
  const ids = {};

  emDia("2026-11-02");
  await abrir();
  await atender(A, [[corte, 4000]], [["pix", 4000]]);              // A 40,00 pix
  await atender(B, [[barba, 3000]], [["dinheiro", 3000]]);         // B 30,00 dinheiro
  await fechar();

  emDia("2026-11-03");
  await abrir();
  await atender(A, [[corte, 4000], [barba, 3000]], [["credito", 7000]]);   // A 70,00 crédito
  await vender(A, 1, "pix");                                               // A vende 1 pomada 45,00 (comissão 10% = 4,50)
  await fechar();

  emDia("2026-11-04");
  await abrir();
  ids.alterado = await atender(B, [[corte, 3500]], [["debito", 3500]]);   // B 35,00 débito (valor alterado)
  assert.equal((await post("/api/vales", ger.token, { barbeiroId: A.id, valorCentavos: 2000, descricao: "Adiantamento" })).status, 201);   // vale A 20,00
  await fechar();

  emDia("2026-11-05");
  await abrir();
  await atender(B, [[corte, 4000]], [["pix", 4000]]);              // B 40,00 pix
  await vender(B, 2, "dinheiro");                                  // B vende 2 pomadas 90,00 (15% = 13,50)
  // Conta 1: aluguel 1.500,00, recorrente, venc. 05/11, paga no banco
  ids.aluguel = (await post("/api/contas", ger.token, { descricao: "Aluguel do salão", categoria: "aluguel", valorCentavos: 150000, vencimento: "2026-11-05", recorrente: true })).dados.conta.id;
  assert.equal((await post("/api/contas/pagar", ger.token, { id: ids.aluguel })).status, 200);
  await fechar();

  emDia("2026-11-06");
  await abrir();
  await atender(A, [[corte, 4000]], [["dinheiro", 4000]]);         // A 40,00 dinheiro
  ids.vendaCaixa = await vender(cx, 1, "pix");                     // caixa vende 1 pomada 45,00 (sem comissão)
  assert.equal((await post("/api/vales", ger.token, { barbeiroId: B.id, valorCentavos: 5000 })).status, 201);   // vale B 50,00
  // Conta 2: luz 200,00, venc. 06/11 — fica em aberto (atrasada no fim da semana)
  ids.luz = (await post("/api/contas", ger.token, { descricao: "Conta de luz", categoria: "luz", valorCentavos: 20000, vencimento: "2026-11-06" })).dados.conta.id;
  // caixa do dia 06 NÃO é fechado (aviso "caixa aberto de dia anterior")

  emDia("2026-11-07");
  await abrir(5000);                                               // troco 50,00
  await atender(A, [[barba, 3000]], [["pix", 3000]]);              // A 30,00 pix
  const valeCanc = (await post("/api/vales", ger.token, { barbeiroId: B.id, valorCentavos: 1000 })).dados.vale.id;   // vale B 10,00 cancelado
  assert.equal((await post("/api/vales/cancelar", ger.token, { id: valeCanc, motivo: "Lançado por engano" })).status, 200);
  await fechar(1000);                                              // contado 40,00 de 50,00 esperados: falta de 10,00

  emDia("2026-11-08");
  await abrir(50000);                                              // troco 500,00
  ids.ultimo = await atender(B, [[corte, 4000], [barba, 3000]], [["pix", 7000]]);   // B 70,00 pix
  // Conta 3: fornecedor 300,00, venc. 08/11, paga com dinheiro do caixa (vira sangria)
  ids.forn = (await post("/api/contas", ger.token, { descricao: "Distribuidora (fictícia)", categoria: "fornecedor", valorCentavos: 30000, vencimento: "2026-11-08" })).dados.conta.id;
  const pg = await post("/api/contas/pagar", ger.token, { id: ids.forn, comCaixa: true });
  assert.equal(pg.status, 200, JSON.stringify(pg.dados));
  // caixa de hoje continua aberto
  return { ...amb, p, b, ger, A, B, cx, corte, barba, pomada, ids };
}

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
    assert.deepEqual(com, { "Pessoa ana.alfa": 9450, "Pessoa beto.alfa": 8350, "Pessoa ger.alfa": 0 });
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
      valoresAlterados: 1, caixasAbertosDiasAnteriores: ["2026-11-06"]
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
