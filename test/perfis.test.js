// Perfis: cada um recusado nas rotas que não pode; quem cria quem; limites por plano. Dados fictícios.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { ambiente } from "./ambiente.js";

async function cenario() {
  const amb = ambiente();
  const p = await amb.criarPlataforma();
  const a = await amb.criarBarbearia(p, "alfa");
  const ger = await amb.criarUsuario(a.prop, "ger.alfa", "gerente", { comissaoServicoBp: 4000, comissaoProdutoBp: 1000 });
  const barb = await amb.criarUsuario(ger.token, "barb.alfa", "barbeiro", { comissaoServicoBp: 5000, comissaoProdutoBp: 1000 });
  const cx = await amb.criarUsuario(ger.token, "caixa.alfa", "caixa");
  return { ...amb, p, a, prop: a.prop, ger, barb, cx };
}

describe("cada perfil recusado nas rotas que não pode", () => {
  test("matriz de permissões", async () => {
    const { get, post, p, prop, ger, barb, cx, a } = await cenario();
    const servico = (await post("/api/servicos", ger.token, { nome: "Corte", precoCentavos: 4000, duracaoMin: 30 })).dados.servico;
    const tokens = { plataforma: p, proprietario: prop, gerente: ger.token, barbeiro: barb.token, caixa: cx.token };

    // [método, caminho, corpo, perfis que PODEM]
    const rotas = [
      ["GET", "/api/plataforma/barbearias", undefined, ["plataforma"]],
      ["POST", "/api/plataforma/barbearias/alterar", { id: a.id, nome: "Outro Nome", motivo: "teste de permissão" }, ["plataforma"]],
      ["GET", "/api/usuarios", undefined, ["proprietario", "gerente"]],
      ["GET", "/api/servicos", undefined, ["proprietario", "gerente", "barbeiro", "caixa"]],
      ["POST", "/api/servicos/alterar", { id: servico.id, precoCentavos: 4500 }, ["proprietario", "gerente"]],
      ["GET", "/api/produtos", undefined, ["proprietario", "gerente", "barbeiro", "caixa"]],
      ["GET", "/api/clientes", undefined, ["proprietario", "gerente", "caixa"]],          // caixa = recepção (pedido de 16/11/2026)
      ["GET", "/api/modelos-mensagem", undefined, ["proprietario", "gerente", "caixa"]]
    ];
    let n = 0;
    for (const [metodo, caminho, corpo, podem] of rotas) {
      for (const [perfil, token] of Object.entries(tokens)) {
        const r = metodo === "GET" ? await get(caminho, token) : await post(caminho, token, corpo);
        if (podem.includes(perfil)) {
          assert.equal(r.status, 200, `${perfil} deveria acessar ${metodo} ${caminho}: ${JSON.stringify(r.dados)}`);
          if (metodo === "POST" && caminho.includes("servicos")) {
            await post(caminho, token, { id: servico.id, precoCentavos: 4000 + (++n) });   // muda de novo p/ não dar "nada alterado"
          }
        } else {
          assert.equal(r.status, 403, `${perfil} NÃO deveria acessar ${metodo} ${caminho}`);
        }
      }
    }

    // criação de cadastros: só gestão
    const criacoes = [
      ["/api/servicos", { nome: "Barba X", precoCentavos: 3000, duracaoMin: 20 }],
      ["/api/produtos", { nome: "Pomada X", precoCentavos: 4500 }],
      ["/api/clientes", { nome: "Cliente X", telefone: "11 90000-0001", aceiteLgpd: true }],
      ["/api/modelos-mensagem/alterar", { tipo: "lembrete", texto: "Oi {cliente}, até {data}!" }]
    ];
    // caixa (recepção) cadastra cliente e edita mensagens; serviço e produto continuam só com a gestão
    const recepcao = ["/api/clientes", "/api/modelos-mensagem/alterar"];
    for (const [caminho, corpo] of criacoes) {
      for (const perfil of ["plataforma", "barbeiro", "caixa"]) {
        if (perfil === "caixa" && recepcao.includes(caminho)) continue;
        if (perfil === "barbeiro" && caminho === "/api/clientes") continue;   // 27/11/2026: o barbeiro cadastra cliente novo ao marcar horário (só cria; ver test/cliente-barbeiro.test.js)
        assert.equal((await post(caminho, tokens[perfil], corpo)).status, 403, `${perfil} em ${caminho}`);
      }
    }
  });

  test("plataforma não lê dados de barbearia; barbearia não acessa a plataforma", async () => {
    const { get, post, p, prop } = await cenario();
    assert.equal((await get("/api/servicos", p)).status, 403);
    assert.equal((await post("/api/plataforma/barbearias", prop, { nome: "Pirata", proprietario: { nome: "X Y", login: "pirata" } })).status, 403);
  });

  test("barbeiro e caixa não veem custo nem margem dos produtos", async () => {
    const { env, get, post, ger, barb, cx, prop } = await cenario();
    const prod = (await post("/api/produtos", ger.token, { nome: "Pomada Teste", precoCentavos: 4500 })).dados.produto;
    // simula custo médio (a entrada de mercadoria chega na E3)
    env.DB.raw.prepare("UPDATE produtos SET custo_medio_centavos = 2000 WHERE id = ?").run(prod.id);

    const gestao = (await get("/api/produtos", ger.token)).dados.produtos[0];
    assert.equal(gestao.custoMedioCentavos, 2000);
    assert.equal(gestao.margemBp, 5556);   // (4500 − 2000) ÷ 4500 = 55,56%
    assert.equal((await get("/api/produtos", prop)).dados.produtos[0].margemBp, 5556);

    // sem estoque: indisponível; com entrada de mercadoria: disponível
    assert.equal((await get("/api/produtos", barb.token)).dados.produtos[0].disponivel, false);
    await post("/api/estoque/entrada", ger.token, { produtoId: prod.id, quantidade: 4, custoUnitCentavos: 2000 });
    for (const token of [barb.token, cx.token]) {
      const lista = (await get("/api/produtos", token)).dados.produtos;
      assert.deepEqual(lista, [{ id: prod.id, nome: "Pomada Teste", precoCentavos: 4500, disponivel: true, ...(token === cx.token ? { saldo: 4 } : {}) }]);
      const texto = JSON.stringify(lista);
      assert.ok(!/custo|margem/i.test(texto));
    }
  });

  test("barbeiro e caixa só veem serviços e produtos ativos", async () => {
    const { get, post, ger, barb } = await cenario();
    const s = (await post("/api/servicos", ger.token, { nome: "Pigmentação", precoCentavos: 6000, duracaoMin: 40 })).dados.servico;
    await post("/api/servicos/alterar", ger.token, { id: s.id, ativo: false, motivo: "Não fazemos mais" });
    assert.equal((await get("/api/servicos", barb.token)).dados.servicos.length, 0);
    assert.equal((await get("/api/servicos", ger.token)).dados.servicos.length, 1);
  });
});

