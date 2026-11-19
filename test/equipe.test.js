// Pagamento da equipe: salário + comissão − vales por pessoa, por mês; pagar registra tudo e entra nos relatórios.
// Pedido de 17/11/2026. Dados fictícios.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { ambiente } from "./ambiente.js";
import { hojeBrasil } from "../src/util.js";
import { semanaSimulada, emDia, voltar, SEMANA } from "./semana-gestao.js";

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

  test("panorama da pessoa: dias trabalhados, atendimentos, produção, comissão, indicadores e recibo; isolamento", async () => {
    const amb = await cenario("pan");
    const { post, get, ger, barb, cx } = amb;
    await post("/api/equipe/salario", ger.token, { usuarioId: barb.id, salarioCentavos: 150000 });
    const r = await get(`/api/equipe/pessoa?id=${barb.id}&mes=${MES}`, ger.token);
    assert.equal(r.status, 200, JSON.stringify(r.dados));
    const p = r.dados.pessoa;
    assert.deepEqual([p.producao.diasTrabalhados, p.producao.atendimentosQtd, p.producao.totalCentavos, p.producao.ticketMedioCentavos, p.producao.mediaPorDiaCentavos],
      [1, 1, 7000, 4000, 7000]);
    assert.deepEqual([p.comissao.totalCentavos, p.comissaoServicoBp, p.comissaoProdutoBp], [2300, 5000, 1000]);
    assert.equal(r.dados.indicadores.clientesAtendidos, 1);
    assert.equal(r.dados.indicadores.melhorDia.totalCentavos, 7000);
    assert.equal(r.dados.servicos[0].nome, "Corte");
    assert.ok(r.dados.porDia.length >= 28 && r.dados.porDia.some(d => d.servicosCentavos === 4000 && d.produtosCentavos === 3000));
    assert.equal(p.aPagar.totalCentavos, 151800);
    // lista mostra dias trabalhados e o que já foi pago
    const q = (await get(`/api/equipe/pagamento?mes=${MES}`, ger.token)).dados;
    assert.equal(q.pessoas.find(x => x.id === barb.id).producao.diasTrabalhados, 1);
    assert.equal(q.totais.pagoCentavos, 0);
    await post("/api/equipe/pagar", ger.token, { usuarioId: barb.id, mes: MES, forma: "pix" });
    assert.equal((await get(`/api/equipe/pagamento?mes=${MES}`, ger.token)).dados.totais.pagoCentavos, 151800);
    const depois = (await get(`/api/equipe/pessoa?id=${barb.id}&mes=${MES}`, ger.token)).dados;
    assert.equal(depois.pagamentos.length, 2, "salário + comissão");
    // permissões e isolamento
    assert.equal((await get(`/api/equipe/pessoa?id=${barb.id}&mes=${MES}`, barb.token)).status, 403);
    assert.equal((await get(`/api/equipe/pessoa?id=${barb.id}&mes=${MES}`, cx.token)).status, 403);
    const outra = await cenario("pan2", amb, amb.p);
    assert.equal((await get(`/api/equipe/pessoa?id=${barb.id}&mes=${MES}`, outra.ger.token)).status, 404);
  });

  test("salário base no cadastro da equipe (opcional) e na edição; aparece no pagamento da equipe", async () => {
    const amb = await cenario("eqc");
    const { post, get, ger, b } = amb;
    const r = await post("/api/usuarios", ger.token, { perfil: "barbeiro", nome: "Novo Fictício", login: "novo.eqc", comissaoServicoBp: 4000, comissaoProdutoBp: 0, salarioCentavos: 180000 });
    assert.equal(r.status, 201, JSON.stringify(r.dados));
    assert.equal(r.dados.usuario.salarioCentavos, 180000);
    const sem = await post("/api/usuarios", ger.token, { perfil: "caixa", nome: "Sem Salário", login: "sem.eqc" });
    assert.equal(sem.dados.usuario.salarioCentavos, 0, "opcional");
    assert.equal((await post("/api/usuarios", ger.token, { perfil: "caixa", nome: "Erro", login: "erro.eqc", salarioCentavos: -1 })).status, 400);
    let q = (await get(`/api/equipe/pagamento?mes=${MES}`, ger.token)).dados;
    assert.equal(q.pessoas.find(x => x.id === r.dados.usuario.id).salario.valorCentavos, 180000);
    const alt = await post("/api/usuarios/alterar", ger.token, { id: r.dados.usuario.id, salarioCentavos: 190000 });
    assert.equal(alt.status, 200, JSON.stringify(alt.dados));
    assert.equal(alt.dados.usuario.salarioCentavos, 190000);
    assert.equal((await get("/api/usuarios", ger.token)).dados.usuarios.find(u => u.id === r.dados.usuario.id).salarioCentavos, 190000);
    // gerente não muda o próprio salário pela equipe
    assert.equal((await post("/api/usuarios/alterar", ger.token, { id: ger.id, salarioCentavos: 1 })).status, 403);
    // o dono define o pró-labore dele
    assert.equal((await post("/api/usuarios/alterar", b.prop, { id: (await get("/api/usuarios", b.prop)).dados.usuarios.find(u => u.perfil === "proprietario").id, salarioCentavos: 300000 })).status, 200);
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

describe("minha produção (barbeiro vê só a própria)", () => {
  test("barbeiro vê produção e comissão dele; caixa não; ninguém vê a de outro", async () => {
    const s = await semanaSimulada();
    const { get, A, B, cx } = s;
    const mes = SEMANA[0].slice(0, 7);
    emDia(SEMANA[6]);
    const a = await get(`/api/equipe/minha-producao?mes=${mes}`, A.token);
    assert.equal(a.status, 200, JSON.stringify(a.dados));
    assert.equal(a.dados.pessoa.id, A.id);
    assert.equal(a.dados.pessoa.custoCentavos, undefined, "sem custo para a barbearia");
    assert.ok(a.dados.pessoa.producao.totalCentavos > 0 && a.dados.pessoa.comissao.totalCentavos > 0);
    // pedir de outra pessoa não funciona: a rota ignora id e sempre devolve o próprio
    const b = await get(`/api/equipe/minha-producao?mes=${mes}&id=${A.id}`, B.token);
    assert.equal(b.dados.pessoa.id, B.id);
    assert.notEqual(b.dados.pessoa.producao.totalCentavos, a.dados.pessoa.producao.totalCentavos);
    assert.equal((await get(`/api/equipe/minha-producao?mes=${mes}`, cx.token)).status, 403);
    assert.equal((await get(`/api/equipe/pessoa?id=${A.id}&mes=${mes}`, A.token)).status, 403, "panorama de outros é só da gestão");
    voltar();
  });
});
