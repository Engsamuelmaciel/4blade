// Pedidos de teste grátis pelo site → painel da plataforma → cadastro manual da barbearia. Dados fictícios.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { ambiente } from "./ambiente.js";

const pedido = (extra = {}) => ({ barbearia: "Barbearia Pedido Fictícia", nome: "Pessoa Interessada", telefone: "(31) 90000-0077",
  cidade: "Cidade Fictícia - MG", barbeiros: 3, planoInteresse: "standard", mensagem: "Quero testar a agenda.", aceite: true, ...extra });
const enviar = (amb, corpo, ip = "10.8.0.1") => amb.chamar("/api/solicitar-teste", { metodo: "POST", corpo, ip });

describe("pedido de teste grátis (site)", () => {
  test("valida, grava, não duplica o mesmo WhatsApp e limita por aparelho", async () => {
    const amb = ambiente();
    assert.match((await enviar(amb, pedido({ aceite: false }))).dados.erro, /aceite/);
    assert.match((await enviar(amb, pedido({ telefone: "123" }), "10.8.0.2")).dados.erro, /WhatsApp/);
    assert.match((await enviar(amb, pedido({ barbeiros: 0 }), "10.8.0.2")).dados.erro, /barbeiros/);
    assert.match((await enviar(amb, pedido({ planoInteresse: "ouro" }), "10.8.0.3")).dados.erro, /Plano/);
    const ok = await enviar(amb, pedido({ planoInteresse: null }), "10.8.0.4");
    assert.equal(ok.status, 201);
    assert.equal(ok.dados.numero, 1);
    const rep = await enviar(amb, pedido(), "10.8.0.5");
    assert.equal(rep.status, 200);
    assert.equal(rep.dados.repetido, true);
    assert.equal(Number((await amb.env.DB.prepare("SELECT COUNT(*) AS n FROM solicitacoes_teste").first()).n), 1);
    for (let i = 0; i < 3; i++) await enviar(amb, pedido({ telefone: `3190000010${i}` }), "10.8.0.9");
    assert.equal((await enviar(amb, pedido({ telefone: "31900000199" }), "10.8.0.9")).status, 429);
    // funciona também com a cobrança desligada (é o caso de uso)
    delete amb.env.COBRANCA_ON_LINE;
    assert.equal((await enviar(amb, pedido({ telefone: "31900000188" }), "10.8.0.10")).status, 201);
  });

  test("plataforma vê, muda situação e cadastra a barbearia a partir do pedido; ninguém mais vê", async () => {
    const amb = ambiente();
    const p = await amb.criarPlataforma();
    const outra = await amb.criarBarbearia(p, "existente");
    const s = (await enviar(amb, pedido())).dados;
    assert.equal((await amb.get("/api/plataforma/solicitacoes", outra.prop)).status, 403, "barbearia não vê pedidos");
    let lista = (await amb.get("/api/plataforma/solicitacoes", p)).dados;
    assert.equal(lista.novas, 1);
    const id = lista.solicitacoes[0].id;
    assert.deepEqual({ ...lista.solicitacoes[0], id: undefined, criadoEm: undefined, atualizadoEm: undefined }, {
      id: undefined, numero: s.numero, barbearia: "Barbearia Pedido Fictícia", nome: "Pessoa Interessada", telefone: "31900000077",
      cidade: "Cidade Fictícia - MG", barbeiros: 3, planoInteresse: "standard", mensagem: "Quero testar a agenda.",
      situacao: "nova", observacao: null, barbeariaId: null, criadoEm: undefined, atualizadoEm: undefined
    });
    assert.equal((await amb.post("/api/plataforma/solicitacoes/situacao", p, { id, situacao: "descartada" })).status, 400, "descartar pede motivo");
    assert.equal((await amb.post("/api/plataforma/solicitacoes/situacao", p, { id, situacao: "em_contato", observacao: "Liguei, vai testar" })).status, 200);

    const cad = await amb.post("/api/plataforma/barbearias", p, {
      nome: "Barbearia Pedido Fictícia", plano: "standard", proprietario: { nome: "Pessoa Interessada", login: "dono.pedido" }, solicitacaoId: id
    });
    assert.equal(cad.status, 201, JSON.stringify(cad.dados));
    lista = (await amb.get("/api/plataforma/solicitacoes?situacao=todas", p)).dados;
    assert.equal(lista.solicitacoes[0].situacao, "cadastrada");
    assert.equal(lista.solicitacoes[0].barbeariaId, cad.dados.barbearia.id);
    assert.equal((await amb.get("/api/plataforma/solicitacoes", p)).dados.solicitacoes.length, 0, "cadastrado sai da fila");
    assert.equal((await amb.post("/api/plataforma/barbearias", p, {
      nome: "Outra", proprietario: { nome: "Outra Pessoa", login: "dono.outro" }, solicitacaoId: id })).status, 409);
    assert.equal((await amb.post("/api/plataforma/solicitacoes/situacao", p, { id, situacao: "nova" })).status, 409);
  });
});
