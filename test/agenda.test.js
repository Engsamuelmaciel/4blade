// E2 — agenda, funcionamento, mensagens, finalização, reabertura e abertura de caixa. Dados fictícios.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { ambiente } from "./ambiente.js";
import { hojeBrasil } from "../src/util.js";
import { somarDias, diaSemana } from "../src/agenda-util.js";

const HOJE = hojeBrasil();
const AMANHA = somarDias(HOJE, 1);
const SEMANA_TODA = [0, 1, 2, 3, 4, 5, 6].map(dia => ({ dia, aberto: true, abre: "08:00", fecha: "20:00", intervaloIni: "12:00", intervaloFim: "13:00" }));

async function cenario(sufixo = "alfa", amb = ambiente(), plataforma = null) {
  const p = plataforma || await amb.criarPlataforma();
  const b = await amb.criarBarbearia(p, sufixo);
  const ger = await amb.criarUsuario(b.prop, `ger.${sufixo}`, "gerente", { comissaoServicoBp: 4000 });
  const barb = await amb.criarUsuario(ger.token, `barb.${sufixo}`, "barbeiro", { comissaoServicoBp: 5000 });
  const barb2 = await amb.criarUsuario(ger.token, `barb2.${sufixo}`, "barbeiro", { comissaoServicoBp: 3000 });
  const cx = await amb.criarUsuario(ger.token, `cx.${sufixo}`, "caixa");
  const r = await amb.post("/api/funcionamento/salvar", ger.token, { dias: SEMANA_TODA });
  assert.equal(r.status, 200, JSON.stringify(r.dados));
  const corte = (await amb.post("/api/servicos", ger.token, { nome: "Corte", precoCentavos: 4000, duracaoMin: 30 })).dados.servico;
  const barba = (await amb.post("/api/servicos", ger.token, { nome: "Barba", precoCentavos: 3000, duracaoMin: 20 })).dados.servico;
  const marcar = (token, corpo) => amb.post("/api/agenda", token, {
    data: HOJE, hora: "09:00", servicoIds: [corte.id],
    cliente: { telefone: "11 91111-0000", nome: "Cliente Teste", aceiteLgpd: true }, ...corpo
  });
  return { ...amb, p, b, prop: b.prop, ger, barb, barb2, cx, corte, barba, marcar };
}

const abrirCaixa = (amb, token, troco = 10000) => amb.post("/api/caixa/abrir", token, { trocoCentavos: troco });
const finalizarSimples = (amb, token, id, itens, pagamentos) =>
  amb.post("/api/agenda/finalizar", token, { id, itens, pagamentos });

