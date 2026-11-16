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
