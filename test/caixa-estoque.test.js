// E3 — caixa completo e estoque. Dados fictícios. Totais conferidos à mão (contas escritas nos comentários).
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { ambiente } from "./ambiente.js";
import { hojeBrasil } from "../src/util.js";
import { somarDias } from "../src/agenda-util.js";

const HOJE = hojeBrasil();
const SEMANA_TODA = [0, 1, 2, 3, 4, 5, 6].map(dia => ({ dia, aberto: true, abre: "08:00", fecha: "20:00" }));

async function cenario(sufixo = "alfa", amb = ambiente(), plataforma = null) {
  const p = plataforma || await amb.criarPlataforma();
  const b = await amb.criarBarbearia(p, sufixo);
  const ger = await amb.criarUsuario(b.prop, `ger.${sufixo}`, "gerente", { comissaoServicoBp: 4000 });
  const barb = await amb.criarUsuario(ger.token, `barb.${sufixo}`, "barbeiro", { comissaoServicoBp: 5000 });
  const barb2 = await amb.criarUsuario(ger.token, `barb2.${sufixo}`, "barbeiro", { comissaoServicoBp: 4000 });
  const cx = await amb.criarUsuario(ger.token, `cx.${sufixo}`, "caixa");
  await amb.post("/api/funcionamento/salvar", ger.token, { dias: SEMANA_TODA });
  const corte = (await amb.post("/api/servicos", ger.token, { nome: "Corte", precoCentavos: 4000, duracaoMin: 30 })).dados.servico;
  const barba = (await amb.post("/api/servicos", ger.token, { nome: "Barba", precoCentavos: 3000, duracaoMin: 30 })).dados.servico;
  const pomada = (await amb.post("/api/produtos", ger.token, { nome: "Pomada", precoCentavos: 4500, estoqueMinimo: 3 })).dados.produto;
  const oleo = (await amb.post("/api/produtos", ger.token, { nome: "Óleo", precoCentavos: 3850, estoqueMinimo: 2 })).dados.produto;
  let n = 0;
  // Marca e finaliza um atendimento: itens [[servico, cobrado]], pagamentos [[forma, valor]].
  async function atender(barbeiro, itens, pagamentos) {
    n++;
    const hora = `${String(7 + n).padStart(2, "0")}:00`;   // um atendimento por hora: 08:00, 09:00...
    const m = await amb.post("/api/agenda", barbeiro.token, {
      data: HOJE, hora, servicoIds: itens.map(([s]) => s.id),
      cliente: { telefone: `11 9${String(n).padStart(4, "0")}-0000`, nome: `Cliente ${n}`, aceiteLgpd: true }
    });
    assert.equal(m.status, 201, JSON.stringify(m.dados));
    const f = await amb.post("/api/agenda/finalizar", barbeiro.token, {
      id: m.dados.agendamento.id,
      itens: itens.map(([s, v]) => ({ servicoId: s.id, precoCobradoCentavos: v })),
      pagamentos: pagamentos.map(([forma, valorCentavos]) => ({ forma, valorCentavos }))
    });
    assert.equal(f.status, 201, JSON.stringify(f.dados));
    return m.dados.agendamento.id;
  }
  const vender = (token, itens, pagamentos, extra = {}) => amb.post("/api/vendas", token, {
    itens: itens.map(([p, q]) => ({ produtoId: p.id, quantidade: q })),
    pagamentos: pagamentos.map(([forma, valorCentavos]) => ({ forma, valorCentavos })), ...extra
  });
  const entrada = (produto, quantidade, custo, extra = {}) =>
    amb.post("/api/estoque/entrada", ger.token, { produtoId: produto.id, quantidade, custoUnitCentavos: custo, ...extra });
  return { ...amb, p, b, prop: b.prop, ger, barb, barb2, cx, corte, barba, pomada, oleo, atender, vender, entrada };
}

const saldo = async (amb, token, produto) => (await amb.get("/api/estoque", token)).dados.produtos.find(p => p.id === produto.id);

