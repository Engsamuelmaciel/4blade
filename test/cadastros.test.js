// Validações dos cadastros (seção 3) + "nada é apagado" + auditoria antes/depois + painel da plataforma. Dados fictícios.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { ambiente } from "./ambiente.js";

async function cenario() {
  const amb = ambiente();
  const p = await amb.criarPlataforma();
  const a = await amb.criarBarbearia(p, "alfa");
  const ger = await amb.criarUsuario(a.prop, "ger.alfa", "gerente");
  return { ...amb, p, a, ger: ger.token, gerId: ger.id };
}

describe("serviços", () => {
  test("validações", async () => {
    const { post, ger } = await cenario();
    const casos = [
      [{}, /nome/],
      [{ nome: "C", precoCentavos: 100, duracaoMin: 30 }, /nome/],
      [{ nome: "Corte", duracaoMin: 30 }, /Preço/],
      [{ nome: "Corte", precoCentavos: 40.5, duracaoMin: 30 }, /centavos/],
      [{ nome: "Corte", precoCentavos: "4000", duracaoMin: 30 }, /centavos/],
      [{ nome: "Corte", precoCentavos: -1, duracaoMin: 30 }, /centavos/],
      [{ nome: "Corte", precoCentavos: 4000 }, /Duração/],
      [{ nome: "Corte", precoCentavos: 4000, duracaoMin: 2 }, /Duração/],
      [{ nome: "Corte", precoCentavos: 4000, duracaoMin: 600 }, /Duração/]
    ];
    for (const [corpo, msg] of casos) {
      const r = await post("/api/servicos", ger, corpo);
      assert.equal(r.status, 400, JSON.stringify(corpo));
      assert.match(r.dados.erro, msg);
    }
    const ok = await post("/api/servicos", ger, { nome: "  Corte   masculino ", precoCentavos: 4000, duracaoMin: 30 });
    assert.equal(ok.status, 201);
    assert.equal(ok.dados.servico.nome, "Corte masculino");
    assert.equal(ok.dados.servico.precoCentavos, 4000);
    assert.equal((await post("/api/servicos", ger, { nome: "CORTE MASCULINO", precoCentavos: 1, duracaoMin: 30 })).status, 409);
  });

  test("desativar exige motivo e não apaga; alteração auditada com antes/depois", async () => {
    const { env, post, get, ger, gerId } = await cenario();
    const s = (await post("/api/servicos", ger, { nome: "Barba", precoCentavos: 3000, duracaoMin: 20 })).dados.servico;
    assert.equal((await post("/api/servicos/alterar", ger, { id: s.id, ativo: false })).status, 400);
    assert.equal((await post("/api/servicos/alterar", ger, { id: s.id })).status, 400, "nada alterado");
    const p = await post("/api/servicos/alterar", ger, { id: s.id, precoCentavos: 3500 });
    assert.equal(p.status, 200);
    const d = await post("/api/servicos/alterar", ger, { id: s.id, ativo: false, motivo: "Fora do cardápio" });
    assert.equal(d.dados.servico.ativo, false);
    assert.equal(d.dados.servico.motivoDesativacao, "Fora do cardápio");
    assert.equal((await get("/api/servicos", ger)).dados.servicos.length, 1, "continua na lista do gerente");
    assert.equal(env.DB.raw.prepare("SELECT COUNT(*) n FROM servicos").get().n, 1);

    const aud = env.DB.raw.prepare("SELECT acao, usuario_id, detalhes FROM auditoria WHERE alvo = ? ORDER BY id").all(s.id);
    assert.deepEqual(aud.map(x => x.acao), ["servico_criado", "servico_alterado", "servico_desativado"]);
    assert.ok(aud.every(x => x.usuario_id === gerId));
    assert.deepEqual(JSON.parse(aud[1].detalhes), { motivo: null, antes: { preco_centavos: 3000 }, depois: { preco_centavos: 3500 } });
    assert.deepEqual(JSON.parse(aud[2].detalhes), { motivo: "Fora do cardápio", antes: { ativo: 1 }, depois: { ativo: 0 } });

    // reativar
    const re = await post("/api/servicos/alterar", ger, { id: s.id, ativo: true });
    assert.equal(re.dados.servico.ativo, true);
    assert.equal(re.dados.servico.motivoDesativacao, null);
  });
});

