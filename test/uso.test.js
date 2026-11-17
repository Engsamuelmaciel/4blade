// Uso do app visto pelo suporte (pedido de 17/11/2026): telas, on-line, horários e duração. Sem dados de clientes. Dados fictícios.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { ambiente } from "./ambiente.js";

describe("uso do app no painel da plataforma", () => {
  test("registra telas e sinais; plataforma vê on-line, acessos, duração e telas; equipe não vê; nada de dados de clientes", async () => {
    const amb = ambiente();
    const { post, get, env } = amb;
    const p = await amb.criarPlataforma();
    const b = await amb.criarBarbearia(p, "uso");
    const barb = await amb.criarUsuario(b.prop, "barb.uso", "barbeiro");
    await post("/api/clientes", b.prop, { nome: "Cliente Secreto", telefone: "11 95555-9090", aceiteLgpd: true });
    for (const tela of ["visao-dia", "agenda", "caixa"]) assert.equal((await post("/api/uso", b.prop, { tela, aparelho: "celular" })).status, 200);
    await post("/api/uso", b.prop, {});                       // sinal de "continua aqui"
    await post("/api/uso", barb.token, { tela: "agenda", aparelho: "computador" });
    assert.equal((await post("/api/uso", b.prop, { tela: "<script>" })).status, 200, "tela inválida é ignorada");
    assert.equal(env.DB.raw.prepare("SELECT COUNT(*) n FROM uso_telas").get().n, 4);
    // sessão começou há 25 minutos (simula a duração)
    env.DB.raw.prepare("UPDATE uso_sessoes SET inicio = ? WHERE usuario_id = (SELECT id FROM usuarios WHERE perfil = 'proprietario')")
      .run(new Date(Date.now() - 25 * 60000).toISOString());
    const lista = (await get("/api/plataforma/barbearias", p)).dados.barbearias.find(x => x.id === b.id);
    assert.equal(lista.uso.online, 2);
    assert.ok(lista.uso.ultimo);
    const u = await get(`/api/plataforma/barbearias/uso?id=${b.id}&dias=7`, p);
    assert.equal(u.status, 200, JSON.stringify(u.dados));
    assert.equal(u.dados.onlineAgora, 2);
    const dono = u.dados.pessoas.find(x => x.perfil === "proprietario");
    assert.deepEqual([dono.online, dono.acessos, dono.telas], [true, 1, 3]);
    assert.ok(dono.minutos >= 24 && dono.minutos <= 26, String(dono.minutos));
    const acessoDono = u.dados.acessos.find(a => a.perfil === "proprietario");
    assert.deepEqual(acessoDono.telas.map(t => t.tela), ["visao-dia", "agenda", "caixa"]);
    assert.equal(acessoDono.aparelho, "celular");
    assert.deepEqual(u.dados.telas.find(t => t.tela === "agenda"), { tela: "agenda", vezes: 2, pessoas: 2 });
    assert.ok(!JSON.stringify(u.dados).includes("Cliente Secreto") && !JSON.stringify(u.dados).includes("955559090"), "sem dados de clientes");
    // quem sai do app (logout) deixa de aparecer on-line na hora
    assert.equal((await post("/api/auth/logout", barb.token, {})).status, 200);
    const u3 = (await get(`/api/plataforma/barbearias/uso?id=${b.id}`, p)).dados;
    assert.equal(u3.onlineAgora, 1);
    assert.equal(u3.pessoas.find(x => x.perfil === "barbeiro").online, false);
    assert.equal(u3.acessos.find(x => x.perfil === "barbeiro").saiu, true);
    assert.equal((await get("/api/plataforma/barbearias", p)).dados.barbearias.find(x => x.id === b.id).uso.online, 1);
    // só a plataforma vê
    assert.equal((await get(`/api/plataforma/barbearias/uso?id=${b.id}`, b.prop)).status, 403);
    assert.equal((await get(`/api/plataforma/barbearias/uso?id=${b.id}`, (await amb.criarUsuario(b.prop, "cx.uso", "caixa")).token)).status, 403);
    // outra barbearia não aparece no uso desta
    const b2 = await amb.criarBarbearia(p, "uso2");
    await post("/api/uso", b2.prop, { tela: "agenda" });
    const u2 = (await get(`/api/plataforma/barbearias/uso?id=${b.id}`, p)).dados;
    assert.equal(u2.telas.find(t => t.tela === "agenda").vezes, 2);
    assert.equal((await get("/api/plataforma/barbearias/uso?id=nao-existe", p)).status, 400);
  });
});
