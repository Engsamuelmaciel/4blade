// Dados FICTÍCIOS para a versão de demonstração local (usado por: node test/servidor-local.mjs 8787 --demo).
// Cria uma barbearia pronta para clicar: equipe, serviços, produtos, clientes, funcionamento, horários e caixa aberto.
import { hojeBrasil } from "../src/util.js";
import { somarDias } from "../src/agenda-util.js";

export const SENHA_DEMO = "Demo-4blade-2026";

export async function semearDemonstracao(amb) {
  const ok = async (r, o) => { if (r.status >= 300) throw new Error(`${o}: ${JSON.stringify(r.dados)}`); return r.dados; };
  const plat = (await amb.login("suporte", "Nova-suporte-senha")).dados.token;
  const b = await ok(await amb.post("/api/plataforma/barbearias", plat, {
    nome: "Barbearia Demonstração", plano: "basico", proprietario: { nome: "Paulo Proprietário", login: "dono.demo" }
  }), "barbearia");
  const prop = await amb.ativar("dono.demo", b.senhaProvisoria, SENHA_DEMO);
  const ids = {};
  for (const [perfil, nome, login, com] of [
    ["gerente", "Gustavo Gerente", "gerente.demo", 4000],
    ["barbeiro", "Bruno Barbeiro", "barbeiro.demo", 5000],
    ["barbeiro", "Rafael Barbeiro", "rafael.demo", 4500],
    ["caixa", "Carla Caixa", "caixa.demo", 0]
  ]) {
    const r = await ok(await amb.post("/api/usuarios", prop, { perfil, nome, login, comissaoServicoBp: com, comissaoProdutoBp: com ? 1000 : 0 }), login);
    ids[login] = r.usuario.id;
    await amb.ativar(login, r.senhaProvisoria, SENHA_DEMO);
  }
  const ger = (await amb.login("gerente.demo", SENHA_DEMO)).dados.token;
  const dias = [0, 1, 2, 3, 4, 5, 6].map(dia => dia === 0
    ? { dia, aberto: false }
    : { dia, aberto: true, abre: "09:00", fecha: "20:00", intervaloIni: "12:00", intervaloFim: "13:00" });
  // hoje e amanhã sempre abertos, para dar para testar em qualquer dia
  for (const d of [hojeBrasil(), somarDias(hojeBrasil(), 1)]) {
    const w = new Date(`${d}T12:00:00Z`).getUTCDay();
    dias[w] = { dia: w, aberto: true, abre: "09:00", fecha: "20:00", intervaloIni: "12:00", intervaloFim: "13:00" };
  }
  await ok(await amb.post("/api/funcionamento/salvar", ger, { dias }), "funcionamento");
  const s = {};
  for (const [nome, preco, dur] of [["Corte masculino", 4000, 30], ["Barba completa", 3000, 20], ["Corte + barba", 6500, 50], ["Pigmentação", 5000, 40]]) {
    s[nome] = (await ok(await amb.post("/api/servicos", ger, { nome, precoCentavos: preco, duracaoMin: dur }), nome)).servico.id;
  }
  for (const [nome, preco, cod] of [["Pomada modeladora", 4500, "7890000000011"], ["Óleo para barba", 3850, null], ["Shampoo anticaspa", 3200, null]]) {
    await ok(await amb.post("/api/produtos", ger, { nome, precoCentavos: preco, codigo: cod, estoqueMinimo: 2 }), nome);
  }
  const hoje = hojeBrasil();
  const marcar = (barbeiro, data, hora, servs, telefone, nome) => amb.post("/api/agenda", ger, {
    barbeiroId: ids[barbeiro], data, hora, servicoIds: servs.map(x => s[x]),
    cliente: { telefone, nome, aceiteLgpd: true }
  });
  await marcar("barbeiro.demo", hoje, "09:00", ["Corte masculino"], "11 90000-0001", "Diego Cliente Fictício");
  await marcar("barbeiro.demo", hoje, "10:00", ["Corte + barba"], "11 90000-0002", "Eduardo Cliente Fictício");
  await marcar("rafael.demo", hoje, "09:30", ["Barba completa"], "11 90000-0003", "Fábio Cliente Fictício");
  await marcar("rafael.demo", hoje, "14:00", ["Pigmentação"], "11 90000-0004", "Gilberto Cliente Fictício");
  await marcar("barbeiro.demo", somarDias(hoje, 1), "15:00", ["Corte masculino"], "11 90000-0005", "Heitor Cliente Fictício");
  const cx = (await amb.login("caixa.demo", SENHA_DEMO)).dados.token;
  await ok(await amb.post("/api/caixa/abrir", cx, { trocoCentavos: 10000 }), "caixa");
}
