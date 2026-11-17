// Notificações, nota vencida (30 dias) com aceite ao marcar, bloquear cliente e Visão do dia. Pedido de 17/11/2026. Dados fictícios.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { ambiente } from "./ambiente.js";
import { hojeBrasil } from "../src/util.js";
import { somarDias } from "../src/agenda-util.js";

const HOJE = hojeBrasil();
const AMANHA = somarDias(HOJE, 1);

async function cenario(sufixo = "not", amb = ambiente(), plataforma = null) {
  const p = plataforma || await amb.criarPlataforma();
  const b = await amb.criarBarbearia(p, sufixo);
  const ger = await amb.criarUsuario(b.prop, `ger.${sufixo}`, "gerente", { comissaoServicoBp: 4000 });
  const barb = await amb.criarUsuario(ger.token, `barb.${sufixo}`, "barbeiro", { comissaoServicoBp: 5000 });
  const cx = await amb.criarUsuario(ger.token, `cx.${sufixo}`, "caixa");
  await amb.post("/api/funcionamento/salvar", ger.token, { dias: [0, 1, 2, 3, 4, 5, 6].map(dia => ({ dia, aberto: true, abre: "00:00", fecha: "23:30" })) });
  const corte = (await amb.post("/api/servicos", ger.token, { nome: "Corte", precoCentavos: 4000, duracaoMin: 30 })).dados.servico;
  const cli = (await amb.post("/api/clientes", ger.token, { nome: "Devedor Fictício", telefone: "11 95555-1010", aceiteLgpd: true })).dados.cliente;
  return { ...amb, p, b, ger, barb, cx, corte, cli };
}

// Lança uma nota (promissória) hoje e "envelhece" o caixa dela para N dias atrás (direto no banco de teste).
async function notaAntiga(amb, dias) {
  const { post, cx, barb, corte, cli, env } = amb;
  await post("/api/caixa/abrir", cx.token, { trocoCentavos: 0 });
  const m = (await post("/api/agenda", cx.token, { barbeiroId: barb.id, data: HOJE, hora: "00:00", servicoIds: [corte.id], cliente: { id: cli.id } })).dados.agendamento;
  const r = await post("/api/caixa/cobrar", cx.token, { id: m.id, itens: [{ servicoId: corte.id, precoCobradoCentavos: 4000 }], pagamentos: [{ forma: "promissoria", valorCentavos: 4000 }] });
  assert.equal(r.status, 201, JSON.stringify(r.dados));
  env.DB.raw.prepare("UPDATE caixas SET data = ? WHERE barbearia_id = ? AND data = ?").run(somarDias(HOJE, -dias), amb.b.id, HOJE);
}

