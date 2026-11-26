// Duração personalizada do atendimento (27/11/2026): a da tabela é o padrão; quem marca pode ajustar para o cliente. Dados fictícios.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { ambiente } from "./ambiente.js";
import { hojeBrasil } from "../src/util.js";
import { somarDias } from "../src/agenda-util.js";

const SEMANA = [0, 1, 2, 3, 4, 5, 6].map(dia => ({ dia, aberto: true, abre: "08:00", fecha: "20:00" }));

describe("duração personalizada ao marcar", () => {
  test("padrão = tabela; duracaoMin personaliza (barbeiro e gestão); inválido recusado; editar mantém/ajusta; disponibilidade e auditoria acompanham", async () => {
    const amb = ambiente();
    const { post, get } = amb;
    const p = await amb.criarPlataforma();
    const b = await amb.criarBarbearia(p, "du1");
    const barb = await amb.criarUsuario(b.prop, "barb.du1", "barbeiro");
    await post("/api/funcionamento/salvar", b.prop, { dias: SEMANA });
    const prog = (await post("/api/servicos", b.prop, { nome: "Progressiva", precoCentavos: 20000, duracaoMin: 90 })).dados.servico;
    const dia = somarDias(hojeBrasil(), 1);
    const marca = (extra, tok = barb.token) => post("/api/agenda", tok, { data: dia, servicoIds: [prog.id], cliente: { nome: extra.nome || "Cliente" }, ...extra });
    const lista = async () => (await get(`/api/agenda?data=${dia}&barbeiroId=${barb.id}`, barb.token)).dados.agendamentos.filter(a => a.situacao === "agendado");

    // sem duracaoMin: a da tabela (90 min)
    const r0 = await marca({ hora: "09:00", nome: "Tabela" });
    assert.equal(r0.status, 201, JSON.stringify(r0.dados));
    assert.equal(r0.dados.agendamento.fim.slice(11), "10:30");
    // personalizada: 45 min (barbeiro, na própria agenda)
    const r1 = await marca({ hora: "11:00", duracaoMin: 45, nome: "Curta" });
    assert.equal(r1.status, 201, JSON.stringify(r1.dados));
    assert.equal(r1.dados.agendamento.fim.slice(11), "11:45");
    // 11:45 já está livre (a duração personalizada vale para a agenda e para os horários livres)
    const r2 = await marca({ hora: "11:45", nome: "Logo depois" });
    assert.equal(r2.status, 201, JSON.stringify(r2.dados));
    const ag = await lista();
    assert.deepEqual(ag.map(a => [a.inicio, a.fim]), [["09:00", "10:30"], ["11:00", "11:45"], ["11:45", "13:15"]]);
    // a tabela do serviço NÃO muda
    assert.equal((await get("/api/servicos", b.prop)).dados.servicos.find(s => s.id === prog.id).duracaoMin, 90);
    // auditoria da personalização
    const aud = amb.env.DB.raw.prepare("SELECT detalhes FROM auditoria WHERE acao = 'duracao_personalizada'").all();
    assert.equal(aud.length, 1); assert.match(aud[0].detalhes, /"tabelaMin":90.*"usadaMin":45/);
    // inválidos
    for (const v of [3, 800, 12.5, "abc", -10]) assert.equal((await marca({ hora: "16:00", duracaoMin: v, nome: "X" })).status, 400, `duração ${v}`);
    // passa da meia-noite
    assert.equal((await marca({ hora: "19:30", duracaoMin: 720, nome: "Y" })).status, 400);
    // gestão também personaliza na agenda de um barbeiro
    assert.equal((await post("/api/agenda", b.prop, { barbeiroId: barb.id, data: dia, hora: "15:00", servicoIds: [prog.id], duracaoMin: 30, cliente: { nome: "Gestão" } })).status, 201);
    // editar: manda a duração atual → mantém; sem mandar → volta para a tabela
    const curta = ag[1];
    const e1 = await post("/api/agenda/editar", barb.token, { id: curta.id, servicoIds: [prog.id], duracaoMin: 45, observacao: "só a observação" });
    assert.equal(e1.status, 200, JSON.stringify(e1.dados));
    assert.equal((await lista()).find(a => a.id === curta.id).fim, "11:45");
    const e2 = await post("/api/agenda/editar", barb.token, { id: curta.id, servicoIds: [prog.id], duracaoMin: 30 });
    assert.equal(e2.status, 200, JSON.stringify(e2.dados));
    assert.equal((await lista()).find(a => a.id === curta.id).fim, "11:30", "a agenda do barbeiro mostra o horário novo");
    // aumentar para além do próximo atendimento bate nele (a edição continua recusando choque)
    assert.equal((await post("/api/agenda/editar", barb.token, { id: curta.id, servicoIds: [prog.id], duracaoMin: 60 })).status, 409);
  });
});
