// Gerente/dono lança com o caixa fechado ou ainda não aberto (pedido de 17/11/2026). Equipe continua precisando do caixa aberto.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { ambiente } from "./ambiente.js";
import { hojeBrasil } from "../src/util.js";

const HOJE = hojeBrasil();

async function cenario(sufixo = "gcf", amb = ambiente(), plataforma = null) {
  const p = plataforma || await amb.criarPlataforma();
  const b = await amb.criarBarbearia(p, sufixo);
  const ger = await amb.criarUsuario(b.prop, `ger.${sufixo}`, "gerente");
  const barb = await amb.criarUsuario(ger.token, `barb.${sufixo}`, "barbeiro", { comissaoServicoBp: 5000 });
  const cx = await amb.criarUsuario(ger.token, `cx.${sufixo}`, "caixa");
  await amb.post("/api/funcionamento/salvar", ger.token, { dias: [0, 1, 2, 3, 4, 5, 6].map(dia => ({ dia, aberto: true, abre: "00:00", fecha: "23:30" })) });
  const corte = (await amb.post("/api/servicos", ger.token, { nome: "Corte", precoCentavos: 4000, duracaoMin: 30 })).dados.servico;
  const pom = (await amb.post("/api/produtos", ger.token, { nome: "Pomada", precoCentavos: 3000, estoqueInicial: { quantidade: 5, custoUnitCentavos: 1000 } })).dados.produto;
  return { ...amb, p, b, ger, barb, cx, corte, pom };
}
const marcar = (amb, hora, quem = amb.ger) => amb.post("/api/agenda", quem.token, { barbeiroId: amb.barb.id, data: HOJE, hora, servicoIds: [amb.corte.id], cliente: { nome: `Cliente ${hora}` } }).then(r => r.dados.agendamento);

