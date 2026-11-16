// Suporte: chamados entre barbearia (proprietário/gerente) e plataforma; contato do suporte. Dados fictícios.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { ambiente } from "./ambiente.js";

async function cenario() {
  const amb = ambiente();
  const p = await amb.criarPlataforma();
  const a = await amb.criarBarbearia(p, "alfa");
  const b = await amb.criarBarbearia(p, "beta");
  const gerA = await amb.criarUsuario(a.prop, "ger.alfa", "gerente");
  const barbA = await amb.criarUsuario(a.prop, "barb.alfa", "barbeiro");
  const cxA = await amb.criarUsuario(a.prop, "cx.alfa", "caixa");
  return { ...amb, p, a, b, gerA, barbA, cxA };
}
const novo = (extra = {}) => ({ categoria: "problema", assunto: "Caixa não fecha", mensagem: "Ao fechar o caixa aparece um erro.", tela: "caixa", ...extra });

describe("suporte (chamados)", () => {
  test("só proprietário e gerente; barbeiro, caixa e plataforma não", async () => {
    const { get, post, a, gerA, barbA, cxA, p } = await cenario();
    assert.equal((await get("/api/suporte", a.prop)).status, 200);
    assert.equal((await get("/api/suporte", gerA.token)).status, 200);
    assert.equal((await get("/api/suporte", barbA.token)).status, 403);
    assert.equal((await post("/api/suporte/chamados", cxA.token, novo())).status, 403);
    assert.equal((await get("/api/suporte", p)).status, 403);
    assert.equal((await get("/api/plataforma/chamados", a.prop)).status, 403, "barbearia não vê a fila do suporte");
  });

  test("abre, suporte responde, cliente responde (volta para o suporte), encerra e reabre", async () => {
    const { get, post, a, gerA, p } = await cenario();
    assert.equal((await post("/api/suporte/chamados", a.prop, novo({ categoria: "x" }))).status, 400);
    assert.equal((await post("/api/suporte/chamados", a.prop, novo({ mensagem: "" }))).status, 400);
    const c = await post("/api/suporte/chamados", gerA.token, novo());
    assert.equal(c.status, 201, JSON.stringify(c.dados));
    assert.equal(c.dados.chamado.numero, 101);
    const c2 = await post("/api/suporte/chamados", a.prop, novo({ categoria: "duvida", assunto: "Como dar desconto?" }));
    assert.equal(c2.dados.chamado.numero, 102);

    let fila = (await get("/api/plataforma/chamados", p)).dados;
    assert.equal(fila.aguardando, 2);
    assert.equal(fila.chamados[0].barbearia, "Barbearia Teste alfa");
    const det = (await get(`/api/plataforma/chamado?id=${c.dados.chamado.id}`, p)).dados;
    assert.equal(det.chamado.abertoPor, "Pessoa ger.alfa");
    assert.equal(det.chamado.tela, "caixa");
    assert.equal(det.mensagens.length, 1);

    assert.equal((await post("/api/plataforma/chamados/responder", p, { id: c.dados.chamado.id, mensagem: "Pode me mandar um print?" })).status, 200);
    let meu = (await get(`/api/suporte/chamado?id=${c.dados.chamado.id}`, a.prop)).dados;
    assert.equal(meu.chamado.situacao, "respondido");
    assert.deepEqual(meu.mensagens.map(m => [m.lado, m.autor]), [["barbearia", "Pessoa ger.alfa"], ["suporte", "Suporte 4blade"]]);
    const lista = (await get("/api/suporte", a.prop)).dados.chamados;
    assert.equal(lista.find(x => x.numero === 101).ultima.lado, "suporte");

    await post("/api/suporte/responder", a.prop, { id: c.dados.chamado.id, mensagem: "Mandei pelo WhatsApp." });
    assert.equal((await get(`/api/suporte/chamado?id=${c.dados.chamado.id}`, a.prop)).dados.chamado.situacao, "aguardando_suporte");

    await post("/api/plataforma/chamados/responder", p, { id: c.dados.chamado.id, mensagem: "Corrigido. Obrigado!", encerrar: true });
    assert.equal((await get(`/api/suporte/chamado?id=${c.dados.chamado.id}`, a.prop)).dados.chamado.situacao, "encerrado");
    fila = (await get("/api/plataforma/chamados?situacao=encerrados", p)).dados;
    assert.equal(fila.chamados.length, 1);
    // cliente responde no encerrado: reabre
    await post("/api/suporte/responder", a.prop, { id: c.dados.chamado.id, mensagem: "Voltou a acontecer." });
    assert.equal((await get(`/api/suporte/chamado?id=${c.dados.chamado.id}`, a.prop)).dados.chamado.situacao, "aguardando_suporte");
    assert.equal((await post("/api/suporte/encerrar", a.prop, { id: c2.dados.chamado.id })).status, 200);
    assert.equal((await post("/api/suporte/encerrar", a.prop, { id: c2.dados.chamado.id })).status, 409);
  });

  test("isolamento: uma barbearia não vê nem responde chamado da outra", async () => {
    const { get, post, a, b } = await cenario();
    const c = (await post("/api/suporte/chamados", a.prop, novo())).dados.chamado;
    assert.equal((await get("/api/suporte", b.prop)).dados.chamados.length, 0);
    assert.equal((await get(`/api/suporte/chamado?id=${c.id}`, b.prop)).status, 404);
    assert.equal((await post("/api/suporte/responder", b.prop, { id: c.id, mensagem: "intrometido" })).status, 404);
    assert.equal((await post("/api/suporte/encerrar", b.prop, { id: c.id })).status, 404);
    assert.equal((await get(`/api/suporte/chamado?id=${c.id}`, a.prop)).dados.mensagens.length, 1);
  });

  test("no máximo 10 chamados em aberto por barbearia", async () => {
    const { post, a } = await cenario();
    for (let i = 0; i < 10; i++) assert.equal((await post("/api/suporte/chamados", a.prop, novo({ assunto: `Assunto ${i}` }))).status, 201);
    const r = await post("/api/suporte/chamados", a.prop, novo());
    assert.equal(r.status, 409);
  });

  test("contato do suporte: plataforma configura, barbearia vê", async () => {
    const { get, post, a, p } = await cenario();
    assert.deepEqual((await get("/api/suporte", a.prop)).dados.contato, { whatsapp: null, email: null, horario: null });
    assert.equal((await post("/api/plataforma/contato-suporte", p, { whatsapp: "123" })).status, 400);
    assert.equal((await post("/api/plataforma/contato-suporte", p, { email: "x" })).status, 400);
    assert.equal((await post("/api/plataforma/contato-suporte", a.prop, { email: "suporte@exemplo.test" })).status, 403);
    const r = await post("/api/plataforma/contato-suporte", p, { whatsapp: "(11) 90000-0000", email: "Suporte@Exemplo.test", horario: "Seg a sex, 9h às 18h" });
    assert.equal(r.status, 200);
    assert.deepEqual((await get("/api/suporte", a.prop)).dados.contato, { whatsapp: "11900000000", email: "suporte@exemplo.test", horario: "Seg a sex, 9h às 18h" });
    await post("/api/plataforma/contato-suporte", p, { email: "suporte@exemplo.test" });
    assert.equal((await get("/api/suporte", a.prop)).dados.contato.whatsapp, null, "campo vazio remove");
  });
});
