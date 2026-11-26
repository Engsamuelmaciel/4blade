// Corrigir um atendimento já cobrado no caixa (valor, serviços e forma) — pedido de 19/11/2026. Dados fictícios.
// Por baixo: estorno da cobrança (entrada e comissão, com motivo) + nova cobrança com os valores certos. Nada é apagado.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { ambiente } from "./ambiente.js";
import { hojeBrasil } from "../src/util.js";

const HOJE = hojeBrasil();

async function cenario(sufixo = "corr", amb = ambiente(), plataforma = null) {
  const p = plataforma || await amb.criarPlataforma();
  const b = await amb.criarBarbearia(p, sufixo);
  const ger = await amb.criarUsuario(b.prop, `ger.${sufixo}`, "gerente");
  const barb = await amb.criarUsuario(ger.token, `barb.${sufixo}`, "barbeiro", { comissaoServicoBp: 5000 });
  const cx = await amb.criarUsuario(ger.token, `cx.${sufixo}`, "caixa");
  await amb.post("/api/funcionamento/salvar", ger.token, { dias: [0, 1, 2, 3, 4, 5, 6].map(dia => ({ dia, aberto: true, abre: "00:00", fecha: "23:30" })) });
  const corte = (await amb.post("/api/servicos", ger.token, { nome: "Corte", precoCentavos: 4000, duracaoMin: 30 })).dados.servico;
  const barba = (await amb.post("/api/servicos", ger.token, { nome: "Barba", precoCentavos: 3000, duracaoMin: 30 })).dados.servico;
  return { ...amb, p, b, ger, barb, cx, corte, barba };
}
const cobrado = async (amb, hora) => {
  const m = (await amb.post("/api/agenda", amb.cx.token, { barbeiroId: amb.barb.id, data: HOJE, hora, servicoIds: [amb.corte.id], cliente: { nome: `Cliente ${hora}` } })).dados.agendamento;
  const r = await amb.post("/api/caixa/cobrar", amb.cx.token, { id: m.id, itens: [{ servicoId: amb.corte.id, precoCobradoCentavos: 4000 }], pagamentos: [{ forma: "pix", valorCentavos: 4000 }] });
  assert.equal(r.status, 201, JSON.stringify(r.dados));
  return m;
};

