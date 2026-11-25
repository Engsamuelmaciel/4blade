// Página da Barbearia (24/11/2026): endereço, publicação, página pública, fotos, números, segurança e isolamento.
// Dados FICTÍCIOS (Navalha & Co., Rua Exemplo, 123, (11) 90000-0000).
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { ambiente } from "./ambiente.js";
import worker from "../src/index.js";
import { validSlug, sugerirSlug, semExif, tipoImagem } from "../src/pagina.js";

// Imagem de teste (ruído para não ficar minúscula). com EXIF falso de localização no JPEG.
async function imagem(formato = "jpeg", lado = 120) {
  const px = Buffer.alloc(lado * lado * 3);
  for (let i = 0; i < px.length; i++) px[i] = (i * 37 + (i >> 5) * 11) % 256;
  const buf = await sharp(px, { raw: { width: lado, height: lado, channels: 3 } })[formato]().toBuffer();
  if (formato !== "jpeg") return new Uint8Array(buf);
  const dados = Buffer.from("Exif\0\0GPS-SAO-PAULO", "latin1");
  const exif = Buffer.concat([Buffer.from([0xff, 0xe1, 0x00, dados.length + 2]), dados]);   // segmento APP1 (EXIF)
  return new Uint8Array(Buffer.concat([buf.subarray(0, 2), exif, buf.subarray(2)]));
}

async function cenario(sufixo = "pg", amb = ambiente(), plataforma = null) {
  const p = plataforma || await amb.criarPlataforma();
  const b = await amb.criarBarbearia(p, sufixo);
  const ger = await amb.criarUsuario(b.prop, `ger.${sufixo}`, "gerente");
  const barb = await amb.criarUsuario(ger.token, `barb.${sufixo}`, "barbeiro");
  const cx = await amb.criarUsuario(ger.token, `cx.${sufixo}`, "caixa");
  await amb.post("/api/funcionamento/salvar", ger.token, { dias: [0, 1, 2, 3, 4, 5, 6].map(dia => ({ dia, aberto: true, abre: "00:00", fecha: "23:30" })) });
  const corte = (await amb.post("/api/servicos", ger.token, { nome: "Corte masculino", precoCentavos: 4000, duracaoMin: 30 })).dados.servico;
  const barba = (await amb.post("/api/servicos", ger.token, { nome: "Barba completa", precoCentavos: 3000, duracaoMin: 20 })).dados.servico;
  return { ...amb, p, b, ger, barb, cx, corte, barba };
}
// Página pública (fora da /api)
async function abrir(amb, caminho, ua = "Mozilla/5.0 (iPhone)") {
  const r = await worker.fetch(new Request(`https://forblade.teste${caminho}`, { headers: { "user-agent": ua } }), amb.env);
  return { status: r.status, texto: r.status === 301 ? "" : await r.text(), headers: r.headers };
}
const enviarFoto = (amb, token, tipo, bytes, extra = "") =>
  amb.chamar(`/api/pagina/foto?tipo=${tipo}${extra}`, { metodo: "POST", token, bruto: bytes });