describe("produtos", () => {
  test("validações e campos", async () => {
    const { post, ger } = await cenario();
    const ruins = [
      [{ precoCentavos: 100 }, /nome/],
      [{ nome: "Pomada" }, /Preço/],
      [{ nome: "Pomada", precoCentavos: 100, codigo: "abc def" }, /Código/],
      [{ nome: "Pomada", precoCentavos: 100, validade: "31/12/2026" }, /Validade/],
      [{ nome: "Pomada", precoCentavos: 100, validade: "2026-02-30" }, /Validade/],
      [{ nome: "Pomada", precoCentavos: 100, estoqueMinimo: -1 }, /Estoque mínimo/],
      [{ nome: "Pomada", precoCentavos: 100, mostrarSite: "sim" }, /site/]
    ];
    for (const [corpo, msg] of ruins) {
      const r = await post("/api/produtos", ger, corpo);
      assert.equal(r.status, 400, JSON.stringify(corpo));
      assert.match(r.dados.erro, msg);
    }
    const ok = await post("/api/produtos", ger, {
      nome: "Pomada Modeladora", codigo: "7891234567890", precoCentavos: 4500, validade: "2027-06-30", estoqueMinimo: 3, mostrarSite: true
    });
    assert.equal(ok.status, 201);
    assert.deepEqual(ok.dados.produto, {
      id: ok.dados.produto.id, nome: "Pomada Modeladora", codigo: "7891234567890", precoCentavos: 4500,
      custoMedioCentavos: 0, margemBp: null, validade: "2027-06-30", estoqueMinimo: 3, mostrarSite: true,
      saldo: 0, usoInterno: false, ativo: true, motivoDesativacao: null
    });
    assert.equal((await post("/api/produtos", ger, { nome: "Outro", codigo: "7891234567890", precoCentavos: 100 })).status, 409);
    // sem código: vários produtos podem ficar sem código
    assert.equal((await post("/api/produtos", ger, { nome: "Shampoo", precoCentavos: 3000 })).status, 201);
    assert.equal((await post("/api/produtos", ger, { nome: "Óleo de barba", precoCentavos: 3500 })).status, 201);
    // limpar validade
    const lim = await post("/api/produtos/alterar", ger, { id: ok.dados.produto.id, validade: null });
    assert.equal(lim.dados.produto.validade, null);
  });
});

describe("clientes", () => {
  test("telefone obrigatório e válido, aceite LGPD obrigatório, telefone único", async () => {
    const { env, post, get, ger, gerId } = await cenario();
    const ruins = [
      [{ nome: "João Teste", aceiteLgpd: true }, /Telefone/],
      [{ nome: "João Teste", telefone: "1234", aceiteLgpd: true }, /Telefone/],
      [{ nome: "João Teste", telefone: "11 91234-5678" }, /LGPD/],
      [{ nome: "João Teste", telefone: "11 91234-5678", aceiteLgpd: false }, /LGPD/],
      [{ nome: "João Teste", telefone: "11 91234-5678", aceiteLgpd: true, observacao: "x".repeat(501) }, /Observação/]
    ];
    for (const [corpo, msg] of ruins) {
      const r = await post("/api/clientes", ger, corpo);
      assert.equal(r.status, 400, JSON.stringify(corpo));
      assert.match(r.dados.erro, msg);
    }
    const ok = await post("/api/clientes", ger, { nome: "João Teste", telefone: "+55 (11) 91234-5678", aceiteLgpd: true, observacao: "Prefere máquina 2" });
    assert.equal(ok.status, 201);
    assert.equal(ok.dados.cliente.telefone, "11912345678");
    assert.ok(ok.dados.cliente.aceiteLgpdEm);
    assert.equal(env.DB.raw.prepare("SELECT aceite_lgpd_por FROM clientes").get().aceite_lgpd_por, gerId);
    assert.equal((await post("/api/clientes", ger, { nome: "Outro Nome", telefone: "11912345678", aceiteLgpd: true })).status, 409);
    assert.equal((await get("/api/clientes?busca=joão", ger)).dados.clientes.length, 1);
    assert.equal((await get("/api/clientes?busca=91234", ger)).dados.clientes.length, 1);
  });
});

describe("modelos de mensagem", () => {
  test("barbearia nasce com os modelos (confirmação, lembrete, proposta); só aceita os campos conhecidos", async () => {
    const { post, get, ger } = await cenario();
    const m = (await get("/api/modelos-mensagem", ger)).dados;
    assert.deepEqual(m.modelos.map(x => x.tipo), ["confirmacao", "lembrete", "proposta"]);
    assert.deepEqual(m.campos, ["cliente", "data", "hora", "barbeiro", "servico", "barbearia"]);
    assert.match((await post("/api/modelos-mensagem/alterar", ger, { tipo: "lembrete", texto: "Oi {nome}, tudo bem?" })).dados.erro, /\{nome\} não existe/);
    assert.equal((await post("/api/modelos-mensagem/alterar", ger, { tipo: "lembrete", texto: "curto" })).status, 400);
    assert.equal((await post("/api/modelos-mensagem/alterar", ger, { tipo: "outro", texto: "Oi {cliente} tudo bem" })).status, 400);
    const ok = await post("/api/modelos-mensagem/alterar", ger, { tipo: "proposta", texto: "Fala {cliente}! Tem vaga {data} {hora} com {barbeiro}." });
    assert.equal(ok.status, 200);
    const volta = await post("/api/modelos-mensagem/alterar", ger, { tipo: "proposta", restaurarPadrao: true });
    assert.match(volta.dados.modelo.texto, /Podemos confirmar/);
  });
});

