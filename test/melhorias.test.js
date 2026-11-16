// Pedido do responsável (16/11/2026): horários fixos (recorrência), calendário de ocupação (Mês/Ano) e caixa cobrando
// atendimentos (PDV). Dados fictícios.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { ambiente } from "./ambiente.js";
import { hojeBrasil } from "../src/util.js";
import { somarDias, diaSemana } from "../src/agenda-util.js";

const HOJE = hojeBrasil();
const AMANHA = somarDias(HOJE, 1);

async function cenario(sufixo = "alfa", amb = ambiente(), plataforma = null) {
  const p = plataforma || await amb.criarPlataforma();
  const b = await amb.criarBarbearia(p, sufixo);
  const ger = await amb.criarUsuario(b.prop, `ger.${sufixo}`, "gerente", { comissaoServicoBp: 4000 });
  const barb = await amb.criarUsuario(ger.token, `barb.${sufixo}`, "barbeiro", { comissaoServicoBp: 5000 });
  const cx = await amb.criarUsuario(ger.token, `cx.${sufixo}`, "caixa");
  // todos os dias 09:00–12:00 (3 h), sem intervalo
  await amb.post("/api/funcionamento/salvar", ger.token, { dias: [0, 1, 2, 3, 4, 5, 6].map(dia => ({ dia, aberto: true, abre: "09:00", fecha: "12:00" })) });
  const corte = (await amb.post("/api/servicos", ger.token, { nome: "Corte", precoCentavos: 4000, duracaoMin: 30 })).dados.servico;
  const cliente = { telefone: "11 91111-2222", nome: "Cliente Fixo", aceiteLgpd: true };
  return { ...amb, p, b, ger, barb, cx, corte, cliente };
}

describe("horários fixos (recorrência)", () => {
  test("toda semana por 4 semanas: 5 datas, cria 3 e pula (e lista) o feriado e o horário já ocupado", async () => {
    const amb = await cenario();
    const { post, get, ger, barb, corte, cliente } = amb;
    // feriado na 3ª ocorrência e um horário já ocupado na 4ª
    await post("/api/funcionamento/datas-fechadas", ger.token, { dataIni: somarDias(AMANHA, 14), motivo: "Feriado (fictício)" });
    await post("/api/agenda", barb.token, { data: somarDias(AMANHA, 21), hora: "10:00", servicoIds: [corte.id], cliente: { telefone: "11 93333-4444", nome: "Outro", aceiteLgpd: true } });
    const r = await post("/api/agenda", barb.token, {
      data: AMANHA, hora: "10:00", servicoIds: [corte.id], cliente, repetir: { intervaloSemanas: 1, ate: somarDias(AMANHA, 28) }
    });
    assert.equal(r.status, 201, JSON.stringify(r.dados));
    assert.equal(r.dados.serie.criados, 3);
    assert.deepEqual(r.dados.serie.datas, [AMANHA, somarDias(AMANHA, 7), somarDias(AMANHA, 28)]);
    assert.deepEqual(r.dados.serie.pulados.map(x => x.data), [somarDias(AMANHA, 14), somarDias(AMANHA, 21)]);
    assert.match(r.dados.serie.pulados[0].motivo, /Feriado/);
    assert.match(r.dados.serie.pulados[1].motivo, /outro atendimento/);
    // a cada 2 semanas
    const r2 = await post("/api/agenda", barb.token, { data: AMANHA, hora: "11:00", servicoIds: [corte.id], cliente, repetir: { intervaloSemanas: 2, ate: somarDias(AMANHA, 28) } });
    assert.deepEqual(r2.dados.serie.datas, [AMANHA, somarDias(AMANHA, 28)], "dia +14 é feriado: ficam o 1º e o +28");
    // a agenda mostra que é horário fixo
    const ag = (await get(`/api/agenda?data=${AMANHA}`, barb.token)).dados.agendamentos;
    assert.ok(ag.every(a => a.serie && a.serie.intervaloSemanas));
  });

  test("validações: no máximo 6 meses, intervalo de 1 a 4 semanas, barbeiro só na própria agenda", async () => {
    const { post, barb, ger, corte, cliente } = await cenario();
    const base = { data: AMANHA, hora: "10:00", servicoIds: [corte.id], cliente };
    assert.equal((await post("/api/agenda", barb.token, { ...base, repetir: { intervaloSemanas: 5, ate: somarDias(AMANHA, 30) } })).status, 400);
    assert.match((await post("/api/agenda", barb.token, { ...base, repetir: { intervaloSemanas: 1, ate: somarDias(AMANHA, 200) } })).dados.erro, /6 meses/);
    assert.equal((await post("/api/agenda", barb.token, { ...base, repetir: { intervaloSemanas: 1, ate: AMANHA } })).status, 400);
    assert.equal((await post("/api/agenda", barb.token, { ...base, barbeiroId: ger.id, repetir: { intervaloSemanas: 1, ate: somarDias(AMANHA, 14) } })).status, 403);
  });

  test("cancelar \"este e os próximos\": encerra a série e mantém os anteriores", async () => {
    const { post, get, barb, corte, cliente } = await cenario();
    const r = await post("/api/agenda", barb.token, { data: AMANHA, hora: "09:00", servicoIds: [corte.id], cliente, repetir: { intervaloSemanas: 1, ate: somarDias(AMANHA, 21) } });
    assert.equal(r.dados.serie.criados, 4);
    const terceiro = (await get(`/api/agenda?data=${somarDias(AMANHA, 14)}`, barb.token)).dados.agendamentos[0];
    assert.equal((await post("/api/agenda/situacao", barb.token, { id: terceiro.id, situacao: "cancelado", serie: true })).status, 400, "motivo obrigatório");
    const c = await post("/api/agenda/situacao", barb.token, { id: terceiro.id, situacao: "cancelado", serie: true, motivo: "Cliente mudou de cidade" });
    assert.equal(c.status, 200);
    assert.equal(c.dados.cancelados, 2);
    assert.equal((await get(`/api/agenda?data=${AMANHA}`, barb.token)).dados.agendamentos[0].situacao, "agendado");
    assert.equal((await get(`/api/agenda?data=${somarDias(AMANHA, 7)}`, barb.token)).dados.agendamentos[0].situacao, "agendado");
    assert.equal((await get(`/api/agenda?data=${somarDias(AMANHA, 21)}`, barb.token)).dados.agendamentos[0].situacao, "cancelado");
  });
});