describe("funcionamento da barbearia (4.9)", () => {
  test("validações do funcionamento", async () => {
    const { post, get, ger, barb } = await cenario();
    const ruim = dias => post("/api/funcionamento/salvar", ger.token, { dias });
    assert.equal((await ruim(SEMANA_TODA.slice(0, 6))).status, 400);
    assert.match((await ruim(SEMANA_TODA.map(d => d.dia === 1 ? { ...d, abre: "20:00", fecha: "08:00" } : d))).dados.erro, /segunda/);
    assert.match((await ruim(SEMANA_TODA.map(d => d.dia === 2 ? { ...d, intervaloIni: "07:00", intervaloFim: "08:30" } : d))).dados.erro, /Intervalo de terça/);
    assert.equal((await post("/api/funcionamento/salvar", barb.token, { dias: SEMANA_TODA })).status, 403, "barbeiro não altera");
    const f = (await get("/api/funcionamento", barb.token)).dados;
    assert.equal(f.configurado, true);
    assert.deepEqual(f.dias[3], { dia: 3, aberto: true, abre: "08:00", fecha: "20:00", intervaloIni: "12:00", intervaloFim: "13:00" });
  });

  test("sem funcionamento cadastrado não marca; dia fechado e fora do horário são recusados", async () => {
    const amb = ambiente();
    const p = await amb.criarPlataforma();
    const b = await amb.criarBarbearia(p, "nova");
    const ger = await amb.criarUsuario(b.prop, "ger.nova", "gerente");
    const s = (await amb.post("/api/servicos", ger.token, { nome: "Corte", precoCentavos: 4000, duracaoMin: 30 })).dados.servico;
    const corpo = { data: AMANHA, hora: "09:00", servicoIds: [s.id], cliente: { telefone: "11 91111-0000", nome: "Cliente X", aceiteLgpd: true } };
    const semFunc = await amb.post("/api/agenda", ger.token, corpo);
    assert.equal(semFunc.status, 409);
    assert.match(semFunc.dados.erro, /funcionamento/);

    const fechadoAmanha = SEMANA_TODA.map(d => d.dia === diaSemana(AMANHA) ? { dia: d.dia, aberto: false } : d);
    await amb.post("/api/funcionamento/salvar", ger.token, { dias: fechadoAmanha });
    assert.match((await amb.post("/api/agenda", ger.token, corpo)).dados.erro, /não abre/);

    await amb.post("/api/funcionamento/salvar", ger.token, { dias: SEMANA_TODA });
    assert.match((await amb.post("/api/agenda", ger.token, { ...corpo, hora: "07:30" })).dados.erro, /Fora do funcionamento/);
    assert.match((await amb.post("/api/agenda", ger.token, { ...corpo, hora: "19:45" })).dados.erro, /Fora do funcionamento/, "termina depois de fechar");
    assert.match((await amb.post("/api/agenda", ger.token, { ...corpo, hora: "11:45" })).dados.erro, /intervalo/);
    assert.equal((await amb.post("/api/agenda", ger.token, { ...corpo, hora: "13:00" })).status, 201);
  });

  test("data fechada: avisa os horários marcados para remarcar, não cancela e bloqueia novas marcações", async () => {
    const amb = await cenario();
    const { post, get, ger, barb, marcar } = amb;
    const m = await marcar(barb.token, { data: AMANHA, hora: "10:00" });
    assert.equal(m.status, 201);
    const prev = await get(`/api/funcionamento/afetados?dataIni=${AMANHA}`, ger.token);
    assert.equal(prev.dados.afetados.length, 1);
    const r = await post("/api/funcionamento/datas-fechadas", ger.token, { dataIni: AMANHA, motivo: "Feriado municipal" });
    assert.equal(r.status, 201);
    assert.equal(r.dados.afetados.length, 1);
    assert.equal(r.dados.afetados[0].cliente, "Cliente Teste");
    assert.match(r.dados.afetados[0].whatsapp.proposta, /^https:\/\/wa\.me\/5511911110000\?text=/);
    // não cancelou sozinho
    const ag = (await get(`/api/agenda?data=${AMANHA}`, ger.token)).dados.agendamentos;
    assert.equal(ag[0].situacao, "agendado");
    // novas marcações recusadas
    const n = await marcar(barb.token, { data: AMANHA, hora: "15:00" });
    assert.equal(n.status, 409);
    assert.match(n.dados.erro, /Feriado municipal/);
    // reabrir a data (desativar com motivo) volta a aceitar
    assert.equal((await post("/api/funcionamento/datas-fechadas/desativar", ger.token, { id: r.dados.dataFechada.id, motivo: "Feriado cancelado" })).status, 200);
    assert.equal((await marcar(barb.token, { data: AMANHA, hora: "15:00" })).status, 201);
    assert.equal((await post("/api/funcionamento/datas-fechadas", barb.token, { dataIni: AMANHA, motivo: "x y z" })).status, 403);
  });

  test("horário do barbeiro fica dentro do funcionamento e limita a agenda", async () => {
    const { post, get, ger, barb, marcar } = await cenario();
    const dias = SEMANA_TODA.map(d => ({ dia: d.dia, trabalha: true, ini: "10:00", fim: "18:00" }));
    assert.match((await post("/api/horarios-trabalho", ger.token, { id: barb.id, dias: dias.map(d => ({ ...d, fim: "21:00" })) })).dados.erro, /dentro/);
    assert.equal((await post("/api/horarios-trabalho", barb.token, { id: barb.id, dias })).status, 403, "barbeiro não define o próprio horário");
    assert.equal((await post("/api/horarios-trabalho", ger.token, { id: barb.id, dias })).status, 200);
    assert.equal((await get("/api/horarios-trabalho", barb.token)).dados.dias[0].ini, "10:00");
    assert.match((await marcar(barb.token, { hora: "09:00" })).dados.erro, /horário do profissional/);
    assert.equal((await marcar(barb.token, { hora: "10:00" })).status, 201);
    // diminuir o funcionamento para fora do horário do barbeiro é recusado
    const menor = SEMANA_TODA.map(d => ({ ...d, abre: "11:00", intervaloIni: null, intervaloFim: null }));
    const r = await post("/api/funcionamento/salvar", ger.token, { dias: menor });
    assert.equal(r.status, 409);
    assert.match(r.dados.erro, /Pessoa barb\.alfa/);
  });
});

