// Atendimentos sobrepostos (27/11/2026): o barbeiro atende outro cliente enquanto o da progressiva espera o produto agir. Dados fictícios.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { ambiente } from "./ambiente.js";
import { hojeBrasil } from "../src/util.js";
import { somarDias } from "../src/agenda-util.js";

const SEMANA = [0, 1, 2, 3, 4, 5, 6].map(dia => ({ dia, aberto: true, abre: "08:00", fecha: "20:00" }));

describe("marcar por cima de outro atendimento", () => {
  test("sem aceite: 409 sobreposicao com a lista; com aceite: marca os dois, audita; bloqueio continua recusado; outro barbeiro/barbearia não são afetados", async () => {
    const amb = ambiente();
    const { post, get } = amb;
    const p = await amb.criarPlataforma();
    const b = await amb.criarBarbearia(p, "sob1");
    const barb = await amb.criarUsuario(b.prop, "barb.sob1", "barbeiro");
    const outro = await amb.criarUsuario(b.prop, "outro.sob1", "barbeiro");
    await post("/api/funcionamento/salvar", b.prop, { dias: SEMANA });
    const prog = (await post("/api/servicos", b.prop, { nome: "Progressiva", precoCentavos: 20000, duracaoMin: 90 })).dados.servico;
    const corte = (await post("/api/servicos", b.prop, { nome: "Corte", precoCentavos: 4000, duracaoMin: 30 })).dados.servico;
    const dia = somarDias(hojeBrasil(), 1);
    // 16:00 progressiva (90 min)
    assert.equal((await post("/api/agenda", barb.token, { data: dia, hora: "16:00", servicoIds: [prog.id], cliente: { nome: "Cliente Progressiva" } })).status, 201);
    // 16:30 corte: cruza
    const corpo = { data: dia, hora: "16:30", servicoIds: [corte.id], cliente: { nome: "Cliente Corte" } };
    const r0 = await post("/api/agenda", barb.token, corpo);
    assert.equal(r0.status, 409);
    assert.equal(r0.dados.codigo, "sobreposicao");
    assert.equal(r0.dados.conflitos.length, 1);
    assert.deepEqual([r0.dados.conflitos[0].cliente, r0.dados.conflitos[0].inicio, r0.dados.conflitos[0].fim, r0.dados.conflitos[0].servicos], ["Cliente Progressiva", "16:00", "17:30", "Progressiva"]);
    assert.match(r0.dados.erro, /Cliente Progressiva/);
    // nada foi criado (nem o cliente novo)
    assert.equal(amb.env.DB.raw.prepare("SELECT COUNT(*) n FROM clientes WHERE nome = 'Cliente Corte'").get().n, 0);
    // com o aceite, o barbeiro marca por cima
    const r1 = await post("/api/agenda", barb.token, { ...corpo, aceiteSobreposicao: true });
    assert.equal(r1.status, 201, JSON.stringify(r1.dados));
    const ag = (await get(`/api/agenda?data=${dia}`, barb.token)).dados.agendamentos;
    assert.equal(ag.filter(a => a.situacao === "agendado").length, 2, "os dois na agenda do barbeiro");
    const aud = amb.env.DB.raw.prepare("SELECT detalhes FROM auditoria WHERE acao = 'marcou_sobreposto'").get();
    assert.ok(aud && /Cliente Progressiva 16:00–17:30/.test(aud.detalhes));
    // bloqueio nunca é atropelado, nem com aceite
    const blq = await post("/api/agenda/bloqueios", barb.token, { inicio: `${dia}T18:00`, fim: `${dia}T19:00`, motivo: "Almoço" });
    assert.equal(blq.status, 201, JSON.stringify(blq.dados));
    assert.equal((await post("/api/agenda", barb.token, { data: dia, hora: "18:00", servicoIds: [corte.id], cliente: { nome: "Cliente Bloqueio" }, aceiteSobreposicao: true })).status, 409);
    // outro barbeiro no mesmo horário NÃO é conflito (sem aceite)
    assert.equal((await post("/api/agenda", b.prop, { barbeiroId: outro.id, data: dia, hora: "16:30", servicoIds: [corte.id], cliente: { nome: "Cliente do Outro" } })).status, 201);
    // barbeiro não marca na agenda de outro, mesmo com aceite
    assert.equal((await post("/api/agenda", barb.token, { barbeiroId: outro.id, data: dia, hora: "16:30", servicoIds: [corte.id], cliente: { nome: "X" }, aceiteSobreposicao: true })).status, 403);
    // outra barbearia não enxerga nada disso
    const b2 = await amb.criarBarbearia(p, "sob2");
    const ag2 = (await get(`/api/agenda?data=${dia}`, b2.prop)).dados.agendamentos;
    assert.equal(ag2.length, 0);
  });
});
