// Pedido do responsável (16/11/2026): horários fixos (recorrência), calendário de ocupação (Mês/Ano) e caixa cobrando
// atendimentos (PDV). Dados fictícios.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { ambiente } from "./ambiente.js";
import { hojeBrasil } from "../src/util.js";
import { somarDias, diaSemana } from "../src/agenda-util.js";

const HOJE = hojeBrasil();
const AMANHA = somarDias(HOJE, 1);

async function cenario(sufixo = "alfa", amb = ambiente(), plataforma = null) {
  const p = plataforma || await amb.criarPlataforma();
  const b = await amb.criarBarbearia(p, sufixo);
  const ger = await amb.criarUsuario(b.prop, `ger.${sufixo}`, "gerente", { comissaoServicoBp: 4000 });
  const barb = await amb.criarUsuario(ger.token, `barb.${sufixo}`, "barbeiro", { comissaoServicoBp: 5000 });
  const cx = await amb.criarUsuario(ger.token, `cx.${sufixo}`, "caixa");
  // todos os dias 09:00–12:00 (3 h), sem intervalo
  await amb.post("/api/funcionamento/salvar", ger.token, { dias: [0, 1, 2, 3, 4, 5, 6].map(dia => ({ dia, aberto: true, abre: "09:00", fecha: "12:00" })) });
  const corte = (await amb.post("/api/servicos", ger.token, { nome: "Corte", precoCentavos: 4000, duracaoMin: 30 })).dados.servico;
  const cliente = { telefone: "11 91111-2222", nome: "Cliente Fixo", aceiteLgpd: true };
  return { ...amb, p, b, ger, barb, cx, corte, cliente };
}

describe("horários fixos (recorrência)", () => {
  test("toda semana por 4 semanas: 5 datas, cria 3 e pula (e lista) o feriado e o horário já ocupado", async () => {
    const amb = await cenario();
    const { post, get, ger, barb, corte, cliente } = amb;
    // feriado na 3ª ocorrência e um horário já ocupado na 4ª
    await post("/api/funcionamento/datas-fechadas", ger.token, { dataIni: somarDias(AMANHA, 14), motivo: "Feriado (fictício)" });
    await post("/api/agenda", barb.token, { data: somarDias(AMANHA, 21), hora: "10:00", servicoIds: [corte.id], cliente: { telefone: "11 93333-4444", nome: "Outro", aceiteLgpd: true } });
    const r = await post("/api/agenda", barb.token, {
      data: AMANHA, hora: "10:00", servicoIds: [corte.id], cliente, repetir: { intervaloSemanas: 1, ate: somarDias(AMANHA, 28) }
    });
    assert.equal(r.status, 201, JSON.stringify(r.dados));
    assert.equal(r.dados.serie.criados, 3);
    assert.deepEqual(r.dados.serie.datas, [AMANHA, somarDias(AMANHA, 7), somarDias(AMANHA, 28)]);
    assert.deepEqual(r.dados.serie.pulados.map(x => x.data), [somarDias(AMANHA, 14), somarDias(AMANHA, 21)]);
    assert.match(r.dados.serie.pulados[0].motivo, /Feriado/);
    assert.match(r.dados.serie.pulados[1].motivo, /outro atendimento/);
    // a cada 2 semanas
    const r2 = await post("/api/agenda", barb.token, { data: AMANHA, hora: "11:00", servicoIds: [corte.id], cliente, repetir: { intervaloSemanas: 2, ate: somarDias(AMANHA, 28) } });
    assert.deepEqual(r2.dados.serie.datas, [AMANHA, somarDias(AMANHA, 28)], "dia +14 é feriado: ficam o 1º e o +28");
    // a agenda mostra que é horário fixo
    const ag = (await get(`/api/agenda?data=${AMANHA}`, barb.token)).dados.agendamentos;
    assert.ok(ag.every(a => a.serie && a.serie.intervaloSemanas));
  });

  test("validações: no máximo 6 meses, intervalo de 1 a 4 semanas, barbeiro só na própria agenda", async () => {
    const { post, barb, ger, corte, cliente } = await cenario();
    const base = { data: AMANHA, hora: "10:00", servicoIds: [corte.id], cliente };
    assert.equal((await post("/api/agenda", barb.token, { ...base, repetir: { intervaloSemanas: 5, ate: somarDias(AMANHA, 30) } })).status, 400);
    assert.match((await post("/api/agenda", barb.token, { ...base, repetir: { intervaloSemanas: 1, ate: somarDias(AMANHA, 200) } })).dados.erro, /6 meses/);
    assert.equal((await post("/api/agenda", barb.token, { ...base, repetir: { intervaloSemanas: 1, ate: AMANHA } })).status, 400);
    assert.equal((await post("/api/agenda", barb.token, { ...base, barbeiroId: ger.id, repetir: { intervaloSemanas: 1, ate: somarDias(AMANHA, 14) } })).status, 403);
  });

  test("cancelar \"este e os próximos\": encerra a série e mantém os anteriores", async () => {
    const { post, get, barb, corte, cliente } = await cenario();
    const r = await post("/api/agenda", barb.token, { data: AMANHA, hora: "09:00", servicoIds: [corte.id], cliente, repetir: { intervaloSemanas: 1, ate: somarDias(AMANHA, 21) } });
    assert.equal(r.dados.serie.criados, 4);
    const terceiro = (await get(`/api/agenda?data=${somarDias(AMANHA, 14)}`, barb.token)).dados.agendamentos[0];
    assert.equal((await post("/api/agenda/situacao", barb.token, { id: terceiro.id, situacao: "cancelado", serie: true })).status, 400, "motivo obrigatório");
    const c = await post("/api/agenda/situacao", barb.token, { id: terceiro.id, situacao: "cancelado", serie: true, motivo: "Cliente mudou de cidade" });
    assert.equal(c.status, 200);
    assert.equal(c.dados.cancelados, 2);
    assert.equal((await get(`/api/agenda?data=${AMANHA}`, barb.token)).dados.agendamentos[0].situacao, "agendado");
    assert.equal((await get(`/api/agenda?data=${somarDias(AMANHA, 7)}`, barb.token)).dados.agendamentos[0].situacao, "agendado");
    assert.equal((await get(`/api/agenda?data=${somarDias(AMANHA, 21)}`, barb.token)).dados.agendamentos[0].situacao, "cancelado");
  });
});

describe("calendário de ocupação (Mês/Ano)", () => {
  test("livre, poucos horários, cheio e fechado — por profissional", async () => {
    const amb = await cenario();
    const { post, get, ger, barb, corte, cliente } = amb;
    const d1 = AMANHA, d2 = somarDias(AMANHA, 1), d3 = somarDias(AMANHA, 2);
    // barbeiro: d1 cheio (09–12 bloqueado), d2 com 2 h de 3 ocupadas (poucos), d3 livre; d4 data fechada
    await post("/api/agenda/bloqueios", barb.token, { inicio: `${d1}T09:00`, fim: `${d1}T12:00`, motivo: "Curso" });
    await post("/api/agenda/bloqueios", barb.token, { inicio: `${d2}T09:00`, fim: `${d2}T11:00` });
    await post("/api/agenda", barb.token, { data: d2, hora: "11:00", servicoIds: [corte.id], cliente });
    await post("/api/funcionamento/datas-fechadas", ger.token, { dataIni: somarDias(AMANHA, 3), motivo: "Folga coletiva" });
    const r = (await get(`/api/agenda/ocupacao?inicio=${d1}&fim=${somarDias(AMANHA, 3)}&barbeiroId=${ger.id}`, barb.token)).dados;
    assert.deepEqual(r.profissionais.map(p => p.id), [barb.id], "barbeiro vê só a dele");
    // d1: 3 h bloqueadas → cheio · d2: 2 h bloqueadas + corte 11:00–11:30 → sobra 11:30–12:00 (1 corte) → poucos
    assert.deepEqual(r.dias.map(d => d.status), ["cheio", "poucos", "livre", "fechado"]);
    assert.deepEqual(r.dias.map(d => d.horariosLivres), [0, 1, 6, 0]);
  });
});