describe("agenda (4.1)", () => {
  test("cliente identificado pelo telefone: novo nasce na marcação (com LGPD); existente é reaproveitado", async () => {
    const { env, get, ger, barb, marcar, corte } = await cenario();
    assert.match((await marcar(barb.token, { cliente: { telefone: "11 92222-0000", nome: "Sem Aceite" } })).dados.erro, /LGPD/);
    assert.match((await marcar(barb.token, { cliente: { telefone: "11 92222-0000", aceiteLgpd: true } })).dados.erro, /nome/);
    const r1 = await marcar(barb.token, {});
    assert.equal(r1.status, 201);
    assert.equal(r1.dados.agendamento.cliente.novo, true);
    const busca = await get("/api/agenda/cliente?telefone=(11)%2091111-0000", barb.token);
    assert.equal(busca.dados.cliente.nome, "Cliente Teste");
    const r2 = await marcar(ger.token, { hora: "10:00", cliente: { telefone: "+55 11 91111-0000" } });
    assert.equal(r2.status, 201);
    assert.equal(r2.dados.agendamento.cliente.novo, false);
    assert.equal(env.DB.raw.prepare("SELECT COUNT(*) n FROM clientes").get().n, 1);
    assert.equal(env.DB.raw.prepare("SELECT aceite_lgpd FROM clientes").get().aceite_lgpd, 1);
    void corte;
  });

  test("não permite dois horários sobrepostos para o mesmo barbeiro (outro barbeiro pode)", async () => {
    const { marcar, barb, barb2, ger, corte, barba } = await cenario();
    assert.equal((await marcar(barb.token, { hora: "09:00", servicoIds: [corte.id, barba.id] })).status, 201);   // 09:00–09:50
    const s = await marcar(barb.token, { hora: "09:40" });
    assert.equal(s.status, 409);
    assert.match(s.dados.erro, /outro atendimento/);
    assert.equal((await marcar(ger.token, { barbeiroId: barb.id, hora: "09:30" })).status, 409, "gerente também não sobrepõe");
    assert.equal((await marcar(barb.token, { hora: "09:50" })).status, 201, "encostado no fim pode");
    assert.equal((await marcar(barb2.token, { hora: "09:00" })).status, 201, "outro barbeiro no mesmo horário pode");
  });

  test("barbeiro só vê e agenda a própria agenda; gerente vê e agenda todas; caixa não acessa", async () => {
    const { get, post, marcar, barb, barb2, ger, cx } = await cenario();
    assert.equal((await marcar(barb.token, { barbeiroId: barb2.id })).status, 403);
    assert.equal((await marcar(ger.token, { barbeiroId: barb2.id, hora: "15:00" })).status, 201);
    assert.equal((await marcar(barb.token, { hora: "16:00" })).status, 201);

    const doBarb = (await get(`/api/agenda?data=${HOJE}&barbeiroId=${barb2.id}`, barb.token)).dados;
    assert.deepEqual(doBarb.agendamentos.map(a => a.barbeiroId), [barb.id], "ignora o barbeiroId de outro");
    assert.deepEqual(doBarb.profissionais.map(p => p.id), [barb.id]);
    const doGer = (await get(`/api/agenda?data=${HOJE}`, ger.token)).dados;
    assert.equal(doGer.agendamentos.length, 2);
    assert.equal(doGer.profissionais.length, 4, "dono + gerente + 2 barbeiros lado a lado (o dono também atende)");

    const idOutro = doGer.agendamentos.find(a => a.barbeiroId === barb2.id).id;
    for (const [rota, corpo] of [
      ["/api/agenda/situacao", { id: idOutro, situacao: "cancelado", motivo: "teste" }],
      ["/api/agenda/mensagem", { id: idOutro, tipo: "lembrete" }],
      ["/api/agenda/finalizar", { id: idOutro, itens: [], pagamentos: [] }]
    ]) assert.equal((await post(rota, barb.token, corpo)).status, 403, rota);

    // caixa (recepção, pedido de 16/11/2026): vê todas as agendas e marca para qualquer profissional, mas não reabre nem bloqueia
    assert.equal((await get("/api/agenda", cx.token)).status, 200);
    assert.equal((await post("/api/agenda/bloqueios", cx.token, { barbeiroId: barb.id, inicio: `${AMANHA}T12:00`, fim: `${AMANHA}T13:00` })).status, 403);
    assert.equal((await post("/api/agenda/reabrir", cx.token, { id: idOutro, motivo: "teste" })).status, 403);
  });

  test("situações: faltou e cancelado (cancelar exige motivo); horário cancelado libera a vaga", async () => {
    const { post, get, marcar, barb } = await cenario();
    const id = (await marcar(barb.token, {})).dados.agendamento.id;
    assert.equal((await post("/api/agenda/situacao", barb.token, { id, situacao: "cancelado" })).status, 400);
    assert.equal((await post("/api/agenda/situacao", barb.token, { id, situacao: "finalizado" })).status, 400);
    assert.equal((await post("/api/agenda/situacao", barb.token, { id, situacao: "cancelado", motivo: "Cliente desmarcou" })).status, 200);
    assert.equal((await post("/api/agenda/situacao", barb.token, { id, situacao: "faltou" })).status, 409, "já cancelado");
    assert.equal((await marcar(barb.token, {})).status, 201, "vaga livre de novo");
    const id2 = (await marcar(barb.token, { hora: "14:00" })).dados.agendamento.id;
    assert.equal((await post("/api/agenda/situacao", barb.token, { id: id2, situacao: "faltou" })).status, 200);
    const ag = (await get(`/api/agenda?data=${HOJE}`, barb.token)).dados.agendamentos;
    assert.deepEqual(ag.map(a => [a.inicio, a.situacao]), [["09:00", "cancelado"], ["09:00", "agendado"], ["14:00", "faltou"]]);
    assert.equal(ag[0].motivo, "Cliente desmarcou");
  });

  test("bloqueios: barbeiro bloqueia a própria agenda; gerente a de qualquer um; marcação no bloqueio é recusada", async () => {
    const { post, get, marcar, barb, barb2, ger } = await cenario();
    assert.equal((await post("/api/agenda/bloqueios", barb.token, { barbeiroId: barb2.id, inicio: `${HOJE}T12:00`, fim: `${HOJE}T13:00` })).status, 403);
    const b = await post("/api/agenda/bloqueios", barb.token, { inicio: `${HOJE}T14:00`, fim: `${HOJE}T15:00`, motivo: "Dentista" });
    assert.equal(b.status, 201);
    assert.match((await marcar(barb.token, { hora: "14:30" })).dados.erro, /bloqueado/);
    assert.equal((await marcar(barb2.token, { hora: "14:30" })).status, 201, "não afeta outro barbeiro");
    // férias de vários dias, pelo gerente
    assert.equal((await post("/api/agenda/bloqueios", ger.token, { barbeiroId: barb2.id, inicio: `${AMANHA}T00:00`, fim: `${somarDias(AMANHA, 5)}T23:59`, motivo: "Férias" })).status, 201);
    assert.match((await marcar(barb2.token, { data: somarDias(AMANHA, 3), hora: "10:00" })).dados.erro, /bloqueado/);
    // bloquear por cima de atendimento marcado é recusado
    assert.equal((await post("/api/agenda/bloqueios", barb2.token, { inicio: `${HOJE}T14:00`, fim: `${HOJE}T16:00` })).status, 409);
    // cancelar bloqueio (com motivo) libera
    assert.equal((await post("/api/agenda/bloqueios/cancelar", barb.token, { id: b.dados.bloqueio.id })).status, 400);
    assert.equal((await post("/api/agenda/bloqueios/cancelar", barb.token, { id: b.dados.bloqueio.id, motivo: "Remarcou dentista" })).status, 200);
    assert.equal((await marcar(barb.token, { hora: "14:30" })).status, 201);
    assert.equal((await get(`/api/agenda?data=${HOJE}`, barb.token)).dados.bloqueios.length, 0);
  });

  test("botões de mensagem: link wa.me com o modelo preenchido e envio registrado (quem, quando, qual)", async () => {
    const { env, post, get, marcar, barb, ger, corte, barba } = await cenario();
    await post("/api/modelos-mensagem/alterar", ger.token, { tipo: "lembrete", texto: "Oi {cliente}! {data} às {hora} com {barbeiro}: {servico}. {barbearia}" });
    // escolhidos na ordem Barba, Corte: a mensagem respeita a ordem escolhida
    await marcar(barb.token, { data: AMANHA, hora: "10:00", servicoIds: [barba.id, corte.id], cliente: { telefone: "11 95555-0000", nome: "Outro Cliente", aceiteLgpd: true } });
    const id = (await marcar(barb.token, { data: AMANHA, hora: "15:00", servicoIds: [corte.id, barba.id] })).dados.agendamento.id;
    const r = await post("/api/agenda/mensagem", barb.token, { id, tipo: "lembrete" });
    assert.equal(r.status, 201);
    const [dd, mm] = [AMANHA.slice(8, 10), AMANHA.slice(5, 7)];
    const esperado = `Oi Cliente! ${dd}/${mm} às 15:00 com Pessoa: Corte + Barba. Barbearia Teste alfa`;
    assert.equal(r.dados.url, `https://wa.me/5511911110000?text=${encodeURIComponent(esperado)}`);
    assert.equal((await post("/api/agenda/mensagem", barb.token, { id, tipo: "proposta" })).status, 201);
    const reg = env.DB.raw.prepare("SELECT tipo, usuario_id, criado_em FROM mensagens_enviadas ORDER BY rowid").all();
    assert.deepEqual(reg.map(x => [x.tipo, x.usuario_id]), [["lembrete", barb.id], ["proposta", barb.id]]);
    assert.ok(reg[0].criado_em);
    const lista = (await get(`/api/agenda?data=${AMANHA}`, ger.token)).dados.agendamentos;
    assert.match(decodeURIComponent(lista[0].whatsapp.lembrete), /: Barba \+ Corte\./);
    assert.deepEqual(lista[0].servicos.map(s => s.nome), ["Barba", "Corte"]);
    const ag = lista[1];
    assert.equal(ag.mensagens.length, 2);
    assert.equal(decodeURIComponent(ag.whatsapp.lembrete.split("text=")[1]), esperado);
    assert.equal((await post("/api/agenda/mensagem", barb.token, { id, tipo: "spam" })).status, 400);
  });
});

