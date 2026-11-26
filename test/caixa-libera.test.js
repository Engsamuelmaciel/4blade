// O caixa cadastra produto e serviço, lança despesa e cuida de Minha página e Divulgação (27/11/2026). Dados fictícios.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { ambiente } from "./ambiente.js";

const AMANHA = new Date(Date.now() + 86400000).toISOString().slice(0, 10);

async function cenario(sufixo, amb, p) {
  const b = await amb.criarBarbearia(p, sufixo);
  const ger = await amb.criarUsuario(b.prop, `ger.${sufixo}`, "gerente");
  const barb = await amb.criarUsuario(ger.token, `barb.${sufixo}`, "barbeiro");
  const cx = await amb.criarUsuario(ger.token, `cx.${sufixo}`, "caixa");
  return { b, ger, barb, cx };
}

describe("caixa cadastra e lança", () => {
  test("cria produto (com estoque) e serviço; não edita nem desativa; barbeiro continua sem poder", async () => {
    const amb = ambiente();
    const { post, get } = amb;
    const p = await amb.criarPlataforma();
    const { ger, barb, cx } = await cenario("cl1", amb, p);
    const s = await post("/api/servicos", cx.token, { nome: "Sobrancelha", precoCentavos: 2000, duracaoMin: 20 });
    assert.equal(s.status, 201, JSON.stringify(s.dados));
    const pr = await post("/api/produtos", cx.token, { nome: "Gel Fictício", precoCentavos: 3000, estoqueInicial: { quantidade: 5, custoUnitCentavos: 1000 } });
    assert.equal(pr.status, 201, JSON.stringify(pr.dados));
    assert.equal((await post("/api/servicos/alterar", cx.token, { id: s.dados.servico.id, nome: "Outro" })).status, 403, "não edita serviço");
    assert.equal((await post("/api/produtos/alterar", cx.token, { id: pr.dados.produto.id, nome: "Outro" })).status, 403, "não edita produto");
    assert.equal((await post("/api/servicos", barb.token, { nome: "X", precoCentavos: 1000, duracaoMin: 30 })).status, 403, "barbeiro não cria");
    assert.equal((await post("/api/produtos", barb.token, { nome: "Y", precoCentavos: 1000 })).status, 403, "barbeiro não cria");
    // a gestão enxerga o que o caixa criou; outra barbearia não
    assert.ok((await get("/api/servicos", ger.token)).dados.servicos.some(x => x.nome === "Sobrancelha"));
    const o = await cenario("cl2", amb, p);
    assert.ok(!(await get("/api/servicos", o.ger.token)).dados.servicos.some(x => x.nome === "Sobrancelha"));
  });

  test("caixa lança despesa (inclusive compra de produto novo), mas não vê, paga, edita nem cancela despesas; não muda preço de produto existente", async () => {
    const amb = ambiente();
    const { post, get } = amb;
    const p = await amb.criarPlataforma();
    const { ger, barb, cx } = await cenario("cl3", amb, p);
    const d = await post("/api/contas", cx.token, { categoria: "luz", valorCentavos: 15000, vencimento: AMANHA, descricao: "Conta de luz" });
    assert.equal(d.status, 201, JSON.stringify(d.dados));
    const c = await post("/api/contas", cx.token, { categoria: "produtos", valorCentavos: 10000, vencimento: AMANHA,
      estoque: { quantidade: 4, novo: { nome: "Shampoo Caixa" }, precoVendaCentavos: 4000 } });
    assert.equal(c.status, 201, JSON.stringify(c.dados));
    assert.equal(c.dados.estoque.criado, true);
    // não vê a lista, não paga, não edita, não cancela
    assert.equal((await get("/api/contas", cx.token)).status, 403);
    const id = d.dados.conta?.id || d.dados.contas?.[0];
    assert.equal((await post("/api/contas/pagar", cx.token, { id })).status, 403);
    assert.equal((await post("/api/contas/alterar", cx.token, { id, descricao: "Mudou" })).status, 403);
    assert.equal((await post("/api/contas/cancelar", cx.token, { id, motivo: "teste" })).status, 403);
    // preço de venda de produto JÁ cadastrado: só a gestão muda
    const prod = (await post("/api/produtos", ger.token, { nome: "Pomada Cx", precoCentavos: 2500 })).dados.produto;
    const mud = await post("/api/contas", cx.token, { categoria: "produtos", valorCentavos: 5000, vencimento: AMANHA, estoque: { produtoId: prod.id, quantidade: 2, precoVendaCentavos: 9900 } });
    assert.equal(mud.status, 403, JSON.stringify(mud.dados));
    const ok = await post("/api/contas", cx.token, { categoria: "produtos", valorCentavos: 5000, vencimento: AMANHA, estoque: { produtoId: prod.id, quantidade: 2, precoVendaCentavos: 2500 } });
    assert.equal(ok.status, 201, JSON.stringify(ok.dados));
    // barbeiro continua fora
    assert.equal((await post("/api/contas", barb.token, { categoria: "luz", valorCentavos: 1000, vencimento: AMANHA })).status, 403);
    // a gestão vê as despesas lançadas pelo caixa; outra barbearia não
    assert.ok((await get("/api/contas", ger.token)).dados.contas.some(x => x.descricao === "Conta de luz"));
    const o = await cenario("cl4", amb, p);
    assert.equal((await get("/api/contas", o.ger.token)).dados.contas.length, 0);
  });

  test("caixa cuida de Minha página e Divulgação; barbeiro não; cada barbearia tem a sua", async () => {
    const amb = ambiente();
    const { post, get } = amb;
    const p = await amb.criarPlataforma();
    const { barb, cx } = await cenario("cl5", amb, p);
    const pg = await get("/api/pagina", cx.token);
    assert.equal(pg.status, 200, JSON.stringify(pg.dados));
    const slug = pg.dados.pagina.slug;
    const salvo = await post("/api/pagina/salvar", cx.token, { descricao: "Página feita pela recepção" });
    assert.equal(salvo.status, 200, JSON.stringify(salvo.dados));
    assert.equal((await get("/api/pagina/flyers", cx.token)).status, 200);
    assert.equal((await get("/api/pagina", barb.token)).status, 403, "barbeiro não edita a página");
    const o = await cenario("cl6", amb, p);
    const pg2 = await get("/api/pagina", o.cx.token);
    assert.notEqual(pg2.dados.pagina.slug, slug, "outra barbearia, outra página");
  });
});
