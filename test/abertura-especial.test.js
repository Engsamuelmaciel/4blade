// Abertura em caráter especial (26/11/2026): dia que a barbearia normalmente não abre (ex.: domingo antes do Natal).
// Vale na agenda (marcar, disponibilidade, ocupação) e na página pública. Dados fictícios.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { ambiente } from "./ambiente.js";
import worker from "../src/index.js";
import { hojeBrasil } from "../src/util.js";
import { somarDias, diaSemana } from "../src/agenda-util.js";

// segunda a sábado abre; DOMINGO fechado
const SEMANA = [0, 1, 2, 3, 4, 5, 6].map(dia => dia === 0 ? { dia, aberto: false } : { dia, aberto: true, abre: "09:00", fecha: "18:00" });

// próximo domingo (pelo menos 3 dias à frente)
function proximoDomingo() {
  let d = somarDias(hojeBrasil(), 3);
  while (diaSemana(d) !== 0) d = somarDias(d, 1);
  return d;
}

async function cenario(sufixo = "esp", amb = ambiente(), plataforma = null) {
  const p = plataforma || await amb.criarPlataforma();
  const b = await amb.criarBarbearia(p, sufixo);
  const ger = await amb.criarUsuario(b.prop, `ger.${sufixo}`, "gerente");
  const barb = await amb.criarUsuario(ger.token, `barb.${sufixo}`, "barbeiro");
  const cx = await amb.criarUsuario(ger.token, `cx.${sufixo}`, "caixa");
  await amb.post("/api/funcionamento/salvar", ger.token, { dias: SEMANA });
  const corte = (await amb.post("/api/servicos", ger.token, { nome: "Corte", precoCentavos: 4000, duracaoMin: 30 })).dados.servico;
  return { ...amb, p, b, ger, barb, cx, corte };
}

