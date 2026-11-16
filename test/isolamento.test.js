// Isolamento entre barbearias: uma nunca lê nem altera dado da outra, mesmo trocando ids na requisição. Dados fictícios.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { ambiente } from "./ambiente.js";

async function duasBarbearias() {
  const amb = ambiente();
  const p = await amb.criarPlataforma();
  const lado = async nome => {
    const b = await amb.criarBarbearia(p, nome);
    const ger = await amb.criarUsuario(b.prop, `ger.${nome}`, "gerente");
    const barb = await amb.criarUsuario(ger.token, `barb.${nome}`, "barbeiro");
    const cx = await amb.criarUsuario(ger.token, `cx.${nome}`, "caixa");
    const servico = (await amb.post("/api/servicos", ger.token, { nome: `Corte ${nome}`, precoCentavos: 4000, duracaoMin: 30 })).dados.servico;
    const produto = (await amb.post("/api/produtos", ger.token, { nome: `Pomada ${nome}`, codigo: "789100", precoCentavos: 4500 })).dados.produto;
    const cliente = (await amb.post("/api/clientes", ger.token, { nome: `Cliente ${nome}`, telefone: "11 98888-0000", aceiteLgpd: true })).dados.cliente;
    return { ...b, ger, barb, cx, servico, produto, cliente };
  };
  return { ...amb, p, A: await lado("alfa"), B: await lado("beta") };
}