describe("caixa como PDV: cobrar atendimento e atendimento sem horário", () => {
  test("caixa cobra atendimento de hoje sem ver comissão; não cobra de outro dia; barbeiro não usa o PDV", async () => {
    const amb = await cenario();
    const { post, get, barb, cx, corte, cliente } = amb;
    await post("/api/caixa/abrir", cx.token, { trocoCentavos: 0 });
    const hoje = (await post("/api/agenda", barb.token, { data: HOJE, hora: "09:00", servicoIds: [corte.id], cliente })).dados.agendamento.id;
    const amanha = (await post("/api/agenda", barb.token, { data: AMANHA, hora: "09:00", servicoIds: [corte.id], cliente })).dados.agendamento.id;
    const lista = await get("/api/caixa/atendimentos", cx.token);
    assert.equal(lista.status, 200);
    assert.deepEqual(lista.dados.atendimentos.map(a => [a.id, a.situacao, a.servicos[0].precoCentavos]), [[hoje, "agendado", 4000]]);
    assert.ok(!/comiss/i.test(JSON.stringify(lista.dados)));
    const cobrar = id => post("/api/caixa/cobrar", cx.token, { id, itens: [{ servicoId: corte.id, precoCobradoCentavos: 4000 }], pagamentos: [{ forma: "pix", valorCentavos: 4000 }] });
    assert.equal((await cobrar(amanha)).status, 403);
    const r = await cobrar(hoje);
    assert.equal(r.status, 201, JSON.stringify(r.dados));
    assert.ok(!("comissaoCentavos" in r.dados.finalizacao), "caixa não vê comissão");
    assert.equal((await get("/api/caixa/hoje", cx.token)).dados.totais.entradasCentavos, 4000);
    assert.equal((await post("/api/caixa/cobrar", barb.token, { id: hoje })).status, 403);
    assert.equal((await get("/api/caixa/atendimentos", barb.token)).status, 403);
    // caixa não cobra pela rota da agenda (só pela tela do caixa)
    assert.equal((await post("/api/agenda/finalizar", cx.token, { id: hoje, itens: [], pagamentos: [] })).status, 403);
  });

  test("atendimento sem horário: cria, finaliza, entra no caixa e gera comissão do barbeiro", async () => {
    const amb = await cenario();
    const { env, post, get, barb, cx, corte } = amb;
    const corpo = {
      barbeiroId: barb.id, itens: [{ servicoId: corte.id, precoCobradoCentavos: 3500 }],
      cliente: { telefone: "11 95555-6666", nome: "Cliente Passante", aceiteLgpd: true }, pagamentos: [{ forma: "dinheiro", valorCentavos: 3500 }]
    };
    assert.equal((await post("/api/caixa/atendimento-avulso", cx.token, corpo)).status, 409, "caixa fechado");
    await post("/api/caixa/abrir", cx.token, { trocoCentavos: 0 });
    assert.equal((await post("/api/caixa/atendimento-avulso", cx.token, { ...corpo, pagamentos: [{ forma: "dinheiro", valorCentavos: 100 }] })).status, 400);
    const r = await post("/api/caixa/atendimento-avulso", cx.token, corpo);
    assert.equal(r.status, 201, JSON.stringify(r.dados));
    assert.equal(r.dados.finalizacao.valorAlterado, true, "35,00 em vez de 40,00 fica destacado ao gerente");
    const c = (await get("/api/caixa/hoje", cx.token)).dados;
    assert.equal(c.totais.porForma.dinheiro, 3500);
    assert.equal(env.DB.raw.prepare("SELECT valor_centavos FROM comissoes").get().valor_centavos, 1750);
    assert.equal(env.DB.raw.prepare("SELECT COUNT(*) n FROM agendamentos WHERE situacao = 'agendado'").get().n, 0, "nenhum horário solto");
    assert.equal((await post("/api/caixa/atendimento-avulso", barb.token, corpo)).status, 403);
  });

  test("isolamento: o caixa não cobra horário de outra barbearia", async () => {
    const amb = ambiente();
    const p = await amb.criarPlataforma();
    const A = await cenario("alfa", amb, p);
    const B = await cenario("beta", amb, p);
    await amb.post("/api/caixa/abrir", A.cx.token, { trocoCentavos: 0 });
    const idB = (await amb.post("/api/agenda", B.barb.token, { data: HOJE, hora: "09:00", servicoIds: [B.corte.id], cliente: B.cliente })).dados.agendamento.id;
    assert.equal((await amb.post("/api/caixa/cobrar", A.cx.token, { id: idB, itens: [{ servicoId: A.corte.id, precoCobradoCentavos: 1 }], pagamentos: [{ forma: "pix", valorCentavos: 1 }] })).status, 404);
    assert.equal((await amb.post("/api/caixa/atendimento-avulso", A.cx.token, { barbeiroId: B.barb.id, itens: [{ servicoId: A.corte.id, precoCobradoCentavos: 1 }], cliente: A.cliente, pagamentos: [{ forma: "pix", valorCentavos: 1 }] })).status, 404);
    assert.equal((await amb.get("/api/caixa/atendimentos", A.cx.token)).dados.atendimentos.length, 0);
    assert.equal((await amb.get(`/api/agenda/ocupacao?inicio=${HOJE}&fim=${HOJE}&barbeiroId=${B.barb.id}`, A.ger.token)).dados.profissionais.length, 0);
  });
});
void diaSemana;

describe("telefone opcional na marcação (pedido de 16/11/2026)", () => {
  test("sem telefone: exige o nome, reaproveita o mesmo cliente pelo nome e não gera WhatsApp", async () => {
    const amb = await cenario();
    const { post, get, barb, ger, cx, corte } = amb;
    const semNome = await post("/api/agenda", barb.token, { data: AMANHA, hora: "09:00", servicoIds: [corte.id], cliente: { telefone: "" } });
    assert.equal(semNome.status, 400);
    assert.match(semNome.dados.erro, /telefone ou o nome/);
    assert.equal((await post("/api/agenda", barb.token, { data: AMANHA, hora: "09:00", servicoIds: [corte.id], cliente: { telefone: "123", nome: "X Y" } })).status, 400, "telefone digitado errado continua recusado");
    const r1 = await post("/api/agenda", barb.token, { data: AMANHA, hora: "09:00", servicoIds: [corte.id], cliente: { nome: "Seu Zé Sem Fone" } });
    assert.equal(r1.status, 201, JSON.stringify(r1.dados));
    const r2 = await post("/api/agenda", barb.token, { data: AMANHA, hora: "10:00", servicoIds: [corte.id], cliente: { telefone: "", nome: "seu zé sem fone" } });
    assert.equal(r2.status, 201, JSON.stringify(r2.dados));
    const ag = (await get(`/api/agenda?data=${AMANHA}`, barb.token)).dados.agendamentos;
    assert.equal(ag.length, 2);
    assert.equal(ag[0].cliente.id, ag[1].cliente.id, "mesmo nome sem telefone = mesmo cliente");
    assert.equal(ag[0].cliente.telefone, null);
    assert.equal(ag[0].whatsapp, null);
    // lista de clientes: aparece sem telefone; pode renomear sem informar telefone; busca por número não o encontra
    const lista = (await get("/api/clientes", ger.token)).dados.clientes;
    const ze = lista.find(c => c.nome === "Seu Zé Sem Fone");
    assert.equal(ze.telefone, null);
    const ren = await post("/api/clientes/alterar", ger.token, { id: ze.id, nome: "Seu Zé Fictício", telefone: "", observacao: null, aceiteLgpd: false });
    assert.equal(ren.status, 200, JSON.stringify(ren.dados));
    assert.equal(ren.dados.cliente.telefone, null);
    assert.equal((await get("/api/clientes?busca=123", ger.token)).dados.clientes.length, 0);
    // depois pode ganhar telefone
    const comFone = await post("/api/clientes/alterar", ger.token, { id: ze.id, telefone: "11 97777-1212", aceiteLgpd: true });
    assert.equal(comFone.dados.cliente.telefone, "11977771212");
    // caixa: atendimento sem horário também aceita sem telefone
    await post("/api/caixa/abrir", cx.token, { trocoCentavos: 0 });
    const av = await post("/api/caixa/atendimento-avulso", cx.token, { barbeiroId: barb.id, itens: [{ servicoId: corte.id, precoCobradoCentavos: 4000 }],
      pagamentos: [{ forma: "pix", valorCentavos: 4000 }], cliente: { nome: "Passante Fictício" } });
    assert.equal(av.status, 201, JSON.stringify(av.dados));
    // sem nome e sem telefone: no caixa vira "Cliente não identificado" (na agenda continua exigindo o nome)
    const anon = await post("/api/caixa/atendimento-avulso", cx.token, { barbeiroId: barb.id, itens: [{ servicoId: corte.id, precoCobradoCentavos: 4000 }],
      pagamentos: [{ forma: "dinheiro", valorCentavos: 4000 }], cliente: { telefone: "", nome: "" } });
    assert.equal(anon.status, 201, JSON.stringify(anon.dados));
    const anon2 = await post("/api/caixa/atendimento-avulso", cx.token, { barbeiroId: barb.id, itens: [{ servicoId: corte.id, precoCobradoCentavos: 4000 }],
      pagamentos: [{ forma: "pix", valorCentavos: 4000 }], cliente: {} });
    assert.equal(anon2.status, 201, JSON.stringify(anon2.dados));
    const fila = (await get("/api/caixa/atendimentos", cx.token)).dados.atendimentos;
    const anonimos = fila.filter(a => a.cliente.nome === "Cliente não identificado");
    assert.equal(anonimos.length, 2);
    assert.equal(anonimos[0].cliente.telefone, null);
    assert.equal(fila.find(a => a.cliente.nome === "Passante Fictício").cliente.telefone, null);
  });
});