describe("gerente lança com o caixa fechado ou sem abrir", () => {
  test("sem caixa: equipe é recusada; gerente cobra e vende (o caixa do dia abre sozinho, troco 0)", async () => {
    const amb = await cenario();
    const { post, get, ger, barb, cx, corte, pom, env } = amb;
    const m = await marcar(amb, "08:00");
    const corpo = { id: m.id, itens: [{ servicoId: corte.id, precoCobradoCentavos: 4000 }], pagamentos: [{ forma: "pix", valorCentavos: 4000 }] };
    assert.equal((await post("/api/caixa/cobrar", cx.token, corpo)).status, 409, "caixa (pessoa) precisa do caixa aberto");
    assert.equal((await post("/api/vendas", barb.token, { itens: [{ produtoId: pom.id, quantidade: 1 }], pagamentos: [{ forma: "pix", valorCentavos: 3000 }] })).status, 409);
    assert.equal(env.DB.raw.prepare("SELECT COUNT(*) n FROM caixas").get().n, 0);
    assert.equal((await post("/api/caixa/cobrar", ger.token, corpo)).status, 201);
    assert.equal((await post("/api/vendas", ger.token, { itens: [{ produtoId: pom.id, quantidade: 1 }], pagamentos: [{ forma: "dinheiro", valorCentavos: 3000 }] })).status, 201);
    const c = (await get("/api/caixa/hoje", ger.token)).dados;
    assert.deepEqual([c.caixa.situacao, c.caixa.trocoCentavos, c.totais.entradasCentavos], ["aberto", 0, 7000]);
    assert.ok(env.DB.raw.prepare("SELECT 1 FROM auditoria WHERE acao = 'caixa_aberto' AND detalhes LIKE '%automaticamente%'").get());
    // já tem lançamento: abrir com troco é recusado (o troco entra como suprimento)
    assert.equal((await post("/api/caixa/abrir", cx.token, { trocoCentavos: 10000 })).status, 409);
  });

  test("caixa aberto sozinho e ainda vazio: quem chega pode definir o troco ao abrir", async () => {
    const amb = await cenario("gcf2");
    const { post, get, ger, cx, corte } = amb;
    const m = await marcar(amb, "09:00");
    // tentativa do gerente com valor inválido: recusada, mas o caixa já tinha sido criado vazio
    await post("/api/caixa/cobrar", ger.token, { id: m.id, itens: [{ servicoId: corte.id, precoCobradoCentavos: -1 }], pagamentos: [] });
    const r = await post("/api/caixa/abrir", cx.token, { trocoCentavos: 10000 });
    assert.equal(r.status, 201, JSON.stringify(r.dados));
    assert.equal((await get("/api/caixa/hoje", cx.token)).dados.caixa.trocoCentavos, 10000);
  });

  test("caixa fechado: gerente cobra, vende, recebe nota e faz sangria; equipe é recusada", async () => {
    const amb = await cenario("gcf3");
    const { post, get, ger, barb, cx, corte, pom } = amb;
    await post("/api/caixa/abrir", cx.token, { trocoCentavos: 0 });
    const cli = (await post("/api/clientes", ger.token, { nome: "Cliente Nota", telefone: "11 95555-6060", aceiteLgpd: true })).dados.cliente;
    const mn = (await post("/api/agenda", cx.token, { barbeiroId: barb.id, data: HOJE, hora: "07:00", servicoIds: [corte.id], cliente: { id: cli.id } })).dados.agendamento;
    await post("/api/caixa/cobrar", cx.token, { id: mn.id, itens: [{ servicoId: corte.id, precoCobradoCentavos: 4000 }], pagamentos: [{ forma: "promissoria", valorCentavos: 4000 }] });
    assert.equal((await post("/api/caixa/fechar", cx.token, { contadoCentavos: 0 })).status, 200);
    const m = await marcar(amb, "10:00");
    const corpo = { id: m.id, itens: [{ servicoId: corte.id, precoCobradoCentavos: 4000 }], pagamentos: [{ forma: "debito", valorCentavos: 4000 }] };
    assert.equal((await post("/api/caixa/cobrar", cx.token, corpo)).status, 409);
    assert.equal((await post("/api/agenda/finalizar", barb.token, corpo)).status, 409);
    assert.equal((await post("/api/caixa/cobrar", ger.token, corpo)).status, 201, "gerente cobra com o caixa fechado");
    assert.equal((await post("/api/vendas", ger.token, { itens: [{ produtoId: pom.id, quantidade: 1 }], pagamentos: [{ forma: "pix", valorCentavos: 3000 }] })).status, 201);
    const nota = (await get("/api/promissorias", ger.token)).dados.clientes[0];
    assert.equal((await post("/api/promissorias/receber", cx.token, { clienteId: cli.id, promissoriaIds: nota.notas.map(n => n.id), pagamentos: [{ forma: "pix", valorCentavos: 4000 }] })).status, 409);
    assert.equal((await post("/api/promissorias/receber", ger.token, { clienteId: cli.id, promissoriaIds: nota.notas.map(n => n.id), pagamentos: [{ forma: "pix", valorCentavos: 4000 }] })).status, 201);
    assert.equal((await post("/api/caixa/movimento", ger.token, { tipo: "suprimento", valorCentavos: 2000, motivo: "Troco extra" })).status, 201);
    assert.equal((await post("/api/caixa/movimento", cx.token, { tipo: "suprimento", valorCentavos: 2000, motivo: "Troco extra" })).status, 409);
    const c = (await get("/api/caixa/hoje", ger.token)).dados;
    assert.equal(c.caixa.situacao, "fechado", "o caixa continua fechado");
    assert.equal(c.totais.entradasCentavos, 11000, "4000 + 3000 + nota 4000 entraram depois do fechamento");
    // financeiro do dia já mostra tudo
    assert.equal((await get(`/api/financeiro?periodo=dia&data=${HOJE}`, ger.token)).dados.totais.entradasCentavos, 11000);
  });
});
