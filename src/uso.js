// Uso do app (pedido de 17/11/2026, fase de testes): o aparelho avisa qual tela abriu e, a cada minuto com o app
// aberto, que continua lá. O suporte (plataforma) vê por barbearia: quem está on-line, horários, duração dos acessos e
// telas usadas. NUNCA dados de clientes, valores ou lançamentos — só o nome da tela e horários.
import { json, HttpError, readJson, validId } from "./util.js";

const erro = (msg, status = 400) => { throw new HttpError(msg, status); };
const ONLINE_MIN = 3;   // on-line = sinal nos últimos 3 minutos
const agoraIso = () => new Date().toISOString();
const menosMin = m => new Date(Date.now() - m * 60000).toISOString();
const minutos = (a, b) => Math.max(0, Math.round((Date.parse(b) - Date.parse(a)) / 60000));

// Sinal do aparelho (qualquer pessoa da barbearia, já logada). tela = nome da rota (ex.: "agenda").
export async function rotaUso(ctx, path, method) {
  if (path !== "/uso" || method !== "POST") return null;
  if (!ctx.barbeariaId) return json({ ok: true });   // plataforma: não registra
  const input = await readJson(ctx.request);
  const tela = typeof input.tela === "string" && /^[a-z0-9-]{1,40}$/.test(input.tela) ? input.tela : null;
  const aparelho = input.aparelho === "celular" || input.aparelho === "computador" ? input.aparelho : null;
  const agora = agoraIso();
  const sessao = ctx.user.sessao_id;
  const cmds = [
    ctx.db.prepare(`INSERT INTO uso_sessoes (sessao_id, barbearia_id, usuario_id, inicio, ultimo, telas_qtd, aparelho) VALUES (?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(sessao_id) DO UPDATE SET ultimo = excluded.ultimo, telas_qtd = telas_qtd + excluded.telas_qtd,
                      aparelho = COALESCE(excluded.aparelho, aparelho)`)
      .bind(sessao, ctx.barbeariaId, ctx.user.id, agora, agora, tela ? 1 : 0, aparelho)
  ];
  if (tela) {
    cmds.push(ctx.db.prepare("INSERT INTO uso_telas (id, barbearia_id, usuario_id, sessao_id, tela, em) VALUES (?, ?, ?, ?, ?, ?)")
      .bind(crypto.randomUUID(), ctx.barbeariaId, ctx.user.id, sessao, tela, agora));
  }
  await ctx.db.batch(cmds);
  return json({ ok: true });
}

// Resumo para o painel da plataforma (lista de barbearias): último uso e quantos on-line agora.
export const SQL_USO_RESUMO = `
  (SELECT MAX(us.ultimo) FROM uso_sessoes us WHERE us.barbearia_id = b.id) AS uso_ultimo,
  (SELECT COUNT(DISTINCT us.usuario_id) FROM uso_sessoes us JOIN sessoes se ON se.id = us.sessao_id WHERE us.barbearia_id = b.id
     AND se.revogado_em IS NULL AND us.ultimo >= strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-${ONLINE_MIN} minutes')) AS uso_online`;

