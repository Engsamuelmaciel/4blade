// Suporte marca horários em lote numa barbearia (implantação: passar a agenda que ela já tem).
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { ambiente } from "./ambiente.js";
import { hojeBrasil } from "../src/util.js";
import { somarDias } from "../src/agenda-util.js";

const AMANHA = somarDias(hojeBrasil(), 1);
const SEMANA = [0, 1, 2, 3, 4, 5, 6].map(dia => ({ dia, aberto: true, abre: "08:00", fecha: "20:00" }));

describe("suporte: horários em lote", () => {
  test("marca na barbearia escolhida com as regras da agenda; só a plataforma; auditado", async () => {
    const amb = ambiente();
    const { post, get } = amb;
    const p = await amb.criarPlataforma();
    const a = await amb.criarBarbearia(p, "al1");
    const b = await amb.criarBarbearia(p, "al2");
    const barbA = await amb.criarUsuario(a.prop, "barb.al1", "barbeiro");
    const barbB = await amb.criarUsuario(b.prop, "barb.al2", "barbeiro");
    const corte = (await post("/api/servicos", a.prop, { nome: "Corte", precoCentavos: 4000, duracaoMin: 30 })).dados.servico;
    const corteB = (await post("/api/servicos", b.prop, { nome: "Corte B", precoCentavos: 4000, duracaoMin: 30 })).dados.servico;
    const url = "/api/plataforma/barbearias/agenda-lote";

    // Antes do funcionamento: tela avisa e marcação é recusada
    const g0 = await get(`${url}?id=${a.id}`, p);
    assert.equal(g0.status, 200);
    assert.equal(g0.dados.temFuncionamento, false);
    assert.ok(g0.dados.profissionais.some(x => x.id === barbA.id));
    assert.deepEqual(g0.dados.servicos.map(s => s.nome), ["Corte"]);
    const corpo = { barbeariaId: a.id, barbeiroId: barbA.id, data: AMANHA, hora: "09:00", servicoIds: [corte.id],
      cliente: { nome: "Cliente Lote", telefone: "11 93333-0001", aceiteLgpd: true } };
    assert.notEqual((await post(url, p, corpo)).status, 201, "sem funcionamento não marca");
    await post("/api/funcionamento/salvar", a.prop, { dias: SEMANA });
    assert.equal((await get(`${url}?id=${a.id}`, p)).dados.temFuncionamento, true);

    // Só a plataforma
    assert.equal((await post(url, a.prop, corpo)).status, 403);
    assert.equal((await get(`${url}?id=${a.id}`, a.prop)).status, 403);

    const r = await post(url, p, corpo);
    assert.equal(r.status, 201, JSON.stringify(r.dados));
    // Conflito no mesmo horário
    assert.equal((await post(url, p, { ...corpo, cliente: { nome: "Outro Cliente" } })).status, 409);
    // Profissional ou serviço de OUTRA barbearia: recusado (isolamento)
    assert.notEqual((await post(url, p, { ...corpo, hora: "10:00", barbeiroId: barbB.id })).status, 201);
    assert.notEqual((await post(url, p, { ...corpo, hora: "10:00", servicoIds: [corteB.id] })).status, 201);
    // Sem profissional
    assert.equal((await post(url, p, { ...corpo, hora: "11:00", barbeiroId: undefined })).status, 400);

    // Aparece na agenda da barbearia A, não na B
    const agA = (await get(`/api/agenda?data=${AMANHA}`, a.prop)).dados;
    assert.equal(agA.agendamentos.filter(x => x.cliente?.nome === "Cliente Lote" || x.clienteNome === "Cliente Lote").length, 1, JSON.stringify(agA.agendamentos[0]));
    const agB = (await get(`/api/agenda?data=${AMANHA}`, b.prop)).dados;
    assert.equal(agB.agendamentos.length, 0);
    const aud = amb.env.DB.raw.prepare("SELECT usuario_id FROM auditoria WHERE acao = 'agendamento_criado' AND barbearia_id = ?").all(a.id);
    assert.equal(aud.length, 1);
    const quem = amb.env.DB.raw.prepare("SELECT perfil FROM usuarios WHERE id = ?").get(aud[0].usuario_id);
    assert.equal(quem.perfil, "plataforma", "auditado em nome do suporte");
  });
});