describe("estoque já no cadastro do produto (pedido de 16/11/2026)", () => {
  test("produto novo com quantidade e custo: saldo, custo médio e movimento de entrada no mesmo lote; isolamento", async () => {
    const amb = await cenario();
    const { post, get, ger, barb } = amb;
    const r = await post("/api/produtos", ger.token, { nome: "Pomada Fictícia", precoCentavos: 4500, estoqueMinimo: 2, estoqueInicial: { quantidade: 10, custoUnitCentavos: 2000 } });
    assert.equal(r.status, 201, JSON.stringify(r.dados));
    const est = (await get("/api/estoque", ger.token)).dados;
    const lista = est.produtos || est.estoque || est.itens;
    const p = lista.find(x => x.nome === "Pomada Fictícia");
    assert.equal(p.saldo, 10);
    assert.equal(p.custoMedioCentavos, 2000);
    const hist = (await get(`/api/estoque/historico?produtoId=${r.dados.produto.id}`, ger.token)).dados;
    assert.equal(JSON.stringify(hist).includes('"entrada"'), true);
    // sem estoque inicial continua funcionando (saldo 0)
    assert.equal((await post("/api/produtos", ger.token, { nome: "Óleo Fictício", precoCentavos: 3000 })).status, 201);
    // dados inválidos: nada é gravado (nem o produto)
    const ruim = await post("/api/produtos", ger.token, { nome: "Gel Fictício", precoCentavos: 3000, estoqueInicial: { quantidade: 5, custoUnitCentavos: -1 } });
    assert.equal(ruim.status, 400);
    assert.ok(!(await get("/api/produtos", ger.token)).dados.produtos.some(x => x.nome === "Gel Fictício"));
    // barbeiro não cadastra produto
    assert.equal((await post("/api/produtos", barb.token, { nome: "X Fictício", precoCentavos: 100, estoqueInicial: { quantidade: 1, custoUnitCentavos: 1 } })).status, 403);
    // outra barbearia não vê o estoque desta
    const outra = await cenario("beta", amb, amb.p);
    const estOutra = (await get("/api/estoque", outra.ger.token)).dados;
    assert.ok(!JSON.stringify(estOutra).includes("Pomada Fictícia"));
  });
});

describe("editar conta lançada (pedido de 16/11/2026)", () => {
  test("em aberto muda tudo (auditado); paga só descrição/categoria; cancelada não; isolamento", async () => {
    const amb = await cenario();
    const { post, get, ger, barb } = amb;
    const c = (await post("/api/contas", ger.token, { descricao: "Luz", categoria: "aluguel", valorCentavos: 25000, vencimento: AMANHA })).dados.conta;
    const r = await post("/api/contas/alterar", ger.token, { id: c.id, descricao: "Luz (fictícia)", categoria: "luz", valorCentavos: 26050, vencimento: somarDias(AMANHA, 2), recorrente: true });
    assert.equal(r.status, 200, JSON.stringify(r.dados));
    assert.deepEqual([r.dados.conta.descricao, r.dados.conta.categoria, r.dados.conta.valorCentavos, r.dados.conta.vencimento, r.dados.conta.recorrente],
      ["Luz (fictícia)", "luz", 26050, somarDias(AMANHA, 2), true]);
    const aud = amb.env.DB.raw.prepare("SELECT detalhes FROM auditoria WHERE acao = 'conta_alterada' AND alvo = ?").get(c.id);
    assert.match(aud.detalhes, /"antes":\{[^}]*aluguel/);
    assert.match(aud.detalhes, /"depois":\{[^}]*26050/);
    assert.equal((await post("/api/contas/alterar", ger.token, { id: c.id, descricao: "Luz (fictícia)" })).status, 400, "nada mudou");
    // paga: só descrição/categoria
    await post("/api/contas/pagar", ger.token, { id: c.id });
    assert.equal((await post("/api/contas/alterar", ger.token, { id: c.id, valorCentavos: 1000 })).status, 409);
    assert.equal((await post("/api/contas/alterar", ger.token, { id: c.id, descricao: "Energia (fictícia)", categoria: "luz", valorCentavos: 26050 })).status, 200);
    // cancelada: não
    const c2 = (await post("/api/contas", ger.token, { descricao: "Água", categoria: "agua", valorCentavos: 12000, vencimento: AMANHA })).dados.conta;
    await post("/api/contas/cancelar", ger.token, { id: c2.id, motivo: "Lançada em dobro" });
    assert.equal((await post("/api/contas/alterar", ger.token, { id: c2.id, descricao: "Água 2" })).status, 409);
    // barbeiro não edita; outra barbearia não acha
    assert.equal((await post("/api/contas/alterar", barb.token, { id: c.id, descricao: "X" })).status, 403);
    const outra = await cenario("beta", amb, amb.p);
    assert.equal((await post("/api/contas/alterar", outra.ger.token, { id: c.id, descricao: "Invasão" })).status, 404);
  });
});