describe("finalizar atendimento (4.2) e caixa", () => {
  test("exige caixa do dia aberto; barbeiro não abre caixa; caixa abre uma vez só", async () => {
    const amb = await cenario();
    const { marcar, barb, cx, corte } = amb;
    const id = (await marcar(barb.token, {})).dados.agendamento.id;
    const r = await finalizarSimples(amb, barb.token, id, [{ servicoId: corte.id, precoCobradoCentavos: 4000 }], [{ forma: "pix", valorCentavos: 4000 }]);
    assert.equal(r.status, 409);
    assert.match(r.dados.erro, /peça para abrir o caixa/i);
    assert.equal((await abrirCaixa(amb, barb.token)).status, 403);
    assert.equal((await abrirCaixa(amb, cx.token, -5)).status, 400);
    assert.equal((await abrirCaixa(amb, cx.token, 10000)).status, 201);
    assert.equal((await abrirCaixa(amb, cx.token, 10000)).status, 409);
    assert.equal((await finalizarSimples(amb, barb.token, id, [{ servicoId: corte.id, precoCobradoCentavos: 4000 }], [{ forma: "pix", valorCentavos: 4000 }])).status, 201);
  });

  test("valor bruto no caixa, comissão à parte; valor alterado registrado e destacado; caixa não vê comissão", async () => {
    const amb = await cenario();
    const { env, get, marcar, barb, barb2, ger, cx, corte, barba } = amb;
    await abrirCaixa(amb, cx.token, 5000);
    const id = (await marcar(barb.token, { servicoIds: [corte.id, barba.id] })).dados.agendamento.id;
    // corte de 40,00 cobrado 35,00 + barba 30,00 = 65,00; pago 40,00 no pix + 25,00 em dinheiro
    const r = await finalizarSimples(amb, barb.token, id,
      [{ servicoId: corte.id, precoCobradoCentavos: 3500 }, { servicoId: barba.id, precoCobradoCentavos: 3000 }],
      [{ forma: "pix", valorCentavos: 4000 }, { forma: "dinheiro", valorCentavos: 2500 }]);
    assert.equal(r.status, 201, JSON.stringify(r.dados));
    assert.equal(r.dados.finalizacao.totalCentavos, 6500);
    assert.equal(r.dados.finalizacao.valorAlterado, true);
    assert.equal(r.dados.finalizacao.comissaoCentavos, 3250, "50% de 65,00");

    // registro da alteração: tabela, cobrado, quem, quando
    const item = env.DB.raw.prepare("SELECT preco_tabela_centavos t, preco_cobrado_centavos c FROM finalizacao_itens WHERE nome = 'Corte'").get();
    assert.deepEqual({ ...item }, { t: 4000, c: 3500 });
    const fin = env.DB.raw.prepare("SELECT criado_por, criado_em FROM finalizacoes").get();
    assert.equal(fin.criado_por, barb.id);
    assert.ok(fin.criado_em);

    // caixa: valor BRUTO por forma, sem comissão
    const c = await get("/api/caixa/hoje", cx.token);
    assert.equal(c.status, 200);
    assert.equal(c.dados.totais.entradasCentavos, 6500);
    assert.equal(c.dados.totais.porForma.pix, 4000);
    assert.equal(c.dados.totais.porForma.dinheiro, 2500);
    assert.equal(c.dados.totais.dinheiroEsperadoCentavos, 7500, "troco 50 + 25 em dinheiro");
    assert.ok(!/comiss/i.test(JSON.stringify(c.dados)), "caixa nunca vê comissão");
    assert.equal(c.dados.lancamentos[0].cliente, "Cliente Teste");

    // gerente vê destaque + comissão; o barbeiro dono vê a própria comissão
    const g = (await get(`/api/agenda?data=${HOJE}`, ger.token)).dados.agendamentos[0].finalizacao;
    assert.equal(g.valorAlterado, true);
    assert.equal(g.comissaoCentavos, 3250);
    assert.deepEqual(g.itens[0], { nome: "Corte", tabelaCentavos: 4000, cobradoCentavos: 3500 });
    assert.equal((await get(`/api/agenda?data=${HOJE}`, barb.token)).dados.agendamentos[0].finalizacao.comissaoCentavos, 3250);
    // outro barbeiro não enxerga esse atendimento
    assert.equal((await get(`/api/agenda?data=${HOJE}`, barb2.token)).dados.agendamentos.length, 0);
    // comissão guardada em tabela própria
    assert.deepEqual({ ...env.DB.raw.prepare("SELECT barbeiro_id, base_centavos, percentual_bp, valor_centavos FROM comissoes").get() },
      { barbeiro_id: barb.id, base_centavos: 6500, percentual_bp: 5000, valor_centavos: 3250 });
  });

  test("validações dos pagamentos: até 2 formas, soma igual ao total", async () => {
    const amb = await cenario();
    const { marcar, barb, cx, corte, post } = amb;
    await abrirCaixa(amb, cx.token);
    const id = (await marcar(barb.token, {})).dados.agendamento.id;
    const itens = [{ servicoId: corte.id, precoCobradoCentavos: 4000 }];
    const casos = [
      [[], /1 ou 2/],
      [[{ forma: "pix", valorCentavos: 1000 }, { forma: "dinheiro", valorCentavos: 1000 }, { forma: "debito", valorCentavos: 2000 }], /1 ou 2/],
      [[{ forma: "pix", valorCentavos: 3000 }], /soma/],
      [[{ forma: "pix", valorCentavos: 2000 }, { forma: "pix", valorCentavos: 2000 }], /diferentes/],
      [[{ forma: "cheque", valorCentavos: 4000 }], /Forma/],
      [[{ forma: "pix", valorCentavos: 40.5 }], /Valor/]
    ];
    for (const [pag, msg] of casos) {
      const r = await finalizarSimples(amb, barb.token, id, itens, pag);
      assert.equal(r.status, 400, JSON.stringify(pag));
      assert.match(r.dados.erro, msg);
    }
    assert.match((await finalizarSimples(amb, barb.token, id, [{ servicoId: corte.id, precoCobradoCentavos: -1 }], [])).dados.erro, /Valor cobrado/);
    assert.equal((await finalizarSimples(amb, barb.token, id, itens, [{ forma: "credito", valorCentavos: 4000 }])).status, 201);
    assert.equal((await finalizarSimples(amb, barb.token, id, itens, [{ forma: "credito", valorCentavos: 4000 }])).status, 409, "não finaliza duas vezes");
    // horário de amanhã não finaliza hoje
    const fut = (await marcar(barb.token, { data: AMANHA })).dados.agendamento.id;
    assert.equal((await finalizarSimples(amb, barb.token, fut, itens, [{ forma: "pix", valorCentavos: 4000 }])).status, 409);
    void post;
  });

  test("reabrir: barbeiro reabre o próprio com caixa aberto, estorna entrada e comissão; refinalizar com outro valor fica destacado", async () => {
    const amb = await cenario();
    const { env, post, get, marcar, barb, barb2, ger, cx, corte } = amb;
    await abrirCaixa(amb, cx.token);
    const id = (await marcar(barb.token, {})).dados.agendamento.id;
    await finalizarSimples(amb, barb.token, id, [{ servicoId: corte.id, precoCobradoCentavos: 4000 }], [{ forma: "pix", valorCentavos: 4000 }]);
    assert.equal((await get(`/api/agenda?data=${HOJE}`, ger.token)).dados.agendamentos[0].finalizacao.valorAlterado, false, "preço de tabela: sem destaque");

    assert.equal((await post("/api/agenda/reabrir", barb2.token, { id, motivo: "engano" })).status, 403, "outro barbeiro não reabre");
    assert.equal((await post("/api/agenda/reabrir", barb.token, { id })).status, 400, "motivo obrigatório");
    const r = await post("/api/agenda/reabrir", barb.token, { id, motivo: "Forma de pagamento errada" });
    assert.equal(r.status, 200);

    const c = (await get("/api/caixa/hoje", cx.token)).dados;
    assert.equal(c.totais.entradasCentavos, 0, "entrada estornada");
    assert.deepEqual(c.lancamentos.map(l => [l.tipo, l.valorCentavos]), [["atendimento", 4000], ["estorno_atendimento", -4000]]);
    assert.equal(env.DB.raw.prepare("SELECT estornada FROM comissoes").get().estornada, 1);
    const ag = (await get(`/api/agenda?data=${HOJE}`, ger.token)).dados.agendamentos[0];
    assert.equal(ag.situacao, "agendado");
    assert.equal(ag.reaberturas, 1);
    const aud = env.DB.raw.prepare("SELECT usuario_id, detalhes FROM auditoria WHERE acao = 'atendimento_reaberto'").get();
    assert.equal(aud.usuario_id, barb.id);
    assert.match(aud.detalhes, /Forma de pagamento errada/);

    // refinaliza com valor diferente → destacado ao gerente, mostrando o anterior
    const r2 = await finalizarSimples(amb, barb.token, id, [{ servicoId: corte.id, precoCobradoCentavos: 4000 }],
      [{ forma: "dinheiro", valorCentavos: 4000 }]);
    assert.equal(r2.dados.finalizacao.valorAlterado, false, "mesmo valor: sem destaque");
    // a tabela muda para 30,00 e o atendimento é reaberto e refinalizado pelo preço novo de tabela:
    // não houve desconto no item, mas o total mudou em relação à finalização anterior → destacado
    await post("/api/servicos/alterar", ger.token, { id: corte.id, precoCentavos: 3000 });
    await post("/api/agenda/reabrir", ger.token, { id, motivo: "Preço errado" });
    const r6 = await post("/api/agenda/finalizar", ger.token, { id, itens: [{ servicoId: corte.id, precoCobradoCentavos: 3000 }], pagamentos: [{ forma: "pix", valorCentavos: 3000 }] });
    assert.equal(r6.dados.finalizacao.valorAlterado, true);
    assert.equal((await get(`/api/agenda?data=${HOJE}`, ger.token)).dados.agendamentos[0].reaberturas, 2);
    const fin = (await get(`/api/agenda?data=${HOJE}`, ger.token)).dados.agendamentos[0].finalizacao;
    assert.equal(fin.totalAnteriorCentavos, 4000);
    assert.equal(fin.valorAlterado, true);
    // caixa bate: só a última finalização vale
    assert.equal((await get("/api/caixa/hoje", cx.token)).dados.totais.entradasCentavos, 3000);
  });

  test("caixa fechado: barbeiro não reabre; gerente precisa reabrir o caixa antes", async () => {
    const amb = await cenario();
    const { env, post, marcar, barb, ger, cx, corte } = amb;
    await abrirCaixa(amb, cx.token);
    const id = (await marcar(barb.token, {})).dados.agendamento.id;
    await finalizarSimples(amb, barb.token, id, [{ servicoId: corte.id, precoCobradoCentavos: 4000 }], [{ forma: "pix", valorCentavos: 4000 }]);
    env.DB.raw.prepare("UPDATE caixas SET situacao = 'fechado'").run();   // fechamento chega na E3
    const b = await post("/api/agenda/reabrir", barb.token, { id, motivo: "engano" });
    assert.equal(b.status, 409);
    assert.match(b.dados.erro, /só o gerente/);
    assert.match((await post("/api/agenda/reabrir", ger.token, { id, motivo: "engano" })).dados.erro, /reabra o caixa/);
    // e com o caixa fechado não se finaliza
    const id2 = (await marcar(barb.token, { hora: "15:00" })).dados.agendamento.id;
    assert.equal((await finalizarSimples(amb, barb.token, id2, [{ servicoId: corte.id, precoCobradoCentavos: 4000 }], [{ forma: "pix", valorCentavos: 4000 }])).status, 409);
  });
});

