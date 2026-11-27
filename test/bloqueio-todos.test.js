// Bloquear a agenda de todos os profissionais de uma vez; caixa também bloqueia e desbloqueia (27/11/2026). Dados fictícios.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { ambiente } from "./ambiente.js";

const AMANHA = new Date(Date.now() + 86400000).toISOString().slice(0, 10);

async function cenario(sufixo, amb, p) {
  const b = await amb.criarBarbearia(p, sufixo);
  const ger = await amb.criarUsuario(b.prop, `ger.${sufixo}`, "gerente");
  const barb = await amb.criarUsuario(ger.token, `barb.${sufixo}`, "barbeiro");
  const barb2 = await amb.criarUsuario(ger.token, `barbb.${sufixo}`, "barbeiro");
  const cx = await amb.criarUsuario(ger.token, `cx.${sufixo}`, "caixa");
  return { b, ger, barb, barb2, cx };
}

describe("bloquear todos", () => {
  test("caixa e gestão bloqueiam todos; barbeiro não; desbloqueio do grupo; isolamento", async () => {
    const amb = ambiente();
    const { post, get } = amb;
    const p = await amb.criarPlataforma();
    const A = await cenario("bt1", amb, p);
    const corpo = { barbeiroId: "todos", inicio: `${AMANHA}T12:00`, fim: `${AMANHA}T13:00`, motivo: "Almoço" };
    assert.equal((await post("/api/agenda/bloqueios", A.barb.token, corpo)).status, 403, "barbeiro não bloqueia todos");
    const r = await post("/api/agenda/bloqueios", A.cx.token, corpo);
    assert.equal(r.status, 201, JSON.stringify(r.dados));
    // dono, gerente, 2 barbeiros = 4 profissionais ativos
    assert.equal(r.dados.bloqueios.length, 4);
    // caixa também desbloqueia o grupo todo
    assert.equal((await post("/api/agenda/bloqueios/cancelar", A.cx.token, { id: r.dados.bloqueio.id })).status, 400, "motivo obrigatório");
    const c = await post("/api/agenda/bloqueios/cancelar", A.cx.token, { id: r.dados.bloqueio.id, motivo: "Mudou", todos: true });
    assert.equal(c.status, 200);
    assert.equal(c.dados.cancelados, 4);
    // barbeiro não desbloqueia todos
    const r2 = await post("/api/agenda/bloqueios", A.ger.token, corpo);
    assert.equal(r2.status, 201);
    const meu = r2.dados.bloqueios.find(b => b.barbeiroId === A.barb.id);
    assert.equal((await post("/api/agenda/bloqueios/cancelar", A.barb.token, { id: meu.id, motivo: "Motivo de teste", todos: true })).status, 403);
    // outra barbearia: não enxerga nem mexe
    const B = await cenario("bt2", amb, p);
    assert.equal((await post("/api/agenda/bloqueios/cancelar", B.cx.token, { id: meu.id, motivo: "Motivo de teste", todos: true })).status, 404);
    // bloqueio de um só continua valendo para o caixa
    const um = await post("/api/agenda/bloqueios", A.cx.token, { barbeiroId: A.barb2.id, inicio: `${AMANHA}T15:00`, fim: `${AMANHA}T16:00` });
    assert.equal(um.status, 201);
    assert.equal(um.dados.bloqueios.length, 1);
  });

  test("bloqueia o dia todo de todos quando não há atendimento marcado", async () => {
    const amb = ambiente();
    const { post } = amb;
    const p = await amb.criarPlataforma();
    const A = await cenario("bt3", amb, p);
    const corpo = { barbeiroId: "todos", inicio: `${AMANHA}T00:00`, fim: `${AMANHA}T23:59` };
    // sem horário marcado: ok
    assert.equal((await post("/api/agenda/bloqueios", A.ger.token, corpo)).status, 201);
  });
});