describe("caixa como recepção: agenda de todos, clientes, mensagens e catálogo (pedido de 16/11/2026)", () => {
  test("caixa vê todas as agendas sem comissão, marca para qualquer profissional, cancela e manda lembrete; isolamento", async () => {
    const amb = await cenario();
    const { post, get, ger, barb, cx, corte, cliente } = amb;
    // marca para o barbeiro e para o gerente
    const m1 = await post("/api/agenda", cx.token, { barbeiroId: barb.id, data: AMANHA, hora: "09:00", servicoIds: [corte.id], cliente });
    assert.equal(m1.status, 201, JSON.stringify(m1.dados));
    const m2 = await post("/api/agenda", cx.token, { barbeiroId: ger.id, data: AMANHA, hora: "09:00", servicoIds: [corte.id], cliente: { nome: "Cliente do Gerente" } });
    assert.equal(m2.status, 201, JSON.stringify(m2.dados));
    // sem escolher profissional: recusa (o caixa não tem agenda própria)
    const sem = await post("/api/agenda", cx.token, { data: AMANHA, hora: "10:00", servicoIds: [corte.id], cliente });
    assert.equal(sem.status, 400);
    assert.match(sem.dados.erro, /profissional/);
    // vê os dois, com o filtro por profissional, e a ocupação
    const ag = (await get(`/api/agenda?data=${AMANHA}`, cx.token)).dados;
    assert.equal(ag.agendamentos.length, 2);
    assert.equal(ag.profissionais.length, 2);
    assert.equal((await get(`/api/agenda?data=${AMANHA}&barbeiroId=${barb.id}`, cx.token)).dados.agendamentos.length, 1);
    assert.equal((await get(`/api/agenda/ocupacao?inicio=${AMANHA}&fim=${AMANHA}`, cx.token)).status, 200);
    // lembrete e cancelamento em horário de outro dia
    assert.equal((await post("/api/agenda/mensagem", cx.token, { id: m1.dados.agendamento.id, tipo: "lembrete" })).status, 201);
    assert.equal((await post("/api/agenda/situacao", cx.token, { id: m2.dados.agendamento.id, situacao: "cancelado", motivo: "Cliente desmarcou" })).status, 200);
    // clientes: lista, cadastra, edita; não desativa
    const novo = await post("/api/clientes", cx.token, { nome: "Recepção Fictícia", telefone: "11 95555-1111", aceiteLgpd: true });
    assert.equal(novo.status, 201, JSON.stringify(novo.dados));
    assert.equal((await post("/api/clientes/alterar", cx.token, { id: novo.dados.cliente.id, nome: "Recepção Fictícia 2" })).status, 200);
    assert.equal((await post("/api/clientes/alterar", cx.token, { id: novo.dados.cliente.id, ativo: false, motivo: "teste de permissão" })).status, 403);
    assert.ok((await get("/api/clientes", cx.token)).dados.clientes.some(c => c.nome === "Recepção Fictícia 2"));
    // catálogo: vê serviços e produtos; não altera
    assert.equal((await get("/api/servicos", cx.token)).status, 200);
    assert.equal((await post("/api/servicos/alterar", cx.token, { id: corte.id, precoCentavos: 1 })).status, 403);
    // isolamento: caixa de outra barbearia não vê nem marca nesta
    const outra = await cenario("beta", amb, amb.p);
    assert.equal((await get(`/api/agenda?data=${AMANHA}`, outra.cx.token)).dados.agendamentos.length, 0);
    assert.equal((await post("/api/agenda", outra.cx.token, { barbeiroId: barb.id, data: AMANHA, hora: "11:00", servicoIds: [corte.id], cliente })).status, 404);
    assert.equal((await post("/api/agenda/situacao", outra.cx.token, { id: m1.dados.agendamento.id, situacao: "faltou" })).status, 404);
    assert.ok(!(await get("/api/clientes", outra.cx.token)).dados.clientes.some(c => c.nome === "Recepção Fictícia 2"));
  });
});

describe("desconto na venda do caixa (pedido de 16/11/2026)", () => {
  test("2 pomadas com 10%: servidor calcula, caixa recebe o final, comissão sobre o final, desconto registrado; cancelar estorna o final", async () => {
    const amb = await cenario();
    const { post, get, ger, barb, cx } = amb;
    const pom = (await post("/api/produtos", ger.token, { nome: "Pomada Fictícia", precoCentavos: 2500, estoqueInicial: { quantidade: 9, custoUnitCentavos: 1000 } })).dados.produto;
    await post("/api/usuarios/alterar", ger.token, { id: barb.id, comissaoProdutoBp: 1000 });
    await post("/api/caixa/abrir", cx.token, { trocoCentavos: 1000 });
    const itens = [{ produtoId: pom.id, quantidade: 2 }];
    // pagamento pelo valor cheio com desconto: recusado (tem que bater com o final)
    assert.equal((await post("/api/vendas", cx.token, { itens, descontoBp: 1000, pagamentos: [{ forma: "pix", valorCentavos: 5000 }] })).status, 400);
    // desconto inválido
    assert.equal((await post("/api/vendas", cx.token, { itens, descontoBp: 10000, pagamentos: [{ forma: "pix", valorCentavos: 0 }] })).status, 400);
    assert.equal((await post("/api/vendas", cx.token, { itens, descontoBp: 7.5, pagamentos: [{ forma: "pix", valorCentavos: 4625 }] })).status, 400);
    const v = await post("/api/vendas", cx.token, { itens, descontoBp: 1000, vendedorId: barb.id, pagamentos: [{ forma: "debito", valorCentavos: 4500 }] });
    assert.equal(v.status, 201, JSON.stringify(v.dados));
    assert.deepEqual([v.dados.venda.brutoCentavos, v.dados.venda.descontoCentavos, v.dados.venda.totalCentavos], [5000, 500, 4500]);
    const cxHoje = (await get("/api/caixa/hoje", cx.token)).dados;
    assert.equal(cxHoje.totais.vendasCentavos, 4500);
    const lanc = cxHoje.lancamentos.find(l => l.vendaId === v.dados.venda.id);
    assert.deepEqual(lanc.desconto, { percentualBp: 1000, valorCentavos: 500, brutoCentavos: 5000 });
    const com = amb.env.DB.raw.prepare("SELECT base_centavos, valor_centavos FROM comissoes_produto WHERE venda_id = ?").get(v.dados.venda.id);
    assert.deepEqual([com.base_centavos, com.valor_centavos], [4500, 450], "comissão sobre o valor com desconto");
    const aud = amb.env.DB.raw.prepare("SELECT detalhes FROM auditoria WHERE acao = 'venda_registrada' AND alvo = ?").get(v.dados.venda.id);
    assert.match(aud.detalhes, /"descontoBp":1000/);
    // desconto quebrado: 7,5% de 50,00 = 3,75
    const v2 = await post("/api/vendas", cx.token, { itens: [{ produtoId: pom.id, quantidade: 2 }], descontoBp: 750, pagamentos: [{ forma: "dinheiro", valorCentavos: 4625 }] });
    assert.equal(v2.status, 201, JSON.stringify(v2.dados));
    // cancelar a venda com desconto estorna 45,00
    await post("/api/vendas/cancelar", ger.token, { id: v.dados.venda.id, motivo: "Cliente devolveu" });
    assert.equal((await get("/api/caixa/hoje", cx.token)).dados.totais.vendasCentavos, 4625);
    // sem desconto continua igual
    assert.equal((await post("/api/vendas", cx.token, { itens: [{ produtoId: pom.id, quantidade: 1 }], pagamentos: [{ forma: "pix", valorCentavos: 2500 }] })).status, 201);
    // isolamento: outra barbearia não vê
    const outra = await cenario("beta", amb, amb.p);
    await post("/api/caixa/abrir", outra.cx.token, { trocoCentavos: 0 });
    assert.ok(!JSON.stringify((await get("/api/caixa/hoje", outra.cx.token)).dados).includes("Pomada Fictícia"));
  });
});