describe("isolamento da agenda entre barbearias", () => {
  test("ids da outra barbearia não funcionam em nenhuma rota da agenda/caixa", async () => {
    const amb = ambiente();
    const p = await amb.criarPlataforma();
    const A = await cenario("alfa", amb, p);
    const B = await cenario("beta", amb, p);
    await abrirCaixa(amb, A.cx.token);
    await abrirCaixa(amb, B.cx.token, 777);
    const idB = (await B.marcar(B.barb.token, {})).dados.agendamento.id;
    const blqB = (await amb.post("/api/agenda/bloqueios", B.barb.token, { inicio: `${HOJE}T15:00`, fim: `${HOJE}T16:00` })).dados.bloqueio.id;

    // A tenta usar serviço, profissional, horário e bloqueio de B
    assert.equal((await A.marcar(A.ger.token, { servicoIds: [B.corte.id] })).status, 404);
    assert.equal((await A.marcar(A.ger.token, { barbeiroId: B.barb.id })).status, 404);
    for (const [rota, corpo] of [
      ["/api/agenda/situacao", { id: idB, situacao: "cancelado", motivo: "sabotagem" }],
      ["/api/agenda/mensagem", { id: idB, tipo: "lembrete" }],
      ["/api/agenda/finalizar", { id: idB, itens: [{ servicoId: A.corte.id, precoCobradoCentavos: 1 }], pagamentos: [{ forma: "pix", valorCentavos: 1 }] }],
      ["/api/agenda/reabrir", { id: idB, motivo: "sabotagem" }],
      ["/api/agenda/bloqueios/cancelar", { id: blqB, motivo: "sabotagem" }],
      ["/api/horarios-trabalho", { id: B.barb.id, dias: SEMANA_TODA.map(d => ({ dia: d.dia, trabalha: false })) }]
    ]) {
      assert.equal((await amb.post(rota, A.ger.token, corpo)).status, 404, rota);
    }
    // B finaliza no próprio horário, mas com serviço de A → recusado
    assert.equal((await amb.post("/api/agenda/finalizar", B.barb.token, { id: idB, itens: [{ servicoId: A.corte.id, precoCobradoCentavos: 4000 }], pagamentos: [{ forma: "pix", valorCentavos: 4000 }] })).status, 404);

    // listas nunca misturam
    const agA = (await amb.get(`/api/agenda?data=${HOJE}&barbeiroId=${B.barb.id}`, A.ger.token)).dados;
    assert.equal(agA.agendamentos.length, 0);
    assert.ok(!JSON.stringify(agA).includes("beta"));
    assert.equal((await amb.get("/api/caixa/hoje", A.cx.token)).dados.caixa.trocoCentavos, 10000);
    assert.equal((await amb.get(`/api/horarios-trabalho?id=${B.barb.id}`, A.ger.token)).status, 404);
    assert.equal((await amb.get(`/api/funcionamento/afetados?dataIni=${HOJE}`, A.ger.token)).dados.afetados.length, 0);
    // B intacto
    const agB = (await amb.get(`/api/agenda?data=${HOJE}`, B.ger.token)).dados;
    assert.equal(agB.agendamentos[0].situacao, "agendado");
    assert.equal(agB.bloqueios.length, 1);
  });

  test("plataforma não acessa agenda nem caixa", async () => {
    const { get, p } = await cenario();
    assert.equal((await get("/api/agenda", p)).status, 403);
    assert.equal((await get("/api/caixa/hoje", p)).status, 403);
    assert.equal((await get("/api/funcionamento", p)).status, 403);
  });
});