describe("calendário de ocupação (Mês/Ano)", () => {
  test("livre, poucos horários, cheio e fechado — por profissional", async () => {
    const amb = await cenario();
    const { post, get, ger, barb, corte, cliente } = amb;
    const d1 = AMANHA, d2 = somarDias(AMANHA, 1), d3 = somarDias(AMANHA, 2);
    // barbeiro: d1 cheio (09–12 bloqueado), d2 com 2 h de 3 ocupadas (poucos), d3 livre; d4 data fechada
    await post("/api/agenda/bloqueios", barb.token, { inicio: `${d1}T09:00`, fim: `${d1}T12:00`, motivo: "Curso" });
    await post("/api/agenda/bloqueios", barb.token, { inicio: `${d2}T09:00`, fim: `${d2}T11:00` });
    await post("/api/agenda", barb.token, { data: d2, hora: "11:00", servicoIds: [corte.id], cliente });
    await post("/api/funcionamento/datas-fechadas", ger.token, { dataIni: somarDias(AMANHA, 3), motivo: "Folga coletiva" });
    const r = (await get(`/api/agenda/ocupacao?inicio=${d1}&fim=${somarDias(AMANHA, 3)}&barbeiroId=${ger.id}`, barb.token)).dados;
    assert.deepEqual(r.profissionais.map(p => p.id), [barb.id], "barbeiro vê só a dele");
    // d1: 3 h bloqueadas → cheio · d2: 2 h bloqueadas + corte 11:00–11:30 → sobra 11:30–12:00 (1 corte) → poucos
    assert.deepEqual(r.dias.map(d => d.status), ["cheio", "poucos", "livre", "fechado"]);
    assert.deepEqual(r.dias.map(d => d.horariosLivres), [0, 1, 6, 0]);
  });
});