describe("enviar mensagem pelo WhatsApp para clientes do dia (pedido de 16/11/2026)", () => {
  test("lista do dia, prepara links personalizados por cliente, marca aberto; sem telefone fica de fora; permissões e isolamento", async () => {
    const amb = await cenario();
    const { post, get, ger, barb, cx, corte } = amb;
    const m1 = (await post("/api/agenda", cx.token, { barbeiroId: barb.id, data: AMANHA, hora: "09:00", servicoIds: [corte.id], cliente: { telefone: "11 97000-0001", nome: "Davi Fictício", aceiteLgpd: true } })).dados.agendamento;
    const m2 = (await post("/api/agenda", cx.token, { barbeiroId: barb.id, data: AMANHA, hora: "10:00", servicoIds: [corte.id], cliente: { telefone: "11 97000-0002", nome: "Enzo Fictício", aceiteLgpd: true } })).dados.agendamento;
    const m3 = (await post("/api/agenda", cx.token, { barbeiroId: barb.id, data: AMANHA, hora: "11:00", servicoIds: [corte.id], cliente: { nome: "Sem Fone Fictício" } })).dados.agendamento;
    const lista = (await get(`/api/mensagens/clientes-do-dia?data=${AMANHA}`, cx.token)).dados.clientes;
    assert.deepEqual(lista.map(c => [c.cliente, c.podeReceber]), [["Davi Fictício", true], ["Enzo Fictício", true], ["Sem Fone Fictício", false]]);
    const texto = "Olá {cliente}! Seu horário é às {hora} com {barbeiro}.";
    const r = await post("/api/mensagens/envios", cx.token, { data: AMANHA, texto, agendamentoIds: [m1.id, m2.id] });
    assert.equal(r.status, 201, JSON.stringify(r.dados));
    assert.equal(r.dados.envio.total, 2);
    const [d1, d2] = r.dados.envio.destinos;
    assert.match(d1.link, /^https:\/\/wa\.me\/5511970000001\?text=/);
    assert.match(decodeURIComponent(d1.link.split("text=")[1]), /^Olá Davi! Seu horário é às 09:00 com \S+\.$/, "texto personalizado para cada cliente");
    assert.match(decodeURIComponent(d2.link.split("text=")[1]), /^Olá Enzo! Seu horário é às 10:00/);
    // marca aberto (uma vez) e audita a preparação
    assert.equal((await post("/api/mensagens/envios/aberto", cx.token, { destinoId: d1.id })).status, 200);
    assert.ok(amb.env.DB.raw.prepare("SELECT aberto_em FROM mensagens_livres_destinos WHERE id = ?").get(d1.id).aberto_em);
    assert.ok(amb.env.DB.raw.prepare("SELECT 1 FROM auditoria WHERE acao = 'mensagem_livre_preparada' AND alvo = ?").get(r.dados.envio.id));
    // sem telefone: recusado; campo inexistente: recusado; vazio: recusado
    assert.equal((await post("/api/mensagens/envios", cx.token, { data: AMANHA, texto, agendamentoIds: [m3.id] })).status, 400);
    assert.equal((await post("/api/mensagens/envios", cx.token, { data: AMANHA, texto: "Oi {apelido}", agendamentoIds: [m1.id] })).status, 400);
    assert.equal((await post("/api/mensagens/envios", cx.token, { data: AMANHA, texto: "Oi", agendamentoIds: [] })).status, 400);
    // outro dia: o horário não é deste dia
    assert.equal((await post("/api/mensagens/envios", cx.token, { data: HOJE, texto, agendamentoIds: [m1.id] })).status, 404);
    // gerente pode; barbeiro não
    assert.equal((await get(`/api/mensagens/clientes-do-dia?data=${AMANHA}`, ger.token)).status, 200);
    assert.equal((await get(`/api/mensagens/clientes-do-dia?data=${AMANHA}`, barb.token)).status, 403);
    // isolamento
    const outra = await cenario("beta", amb, amb.p);
    assert.equal((await get(`/api/mensagens/clientes-do-dia?data=${AMANHA}`, outra.cx.token)).dados.clientes.length, 0);
    assert.equal((await post("/api/mensagens/envios", outra.cx.token, { data: AMANHA, texto, agendamentoIds: [m1.id] })).status, 404);
    assert.equal((await post("/api/mensagens/envios/aberto", outra.cx.token, { destinoId: d2.id })).status, 404);
  });
});

describe("disponibilidade do dia e cliente da base (pedido de 16/11/2026)", () => {
  test("mostra fechado/folga/bloqueio, ocupados e horários livres pela duração; barbeiro só a dele; isolamento", async () => {
    const amb = await cenario();
    const { post, get, ger, barb, cx, corte } = amb;
    // dia normal: 09:00–12:00, um horário 10:00–10:30 → de hora em hora: 09:00 e 11:00 (10:00 está ocupado)
    await post("/api/agenda", cx.token, { barbeiroId: barb.id, data: AMANHA, hora: "10:00", servicoIds: [corte.id], cliente: { nome: "Ocupante Fictício" } });
    const d = (await get(`/api/agenda/disponibilidade?data=${AMANHA}&barbeiroId=${barb.id}&duracao=30`, cx.token)).dados;
    const p = d.profissionais[0];
    assert.equal(p.situacao, "aberto");
    assert.deepEqual(p.livres, ["09:00", "11:00"]);
    assert.deepEqual(p.ocupados.map(o => [o.ini, o.fim, o.tipo, o.texto]), [["10:00", "10:30", "horario", "Ocupante Fictício"]]);
    // duração de 90 min: 09:00 não cabe (bate às 10:00); 11:00 não cabe (fecha às 12:00)
    assert.deepEqual((await get(`/api/agenda/disponibilidade?data=${AMANHA}&barbeiroId=${barb.id}&duracao=90`, cx.token)).dados.profissionais[0].livres, []);
    // dia fechado (balanço)
    await post("/api/funcionamento/datas-fechadas", ger.token, { dataIni: somarDias(AMANHA, 3), motivo: "Fechado pra balanço" });
    const f = (await get(`/api/agenda/disponibilidade?data=${somarDias(AMANHA, 3)}`, cx.token)).dados.profissionais;
    assert.ok(f.every(x => x.situacao === "fechado" && /balanço/.test(x.motivo) && x.livres.length === 0));
    // dia todo bloqueado para o barbeiro
    const dB = somarDias(AMANHA, 1);
    await post("/api/agenda/bloqueios", ger.token, { barbeiroId: barb.id, inicio: `${dB}T00:00`, fim: `${dB}T23:59`, motivo: "Folga (fictícia)" });
    const b = (await get(`/api/agenda/disponibilidade?data=${dB}&barbeiroId=${barb.id}`, ger.token)).dados.profissionais[0];
    assert.equal(b.situacao, "bloqueado");
    assert.equal(b.livres.length, 0);
    // barbeiro vê só a própria, mesmo pedindo outra
    const sóDele = (await get(`/api/agenda/disponibilidade?data=${AMANHA}&barbeiroId=${ger.id}`, barb.token)).dados.profissionais;
    assert.deepEqual(sóDele.map(x => x.id), [barb.id]);
    // isolamento: outra barbearia não vê os horários desta
    const outra = await cenario("beta", amb, amb.p);
    const o = (await get(`/api/agenda/disponibilidade?data=${AMANHA}`, outra.cx.token)).dados.profissionais;
    assert.ok(!JSON.stringify(o).includes("Ocupante Fictício"));
    assert.ok(o.every(x => x.id !== barb.id));
  });

  test("marca para cliente escolhido da base (por id); busca por nome/telefone; outra barbearia não usa o cliente", async () => {
    const amb = await cenario();
    const { post, get, ger, barb, cx, corte } = amb;
    const c = (await post("/api/clientes", ger.token, { nome: "Gilberto Base Fictício", telefone: "11 96666-0000", aceiteLgpd: true })).dados.cliente;
    const achou = (await get("/api/agenda/clientes?busca=gilb", cx.token)).dados.clientes;
    assert.deepEqual(achou.map(x => x.nome), ["Gilberto Base Fictício"]);
    assert.equal((await get("/api/agenda/clientes?busca=96666", barb.token)).dados.clientes[0].id, c.id, "busca por telefone, também pelo barbeiro");
    const m = await post("/api/agenda", cx.token, { barbeiroId: barb.id, data: AMANHA, hora: "09:00", servicoIds: [corte.id], cliente: { id: c.id } });
    assert.equal(m.status, 201, JSON.stringify(m.dados));
    const ag = (await get(`/api/agenda?data=${AMANHA}`, cx.token)).dados.agendamentos;
    assert.equal(ag[0].cliente.id, c.id);
    // caixa: atendimento sem horário para cliente da base
    await post("/api/caixa/abrir", cx.token, { trocoCentavos: 0 });
    const av = await post("/api/caixa/atendimento-avulso", cx.token, { barbeiroId: barb.id, itens: [{ servicoId: corte.id, precoCobradoCentavos: 4000 }],
      pagamentos: [{ forma: "pix", valorCentavos: 4000 }], cliente: { id: c.id } });
    assert.equal(av.status, 201, JSON.stringify(av.dados));
    // desativado não pode
    await post("/api/clientes/alterar", ger.token, { id: c.id, ativo: false, motivo: "Mudou de cidade" });
    assert.equal((await post("/api/agenda", cx.token, { barbeiroId: barb.id, data: AMANHA, hora: "10:00", servicoIds: [corte.id], cliente: { id: c.id } })).status, 409);
    assert.equal((await get("/api/agenda/clientes?busca=gilb", cx.token)).dados.clientes.length, 0);
    // isolamento
    const outra = await cenario("beta", amb, amb.p);
    assert.equal((await post("/api/agenda", outra.cx.token, { barbeiroId: outra.barb.id, data: AMANHA, hora: "09:00", servicoIds: [outra.corte.id], cliente: { id: c.id } })).status, 404);
    assert.equal((await get("/api/agenda/clientes?busca=gilb", outra.cx.token)).dados.clientes.length, 0);
  });
});

