// Marcar fora do funcionamento com aceite (25/11/2026) + horário fixo junto. Dados fictícios.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { ambiente } from "./ambiente.js";
import { hojeBrasil } from "../src/util.js";
import { somarDias } from "../src/agenda-util.js";

const SEMANA = [0, 1, 2, 3, 4, 5, 6].map(dia => ({ dia, aberto: true, abre: "08:00", fecha: "19:00" }));

describe("marcar fora do horário", () => {
  test("sem aceite: 409 fora_do_horario; com aceite: marca e audita; conflito continua recusado; série inteira com aceite", async () => {
    const amb = ambiente();
    const { post, get } = amb;
    const p = await amb.criarPlataforma();
    const b = await amb.criarBarbearia(p, "fh1");
    const barb = await amb.criarUsuario(b.prop, "barb.fh1", "barbeiro");
    await post("/api/funcionamento/salvar", b.prop, { dias: SEMANA });
    const corte = (await post("/api/servicos", b.prop, { nome: "Corte", precoCentavos: 4000, duracaoMin: 60 })).dados.servico;
    const dia = somarDias(hojeBrasil(), 2);
    const corpo = { barbeiroId: barb.id, data: dia, hora: "18:30", servicoIds: [corte.id], cliente: { nome: "Cliente Tarde" } };
    const r0 = await post("/api/agenda", b.prop, corpo);
    assert.equal(r0.status, 409);
    assert.equal(r0.dados.codigo, "fora_do_horario");
    assert.match(r0.dados.erro, /Fora do funcionamento/);
    const r1 = await post("/api/agenda", b.prop, { ...corpo, aceiteForaHorario: true });
    assert.equal(r1.status, 201, JSON.stringify(r1.dados));
    const ag = (await get(`/api/agenda?data=${dia}`, b.prop)).dados.agendamentos;
    assert.ok(ag.some(a => a.inicio.endsWith("18:30") && a.fim.endsWith("19:30")));
    assert.ok(amb.env.DB.raw.prepare("SELECT 1 FROM auditoria WHERE acao = 'marcou_fora_do_horario'").get());
    // Conflito: mesmo com aceite, não marca por cima
    assert.equal((await post("/api/agenda", b.prop, { ...corpo, cliente: { nome: "Outro" }, aceiteForaHorario: true })).status, 409);
    // Horário fixo fora do funcionamento: todas as semanas entram com o aceite
    const s = await post("/api/agenda", b.prop, { ...corpo, hora: "20:00", cliente: { nome: "Cliente Fixo" }, aceiteForaHorario: true,
      repetir: { intervaloSemanas: 1, ate: somarDias(dia, 21) } });
    assert.equal(s.status, 201, JSON.stringify(s.dados));
    assert.equal(s.dados.serie.criados, 4);
    assert.deepEqual(s.dados.serie.pulados, []);
    // Barbeiro também pode (na própria agenda)
    assert.equal((await post("/api/agenda", barb.token, { ...corpo, hora: "07:00", cliente: { nome: "Cedo" } })).dados.codigo, "fora_do_horario");
    assert.equal((await post("/api/agenda", barb.token, { ...corpo, hora: "07:00", cliente: { nome: "Cedo" }, aceiteForaHorario: true })).status, 201);
  });
});
