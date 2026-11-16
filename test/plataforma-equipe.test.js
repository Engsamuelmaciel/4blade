// Painel do suporte: editar dados da barbearia e do dono (inclusive o usuário), equipe da barbearia, enviar acesso.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { ambiente } from "./ambiente.js";

async function cenario() {
  const amb = ambiente();
  const p = await amb.criarPlataforma();
  const a = await amb.criarBarbearia(p, "ed1");
  const b = await amb.criarBarbearia(p, "ed2");
  return { ...amb, p, a, b };
}

describe("suporte edita a barbearia e o usuário do dono", () => {
  test("troca nome, telefones e usuário; dono entra com o usuário novo; auditoria", async () => {
    const { post, get, login, p, a } = await cenario();
    assert.equal((await post("/api/plataforma/barbearias/editar", p, { id: a.id, nome: "Nova" })).status, 400, "motivo obrigatório");
    assert.equal((await post("/api/plataforma/barbearias/editar", p, { id: a.id, motivo: "x" })).status, 400);
    assert.equal((await post("/api/plataforma/barbearias/editar", p, { id: a.id, proprietario: { login: "dono.ed2" }, motivo: "teste" })).status, 409, "usuário de outro");
    assert.equal((await post("/api/plataforma/barbearias/editar", p, { id: a.id, proprietario: { login: "Com Espaço" }, motivo: "teste" })).status, 400);
    assert.equal((await post("/api/plataforma/barbearias/editar", p, { id: a.id, proprietario: { telefone: "12" }, motivo: "teste" })).status, 400);
    const r = await post("/api/plataforma/barbearias/editar", p, {
      id: a.id, nome: "Barbearia Editada", telefone: "(11) 3333-4444", motivo: "Dados corrigidos com o dono",
      proprietario: { nome: "Dono Editado", login: "joao.editado", telefone: "(11) 90000-0101" }
    });
    assert.equal(r.status, 200, JSON.stringify(r.dados));
    assert.equal(r.dados.barbearia.nome, "Barbearia Editada");
    assert.equal(r.dados.barbearia.telefone, "1133334444");
    assert.deepEqual({ ...r.dados.barbearia.proprietario, id: undefined }, { id: undefined, nome: "Dono Editado", login: "joao.editado", telefone: "11900000101", trocaPendente: false });
    assert.equal((await get("/api/servicos", a.prop)).status, 401, "sessão antiga encerrada ao trocar o usuário");
    assert.equal((await login("dono.ed1", "Nova-dono.ed1-senha")).status, 401);
    assert.equal((await login("joao.editado", "Nova-dono.ed1-senha")).status, 200, "mesma senha, usuário novo");
    assert.equal((await post("/api/plataforma/barbearias/editar", p, { id: a.id, nome: "Barbearia Editada", motivo: "de novo" })).status, 400, "nada mudou");
    assert.equal((await post("/api/plataforma/barbearias/editar", a.prop, { id: a.id, nome: "X", motivo: "teste" })).status, 401);
  });

  test("enviar acesso ao dono: nova senha com nome e telefone para o WhatsApp", async () => {
    const { post, login, p, a } = await cenario();
    await post("/api/plataforma/barbearias/editar", p, { id: a.id, proprietario: { telefone: "11900000102" }, motivo: "telefone do dono" });
    const r = await post("/api/plataforma/barbearias/redefinir-senha", p, { id: a.id, motivo: "Envio de acesso" });
    assert.equal(r.status, 200);
    assert.deepEqual({ ...r.dados, senhaProvisoria: undefined }, { login: "dono.ed1", nome: "Dono ed1", telefone: "11900000102", senhaProvisoria: undefined });
    assert.equal((await login("dono.ed1", r.dados.senhaProvisoria)).dados.usuario.trocaObrigatoria, true);
  });
});

describe("suporte e a equipe da barbearia", () => {
  test("lista, cria usuário (respeita o plano) e gera senha só de usuário da própria barbearia", async () => {
    const { post, get, login, p, a, b } = await cenario();
    assert.equal((await get(`/api/plataforma/barbearias/equipe?id=${a.id}`, a.prop)).status, 403);
    const c = await post("/api/plataforma/barbearias/equipe", p, { barbeariaId: a.id, perfil: "barbeiro", nome: "Barbeiro Suporte", login: "barb.sup", telefone: "11900000103" });
    assert.equal(c.status, 201, JSON.stringify(c.dados));
    assert.equal(c.dados.barbearia.nome, "Barbearia Teste ed1");
    assert.equal((await login("barb.sup", c.dados.senhaProvisoria)).dados.usuario.trocaObrigatoria, true);
    assert.equal((await post("/api/plataforma/barbearias/equipe", p, { barbeariaId: a.id, perfil: "proprietario", nome: "X Y", login: "x.y.z" })).status, 400);
    assert.equal((await post("/api/plataforma/barbearias/equipe", p, { barbeariaId: a.id, perfil: "barbeiro", nome: "Outro", login: "barb.sup" })).status, 409);
    assert.equal((await post("/api/plataforma/barbearias/equipe", p, { barbeariaId: a.id, perfil: "barbeiro", nome: "Dois", login: "barb.dois" })).status, 201);
    const cheio = await post("/api/plataforma/barbearias/equipe", p, { barbeariaId: a.id, perfil: "barbeiro", nome: "Três", login: "barb.tres" });
    assert.equal(cheio.status, 409, "Básico: 2 barbeiros");
    assert.equal((await post("/api/plataforma/barbearias/equipe", p, { barbeariaId: a.id, perfil: "caixa", nome: "Caixa Suporte", login: "cx.sup" })).status, 201);

    const eq = (await get(`/api/plataforma/barbearias/equipe?id=${a.id}`, p)).dados;
    assert.deepEqual(eq.usuarios.map(u => [u.login, u.perfil]), [["dono.ed1", "proprietario"], ["barb.sup", "barbeiro"], ["barb.dois", "barbeiro"], ["cx.sup", "caixa"]]);
    assert.deepEqual(eq.vagaBarbeiro, { ativos: 2, limite: 2 });
    assert.equal((await get(`/api/plataforma/barbearias/equipe?id=${b.id}`, p)).dados.usuarios.length, 1, "cada barbearia com a sua equipe");

    const s = await post("/api/plataforma/barbearias/equipe/senha", p, { barbeariaId: a.id, usuarioId: c.dados.usuario.id, motivo: "Enviar acesso" });
    assert.equal(s.status, 200);
    assert.equal(s.dados.telefone, "11900000103");
    // isolamento: usuário da barbearia A pedido como se fosse da B
    assert.equal((await post("/api/plataforma/barbearias/equipe/senha", p, { barbeariaId: b.id, usuarioId: c.dados.usuario.id, motivo: "Enviar acesso" })).status, 404);
  });
});