describe("dia simulado completo (conferido à mão)", () => {
  test("6 atendimentos, 3 vendas, 1 sangria, 1 suprimento, fechamento com R$ 5,00 de falta", async () => {
    const amb = await cenario();
    const { get, post, ger, barb, barb2, cx, corte, barba, pomada, oleo, atender, vender, entrada } = amb;

    // Estoque: Pomada 10 × R$ 20,00 + 5 × R$ 26,00 → custo médio (200 + 130) ÷ 15 = R$ 22,00. Óleo 6 × R$ 15,00.
    assert.equal((await entrada(pomada, 10, 2000, { fornecedor: "Distribuidora Fictícia" })).status, 201);
    const e2 = await entrada(pomada, 5, 2600);
    assert.equal(e2.dados.produto.custoMedioCentavos, 2200);
    await entrada(oleo, 6, 1500);

    // Caixa aberto com troco de R$ 100,00.
    assert.equal((await post("/api/caixa/abrir", cx.token, { trocoCentavos: 10000 })).status, 201);

    // 6 atendimentos (valor BRUTO):
    await atender(barb, [[corte, 4000]], [["dinheiro", 4000]]);                         // 1) 40,00 dinheiro
    await atender(barb, [[corte, 4000], [barba, 3000]], [["pix", 7000]]);               // 2) 70,00 pix
    await atender(barb2, [[barba, 3000]], [["debito", 3000]]);                          // 3) 30,00 débito
    await atender(barb2, [[corte, 3500]], [["credito", 3500]]);                         // 4) 35,00 crédito (desconto)
    await atender(barb, [[corte, 4000]], [["dinheiro", 2000], ["pix", 2000]]);         // 5) 20,00 dinheiro + 20,00 pix
    await atender(barb2, [[corte, 4000], [barba, 3000]], [["dinheiro", 7000]]);         // 6) 70,00 dinheiro
    // atendimentos = 40 + 70 + 30 + 35 + 40 + 70 = 285,00

    // 3 vendas:
    assert.equal((await vender(cx.token, [[pomada, 2]], [["dinheiro", 9000]])).status, 201);                         // 2 × 45,00 = 90,00 dinheiro
    assert.equal((await vender(barb.token, [[oleo, 1]], [["pix", 3850]])).status, 201);                              // 38,50 pix (barbeiro)
    assert.equal((await vender(cx.token, [[pomada, 1], [oleo, 1]], [["credito", 5000], ["dinheiro", 3350]], { vendedorId: barb2.id })).status, 201); // 83,50
    // vendas = 90,00 + 38,50 + 83,50 = 212,00

    // Sangria R$ 150,00 e suprimento R$ 50,00 (motivo obrigatório).
    assert.equal((await post("/api/caixa/movimento", cx.token, { tipo: "sangria", valorCentavos: 15000 })).status, 400);
    assert.equal((await post("/api/caixa/movimento", cx.token, { tipo: "sangria", valorCentavos: 15000, motivo: "Depósito no banco" })).status, 201);
    assert.equal((await post("/api/caixa/movimento", cx.token, { tipo: "suprimento", valorCentavos: 5000, motivo: "Reforço de troco" })).status, 201);

    // Conferência à mão:
    // dinheiro = 40 + 20 + 70 (atend.) + 90 + 33,50 (vendas) = 253,50
    // pix      = 70 + 20 + 38,50 = 128,50 · débito = 30,00 · crédito = 35 + 50 = 85,00
    // entradas = 285,00 + 212,00 = 497,00 (= 253,50 + 128,50 + 30 + 85)
    // dinheiro esperado na gaveta = 100 (troco) + 253,50 + 50 (supr.) − 150 (sangria) = 253,50
    const c = (await get("/api/caixa/hoje", cx.token)).dados;
    assert.deepEqual(c.totais, {
      porForma: { dinheiro: 25350, pix: 12850, debito: 3000, credito: 8500 },
      atendimentosCentavos: 28500, vendasCentavos: 21200, entradasCentavos: 49700,
      sangriasCentavos: 15000, suprimentosCentavos: 5000, dinheiroEsperadoCentavos: 25350
    });
    // tela de fechamento: todos os atendimentos (7 linhas: o nº 5 tem 2 formas) e vendas (4 linhas: a 3ª tem 2 formas) + sangria + suprimento
    const tipos = c.lancamentos.map(l => l.tipo);
    assert.equal(tipos.filter(t => t === "atendimento").length, 7);
    assert.equal(tipos.filter(t => t === "venda").length, 4);
    assert.equal(tipos.filter(t => t === "sangria").length, 1);
    assert.equal(tipos.filter(t => t === "suprimento").length, 1);
    assert.ok(!/comiss|custo|margem/i.test(JSON.stringify(c)), "caixa nunca vê comissão, custo ou margem");

    // Fechamento: contado R$ 248,50 → falta de R$ 5,00. Com diferença, observação é obrigatória.
    assert.equal((await post("/api/caixa/fechar", cx.token, { contadoCentavos: 24850 })).status, 400);
    const f = await post("/api/caixa/fechar", cx.token, { contadoCentavos: 24850, observacao: "Troco dado a mais (fictício)" });
    assert.equal(f.status, 200, JSON.stringify(f.dados));
    assert.deepEqual(f.dados.fechamento, { esperadoCentavos: 25350, contadoCentavos: 24850, diferencaCentavos: -500 });

    // Estoque bate: Pomada 15 − 2 − 1 = 12; Óleo 6 − 1 − 1 = 4.
    assert.equal((await saldo(amb, ger.token, pomada)).saldo, 12);
    assert.equal((await saldo(amb, ger.token, oleo)).saldo, 4);
    assert.equal((await saldo(amb, ger.token, pomada)).valorEstoqueCentavos, 12 * 2200);

    // Fechado não muda: nada de venda, sangria, finalizar, cancelar ou corrigir.
    assert.equal((await vender(cx.token, [[pomada, 1]], [["pix", 4500]])).status, 409);
    assert.equal((await post("/api/caixa/movimento", cx.token, { tipo: "suprimento", valorCentavos: 100, motivo: "teste" })).status, 409);
    assert.equal((await post("/api/caixa/fechar", cx.token, { contadoCentavos: 24850, observacao: "de novo" })).status, 409);
    const algum = c.lancamentos.find(l => l.tipo === "atendimento");
    assert.equal((await post("/api/caixa/corrigir-forma", cx.token, { id: algum.id, novaForma: "credito", motivo: "teste" })).status, 409);
    const fechado = (await get("/api/caixa/hoje", cx.token)).dados;
    assert.equal(fechado.caixa.situacao, "fechado");
    assert.equal(fechado.fechamento.diferencaCentavos, -500);
    assert.equal(fechado.fechamento.observacao, "Troco dado a mais (fictício)");

    // Só o gerente reabre, com motivo. O histórico mostra a diferença.
    assert.equal((await post("/api/caixa/reabrir", cx.token, { motivo: "quero vender" })).status, 403);
    assert.equal((await post("/api/caixa/reabrir", ger.token, {})).status, 400);
    const hist = (await get("/api/caixa/historico", ger.token)).dados.caixas;
    assert.deepEqual(hist[0], { data: HOJE, situacao: "fechado", trocoCentavos: 10000, entradasCentavos: 49700, diferencaCentavos: -500, observacao: "Troco dado a mais (fictício)" });
    assert.equal((await get("/api/caixa/historico", cx.token)).status, 403, "histórico de outros dias é do gerente");
    assert.equal((await post("/api/caixa/reabrir", ger.token, { motivo: "Conferir venda" })).status, 200);
    const reaberto = (await get("/api/caixa/hoje", ger.token)).dados;
    assert.equal(reaberto.caixa.situacao, "aberto");
    assert.equal(reaberto.fechamento, null);
    assert.equal(reaberto.reaberturas.length, 1);
    assert.equal(reaberto.reaberturas[0].motivo, "Conferir venda");
  });
});

