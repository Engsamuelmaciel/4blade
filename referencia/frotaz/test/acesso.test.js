// Testes automáticos da API (acesso, login, hierarquia). Rodar com: npm test (dentro de apps/api)
// Portados do SIGEO v2.65.5 (api.test.js). Todos os dados abaixo são fictícios.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { aplicarMigracoes } from "./d1-local.js";
import { ambiente, TOKEN_SETUP } from "./ambiente.js";

describe("rotas e tela", () => {
  test("API responde em /api e /api/health", async () => {
    const { chamar } = ambiente();
    const raiz = await chamar("/api/");
    assert.equal(raiz.status, 200);
    assert.equal(raiz.dados.versao, "0.4.0");
    const saude = await chamar("/api/health");
    assert.equal(saude.status, 200);
    assert.equal(saude.dados.banco, "conectado");
  });

  test("endereços fora de /api/ entregam a tela, não a API", async () => {
    const { chamar } = ambiente();
    for (const c of ["/", "/health", "/auth/login", "/index.html"]) {
      const r = await chamar(c);
      assert.equal(r.dados, "TELA", c);
    }
  });

  test("rota desconhecida da API devolve 404 em JSON", async () => {
    const { chamar, criarSupervisor } = ambiente();
    const token = await criarSupervisor();
    const r = await chamar("/api/nao-existe", { token });
    assert.equal(r.status, 404);
    assert.ok(r.dados.erro);
  });

  test("as migrações podem ser aplicadas de novo sem erro e sem mexer nos dados", () => {
    const { env } = ambiente();
    assert.doesNotThrow(() => aplicarMigracoes(env.DB));
    assert.equal(env.DB.raw.prepare("SELECT COUNT(*) n FROM equipamentos").get().n, 16);
  });
});

describe("setup inicial", () => {
  test("exige token e só funciona com banco vazio", async () => {
    const { chamar, criarSupervisor } = ambiente();
    const semToken = await chamar("/api/setup/admin", {
      metodo: "POST", corpo: { r3: "X001", nome: "Alguem" }
    });
    assert.equal(semToken.status, 403);
    await criarSupervisor();
    const denovo = await chamar("/api/setup/admin", {
      metodo: "POST",
      headers: { "x-setup-token": TOKEN_SETUP },
      corpo: { r3: "X002", nome: "Outro" }
    });
    assert.equal(denovo.status, 409);
  });
});

describe("login e troca de senha", () => {
  test("primeiro acesso exige troca e bloqueia as demais rotas", async () => {
    const { chamar, login } = ambiente();
    await chamar("/api/setup/admin", {
      metodo: "POST", headers: { "x-setup-token": TOKEN_SETUP },
      corpo: { r3: "SUP001", nome: "Supervisor Teste" }
    });
    const l = await login("SUP001", "SUP001");
    assert.equal(l.status, 200);
    assert.equal(l.dados.usuario.trocaObrigatoria, true);
    const bloqueada = await chamar("/api/admin/recuperacoes", { token: l.dados.token });
    assert.equal(bloqueada.status, 403);
    const me = await chamar("/api/auth/me", { token: l.dados.token });
    assert.equal(me.status, 200);
  });

  test("recusa senha curta, igual ao R3 e senha atual errada", async () => {
    const { chamar, login } = ambiente();
    await chamar("/api/setup/admin", {
      metodo: "POST", headers: { "x-setup-token": TOKEN_SETUP },
      corpo: { r3: "SUP001", nome: "Supervisor Teste" }
    });
    const { token } = (await login("SUP001", "SUP001")).dados;
    const troca = corpo => chamar("/api/auth/trocar-senha", { metodo: "POST", token, corpo });
    assert.equal((await troca({ senhaAtual: "SUP001", novaSenha: "curta" })).status, 400);
    assert.equal((await troca({ senhaAtual: "SUP001", novaSenha: "SUP001" })).status, 400);
    assert.equal((await troca({ senhaAtual: "errada", novaSenha: "SenhaBoa123" })).status, 403);
  });

  test("troca de senha encerra a sessão antiga", async () => {
    const { chamar, login } = ambiente();
    await chamar("/api/setup/admin", {
      metodo: "POST", headers: { "x-setup-token": TOKEN_SETUP },
      corpo: { r3: "SUP001", nome: "Supervisor Teste" }
    });
    const { token } = (await login("SUP001", "SUP001")).dados;
    await chamar("/api/auth/trocar-senha", {
      metodo: "POST", token, corpo: { senhaAtual: "SUP001", novaSenha: "SenhaBoa123" }
    });
    assert.equal((await chamar("/api/auth/me", { token })).status, 401);
    assert.equal((await login("SUP001", "SUP001")).status, 401);
    assert.equal((await login("SUP001", "SenhaBoa123")).status, 200);
  });

  test("logout revoga o token", async () => {
    const { chamar, criarSupervisor } = ambiente();
    const token = await criarSupervisor();
    assert.equal((await chamar("/api/auth/logout", { metodo: "POST", token })).status, 200);
    assert.equal((await chamar("/api/auth/me", { token })).status, 401);
  });

  test("mensagem de erro não revela se o R3 existe", async () => {
    const { login, criarSupervisor } = ambiente();
    await criarSupervisor();
    const existe = await login("SUP001", "errada123");
    const naoExiste = await login("NINGUEM1", "errada123");
    assert.equal(existe.status, 401);
    assert.deepEqual(existe.dados, naoExiste.dados);
  });
});

