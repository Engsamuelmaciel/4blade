// Editar a repetição de um horário fixo (25/11/2026): mudar a frequência, a data final ou parar de repetir.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { ambiente } from "./ambiente.js";
import { hojeBrasil } from "../src/util.js";
import { somarDias } from "../src/agenda-util.js";

const SEMANA = [0, 1, 2, 3, 4, 5, 6].map(dia => ({ dia, aberto: true, abre: "08:00", fecha: "20:00" }));
const D = somarDias(hojeBrasil(), 1);

async function cenario(suf) {
  const amb = ambiente();
  const p = await amb.criarPlataforma();
  const b = await amb.criarBarbearia(p, suf);
  const barb = await amb.criarUsuario(b.prop, `barb.${suf}`, "barbeiro");
  const barb2 = await amb.criarUsuario(b.prop, `barb2.${suf}`, "barbeiro");
  await amb.post("/api/funcionamento/salvar", b.prop, { dias: SEMANA });
  const corte = (await amb.post("/api/servicos", b.prop, { nome: "Corte", precoCentavos: 4000, duracaoMin: 30 })).dados.servico;
  const r = await amb.post("/api/agenda", barb.token, { data: D, hora: "12:00", servicoIds: [corte.id], cliente: { nome: "Cliente Fixo" },
    repetir: { intervaloSemanas: 1, ate: somarDias(D, 28) } });
  assert.equal(r.status, 201, JSON.stringify(r.dados));
  const doDia = async d => (await amb.get(`/api/agenda?data=${d}`, barb.token)).dados.agendamentos.filter(x => x.cliente.nome === "Cliente Fixo" && x.situacao === "agendado");
  return { ...amb, p, b, barb, barb2, corte, doDia };
}

describe("editar repetição do horário fixo", () => {
  test("de semanal para a cada 15 dias, a partir do 2º; anteriores ficam; auditado", async () => {
    const { post, barb, doDia } = await cenario("er1");
    const seg = (await doDia(somarDias(D, 7)))[0];
    assert.equal(seg.serie.intervaloSemanas, 1);
    assert.equal(seg.serie.ate, somarDias(D, 28));
    const r = await post("/api/agenda/serie/editar", barb.token, { id: seg.id, intervaloSemanas: 2, ate: somarDias(D, 63) });
    assert.equal(r.status, 200, JSON.stringify(r.dados));
    assert.equal(r.dados.removidos, 3);   // +14, +21, +28
    assert.deepEqual(r.dados.datas, [somarDias(D, 21), somarDias(D, 35), somarDias(D, 49), somarDias(D, 63)]);
    assert.equal((await doDia(D)).length, 1, "o anterior continua");
    assert.equal((await doDia(somarDias(D, 7))).length, 1, "este continua");
    assert.equal((await doDia(somarDias(D, 14))).length, 0, "o +14 saiu");
    const novo = (await doDia(somarDias(D, 21)))[0];
    assert.equal(novo.serie.intervaloSemanas, 2);
  });

  test("parar de repetir: este fica, os próximos saem da agenda", async () => {
    const { post, barb, doDia, env } = await cenario("er2");
    const primeiro = (await doDia(D))[0];
    const r = await post("/api/agenda/serie/editar", barb.token, { id: primeiro.id, intervaloSemanas: 0 });
    assert.equal(r.status, 200, JSON.stringify(r.dados));
    assert.equal(r.dados.removidos, 4);
    assert.equal((await doDia(D)).length, 1);
    for (const k of [7, 14, 21, 28]) assert.equal((await doDia(somarDias(D, k))).length, 0);
    assert.ok(env.DB.raw.prepare("SELECT 1 FROM auditoria WHERE acao = 'horario_fixo_alterado'").get());
    assert.equal(env.DB.raw.prepare("SELECT COUNT(*) n FROM agendamentos_excluidos WHERE motivo = 'Repetição alterada'").get().n, 4, "nada apagado: ficam como excluídos");
  });

  test("permissões e validações: outro barbeiro não mexe; horário que não é fixo; datas inválidas; outra barbearia", async () => {
    const amb = await cenario("er3");
    const { post, barb, barb2, b, doDia, corte } = amb;
    const h = (await doDia(D))[0];
    assert.equal((await post("/api/agenda/serie/editar", barb2.token, { id: h.id, intervaloSemanas: 2, ate: somarDias(D, 30) })).status, 403);
    assert.equal((await post("/api/agenda/serie/editar", barb.token, { id: h.id, intervaloSemanas: 5, ate: somarDias(D, 30) })).status, 400);
    assert.equal((await post("/api/agenda/serie/editar", barb.token, { id: h.id, intervaloSemanas: 1, ate: D })).status, 400);
    assert.match((await post("/api/agenda/serie/editar", barb.token, { id: h.id, intervaloSemanas: 1, ate: somarDias(D, 800) })).dados.erro, /2 anos/);
    const avulso = (await post("/api/agenda", barb.token, { data: D, hora: "15:00", servicoIds: [corte.id], cliente: { nome: "Avulso" } })).dados.agendamento;
    assert.equal((await post("/api/agenda/serie/editar", barb.token, { id: avulso.id, intervaloSemanas: 1, ate: somarDias(D, 14) })).status, 400);
    // Outra barbearia não enxerga
    const outra = await amb.criarBarbearia(amb.p, "er4");
    assert.equal((await post("/api/agenda/serie/editar", outra.prop, { id: h.id, intervaloSemanas: 0 })).status, 404);
    // O dono (gestão) pode
    assert.equal((await post("/api/agenda/serie/editar", b.prop, { id: h.id, intervaloSemanas: 1, ate: somarDias(D, 14) })).status, 200);
  });
});