describe("quem cria quem", () => {
  test("proprietário cria gerente; gerente não cria gerente; barbeiro/caixa não criam ninguém", async () => {
    const { post, prop, ger, barb, cx } = await cenario();
    const r = await post("/api/usuarios", ger.token, { nome: "Outro Gerente", login: "ger2.alfa", perfil: "gerente" });
    assert.equal(r.status, 403);
    assert.match(r.dados.erro, /proprietário/);
    for (const t of [barb.token, cx.token]) {
      assert.equal((await post("/api/usuarios", t, { nome: "Novo Barbeiro", login: "nb.alfa", perfil: "barbeiro" })).status, 403);
    }
    // ninguém cria proprietário nem plataforma por aqui
    for (const perfil of ["proprietario", "plataforma"]) {
      assert.equal((await post("/api/usuarios", prop, { nome: "X Teste", login: "x.alfa", perfil })).status, 400);
    }
  });

  test("gerente não altera gerente nem proprietário; só o dono edita os próprios dados (e não se desativa)", async () => {
    const { env, post, prop, ger } = await cenario();
    const propId = env.DB.raw.prepare("SELECT id FROM usuarios WHERE login = 'dono.alfa'").get().id;
    assert.equal((await post("/api/usuarios/alterar", ger.token, { id: propId, nome: "Hack" })).status, 403);
    assert.equal((await post("/api/usuarios/alterar", ger.token, { id: ger.id, nome: "Eu Mesmo" })).status, 403);
    assert.equal((await post("/api/usuarios/alterar", prop, { id: propId, nome: "Dono Eu Mesmo", comissaoServicoBp: 5000 })).status, 200, "dono atende: edita nome e comissão dele");
    assert.equal((await post("/api/usuarios/alterar", prop, { id: propId, ativo: false, motivo: "teste" })).status, 403, "dono não se desativa");
    assert.equal((await post("/api/usuarios/redefinir-senha", ger.token, { id: propId, motivo: "teste" })).status, 403);
    // proprietário altera gerente
    assert.equal((await post("/api/usuarios/alterar", prop, { id: ger.id, comissaoServicoBp: 4500 })).status, 200);
  });

  test("desativar exige motivo, derruba a sessão e impede login", async () => {
    const { post, get, login, ger, barb } = await cenario();
    assert.equal((await post("/api/usuarios/alterar", ger.token, { id: barb.id, ativo: false })).status, 400);
    const r = await post("/api/usuarios/alterar", ger.token, { id: barb.id, ativo: false, motivo: "Saiu da barbearia" });
    assert.equal(r.status, 200);
    assert.equal(r.dados.usuario.ativo, false);
    assert.equal(r.dados.usuario.motivoDesativacao, "Saiu da barbearia");
    assert.equal((await get("/api/servicos", barb.token)).status, 401);
    assert.equal((await login("barb.alfa", "Nova-barb.alfa-senha")).status, 401);
  });

  test("redefinir senha gera provisória com troca obrigatória", async () => {
    const { post, login, ger, barb } = await cenario();
    const r = await post("/api/usuarios/redefinir-senha", ger.token, { id: barb.id, motivo: "Esqueceu a senha" });
    assert.equal(r.status, 200);
    assert.match(r.dados.senhaProvisoria, /^[A-HJ-NP-Z2-9]{10}$/);
    assert.equal((await login("barb.alfa", "Nova-barb.alfa-senha")).status, 401);
    assert.equal((await login("barb.alfa", r.dados.senhaProvisoria)).dados.usuario.trocaObrigatoria, true);
  });

  test("usuário de acesso repetido é recusado (em qualquer barbearia)", async () => {
    const { post, p, prop } = await cenario();
    const b = await post("/api/plataforma/barbearias", p, { nome: "Barbearia Beta", proprietario: { nome: "Dono Beta", login: "barb.alfa" } });
    assert.equal(b.status, 409);
    assert.equal((await post("/api/usuarios", prop, { nome: "Repetido", login: "ger.alfa", perfil: "barbeiro" })).status, 409);
  });
});

