// Flyers de divulgação (25/11/2026): publicar no catálogo, link com prévia, validade, tirar do ar, excluir, limites e isolamento.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { ambiente } from "./ambiente.js";
import worker from "../src/index.js";
import { MAX_FLYERS } from "../src/pagina.js";
import { hojeBrasil } from "../src/util.js";
import { somarDias } from "../src/agenda-util.js";

async function imagemFlyer(w = 108, h = 192) {
  const px = Buffer.alloc(w * h * 3);
  for (let i = 0; i < px.length; i++) px[i] = (i * 13) % 256;
  return new Uint8Array(await sharp(px, { raw: { width: w, height: h, channels: 3 } }).jpeg().toBuffer());
}
const meta = m => encodeURIComponent(JSON.stringify(m));
const enviar = (amb, token, m, bytes) => amb.chamar(`/api/pagina/flyers?meta=${meta(m)}`, { metodo: "POST", token, bruto: bytes });
async function abrir(amb, caminho) {
  const r = await worker.fetch(new Request(`https://forblade.teste${caminho}`, { headers: { "user-agent": "Mozilla/5.0 (iPhone)" } }), amb.env);
  return { status: r.status, texto: await r.text(), headers: r.headers };
}
async function cenario(sufixo, amb = ambiente(), p = null) {
  const plat = p || await amb.criarPlataforma();
  const b = await amb.criarBarbearia(plat, sufixo);
  const ger = await amb.criarUsuario(b.prop, `ger.${sufixo}`, "gerente");
  const barb = await amb.criarUsuario(ger.token, `barb.${sufixo}`, "barbeiro");
  const pg = (await amb.get("/api/pagina", ger.token)).dados;
  await amb.post("/api/pagina/salvar", ger.token, { whatsapp: "11900000000" });
  await amb.post("/api/pagina/publicar", ger.token, { publicar: true });
  return { ...amb, plat, b, ger, barb, slug: pg.pagina?.slug || pg.slug };
}

