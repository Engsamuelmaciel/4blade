// Semana simulada (02 a 08/11/2026) dos testes automáticos da gestão e do relatório financeiro. Dados fictícios.
// (A semana da demonstração/tela fica em semana-simulada.mjs.)
import assert from "node:assert/strict";
import { ambiente } from "./ambiente.js";

export const AGORA_REAL = Date.now;
export const emDia = data => { Date.now = () => Date.parse(`${data}T15:00:00Z`); };   // 12h em Brasília
export const voltar = () => { Date.now = AGORA_REAL; };
export const SEMANA = ["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06", "2026-11-07", "2026-11-08"];

export async function semanaSimulada() {
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