describe("caixa como PDV: cobrar atendimento e atendimento sem horário", () => {
  test("caixa cobra atendimento de hoje sem ver comissão; não cobra de outro dia; barbeiro não usa o PDV", async () => {
    const amb = await cenario();
    const { post, get, barb, cx, corte, cliente } = amb;
    await post("/api/caixa/abrir", cx.token, { trocoCentavos: 0 });
    const hoje = (await post("/api/agenda", barb.token, { data: HOJE, hora: "09:00", servicoIds: [corte.id], cliente })).dados.agendamento.id;
    const amanha = (await post("/api/agenda", barb.token, { data: AMANHA, hora: "09:00", servicoIds: [corte.id], cliente })).dados.agendamento.id;
    const lista = await get("/api/caixa/atendimentos", cx.token);
    assert.equal(lista.status, 200);
    assert.deepEqual(lista.dados.atendimentos.map(a => [a.id, a.situacao, a.servicos[0].precoCentavos]), [[hoje, "agendado", 4000]]);
    assert.ok(!/comiss/i.test(JSON.stringify(lista.dados)));
    const cobrar = id => post("/api/caixa/cobrar", cx.token, { id, itens: [{ servicoId: corte.id, precoCobradoCentavos: 4000 }], pagamentos: [{ forma: "pix", valorCentavos: 4000 }] });
    assert.equal((await cobrar(amanha)).status, 403);
    const r = await cobrar(hoje);
    assert.equal(r.status, 201, JSON.stringify(r.dados));
    assert.ok(!("comissaoCentavos" in r.dados.finalizacao), "caixa não vê comissão");
    assert.equal((await get("/api/caixa/hoje", cx.token)).dados.totais.entradasCentavos, 4000);
    assert.equal((await post("/api/caixa/cobrar", barb.token, { id: hoje })).status, 403);
    assert.equal((await get("/api/caixa/atendimentos", barb.token)).status, 403);
    // caixa continua sem acesso à agenda completa
    assert.equal((await get("/api/agenda", cx.token)).status, 403);
  });

  test("atendimento sem horário: cria, finaliza, entra no caixa e gera comissão do barbeiro", async () => {
    const amb = await cenario();
    const { env, post, get, barb, cx, corte } = amb;
    const corpo = {
      barbeiroId: barb.id, itens: [{ servicoId: corte.id, precoCobradoCentavos: 3500 }],
      cliente: { telefone: "11 95555-6666", nome: "Cliente Passante", aceiteLgpd: true }, pagamentos: [{ forma: "dinheiro", valorCentavos: 3500 }]
    };
    assert.equal((await post("/api/caixa/atendimento-avulso", cx.token, corpo)).status, 409, "caixa fechado");
    await post("/api/caixa/abrir", cx.token, { trocoCentavos: 0 });
    assert.equal((await post("/api/caixa/atendimento-avulso", cx.token, { ...corpo, pagamentos: [{ forma: "dinheiro", valorCentavos: 100 }] })).status, 400);
    const r = await post("/api/caixa/atendimento-avulso", cx.token, corpo);
    assert.equal(r.status, 201, JSON.stringify(r.dados));
    assert.equal(r.dados.finalizacao.valorAlterado, true, "35,00 em vez de 40,00 fica destacado ao gerente");
    const c = (await get("/api/caixa/hoje", cx.token)).dados;
    assert.equal(c.totais.porForma.dinheiro, 3500);
    assert.equal(env.DB.raw.prepare("SELECT valor_centavos FROM comissoes").get().valor_centavos, 1750);
    assert.equal(env.DB.raw.prepare("SELECT COUNT(*) n FROM agendamentos WHERE situacao = 'agendado'").get().n, 0, "nenhum horário solto");
    assert.equal((await post("/api/caixa/atendimento-avulso", barb.token, corpo)).status, 403);
  });

  test("isolamento: o caixa não cobra horário de outra barbearia", async () => {
    const amb = ambiente();
    const p = await amb.criarPlataforma();
    const A = await cenario("alfa", amb, p);
    const B = await cenario("beta", amb, p);
    await amb.post("/api/caixa/abrir", A.cx.token, { trocoCentavos: 0 });
    const idB = (await amb.post("/api/agenda", B.barb.token, { data: HOJE, hora: "09:00", servicoIds: [B.corte.id], cliente: B.cliente })).dados.agendamento.id;
    assert.equal((await amb.post("/api/caixa/cobrar", A.cx.token, { id: idB, itens: [{ servicoId: A.corte.id, precoCobradoCentavos: 1 }], pagamentos: [{ forma: "pix", valorCentavos: 1 }] })).status, 404);
    assert.equal((await amb.post("/api/caixa/atendimento-avulso", A.cx.token, { barbeiroId: B.barb.id, itens: [{ servicoId: A.corte.id, precoCobradoCentavos: 1 }], cliente: A.cliente, pagamentos: [{ forma: "pix", valorCentavos: 1 }] })).status, 404);
    assert.equal((await amb.get("/api/caixa/atendimentos", A.cx.token)).dados.atendimentos.length, 0);
    assert.equal((await amb.get(`/api/agenda/ocupacao?inicio=${HOJE}&fim=${HOJE}&barbeiroId=${B.barb.id}`, A.ger.token)).dados.profissionais.length, 0);
  });
});
void diaSemana;