describe("página da barbearia", () => {
  test("endereço: sugestão, válido, reservado e repetido", async () => {
    assert.equal(sugerirSlug("Navalha & Co."), "navalha-e-co");
    assert.equal(sugerirSlug("Barbearia São João"), "barbearia-sao-joao");
    assert.ok(validSlug("navalhaeco"));
    for (const ruim of ["ab", "api", "entrar", "Navalha", "na valha", "-navalha", "navalha-", "na--valha", "a".repeat(41), "barbeária"]) assert.equal(validSlug(ruim), false, ruim);
    const amb = await cenario("pga");
    const { post, get, ger } = amb;
    const r = await get("/api/pagina", ger.token);
    assert.equal(r.status, 200, JSON.stringify(r.dados));
    assert.equal(r.dados.pagina.slug, "barbearia-teste-pga", "nasce com endereço sugerido pelo nome");
    assert.equal(r.dados.pagina.publicada, false);
    assert.equal((await post("/api/pagina/slug", ger.token, { slug: "api" })).status, 400, "reservado");
    assert.equal((await post("/api/pagina/slug", ger.token, { slug: "Com Espaço" })).status, 400);
    assert.equal((await post("/api/pagina/slug", ger.token, { slug: "navalhaeco" })).status, 200);
    // outra barbearia não pega o mesmo endereço
    const outra = await cenario("pgb", amb, amb.p);
    assert.equal((await get("/api/pagina/slug-livre?slug=navalhaeco", outra.ger.token)).dados.livre, false);
    assert.equal((await post("/api/pagina/slug", outra.ger.token, { slug: "navalhaeco" })).status, 409);
  });

  test("quem edita: só dono e gerente", async () => {
    const amb = await cenario("pgc");
    assert.equal((await amb.get("/api/pagina", amb.b.prop)).status, 200);
    assert.equal((await amb.get("/api/pagina", amb.barb.token)).status, 403);
    assert.equal((await amb.get("/api/pagina", amb.cx.token)).status, 403);
    assert.equal((await amb.post("/api/pagina/publicar", amb.barb.token, { publicar: true })).status, 403);
  });

  test("publicar, página pública, WhatsApp com mensagem pronta, texto malicioso escapado e endereço antigo redirecionando", async () => {
    const amb = await cenario("pgd");
    const { post, get, ger, corte, barba, env } = amb;
    await get("/api/pagina", ger.token);
    await post("/api/pagina/slug", ger.token, { slug: "navalhaeco" });
    const s = await post("/api/pagina/salvar", ger.token, {
      nomeExibicao: "Navalha & Co.", frase: "Corte de respeito <script>alert(1)</script>", sobre: "Desde 2012.",
      whatsapp: "(11) 90000-0000", instagram: "@navalhaeco", endRua: "Rua Exemplo", endNumero: "123", endBairro: "Centro",
      endCidade: "São Paulo", endUf: "sp", endCep: "01000000", formas: ["pix", "cartao"], tema: "vintage",
      servicos: [{ id: barba.id, visivel: true, descricao: "Toalha quente" }, { id: corte.id, visivel: true }]
    });
    assert.equal(s.status, 200, JSON.stringify(s.dados));
    // ainda não publicada: indisponível (sem dados da barbearia)
    let pg = await abrir(amb, "/navalhaeco");
    assert.equal(pg.status, 404);
    assert.match(pg.texto, /não está disponível/);
    assert.doesNotMatch(pg.texto, /Navalha/);
    // prévia: só com o link de prévia
    const pv = await post("/api/pagina/previa", ger.token, {});
    pg = await abrir(amb, pv.dados.caminho);
    assert.equal(pg.status, 200);
    assert.match(pg.texto, /Prévia/);
    assert.match(pg.headers.get("x-robots-tag") || "", /noindex/);
    // publica
    assert.equal((await post("/api/pagina/publicar", ger.token, { publicar: true })).status, 200);
    pg = await abrir(amb, "/navalhaeco");
    assert.equal(pg.status, 200);
    assert.match(pg.headers.get("content-security-policy"), /script-src 'self'/);
    assert.match(pg.texto, /<h1>Navalha &amp; Co\.<\/h1>/);
    assert.doesNotMatch(pg.texto, /<script>alert/, "texto do barbeiro nunca vira código");
    assert.match(pg.texto, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
    assert.match(pg.texto, /Barba completa[\s\S]*Corte masculino/, "ordem escolhida");
    assert.match(pg.texto, /Toalha quente/);
    assert.match(pg.texto, /R\$ 40,00/);
    assert.match(pg.texto, /<body class="modo-claro cor-ferrugem"/, "tema antigo vintage = ferrugem em fundo claro");
    // Aparência (25/11/2026): cor × modo; inválidos recusados; auditado
    assert.equal((await post("/api/pagina/salvar", ger.token, { cor: "roxo" })).status, 400);
    assert.equal((await post("/api/pagina/salvar", ger.token, { modo: "neon" })).status, 400);
    assert.equal((await post("/api/pagina/salvar", ger.token, { cor: "oceano", modo: "escuro" })).status, 200);
    assert.match((await abrir(amb, "/navalhaeco")).texto, /<html lang="pt-BR" class="modo-escuro cor-oceano">/);
    assert.equal((await post("/api/pagina/salvar", ger.token, { modo: "pb" })).status, 200);
    assert.match((await abrir(amb, "/navalhaeco")).texto, /<body class="modo-pb cor-oceano"/);
    const edAp = (await get("/api/pagina", ger.token)).dados;
    assert.deepEqual(edAp.pagina.aparencia, { cor: "oceano", modo: "pb" });
    assert.equal(edAp.cores.length, 10);
    assert.deepEqual(edAp.modos, ["claro", "escuro", "pb"]);
    const audAp = env.DB.raw.prepare("SELECT detalhes FROM auditoria WHERE acao = 'pagina_editada' ORDER BY rowid DESC LIMIT 1").get();
    assert.match(audAp.detalhes, /"aparencia":\{"antes":\{"cor":"oceano","modo":"escuro"\},"depois":\{"cor":"oceano","modo":"pb"\}\}/);
    assert.match(pg.texto, /"@type":"HairSalon"/);
    assert.match(pg.texto, /rel="canonical" href="https:\/\/forblade\.teste\/navalhaeco"/);
    assert.match(pg.texto, /Rua Exemplo, 123/);
    // Mapa dentro da página (25/11/2026): iframe do Google com o endereço; a política de segurança libera só esse mapa
    assert.match(pg.texto, /<iframe src="https:\/\/maps\.google\.com\/maps\?q=Rua%20Exemplo%2C%20123[^"]*output=embed"/);
    assert.match(pg.headers.get("content-security-policy"), /frame-src https:\/\/maps\.google\.com https:\/\/www\.google\.com;/);
    assert.doesNotMatch(pg.headers.get("content-security-policy"), /script-src[^;]*google/);
    assert.match(pg.texto, /São Paulo\/SP/);
    assert.match(pg.texto, /instagram\.com\/navalhaeco/);
    // 25/11/2026: ícone do Instagram em SVG; "Telefone" só com o que o gerente digitou (não cai no telefone do cadastro)
    assert.match(pg.texto, /class="pg-insta"[^>]*><svg class="pg-ico"/);
    env.DB.raw.prepare("UPDATE barbearias SET telefone = '11988887777' WHERE id = (SELECT barbearia_id FROM paginas WHERE slug = 'navalhaeco')").run();
    let pt = await abrir(amb, "/navalhaeco");
    assert.doesNotMatch(pt.texto, /href="tel:/, "telefone do cadastro não aparece sozinho");
    assert.equal((await post("/api/pagina/salvar", ger.token, { telefone: "(11) 90000-0000" })).status, 200);
    assert.doesNotMatch((await abrir(amb, "/navalhaeco")).texto, /href="tel:/, "igual ao WhatsApp não repete");
    assert.equal((await post("/api/pagina/salvar", ger.token, { telefone: "(11) 3333-4444" })).status, 200);
    pt = await abrir(amb, "/navalhaeco");
    assert.match(pt.texto, /href="tel:\+551133334444"/);
    // rodapé: cartão do 4blade (sem WhatsApp do suporte → pedido de teste grátis; com → WhatsApp da equipe)
    assert.match(pt.texto, /<img src="\/icons\/logo\.png" alt="4blade"/);
    assert.match(pt.texto, /href="\/#\/teste-gratis" >Fale com a equipe 4blade<\/a>/);
    env.DB.raw.prepare("INSERT INTO plataforma_config (chave, valor) VALUES ('suporte_whatsapp', '11955550000')").run();
    pt = await abrir(amb, "/navalhaeco");
    const fale = decodeURIComponent(pt.texto.match(/href="https:\/\/wa\.me\/5511955550000\?text=([^"]+)"[^>]*>Fale com a equipe 4blade/)[1]);
    assert.match(fale, /^Olá, equipe 4blade! Vi a página da Navalha & Co\. e quero uma página assim/);
    assert.equal((await post("/api/pagina/salvar", ger.token, { telefone: "" })).status, 200);
    const msg = decodeURIComponent(pg.texto.match(/id="pg-solicitar" data-evento="whatsapp" href="https:\/\/wa\.me\/5511900000000\?text=([^"]+)"/)[1]);
    assert.equal(msg, "Olá, Navalha & Co.! Vim pela sua página e quero agendar um horário.");
    // Catálogo enxuto (25/11/2026): sem link "Agendar" por serviço; cada linha leva os dados para o "Solicitar meu horário" montar a mensagem
    assert.doesNotMatch(pg.texto, /\?text=[^"]*Corte%20masculino/);
    assert.match(pg.texto, /class="pg-servico" data-servico="[^"]+" data-nome="Corte masculino" data-preco="4000" data-dur="30"/);
    assert.match(pg.texto, /aria-label="Escolher Corte masculino"/);
    assert.doesNotMatch(pg.texto, /Horários livres/, "agenda escondida por padrão");
    // esconde um serviço; liga os horários livres
    await post("/api/pagina/salvar", ger.token, { servicos: [{ id: barba.id, visivel: false }, { id: corte.id, visivel: true }], mostrarHorarios: true });
    pg = await abrir(amb, "/navalhaeco");
    assert.doesNotMatch(pg.texto, /Barba completa/);
    assert.match(pg.texto, /Horários livres/);
    assert.match(decodeURIComponent(pg.texto.match(/class="pg-hora" data-evento="whatsapp" href="https:\/\/wa\.me\/5511900000000\?text=([^"]+)"/)[1]), /Vim pela sua página\. Vocês têm horário .* às \d\d:\d\d\?/);
    // troca o endereço: o antigo leva para o novo
    assert.equal((await post("/api/pagina/slug", ger.token, { slug: "navalha-co" })).status, 200);
    pg = await abrir(amb, "/navalhaeco");
    assert.equal(pg.status, 301);
    assert.equal(pg.headers.get("location"), "/navalha-co");
    assert.equal((await abrir(amb, "/navalha-co")).status, 200);
    // outra barbearia não usa o endereço antigo enquanto ele redireciona
    const outra = await cenario("pge", amb, amb.p);
    assert.equal((await post("/api/pagina/slug", outra.ger.token, { slug: "navalhaeco" })).status, 409);
    // despublica
    await post("/api/pagina/publicar", ger.token, { publicar: false });
    assert.equal((await abrir(amb, "/navalha-co")).status, 404);
    // auditoria: criação, edição, endereço, publicação
    const acoes = env.DB.raw.prepare("SELECT acao FROM auditoria WHERE acao LIKE 'pagina_%'").all().map(x => x.acao);
    for (const a of ["pagina_criada", "pagina_editada", "pagina_endereco_alterado", "pagina_publicada", "pagina_despublicada"]) assert.ok(acoes.includes(a), a);
  });

  test("barbearia bloqueada: página indisponível; rotas do sistema não viram página", async () => {
    const amb = await cenario("pgf");
    const { post, get, ger, p, b } = amb;
    await get("/api/pagina", ger.token);
    await post("/api/pagina/slug", ger.token, { slug: "bloqueada-teste" });
    await post("/api/pagina/publicar", ger.token, { publicar: true });
    assert.equal((await abrir(amb, "/bloqueada-teste")).status, 200);
    assert.equal((await post("/api/plataforma/barbearias/alterar", p, { id: b.id, bloqueada: true, motivo: "Teste de bloqueio" })).status, 200);
    assert.equal((await abrir(amb, "/bloqueada-teste")).status, 404);
    assert.equal((await abrir(amb, "/entrar")).texto, "TELA", "rota reservada continua sendo o app");
    assert.equal((await abrir(amb, "/")).texto, "TELA");
    assert.equal((await abrir(amb, "/endereco-que-nao-existe")).status, 404);
  });

  test("fotos: tipo pelo conteúdo, EXIF removido, tamanho, troca da logo, limite da galeria, excluir apaga o arquivo", async () => {
    const amb = await cenario("pgg");
    const { post, get, ger, env } = amb;
    await get("/api/pagina", ger.token);
    const jpg = await imagem("jpeg");
    assert.ok(Buffer.from(jpg).includes(Buffer.from("GPS-SAO-PAULO")));
    let r = await enviarFoto(amb, ger.token, "logo", jpg);
    assert.equal(r.status, 201, JSON.stringify(r.dados));
    const logo1 = r.dados.foto.id;
    const guardada = [...env.FOTOS.mapa.values()][0].dados;
    assert.equal(tipoImagem(guardada), "image/jpeg");
    assert.ok(!Buffer.from(guardada).includes(Buffer.from("GPS-SAO-PAULO")), "localização (EXIF) removida");
    assert.ok((await sharp(Buffer.from(guardada)).metadata()).width === 120, "imagem continua válida");
    // tipo errado (texto disfarçado), grande demais
    assert.equal((await enviarFoto(amb, ger.token, "galeria", new TextEncoder().encode("<svg onload=alert(1)>".repeat(10)))).status, 415);
    assert.equal((await enviarFoto(amb, ger.token, "galeria", new Uint8Array(800 * 1024))).status, 413);
    // nova logo substitui a antiga (arquivo antigo apagado, registro guardado)
    r = await enviarFoto(amb, ger.token, "logo", await imagem("png"));
    assert.equal(r.status, 201);
    assert.equal(env.FOTOS.mapa.size, 1);
    assert.ok(env.DB.raw.prepare("SELECT removida_em FROM paginas_fotos WHERE id = ?").get(logo1).removida_em);
    // galeria: até 12
    const webp = await imagem("webp");
    const ids = [];
    for (let i = 0; i < 12; i++) ids.push((await enviarFoto(amb, ger.token, "galeria", webp, `&legenda=Corte%20${i}`)).dados.foto.id);
    assert.equal((await enviarFoto(amb, ger.token, "galeria", webp)).status, 409);
    // reordenar e legenda
    assert.equal((await post("/api/pagina/foto/alterar", ger.token, { id: ids[1], mover: -1, legenda: "Degradê" })).status, 200);
    const ed = (await get("/api/pagina", ger.token)).dados;
    assert.equal(ed.fotos.galeria[0].id, ids[1]);
    assert.equal(ed.fotos.galeria[0].legenda, "Degradê");
    // excluir: o arquivo sai do armazenamento
    assert.equal((await post("/api/pagina/foto/excluir", ger.token, { id: ids[0] })).status, 200);
    assert.ok(![...env.FOTOS.mapa.keys()].some(k => k.endsWith(ids[0])));
    // /f/<id> serve a foto (e não serve a excluída)
    let f = await worker.fetch(new Request(`https://forblade.teste/f/${ids[1]}`), env);
    assert.equal(f.status, 200);
    assert.equal(f.headers.get("content-type"), "image/webp");
    f = await worker.fetch(new Request(`https://forblade.teste/f/${ids[0]}`), env);
    assert.equal(f.status, 404);
    assert.ok(env.DB.raw.prepare("SELECT 1 FROM auditoria WHERE acao = 'pagina_foto_excluida'").get());
    // limite travado por barbearia: 15 MB no total (aqui simulado com fotos já guardadas)
    const bid = env.DB.raw.prepare("SELECT barbearia_id FROM paginas_fotos WHERE id = ?").get(ids[1]).barbearia_id;
    env.DB.raw.prepare("INSERT INTO paginas_fotos (id, barbearia_id, tipo, mime, bytes) VALUES (?, ?, 'capa', 'image/webp', ?)").run(crypto.randomUUID(), bid, 15 * 1024 * 1024 - 500);
    r = await enviarFoto(amb, ger.token, "logo", jpg);
    assert.equal(r.status, 409);
    assert.match(r.dados.erro, /15 MB/);
    // a função de limpeza também tira o EXIF do WEBP
    assert.equal(tipoImagem(semExif(webp, "image/webp")), "image/webp");
  });

  test("isolamento: outra barbearia não mexe nas fotos nem vê a página de edição da primeira", async () => {
    const amb = await cenario("pgh");
    const outra = await cenario("pgi", amb, amb.p);
    await amb.get("/api/pagina", amb.ger.token);
    const r = await enviarFoto(amb, amb.ger.token, "capa", await imagem("jpeg"));
    const id = r.dados.foto.id;
    assert.equal((await amb.post("/api/pagina/foto/excluir", outra.ger.token, { id })).status, 404);
    assert.equal((await amb.post("/api/pagina/foto/alterar", outra.ger.token, { id, legenda: "x" })).status, 404);
    const deOutra = (await amb.get("/api/pagina", outra.ger.token)).dados;
    assert.equal(deOutra.fotos.capa, null);
    assert.notEqual(deOutra.pagina.slug, (await amb.get("/api/pagina", amb.ger.token)).dados.pagina.slug);
    // foto de profissional de OUTRA barbearia: recusado
    assert.equal((await enviarFoto(amb, outra.ger.token, "equipe", await imagem("jpeg"), `&usuarioId=${amb.barb.id}`)).status, 404);
    // equipe/serviço de outra barbearia: recusado
    assert.equal((await amb.post("/api/pagina/salvar", outra.ger.token, { servicos: [{ id: amb.corte.id, visivel: true }] })).status, 400);
    assert.equal((await amb.post("/api/pagina/salvar", outra.ger.token, { equipe: [{ id: amb.barb.id, visivel: true }] })).status, 400);
  });

  test("números: visitas (sem robôs) e toques nos botões; equipe na página", async () => {
    const amb = await cenario("pgj");
    const { post, get, ger, barb } = amb;
    await get("/api/pagina", ger.token);
    await post("/api/pagina/slug", ger.token, { slug: "numeros-teste" });
    await post("/api/pagina/salvar", ger.token, { whatsapp: "11900000000", equipe: [{ id: barb.id, visivel: true, especialidade: "Degradê" }] });
    await post("/api/pagina/publicar", ger.token, { publicar: true });
    await abrir(amb, "/numeros-teste");
    await abrir(amb, "/numeros-teste");
    const pg = await abrir(amb, "/numeros-teste", "facebookexternalhit/1.1");
    assert.match(pg.texto, /Degradê/);
    assert.match(pg.texto, /Pessoa/, "primeiro nome do profissional");
    assert.equal((await amb.chamar("/api/pagina/evento", { metodo: "POST", corpo: { slug: "numeros-teste", tipo: "whatsapp" } })).status, 200);
    assert.equal((await amb.chamar("/api/pagina/evento", { metodo: "POST", corpo: { slug: "numeros-teste", tipo: "hack" } })).status, 400);
    const n = (await get("/api/pagina/numeros?periodo=7", ger.token)).dados;
    assert.equal(n.totais.visita, 2, "robô (prévia do link) não conta");
    assert.equal(n.totais.whatsapp, 1);
    assert.equal(n.dias.length, 7);
  });
});
