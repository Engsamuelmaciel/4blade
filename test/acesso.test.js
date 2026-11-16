// Login, troca de senha, sessão, limite de tentativas, setup e barbearia bloqueada. Dados fictícios.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { ambiente, TOKEN_SETUP } from "./ambiente.js";
import { aplicarMigracoes } from "./d1-local.js";

describe("rotas e tela", () => {
  test("API responde em /api e /api/health", async () => {
    const { get } = ambiente();
    assert.equal((await get("/api/")).dados.sistema, "4blade");
    assert.equal((await get("/api/health")).dados.banco, "conectado");
  });

  test("endereços fora de /api/ entregam a tela", async () => {
    const { get } = ambiente();
    for (const c of ["/", "/caixa", "/index.html"]) assert.equal((await get(c)).dados, "TELA", c);
  });

  test("rota desconhecida devolve 404 e sem sessão devolve 401", async () => {
    const { get, criarPlataforma } = ambiente();
    assert.equal((await get("/api/servicos")).status, 401);
    const p = await criarPlataforma();
    assert.equal((await get("/api/nao-existe", p)).status, 404);
  });

  test("migrações podem ser aplicadas de novo sem erro", () => {
    const { env } = ambiente();
    assert.doesNotThrow(() => aplicarMigracoes(env.DB));
  });
});

describe("setup da plataforma", () => {
  test("exige o token e só funciona uma vez", async () => {
    const { chamar, criarPlataforma } = ambiente();
    const semToken = await chamar("/api/setup/plataforma", { metodo: "POST", corpo: { login: "x.y.z", nome: "Alguem" } });
    assert.equal(semToken.status, 403);
    await criarPlataforma();
    const denovo = await chamar("/api/setup/plataforma", {
      metodo: "POST", headers: { "x-setup-token": TOKEN_SETUP }, corpo: { login: "outro", nome: "Outro" }
    });
    assert.equal(denovo.status, 409);
  });
});

describe("login e troca de senha", () => {
  test("1º acesso exige troca e bloqueia as demais rotas", async () => {
    const { post, get, login, criarPlataforma } = ambiente();
    const p = await criarPlataforma();
    const r = await post("/api/plataforma/barbearias", p, {
      nome: "Barbearia Alfa", proprietario: { nome: "Dono Alfa", login: "dono.alfa" }
    });
    const l = await login("dono.alfa", r.dados.senhaProvisoria);
    assert.equal(l.status, 200);
    assert.equal(l.dados.usuario.trocaObrigatoria, true);
    assert.equal((await get("/api/servicos", l.dados.token)).status, 403);
    assert.equal((await get("/api/auth/me", l.dados.token)).status, 200);
  });

  test("login aceita maiúsculas no usuário (vira minúsculo)", async () => {
    const { post, login, ativar, criarPlataforma } = ambiente();
    const p = await criarPlataforma();
    const r = await post("/api/plataforma/barbearias", p, { nome: "Barbearia Alfa", proprietario: { nome: "Dono Alfa", login: "dono.alfa" } });
    await ativar("dono.alfa", r.dados.senhaProvisoria, "SenhaBoa123");
    assert.equal((await login("Dono.Alfa", "SenhaBoa123")).status, 200);
  });

  test("recusa senha curta, igual ao usuário e senha atual errada", async () => {
    const { post, login, criarPlataforma } = ambiente();
    const p = await criarPlataforma();
    const r = await post("/api/plataforma/barbearias", p, { nome: "Barbearia Alfa", proprietario: { nome: "Dono Alfa", login: "dono.alfa" } });
    const prov = r.dados.senhaProvisoria;
    const { token } = (await login("dono.alfa", prov)).dados;
    const troca = corpo => post("/api/auth/trocar-senha", token, corpo);
    assert.equal((await troca({ senhaAtual: prov, novaSenha: "curta" })).status, 400);
    assert.equal((await troca({ senhaAtual: prov, novaSenha: "dono.alfa" })).status, 400);
    assert.equal((await troca({ senhaAtual: prov, novaSenha: prov })).status, 400);
    assert.equal((await troca({ senhaAtual: "errada", novaSenha: "SenhaBoa123" })).status, 403);
  });

  test("troca de senha encerra a sessão antiga e a senha provisória deixa de valer", async () => {
    const { post, get, login, criarPlataforma } = ambiente();
    const p = await criarPlataforma();
    const r = await post("/api/plataforma/barbearias", p, { nome: "Barbearia Alfa", proprietario: { nome: "Dono Alfa", login: "dono.alfa" } });
    const prov = r.dados.senhaProvisoria;
    const { token } = (await login("dono.alfa", prov)).dados;
    await post("/api/auth/trocar-senha", token, { senhaAtual: prov, novaSenha: "SenhaBoa123" });
    assert.equal((await get("/api/auth/me", token)).status, 401);
    assert.equal((await login("dono.alfa", prov)).status, 401);
    assert.equal((await login("dono.alfa", "SenhaBoa123")).status, 200);
  });

  test("logout revoga o token", async () => {
    const { post, get, criarPlataforma } = ambiente();
    const p = await criarPlataforma();
    assert.equal((await post("/api/auth/logout", p)).status, 200);
    assert.equal((await get("/api/auth/me", p)).status, 401);
  });

  test("erro não revela se o usuário existe", async () => {
    const { login, criarPlataforma } = ambiente();
    await criarPlataforma();
    const existe = await login("suporte", "errada123");
    const naoExiste = await login("ninguem", "errada123");
    assert.equal(existe.status, 401);
    assert.deepEqual(existe.dados, naoExiste.dados);
  });

  test("sessão vence em 12 horas", async () => {
    const { env, login, get, criarPlataforma } = ambiente();
    await criarPlataforma();
    const l = await login("suporte", "Nova-suporte-senha");
    const horas = (Date.parse(l.dados.expiraEm) - Date.now()) / 3600000;
    assert.ok(horas > 11.9 && horas <= 12, `horas=${horas}`);
    env.DB.raw.prepare("UPDATE sessoes SET expira_em = datetime('now', '-1 minute')").run();
    assert.equal((await get("/api/auth/me", l.dados.token)).status, 401);
  });

  test("/auth/me informa a tela inicial do perfil (caixa abre no caixa)", async () => {
    const { get, criarPlataforma, criarBarbearia, criarUsuario } = ambiente();
    const p = await criarPlataforma();
    const a = await criarBarbearia(p, "alfa");
    const ger = await criarUsuario(a.prop, "ger.alfa", "gerente");
    const cx = await criarUsuario(ger.token, "caixa.alfa", "caixa");
    const me = await get("/api/auth/me", cx.token);
    assert.equal(me.dados.usuario.telaInicial, "caixa");
    assert.equal(me.dados.usuario.barbearia.nome, "Barbearia Teste alfa");
    assert.equal((await get("/api/auth/me", p)).dados.usuario.telaInicial, "plataforma");
    assert.equal((await get("/api/auth/me", a.prop)).dados.usuario.telaInicial, "inicio");
  });
});