describe("caixa", () => {
  test("correção de forma de pagamento antes do fechamento (registrada); reabrir atendimento estorna na forma corrigida", async () => {
    const amb = await cenario();
    const { env, get, post, cx, ger, barb, corte, pomada, atender, vender, entrada } = amb;
    await post("/api/caixa/abrir", cx.token, { trocoCentavos: 0 });
    const agId = await atender(barb, [[corte, 4000]], [["dinheiro", 4000]]);
    await entrada(pomada, 3, 2000);
    await vender(cx.token, [[pomada, 1]], [["debito", 4500]]);
    let c = (await get("/api/caixa/hoje", cx.token)).dados;
    const lAt = c.lancamentos.find(l => l.tipo === "atendimento");
    const lVd = c.lancamentos.find(l => l.tipo === "venda");
    assert.equal((await post("/api/caixa/corrigir-forma", cx.token, { id: lAt.id, novaForma: "pix" })).status, 400, "motivo obrigatório");
    assert.equal((await post("/api/caixa/corrigir-forma", cx.token, { id: lAt.id, novaForma: "dinheiro", motivo: "x y z" })).status, 400, "mesma forma");
    assert.equal((await post("/api/caixa/corrigir-forma", cx.token, { id: lAt.id, novaForma: "pix", motivo: "Cliente pagou no Pix" })).status, 200);
    assert.equal((await post("/api/caixa/corrigir-forma", cx.token, { id: lVd.id, novaForma: "credito", motivo: "Era crédito" })).status, 200);
    c = (await get("/api/caixa/hoje", cx.token)).dados;
    assert.deepEqual(c.totais.porForma, { dinheiro: 0, pix: 4000, debito: 0, credito: 4500 });
    assert.equal(c.totais.entradasCentavos, 8500, "correção não muda o total");
    assert.equal(c.lancamentos.find(l => l.id === lAt.id).formaAtual, "pix");
    assert.equal(c.lancamentos.find(l => l.id === lAt.id).corrigido, true);
    const aud = env.DB.raw.prepare("SELECT detalhes FROM auditoria WHERE acao = 'caixa_forma_corrigida' ORDER BY id").all();
    assert.deepEqual(JSON.parse(aud[0].detalhes).antes, { forma: "dinheiro" });
    // a agenda mostra a forma corrigida
    assert.equal((await get(`/api/agenda?data=${HOJE}`, ger.token)).dados.agendamentos[0].finalizacao.pagamentos[0].forma, "pix");
    // reabrir o atendimento estorna no Pix (forma atual), não no dinheiro
    await post("/api/agenda/reabrir", barb.token, { id: agId, motivo: "Engano" });
    c = (await get("/api/caixa/hoje", cx.token)).dados;
    assert.deepEqual(c.totais.porForma, { dinheiro: 0, pix: 0, debito: 0, credito: 4500 });
    // atendimento estornado não pode mais ser corrigido
    assert.equal((await post("/api/caixa/corrigir-forma", cx.token, { id: lAt.id, novaForma: "debito", motivo: "x y z" })).status, 409);
  });

  test("sangria não pode passar do dinheiro na gaveta; barbeiro não mexe no caixa", async () => {
    const amb = await cenario();
    const { post, get, cx, barb } = amb;
    await post("/api/caixa/abrir", cx.token, { trocoCentavos: 5000 });
    assert.equal((await post("/api/caixa/movimento", cx.token, { tipo: "sangria", valorCentavos: 5001, motivo: "Banco" })).status, 409);
    assert.equal((await post("/api/caixa/movimento", cx.token, { tipo: "sangria", valorCentavos: 5000, motivo: "Banco" })).status, 201);
    assert.equal((await post("/api/caixa/movimento", cx.token, { tipo: "saque", valorCentavos: 100, motivo: "x y z" })).status, 400);
    for (const [m, rota, corpo] of [["GET", "/api/caixa/hoje"], ["POST", "/api/caixa/movimento", { tipo: "suprimento", valorCentavos: 100, motivo: "x y z" }],
      ["POST", "/api/caixa/fechar", { contadoCentavos: 0 }], ["GET", "/api/caixa/historico"]]) {
      const r = m === "GET" ? await get(rota, barb.token) : await post(rota, barb.token, corpo);
      assert.equal(r.status, 403, rota);
    }
  });

  test("gerente reabre o caixa fechado e então reabre o atendimento (pendência da E2)", async () => {
    const amb = await cenario();
    const { post, get, cx, ger, barb, corte, atender } = amb;
    await post("/api/caixa/abrir", cx.token, { trocoCentavos: 0 });
    const id = await atender(barb, [[corte, 4000]], [["pix", 4000]]);
    await post("/api/caixa/fechar", cx.token, { contadoCentavos: 0 });
    assert.match((await post("/api/agenda/reabrir", barb.token, { id, motivo: "engano" })).dados.erro, /só o gerente/);
    assert.match((await post("/api/agenda/reabrir", ger.token, { id, motivo: "engano" })).dados.erro, /reabra o caixa/);
    assert.equal((await post("/api/caixa/reabrir", ger.token, { motivo: "Atendimento lançado errado" })).status, 200);
    assert.equal((await post("/api/agenda/reabrir", ger.token, { id, motivo: "engano" })).status, 200);
    assert.equal((await get("/api/caixa/hoje", ger.token)).dados.totais.entradasCentavos, 0);
  });
});