describe("promissória: nota em aberto do cliente (pedido de 16/11/2026)", () => {
  test("corte e venda na nota não entram no caixa; aparecem em aberto; quitar entra no caixa de hoje; não paga duas vezes; estorno; reabrir/cancelar; isolamento", async () => {
    const amb = await cenario();
    const { post, get, ger, barb, cx, corte } = amb;
    const cli = (await post("/api/clientes", ger.token, { nome: "Mensalista Fictício", telefone: "11 95555-7777", aceiteLgpd: true })).dados.cliente;
    const pom = (await post("/api/produtos", ger.token, { nome: "Pomada Nota", precoCentavos: 2500, estoqueInicial: { quantidade: 5, custoUnitCentavos: 1000 } })).dados.produto;
    await post("/api/caixa/abrir", cx.token, { trocoCentavos: 0 });
    // corte na promissória (cobrado no caixa)
    const m = (await post("/api/agenda", cx.token, { barbeiroId: barb.id, data: HOJE, hora: "09:00", servicoIds: [corte.id], cliente: { id: cli.id } })).dados.agendamento;
    const cob = await post("/api/caixa/cobrar", cx.token, { id: m.id, itens: [{ servicoId: corte.id, precoCobradoCentavos: 4000 }], pagamentos: [{ forma: "promissoria", valorCentavos: 4000 }] });
    assert.equal(cob.status, 201, JSON.stringify(cob.dados));
    // venda: 1 pomada, metade pix e metade na nota
    const v = await post("/api/vendas", cx.token, { itens: [{ produtoId: pom.id, quantidade: 1 }], clienteId: cli.id, pagamentos: [{ forma: "pix", valorCentavos: 1000 }, { forma: "promissoria", valorCentavos: 1500 }] });
    assert.equal(v.status, 201, JSON.stringify(v.dados));
    let hoje = (await get("/api/caixa/hoje", cx.token)).dados.totais;
    assert.equal(hoje.entradasCentavos, 1000, "só o pix entrou");
    assert.equal(hoje.notasLancadasCentavos, 5500);
    assert.equal(hoje.porForma.dinheiro, 0);
    // em aberto
    let notas = (await get("/api/promissorias", cx.token)).dados;
    assert.equal(notas.clientes.length, 1);
    assert.equal(notas.clientes[0].totalCentavos, 5500);
    assert.equal(notas.clientes[0].notas.length, 2);
    assert.match(notas.clientes[0].whatsapp, /wa\.me\/5511955557777/);
    assert.deepEqual(notas.resumo, { clientes: 1, notas: 2, totalCentavos: 5500 });
    assert.equal((await get("/api/painel?periodo=hoje", ger.token)).dados.avisos.notasAbertas.totalCentavos, 5500);
    // painel: o corte conta no faturamento (foi feito), mesmo sem dinheiro
    assert.equal((await get("/api/painel?periodo=hoje", ger.token)).dados.cartoes.brutoCentavos, 6500);
    // sem cliente identificado não pode
    const anon = await post("/api/caixa/atendimento-avulso", cx.token, { barbeiroId: barb.id, itens: [{ servicoId: corte.id, precoCobradoCentavos: 4000 }], pagamentos: [{ forma: "promissoria", valorCentavos: 4000 }], cliente: {} });
    assert.equal(anon.status, 400);
    assert.match(anon.dados.erro, /promissória/);
    assert.equal((await post("/api/vendas", cx.token, { itens: [{ produtoId: pom.id, quantidade: 1 }], pagamentos: [{ forma: "promissoria", valorCentavos: 2500 }] })).status, 400);
    // receber: soma tem de bater; entra no caixa de hoje em dinheiro
    const ids = notas.clientes[0].notas.map(n => n.id);
    assert.equal((await post("/api/promissorias/receber", cx.token, { clienteId: cli.id, promissoriaIds: ids, pagamentos: [{ forma: "dinheiro", valorCentavos: 5000 }] })).status, 400);
    const rec = await post("/api/promissorias/receber", cx.token, { clienteId: cli.id, promissoriaIds: ids, pagamentos: [{ forma: "dinheiro", valorCentavos: 5500 }] });
    assert.equal(rec.status, 201, JSON.stringify(rec.dados));
    // não paga duas vezes
    assert.equal((await post("/api/promissorias/receber", cx.token, { clienteId: cli.id, promissoriaIds: ids, pagamentos: [{ forma: "dinheiro", valorCentavos: 5500 }] })).status, 409);
    hoje = (await get("/api/caixa/hoje", cx.token)).dados.totais;
    assert.equal(hoje.porForma.dinheiro, 5500);
    assert.equal(hoje.dinheiroEsperadoCentavos, 5500);
    assert.equal(hoje.notasRecebidasCentavos, 5500);
    assert.equal((await get("/api/promissorias", cx.token)).dados.clientes.length, 0);
    // venda já quitada não pode ser cancelada sem estornar o recebimento
    assert.equal((await post("/api/vendas/cancelar", ger.token, { id: v.dados.venda.id, motivo: "Devolução" })).status, 409);
    // estorno do recebimento: só gestão; notas voltam a ficar em aberto e o dinheiro sai do caixa
    assert.equal((await post("/api/promissorias/estornar-recebimento", cx.token, { recebimentoId: rec.dados.recebimento.id, motivo: "Lançado errado" })).status, 403);
    assert.equal((await post("/api/promissorias/estornar-recebimento", ger.token, { recebimentoId: rec.dados.recebimento.id, motivo: "Lançado errado" })).status, 200);
    assert.equal((await get("/api/caixa/hoje", cx.token)).dados.totais.porForma.dinheiro, 0);
    assert.equal((await get("/api/promissorias", cx.token)).dados.resumo.totalCentavos, 5500);
    // reabrir o corte (nota em aberto) estorna a nota; cancelar a venda estorna a nota dela
    assert.equal((await post("/api/agenda/reabrir", ger.token, { id: m.id, motivo: "Valor errado" })).status, 200);
    assert.equal((await post("/api/vendas/cancelar", ger.token, { id: v.dados.venda.id, motivo: "Devolução" })).status, 200);
    assert.equal((await get("/api/promissorias", cx.token)).dados.resumo.totalCentavos, 0);
    // contador do mês mostra as notas lançadas (não estornadas = 0 aqui) e recebidas (estornado = 0)
    const rel = (await get(`/api/contador/relatorio?tipo=mes&ref=${HOJE.slice(0, 7)}`, ger.token)).dados;
    assert.ok(rel.relatorio ? rel.relatorio.promissorias : rel.promissorias, "relatório tem a seção de promissórias");
    // permissões e isolamento
    assert.equal((await get("/api/promissorias", barb.token)).status, 403);
    const outra = await cenario("beta", amb, amb.p);
    await post("/api/caixa/abrir", outra.cx.token, { trocoCentavos: 0 });
    assert.equal((await get("/api/promissorias", outra.cx.token)).dados.clientes.length, 0);
    assert.equal((await post("/api/promissorias/receber", outra.cx.token, { clienteId: cli.id, promissoriaIds: ids, pagamentos: [{ forma: "dinheiro", valorCentavos: 5500 }] })).status, 409);
    assert.equal((await post("/api/vendas", outra.cx.token, { itens: [{ produtoId: pom.id, quantidade: 1 }], clienteId: cli.id, pagamentos: [{ forma: "promissoria", valorCentavos: 2500 }] })).status, 404);
  });
});

