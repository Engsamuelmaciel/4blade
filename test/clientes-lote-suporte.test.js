// Suporte cadastra clientes em lote numa barbearia (implantação).
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { ambiente } from "./ambiente.js";

describe("suporte: clientes em lote", () => {
  test("cadastra, pula repetidos, exige LGPD com telefone, só na barbearia escolhida", async () => {
    const amb = ambiente();
    const { post, get } = amb;
    const p = await amb.criarPlataforma();
    const a = await amb.criarBarbearia(p, "lt1");
    const b = await amb.criarBarbearia(p, "lt2");
    const url = "/api/plataforma/barbearias/clientes-lote";
    const lista = [
      { nome: "Cliente Um", telefone: "(11) 91111-0001", apelido: "Umzinho" },
      { nome: "Cliente Dois" },
      { nome: "Cliente Três", telefone: "11 91111-0001" },
      { nome: "X" },
      { nome: "Cliente Cinco", telefone: "123" }
    ];
    // Só a plataforma
    assert.equal((await post(url, a.prop, { barbeariaId: a.id, clientes: lista, aceiteLgpd: true })).status, 403);
    // Validação
    assert.equal((await post(url, p, { barbeariaId: a.id, clientes: [] })).status, 400);
    assert.equal((await post(url, p, { barbeariaId: a.id, clientes: Array(201).fill({ nome: "Fulano" }) })).status, 400);
    assert.equal((await post(url, p, { barbeariaId: "00000000-0000-4000-8000-000000000000", clientes: lista })).status, 404);
    // Sem LGPD: o com telefone volta com erro, o sem telefone entra
    const semLgpd = await post(url, p, { barbeariaId: a.id, clientes: [{ nome: "Com Fone", telefone: "11922220000" }, { nome: "Sem Fone" }] });
    assert.equal(semLgpd.status, 200);
    assert.deepEqual(semLgpd.dados.resultados.map(r => r.situacao), ["erro", "ok"]);
    const r = await post(url, p, { barbeariaId: a.id, clientes: lista, aceiteLgpd: true });
    assert.equal(r.status, 200, JSON.stringify(r.dados));
    assert.equal(r.dados.cadastrados, 2);
    assert.deepEqual(r.dados.resultados.map(x => x.situacao), ["ok", "ok", "repetido", "erro", "erro"]);
    // De novo: o telefone já existe
    const de2 = await post(url, p, { barbeariaId: a.id, clientes: [lista[0]], aceiteLgpd: true });
    assert.equal(de2.dados.resultados[0].situacao, "repetido");
    // Aparece só na barbearia A, com apelido; telefone fictício "sem:" não aparece
    const ca = (await get("/api/clientes", a.prop)).dados.clientes;
    const um = ca.find(c => c.nome === "Cliente Um");
    assert.ok(um);
    assert.equal(um.telefone, "11911110001");
    assert.equal(um.apelido, "Umzinho");
    assert.equal(ca.find(c => c.nome === "Cliente Dois").telefone, null);
    assert.equal((await get("/api/clientes", b.prop)).dados.clientes.filter(c => /^Cliente /.test(c.nome)).length, 0, "isolamento");
    // O mesmo telefone pode existir em outra barbearia
    assert.equal((await post(url, p, { barbeariaId: b.id, clientes: [lista[0]], aceiteLgpd: true })).dados.cadastrados, 1);
    const aud = amb.env.DB.raw.prepare("SELECT COUNT(*) n FROM auditoria WHERE acao = 'clientes_lote_suporte' AND barbearia_id = ?").get(a.id);
    assert.equal(aud.n, 2);
  });
});