describe("flyers", () => {
  test("publica no catálogo; link com prévia do próprio flyer; validade; tirar do ar; excluir apaga o arquivo", async () => {
    const amb = await cenario("fl1");
    const { ger, get, post } = amb;
    const img = await imagemFlyer();
    const base = { titulo: "Corte + Barba por R$ 50", texto: "Só nesta semana", estilo: "neon", formato: "story", dados: { chamada: "PROMOÇÃO" } };
    // validações
    assert.equal((await enviar(amb, ger.token, { ...base, estilo: "outro" }, img)).status, 400);
    assert.equal((await enviar(amb, ger.token, { ...base, formato: "a4" }, img)).status, 400);
    assert.equal((await enviar(amb, ger.token, { ...base, titulo: "" }, img)).status, 400);
    assert.equal((await enviar(amb, ger.token, { ...base, validade: somarDias(hojeBrasil(), -1) }, img)).status, 400);
    assert.equal((await enviar(amb, ger.token, base, new Uint8Array(500).fill(7))).status, 415);
    assert.equal((await enviar(amb, ger.token, base, new Uint8Array(1300 * 1024).fill(7))).status, 413);
    assert.equal((await enviar(amb, amb.barb.token, base, img)).status, 403, "barbeiro não publica flyer");
    const r = await enviar(amb, ger.token, base, img);
    assert.equal(r.status, 201, JSON.stringify(r.dados));
    const f = r.dados.flyer;
    assert.equal(f.noAr, true);
    assert.match(f.link, new RegExp(`/${amb.slug}\\?promo=${f.id}$`));
    assert.deepEqual(f.dados, { chamada: "PROMOÇÃO" });
    // catálogo público: seção Promoções + link com prévia (og:image = flyer)
    let pg = await abrir(amb, `/${amb.slug}`);
    assert.match(pg.texto, /<h2 id="t-promo">Novidades e promoções<\/h2>/);
    assert.doesNotMatch(pg.texto, /pg-promo-whats/, "sem botão repetido em cada flyer: o pedido fica no botão fixo");
    assert.match(pg.texto, new RegExp(`id="promo-${f.id}"`));
    pg = await abrir(amb, `/${amb.slug}?promo=${f.id}`);
    assert.match(pg.texto, new RegExp(`<meta property="og:image" content="https://forblade.teste/f/${f.id}">`));
    assert.match(pg.texto, /<meta property="og:title" content="Corte \+ Barba por R\$ 50 — /);
    const arq = await worker.fetch(new Request(`https://forblade.teste/f/${f.id}`), amb.env);
    assert.equal(arq.status, 200);
    assert.equal(arq.headers.get("content-type"), "image/jpeg");
    // lista da gestão
    const l = (await get("/api/pagina/flyers", ger.token)).dados;
    assert.equal(l.flyers.length, 1);
    assert.equal(l.limite, MAX_FLYERS);
    // tirar do catálogo e voltar
    assert.equal((await post("/api/pagina/flyers/alterar", ger.token, { id: f.id, publicado: false })).status, 200);
    assert.doesNotMatch((await abrir(amb, `/${amb.slug}`)).texto, /t-promo/);
    assert.equal((await post("/api/pagina/flyers/alterar", ger.token, { id: f.id, publicado: true })).status, 200);
    assert.equal((await post("/api/pagina/flyers/alterar", ger.token, { id: f.id, publicado: true })).status, 400, "nada mudou");
    // validade vencida sai sozinha do catálogo
    amb.env.DB.raw.prepare("UPDATE paginas_flyers SET validade = '2000-01-01' WHERE id = ?").run(f.id);
    assert.doesNotMatch((await abrir(amb, `/${amb.slug}`)).texto, /t-promo/);
    assert.equal((await get("/api/pagina/flyers", ger.token)).dados.flyers[0].noAr, false);
    // excluir: some da lista e o arquivo é apagado; o registro fica (nada apagado no banco)
    assert.equal((await post("/api/pagina/flyers/excluir", ger.token, { id: f.id })).status, 200);
    assert.equal((await get("/api/pagina/flyers", ger.token)).dados.flyers.length, 0);
    assert.equal((await worker.fetch(new Request(`https://forblade.teste/f/${f.id}`), amb.env)).status, 404);
    assert.ok(amb.env.DB.raw.prepare("SELECT removido_em FROM paginas_flyers WHERE id = ?").get(f.id).removido_em);
    const aud = amb.env.DB.raw.prepare("SELECT acao FROM auditoria WHERE acao LIKE 'flyer_%' ORDER BY id").all().map(x => x.acao);
    assert.deepEqual(aud, ["flyer_publicado", "flyer_alterado", "flyer_alterado", "flyer_excluido"]);
  });

  test("limite de flyers guardados e isolamento entre barbearias", async () => {
    const amb = await cenario("fl2");
    const outra = await cenario("fl3", amb, amb.plat);
    const img = await imagemFlyer(60, 60);
    const m = { titulo: "Promo", estilo: "moderno", formato: "quadrado" };
    let id = null;
    for (let i = 0; i < MAX_FLYERS; i++) id = (await enviar(amb, amb.ger.token, m, img)).dados.flyer.id;
    assert.equal((await enviar(amb, amb.ger.token, m, img)).status, 409);
    // a outra barbearia não vê, não altera e não exclui
    assert.equal((await amb.get("/api/pagina/flyers", outra.ger.token)).dados.flyers.length, 0);
    assert.equal((await amb.post("/api/pagina/flyers/alterar", outra.ger.token, { id, publicado: false })).status, 404);
    assert.equal((await amb.post("/api/pagina/flyers/excluir", outra.ger.token, { id })).status, 404);
    assert.doesNotMatch((await abrir(amb, `/${outra.slug}`)).texto, /t-promo/);
    // ?promo de outra barbearia não muda a prévia
    assert.doesNotMatch((await abrir(amb, `/${outra.slug}?promo=${id}`)).texto, new RegExp(`og:image" content="[^"]*${id}`));
  });
});
