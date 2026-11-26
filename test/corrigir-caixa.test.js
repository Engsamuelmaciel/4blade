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
    assert.ok(c.lancamentos.some(x => x.tipo === "estorno_atendimento" && x.valorCentavos === -4000), "estorno da antiga continua na lista");
    const raw = env.DB.raw;
    assert.equal(raw.prepare("SELECT COUNT(*) n FROM finalizacoes WHERE agendamento_id = ?").get(m.id).n, 2, "nada apagado: antiga (estornada) + nova");
    assert.equal(raw.prepare("SELECT SUM(valor_centavos) s FROM comissoes WHERE estornada = 0").get().s, 3250, "50% de 65,00");
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
});
