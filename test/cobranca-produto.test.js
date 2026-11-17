// Cobrança do atendimento com produto junto (corte + pomada no mesmo pagamento). Pedido de 17/11/2026. Dados fictícios.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { ambiente } from "./ambiente.js";
import { hojeBrasil } from "../src/util.js";

const HOJE = hojeBrasil();

async function cenario(sufixo = "cp", amb = ambiente(), plataforma = null) {
  const p = plataforma || await amb.criarPlataforma();
  const b = await amb.criarBarbearia(p, sufixo);
  const ger = await amb.criarUsuario(b.prop, `ger.${sufixo}`, "gerente");
  const barb = await amb.criarUsuario(ger.token, `barb.${sufixo}`, "barbeiro", { comissaoServicoBp: 5000, comissaoProdutoBp: 1000 });
  const cx = await amb.criarUsuario(ger.token, `cx.${sufixo}`, "caixa");
  await amb.post("/api/funcionamento/salvar", ger.token, { dias: [0, 1, 2, 3, 4, 5, 6].map(dia => ({ dia, aberto: true, abre: "00:00", fecha: "23:30" })) });
  const corte = (await amb.post("/api/servicos", ger.token, { nome: "Corte", precoCentavos: 4000, duracaoMin: 30 })).dados.servico;
  const pom = (await amb.post("/api/produtos", ger.token, { nome: "Pomada", precoCentavos: 3000, estoqueInicial: { quantidade: 5, custoUnitCentavos: 1200 } })).dados.produto;
  await amb.post("/api/caixa/abrir", cx.token, { trocoCentavos: 0 });
  const cli = (await amb.post("/api/clientes", ger.token, { nome: "Cliente Pomada", telefone: "11 95555-4040", aceiteLgpd: true })).dados.cliente;
  const m = (await amb.post("/api/agenda", cx.token, { barbeiroId: barb.id, data: HOJE, hora: "00:00", servicoIds: [corte.id], cliente: { id: cli.id } })).dados.agendamento;
  return { ...amb, p, b, ger, barb, cx, corte, pom, cli, m };
}

describe("cobrança com produto", () => {
  test("corte 40 + 2 pomadas 60 = 100 num pagamento (Pix 70 + dinheiro 30): finaliza, vende, baixa estoque, comissões certas", async () => {
    const { post, get, cx, barb, corte, pom, m, env } = await cenario();
    const r = await post("/api/caixa/cobrar", cx.token, { id: m.id, itens: [{ servicoId: corte.id, precoCobradoCentavos: 4000 }],
      produtos: [{ produtoId: pom.id, quantidade: 2 }], pagamentos: [{ forma: "pix", valorCentavos: 7000 }, { forma: "dinheiro", valorCentavos: 3000 }] });
    assert.equal(r.status, 201, JSON.stringify(r.dados));
    assert.equal(r.dados.venda.totalCentavos, 6000);
    const t = (await get("/api/caixa/hoje", cx.token)).dados.totais;
    assert.equal(t.entradasCentavos, 10000);
    assert.deepEqual([t.atendimentosCentavos, t.vendasCentavos, t.porForma.pix, t.porForma.dinheiro], [4000, 6000, 7000, 3000]);
    const venda = env.DB.raw.prepare("SELECT vendedor_id, agendamento_id, cliente_id FROM vendas").get();
    assert.deepEqual([venda.vendedor_id, venda.agendamento_id], [barb.id, m.id], "venda ligada ao horário, em nome do barbeiro");
    assert.equal(env.DB.raw.prepare("SELECT valor_centavos FROM comissoes_produto").get().valor_centavos, 600, "10% da pomada");
    assert.equal(env.DB.raw.prepare("SELECT valor_centavos FROM comissoes").get().valor_centavos, 2000, "50% do corte");
    assert.equal(env.DB.raw.prepare("SELECT saldo FROM produto_estoque WHERE produto_id = ?").get(pom.id).saldo, 3);
  });

  test("soma errada recusa tudo (nada gravado); estoque insuficiente recusa; promissória divide entre serviço e produto", async () => {
    const amb = await cenario("cp2");
    const { post, cx, corte, pom, m, env } = amb;
    const base = { id: m.id, itens: [{ servicoId: corte.id, precoCobradoCentavos: 4000 }] };
    assert.equal((await post("/api/caixa/cobrar", cx.token, { ...base, produtos: [{ produtoId: pom.id, quantidade: 1 }], pagamentos: [{ forma: "pix", valorCentavos: 4000 }] })).status, 400);
    assert.equal((await post("/api/caixa/cobrar", cx.token, { ...base, produtos: [{ produtoId: pom.id, quantidade: 9 }], pagamentos: [{ forma: "pix", valorCentavos: 31000 }] })).status, 409);
    assert.equal(env.DB.raw.prepare("SELECT COUNT(*) n FROM finalizacoes").get().n, 0, "nada gravado");
    const r = await post("/api/caixa/cobrar", cx.token, { ...base, produtos: [{ produtoId: pom.id, quantidade: 1 }], pagamentos: [{ forma: "promissoria", valorCentavos: 7000 }] });
    assert.equal(r.status, 201, JSON.stringify(r.dados));
    const notas = env.DB.raw.prepare("SELECT origem, valor_centavos FROM promissorias ORDER BY origem").all();
    assert.deepEqual(notas.map(n => [n.origem, n.valor_centavos]), [["atendimento", 4000], ["venda", 3000]]);
  });

  test("atendimento sem horário também leva produto; isolamento: produto de outra barbearia não entra", async () => {
    const amb = await cenario("cp3");
    const { post, cx, barb, corte, pom } = amb;
    const r = await post("/api/caixa/atendimento-avulso", cx.token, { barbeiroId: barb.id, itens: [{ servicoId: corte.id, precoCobradoCentavos: 4000 }],
      produtos: [{ produtoId: pom.id, quantidade: 1 }], pagamentos: [{ forma: "debito", valorCentavos: 7000 }], cliente: {} });
    assert.equal(r.status, 201, JSON.stringify(r.dados));
    const outra = await cenario("cp4", amb, amb.p);
    const x = await post("/api/caixa/cobrar", outra.cx.token, { id: outra.m.id, itens: [{ servicoId: outra.corte.id, precoCobradoCentavos: 4000 }],
      produtos: [{ produtoId: pom.id, quantidade: 1 }], pagamentos: [{ forma: "pix", valorCentavos: 7000 }] });
    assert.equal(x.status, 404);
  });
});