describe("o dono já entra como gerente: também atende (pedido de 16/11/2026)", () => {
  test("agenda própria, horário de trabalho, finaliza o próprio atendimento e tem desempenho", async () => {
    const amb = await cenario("dono");
    const { post, get, prop, ger, barb, cx, corte, marcar } = amb;
    const me = (await get("/api/auth/me", prop)).dados.usuario;
    // aparece entre os profissionais e marca na própria agenda (sem escolher ninguém)
    const ag = (await get(`/api/agenda?data=${HOJE}`, prop)).dados;
    assert.ok(ag.profissionais.some(p => p.id === me.id), "dono na lista de profissionais");
    const m = await marcar(prop, { hora: "10:00" });
    assert.equal(m.status, 201, JSON.stringify(m.dados));
    // caixa e gerente marcam para o dono
    assert.equal((await marcar(cx.token, { hora: "11:00", barbeiroId: me.id })).status, 201);
    // horário de trabalho: o próprio dono define; o gerente não mexe no do dono
    const dias = [0, 1, 2, 3, 4, 5, 6].map(dia => ({ dia, trabalha: true, ini: "08:00", fim: "20:00" }));
    assert.equal((await post("/api/horarios-trabalho", ger.token, { id: me.id, dias })).status, 403);
    assert.equal((await post("/api/horarios-trabalho", prop, { id: me.id, dias })).status, 200);
    // finaliza o próprio atendimento
    assert.equal((await abrirCaixa(amb, cx.token)).status, 201);
    const f = await finalizarSimples(amb, prop, m.dados.agendamento.id, [{ servicoId: corte.id, precoCobradoCentavos: 4000 }], [{ forma: "pix", valorCentavos: 4000 }]);
    assert.equal(f.status, 201, JSON.stringify(f.dados));
    const d = await get("/api/desempenho?periodo=hoje", prop);
    assert.equal(d.status, 200, JSON.stringify(d.dados));
    // barbeiro continua sem ver a agenda do dono
    assert.equal((await get(`/api/agenda?data=${HOJE}&barbeiroId=${me.id}`, barb.token)).dados.agendamentos.every(a => a.barbeiroId === barb.id), true);
  });
});

