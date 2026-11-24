// Esqueci minha senha: link por e-mail (vale 1 hora, uma vez só). E-mail de mentira (nada sai de verdade).
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { ambiente } from "./ambiente.js";

function comEmail(amb) {
  const enviados = [];
  amb.env.RESEND_API_KEY = "chave-falsa";
  amb.env.EMAIL_FETCH = async (url, init) => { enviados.push({ url, ...JSON.parse(init.body), auth: init.headers.authorization }); return new Response("{}", { status: 200 }); };
  return enviados;
}
const tokenDo = envio => decodeURIComponent(envio.text.match(/#\/redefinir-senha\/([A-Za-z0-9_-]+)/)[1]);

describe("esqueci minha senha", () => {
  test("cadastra e-mail, recebe o link, troca a senha; link vale uma vez; resposta não revela nada", async () => {
    const amb = ambiente();
    const { post, get, login } = amb;
    const p = await amb.criarPlataforma();
    const a = await amb.criarBarbearia(p, "rs1");
    // Desligado (sem chave): avisa para pedir ao gerente
    assert.equal((await post("/api/auth/esqueci", null, { login: "dono.rs1" })).status, 503);
    const enviados = comEmail(amb);
    // E-mail inválido recusado; válido gravado e devolvido em /auth/me
    assert.equal((await post("/api/auth/meu-email", a.prop, { email: "sem-arroba" })).status, 400);
    assert.equal((await post("/api/auth/meu-email", a.prop, { email: " Dono.RS1@Exemplo.com " })).status, 200);
    assert.equal((await get("/api/auth/me", a.prop)).dados.usuario.email, "dono.rs1@exemplo.com");
    // Sem e-mail ou inexistente: mesma resposta, nada enviado
    const barb = await amb.criarUsuario(a.prop, "barb.rs1", "barbeiro");
    const r0 = await post("/api/auth/esqueci", null, { login: "barb.rs1" });
    const r1 = await post("/api/auth/esqueci", null, { login: "nao.existe" });
    assert.equal(r0.status, 200); assert.equal(r1.status, 200);
    assert.equal(r0.dados.mensagem, r1.dados.mensagem);
    assert.equal(enviados.length, 0);
    // Pelo usuário e pelo e-mail
    assert.equal((await post("/api/auth/esqueci", null, { login: "dono.rs1" })).dados.mensagem, r1.dados.mensagem);
    assert.equal(enviados.length, 1);
    assert.deepEqual(enviados[0].to, ["dono.rs1@exemplo.com"]);
    assert.equal(enviados[0].auth, "Bearer chave-falsa");
    assert.match(enviados[0].text, /usuário dono\.rs1/);
    await post("/api/auth/esqueci", null, { login: "DONO.RS1@exemplo.com" });
    assert.equal(enviados.length, 2);
    const antigo = tokenDo(enviados[0]);
    const token = tokenDo(enviados[1]);
    // Senha fraca recusada; certa troca, encerra sessões e invalida os outros links
    assert.equal((await post("/api/auth/redefinir", null, { token, novaSenha: "curta" })).status, 400);
    assert.equal((await post("/api/auth/redefinir", null, { token: "x".repeat(43), novaSenha: "Senha-Nova-2026" })).status, 410);
    const ok = await post("/api/auth/redefinir", null, { token, novaSenha: "Senha-Nova-2026" });
    assert.equal(ok.status, 200, JSON.stringify(ok.dados));
    assert.equal(ok.dados.login, "dono.rs1");
    assert.equal((await get("/api/auth/me", a.prop)).status, 401, "sessão antiga encerrada");
    assert.equal((await login("dono.rs1", "Senha-Nova-2026")).status, 200);
    assert.equal((await post("/api/auth/redefinir", null, { token, novaSenha: "Outra-Senha-2026" })).status, 410, "uma vez só");
    assert.equal((await post("/api/auth/redefinir", null, { token: antigo, novaSenha: "Outra-Senha-2026" })).status, 410, "link anterior também cai");
    // Link vencido
    await post("/api/auth/esqueci", null, { login: "dono.rs1" });
    amb.env.DB.raw.prepare("UPDATE senha_recuperacoes SET expira_em = '2000-01-01T00:00:00.000Z' WHERE usado_em IS NULL").run();
    assert.equal((await post("/api/auth/redefinir", null, { token: tokenDo(enviados.at(-1)), novaSenha: "Outra-Senha-2026" })).status, 410);
    // Limite: 3 pedidos por hora para o mesmo usuário (este é o 3º; o 4º é recusado)
    assert.equal((await post("/api/auth/esqueci", null, { login: "dono.rs1" })).status, 200);
    assert.equal((await post("/api/auth/esqueci", null, { login: "dono.rs1" })).status, 429);
    // Auditoria sem o e-mail completo
    const aud = amb.env.DB.raw.prepare("SELECT detalhes FROM auditoria WHERE acao = 'senha_link_enviado'").all();
    assert.ok(aud.length >= 2 && aud.every(x => !/rs1@/.test(x.detalhes)));
    assert.ok(amb.env.DB.raw.prepare("SELECT 1 FROM auditoria WHERE acao = 'senha_redefinida_por_email'").get());
    void barb;
  });

  test("gerente cadastra o e-mail da equipe (só a própria); suporte cadastra o do dono", async () => {
    const amb = ambiente();
    const { post, get } = amb;
    const enviados = comEmail(amb);
    const p = await amb.criarPlataforma();
    const a = await amb.criarBarbearia(p, "rs2");
    const b = await amb.criarBarbearia(p, "rs3");
    const c = await post("/api/usuarios", a.prop, { nome: "Barbeiro Mail", login: "barb.mail", perfil: "barbeiro", email: "barb.mail@exemplo.com" });
    assert.equal(c.status, 201, JSON.stringify(c.dados));
    assert.equal(c.dados.usuario.email, "barb.mail@exemplo.com");
    assert.equal((await post("/api/usuarios/alterar", a.prop, { id: c.dados.usuario.id, email: "novo.mail@exemplo.com" })).status, 200);
    assert.equal((await get("/api/usuarios", a.prop)).dados.usuarios.find(u => u.login === "barb.mail").email, "novo.mail@exemplo.com");
    assert.equal((await post("/api/usuarios/alterar", b.prop, { id: c.dados.usuario.id, email: "x@exemplo.com" })).status, 404, "isolamento");
    assert.equal((await post("/api/usuarios/alterar", a.prop, { id: c.dados.usuario.id, email: "ruim" })).status, 400);
    // Tirar o e-mail: o link não é mais enviado
    assert.equal((await post("/api/usuarios/alterar", a.prop, { id: c.dados.usuario.id, email: "" })).status, 200);
    await post("/api/auth/esqueci", null, { login: "barb.mail" });
    assert.equal(enviados.length, 0);
    // Suporte põe o e-mail do dono
    const e = await post("/api/plataforma/barbearias/editar", p, { id: b.id, proprietario: { email: "dono.rs3@exemplo.com" }, motivo: "Implantação" });
    assert.equal(e.status, 200, JSON.stringify(e.dados));
    assert.equal(e.dados.barbearia.proprietario.email, "dono.rs3@exemplo.com");
    await post("/api/auth/esqueci", null, { login: "dono.rs3" });
    assert.deepEqual(enviados[0].to, ["dono.rs3@exemplo.com"]);
  });
});
