// Cliente avulso (só o nome, sem WhatsApp) NÃO entra na lista de clientes cadastrados (27/11/2026). Dados fictícios.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { ambiente } from "./ambiente.js";

const AMANHA = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);

async function cenario(sufixo, amb, p) {
  const b = await amb.criarBarbearia(p, sufixo);
  const ger = await amb.criarUsuario(b.prop, `ger.${sufixo}`, "gerente");
  const barb = await amb.criarUsuario(ger.token, `barb.${sufixo}`, "barbeiro", { comissaoServicoBp: 5000 });
  const cx = await amb.criarUsuario(ger.token, `cx.${sufixo}`, "caixa");
  await amb.post("/api/funcionamento/salvar", ger.token, { dias: [0, 1, 2, 3, 4, 5, 6].map(dia => ({ dia, aberto: true, abre: "09:00", fecha: "12:00" })) });
  const corte = (await amb.post("/api/servicos", ger.token, { nome: "Corte", precoCentavos: 4000, duracaoMin: 30 })).dados.servico;
  return { b, ger, barb, cx, corte };
}

describe("clientes avulsos fora da base", () => {
  test("avulso do caixa e da agenda não aparece em Clientes, na busca nem nas mensagens; cadastrado com WhatsApp aparece; isolamento", async () => {
    const amb = ambiente();
    const { post, get } = amb;
    const p = await amb.criarPlataforma();
    const { ger, barb, cx, corte } = await cenario("av1", amb, p);
    await post("/api/caixa/abrir", cx.token, { trocoCentavos: 1000 });
    // caixa: só o nome
    const r = await post("/api/caixa/atendimento-avulso", cx.token, { barbeiroId: barb.id, itens: [{ servicoId: corte.id, precoCobradoCentavos: 4000 }],
      pagamentos: [{ forma: "dinheiro", valorCentavos: 4000 }], cliente: { nome: "Avulso Só Nome" } });
    assert.equal(r.status, 201, JSON.stringify(r.dados));
    // agenda: barbeiro marca só com o nome
    const m = await post("/api/agenda", barb.token, { data: AMANHA, hora: "10:00", servicoIds: [corte.id], cliente: { nome: "Avulso Da Agenda" } });
    assert.equal(m.status, 201, JSON.stringify(m.dados));
    // sem nada = "Cliente não identificado" (também avulso)
    await post("/api/caixa/atendimento-avulso", cx.token, { barbeiroId: barb.id, itens: [{ servicoId: corte.id, precoCobradoCentavos: 4000 }],
      pagamentos: [{ forma: "dinheiro", valorCentavos: 4000 }], cliente: {} });
    // cliente de verdade (com WhatsApp)
    const real = await post("/api/clientes", ger.token, { nome: "Cliente Cadastrado", telefone: "11 95555-1111", aceiteLgpd: true });
    assert.equal(real.status, 201);

    const nomes = (await get("/api/clientes", ger.token)).dados.clientes.map(c => c.nome);
    assert.deepEqual(nomes, ["Cliente Cadastrado"], "a lista só tem quem foi cadastrado");
    const busca = await get("/api/agenda/clientes?busca=Avulso", ger.token);
    assert.equal(busca.dados.clientes.length, 0, "a busca não acha avulso");
    assert.equal((await get("/api/agenda/clientes?busca=Cadastrado", ger.token)).dados.clientes.length, 1);
    const contatos = (await get("/api/mensagens/contatos", ger.token)).dados;
    assert.deepEqual((contatos.contatos || contatos.clientes || []).map(c => c.nome), ["Cliente Cadastrado"]);

    // o avulso continua no lançamento e na agenda (o nome fica guardado)
    const ag = (await get(`/api/agenda?data=${AMANHA}`, ger.token)).dados;
    assert.ok(JSON.stringify(ag).includes("Avulso Da Agenda"));
    // repetir o mesmo nome reaproveita o mesmo avulso (não cria outro)
    const m2 = await post("/api/agenda", barb.token, { data: AMANHA, hora: "11:00", servicoIds: [corte.id], cliente: { nome: "avulso da agenda" } });
    assert.equal(m2.status, 201, JSON.stringify(m2.dados));
    assert.equal((await get("/api/clientes", ger.token)).dados.clientes.length, 1);

    // outra barbearia não vê nada disso
    const o = await cenario("av2", amb, p);
    assert.equal((await get("/api/clientes", o.ger.token)).dados.clientes.length, 0);
    assert.equal((await get("/api/agenda/clientes?busca=Avulso", o.ger.token)).dados.clientes.length, 0);
  });
});