describe("telefone opcional na marcação (pedido de 16/11/2026)", () => {
  test("sem telefone: exige o nome, reaproveita o mesmo cliente pelo nome e não gera WhatsApp", async () => {
    const amb = await cenario();
    const { post, get, barb, ger, cx, corte } = amb;
    const semNome = await post("/api/agenda", barb.token, { data: AMANHA, hora: "09:00", servicoIds: [corte.id], cliente: { telefone: "" } });
    assert.equal(semNome.status, 400);
    assert.match(semNome.dados.erro, /telefone ou o nome/);
    assert.equal((await post("/api/agenda", barb.token, { data: AMANHA, hora: "09:00", servicoIds: [corte.id], cliente: { telefone: "123", nome: "X Y" } })).status, 400, "telefone digitado errado continua recusado");
    const r1 = await post("/api/agenda", barb.token, { data: AMANHA, hora: "09:00", servicoIds: [corte.id], cliente: { nome: "Seu Zé Sem Fone" } });
    assert.equal(r1.status, 201, JSON.stringify(r1.dados));
    const r2 = await post("/api/agenda", barb.token, { data: AMANHA, hora: "10:00", servicoIds: [corte.id], cliente: { telefone: "", nome: "seu zé sem fone" } });
    assert.equal(r2.status, 201, JSON.stringify(r2.dados));
    const ag = (await get(`/api/agenda?data=${AMANHA}`, barb.token)).dados.agendamentos;
    assert.equal(ag.length, 2);
    assert.equal(ag[0].cliente.id, ag[1].cliente.id, "mesmo nome sem telefone = mesmo cliente");
    assert.equal(ag[0].cliente.telefone, null);
    assert.equal(ag[0].whatsapp, null);
    // lista de clientes: aparece sem telefone; pode renomear sem informar telefone; busca por número não o encontra
    const lista = (await get("/api/clientes", ger.token)).dados.clientes;
    const ze = lista.find(c => c.nome === "Seu Zé Sem Fone");
    assert.equal(ze.telefone, null);
    const ren = await post("/api/clientes/alterar", ger.token, { id: ze.id, nome: "Seu Zé Fictício", telefone: "", observacao: null, aceiteLgpd: false });
    assert.equal(ren.status, 200, JSON.stringify(ren.dados));
    assert.equal(ren.dados.cliente.telefone, null);
    assert.equal((await get("/api/clientes?busca=123", ger.token)).dados.clientes.length, 0);
    // depois pode ganhar telefone
    const comFone = await post("/api/clientes/alterar", ger.token, { id: ze.id, telefone: "11 97777-1212", aceiteLgpd: true });
    assert.equal(comFone.dados.cliente.telefone, "11977771212");
    // caixa: atendimento sem horário também aceita sem telefone
    await post("/api/caixa/abrir", cx.token, { trocoCentavos: 0 });
    const av = await post("/api/caixa/atendimento-avulso", cx.token, { barbeiroId: barb.id, itens: [{ servicoId: corte.id, precoCobradoCentavos: 4000 }],
      pagamentos: [{ forma: "pix", valorCentavos: 4000 }], cliente: { nome: "Passante Fictício" } });
    assert.equal(av.status, 201, JSON.stringify(av.dados));
    // sem nome e sem telefone: no caixa vira "Cliente não identificado" (na agenda continua exigindo o nome)
    const anon = await post("/api/caixa/atendimento-avulso", cx.token, { barbeiroId: barb.id, itens: [{ servicoId: corte.id, precoCobradoCentavos: 4000 }],
      pagamentos: [{ forma: "dinheiro", valorCentavos: 4000 }], cliente: { telefone: "", nome: "" } });
    assert.equal(anon.status, 201, JSON.stringify(anon.dados));
    const anon2 = await post("/api/caixa/atendimento-avulso", cx.token, { barbeiroId: barb.id, itens: [{ servicoId: corte.id, precoCobradoCentavos: 4000 }],
      pagamentos: [{ forma: "pix", valorCentavos: 4000 }], cliente: {} });
    assert.equal(anon2.status, 201, JSON.stringify(anon2.dados));
    const fila = (await get("/api/caixa/atendimentos", cx.token)).dados.atendimentos;
    const anonimos = fila.filter(a => a.cliente.nome === "Cliente não identificado");
    assert.equal(anonimos.length, 2);
    assert.equal(anonimos[0].cliente.telefone, null);
    assert.equal(fila.find(a => a.cliente.nome === "Passante Fictício").cliente.telefone, null);
  });
});