describe("limite de tentativas", () => {
  test("5 erros no mesmo R3 bloqueiam por 15 min, mesmo com a senha certa depois", async () => {
    const { login, criarSupervisor } = ambiente();
    await criarSupervisor();
    for (let i = 0; i < 5; i++) {
      assert.equal((await login("SUP001", "errada123")).status, 401);
    }
    assert.equal((await login("SUP001", "Nova-SUP001-senha")).status, 429);
  });

  test("logins certos não contam: 12 entradas seguidas funcionam", async () => {
    const { login, criarSupervisor } = ambiente();
    await criarSupervisor();
    for (let i = 0; i < 12; i++) {
      assert.equal((await login("SUP001", "Nova-SUP001-senha")).status, 200, `entrada ${i + 1}`);
    }
  });

  test("acerto zera os erros anteriores do R3", async () => {
    const { login, criarSupervisor } = ambiente();
    await criarSupervisor();
    for (let i = 0; i < 4; i++) await login("SUP001", "errada123");
    assert.equal((await login("SUP001", "Nova-SUP001-senha")).status, 200);
    for (let i = 0; i < 4; i++) {
      assert.equal((await login("SUP001", "errada123")).status, 401);
    }
  });

  test("vários operadores no mesmo IP não se bloqueiam (início de turno)", async () => {
    const { chamar, login, criarSupervisor } = ambiente();
    const sup = await criarSupervisor();
    // 30 operadores, cada um erra 1 vez e depois acerta, todos do mesmo IP
    for (let i = 0; i < 30; i++) {
      const r3 = `OP${String(i).padStart(3, "0")}`;
      await chamar("/api/usuarios", {
        metodo: "POST", token: sup, corpo: { r3, nome: `Operador Teste ${i}`, perfil: "operador" }
      });
      assert.equal((await login(r3, "errada123", "200.1.1.1")).status, 401);
      assert.equal((await login(r3, r3, "200.1.1.1")).status, 200, r3);
    }
  });

  test("limite por IP ainda segura ataque de muitos erros", async () => {
    const { login } = ambiente();
    let bloqueou = false;
    for (let i = 0; i < 110; i++) {
      const r = await login(`ATQ${i}`, "errada123", "66.6.6.6");
      if (r.status === 429) { bloqueou = true; break; }
    }
    assert.ok(bloqueou, "deveria bloquear após 100 erros do mesmo IP");
  });
});

