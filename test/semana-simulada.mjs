// Semana simulada (dados FICTÍCIOS) nos últimos 7 dias, igual à do teste automático da E4 (test/gestao.test.js):
// 2 barbeiros (50%/10% e 40%/15%), 8 atendimentos, 3 vendas, vales e 3 contas. Uso: servidor-local.mjs --semana
// Números esperados na semana: bruto 535,00 · comissões 178,00 · custo produtos 80,00 · lucro 277,00.
import { hojeBrasil } from "../src/util.js";
import { somarDias } from "../src/agenda-util.js";

export const SENHA_SEMANA = "Senha-Semana-2026";

export async function semearSemana(amb) {
  const AGORA = Date.now;
  const hoje = hojeBrasil();
  const dia = i => somarDias(hoje, i - 6);   // dia(0) = 6 dias atrás ... dia(6) = hoje
  const emDia = data => { Date.now = () => Date.parse(`${data}T15:00:00Z`); };
  const ok = async (rp, o) => { const r = await rp; if (r.status >= 300) throw new Error(`${o}: ${JSON.stringify(r.dados)}`); return r.dados; };
  const { post, get } = amb;
  try {
    const plat = (await amb.login("suporte", "Nova-suporte-senha")).dados.token;
    const b = await ok(await post("/api/plataforma/barbearias", plat, { nome: "Barbearia Semana Fictícia", proprietario: { nome: "Paulo Proprietário", login: "dono.semana" } }), "barbearia");
    const prop = await amb.ativar("dono.semana", b.senhaProvisoria, SENHA_SEMANA);
    const tok = {};
    const id = {};
    for (const [perfil, nome, login, s, p] of [["gerente", "Gustavo Gerente", "gerente.semana", 4000, 1000], ["barbeiro", "Ana Barbeira", "ana.semana", 5000, 1000],
      ["barbeiro", "Beto Barbeiro", "beto.semana", 4000, 1500], ["caixa", "Carla Caixa", "caixa.semana", 0, 0]]) {
      const r = await ok(await post("/api/usuarios", prop, { perfil, nome, login, comissaoServicoBp: s, comissaoProdutoBp: p }), login);
      id[login] = r.usuario.id;
      tok[login] = await amb.ativar(login, r.senhaProvisoria, SENHA_SEMANA);
    }
    const ger = tok["gerente.semana"], A = tok["ana.semana"], B = tok["beto.semana"], cx = tok["caixa.semana"];
    await ok(await post("/api/funcionamento/salvar", ger, { dias: [0, 1, 2, 3, 4, 5, 6].map(d => ({ dia: d, aberto: true, abre: "08:00", fecha: "20:00" })) }), "func");
    const corte = (await ok(await post("/api/servicos", ger, { nome: "Corte", precoCentavos: 4000, duracaoMin: 30 }), "s")).servico;
    const barba = (await ok(await post("/api/servicos", ger, { nome: "Barba", precoCentavos: 3000, duracaoMin: 30 }), "s")).servico;
    const pomada = (await ok(await post("/api/produtos", ger, { nome: "Pomada", precoCentavos: 4500, estoqueMinimo: 3 }), "p")).produto;
    await ok(await post("/api/estoque/entrada", ger, { produtoId: pomada.id, quantidade: 6, custoUnitCentavos: 2000, fornecedor: "Distribuidora Fictícia" }), "entrada");
    amb.env.DB.raw.prepare("UPDATE estoque_movimentos SET criado_em = ?").run(`${dia(0)} 12:00:00`);
    let n = 0;
    const atender = async (t, itens, pagamentos) => {
      n++;
      const m = await ok(await post("/api/agenda", t, { data: hojeBrasil(), hora: `${String(8 + n).padStart(2, "0")}:00`, servicoIds: itens.map(([s]) => s.id),
        cliente: { telefone: `11 9${String(n).padStart(4, "0")}-2222`, nome: `Cliente Fictício ${n}`, aceiteLgpd: true } }), "marcar");
      await ok(await post("/api/agenda/finalizar", t, { id: m.agendamento.id, itens: itens.map(([s, v]) => ({ servicoId: s.id, precoCobradoCentavos: v })),
        pagamentos: pagamentos.map(([forma, valorCentavos]) => ({ forma, valorCentavos })) }), "finalizar");
    };
    const vender = (t, q, forma) => ok(post("/api/vendas", t, { itens: [{ produtoId: pomada.id, quantidade: q }], pagamentos: [{ forma, valorCentavos: 4500 * q }] }).then(r => r), "venda");
    const abrir = troco => ok(post("/api/caixa/abrir", cx, { trocoCentavos: troco }).then(r => r), "abrir");
    const fechar = async (falta = 0) => {
      const e = (await get("/api/caixa/hoje", cx)).dados.totais.dinheiroEsperadoCentavos;
      await ok(await post("/api/caixa/fechar", cx, { contadoCentavos: e - falta, observacao: falta ? "Falta (fictícia)" : null }), "fechar");
    };
    emDia(dia(0)); await abrir(0); await atender(A, [[corte, 4000]], [["pix", 4000]]); await atender(B, [[barba, 3000]], [["dinheiro", 3000]]); await fechar();
    emDia(dia(1)); await abrir(0); await atender(A, [[corte, 4000], [barba, 3000]], [["credito", 7000]]); await vender(A, 1, "pix"); await fechar();
    emDia(dia(2)); await abrir(0); await atender(B, [[corte, 3500]], [["debito", 3500]]);
    await ok(await post("/api/vales", ger, { barbeiroId: id["ana.semana"], valorCentavos: 2000, descricao: "Adiantamento" }), "vale"); await fechar();
    emDia(dia(3)); await abrir(0); await atender(B, [[corte, 4000]], [["pix", 4000]]); await vender(B, 2, "dinheiro");
    const alug = (await ok(await post("/api/contas", ger, { descricao: "Aluguel do salão", categoria: "aluguel", valorCentavos: 150000, vencimento: dia(3), recorrente: true }), "conta")).conta;
    await ok(await post("/api/contas/pagar", ger, { id: alug.id }), "pagar"); await fechar();
    emDia(dia(4)); await abrir(0); await atender(A, [[corte, 4000]], [["dinheiro", 4000]]); await vender(cx, 1, "pix");
    await ok(await post("/api/vales", ger, { barbeiroId: id["beto.semana"], valorCentavos: 5000 }), "vale");
    await ok(await post("/api/contas", ger, { descricao: "Conta de luz", categoria: "luz", valorCentavos: 20000, vencimento: dia(4) }), "conta");   // fica aberta
    emDia(dia(5)); await abrir(5000); await atender(A, [[barba, 3000]], [["pix", 3000]]); await fechar(1000);
    emDia(dia(6)); await abrir(50000); await atender(B, [[corte, 4000], [barba, 3000]], [["pix", 7000]]);
    const forn = (await ok(await post("/api/contas", ger, { descricao: "Distribuidora (fictícia)", categoria: "fornecedor", valorCentavos: 30000, vencimento: dia(6) }), "conta")).conta;
    await ok(await post("/api/contas/pagar", ger, { id: forn.id, comCaixa: true }), "pagar forn");
  } finally {
    Date.now = AGORA;
  }
}