describe("limite de usuários por plano (conferido no servidor)", () => {
  test("Básico: 2 barbeiros; gerentes e caixas sem limite; desativar libera a vaga", async () => {
    const { post, get, prop, ger, barb } = await cenario();   // já tem 1 gerente, 1 barbeiro, 1 caixa
    assert.equal((await post("/api/usuarios", prop, { nome: "Gerente Dois", login: "ger2.alfa", perfil: "gerente" })).status, 201);
    assert.equal((await post("/api/usuarios", ger.token, { nome: "Caixa Dois", login: "cx2.alfa", perfil: "caixa" })).status, 201);
    assert.equal((await post("/api/usuarios", ger.token, { nome: "Caixa Tres", login: "cx3.alfa", perfil: "caixa" })).status, 201);
    assert.equal((await post("/api/usuarios", ger.token, { nome: "Barbeiro Dois", login: "b2.alfa", perfil: "barbeiro" })).status, 201);
    const terceiro = await post("/api/usuarios", ger.token, { nome: "Barbeiro Tres", login: "b3.alfa", perfil: "barbeiro" });
    assert.equal(terceiro.status, 409);
    assert.match(terceiro.dados.erro, /Limite do plano/);

    const v = (await get("/api/usuarios", ger.token)).dados.vagas;
    assert.deepEqual(v, { gerente: { ativos: 2, limite: null }, barbeiro: { ativos: 2, limite: 2 }, caixa: { ativos: 3, limite: null } });

    // desativa um → vaga liberada → cria o 3º
    await post("/api/usuarios/alterar", ger.token, { id: barb.id, ativo: false, motivo: "Saiu" });
    assert.equal((await post("/api/usuarios", ger.token, { nome: "Barbeiro Tres", login: "b3.alfa", perfil: "barbeiro" })).status, 201);
    // reativar o antigo esbarra no limite
    const re = await post("/api/usuarios/alterar", ger.token, { id: barb.id, ativo: true, motivo: "Voltou" });
    assert.equal(re.status, 409);
  });

  test("Standard: 4 barbeiros; Pro: 10 barbeiros (+ adicionais)", async () => {
    const { post, get, criarPlataforma, criarBarbearia } = ambiente();
    const p = await criarPlataforma();
    const s = await criarBarbearia(p, "std", "standard");
    for (let i = 1; i <= 4; i++) assert.equal((await post("/api/usuarios", s.prop, { nome: `Pessoa s${i}`, login: `b${i}.std`, perfil: "barbeiro" })).status, 201);
    assert.equal((await post("/api/usuarios", s.prop, { nome: "Pessoa s5", login: "b5.std", perfil: "barbeiro" })).status, 409);

    const b = await criarBarbearia(p, "pro", "pro");
    const criar = (login, perfil) => post("/api/usuarios", b.prop, { nome: `Pessoa ${login}`, login, perfil });
    for (let i = 1; i <= 3; i++) assert.equal((await criar(`g${i}.pro`, "gerente")).status, 201);
    for (let i = 1; i <= 3; i++) assert.equal((await criar(`c${i}.pro`, "caixa")).status, 201);
    for (let i = 1; i <= 10; i++) assert.equal((await criar(`b${i}.pro`, "barbeiro")).status, 201);
    assert.equal((await criar("b11.pro", "barbeiro")).status, 409);

    // plataforma libera 2 barbeiros adicionais
    assert.equal((await post("/api/plataforma/barbearias/alterar", p, { id: b.id, barbeirosAdicionais: 2, motivo: "Contratou 2 adicionais" })).status, 200);
    const me = await get("/api/usuarios", b.prop);
    assert.deepEqual(me.dados.vagas.barbeiro, { ativos: 10, limite: 12 }, "vale na hora, sem sair e entrar");
    const t = b.prop;
    assert.equal((await post("/api/usuarios", t, { nome: "Barbeiro Onze", login: "b11.pro", perfil: "barbeiro" })).status, 201);
    assert.equal((await post("/api/usuarios", t, { nome: "Barbeiro Doze", login: "b12.pro", perfil: "barbeiro" })).status, 201);
    assert.equal((await post("/api/usuarios", t, { nome: "Barbeiro Treze", login: "b13.pro", perfil: "barbeiro" })).status, 409);

    // voltar para o Básico com 12 barbeiros ativos é recusado
    const desce = await post("/api/plataforma/barbearias/alterar", p, { id: b.id, plano: "basico", motivo: "Pediu downgrade" });
    assert.equal(desce.status, 409);
  });
});