describe("recuperação de senha e hierarquia", () => {
  async function cenario() {
    const amb = ambiente();
    const { chamar, ativar, criarSupervisor } = amb;
    const sup = await criarSupervisor("SUP001");
    await chamar("/api/usuarios/aprovador", {
      metodo: "POST", token: sup, corpo: { r3: "GER001", nome: "Gerente Teste", perfil: "gerente" }
    });
    await chamar("/api/usuarios/aprovador", {
      metodo: "POST", token: sup, corpo: { r3: "GER002", nome: "Gerente Dois", perfil: "gerente" }
    });
    await chamar("/api/usuarios", {
      metodo: "POST", token: sup, corpo: { r3: "OP001", nome: "Operador Teste", perfil: "operador" }
    });
    const ger = await ativar("GER001");
    await ativar("GER002");
    await ativar("OP001");
    for (const r3 of ["SUP001", "GER001", "GER002", "OP001"]) {
      const r = await chamar("/api/auth/solicitar-recuperacao", { metodo: "POST", corpo: { r3 } });
      assert.equal(r.status, 202);
      assert.match(r.dados.mensagem, /supervisor ou gerente/);
    }
    const todos = amb.env.DB.raw.prepare(`
      SELECT r.id, u.r3 FROM recuperacoes_senha r JOIN usuarios u ON u.id = r.usuario_id
    `).all();
    const pedido = Object.fromEntries(todos.map(p => [p.r3, p.id]));
    const resolver = (token, r3, decisao = "aprovar") =>
      chamar("/api/admin/recuperacoes/resolver", { metodo: "POST", token, corpo: { id: pedido[r3], decisao } });
    return { ...amb, sup, ger, pedido, resolver };
  }

  test("gerente só vê pedidos de quem está abaixo dele", async () => {
    const { chamar, ger } = await cenario();
    const r = await chamar("/api/admin/recuperacoes", { token: ger });
    assert.equal(r.status, 200);
    assert.deepEqual(r.dados.pedidos.map(p => p.r3), ["OP001"]);
  });

  test("supervisor vê pedidos de gerentes e operadores, não o próprio", async () => {
    const { chamar, sup } = await cenario();
    const r = await chamar("/api/admin/recuperacoes", { token: sup });
    assert.deepEqual(r.dados.pedidos.map(p => p.r3).sort(), ["GER001", "GER002", "OP001"]);
  });

  test("gerente não aprova supervisor, outro gerente nem a si mesmo", async () => {
    const { ger, resolver } = await cenario();
    assert.equal((await resolver(ger, "SUP001")).status, 403);
    assert.equal((await resolver(ger, "GER002")).status, 403);
    assert.equal((await resolver(ger, "GER001")).status, 403);
    assert.equal((await resolver(ger, "GER002", "rejeitar")).status, 403);
  });

  test("supervisor não aprova o próprio pedido", async () => {
    const { sup, resolver } = await cenario();
    assert.equal((await resolver(sup, "SUP001")).status, 403);
  });

  test("operador não acessa recuperações", async () => {
    const { chamar, login } = await cenario();
    const op = (await login("OP001", "Nova-OP001-senha")).dados.token;
    assert.equal((await chamar("/api/admin/recuperacoes", { token: op })).status, 403);
  });

  test("após aprovação, a senha provisória funciona e exige nova troca", async () => {
    const { ger, resolver, login, chamar } = await cenario();
    const r = await resolver(ger, "OP001");
    assert.equal(r.status, 200);
    assert.match(r.dados.senhaProvisoria, /^[A-HJ-NP-Z2-9]{10}$/, "provisória curta e fácil de ditar");
    assert.equal((await login("OP001", "Nova-OP001-senha")).status, 401);
    const l = await login("OP001", r.dados.senhaProvisoria);
    assert.equal(l.status, 200);
    assert.equal(l.dados.usuario.trocaObrigatoria, true);
    const t = await chamar("/api/auth/trocar-senha", {
      metodo: "POST", token: l.dados.token,
      corpo: { senhaAtual: r.dados.senhaProvisoria, novaSenha: "OutraSenha456" }
    });
    assert.equal(t.status, 200);
    assert.equal((await login("OP001", "OutraSenha456")).dados.usuario.trocaObrigatoria, false);
    assert.equal((await resolver(ger, "OP001")).status, 404, "pedido não pode ser usado duas vezes");
  });

  test("supervisor aprova pedido de gerente", async () => {
    const { sup, resolver } = await cenario();
    assert.equal((await resolver(sup, "GER001")).status, 200);
  });
});

describe("cadastro de usuários", () => {
  test("gerente não cria supervisor/gerente; operador não cria ninguém", async () => {
    const { chamar, ativar, criarSupervisor } = ambiente();
    const sup = await criarSupervisor();
    await chamar("/api/usuarios/aprovador", {
      metodo: "POST", token: sup, corpo: { r3: "GER001", nome: "Gerente Teste", perfil: "gerente" }
    });
    await chamar("/api/usuarios", {
      metodo: "POST", token: sup, corpo: { r3: "OP001", nome: "Operador Teste", perfil: "operador" }
    });
    const ger = await ativar("GER001");
    const op = await ativar("OP001");
    assert.equal((await chamar("/api/usuarios/aprovador", {
      metodo: "POST", token: ger, corpo: { r3: "GER009", nome: "X Teste", perfil: "gerente" }
    })).status, 403);
    assert.equal((await chamar("/api/usuarios", {
      metodo: "POST", token: ger, corpo: { r3: "SUP009", nome: "X Teste", perfil: "supervisor" }
    })).status, 403);
    assert.equal((await chamar("/api/usuarios", {
      metodo: "POST", token: op, corpo: { r3: "OP009", nome: "X Teste", perfil: "operador" }
    })).status, 403);
    assert.equal((await chamar("/api/usuarios", {
      metodo: "POST", token: ger, corpo: { r3: "OP002", nome: "Operador Dois", perfil: "operador" }
    })).status, 201);
    assert.equal((await chamar("/api/usuarios", {
      metodo: "POST", token: ger, corpo: { r3: "OP002", nome: "Repetido", perfil: "operador" }
    })).status, 409);
  });
});
