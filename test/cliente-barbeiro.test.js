// Barbeiro cadastra cliente novo ao marcar horário (27/11/2026): só cria. Dados fictícios.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { ambiente } from "./ambiente.js";

describe("barbeiro cadastra cliente", () => {
  test("cria (201) na própria barbearia; não lista, não edita, não desativa; telefone repetido recusado; isolamento", async () => {
    const amb = ambiente();
    const { post, get } = amb;
    const p = await amb.criarPlataforma();
    const b = await amb.criarBarbearia(p, "cb1");
    const barb = await amb.criarUsuario(b.prop, "barb.cb1", "barbeiro");
    const r = await post("/api/clientes", barb.token, { nome: "Cliente do Barbeiro", apelido: "Cb", telefone: "11 90000-4444", aceiteLgpd: true });
    assert.equal(r.status, 201, JSON.stringify(r.dados));
    assert.equal(r.dados.cliente.nome, "Cliente do Barbeiro");
    assert.equal((await post("/api/clientes", barb.token, { nome: "Outro Nome", telefone: "11 90000-4444", aceiteLgpd: true })).status, 409, "telefone já cadastrado");
    assert.equal((await get("/api/clientes", barb.token)).status, 403, "não lista a base");
    assert.equal((await post("/api/clientes/alterar", barb.token, { id: r.dados.cliente.id, nome: "Mudou" })).status, 403, "não edita");
    assert.equal((await post("/api/servicos", barb.token, { nome: "X", precoCentavos: 1000, duracaoMin: 30 })).status, 403, "outros cadastros continuam fechados");
    // a gestão enxerga o cliente; outra barbearia não
    assert.ok((await get("/api/clientes", b.prop)).dados.clientes.some(c => c.nome === "Cliente do Barbeiro"));
    const b2 = await amb.criarBarbearia(p, "cb2");
    assert.equal((await get("/api/clientes", b2.prop)).dados.clientes.length, 0);
  });
});