describe("vendas e estoque", () => {
  test("venda sem saldo é bloqueada; cancelamento devolve o estoque e estorna a entrada", async () => {
    const amb = await cenario();
    const { post, get, cx, ger, barb, pomada, oleo, vender, entrada } = amb;
    await post("/api/caixa/abrir", cx.token, { trocoCentavos: 0 });
    const semSaldo = await vender(cx.token, [[pomada, 1]], [["pix", 4500]]);
    assert.equal(semSaldo.status, 409);
    assert.match(semSaldo.dados.erro, /Estoque insuficiente de Pomada \(tem 0\)\. Peça ao gerente para ajustar/);
    await entrada(pomada, 2, 2000);
    assert.equal((await vender(cx.token, [[pomada, 3]], [["pix", 13500]])).status, 409);
    assert.equal((await vender(cx.token, [[pomada, 2]], [["pix", 4500]])).status, 400, "soma diferente do total");
    const v = await vender(cx.token, [[pomada, 2]], [["pix", 9000]]);
    assert.equal(v.status, 201);
    assert.equal((await saldo(amb, ger.token, pomada)).saldo, 0);
    assert.equal((await vender(cx.token, [[pomada, 1]], [["pix", 4500]])).status, 409, "esgotou");
    // produto esgotado aparece indisponível para o barbeiro
    assert.equal((await get("/api/produtos", barb.token)).dados.produtos.find(p => p.id === pomada.id).disponivel, false);

    assert.equal((await post("/api/vendas/cancelar", barb.token, { id: v.dados.venda.id, motivo: "x y z" })).status, 403, "barbeiro não cancela");
    assert.equal((await post("/api/vendas/cancelar", cx.token, { id: v.dados.venda.id })).status, 400, "motivo obrigatório");
    assert.equal((await post("/api/vendas/cancelar", cx.token, { id: v.dados.venda.id, motivo: "Cliente desistiu" })).status, 200);
    assert.equal((await post("/api/vendas/cancelar", cx.token, { id: v.dados.venda.id, motivo: "de novo" })).status, 409);
    assert.equal((await saldo(amb, ger.token, pomada)).saldo, 2, "devolveu");
    const c = (await get("/api/caixa/hoje", cx.token)).dados;
    assert.equal(c.totais.vendasCentavos, 0);
    assert.deepEqual(c.lancamentos.map(l => [l.tipo, l.valorCentavos]), [["venda", 9000], ["estorno_venda", -9000]]);
    const hist = (await get(`/api/estoque/historico?produtoId=${pomada.id}`, ger.token)).dados.movimentos;
    assert.deepEqual(hist.map(m => [m.tipo, m.quantidade]), [["cancelamento_venda", 2], ["venda", -2], ["entrada", 2]]);
    void oleo;
  });

  test("barbeiro vende em seu nome (opcionalmente ligado ao horário dele); não vende em nome de outro", async () => {
    const amb = await cenario();
    const { env, post, cx, barb, barb2, pomada, vender, entrada } = amb;
    await post("/api/caixa/abrir", cx.token, { trocoCentavos: 0 });
    await entrada(pomada, 5, 2000);
    assert.equal((await vender(barb.token, [[pomada, 1]], [["pix", 4500]], { vendedorId: barb2.id })).status, 403);
    const m = await post("/api/agenda", barb2.token, { data: HOJE, hora: "10:00", servicoIds: [amb.corte.id], cliente: { telefone: "11 97777-0000", nome: "Cliente Z", aceiteLgpd: true } });
    assert.equal((await vender(barb.token, [[pomada, 1]], [["pix", 4500]], { agendamentoId: m.dados.agendamento.id })).status, 403, "horário de outro");
    const r = await vender(barb.token, [[pomada, 1]], [["pix", 4500]]);
    assert.equal(r.status, 201);
    const v = env.DB.raw.prepare("SELECT vendedor_id FROM vendas WHERE id = ?").get(r.dados.venda.id);
    assert.equal(v.vendedor_id, barb.id);
    const vi = env.DB.raw.prepare("SELECT custo_unit_centavos FROM venda_itens").get();
    assert.equal(vi.custo_unit_centavos, 2000, "custo da venda guardado (lucro no painel: E4)");
  });

  test("entrada recalcula o custo médio; ajustes exigem motivo; saldo nunca fica negativo", async () => {
    const amb = await cenario();
    const { post, ger, pomada, entrada } = amb;
    assert.equal((await entrada(pomada, 0, 2000)).status, 400);
    assert.equal((await entrada(pomada, 2, -1)).status, 400);
    assert.equal((await entrada(pomada, 4, 1000)).dados.produto.custoMedioCentavos, 1000);
    assert.equal((await entrada(pomada, 1, 1500)).dados.produto.custoMedioCentavos, 1100, "(4×10 + 1×15) ÷ 5 = 11,00");
    assert.equal((await entrada(pomada, 3, 1234)).dados.produto.custoMedioCentavos, 1150, "(5×11 + 3×12,34) ÷ 8 = 11,5025 → 11,50");

    const aj = corpo => post("/api/estoque/ajuste", ger.token, { produtoId: pomada.id, ...corpo });
    assert.equal((await aj({ quantidade: -1 })).status, 400, "sem motivo");
    assert.match((await aj({ quantidade: 1, motivo: "perda" })).dados.erro, /saída/);
    assert.equal((await aj({ quantidade: -1, motivo: "quebra", observacao: "Caiu no chão" })).status, 201);
    assert.equal((await aj({ quantidade: -1, motivo: "uso_interno" })).status, 201);
    assert.equal((await aj({ quantidade: 2, motivo: "correcao" })).status, 201);
    const neg = await aj({ quantidade: -50, motivo: "perda" });
    assert.equal(neg.status, 409);
    assert.match(neg.dados.erro, /tem 8/);
    assert.equal((await saldo(amb, ger.token, pomada)).saldo, 8);
    const hist = (await amb.get(`/api/estoque/historico?produtoId=${pomada.id}`, ger.token)).dados.movimentos;
    assert.equal(hist[2].motivo, "Quebra: Caiu no chão");
  });

  test("avisos de estoque mínimo (repor) e validade em 30 dias (vencendo)", async () => {
    const amb = await cenario();
    const { get, ger, pomada, oleo, entrada } = amb;
    await entrada(pomada, 2, 2000, { validade: somarDias(HOJE, 20) });   // mínimo 3 → repor; vence em 20 dias
    await entrada(oleo, 5, 1500, { validade: somarDias(HOJE, 90) });
    const lista = (await get("/api/estoque", ger.token)).dados.produtos;
    assert.deepEqual(lista.find(p => p.id === pomada.id).avisos, ["repor", "vencendo"]);
    assert.deepEqual(lista.find(p => p.id === oleo.id).avisos, []);
    assert.equal(lista.find(p => p.id === pomada.id).validade, somarDias(HOJE, 20));
  });

  test("inventário: mostra a diferença e ajusta com motivo", async () => {
    const amb = await cenario();
    const { post, ger, pomada, oleo, entrada } = amb;
    await entrada(pomada, 10, 2000);
    await entrada(oleo, 4, 1500);
    assert.equal((await post("/api/estoque/inventario", ger.token, { itens: [{ produtoId: pomada.id, contado: 9 }] })).status, 400, "motivo");
    const r = await post("/api/estoque/inventario", ger.token, {
      motivo: "Contagem do mês", itens: [{ produtoId: pomada.id, contado: 9 }, { produtoId: oleo.id, contado: 4 }]
    });
    assert.equal(r.status, 200);
    assert.equal(r.dados.ajustados, 1);
    assert.deepEqual(r.dados.itens.map(i => [i.nome, i.sistema, i.contado, i.diferenca]), [["Pomada", 10, 9, -1], ["Óleo", 4, 4, 0]]);
    assert.equal((await saldo(amb, ger.token, pomada)).saldo, 9);
  });

  test("permissões: estoque só para a gestão; caixa vê saldo mas não custo", async () => {
    const amb = await cenario();
    const { get, post, barb, cx, pomada, entrada } = amb;
    await entrada(pomada, 3, 2000);
    for (const t of [barb.token, cx.token]) {
      assert.equal((await get("/api/estoque", t)).status, 403);
      assert.equal((await post("/api/estoque/entrada", t, { produtoId: pomada.id, quantidade: 1, custoUnitCentavos: 1 })).status, 403);
      assert.equal((await post("/api/estoque/ajuste", t, { produtoId: pomada.id, quantidade: -1, motivo: "perda" })).status, 403);
    }
    const p = (await get("/api/produtos", cx.token)).dados.produtos.find(x => x.id === pomada.id);
    assert.equal(p.saldo, 3);
    assert.ok(!("custoMedioCentavos" in p) && !("margemBp" in p));
  });
});