describe("corrigir atendimento já cobrado no caixa", () => {
  test("caixa corrige valor, serviços e forma: estorna a antiga e lança a certa; comissão refeita; tudo registrado", async () => {
    const amb = await cenario();
    const { post, get, cx, env, corte, barba } = amb;
    const m = await cobrado(amb, "09:00");
    let c = (await get("/api/caixa/hoje", cx.token)).dados;
    const l = c.lancamentos.find(x => x.tipo === "atendimento");
    assert.equal(l.agendamentoId, m.id, "o lançamento traz o horário (para corrigir)");
    // sem motivo: recusado, nada muda
    assert.equal((await post("/api/caixa/corrigir-atendimento", cx.token, { id: m.id, itens: [{ servicoId: corte.id, precoCobradoCentavos: 3500 }], pagamentos: [{ forma: "dinheiro", valorCentavos: 3500 }] })).status, 400);
    // corrige: era Corte 40,00 no Pix; foi Corte 35,00 + Barba 30,00 = 65,00 em dinheiro
    const r = await post("/api/caixa/corrigir-atendimento", cx.token, { id: m.id, motivo: "Fez barba também e pagou em dinheiro",
      itens: [{ servicoId: corte.id, precoCobradoCentavos: 3500 }, { servicoId: barba.id, precoCobradoCentavos: 3000 }], pagamentos: [{ forma: "dinheiro", valorCentavos: 6500 }] });
    assert.equal(r.status, 201, JSON.stringify(r.dados));
    c = (await get("/api/caixa/hoje", cx.token)).dados;
    assert.deepEqual([c.totais.porForma.pix, c.totais.porForma.dinheiro, c.totais.atendimentosCentavos], [0, 6500, 6500]);
    // a lista mostra só o lançamento certo (sem estorno nem linha antiga), marcado como corrigido com o motivo; os totais já contam tudo
    assert.deepEqual(c.lancamentos.filter(x => x.agendamentoId === m.id || x.tipo === "estorno_atendimento").map(x => [x.tipo, x.valorCentavos]), [["atendimento", 6500]]);
    const certo = c.lancamentos.find(x => x.agendamentoId === m.id);
    assert.equal(certo.corrigidoNoCaixa, true); assert.equal(certo.motivoCorrecao, "Fez barba também e pagou em dinheiro"); assert.equal(certo.podeCorrigir, true);
    // pode corrigir de novo (3ª vez)
    assert.equal((await post("/api/caixa/corrigir-atendimento", cx.token, { id: m.id, motivo: "Segunda correção", itens: [{ servicoId: corte.id, precoCobradoCentavos: 5000 }], pagamentos: [{ forma: "pix", valorCentavos: 5000 }] })).status, 201);
    c = (await get("/api/caixa/hoje", cx.token)).dados;
    assert.equal(c.totais.atendimentosCentavos, 5000);
    assert.deepEqual(c.lancamentos.filter(x => x.tipo.includes("atendimento")).map(x => x.valorCentavos), [5000]);
    const raw = env.DB.raw;
    assert.equal(raw.prepare("SELECT COUNT(*) n FROM finalizacoes WHERE agendamento_id = ?").get(m.id).n, 3, "nada apagado: 2 antigas (estornadas) + a atual");
    assert.equal(raw.prepare("SELECT SUM(valor_centavos) s FROM comissoes WHERE estornada = 0").get().s, 2500, "50% de 50,00 (só a última vale)");
    assert.ok(raw.prepare("SELECT 1 FROM auditoria WHERE acao = 'atendimento_reaberto' AND detalhes LIKE '%Correção no caixa%'").get());
  });

  test("permissões e isolamento: barbeiro não usa a correção do caixa; outra barbearia não acha o horário", async () => {
    const amb = await cenario("corr1");
    const { post, barb, corte } = amb;
    const m = await cobrado(amb, "10:00");
    const corpo = { id: m.id, motivo: "Teste", itens: [{ servicoId: corte.id, precoCobradoCentavos: 3000 }], pagamentos: [{ forma: "pix", valorCentavos: 3000 }] };
    assert.equal((await post("/api/caixa/corrigir-atendimento", barb.token, corpo)).status, 403);
    const outra = await cenario("corr2", amb, amb.p);
    assert.equal((await post("/api/caixa/corrigir-atendimento", outra.cx.token, corpo)).status, 404);
    assert.equal((await post("/api/caixa/corrigir-atendimento", outra.ger.token, corpo)).status, 404);
  });

  test("corrigir quem atendeu: troca o profissional, a comissão vai para o novo; conflito, inativo e outra barbearia recusados", async () => {
    const amb = await cenario("corr3");
    const { post, get, cx, ger, barb, corte, env } = amb;
    const outro = await amb.criarUsuario(ger.token, "outro.corr3", "barbeiro", { comissaoServicoBp: 3000 });
    const m = await cobrado(amb, "11:00");
    const corpo = (extra = {}) => ({ id: m.id, motivo: "Quem atendeu foi outro", itens: [{ servicoId: corte.id, precoCobradoCentavos: 4000 }], pagamentos: [{ forma: "pix", valorCentavos: 4000 }], ...extra });
    // barbeiro não troca; profissional de outra barbearia não existe
    assert.equal((await post("/api/caixa/corrigir-atendimento", barb.token, corpo({ barbeiroId: outro.id }))).status, 403);
    const outra = await cenario("corr4", amb, amb.p);
    assert.equal((await post("/api/caixa/corrigir-atendimento", cx.token, corpo({ barbeiroId: outra.barb.id }))).status, 404);
    // conflito: o novo já tem horário às 11:00
    await post("/api/agenda", cx.token, { barbeiroId: outro.id, data: HOJE, hora: "11:00", servicoIds: [corte.id], cliente: { nome: "Ocupado" } });
    assert.equal((await post("/api/caixa/corrigir-atendimento", cx.token, corpo({ barbeiroId: outro.id }))).status, 409);
    // nada mudou: continua cobrado, com o profissional antigo
    let ag = await env.DB.prepare("SELECT barbeiro_id, situacao FROM agendamentos WHERE id = ?").bind(m.id).first();
    assert.equal(ag.barbeiro_id, barb.id); assert.equal(ag.situacao, "finalizado");
    // livre: outro profissional às 11:00 já ocupado, então usa o gerente
    const r = await post("/api/caixa/corrigir-atendimento", cx.token, corpo({ barbeiroId: ger.id }));
    assert.equal(r.status, 201, JSON.stringify(r.dados));
    ag = await env.DB.prepare("SELECT barbeiro_id, situacao FROM agendamentos WHERE id = ?").bind(m.id).first();
    assert.equal(ag.barbeiro_id, ger.id); assert.equal(ag.situacao, "finalizado");
    const ativas = await env.DB.prepare("SELECT barbeiro_id FROM comissoes WHERE estornada = 0 AND finalizacao_id IN (SELECT id FROM finalizacoes WHERE agendamento_id = ? AND estornada = 0)").bind(m.id).all();
    assert.deepEqual(ativas.results.map(x => x.barbeiro_id), [ger.id]);
    const aud = await env.DB.prepare("SELECT detalhes FROM auditoria WHERE acao = 'atendimento_profissional_corrigido' AND alvo = ?").bind(m.id).first();
    assert.ok(aud && JSON.parse(aud.detalhes).antes.barbeiro === barb.id);
    // inativo: recusado
    assert.equal((await post("/api/usuarios/alterar", ger.token, { id: outro.id, ativo: false, motivo: "teste" })).status, 200);
    const m2 = await cobrado(amb, "13:00");
    assert.equal((await post("/api/caixa/corrigir-atendimento", cx.token, { ...corpo({ barbeiroId: outro.id }), id: m2.id })).status, 400);
    void get;
  });

  test("corrigir o cliente: troca por outro já cadastrado; bloqueado recusado; outra barbearia e barbeiro recusados; registrado", async () => {
    const amb = await cenario("corr5");
    const { post, cx, ger, barb, corte, env } = amb;
    const m = await cobrado(amb, "14:00");
    const novo = (await post("/api/clientes", ger.token, { nome: "Cliente Certo", telefone: "11988880001", aceiteLgpd: true })).dados.cliente;
    const bloq = (await post("/api/clientes", ger.token, { nome: "Cliente Bloqueado", telefone: "11988880002", aceiteLgpd: true })).dados.cliente;
    await post("/api/clientes/bloquear", ger.token, { clienteId: bloq.id, motivo: "teste" });
    const corpo = (extra = {}) => ({ id: m.id, motivo: "Cliente errado", itens: [{ servicoId: corte.id, precoCobradoCentavos: 4000 }], pagamentos: [{ forma: "pix", valorCentavos: 4000 }], ...extra });
    assert.equal((await post("/api/caixa/corrigir-atendimento", barb.token, corpo({ clienteId: novo.id }))).status, 403);
    assert.equal((await post("/api/caixa/corrigir-atendimento", cx.token, corpo({ clienteId: bloq.id }))).status, 409);
    const outra = await cenario("corr6", amb, amb.p);
    const alheio = (await post("/api/clientes", outra.ger.token, { nome: "De Outra", telefone: "11988880003", aceiteLgpd: true })).dados.cliente;
    assert.equal((await post("/api/caixa/corrigir-atendimento", cx.token, corpo({ clienteId: alheio.id }))).status, 404);
    let ag = await env.DB.prepare("SELECT cliente_id, situacao FROM agendamentos WHERE id = ?").bind(m.id).first();
    assert.notEqual(ag.cliente_id, novo.id); assert.equal(ag.situacao, "finalizado");
    const r = await post("/api/caixa/corrigir-atendimento", cx.token, corpo({ clienteId: novo.id }));
    assert.equal(r.status, 201, JSON.stringify(r.dados));
    ag = await env.DB.prepare("SELECT cliente_id, situacao FROM agendamentos WHERE id = ?").bind(m.id).first();
    assert.equal(ag.cliente_id, novo.id); assert.equal(ag.situacao, "finalizado");
    const aud = await env.DB.prepare("SELECT detalhes FROM auditoria WHERE acao = 'atendimento_cliente_corrigido' AND alvo = ?").bind(m.id).first();
    assert.ok(aud && JSON.parse(aud.detalhes).depois.cliente === novo.id);
  });

  test("corrigir lançamento de hoje cujo horário era de outro dia: /caixa/atendimentos?id= traz o atendimento (só da própria barbearia)", async () => {
    const amb = await cenario("corr7");
    const { post, get, cx, barb, corte } = amb;
    const ontem = new Date(Date.now() - 36 * 3600e3).toISOString().slice(0, 10);
    const m = (await post("/api/agenda", cx.token, { barbeiroId: barb.id, data: ontem, hora: "09:00", servicoIds: [corte.id], cliente: { nome: "Cliente Ontem" }, aceiteForaHorario: true })).dados.agendamento;
    assert.ok(m, "marcou ontem");
    const r = await post("/api/caixa/cobrar", cx.token, { id: m.id, itens: [{ servicoId: corte.id, precoCobradoCentavos: 4000 }], pagamentos: [{ forma: "pix", valorCentavos: 4000 }] });
    assert.equal(r.status, 201, JSON.stringify(r.dados));
    const sem = (await get("/api/caixa/atendimentos", cx.token)).dados.atendimentos;
    assert.ok(!sem.some(a => a.id === m.id), "sem ?id= o finalizado de outro dia não aparece");
    const com = (await get(`/api/caixa/atendimentos?id=${m.id}`, cx.token)).dados.atendimentos.find(a => a.id === m.id);
    assert.ok(com && com.servicos.length === 1 && com.servicos[0].precoCentavos === 4000, "com ?id= aparece, com os serviços");
    const outra = await cenario("corr8", amb, amb.p);
    assert.ok(!(await get(`/api/caixa/atendimentos?id=${m.id}`, outra.cx.token)).dados.atendimentos.some(a => a.id === m.id), "outra barbearia não enxerga");
  });
});