describe("promissória: cancelar só o gerente; paga fica registrada (pedido de 16/11/2026)", () => {
  test("caixa e barbeiro lançam; só gestão cancela (direto, reabrindo ou cancelando a venda); paga aparece no histórico como paga", async () => {
    const amb = await cenario();
    const { post, get, ger, barb, cx, corte } = amb;
    const cli = (await post("/api/clientes", ger.token, { nome: "Nota Fictícia", telefone: "11 94444-1111", aceiteLgpd: true })).dados.cliente;
    await post("/api/caixa/abrir", cx.token, { trocoCentavos: 0 });
    // barbeiro finaliza o próprio atendimento na promissória
    const m1 = (await post("/api/agenda", barb.token, { data: HOJE, hora: "09:00", servicoIds: [corte.id], cliente: { id: cli.id } })).dados.agendamento;
    assert.equal((await post("/api/agenda/finalizar", barb.token, { id: m1.id, itens: [{ servicoId: corte.id, precoCobradoCentavos: 4000 }], pagamentos: [{ forma: "promissoria", valorCentavos: 4000 }] })).status, 201);
    // barbeiro não reabre atendimento que está numa nota em aberto
    assert.equal((await post("/api/agenda/reabrir", barb.token, { id: m1.id, motivo: "teste" })).status, 403);
    // caixa lança outro na nota
    const m2 = (await post("/api/agenda", cx.token, { barbeiroId: barb.id, data: HOJE, hora: "10:00", servicoIds: [corte.id], cliente: { id: cli.id } })).dados.agendamento;
    await post("/api/caixa/cobrar", cx.token, { id: m2.id, itens: [{ servicoId: corte.id, precoCobradoCentavos: 4000 }], pagamentos: [{ forma: "promissoria", valorCentavos: 4000 }] });
    const notas = (await get("/api/promissorias", cx.token)).dados.clientes[0].notas;
    assert.equal(notas.length, 2);
    // cancelar nota: caixa não pode; gerente pode (com motivo)
    assert.equal((await post("/api/promissorias/cancelar", cx.token, { id: notas[0].id, motivo: "Cortesia" })).status, 403);
    assert.equal((await post("/api/promissorias/cancelar", ger.token, { id: notas[0].id })).status, 400, "precisa de motivo");
    assert.equal((await post("/api/promissorias/cancelar", ger.token, { id: notas[0].id, motivo: "Cortesia do gerente" })).status, 200);
    assert.equal((await post("/api/promissorias/cancelar", ger.token, { id: notas[0].id, motivo: "De novo" })).status, 409);
    // a outra é paga e continua registrada como paga
    await post("/api/promissorias/receber", cx.token, { clienteId: cli.id, promissoriaIds: [notas[1].id], pagamentos: [{ forma: "pix", valorCentavos: 4000 }] });
    assert.equal((await post("/api/promissorias/cancelar", ger.token, { id: notas[1].id, motivo: "Tentativa" })).status, 409, "paga não se cancela");
    const pagas = (await get("/api/promissorias/historico?situacao=pagas", cx.token)).dados.notas;
    assert.deepEqual(pagas.map(n => [n.id, n.situacao, n.pagoEm]), [[notas[1].id, "paga", HOJE]]);
    const canceladas = (await get("/api/promissorias/historico?situacao=canceladas", cx.token)).dados.notas;
    assert.equal(canceladas.length, 1);
    assert.match(canceladas[0].motivo, /Cortesia do gerente/);
    assert.ok(amb.env.DB.raw.prepare("SELECT 1 FROM auditoria WHERE acao = 'promissoria_cancelada' AND alvo = ?").get(notas[0].id));
    // isolamento
    const outra = await cenario("beta", amb, amb.p);
    assert.equal((await post("/api/promissorias/cancelar", outra.ger.token, { id: notas[1].id, motivo: "Invasão" })).status, 404);
    assert.equal((await get("/api/promissorias/historico?situacao=pagas", outra.cx.token)).dados.notas.length, 0);
  });
});

