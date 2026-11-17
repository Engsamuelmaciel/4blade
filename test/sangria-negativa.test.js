// Sangria sem dinheiro na gaveta (pedido de 17/11/2026): aceita com o aceite de quem lança; saldo negativo; entra no financeiro.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { ambiente } from "./ambiente.js";
import { hojeBrasil } from "../src/util.js";

const HOJE = hojeBrasil();

async function cenario(sufixo = "sg", amb = ambiente(), plataforma = null) {
  const p = plataforma || await amb.criarPlataforma();
  const b = await amb.criarBarbearia(p, sufixo);
  const ger = await amb.criarUsuario(b.prop, `ger.${sufixo}`, "gerente");
  const cx = await amb.criarUsuario(ger.token, `cx.${sufixo}`, "caixa");
  return { ...amb, p, b, ger, cx };
}

describe("sangria com saldo negativo", () => {
  test("caixa ainda não aberto: pede aceite; com aceite abre o caixa (troco 0) e fica −20,00", async () => {
    const { post, get, cx, ger, env } = await cenario();
    const corpo = { tipo: "sangria", valorCentavos: 2000, motivo: "Lanche na padaria (Pix)" };
    const r = await post("/api/caixa/movimento", cx.token, corpo);
    assert.equal(r.status, 409);
    assert.equal(r.dados.codigo, "saldo_negativo");
    assert.equal(r.dados.caixaSeraAberto, true);
    assert.equal(env.DB.raw.prepare("SELECT COUNT(*) n FROM caixas").get().n, 0, "sem aceite nada é gravado");
    const ok = await post("/api/caixa/movimento", cx.token, { ...corpo, aceiteSaldoNegativo: true });
    assert.equal(ok.status, 201, JSON.stringify(ok.dados));
    assert.match(ok.dados.mensagem, /saldo negativo/);
    const t = (await get("/api/caixa/hoje", cx.token)).dados.totais;
    assert.deepEqual([t.dinheiroEsperadoCentavos, t.saldoNegativoCentavos, t.sangriasCentavos], [-2000, 2000, 2000]);
    assert.ok(env.DB.raw.prepare("SELECT 1 FROM auditoria WHERE acao = 'caixa_sangria' AND detalhes LIKE '%saldoNegativoAceito%'").get(), "aceite fica registrado");
    // relatório financeiro: retirada é saída (custo)
    const f = (await get(`/api/financeiro?periodo=dia&data=${HOJE}`, ger.token)).dados;
    assert.equal(f.saidas.retiradasCentavos, 2000);
    assert.equal(f.totais.saidasCentavos, 2000);
    assert.equal(f.totais.saldoCentavos, -2000);
    // fechar: na gaveta deveria haver 0,00 → contado 0 = sem diferença
    const fe = await post("/api/caixa/fechar", cx.token, { contadoCentavos: 0 });
    assert.equal(fe.status, 200, JSON.stringify(fe.dados));
    assert.equal(fe.dados.fechamento.diferencaCentavos, 0);
  });

  test("caixa aberto com pouco dinheiro: pede aceite; suprimento continua normal; isolamento", async () => {
    const amb = await cenario("sg2");
    const { post, get, cx } = amb;
    await post("/api/caixa/abrir", cx.token, { trocoCentavos: 1000 });
    const r = await post("/api/caixa/movimento", cx.token, { tipo: "sangria", valorCentavos: 3000, motivo: "Gás" });
    assert.equal(r.status, 409);
    assert.deepEqual([r.dados.caixaSeraAberto, r.dados.naGavetaCentavos, r.dados.ficaCentavos], [false, 1000, -2000]);
    assert.equal((await post("/api/caixa/movimento", cx.token, { tipo: "sangria", valorCentavos: 500, motivo: "Troco" })).status, 201, "dentro do saldo: sem aviso");
    assert.equal((await post("/api/caixa/movimento", cx.token, { tipo: "sangria", valorCentavos: 3000, motivo: "Gás", aceiteSaldoNegativo: true })).status, 201);
    assert.equal((await get("/api/caixa/hoje", cx.token)).dados.totais.dinheiroEsperadoCentavos, -2500);
    const outra = await cenario("sg3", amb, amb.p);
    assert.equal((await get("/api/caixa/hoje", outra.cx.token)).dados.caixa, null);
  });
});