describe("limite de tentativas (5 a cada 15 min)", () => {
  test("5 erros bloqueiam, mesmo com a senha certa depois", async () => {
    const { login, criarPlataforma } = ambiente();
    await criarPlataforma();
    for (let i = 0; i < 5; i++) assert.equal((await login("suporte", "errada123")).status, 401);
    assert.equal((await login("suporte", "Nova-suporte-senha")).status, 429);
  });

  test("passados 15 minutos, volta a entrar", async () => {
    const { env, login, criarPlataforma } = ambiente();
    await criarPlataforma();
    for (let i = 0; i < 5; i++) await login("suporte", "errada123");
    assert.equal((await login("suporte", "Nova-suporte-senha")).status, 429);
    env.DB.raw.prepare("UPDATE limites_acesso SET janela = janela - 1").run();   // simula a janela anterior
    assert.equal((await login("suporte", "Nova-suporte-senha")).status, 200);
  });

  test("logins certos não contam; acerto zera os erros", async () => {
    const { login, criarPlataforma } = ambiente();
    await criarPlataforma();
    for (let i = 0; i < 8; i++) assert.equal((await login("suporte", "Nova-suporte-senha")).status, 200);
    for (let i = 0; i < 4; i++) await login("suporte", "errada123");
    assert.equal((await login("suporte", "Nova-suporte-senha")).status, 200);
    for (let i = 0; i < 4; i++) assert.equal((await login("suporte", "errada123")).status, 401);
  });

  test("limite por IP segura ataque a muitos usuários", async () => {
    const { login } = ambiente();
    let bloqueou = false;
    for (let i = 0; i < 110; i++) {
      if ((await login(`atq${i}`, "errada123", "66.6.6.6")).status === 429) { bloqueou = true; break; }
    }
    assert.ok(bloqueou);
  });
});

describe("barbearia bloqueada não entra", () => {
  test("bloquear derruba sessões, recusa login e desbloquear devolve o acesso", async () => {
    const { post, get, login, criarPlataforma, criarBarbearia, criarUsuario } = ambiente();
    const p = await criarPlataforma();
    const a = await criarBarbearia(p, "alfa");
    const b = await criarBarbearia(p, "beta");
    const barb = await criarUsuario(a.prop, "barb.alfa", "barbeiro");

    assert.equal((await post("/api/plataforma/barbearias/alterar", p, { id: a.id, bloqueada: true })).status, 400, "exige motivo");
    const r = await post("/api/plataforma/barbearias/alterar", p, { id: a.id, bloqueada: true, motivo: "Mensalidade em atraso" });
    assert.equal(r.status, 200);
    assert.equal(r.dados.barbearia.bloqueada, true);

    // sessões abertas caem
    assert.equal((await get("/api/servicos", a.prop)).status, 401);
    assert.equal((await get("/api/servicos", barb.token)).status, 401);
    // login recusado (com senha certa)
    const l = await login("dono.alfa", "Nova-dono.alfa-senha");
    assert.equal(l.status, 403);
    assert.match(l.dados.erro, /bloqueado/);
    assert.equal((await login("barb.alfa", "Nova-barb.alfa-senha")).status, 403);
    // senha errada continua com a mensagem genérica
    assert.equal((await login("dono.alfa", "errada123")).status, 401);
    // a outra barbearia segue normal
    assert.equal((await get("/api/servicos", b.prop)).status, 200);

    await post("/api/plataforma/barbearias/alterar", p, { id: a.id, bloqueada: false, motivo: "Pagamento confirmado" });
    assert.equal((await login("dono.alfa", "Nova-dono.alfa-senha")).status, 200);
  });
});