describe("nota vencida e bloqueio de cliente", () => {
  test("nota com 30 dias: aparece no cliente, marcar pede aceite (pop-up) e com aceite marca e fica auditado", async () => {
    const amb = await cenario();
    const { post, get, cx, barb, corte, cli, env } = amb;
    await notaAntiga(amb, 30);
    const pedido = { barbeiroId: barb.id, data: AMANHA, hora: "10:00", servicoIds: [corte.id], cliente: { id: cli.id } };
    const r = await post("/api/agenda", cx.token, pedido);
    assert.equal(r.status, 409);
    assert.equal(r.dados.codigo, "nota_vencida");
    assert.deepEqual([r.dados.nota.totalCentavos, r.dados.nota.dias], [4000, 30]);
    assert.match(r.dados.erro, /nota vencida/);
    // aparece na busca e na lista de clientes
    const busca = (await get("/api/agenda/clientes?busca=Devedor", cx.token)).dados.clientes[0];
    assert.equal(busca.notaVencida.totalCentavos, 4000);
    assert.equal((await get("/api/clientes", cx.token)).dados.clientes.find(c => c.id === cli.id).notaVencidaCentavos, 4000);
    // com o aceite, marca
    const ok = await post("/api/agenda", cx.token, { ...pedido, aceiteNotaVencida: true });
    assert.equal(ok.status, 201, JSON.stringify(ok.dados));
    assert.equal(env.DB.raw.prepare("SELECT COUNT(*) n FROM auditoria WHERE acao = 'marcou_com_nota_vencida'").get().n, 1);
    // na agenda, o cliente vem marcado
    const ag = (await get(`/api/agenda?data=${AMANHA}`, cx.token)).dados.agendamentos[0];
    assert.equal(ag.cliente.notaVencida.dias, 30);
  });

  test("nota com 29 dias ainda não está vencida", async () => {
    const amb = await cenario("n29");
    await notaAntiga(amb, 29);
    const r = await amb.post("/api/agenda", amb.cx.token, { barbeiroId: amb.barb.id, data: AMANHA, hora: "10:00", servicoIds: [amb.corte.id], cliente: { id: amb.cli.id } });
    assert.equal(r.status, 201, JSON.stringify(r.dados));
  });

  test("bloquear: não marca; barbeiro não bloqueia; desbloquear com motivo; isolamento", async () => {
    const amb = await cenario("blq");
    const { post, get, cx, barb, ger, corte, cli } = amb;
    assert.equal((await post("/api/clientes/bloquear", barb.token, { clienteId: cli.id, motivo: "Teste" })).status, 403);
    assert.equal((await post("/api/clientes/bloquear", cx.token, { clienteId: cli.id })).status, 400, "motivo obrigatório");
    const b = await post("/api/clientes/bloquear", cx.token, { clienteId: cli.id, motivo: "Faltou 3 vezes" });
    assert.equal(b.status, 200, JSON.stringify(b.dados));
    assert.equal((await post("/api/clientes/bloquear", cx.token, { clienteId: cli.id, motivo: "De novo" })).status, 409);
    const pedido = { barbeiroId: barb.id, data: AMANHA, hora: "10:00", servicoIds: [corte.id], cliente: { id: cli.id } };
    for (const quem of [cx, barb, ger]) {
      const r = await post("/api/agenda", quem.token, quem === barb ? { ...pedido, barbeiroId: undefined } : pedido);
      assert.equal(r.status, 409);
      assert.equal(r.dados.codigo, "cliente_bloqueado");
    }
    assert.deepEqual((await get("/api/clientes", cx.token)).dados.clientes.find(c => c.id === cli.id).bloqueado, { motivo: "Faltou 3 vezes" });
    // outra barbearia não mexe
    const outra = await cenario("blq2", amb, amb.p);
    assert.equal((await post("/api/clientes/desbloquear", outra.cx.token, { clienteId: cli.id, motivo: "Tentativa" })).status, 404);
    assert.ok(!(await get("/api/visao-dia", outra.cx.token)).dados.bloqueados.length);
    // desbloqueia e marca
    assert.equal((await post("/api/clientes/desbloquear", ger.token, { clienteId: cli.id, motivo: "Conversamos" })).status, 200);
    assert.equal((await post("/api/agenda", cx.token, pedido)).status, 201);
    // bloquear de novo depois funciona (sem apagar nada)
    assert.equal((await post("/api/clientes/bloquear", cx.token, { clienteId: cli.id, motivo: "Outra vez" })).status, 200);
  });
});