describe("isolamento de caixa, vendas e estoque entre barbearias", () => {
  test("ids da outra barbearia não funcionam", async () => {
    const amb = ambiente();
    const p = await amb.criarPlataforma();
    const A = await cenario("alfa", amb, p);
    const B = await cenario("beta", amb, p);
    await amb.post("/api/caixa/abrir", A.cx.token, { trocoCentavos: 0 });
    await amb.post("/api/caixa/abrir", B.cx.token, { trocoCentavos: 777 });
    await B.entrada(B.pomada, 5, 2000);
    const vB = (await B.vender(B.cx.token, [[B.pomada, 1]], [["pix", 4500]])).dados.venda.id;
    const lB = (await amb.get("/api/caixa/hoje", B.cx.token)).dados.lancamentos[0].id;

    const tentativas = [
      ["/api/estoque/entrada", { produtoId: B.pomada.id, quantidade: 100, custoUnitCentavos: 1 }],
      ["/api/estoque/ajuste", { produtoId: B.pomada.id, quantidade: -1, motivo: "perda" }],
      ["/api/estoque/inventario", { itens: [{ produtoId: B.pomada.id, contado: 0 }], motivo: "sabotagem" }],
      ["/api/vendas/cancelar", { id: vB, motivo: "sabotagem" }],
      ["/api/caixa/corrigir-forma", { id: lB, novaForma: "dinheiro", motivo: "sabotagem" }]
    ];
    for (const [rota, corpo] of tentativas) assert.equal((await amb.post(rota, A.ger.token, corpo)).status, 404, rota);
    assert.equal((await A.vender(A.cx.token, [[B.pomada, 1]], [["pix", 4500]])).status, 404);
    assert.equal((await amb.get(`/api/estoque/historico?produtoId=${B.pomada.id}`, A.ger.token)).status, 404);

    // B intacto
    assert.equal((await saldo(amb, B.ger.token, B.pomada)).saldo, 4);
    const cB = (await amb.get("/api/caixa/hoje", B.cx.token)).dados;
    assert.equal(cB.caixa.trocoCentavos, 777);
    assert.equal(cB.totais.vendasCentavos, 4500);
    assert.equal(cB.lancamentos[0].formaAtual, "pix");
    // A não vê nada de B
    const cA = (await amb.get("/api/caixa/hoje", A.cx.token)).dados;
    assert.equal(cA.lancamentos.length, 0);
    assert.ok(!(await amb.get("/api/estoque", A.ger.token)).dados.produtos.some(x => x.id === B.pomada.id));
  });
});