describe("equipe: comissões em centésimos de %", () => {
  test("comissão de 0% a 100% só para quem atende; caixa fica com 0", async () => {
    const { post, a } = await cenario();
    assert.equal((await post("/api/usuarios", a.prop, { nome: "Barbeiro X", login: "bx.alfa", perfil: "barbeiro", comissaoServicoBp: 10001 })).status, 400);
    assert.equal((await post("/api/usuarios", a.prop, { nome: "Barbeiro X", login: "bx.alfa", perfil: "barbeiro", comissaoServicoBp: 37.5 })).status, 400);
    const b = await post("/api/usuarios", a.prop, { nome: "Barbeiro X", login: "bx.alfa", perfil: "barbeiro", comissaoServicoBp: 3750, comissaoProdutoBp: 1000, telefone: "11 95555-4444" });
    assert.equal(b.dados.usuario.comissaoServicoBp, 3750);
    assert.equal(b.dados.usuario.telefone, "11955554444");
    const c = await post("/api/usuarios", a.prop, { nome: "Caixa X", login: "cx.alfa", perfil: "caixa", comissaoServicoBp: 5000 });
    assert.equal(c.dados.usuario.comissaoServicoBp, 0);
  });

  test("login inválido e nome curto são recusados", async () => {
    const { post, a } = await cenario();
    for (const login of ["ab", "com espaço", "Ác.ento", "-comeca"]) {
      assert.equal((await post("/api/usuarios", a.prop, { nome: "Fulano Teste", login, perfil: "barbeiro" })).status, 400, login);
    }
    assert.equal((await post("/api/usuarios", a.prop, { nome: "F", login: "fulano", perfil: "barbeiro" })).status, 400);
  });
});

describe("painel da plataforma", () => {
  test("cria barbearia com proprietário, lista, muda plano e redefine senha do proprietário", async () => {
    const { post, get, login, p, a } = await cenario();
    assert.equal((await post("/api/plataforma/barbearias", p, { nome: "X", proprietario: { nome: "Dono X", login: "dono.x" } })).status, 400);
    assert.equal((await post("/api/plataforma/barbearias", p, { nome: "Barbearia X", plano: "ouro", proprietario: { nome: "Dono X", login: "dono.x" } })).status, 400);
    assert.equal((await post("/api/plataforma/barbearias", p, { nome: "Barbearia X", proprietario: { nome: "Dono X", login: "x" } })).status, 400);

    const lista = (await get("/api/plataforma/barbearias", p)).dados.barbearias;
    assert.equal(lista.length, 1);
    assert.equal(lista[0].plano, "basico");
    assert.deepEqual({ ...lista[0].proprietario, id: undefined }, { id: undefined, nome: "Dono alfa", login: "dono.alfa", telefone: null, trocaPendente: false });
    assert.deepEqual(lista[0].usuariosAtivos, { gerente: 1, barbeiro: 0, caixa: 0 });

    assert.equal((await post("/api/plataforma/barbearias/alterar", p, { id: a.id, plano: "profissional", motivo: "plano antigo" })).status, 400);
    const sobe = await post("/api/plataforma/barbearias/alterar", p, { id: a.id, plano: "pro", motivo: "Contratou o Pro" });
    assert.equal(sobe.dados.barbearia.plano, "pro");
    assert.equal(sobe.dados.barbearia.assinatura.valorCentavos, 14990);
    assert.equal(sobe.dados.barbearia.assinatura.situacao, "manual");
    assert.equal((await post("/api/plataforma/barbearias/alterar", p, { id: a.id, plano: "pro", motivo: "de novo" })).status, 400);

    const rs = await post("/api/plataforma/barbearias/redefinir-senha", p, { id: a.id, motivo: "Proprietário esqueceu a senha" });
    assert.equal(rs.status, 200);
    assert.equal(rs.dados.login, "dono.alfa");
    assert.equal((await login("dono.alfa", rs.dados.senhaProvisoria)).dados.usuario.trocaObrigatoria, true);
  });
});
