// Planos, cadastro pela própria barbearia (Assinar) e cobrança pelo Asaas (Asaas DE MENTIRA, test/asaas-falso.mjs).
// Dados fictícios: CPF/CNPJ gerados aqui só com dígitos verificadores válidos.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { ambiente } from "./ambiente.js";
import { hojeBrasil } from "../src/util.js";
import { situacaoAssinatura, somaMeses, somaDias, coberturaDoPagamento, normalizarDocumento } from "../src/assinatura.js";
import { valorDoPlano, limiteDoPerfil } from "../src/perfis.js";

function gerarCpf(base9) {
  const d = base9.split("").map(Number);
  for (const t of [9, 10]) {
    let s = 0;
    for (let i = 0; i < t; i++) s += d[i] * (t + 1 - i);
    d.push(((s * 10) % 11) % 10);
  }
  return d.join("");
}
function gerarCnpj(base12) {
  const d = base12.split("").map(Number);
  for (const pesos of [[5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2], [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]]) {
    const r = pesos.reduce((t, p, i) => t + d[i] * p, 0) % 11;
    d.push(r < 2 ? 0 : 11 - r);
  }
  return d.join("");
}
const CPF_A = gerarCpf("123456780");
const CPF_B = gerarCpf("987654320");
const CNPJ = gerarCnpj("112223330001");

const dados = (extra = {}) => ({
  plano: "standard", ciclo: "mensal", barbearia: "Barbearia Navalha Teste", nome: "Pessoa Dona Teste",
  documento: CPF_A, telefone: "(11) 90000-0001", email: "dono@exemplo.test", login: "dono.navalha",
  senha: "Senha-forte-2026", aceiteTermos: true, ...extra
});

async function assinar(amb, extra = {}) {
  const r = await amb.chamar("/api/assinar", { metodo: "POST", corpo: dados(extra), ip: extra.ip || "10.1.1.1" });
  assert.equal(r.status, 201, JSON.stringify(r.dados));
  const l = await amb.login(r.dados.login, extra.senha || "Senha-forte-2026");
  assert.equal(l.status, 200, JSON.stringify(l.dados));
  const sub = [...amb.asaas.estado.assinaturas.values()].at(-1);
  return { r: r.dados, token: l.dados.token, usuario: l.dados.usuario, sub };
}

// Muda o "pago até" direto no banco para simular o tempo passando.
const pagoAte = (amb, barbeariaId, data, extra = "") =>
  amb.env.DB.prepare(`UPDATE assinaturas SET pago_ate = ? ${extra} WHERE barbearia_id = ?`).bind(data, barbeariaId).run();

