// Pagamento da equipe: salário + comissão − vales por pessoa, por mês; pagar registra tudo e entra nos relatórios.
// Pedido de 17/11/2026. Dados fictícios.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { ambiente } from "./ambiente.js";
import { hojeBrasil } from "../src/util.js";

const HOJE = hojeBrasil();
const MES = HOJE.slice(0, 7);

async function cenario(sufixo = "eq", amb = ambiente(), plataforma = null) {
  const p = plataforma || await amb.criarPlataforma();
  const b = await amb.criarBarbearia(p, sufixo);
  const ger = await amb.criarUsuario(b.prop, `ger.${sufixo}`, "gerente");
  const barb = await amb.criarUsuario(ger.token, `barb.${sufixo}`, "barbeiro", { comissaoServicoBp: 5000, comissaoProdutoBp: 1000 });
  const cx = await amb.criarUsuario(ger.token, `cx.${sufixo}`, "caixa");
  await amb.post("/api/funcionamento/salvar", ger.token, { dias: [0, 1, 2, 3, 4, 5, 6].map(dia => ({ dia, aberto: true, abre: "00:00", fecha: "23:30" })) });
  const corte = (await amb.post("/api/servicos", ger.token, { nome: "Corte", precoCentavos: 4000, duracaoMin: 30 })).dados.servico;
  const pom = (await amb.post("/api/produtos", ger.token, { nome: "Pomada", precoCentavos: 3000, estoqueInicial: { quantidade: 5, custoUnitCentavos: 1200 } })).dados.produto;
  await amb.post("/api/caixa/abrir", cx.token, { trocoCentavos: 200000 });
  const m = (await amb.post("/api/agenda", cx.token, { barbeiroId: barb.id, data: HOJE, hora: "00:00", servicoIds: [corte.id], cliente: { nome: "Cliente Equipe" } })).dados.agendamento;
  const r = await amb.post("/api/caixa/cobrar", cx.token, { id: m.id, itens: [{ servicoId: corte.id, precoCobradoCentavos: 4000 }],
    produtos: [{ produtoId: pom.id, quantidade: 1 }], pagamentos: [{ forma: "pix", valorCentavos: 7000 }] });
  assert.equal(r.status, 201, JSON.stringify(r.dados));
  await amb.post("/api/vales", ger.token, { barbeiroId: barb.id, valorCentavos: 500, data: HOJE });
  return { ...amb, p, b, ger, barb, cx };
}

describe("pagamento da equipe", () => {
  test("quadro do mês: produção, comissão, salário, vales e a pagar; pagar zera e entra no financeiro", async () => {
    const { post, get, b, ger, barb, cx } = await cenario();
    assert.equal((await post("/api/equipe/salario", ger.token, { usuarioId: barb.id, salarioCentavos: 150000 })).status, 200);
    assert.equal((await post("/api/equipe/salario", ger.token, { usuarioId: cx.id, salarioCentavos: 120000 })).status, 200);
    let q = (await get(`/api/equipe/pagamento?mes=${MES}`, ger.token)).dados;
    const pb = q.pessoas.find(x => x.id === barb.id);
    assert.deepEqual([pb.producao.servicosCentavos, pb.producao.produtosCentavos, pb.producao.totalCentavos], [4000, 3000, 7000]);
    assert.deepEqual([pb.comissao.servicoCentavos, pb.comissao.produtoCentavos, pb.vales.totalCentavos], [2000, 300, 500]);
    assert.deepEqual([pb.aPagar.salarioCentavos, pb.aPagar.comissaoCentavos, pb.aPagar.totalCentavos], [150000, 1800, 151800]);
    assert.equal(pb.custoCentavos, 152300, "custo = salário + comissões");
    const pc = q.pessoas.find(x => x.id === cx.id);
    assert.equal(pc.aPagar.totalCentavos, 120000);
    assert.ok(q.pessoas.some(x => x.perfil === "proprietario"), "dono aparece (pró-labore)");
    // paga o barbeiro no Pix
    const pg = await post("/api/equipe/pagar", ger.token, { usuarioId: barb.id, mes: MES, forma: "pix" });
    assert.equal(pg.status, 200, JSON.stringify(pg.dados));
    assert.equal(pg.dados.totalCentavos, 151800);
    q = (await get(`/api/equipe/pagamento?mes=${MES}`, ger.token)).dados;
    const pb2 = q.pessoas.find(x => x.id === barb.id);
    assert.equal(pb2.aPagar.totalCentavos, 0);
    assert.equal(pb2.salario.pago.valorCentavos, 150000);
    assert.equal(pb2.comissao.pagaCentavos, 1800);
    assert.equal((await post("/api/equipe/pagar", ger.token, { usuarioId: barb.id, mes: MES })).status, 409, "não paga duas vezes");
    // o salário virou despesa paga e o fechamento de comissão aparece pago
    const contas = (await get("/api/contas", ger.token)).dados.contas;
    assert.ok(contas.some(c => /^Salário .* \(/.test(c.descricao) && c.situacao === "paga" && c.valorCentavos === 150000 && c.forma === "pix"));
    const fech = (await get("/api/comissoes/fechamentos", ger.token)).dados.fechamentos.find(f => f.barbeiroId === barb.id);
    assert.ok(fech.pagoEm && fech.aPagarCentavos === 1800);
    // relatório financeiro do mês: o salário entra nas saídas e no resultado
    const f = (await get(`/api/financeiro?periodo=mes&data=${HOJE}`, ger.token)).dados;
    assert.ok(f.saidas.contasCentavos >= 150000);
    const prof = f.profissionais.find(x => x.nome === pb.nome);
    assert.equal(prof.salarioCentavos, 150000);
    assert.equal(prof.custoCentavos, 152300);
    void b;
  });

  test("pagar com dinheiro do caixa vira sangria; permissões; isolamento", async () => {
    const amb = await cenario("eq2");
    const { post, get, ger, barb, cx } = amb;
    await post("/api/equipe/salario", ger.token, { usuarioId: cx.id, salarioCentavos: 100000 });
    const r = await post("/api/equipe/pagar", ger.token, { usuarioId: cx.id, mes: MES, comCaixa: true });
    assert.equal(r.status, 200, JSON.stringify(r.dados));
    const t = (await get("/api/caixa/hoje", cx.token)).dados.totais;
    assert.equal(t.sangriasCentavos, 100000);
    // barbeiro e caixa não acessam
    for (const quem of [barb, cx]) assert.equal((await get(`/api/equipe/pagamento?mes=${MES}`, quem.token)).status, 403);
    // gerente não define o próprio salário
    assert.equal((await post("/api/equipe/salario", ger.token, { usuarioId: ger.id, salarioCentavos: 1 })).status, 403);
    // mês futuro recusado
    assert.equal((await get("/api/equipe/pagamento?mes=2999-01", ger.token)).status, 400);
    // outra barbearia não vê nem paga
    const outra = await cenario("eq3", amb, amb.p);
    assert.ok(!(await get(`/api/equipe/pagamento?mes=${MES}`, outra.ger.token)).dados.pessoas.some(x => x.id === barb.id));
    assert.equal((await post("/api/equipe/pagar", outra.ger.token, { usuarioId: barb.id, mes: MES })).status, 404);
    assert.equal((await post("/api/equipe/salario", outra.ger.token, { usuarioId: barb.id, salarioCentavos: 1 })).status, 404);
  });
});