describe("isolamento entre barbearias", () => {
  test("listas só trazem dados da própria barbearia", async () => {
    const { get, A, B } = await duasBarbearias();
    for (const [rota, chave] of [["/api/servicos", "servicos"], ["/api/produtos", "produtos"], ["/api/clientes", "clientes"], ["/api/usuarios", "usuarios"]]) {
      for (const [eu, outro] of [[A, B], [B, A]]) {
        const lista = (await get(rota, eu.ger.token)).dados[chave];
        const texto = JSON.stringify(lista);
        assert.ok(lista.length > 0, rota);
        assert.ok(!texto.includes(outro.servico.id) && !texto.includes(outro.produto.id) && !texto.includes(outro.cliente.id), `${rota} vazou id`);
        assert.ok(!/beta/.test(texto) || eu === B, `${rota}: A viu nome da B`);
        assert.ok(!/alfa/.test(texto) || eu === A, `${rota}: B viu nome da A`);
      }
    }
    // barbeiro e caixa também
    assert.deepEqual((await get("/api/servicos", A.barb.token)).dados.servicos.map(s => s.id), [A.servico.id]);
    assert.deepEqual((await get("/api/produtos", A.cx.token)).dados.produtos.map(s => s.id), [A.produto.id]);
  });

  test("mesmo código de produto e mesmo telefone de cliente podem existir em barbearias diferentes", async () => {
    const { A, B } = await duasBarbearias();
    assert.equal(A.produto.codigo, B.produto.codigo);
    assert.equal(A.cliente.telefone, B.cliente.telefone);
  });

  test("alterar com id da outra barbearia dá 'não encontrado' e nada muda", async () => {
    const { env, post, A, B } = await duasBarbearias();
    const tentativas = [
      ["/api/servicos/alterar", { id: B.servico.id, precoCentavos: 1 }],
      ["/api/servicos/alterar", { id: B.servico.id, ativo: false, motivo: "sabotagem" }],
      ["/api/produtos/alterar", { id: B.produto.id, precoCentavos: 1 }],
      ["/api/clientes/alterar", { id: B.cliente.id, nome: "Invasor" }],
      ["/api/usuarios/alterar", { id: B.barb.id, ativo: false, motivo: "sabotagem" }],
      ["/api/usuarios/alterar", { id: B.ger.id, nome: "Invasor" }],
      ["/api/usuarios/redefinir-senha", { id: B.barb.id, motivo: "roubar acesso" }]
    ];
    const antes = env.DB.raw.prepare("SELECT * FROM servicos, produtos, clientes WHERE servicos.barbearia_id = ? AND produtos.barbearia_id = ? AND clientes.barbearia_id = ?").all(B.id, B.id, B.id);
    const usuariosAntes = env.DB.raw.prepare("SELECT * FROM usuarios WHERE barbearia_id = ?").all(B.id);
    for (const token of [A.prop, A.ger.token]) {
      for (const [rota, corpo] of tentativas) {
        const r = await post(rota, token, corpo);
        assert.equal(r.status, 404, `${rota} ${JSON.stringify(corpo)} → ${r.status}`);
      }
    }
    assert.deepEqual(env.DB.raw.prepare("SELECT * FROM servicos, produtos, clientes WHERE servicos.barbearia_id = ? AND produtos.barbearia_id = ? AND clientes.barbearia_id = ?").all(B.id, B.id, B.id), antes);
    assert.deepEqual(env.DB.raw.prepare("SELECT * FROM usuarios WHERE barbearia_id = ?").all(B.id), usuariosAntes);
  });

  test("mandar barbearia_id na requisição não muda nada: o servidor usa o da sessão", async () => {
    const { env, post, get, A, B } = await duasBarbearias();
    const r = await post("/api/servicos", A.ger.token, {
      nome: "Corte Infiltrado", precoCentavos: 100, duracaoMin: 30, barbearia_id: B.id, barbeariaId: B.id
    });
    assert.equal(r.status, 201);
    assert.equal(env.DB.raw.prepare("SELECT barbearia_id FROM servicos WHERE id = ?").get(r.dados.servico.id).barbearia_id, A.id);
    assert.ok(!(await get(`/api/servicos?barbearia_id=${B.id}`, B.ger.token)).dados.servicos.some(s => s.nome === "Corte Infiltrado"));
    assert.ok(!(await get(`/api/servicos?barbearia_id=${B.id}`, A.ger.token)).dados.servicos.some(s => s.id === B.servico.id));

    const u = await post("/api/usuarios", A.ger.token, { nome: "Barbeiro Infiltrado", login: "inf.alfa", perfil: "barbeiro", barbearia_id: B.id });
    assert.equal(u.status, 201);
    assert.equal(env.DB.raw.prepare("SELECT barbearia_id FROM usuarios WHERE id = ?").get(u.dados.usuario.id).barbearia_id, A.id);
  });

  test("busca de clientes não encontra cliente da outra barbearia", async () => {
    const { get, post, A, B } = await duasBarbearias();
    await post("/api/clientes", B.ger.token, { nome: "Somente Beta", telefone: "21 97777-1111", aceiteLgpd: true });
    assert.equal((await get("/api/clientes?busca=Somente", A.ger.token)).dados.clientes.length, 0);
    assert.equal((await get("/api/clientes?busca=977771111", A.ger.token)).dados.clientes.length, 0);
    assert.equal((await get("/api/clientes?busca=977771111", B.ger.token)).dados.clientes.length, 1);
  });

  test("modelos de mensagem são de cada barbearia", async () => {
    const { get, post, A, B } = await duasBarbearias();
    await post("/api/modelos-mensagem/alterar", A.ger.token, { tipo: "lembrete", texto: "Alfa lembra: {cliente} às {hora}." });
    const a = (await get("/api/modelos-mensagem", A.ger.token)).dados.modelos.find(m => m.tipo === "lembrete");
    const b = (await get("/api/modelos-mensagem", B.ger.token)).dados.modelos.find(m => m.tipo === "lembrete");
    assert.equal(a.texto, "Alfa lembra: {cliente} às {hora}.");
    assert.notEqual(b.texto, a.texto);
  });

  test("auditoria grava a barbearia certa", async () => {
    const { env, A } = await duasBarbearias();
    const linhas = env.DB.raw.prepare("SELECT DISTINCT barbearia_id FROM auditoria WHERE usuario_id = ?").all(A.ger.id);
    assert.deepEqual(linhas.map(l => l.barbearia_id), [A.id]);
  });
});