describe("planos e regras de data", () => {
  test("preços, limites e situação", () => {
    assert.equal(valorDoPlano("basico"), 7900);
    assert.equal(valorDoPlano("standard"), 10990);
    assert.equal(valorDoPlano("pro"), 14990);
    assert.equal(valorDoPlano("standard", "anual"), 109900);
    assert.equal(limiteDoPerfil({ plano: "basico" }, "barbeiro"), 2);
    assert.equal(limiteDoPerfil({ plano: "standard" }, "barbeiro"), 4);
    assert.equal(limiteDoPerfil({ plano: "pro", barbeiros_adicionais: 3 }, "barbeiro"), 13);
    assert.equal(limiteDoPerfil({ plano: "standard", barbeiros_adicionais: 3 }, "barbeiro"), 4);

    assert.equal(somaMeses("2026-01-31", 1), "2026-02-28");
    assert.equal(somaMeses("2026-11-30", 3), "2027-02-28");
    assert.equal(coberturaDoPagamento("2026-12-01", "mensal"), "2026-12-31");
    assert.equal(coberturaDoPagamento("2026-12-01", "anual"), "2027-11-30");

    const base = { origem: "asaas", teste_ate: "2026-11-29", pago_ate: "2026-11-29", cancelada: 0 };
    assert.equal(situacaoAssinatura(base, "2026-11-20").situacao, "teste");
    assert.equal(situacaoAssinatura(base, "2026-11-29").diasRestantes, 1);
    assert.deepEqual(situacaoAssinatura(base, "2026-12-01"), { situacao: "atrasada", bloqueada: false, diasAtraso: 2, diasParaBloqueio: 4, pagoAte: "2026-11-29" });
    assert.equal(situacaoAssinatura(base, "2026-12-04").bloqueada, false, "5º dia de atraso ainda entra");
    assert.equal(situacaoAssinatura(base, "2026-12-05").situacao, "bloqueada");
    assert.equal(situacaoAssinatura({ ...base, ultimo_pagamento_em: "x", pago_ate: "2026-12-29" }, "2026-12-05").situacao, "em_dia");
    assert.equal(situacaoAssinatura({ ...base, cancelada: 1 }, "2026-11-30").situacao, "cancelada", "cancelada: sem tolerância");
    assert.equal(situacaoAssinatura({ origem: "manual" }, "2030-01-01").bloqueada, false);
    assert.equal(situacaoAssinatura(null).situacao, "manual");

    assert.equal(normalizarDocumento(CPF_A.replace(/(\d{3})(\d{3})(\d{3})/, "$1.$2.$3-")), CPF_A);
    assert.equal(normalizarDocumento(CNPJ), CNPJ);
    assert.equal(normalizarDocumento("111.111.111-11"), null);
    assert.equal(normalizarDocumento(CPF_A.slice(0, 10) + ((Number(CPF_A[10]) + 1) % 10)), null);
  });
});

