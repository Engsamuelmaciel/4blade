// Material de uso da barbearia (controle de estoque, sem venda) e despesa (conta) que lança o material no estoque.
// Pedidos de 16/11/2026. Dados fictícios.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { ambiente } from "./ambiente.js";
import { hojeBrasil } from "../src/util.js";

const HOJE = hojeBrasil();

async function cenario(sufixo = "alfa", amb = ambiente(), plataforma = null) {
  const p = plataforma || await amb.criarPlataforma();
  const b = await amb.criarBarbearia(p, sufixo);
  const ger = await amb.criarUsuario(b.prop, `ger.${sufixo}`, "gerente");
  const barb = await amb.criarUsuario(ger.token, `barb.${sufixo}`, "barbeiro");
  const cx = await amb.criarUsuario(ger.token, `cx.${sufixo}`, "caixa");
  return { ...amb, p, b, ger, barb, cx };
}

describe("material de uso e despesa com estoque", () => {
  test("material de uso: cadastra no estoque, não aparece para vender e não pode ser vendido", async () => {
    const amb = await cenario();
    const { post, get, ger, barb, cx } = amb;
    assert.equal((await post("/api/estoque/material", ger.token, { nome: "x" })).status, 400);
    assert.equal((await post("/api/estoque/material", barb.token, { nome: "Lâmina" })).status, 403, "barbeiro não cadastra");
    const m = await post("/api/estoque/material", ger.token, { nome: "Lâmina descartável", estoqueMinimo: 20, estoqueInicial: { quantidade: 100, custoUnitCentavos: 35 } });
    assert.equal(m.status, 201, JSON.stringify(m.dados));
    assert.equal(m.dados.material.saldo, 100);
    assert.equal((await post("/api/estoque/material", ger.token, { nome: "lâmina descartável" })).status, 409, "nome repetido");
    const est = (await get("/api/estoque", ger.token)).dados.produtos.find(x => x.nome === "Lâmina descartável");
    assert.deepEqual([est.usoInterno, est.saldo, est.custoMedioCentavos, est.precoCentavos], [true, 100, 35, 0]);
    // quem vende não vê o material
    for (const quem of [barb, cx]) assert.ok(!(await get("/api/produtos", quem.token)).dados.produtos.some(x => x.nome === "Lâmina descartável"));
    // e o servidor recusa vender
    await post("/api/caixa/abrir", cx.token, { trocoCentavos: 0 });
    const v = await post("/api/vendas", cx.token, { itens: [{ produtoId: m.dados.material.id, quantidade: 1 }], pagamentos: [{ forma: "pix", valorCentavos: 0 }] });
    assert.equal(v.status, 409);
    assert.match(v.dados.erro, /material de uso/);
    // baixa por uso (ajuste "uso interno")
    assert.equal((await post("/api/estoque/ajuste", ger.token, { produtoId: m.dados.material.id, motivo: "uso_interno", quantidade: -12 })).status, 201);
    assert.equal((await get("/api/estoque", ger.token)).dados.produtos.find(x => x.nome === "Lâmina descartável").saldo, 88);
  });

  test("conta com material: entra no estoque com custo = valor ÷ quantidade; conta uma vez só nos relatórios; cancelar devolve", async () => {
    const amb = await cenario("conta");
    const { post, get, ger } = amb;
    const creme = (await post("/api/estoque/material", ger.token, { nome: "Creme para progressiva" })).dados.material;
    // caixa de creme com 10 unidades por R$ 150,00 → custo 15,00 cada
    const c = await post("/api/contas", ger.token, { descricao: "Caixa de creme (fictícia)", categoria: "fornecedor", valorCentavos: 15000, vencimento: HOJE,
      estoque: { produtoId: creme.id, quantidade: 10 } });
    assert.equal(c.status, 201, JSON.stringify(c.dados));
    assert.deepEqual(c.dados.conta.estoque, { produto: "Creme para progressiva", quantidade: 10 });
    let e = (await get("/api/estoque", ger.token)).dados.produtos.find(x => x.id === creme.id);
    assert.deepEqual([e.saldo, e.custoMedioCentavos], [10, 1500]);
    // não muda o valor (o custo já entrou no estoque) nem é recorrente
    assert.equal((await post("/api/contas/alterar", ger.token, { id: c.dados.conta.id, valorCentavos: 16000 })).status, 409);
    assert.equal((await post("/api/contas", ger.token, { descricao: "X recorrente", categoria: "fornecedor", valorCentavos: 100, vencimento: HOJE, recorrente: true,
      estoque: { produtoId: creme.id, quantidade: 1 } })).status, 400);
    // paga: no relatório financeiro a saída é a conta (150,00), sem "compra de mercadoria" repetida
    assert.equal((await post("/api/contas/pagar", ger.token, { id: c.dados.conta.id })).status, 200);
    const f = (await get(`/api/financeiro?periodo=dia&data=${HOJE}`, ger.token)).dados;
    assert.equal(f.saidas.contasCentavos, 15000);
    assert.equal(f.saidas.comprasMercadoriaCentavos, 0);
    assert.equal(f.totais.saidasCentavos, 15000);
    // outra conta (em aberto) com material, depois cancelada: o material sai do estoque
    const c2 = (await post("/api/contas", ger.token, { descricao: "Mais creme (fictícia)", categoria: "fornecedor", valorCentavos: 3000, vencimento: HOJE,
      estoque: { produtoId: creme.id, quantidade: 2 } })).dados.conta;
    assert.equal((await get("/api/estoque", ger.token)).dados.produtos.find(x => x.id === creme.id).saldo, 12);
    // se o material já foi usado, não dá para cancelar sem ajustar
    assert.equal((await post("/api/estoque/ajuste", ger.token, { produtoId: creme.id, motivo: "uso_interno", quantidade: -11 })).status, 201);
    const bloq = await post("/api/contas/cancelar", ger.token, { id: c2.id, motivo: "Lançada errada" });
    assert.equal(bloq.status, 409);
    assert.match(bloq.dados.erro, /Ajuste o estoque/);
    assert.equal((await post("/api/estoque/ajuste", ger.token, { produtoId: creme.id, motivo: "correcao", quantidade: 5 })).status, 201);
    const canc = await post("/api/contas/cancelar", ger.token, { id: c2.id, motivo: "Lançada errada" });
    assert.equal(canc.status, 200, JSON.stringify(canc.dados));
    assert.match(canc.dados.mensagem, /2 de Creme para progressiva saíram do estoque/);
    e = (await get("/api/estoque", ger.token)).dados.produtos.find(x => x.id === creme.id);
    assert.equal(e.saldo, 4);
    const hist = (await get(`/api/estoque/historico?produtoId=${creme.id}`, ger.token)).dados.movimentos;
    assert.ok(hist.some(h => /conta cancelada/.test(h.motivo || "")), "estorno registrado no histórico");
  });

  test("isolamento: outra barbearia não usa nem enxerga o material", async () => {
    const amb = await cenario("iso1");
    const { post, get, ger } = amb;
    const mat = (await post("/api/estoque/material", ger.token, { nome: "Toalha descartável" })).dados.material;
    const outra = await cenario("iso2", amb, amb.p);
    assert.equal((await post("/api/contas", outra.ger.token, { descricao: "Tentativa", categoria: "fornecedor", valorCentavos: 100, vencimento: HOJE,
      estoque: { produtoId: mat.id, quantidade: 1 } })).status, 404);
    assert.ok(!(await get("/api/estoque", outra.ger.token)).dados.produtos.some(x => x.id === mat.id));
    assert.equal((await post("/api/estoque/ajuste", outra.ger.token, { produtoId: mat.id, motivo: "uso_interno", quantidade: -1 })).status, 404);
  });

  test("produto novo na própria despesa: cria o produto, entra no estoque e devolve margem e lucro (26/11/2026)", async () => {
    const amb = await cenario("novo");
    const { post, get, ger, barb, cx } = amb;
    // 12 pomadas por R$ 240,00 → custo 20,00 cada; venda 45,00 → lucro 25,00 (55,56%) por unidade; 300,00 no total
    const c = await post("/api/contas", ger.token, { categoria: "fornecedor", valorCentavos: 24000, vencimento: HOJE,
      estoque: { quantidade: 12, novo: { nome: "Pomada modeladora" }, precoVendaCentavos: 4500 } });
    assert.equal(c.status, 201, JSON.stringify(c.dados));
    assert.deepEqual(c.dados.estoque, { produto: "Pomada modeladora", criado: true, quantidade: 12, custoUnitCentavos: 2000, precoVendaCentavos: 4500,
      lucroUnitCentavos: 2500, margemBp: 5556, lucroTotalCentavos: 30000 });
    assert.equal(c.dados.conta.descricao, "Compra: Pomada modeladora");
    const prod = (await get("/api/estoque", ger.token)).dados.produtos.find(x => x.nome === "Pomada modeladora");
    assert.equal(prod.saldo, 12);
    assert.equal(prod.precoCentavos, 4500);
    assert.equal(prod.custoMedioCentavos, 2000);
    assert.equal(prod.usoInterno, false);
    // já aparece para vender (barbeiro e caixa não veem custo)
    const visto = (await get("/api/produtos", barb.token)).dados.produtos.find(x => x.nome === "Pomada modeladora");
    assert.ok(visto && visto.custoMedioCentavos === undefined);
    // nome repetido: pede para escolher o produto da lista
    assert.equal((await post("/api/contas", ger.token, { categoria: "fornecedor", valorCentavos: 1000, vencimento: HOJE,
      estoque: { quantidade: 1, novo: { nome: "pomada MODELADORA" }, precoVendaCentavos: 100 } })).status, 409);
    // sem preço de venda (e sem ser material de uso) → recusa, e nada é criado
    assert.equal((await post("/api/contas", ger.token, { categoria: "fornecedor", valorCentavos: 1000, vencimento: HOJE,
      estoque: { quantidade: 1, novo: { nome: "Shampoo sem preço" } } })).status, 400);
    assert.ok(!(await get("/api/estoque", ger.token)).dados.produtos.some(x => x.nome === "Shampoo sem preço"));
    // material de uso novo: sem preço de venda, sem margem
    const m = await post("/api/contas", ger.token, { categoria: "fornecedor", valorCentavos: 5000, vencimento: HOJE,
      estoque: { quantidade: 50, novo: { nome: "Lâmina nova", usoInterno: true } } });
    assert.equal(m.status, 201, JSON.stringify(m.dados));
    assert.equal(m.dados.estoque.precoVendaCentavos, null);
    assert.equal(m.dados.estoque.margemBp, null);
    assert.equal((await get("/api/estoque", ger.token)).dados.produtos.find(x => x.nome === "Lâmina nova").usoInterno, true);
    // barbeiro e caixa não lançam despesa
    for (const u of [barb, cx]) assert.equal((await post("/api/contas", u.token, { categoria: "fornecedor", valorCentavos: 1000, vencimento: HOJE,
      estoque: { quantidade: 1, novo: { nome: "Tentativa" }, precoVendaCentavos: 100 } })).status, 403);
    // cancelar a despesa tira o que entrou do estoque (o produto continua cadastrado)
    assert.equal((await post("/api/contas/cancelar", ger.token, { id: c.dados.conta.id, motivo: "Lançada errado" })).status, 200);
    assert.equal((await get("/api/estoque", ger.token)).dados.produtos.find(x => x.nome === "Pomada modeladora").saldo, 0);
  });

  test("produto já cadastrado: preço de venda atualizado junto, com auditoria; isolamento do produto novo", async () => {
    const amb = await cenario("preco");
    const { post, get, ger } = amb;
    const prod = (await post("/api/produtos", ger.token, { nome: "Cera", precoCentavos: 3000, aceiteLgpd: true })).dados.produto;
    const c = await post("/api/contas", ger.token, { categoria: "fornecedor", valorCentavos: 10000, vencimento: HOJE,
      estoque: { produtoId: prod.id, quantidade: 10, precoVendaCentavos: 3500 } });
    assert.equal(c.status, 201, JSON.stringify(c.dados));
    assert.equal(c.dados.estoque.criado, false);
    assert.equal(c.dados.estoque.custoUnitCentavos, 1000);
    assert.equal(c.dados.estoque.lucroUnitCentavos, 2500);
    assert.equal((await get("/api/estoque", ger.token)).dados.produtos.find(x => x.id === prod.id).precoCentavos, 3500);
    // sem informar preço, o preço não muda
    await post("/api/contas", ger.token, { categoria: "fornecedor", valorCentavos: 1000, vencimento: HOJE, estoque: { produtoId: prod.id, quantidade: 1 } });
    assert.equal((await get("/api/estoque", ger.token)).dados.produtos.find(x => x.id === prod.id).precoCentavos, 3500);
    // outra barbearia cria o "mesmo nome" sem conflito e sem ver o produto desta
    const outra = await cenario("preco2", amb, amb.p);
    const o = await post("/api/contas", outra.ger.token, { categoria: "fornecedor", valorCentavos: 1000, vencimento: HOJE,
      estoque: { quantidade: 1, novo: { nome: "Cera" }, precoVendaCentavos: 2000 } });
    assert.equal(o.status, 201, JSON.stringify(o.dados));
    assert.equal((await get("/api/estoque", ger.token)).dados.produtos.filter(x => x.nome === "Cera").length, 1);
    // produto de outra barbearia por id → 404 (já coberto) e preço dele não muda
    assert.equal((await post("/api/contas", outra.ger.token, { categoria: "fornecedor", valorCentavos: 1000, vencimento: HOJE,
      estoque: { produtoId: prod.id, quantidade: 1, precoVendaCentavos: 1 } })).status, 404);
    assert.equal((await get("/api/estoque", ger.token)).dados.produtos.find(x => x.id === prod.id).precoCentavos, 3500);
  });

  test("categoria Produtos: só aceita com estoque; fica ligada ao estoque (26/11/2026)", async () => {
    const amb = await cenario("catprod");
    const { post, get, ger } = amb;
    // sem estoque → recusa (para não ficar despesa de produto solta)
    const sem = await post("/api/contas", ger.token, { categoria: "produtos", valorCentavos: 5000, vencimento: HOJE });
    assert.equal(sem.status, 400);
    assert.match(sem.dados.erro, /estoque/i);
    const c = await post("/api/contas", ger.token, { categoria: "produtos", valorCentavos: 5000, vencimento: HOJE,
      estoque: { quantidade: 5, novo: { nome: "Gel fixador" }, precoVendaCentavos: 2500 } });
    assert.equal(c.status, 201, JSON.stringify(c.dados));
    assert.ok(c.dados.conta.estoque, "a conta aparece ligada ao estoque");
    const p = (await get("/api/estoque", ger.token)).dados.produtos.find(x => x.nome === "Gel fixador");
    assert.equal(p.saldo, 5);
    assert.equal(p.precoCentavos, 2500);
    // o produto já está disponível para vender
    assert.ok((await get("/api/produtos", ger.token)).dados.produtos.some(x => x.nome === "Gel fixador" && x.ativo));
    // recorrente com produtos continua recusado
    assert.equal((await post("/api/contas", ger.token, { categoria: "produtos", valorCentavos: 1000, vencimento: HOJE, recorrente: true,
      estoque: { quantidade: 1, novo: { nome: "Outro gel" }, precoVendaCentavos: 100 } })).status, 400);
  });
});
