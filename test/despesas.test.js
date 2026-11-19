// Despesas (contas a pagar): forma de pagamento, parcelamento (cartão/boleto) e "já paga". Pedido de 17/11/2026. Dados fictícios.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { ambiente } from "./ambiente.js";
import { hojeBrasil } from "../src/util.js";
import { somarMes } from "../src/gestao.js";

const HOJE = hojeBrasil();

async function cenario(sufixo = "desp", amb = ambiente(), plataforma = null) {
  const p = plataforma || await amb.criarPlataforma();
  const b = await amb.criarBarbearia(p, sufixo);
  const ger = await amb.criarUsuario(b.prop, `ger.${sufixo}`, "gerente");
  const cx = await amb.criarUsuario(ger.token, `cx.${sufixo}`, "caixa");
  return { ...amb, p, b, ger, cx };
}

describe("despesas: forma de pagamento e parcelas", () => {
  test("compra no cartão em 3x: 3 contas de mês em mês, centavos na 1ª, forma guardada", async () => {
    const { post, get, ger } = await cenario();
    const r = await post("/api/contas", ger.token, { descricao: "Cadeira nova (fictícia)", categoria: "fornecedor", valorCentavos: 100000, vencimento: HOJE, forma: "credito", parcelas: 3 });
    assert.equal(r.status, 201, JSON.stringify(r.dados));
    assert.equal(r.dados.contasCriadas, 3);
    const contas = (await get("/api/contas", ger.token)).dados.contas.filter(c => c.descricao.startsWith("Cadeira nova"));
    assert.deepEqual(contas.map(c => [c.descricao, c.valorCentavos, c.vencimento, c.forma, c.parcela, c.parcelas]), [
      ["Cadeira nova (fictícia) (1/3)", 33334, HOJE, "credito", 1, 3],
      ["Cadeira nova (fictícia) (2/3)", 33333, somarMes(HOJE, 1), "credito", 2, 3],
      ["Cadeira nova (fictícia) (3/3)", 33333, somarMes(HOJE, 2), "credito", 3, 3]
    ]);
    assert.ok(contas.every(c => c.grupoId && c.grupoId === contas[0].grupoId));
    // cancelar "todas as parcelas" a partir da 2ª, depois de pagar a 1ª
    assert.equal((await post("/api/contas/pagar", ger.token, { id: contas[0].id })).status, 200);
    const canc = await post("/api/contas/cancelar", ger.token, { id: contas[1].id, motivo: "Devolvi a cadeira", todasParcelas: true });
    assert.equal(canc.status, 200, JSON.stringify(canc.dados));
    assert.equal(canc.dados.canceladas, 2);
    const depois = (await get("/api/contas?todas=1", ger.token)).dados.contas.filter(c => c.descricao.startsWith("Cadeira nova"));
    assert.deepEqual(depois.map(c => c.situacao).sort(), ["cancelada", "cancelada", "paga"]);
  });

  test("descrição opcional: em branco vira a categoria (ou Compra: produto)", async () => {
    const { post, ger } = await cenario("semdesc");
    const a = await post("/api/contas", ger.token, { categoria: "aluguel", valorCentavos: 12500, vencimento: HOJE });
    assert.equal(a.status, 201, JSON.stringify(a.dados));
    assert.equal(a.dados.conta.descricao, "Aluguel");
    const b = await post("/api/contas", ger.token, { descricao: "  ", categoria: "luz", valorCentavos: 100, vencimento: HOJE });
    assert.equal(b.dados.conta.descricao, "Luz");
    const m = (await post("/api/estoque/material", ger.token, { nome: "Lâminas (fictícias)" })).dados.material;
    const c = await post("/api/contas", ger.token, { descricao: null, categoria: "fornecedor", valorCentavos: 3000, vencimento: HOJE, forma: "credito", parcelas: 2, estoque: { produtoId: m.id, quantidade: 10 } });
    assert.equal(c.dados.conta.descricao, "Compra: Lâminas (fictícias) (1/2)");
  });

  test("validações: parcelas inválidas, recorrente parcelada, forma desconhecida", async () => {
    const { post, ger } = await cenario("val");
    const base = { descricao: "Teste", categoria: "outros", valorCentavos: 1000, vencimento: HOJE };
    assert.equal((await post("/api/contas", ger.token, { ...base, parcelas: 0 })).status, 400);
    assert.equal((await post("/api/contas", ger.token, { ...base, parcelas: 49 })).status, 400);
    assert.equal((await post("/api/contas", ger.token, { ...base, parcelas: 2, recorrente: true })).status, 400);
    assert.equal((await post("/api/contas", ger.token, { ...base, forma: "cheque" })).status, 400);
    assert.equal((await post("/api/contas", ger.token, { ...base, valorCentavos: 2, parcelas: 3 })).status, 400);
  });

  test("já paga no Pix: entra como paga hoje; em dinheiro do caixa vira sangria; forma muda ao pagar e editar", async () => {
    const { post, get, ger, cx } = await cenario("paga");
    const r = await post("/api/contas", ger.token, { descricao: "Produtos de limpeza", categoria: "outros", valorCentavos: 4590, vencimento: HOJE, forma: "pix", jaPaga: true });
    assert.equal(r.status, 201, JSON.stringify(r.dados));
    assert.deepEqual([r.dados.conta.situacao, r.dados.conta.pagoEm, r.dados.conta.forma], ["paga", HOJE, "pix"]);
    // dinheiro do caixa sem caixa aberto → o caixa abre sozinho (19/11/2026) e a retirada fica como saldo negativo
    const sem = await post("/api/contas", ger.token, { descricao: "Pão", categoria: "outros", valorCentavos: 1500, vencimento: HOJE, forma: "dinheiro", jaPaga: true, comCaixa: true });
    assert.equal(sem.status, 201, JSON.stringify(sem.dados));
    await post("/api/caixa/abrir", cx.token, { trocoCentavos: 5000 });
    const com = await post("/api/contas", ger.token, { descricao: "Café", categoria: "outros", valorCentavos: 1500, vencimento: HOJE, forma: "dinheiro", jaPaga: true, comCaixa: true });
    assert.equal(com.status, 201, JSON.stringify(com.dados));
    assert.equal(com.dados.conta.pagoComCaixa, true);
    // conta em aberto sem forma; ao pagar informa a forma
    const luz = (await post("/api/contas", ger.token, { descricao: "Luz (fictícia)", categoria: "luz", valorCentavos: 23000, vencimento: HOJE })).dados.conta;
    assert.equal(luz.forma, null);
    assert.equal((await post("/api/contas/pagar", ger.token, { id: luz.id, forma: "boleto" })).status, 200);
    let c = (await get("/api/contas", ger.token)).dados.contas.find(x => x.id === luz.id);
    assert.equal(c.forma, "boleto");
    // paga: dá para corrigir a forma (não muda valor)
    const alt = await post("/api/contas/alterar", ger.token, { id: luz.id, forma: "pix" });
    assert.equal(alt.status, 200, JSON.stringify(alt.dados));
    assert.equal(alt.dados.conta.forma, "pix");
  });

  test("material parcelado: entra no estoque pelo valor total, ligado à 1ª parcela", async () => {
    const { post, get, ger } = await cenario("est");
    const m = (await post("/api/estoque/material", ger.token, { nome: "Toalhas (fictícias)" })).dados.material;
    const r = await post("/api/contas", ger.token, { descricao: "Toalhas", categoria: "fornecedor", valorCentavos: 30000, vencimento: HOJE, forma: "boleto", parcelas: 2,
      estoque: { produtoId: m.id, quantidade: 20 } });
    assert.equal(r.status, 201, JSON.stringify(r.dados));
    const e = (await get("/api/estoque", ger.token)).dados.produtos.find(x => x.id === m.id);
    assert.deepEqual([e.saldo, e.custoMedioCentavos], [20, 1500]);
    assert.deepEqual(r.dados.conta.estoque, { produto: "Toalhas (fictícias)", quantidade: 20 });
  });

  test("isolamento: outra barbearia não paga, edita nem cancela parcela alheia", async () => {
    const amb = await cenario("iso1");
    const c = (await amb.post("/api/contas", amb.ger.token, { descricao: "Secadores", categoria: "fornecedor", valorCentavos: 9000, vencimento: HOJE, forma: "credito", parcelas: 3 })).dados.conta;
    const outra = await cenario("iso2", amb, amb.p);
    assert.equal((await amb.post("/api/contas/pagar", outra.ger.token, { id: c.id, forma: "pix" })).status, 404);
    assert.equal((await amb.post("/api/contas/alterar", outra.ger.token, { id: c.id, forma: "pix" })).status, 404);
    assert.equal((await amb.post("/api/contas/cancelar", outra.ger.token, { id: c.id, motivo: "Tentativa", todasParcelas: true })).status, 404);
    assert.ok(!(await amb.get("/api/contas", outra.ger.token)).dados.contas.some(x => x.grupoId === c.grupoId));
    // caixa não acessa despesas
    assert.equal((await amb.post("/api/contas", amb.cx.token, { descricao: "X", categoria: "outros", valorCentavos: 100, vencimento: HOJE })).status, 403);
  });
});