describe("página de planos e Assinar (sem login)", () => {
  test("lista os planos com preços vindos do servidor", async () => {
    const amb = ambiente();
    const r = await amb.get("/api/planos");
    assert.equal(r.status, 200);
    assert.deepEqual(r.dados.planos.map(p => [p.id, p.barbeiros, p.mensalCentavos, p.anualCentavos]),
      [["basico", 2, 7900, 79000], ["standard", 4, 10990, 109900], ["pro", 10, 14990, 149900]]);
    assert.equal(r.dados.testeDias, 14);
    assert.equal(r.dados.assinaturaDisponivel, true);
  });

  test("recusa dados inválidos sem criar nada", async () => {
    const amb = ambiente();
    const tenta = (extra, ip = "10.2.0.1") => amb.chamar("/api/assinar", { metodo: "POST", corpo: dados(extra), ip });
    assert.equal((await tenta({ plano: "ouro" })).status, 400);
    assert.match((await tenta({ documento: "123.456.789-00" })).dados.erro, /CPF ou CNPJ/);
    assert.match((await tenta({ aceiteTermos: false }, "10.2.0.2")).dados.erro, /termos/);
    assert.match((await tenta({ senha: "curta" }, "10.2.0.2")).dados.erro, /senha/);
    assert.match((await tenta({ email: "sem-arroba" }, "10.2.0.2")).dados.erro, /E-mail/);
    assert.match((await tenta({ telefone: "123" }, "10.2.0.3")).dados.erro, /WhatsApp/);
    assert.equal(amb.asaas.estado.chamadas.length, 0, "nada foi enviado ao Asaas");
    const n = await amb.env.DB.prepare("SELECT COUNT(*) AS n FROM barbearias").first();
    assert.equal(Number(n.n), 0);
  });

  test("limite de 5 cadastros por hora no mesmo aparelho", async () => {
    const amb = ambiente();
    for (let i = 0; i < 5; i++) await amb.chamar("/api/assinar", { metodo: "POST", corpo: dados({ plano: "x" }), ip: "10.3.0.1" });
    assert.equal((await amb.chamar("/api/assinar", { metodo: "POST", corpo: dados(), ip: "10.3.0.1" })).status, 429);
  });

  test("assina: barbearia criada com 14 dias grátis, dono entra com a senha que escolheu, Asaas recebe cliente e assinatura", async () => {
    const amb = ambiente();
    const { r, usuario, token, sub } = await assinar(amb, { documento: CPF_A.replace(/(\d{3})(\d{3})(\d{3})/, "$1.$2.$3-") });
    const hoje = hojeBrasil();
    assert.equal(r.testeAte, somaDias(hoje, 13));
    assert.equal(r.primeiroVencimento, somaDias(hoje, 14));
    assert.equal(r.valorCentavos, 10990);
    assert.match(r.linkPagamento, /^https:\/\/sandbox\.asaas\.com\/i\//);

    assert.equal(usuario.trocaObrigatoria, false, "a senha foi escolhida por ele");
    assert.equal(usuario.perfil, "proprietario");
    assert.deepEqual(usuario.barbearia, { nome: "Barbearia Navalha Teste", plano: "standard" });
    assert.equal(usuario.assinatura.situacao, "teste");
    assert.equal(usuario.assinatura.diasRestantes, 14);

    const cli = [...amb.asaas.estado.clientes.values()][0];
    assert.equal(cli.cpfCnpj, CPF_A);
    assert.equal(cli.mobilePhone, "11900000001");
    assert.equal(sub.value, 109.9);
    assert.equal(sub.cycle, "MONTHLY");
    assert.equal(sub.billingType, "UNDEFINED");
    assert.equal(sub.nextDueDate, somaDias(hoje, 14));
    assert.equal(sub.externalReference, r.barbearia.id);
    assert.ok(amb.asaas.estado.chamadas.every(c => c.chave === "chave-falsa-de-teste"));

    // já usa o sistema: cria barbeiros até o limite do Standard (4)
    for (let i = 1; i <= 4; i++) assert.equal((await amb.post("/api/usuarios", token, { nome: `Barbeiro ${i}`, login: `b${i}.navalha`, perfil: "barbeiro" })).status, 201);
    assert.equal((await amb.post("/api/usuarios", token, { nome: "Barbeiro 5", login: "b5.navalha", perfil: "barbeiro" })).status, 409);

    const a = await amb.get("/api/assinatura", token);
    assert.equal(a.status, 200);
    assert.equal(a.dados.assinatura.nomePlano, "Standard");
    assert.equal(a.dados.assinatura.linkPagamento, r.linkPagamento);
    assert.equal(a.dados.podeCancelar, true);

    // aceite dos termos e auditoria guardados
    const linha = await amb.env.DB.prepare("SELECT termos_versao, termos_aceitos_em, documento FROM assinaturas WHERE barbearia_id = ?").bind(r.barbearia.id).first();
    assert.equal(linha.termos_versao, "2026-11-16");
    assert.ok(linha.termos_aceitos_em);
    const aud = await amb.env.DB.prepare("SELECT acao FROM auditoria WHERE barbearia_id = ? AND acao = 'barbearia_assinou'").bind(r.barbearia.id).first();
    assert.ok(aud);
  });

  test("anual, CNPJ e plano Pro", async () => {
    const amb = ambiente();
    const { r, sub } = await assinar(amb, { plano: "pro", ciclo: "anual", documento: CNPJ, login: "dono.pro" });
    assert.equal(r.valorCentavos, 149900);
    assert.equal(sub.value, 1499);
    assert.equal(sub.cycle, "YEARLY");
  });

  test("mesmo CPF/CNPJ ou mesmo usuário: recusado", async () => {
    const amb = ambiente();
    await assinar(amb);
    const r1 = await amb.chamar("/api/assinar", { metodo: "POST", corpo: dados({ login: "outro.login" }), ip: "10.4.0.1" });
    assert.equal(r1.status, 409);
    assert.match(r1.dados.erro, /CPF\/CNPJ/);
    const r2 = await amb.chamar("/api/assinar", { metodo: "POST", corpo: dados({ documento: CPF_B }), ip: "10.4.0.1" });
    assert.equal(r2.status, 409);
    assert.match(r2.dados.erro, /usuário já existe/);
  });

  test("Asaas fora do ar: nada é criado e a pessoa é avisada", async () => {
    const amb = ambiente();
    amb.asaas.estado.falhar = 500;
    const r = await amb.chamar("/api/assinar", { metodo: "POST", corpo: dados(), ip: "10.5.0.1" });
    assert.equal(r.status, 502);
    assert.match(r.dados.erro, /sistema de pagamento/);
    assert.equal(Number((await amb.env.DB.prepare("SELECT COUNT(*) AS n FROM usuarios").first()).n), 0);
  });

  test("sem a chave do Asaas configurada: assinatura on-line indisponível", async () => {
    const amb = ambiente();
    delete amb.env.ASAAS_API_KEY;
    assert.equal((await amb.get("/api/planos")).dados.assinaturaDisponivel, false);
    const r = await amb.chamar("/api/assinar", { metodo: "POST", corpo: dados(), ip: "10.6.0.1" });
    assert.equal(r.status, 503);
  });
});

describe("avisos do Asaas (webhook)", () => {
  test("senha errada é recusada; pagamento confirmado estende o acesso; aviso repetido não conta 2 vezes", async () => {
    const amb = ambiente();
    const { r, token, sub } = await assinar(amb);
    const ev = amb.asaas.pagar(sub.id);
    assert.equal((await amb.webhook(ev.pago, "senha-errada")).status, 401);
    assert.equal((await amb.webhook(ev.pago, null)).status, 401);

    assert.equal((await amb.webhook(ev.pago)).status, 200);
    const venc = somaDias(hojeBrasil(), 14);
    const ate = coberturaDoPagamento(venc, "mensal");
    let a = (await amb.get("/api/assinatura", token)).dados;
    assert.equal(a.assinatura.situacao, "em_dia");
    assert.equal(a.assinatura.pagoAte, ate);
    assert.equal(a.pagamentos.length, 1);
    assert.equal(a.pagamentos[0].valorCentavos, 10990);

    const rep = await amb.webhook(ev.pago);
    assert.equal(rep.dados.repetido, true);
    // a nova cobrança (próximo mês) vira o link de pagamento
    await amb.webhook(ev.criada);
    a = (await amb.get("/api/assinatura", token)).dados;
    assert.equal(a.assinatura.linkPagamento, ev.criada.payment.invoiceUrl);
    assert.equal(a.assinatura.proximoVencimento, ev.criada.payment.dueDate);
    assert.equal(a.pagamentos.length, 1);
    const aud = await amb.env.DB.prepare("SELECT COUNT(*) AS n FROM auditoria WHERE acao = 'assinatura_paga' AND barbearia_id = ?").bind(r.barbearia.id).first();
    assert.equal(Number(aud.n), 1);
  });

  test("aviso falso de pagamento (cobrança ainda em aberto no Asaas) é ignorado", async () => {
    const amb = ambiente();
    const { token, sub } = await assinar(amb);
    const aberta = [...amb.asaas.estado.pagamentos.values()].find(p => p.subscription === sub.id);
    const r = await amb.webhook({ id: "evt_falso_1", event: "PAYMENT_RECEIVED", payment: { ...aberta, status: "RECEIVED" } });
    assert.equal(r.status, 200);
    assert.equal((await amb.get("/api/assinatura", token)).dados.assinatura.situacao, "teste");
    const e = await amb.env.DB.prepare("SELECT resultado FROM assinatura_eventos WHERE id = 'evt_falso_1'").first();
    assert.equal(e.resultado, "ignorado_nao_confirmado");
  });

  test("aviso de assinatura que não é nossa fica registrado sem efeito", async () => {
    const amb = ambiente();
    const r = await amb.webhook({ id: "evt_x", event: "PAYMENT_RECEIVED", payment: { id: "pay_x", subscription: "sub_de_outro" } });
    assert.equal(r.status, 200);
    const e = await amb.env.DB.prepare("SELECT barbearia_id, resultado FROM assinatura_eventos WHERE id = 'evt_x'").first();
    assert.deepEqual({ ...e }, { barbearia_id: null, resultado: "ignorado_sem_barbearia" });
  });
});

describe("atraso, bloqueio e cancelamento", () => {
  test("atrasada: aviso; depois de 5 dias: equipe fora e dono só na assinatura; pagou: libera", async () => {
    const amb = ambiente();
    const { r, token, sub } = await assinar(amb);
    const id = r.barbearia.id;
    const barb = await amb.criarUsuario(token, "barb.atraso", "barbeiro");
    const hoje = hojeBrasil();

    await pagoAte(amb, id, somaDias(hoje, -3));
    let me = (await amb.get("/api/auth/me", token)).dados.usuario;
    assert.equal(me.assinatura.situacao, "atrasada");
    assert.equal(me.assinatura.diasParaBloqueio, 3);
    assert.equal((await amb.get("/api/servicos", barb.token)).status, 200, "ainda entra na tolerância");
    assert.equal((await amb.get("/api/auth/me", barb.token)).dados.usuario.assinatura, null, "barbeiro não vê a mensalidade");

    await pagoAte(amb, id, somaDias(hoje, -6));
    assert.equal((await amb.get("/api/servicos", barb.token)).status, 401, "barbeiro sai");
    const lb = await amb.login("barb.atraso", "Nova-barb.atraso-senha");
    assert.equal(lb.status, 403);
    assert.match(lb.dados.erro, /mensalidade/);
    const ld = await amb.login("dono.navalha", "Senha-forte-2026");
    assert.equal(ld.status, 200, "o dono entra para pagar");
    assert.equal(ld.dados.usuario.assinatura.situacao, "bloqueada");
    assert.equal((await amb.get("/api/servicos", ld.dados.token)).status, 402);
    assert.equal((await amb.get("/api/assinatura", ld.dados.token)).status, 200);
    assert.equal((await amb.get("/api/suporte", ld.dados.token)).status, 200, "pode pedir ajuda ao suporte");

    // pagou (Asaas avisa): libera na hora
    const ev = amb.asaas.pagar(sub.id);
    await amb.webhook(ev.pago);
    assert.equal((await amb.get("/api/servicos", ld.dados.token)).status, 200);
    assert.equal((await amb.login("barb.atraso", "Nova-barb.atraso-senha")).status, 200);
  });

  test("cancelar: só o proprietário; acesso até o fim do período; Asaas para de cobrar", async () => {
    const amb = ambiente();
    const { r, token, sub } = await assinar(amb);
    const ger = await amb.criarUsuario(token, "ger.cancela", "gerente");
    const barb = await amb.criarUsuario(token, "barb.cancela", "barbeiro");
    assert.equal((await amb.get("/api/assinatura", barb.token)).status, 403);
    assert.equal((await amb.get("/api/assinatura", ger.token)).status, 200);
    assert.equal((await amb.get("/api/assinatura", ger.token)).dados.podeCancelar, false);
    assert.equal((await amb.post("/api/assinatura/cancelar", ger.token, { motivo: "teste" })).status, 403);
    assert.equal((await amb.post("/api/assinatura/cancelar", token, {})).status, 400, "motivo obrigatório");

    const c = await amb.post("/api/assinatura/cancelar", token, { motivo: "Vou fechar a barbearia" });
    assert.equal(c.status, 200);
    assert.equal(amb.asaas.estado.assinaturas.get(sub.id).deleted, true);
    assert.equal((await amb.post("/api/assinatura/cancelar", token, { motivo: "de novo" })).status, 409);
    const a = (await amb.get("/api/assinatura", token)).dados.assinatura;
    assert.equal(a.situacao, "cancelada_ate_fim");
    assert.equal((await amb.get("/api/servicos", barb.token)).status, 200, "continua até o fim do período");

    await pagoAte(amb, r.barbearia.id, somaDias(hojeBrasil(), -1));
    assert.equal((await amb.get("/api/servicos", barb.token)).status, 401, "cancelada: sem tolerância");
    const aud = await amb.env.DB.prepare("SELECT detalhes FROM auditoria WHERE acao = 'assinatura_cancelada'").first();
    assert.match(aud.detalhes, /Vou fechar/);
  });

  test("assinatura cancelada no próprio Asaas também é registrada", async () => {
    const amb = ambiente();
    const { token, sub } = await assinar(amb);
    await amb.webhook({ id: "evt_del", event: "SUBSCRIPTION_DELETED", subscription: { id: sub.id } });
    assert.equal((await amb.get("/api/assinatura", token)).dados.assinatura.cancelada, true);
  });

  test("barbearia criada pela plataforma (manual) nunca bloqueia sozinha", async () => {
    const amb = ambiente();
    const p = await amb.criarPlataforma();
    const b = await amb.criarBarbearia(p, "manual", "standard");
    const me = (await amb.get("/api/auth/me", b.prop)).dados.usuario;
    assert.equal(me.assinatura, null);
    assert.equal(me.barbearia.plano, "standard");
    const a = (await amb.get("/api/assinatura", b.prop)).dados;
    assert.equal(a.assinatura.situacao, "manual");
    assert.equal(a.podeCancelar, false);
    assert.equal((await amb.post("/api/assinatura/cancelar", b.prop, { motivo: "teste" })).status, 400);
  });
});

describe("plataforma e isolamento", () => {
  test("plataforma vê a situação da assinatura e a troca de plano atualiza o valor no Asaas", async () => {
    const amb = ambiente();
    const p = await amb.criarPlataforma();
    const { r, sub } = await assinar(amb);
    const lista = (await amb.get("/api/plataforma/barbearias", p)).dados.barbearias;
    const b = lista.find(x => x.id === r.barbearia.id);
    assert.equal(b.plano, "standard");
    assert.equal(b.assinatura.origem, "asaas");
    assert.equal(b.assinatura.situacao, "teste");
    assert.equal(b.email, "dono@exemplo.test");

    const up = await amb.post("/api/plataforma/barbearias/alterar", p, { id: r.barbearia.id, plano: "pro", motivo: "Pediu o Pro" });
    assert.equal(up.status, 200, JSON.stringify(up.dados));
    assert.equal(up.dados.barbearia.plano, "pro");
    assert.equal(up.dados.barbearia.assinatura.valorCentavos, 14990);
    assert.equal(amb.asaas.estado.assinaturas.get(sub.id).value, 149.9);
    assert.equal(up.dados.barbearia.assinatura.origem, "asaas", "continua cobrada pelo Asaas");
  });

  test("cada barbearia vê só a própria assinatura; aviso de pagamento de uma não libera a outra", async () => {
    const amb = ambiente();
    const A = await assinar(amb);
    const B = await assinar(amb, { documento: CPF_B, login: "dono.outra", barbearia: "Outra Barbearia", email: "outra@exemplo.test", ip: "10.9.0.2" });
    const hoje = hojeBrasil();
    await pagoAte(amb, A.r.barbearia.id, somaDias(hoje, -10));
    await pagoAte(amb, B.r.barbearia.id, somaDias(hoje, -10));

    const aA = (await amb.get("/api/assinatura", A.token)).dados.assinatura;
    const aB = (await amb.get("/api/assinatura", B.token)).dados.assinatura;
    assert.notEqual(aA.linkPagamento, aB.linkPagamento);

    await amb.webhook(amb.asaas.pagar(B.sub.id).pago);
    assert.equal((await amb.get("/api/assinatura", B.token)).dados.assinatura.situacao, "em_dia");
    assert.equal((await amb.get("/api/assinatura", A.token)).dados.assinatura.situacao, "bloqueada");
    assert.equal((await amb.get("/api/servicos", A.token)).status, 402);
    assert.equal((await amb.get("/api/servicos", B.token)).status, 200);
    // o cancelamento de A não mexe em B
    await amb.post("/api/assinatura/cancelar", A.token, { motivo: "Encerrando" });
    assert.equal(amb.asaas.estado.assinaturas.get(B.sub.id).deleted, undefined);
    assert.equal((await amb.get("/api/assinatura", B.token)).dados.assinatura.cancelada, false);
  });
});
