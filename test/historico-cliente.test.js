// Histórico do cliente (25/11/2026): notas em aberto, próximos, concluídos, faltas, cancelamentos e compras. Dados fictícios.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { ambiente } from "./ambiente.js";
import { hojeBrasil } from "../src/util.js";
import { somarDias } from "../src/agenda-util.js";

const HOJE = hojeBrasil();

async function cenario(sufixo = "his", amb = ambiente(), plataforma = null) {
  const p = plataforma || await amb.criarPlataforma();
  const b = await amb.criarBarbearia(p, sufixo);
  const ger = await amb.criarUsuario(b.prop, `ger.${sufixo}`, "gerente", { comissaoServicoBp: 4000 });
  const barb = await amb.criarUsuario(ger.token, `barb.${sufixo}`, "barbeiro", { comissaoServicoBp: 5000 });
  const cx = await amb.criarUsuario(ger.token, `cx.${sufixo}`, "caixa");
  await amb.post("/api/funcionamento/salvar", ger.token, { dias: [0, 1, 2, 3, 4, 5, 6].map(dia => ({ dia, aberto: true, abre: "00:00", fecha: "23:30" })) });
  const corte = (await amb.post("/api/servicos", ger.token, { nome: "Corte", precoCentavos: 4000, duracaoMin: 30 })).dados.servico;
  const barba = (await amb.post("/api/servicos", ger.token, { nome: "Barba", precoCentavos: 3000, duracaoMin: 30 })).dados.servico;
  const cli = (await amb.post("/api/clientes", ger.token, { nome: "Historia Fictícia", apelido: "Hist", telefone: "11 95555-3030", aceiteLgpd: true })).dados.cliente;
  await amb.post("/api/caixa/abrir", cx.token, { trocoCentavos: 0 });
  return { ...amb, p, b, ger, barb, cx, corte, barba, cli };
}

describe("histórico do cliente", () => {
  test("junta nota em aberto, próximos, concluídos (valor, serviços, forma), falta, cancelado e compra", async () => {
    const a = await cenario();
    const { post, get, ger, barb, cx, corte, barba, cli, env } = a;
    const marcar = async (hora, ids, data = HOJE) => (await post("/api/agenda", ger.token, { barbeiroId: barb.id, data, hora, servicoIds: ids, cliente: { id: cli.id } })).dados.agendamento;
    // 1) concluído no Pix (corte + barba = 70)
    const m1 = await marcar("00:00", [corte.id, barba.id]);
    assert.equal((await post("/api/caixa/cobrar", cx.token, { id: m1.id, itens: [{ servicoId: corte.id, precoCobradoCentavos: 4000 }, { servicoId: barba.id, precoCobradoCentavos: 3000 }], pagamentos: [{ forma: "pix", valorCentavos: 7000 }] })).status, 201);
    // 2) concluído na nota (promissória) de 40
    const m2 = await marcar("01:00", [corte.id]);
    assert.equal((await post("/api/caixa/cobrar", cx.token, { id: m2.id, itens: [{ servicoId: corte.id, precoCobradoCentavos: 4000 }], pagamentos: [{ forma: "promissoria", valorCentavos: 4000 }] })).status, 201);
    // 3) falta e 4) cancelado
    const m3 = await marcar("02:00", [corte.id]);
    await post("/api/agenda/situacao", ger.token, { id: m3.id, situacao: "faltou" });
    const m4 = await marcar("03:00", [corte.id]);
    await post("/api/agenda/situacao", ger.token, { id: m4.id, situacao: "cancelado", motivo: "Cliente desistiu" });
    // 5) próximo (amanhã)
    await marcar("10:00", [barba.id], somarDias(HOJE, 1));
    // 6) compra de produto
    const prod = (await post("/api/produtos", ger.token, { nome: "Pomada", precoCentavos: 4500, estoqueInicial: { quantidade: 3, custoUnitCentavos: 2000 } })).dados.produto;
    assert.equal((await post("/api/vendas", cx.token, { itens: [{ produtoId: prod.id, quantidade: 2 }], pagamentos: [{ forma: "dinheiro", valorCentavos: 9000 }], clienteId: cli.id })).status, 201);

    const r = await get(`/api/clientes/historico?id=${cli.id}`, cx.token);
    assert.equal(r.status, 200, JSON.stringify(r.dados));
    const h = r.dados;
    assert.equal(h.cliente.nome, "Historia Fictícia");
    assert.equal(h.cliente.apelido, "Hist");
    assert.equal(h.notasAbertas.totalCentavos, 4000);
    assert.equal(h.notasAbertas.notas.length, 1);
    assert.equal(h.resumo.atendimentos, 2);
    assert.equal(h.resumo.gastoCentavos, 11000);
    assert.equal(h.resumo.ticketMedioCentavos, 5500);
    assert.equal(h.resumo.faltas, 1);
    assert.equal(h.resumo.cancelamentos, 1);
    assert.equal(h.resumo.comprasCentavos, 9000);
    assert.equal(h.resumo.ultimaVisita, HOJE);
    assert.equal(h.proximos.length, 1);
    assert.equal(h.proximos[0].servicos, "Barba");
    const pix = h.atendimentos.find(x => x.hora === "00:00");
    assert.deepEqual([pix.servicos, pix.totalCentavos, pix.formas, pix.barbeiro], ["Corte + Barba", 7000, ["pix"], barb.nome || pix.barbeiro]);
    assert.deepEqual(h.atendimentos.find(x => x.hora === "01:00").formas, ["promissoria"]);
    assert.equal(h.faltas.length, 1);
    assert.equal(h.cancelados[0].motivo, "Cliente desistiu");
    assert.equal(h.compras[0].itens, "2x Pomada");
    // nunca mostra comissão nem custo
    assert.ok(!JSON.stringify(h).match(/comiss|custo/i));
    // horário excluído some do histórico
    assert.equal(env.DB.raw.prepare("SELECT COUNT(*) n FROM agendamentos WHERE cliente_id = ?").get(cli.id).n, 5);
  });

  test("barbeiro não vê; gerente e caixa veem; cliente de outra barbearia é 404 (isolamento)", async () => {
    const amb = ambiente();
    const p = await amb.criarPlataforma();
    const a = await cenario("ha", amb, p);
    const o = await cenario("hb", amb, p);
    assert.equal((await a.get(`/api/clientes/historico?id=${a.cli.id}`, a.barb.token)).status, 403);
    assert.equal((await a.get(`/api/clientes/historico?id=${a.cli.id}`, a.ger.token)).status, 200);
    assert.equal((await a.get(`/api/clientes/historico?id=${a.cli.id}`, a.cx.token)).status, 200);
    assert.equal((await a.get(`/api/clientes/historico?id=${o.cli.id}`, a.ger.token)).status, 404, "cliente de outra barbearia");
    assert.equal((await a.get(`/api/clientes/historico?id=${o.cli.id}`, a.cx.token)).status, 404);
    assert.equal((await a.get("/api/clientes/historico?id=nao-existe", a.ger.token)).status, 400);
    assert.equal((await a.get(`/api/clientes/historico?id=${a.cli.id}`, null)).status, 401);
  });

  test("cliente novo, sem nada: histórico vazio, sem erro", async () => {
    const a = await cenario("hz");
    const h = (await a.get(`/api/clientes/historico?id=${a.cli.id}`, a.ger.token)).dados;
    assert.deepEqual([h.resumo.atendimentos, h.resumo.gastoCentavos, h.resumo.ultimaVisita, h.notasAbertas.notas.length, h.proximos.length, h.atendimentos.length], [0, 0, null, 0, 0, 0]);
  });
});