describe("remarcar horário e concluir atendimento no caixa (pedido de 16/11/2026)", () => {
  test("remanejar para hora livre, outro dia e outro profissional; conflito, bloqueio e fechado recusados; auditado; permissões; isolamento", async () => {
    const amb = await cenario();
    const { post, get, ger, barb, cx, corte } = amb;
    // 10:00 desmarcou; o cliente das 11:00 vai para as 10:00
    const m10 = (await post("/api/agenda", cx.token, { barbeiroId: barb.id, data: AMANHA, hora: "10:00", servicoIds: [corte.id], cliente: { nome: "Desmarcou Fictício" } })).dados.agendamento;
    const m11 = (await post("/api/agenda", cx.token, { barbeiroId: barb.id, data: AMANHA, hora: "11:00", servicoIds: [corte.id], cliente: { nome: "Remanejado Fictício" } })).dados.agendamento;
    assert.equal((await post("/api/agenda/remarcar", cx.token, { id: m11.id, data: AMANHA, hora: "10:00" })).status, 409, "10:00 ainda ocupado");
    await post("/api/agenda/situacao", cx.token, { id: m10.id, situacao: "cancelado", motivo: "Cliente desmarcou" });
    const r = await post("/api/agenda/remarcar", cx.token, { id: m11.id, data: AMANHA, hora: "10:00" });
    assert.equal(r.status, 200, JSON.stringify(r.dados));
    assert.deepEqual([r.dados.agendamento.inicio, r.dados.agendamento.fim], ["10:00", "10:30"], "mantém a duração");
    let ag = (await get(`/api/agenda?data=${AMANHA}`, cx.token)).dados.agendamentos.find(x => x.id === m11.id);
    assert.equal(ag.inicio, "10:00");
    assert.ok(amb.env.DB.raw.prepare("SELECT 1 FROM auditoria WHERE acao = 'agendamento_remarcado' AND alvo = ? AND detalhes LIKE '%11:00%'").get(m11.id));
    // outro dia e outro profissional
    assert.equal((await post("/api/agenda/remarcar", cx.token, { id: m11.id, data: somarDias(AMANHA, 1), hora: "09:00", barbeiroId: ger.id })).status, 200);
    ag = (await get(`/api/agenda?data=${somarDias(AMANHA, 1)}`, cx.token)).dados.agendamentos.find(x => x.id === m11.id);
    assert.equal(ag.barbeiroId, ger.id);
    // fora do funcionamento / dia fechado / bloqueio
    assert.equal((await post("/api/agenda/remarcar", cx.token, { id: m11.id, data: AMANHA, hora: "13:00" })).status, 409);
    await post("/api/funcionamento/datas-fechadas", ger.token, { dataIni: somarDias(AMANHA, 4), motivo: "Feriado (fictício)" });
    assert.equal((await post("/api/agenda/remarcar", cx.token, { id: m11.id, data: somarDias(AMANHA, 4), hora: "09:00" })).status, 409);
    await post("/api/agenda/bloqueios", ger.token, { barbeiroId: ger.id, inicio: `${somarDias(AMANHA, 1)}T11:00`, fim: `${somarDias(AMANHA, 1)}T12:00` });
    assert.equal((await post("/api/agenda/remarcar", cx.token, { id: m11.id, data: somarDias(AMANHA, 1), hora: "11:00" })).status, 409);
    // passado não; cancelado não
    assert.equal((await post("/api/agenda/remarcar", cx.token, { id: m11.id, data: somarDias(HOJE, -1), hora: "09:00" })).status, 400);
    assert.equal((await post("/api/agenda/remarcar", cx.token, { id: m10.id, data: AMANHA, hora: "11:00" })).status, 409);
    // barbeiro: só o próprio e sem trocar de profissional
    const mb = (await post("/api/agenda", barb.token, { data: AMANHA, hora: "09:00", servicoIds: [corte.id], cliente: { nome: "Do Barbeiro" } })).dados.agendamento;
    assert.equal((await post("/api/agenda/remarcar", barb.token, { id: mb.id, data: AMANHA, hora: "11:00" })).status, 200);
    assert.equal((await post("/api/agenda/remarcar", barb.token, { id: mb.id, data: AMANHA, hora: "11:30", barbeiroId: ger.id })).status, 403);
    assert.equal((await post("/api/agenda/remarcar", barb.token, { id: m11.id, data: somarDias(AMANHA, 1), hora: "10:00" })).status, 403);
    // isolamento
    const outra = await cenario("beta", amb, amb.p);
    assert.equal((await post("/api/agenda/remarcar", outra.cx.token, { id: m11.id, data: AMANHA, hora: "09:00" })).status, 404);
  });

  test("caixa conclui atendimento que ficou sem cobrar de dia anterior (entra no caixa de hoje); futuro não", async () => {
    const amb = await cenario();
    const { post, get, barb, cx, corte } = amb;
    const ontem = somarDias(HOJE, -1);
    const m = (await post("/api/agenda", cx.token, { barbeiroId: barb.id, data: ontem, hora: "09:00", servicoIds: [corte.id], cliente: { nome: "Esqueceram Fictício" } })).dados.agendamento;
    const fut = (await post("/api/agenda", cx.token, { barbeiroId: barb.id, data: AMANHA, hora: "09:00", servicoIds: [corte.id], cliente: { nome: "Amanhã Fictício" } })).dados.agendamento;
    await post("/api/caixa/abrir", cx.token, { trocoCentavos: 0 });
    const lista = (await get("/api/caixa/atendimentos", cx.token)).dados.atendimentos;
    const pend = lista.find(a => a.id === m.id);
    assert.ok(pend && pend.atrasado && pend.data === ontem, "aparece na fila como de dia anterior");
    assert.ok(!lista.some(a => a.id === fut.id), "amanhã não aparece");
    const c = await post("/api/caixa/cobrar", cx.token, { id: m.id, itens: [{ servicoId: corte.id, precoCobradoCentavos: 4000 }], pagamentos: [{ forma: "debito", valorCentavos: 4000 }] });
    assert.equal(c.status, 201, JSON.stringify(c.dados));
    assert.equal((await get("/api/caixa/hoje", cx.token)).dados.totais.porForma.debito, 4000);
    assert.equal((await post("/api/caixa/cobrar", cx.token, { id: fut.id, itens: [{ servicoId: corte.id, precoCobradoCentavos: 4000 }], pagamentos: [{ forma: "pix", valorCentavos: 4000 }] })).status, 403);
  });
});

describe("excluir cliente (pedido de 16/11/2026)", () => {
  test("some da lista/busca/marcação, histórico fica, telefone liberado; caixa só sem histórico; nota em aberto bloqueia; isolamento", async () => {
    const amb = await cenario();
    const { post, get, ger, barb, cx, corte } = amb;
    const dup = (await post("/api/clientes", cx.token, { nome: "Duplicado Fictício", telefone: "11 93333-0001", aceiteLgpd: true })).dados.cliente;
    const comHist = (await post("/api/clientes", ger.token, { nome: "Com Histórico Fictício", telefone: "11 93333-0002", aceiteLgpd: true })).dados.cliente;
    const m = (await post("/api/agenda", cx.token, { barbeiroId: barb.id, data: AMANHA, hora: "09:00", servicoIds: [corte.id], cliente: { id: comHist.id } })).dados.agendamento;
    // motivo obrigatório; caixa exclui o duplicado (sem histórico)
    assert.equal((await post("/api/clientes/excluir", cx.token, { id: dup.id })).status, 400);
    const ex = await post("/api/clientes/excluir", cx.token, { id: dup.id, motivo: "Cadastro duplicado" });
    assert.equal(ex.status, 200, JSON.stringify(ex.dados));
    assert.ok(!(await get("/api/clientes", ger.token)).dados.clientes.some(c => c.id === dup.id), "some da lista");
    assert.equal((await get("/api/agenda/clientes?busca=Duplicado", cx.token)).dados.clientes.length, 0, "some da busca");
    assert.equal((await post("/api/agenda", cx.token, { barbeiroId: barb.id, data: AMANHA, hora: "10:00", servicoIds: [corte.id], cliente: { id: dup.id } })).status, 409);
    assert.equal((await post("/api/clientes/excluir", ger.token, { id: dup.id, motivo: "De novo" })).status, 409);
    assert.equal((await post("/api/clientes/alterar", ger.token, { id: dup.id, ativo: true })).status, 409);
    // telefone liberado para um novo cadastro
    assert.equal((await post("/api/clientes", cx.token, { nome: "Novo Dono do Número", telefone: "11 93333-0001", aceiteLgpd: true })).status, 201);
    const reg = amb.env.DB.raw.prepare("SELECT telefone_original, motivo FROM clientes_excluidos WHERE cliente_id = ?").get(dup.id);
    assert.deepEqual([reg.telefone_original, reg.motivo], ["11933330001", "Cadastro duplicado"]);
    assert.ok(amb.env.DB.raw.prepare("SELECT 1 FROM auditoria WHERE acao = 'cliente_excluido' AND alvo = ?").get(dup.id));
    // com histórico: caixa não; gerente sim, e o horário continua na agenda
    assert.equal((await post("/api/clientes/excluir", cx.token, { id: comHist.id, motivo: "Não volta mais" })).status, 403);
    assert.equal((await post("/api/clientes/excluir", ger.token, { id: comHist.id, motivo: "Pediu para sair" })).status, 200);
    assert.ok((await get(`/api/agenda?data=${AMANHA}`, cx.token)).dados.agendamentos.some(a => a.id === m.id), "histórico continua");
    // nota em aberto bloqueia
    const deve = (await post("/api/clientes", ger.token, { nome: "Deve Fictício", telefone: "11 93333-0003", aceiteLgpd: true })).dados.cliente;
    await post("/api/caixa/abrir", cx.token, { trocoCentavos: 0 });
    await post("/api/caixa/atendimento-avulso", cx.token, { barbeiroId: barb.id, itens: [{ servicoId: corte.id, precoCobradoCentavos: 4000 }], pagamentos: [{ forma: "promissoria", valorCentavos: 4000 }], cliente: { id: deve.id } });
    assert.equal((await post("/api/clientes/excluir", ger.token, { id: deve.id, motivo: "Teste" })).status, 409);
    // barbeiro não; outra barbearia não acha
    assert.equal((await post("/api/clientes/excluir", barb.token, { id: deve.id, motivo: "Teste" })).status, 403);
    const outra = await cenario("beta", amb, amb.p);
    assert.equal((await post("/api/clientes/excluir", outra.ger.token, { id: deve.id, motivo: "Invasão" })).status, 404);
  });
});