// Detalhe de uma barbearia (só a plataforma).
export async function usoDaBarbearia(ctx) {
  const url = new URL(ctx.request.url);
  const id = url.searchParams.get("id");
  if (!validId(id)) erro("Barbearia inválida.");
  const dias = Math.min(30, Math.max(1, parseInt(url.searchParams.get("dias") || "7", 10) || 7));
  const { db } = ctx;
  const b = await db.prepare("SELECT id, nome FROM barbearias WHERE id = ?").bind(id).first();
  if (!b) erro("Barbearia não encontrada.", 404);
  const desde = menosMin(dias * 1440);
  const online = menosMin(ONLINE_MIN);
  const [pessoas, sessoes, telas] = await Promise.all([
    db.prepare(`SELECT u.id, u.nome, u.perfil, u.ativo,
                  (SELECT MAX(s.ultimo) FROM uso_sessoes s WHERE s.usuario_id = u.id) AS ultimo,
                  (SELECT MAX(s.ultimo) FROM uso_sessoes s JOIN sessoes se ON se.id = s.sessao_id WHERE s.usuario_id = u.id AND se.revogado_em IS NULL) AS ultimo_aberta,
                  (SELECT COUNT(*) FROM uso_sessoes s WHERE s.usuario_id = u.id AND s.ultimo >= ?) AS acessos,
                  (SELECT COALESCE(SUM((julianday(s.ultimo) - julianday(s.inicio)) * 1440), 0) FROM uso_sessoes s WHERE s.usuario_id = u.id AND s.ultimo >= ?) AS minutos,
                  (SELECT COUNT(*) FROM uso_telas t WHERE t.usuario_id = u.id AND t.em >= ?) AS telas
                FROM usuarios u WHERE u.barbearia_id = ?
                ORDER BY u.ativo DESC, CASE u.perfil WHEN 'proprietario' THEN 0 WHEN 'gerente' THEN 1 WHEN 'barbeiro' THEN 2 ELSE 3 END, u.nome`)
      .bind(desde, desde, desde, id).all(),
    db.prepare(`SELECT s.*, u.nome, u.perfil, se.revogado_em FROM uso_sessoes s JOIN usuarios u ON u.id = s.usuario_id LEFT JOIN sessoes se ON se.id = s.sessao_id
                WHERE s.barbearia_id = ? AND s.ultimo >= ? ORDER BY s.ultimo DESC LIMIT 40`).bind(id, desde).all(),
    db.prepare(`SELECT tela, COUNT(*) AS vezes, COUNT(DISTINCT usuario_id) AS pessoas FROM uso_telas
                WHERE barbearia_id = ? AND em >= ? GROUP BY tela ORDER BY vezes DESC`).bind(id, desde).all()
  ]);
  const ids = sessoes.results.map(s => s.sessao_id);
  const caminhos = ids.length
    ? (await db.prepare(`SELECT sessao_id, tela, em FROM uso_telas WHERE barbearia_id = ? AND sessao_id IN (${ids.map(() => "?").join(",")}) ORDER BY em`)
      .bind(id, ...ids).all()).results
    : [];
  const porSessao = {};
  for (const c of caminhos) (porSessao[c.sessao_id] ||= []).push({ tela: c.tela, em: c.em });
  // acessos por dia (horário de Brasília)
  const diaBR = iso => new Date(Date.parse(iso) - 3 * 3600000).toISOString().slice(0, 10);
  const porDia = {};
  for (const s of sessoes.results) porDia[diaBR(s.inicio)] = (porDia[diaBR(s.inicio)] || 0) + 1;
  return json({
    barbearia: { id: b.id, nome: b.nome }, dias, agora: agoraIso(),
    // on-line = sinal nos últimos 3 min E não saiu do app (sessão não encerrada)
    onlineAgora: pessoas.results.filter(p => p.ultimo_aberta && p.ultimo_aberta >= online).length,
    pessoas: pessoas.results.map(p => ({
      id: p.id, nome: p.nome, perfil: p.perfil, ativo: Boolean(p.ativo), online: Boolean(p.ultimo_aberta && p.ultimo_aberta >= online),
      ultimoAcesso: p.ultimo || null, acessos: Number(p.acessos), minutos: Math.round(Number(p.minutos)), telas: Number(p.telas)
    })),
    acessos: sessoes.results.map(s => ({
      usuario: s.nome, perfil: s.perfil, inicio: s.inicio, ultimo: s.ultimo, duracaoMin: minutos(s.inicio, s.ultimo),
      online: s.ultimo >= online && !s.revogado_em, saiu: Boolean(s.revogado_em), aparelho: s.aparelho || null, telas: (porSessao[s.sessao_id] || []).slice(-60)
    })),
    telas: telas.results.map(t => ({ tela: t.tela, vezes: Number(t.vezes), pessoas: Number(t.pessoas) })),
    porDia: Object.entries(porDia).sort().map(([data, acessos]) => ({ data, acessos }))
  });
}