describe("notificações e visão do dia", () => {
  test("gestão vê nota vencida, valor alterado, produto vencendo (60 dias), despesa atrasada e atendimento não fechado; caixa vê só o dele", async () => {
    const amb = await cenario("lista");
    const { post, get, ger, cx, barb, corte, env } = amb;
    await notaAntiga(amb, 35);
    // produto com validade daqui a 50 dias e outro daqui a 90 (não entra)
    await post("/api/produtos", ger.token, { nome: "Pomada Validade", precoCentavos: 3000, validade: somarDias(HOJE, 50), estoqueInicial: { quantidade: 3, custoUnitCentavos: 1000 } });
    await post("/api/produtos", ger.token, { nome: "Pomada Longe", precoCentavos: 3000, validade: somarDias(HOJE, 90), estoqueInicial: { quantidade: 3, custoUnitCentavos: 1000 } });
    // despesa atrasada
    await post("/api/contas", ger.token, { descricao: "Luz (fictícia)", categoria: "luz", valorCentavos: 9000, vencimento: somarDias(HOJE, -2) });
    // atendimento cobrado com valor diferente da tabela (hoje: caixa novo)
    await post("/api/caixa/abrir", cx.token, { trocoCentavos: 0 });
    const m = (await post("/api/agenda", cx.token, { barbeiroId: barb.id, data: HOJE, hora: "00:30", servicoIds: [corte.id], cliente: { nome: "Outro Fictício", telefone: "11 95555-2020", aceiteLgpd: true } })).dados.agendamento;
    assert.equal((await post("/api/caixa/cobrar", cx.token, { id: m.id, itens: [{ servicoId: corte.id, precoCobradoCentavos: 3000 }], pagamentos: [{ forma: "pix", valorCentavos: 3000 }] })).status, 201);
    // atendimento de ontem não fechado
    const ontem = somarDias(HOJE, -1);
    const a2 = (await post("/api/agenda", ger.token, { barbeiroId: barb.id, data: ontem, hora: "09:00", servicoIds: [corte.id], cliente: { nome: "Esquecido Fictício", telefone: "11 95555-3030", aceiteLgpd: true } }));
    assert.equal(a2.status, 201, JSON.stringify(a2.dados));

    const g = (await get("/api/notificacoes", ger.token)).dados.itens;
    const tipos = g.map(i => i.titulo);
    for (const t of ["Nota vencida", "Valor alterado no atendimento", "Produto perto de vencer", "Despesa atrasada", "Atendimento não fechado", "Caixa não fechado"]) {
      assert.ok(tipos.includes(t), `gestão deveria ver: ${t} (veio: ${tipos.join(", ")})`);
    }
    assert.ok(g.some(i => /Pomada Validade/.test(i.texto)));
    assert.ok(!g.some(i => /Pomada Longe/.test(i.texto)), "90 dias não entra");
    assert.equal(g[0].nivel, "alerta", "alertas primeiro");

    const c = (await get("/api/notificacoes", cx.token)).dados.itens.map(i => i.titulo);
    assert.ok(c.includes("Nota vencida") && c.includes("Atendimento não fechado") && c.includes("Produto perto de vencer"));
    assert.ok(!c.includes("Valor alterado no atendimento") && !c.includes("Despesa atrasada"), "caixa não vê valores nem despesas");

    const bb = (await get("/api/notificacoes", barb.token)).dados.itens;
    assert.ok(bb.every(i => i.tipo === "atendimento") && bb.some(i => /Esquecido/.test(i.texto)));

    // visão do dia (caixa)
    const v = (await get("/api/visao-dia", cx.token)).dados;
    assert.equal(v.semana.length, 7);
    assert.equal(v.resumo.finalizados, 2, "o da nota antiga também é de hoje");
    assert.equal(v.resumo.recebidoCentavos, 3000);
    assert.equal(v.notasVencidas[0].totalCentavos, 4000);
    assert.match(v.notasVencidas[0].whatsapp, /wa\.me\/5511955551010/);
    assert.ok(v.naoFechados.some(x => x.cliente === "Esquecido Fictício"));
    assert.equal((await get("/api/visao-dia", barb.token)).status, 403, "barbeiro não vê a visão do dia");
    // isolamento
    const outra = await cenario("lista2", amb, amb.p);
    const o = (await get("/api/notificacoes", outra.ger.token)).dados.itens;
    assert.ok(!o.some(i => /Devedor|Pomada|Luz|Esquecido/.test(i.texto)), JSON.stringify(o));
    const ov = (await get("/api/visao-dia", outra.cx.token)).dados;
    assert.deepEqual([ov.notasVencidas.length, ov.naoFechados.length, ov.agenda.length], [0, 0, 0]);
    void env;
  });
});