describe("tempo do serviço ajusta a agenda (pedido de 16/11/2026)", () => {
  test("procedimento de 1h30 às 10:00: próximo horário livre é 11:30 e não dá para marcar antes", async () => {
    const amb = await cenario("tempo");
    const { post, get, ger, barb, corte } = amb;
    const prog = (await post("/api/servicos", ger.token, { nome: "Progressiva", precoCentavos: 8000, duracaoMin: 90 })).dados.servico;
    const m = await amb.marcar(ger.token, { barbeiroId: barb.id, data: AMANHA, hora: "10:00", servicoIds: [prog.id] });
    assert.equal(m.status, 201, JSON.stringify(m.dados));
    const livres = (await get(`/api/agenda/disponibilidade?data=${AMANHA}&barbeiroId=${barb.id}&duracao=30`, ger.token)).dados.profissionais[0].livres;
    assert.ok(livres.includes("11:30"), livres.join(","));
    assert.ok(!livres.includes("10:00") && !livres.includes("11:00"), "10:00 e 11:00 estão dentro da progressiva");
    // o servidor recusa marcar dentro do procedimento (10:30 ou 11:00) e aceita às 11:30
    assert.equal((await amb.marcar(ger.token, { barbeiroId: barb.id, data: AMANHA, hora: "11:00", servicoIds: [corte.id], cliente: { nome: "Outro Cliente" } })).status, 409);
    assert.equal((await amb.marcar(ger.token, { barbeiroId: barb.id, data: AMANHA, hora: "11:30", servicoIds: [corte.id], cliente: { nome: "Outro Cliente" } })).status, 201);
  });
});