describe("abertura em caráter especial", () => {
  test("domingo fechado: recusa marcar; depois de abrir em caráter especial, marca, mostra disponibilidade e ocupação", async () => {
    const amb = await cenario("esp1");
    const { post, get, ger, barb, corte } = amb;
    const dom = proximoDomingo();
    const corpo = { barbeiroId: barb.id, data: dom, hora: "10:00", servicoIds: [corte.id], cliente: { nome: "Cliente Natal" } };
    assert.equal((await post("/api/agenda", ger.token, corpo)).dados.codigo, "fora_do_horario", "domingo é fechado");
    // dia fechado na disponibilidade
    let disp = (await get(`/api/agenda/disponibilidade?data=${dom}&barbeiroId=${barb.id}`, ger.token)).dados;
    assert.equal(disp.profissionais[0].situacao, "fechado");
    assert.equal(disp.especial, undefined);

    const r = await post("/api/funcionamento/aberturas-especiais", ger.token, { data: dom, abre: "09:00", fecha: "14:00", motivo: "Abertura de Natal", intervaloIni: "11:30", intervaloFim: "12:00" });
    assert.equal(r.status, 201, JSON.stringify(r.dados));
    assert.equal(r.dados.aberturaEspecial.abre, "09:00");
    // agenda: aberto, só no horário especial, com a pausa
    disp = (await get(`/api/agenda/disponibilidade?data=${dom}&barbeiroId=${barb.id}`, ger.token)).dados;
    assert.equal(disp.profissionais[0].situacao, "aberto");
    assert.deepEqual(disp.profissionais[0].janela, { ini: "09:00", fim: "14:00" });
    assert.deepEqual(disp.especial, { motivo: "Abertura de Natal" });
    assert.ok(disp.profissionais[0].livres.includes("09:00"));
    assert.ok(!disp.profissionais[0].livres.includes("14:00"), "depois do fechamento especial não há horário");
    // marca dentro do horário especial (sem aceite); fora dele continua pedindo aceite
    const ok = await post("/api/agenda", ger.token, corpo);
    assert.equal(ok.status, 201, JSON.stringify(ok.dados));
    assert.equal((await post("/api/agenda", ger.token, { ...corpo, hora: "15:00", cliente: { nome: "Tarde" } })).dados.codigo, "fora_do_horario");
    assert.equal((await post("/api/agenda", ger.token, { ...corpo, hora: "11:30", cliente: { nome: "Pausa" } })).dados.codigo, "fora_do_horario", "cai na pausa");
    // barbeiro (que não trabalharia domingo) e caixa também enxergam o dia aberto
    assert.equal((await get(`/api/agenda/disponibilidade?data=${dom}`, barb.token)).dados.profissionais[0].situacao, "aberto");
    // ocupação (Mês/Semana): o dia deixa de ser "fechado" e leva o motivo
    const oc = (await get(`/api/agenda/ocupacao?inicio=${dom}&fim=${dom}`, ger.token)).dados.dias[0];
    assert.notEqual(oc.status, "fechado");
    assert.equal(oc.especial, "Abertura de Natal");
    // lista no Funcionamento
    const f = (await get("/api/funcionamento", ger.token)).dados;
    assert.equal(f.aberturasEspeciais.length, 1);
    assert.equal(f.aberturasEspeciais[0].data, dom);
    // auditoria
    assert.ok(amb.env.DB.raw.prepare("SELECT 1 FROM auditoria WHERE acao = 'abertura_especial_criada'").get());
  });

  test("validações e permissões: passado, horário, intervalo, repetido, data fechada; só a gestão; cancelar exige o dia sem horários", async () => {
    const amb = await cenario("esp2");
    const { post, get, ger, barb, cx, corte } = amb;
    const dom = proximoDomingo();
    const base = { data: dom, abre: "09:00", fecha: "14:00", motivo: "Natal" };
    for (const u of [barb, cx]) assert.equal((await post("/api/funcionamento/aberturas-especiais", u.token, base)).status, 403);
    assert.equal((await post("/api/funcionamento/aberturas-especiais", ger.token, { ...base, data: somarDias(hojeBrasil(), -1) })).status, 400);
    assert.equal((await post("/api/funcionamento/aberturas-especiais", ger.token, { ...base, abre: "15:00" })).status, 400);
    assert.equal((await post("/api/funcionamento/aberturas-especiais", ger.token, { ...base, intervaloIni: "08:00", intervaloFim: "09:30" })).status, 400);
    assert.equal((await post("/api/funcionamento/aberturas-especiais", ger.token, { ...base, motivo: "" })).status, 400);
    assert.equal((await post("/api/funcionamento/aberturas-especiais", ger.token, { ...base, data: somarDias(hojeBrasil(), 500) })).status, 400);
    const ok = await post("/api/funcionamento/aberturas-especiais", ger.token, base);
    assert.equal(ok.status, 201);
    assert.equal((await post("/api/funcionamento/aberturas-especiais", ger.token, base)).status, 409, "um por dia");
    // com horário marcado, não cancela
    await post("/api/agenda", ger.token, { barbeiroId: barb.id, data: dom, hora: "10:00", servicoIds: [corte.id], cliente: { nome: "Cliente" } });
    const id = ok.dados.aberturaEspecial.id;
    const nao = await post("/api/funcionamento/aberturas-especiais/cancelar", ger.token, { id, motivo: "Desistimos" });
    assert.equal(nao.status, 409);
    assert.match(nao.dados.erro, /horário\(s\) marcado/);
    // cancelar o horário e depois a abertura
    const ag = (await get(`/api/agenda?data=${dom}`, ger.token)).dados.agendamentos[0];
    await post("/api/agenda/situacao", ger.token, { id: ag.id, situacao: "cancelado", motivo: "Remarcado" });
    assert.equal((await post("/api/funcionamento/aberturas-especiais/cancelar", barb.token, { id, motivo: "Desistimos" })).status, 403);
    assert.equal((await post("/api/funcionamento/aberturas-especiais/cancelar", ger.token, { id, motivo: "Desistimos" })).status, 200);
    assert.equal((await get("/api/funcionamento", ger.token)).dados.aberturasEspeciais.length, 0);
    assert.equal((await get(`/api/agenda/disponibilidade?data=${dom}`, ger.token)).dados.profissionais[0].situacao, "fechado", "volta ao normal");
    // data fechada (feriado) bloqueia a abertura especial e vice-versa
    const df = await post("/api/funcionamento/datas-fechadas", ger.token, { dataIni: dom, motivo: "Reforma" });
    assert.equal(df.status, 201);
    assert.equal((await post("/api/funcionamento/aberturas-especiais", ger.token, base)).status, 409);
    await post("/api/funcionamento/datas-fechadas/desativar", ger.token, { id: df.dados.dataFechada.id, motivo: "Mudou" });
    assert.equal((await post("/api/funcionamento/aberturas-especiais", ger.token, base)).status, 201);
    assert.equal((await post("/api/funcionamento/datas-fechadas", ger.token, { dataIni: dom, motivo: "Reforma 2" })).status, 409, "não fecha sobre abertura especial");
  });

  test("página pública mostra a abertura especial; outra barbearia não vê nem usa", async () => {
    const amb = await cenario("esp3");
    const { post, get, ger, env } = amb;
    const dom = proximoDomingo();
    await get("/api/pagina", ger.token);
    await post("/api/pagina/slug", ger.token, { slug: "navalhaesp" });
    await post("/api/pagina/salvar", ger.token, { nomeExibicao: "Navalha & Co.", whatsapp: "(11) 90000-0000" });
    await post("/api/pagina/publicar", ger.token, { publicar: true });
    const abrir = async () => { const r = await worker.fetch(new Request("https://forblade.teste/navalhaesp", { headers: { "user-agent": "Mozilla/5.0" } }), env); return { status: r.status, texto: await r.text() }; };
    let pg = await abrir();
    assert.equal(pg.status, 200);
    assert.doesNotMatch(pg.texto, /caráter especial/);
    await post("/api/funcionamento/aberturas-especiais", ger.token, { data: dom, abre: "09:00", fecha: "14:00", motivo: "Natal <b>x</b>" });
    pg = await abrir();
    assert.match(pg.texto, /Abertura em caráter especial/);
    assert.match(pg.texto, new RegExp(`data-especial="${dom}"`));
    assert.match(pg.texto, /09:00 – 14:00/);
    assert.match(pg.texto, /Natal &lt;b&gt;x&lt;\/b&gt;/, "texto escapado");
    assert.match(pg.texto, /specialOpeningHoursSpecification/);
    // outra barbearia: não enxerga a abertura da primeira
    const outra = await cenario("esp4", amb, amb.p);
    assert.equal((await get("/api/funcionamento", outra.ger.token)).dados.aberturasEspeciais.length, 0);
    assert.equal((await get(`/api/agenda/disponibilidade?data=${dom}`, outra.ger.token)).dados.profissionais[0].situacao, "fechado");
    const id = amb.env.DB.raw.prepare("SELECT id FROM aberturas_especiais LIMIT 1").get().id;
    assert.equal((await post("/api/funcionamento/aberturas-especiais/cancelar", outra.ger.token, { id, motivo: "Tentativa" })).status, 404);
  });
});
