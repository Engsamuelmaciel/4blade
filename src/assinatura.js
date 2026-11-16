// Planos, cadastro da própria barbearia (página "Assinar") e cobrança pelo Asaas.
// Fluxo: a pessoa escolhe o plano → preenche os dados → o 4blade cria a barbearia (14 dias grátis), o cliente e a
// assinatura no Asaas → o Asaas avisa (webhook) cada pagamento → o acesso fica liberado até o fim do período pago.
// Atraso: aviso desde o 1º dia; bloqueio depois de TOLERANCIA_DIAS. Só o proprietário entra com a barbearia
// bloqueada por atraso, e só para ver e pagar a mensalidade.
import {
  json, fail, readJson, validLogin, normalizarLogin, textoLimpo, normalizarTelefone, exigirMotivo,
  hashPassword, auditoria, safeEqual, hojeBrasil, HttpError
} from "./util.js";
import {
  PLANOS, SITE_DISPONIVEL, MESES_DO_ANUAL, valorDoPlano, planoDaColunaAntiga
} from "./perfis.js";
import { clienteAsaas, asaasConfigurado } from "./asaas.js";
import { MODELOS_PADRAO } from "./cadastros.js";
import { contatoSuporte } from "./suporte.js";

export const TESTE_DIAS = 14;
export const TOLERANCIA_DIAS = 5;
export const TERMOS_VERSAO = "2026-11-16";

// Plano em vigor (SQL): a tabela nova manda; sem linha, vale a coluna antiga.
export const SQL_PLANO = "COALESCE(a.plano, CASE b.plano WHEN 'profissional' THEN 'pro' ELSE 'basico' END)";

// ---------- datas ----------
export function somaDias(d, n) {
  const x = new Date(`${d}T12:00:00Z`);
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
}
// Soma meses mantendo o dia (31/01 + 1 mês = 28 ou 29/02).
export function somaMeses(d, n) {
  const [a, m, dia] = d.split("-").map(Number);
  const alvo = new Date(Date.UTC(a, m - 1 + n, 1, 12));
  const ultimo = new Date(Date.UTC(alvo.getUTCFullYear(), alvo.getUTCMonth() + 1, 0, 12)).getUTCDate();
  alvo.setUTCDate(Math.min(dia, ultimo));
  return alvo.toISOString().slice(0, 10);
}
const diasEntre = (de, ate) => Math.round((Date.parse(`${ate}T12:00:00Z`) - Date.parse(`${de}T12:00:00Z`)) / 86400000);

// Pagamento com vencimento em `venc` cobre de venc até (venc + 1 mês ou 1 ano) − 1 dia.
export const coberturaDoPagamento = (venc, ciclo) => somaDias(somaMeses(venc, ciclo === "anual" ? 12 : 1), -1);

// ---------- situação ----------
// a = linha de assinaturas (ou campos equivalentes). Manual (criada pela plataforma) nunca bloqueia sozinha.
export function situacaoAssinatura(a, hoje = hojeBrasil()) {
  if (!a || a.origem !== "asaas" || !a.pago_ate) return { situacao: "manual", bloqueada: false };
  const pagoAte = a.pago_ate;
  const emTeste = Boolean(a.teste_ate) && !a.ultimo_pagamento_em && pagoAte === a.teste_ate;
  if (hoje <= pagoAte) {
    return {
      situacao: Number(a.cancelada) ? "cancelada_ate_fim" : emTeste ? "teste" : "em_dia",
      bloqueada: false, diasRestantes: diasEntre(hoje, pagoAte) + 1, pagoAte
    };
  }
  if (Number(a.cancelada)) return { situacao: "cancelada", bloqueada: true, pagoAte };
  const atraso = diasEntre(pagoAte, hoje);
  if (atraso <= TOLERANCIA_DIAS) {
    return { situacao: "atrasada", bloqueada: false, diasAtraso: atraso, diasParaBloqueio: TOLERANCIA_DIAS - atraso + 1, pagoAte };
  }
  return { situacao: "bloqueada", bloqueada: true, diasAtraso: atraso, pagoAte };
}

// ---------- validações ----------
function cpfValido(c) {
  if (!/^\d{11}$/.test(c) || /^(\d)\1{10}$/.test(c)) return false;
  for (const t of [9, 10]) {
    let s = 0;
    for (let i = 0; i < t; i++) s += Number(c[i]) * (t + 1 - i);
    if (((s * 10) % 11) % 10 !== Number(c[t])) return false;
  }
  return true;
}
function cnpjValido(c) {
  if (!/^\d{14}$/.test(c) || /^(\d)\1{13}$/.test(c)) return false;
  const calc = n => {
    const pesos = n === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const s = pesos.reduce((t, p, i) => t + Number(c[i]) * p, 0);
    const r = s % 11;
    return r < 2 ? 0 : 11 - r;
  };
  return calc(12) === Number(c[12]) && calc(13) === Number(c[13]);
}
export function normalizarDocumento(v) {
  if (typeof v !== "string") return null;
  const d = v.replace(/\D/g, "");
  return cpfValido(d) || cnpjValido(d) ? d : null;
}
const emailValido = v => typeof v === "string" && v.length <= 120 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.trim());

// ---------- dados públicos dos planos ----------
export function planosPublicos() {
  return {
    planos: Object.entries(PLANOS).map(([id, p]) => ({
      id, nome: p.nome, barbeiros: p.barbeiros, site: p.site,
      mensalCentavos: p.mensalCentavos, anualCentavos: p.mensalCentavos * MESES_DO_ANUAL
    })),
    siteDisponivel: SITE_DISPONIVEL,
    mesesDoAnual: MESES_DO_ANUAL,
    testeDias: TESTE_DIAS,
    toleranciaDias: TOLERANCIA_DIAS,
    termosVersao: TERMOS_VERSAO,
    assinaturaDisponivel: null   // preenchido na rota (depende da configuração)
  };
}

const descricaoAssinatura = (plano, ciclo) =>
  `4blade — Plano ${PLANOS[plano].nome} (${ciclo === "anual" ? "anual" : "mensal"})`;

// ---------- rotas SEM sessão ----------
export async function rotasPublicasAssinatura({ db, request, env, ipHash, limitar }, path, method) {
  if (path === "/planos" && method === "GET") {
    const c = await contatoSuporte(db);
    return json({ ...planosPublicos(), assinaturaDisponivel: asaasConfigurado(env), contato: { whatsapp: c.whatsapp, email: c.email } });
  }

  if (path === "/assinar" && method === "POST") {
    if (!(await limitar(`assinar:ip:${ipHash}`, 5, 3600))) return fail("Muitos cadastros deste aparelho. Aguarde 1 hora.", 429);
    const input = await readJson(request);
    const plano = input.plano;
    if (!PLANOS[plano]) return fail("Escolha um plano.");
    const ciclo = input.ciclo === "anual" ? "anual" : input.ciclo === "mensal" || input.ciclo === undefined ? "mensal" : null;
    if (!ciclo) return fail("Escolha mensal ou anual.");

    const nome = textoLimpo(input.barbearia, 2, 80);
    if (!nome) return fail("Informe o nome da barbearia (2 a 80 letras).");
    const donoNome = textoLimpo(input.nome, 3, 100);
    if (!donoNome) return fail("Informe o seu nome completo.");
    const documento = normalizarDocumento(input.documento);
    if (!documento) return fail("CPF ou CNPJ inválido. Confira os números.");
    const telefone = normalizarTelefone(input.telefone);
    if (!telefone) return fail("WhatsApp inválido (DDD + número).");
    if (!emailValido(input.email)) return fail("E-mail inválido.");
    const email = input.email.trim().toLowerCase();
    const login = normalizarLogin(input.login);
    if (!validLogin(login)) return fail("Usuário inválido: use 3 a 30 letras minúsculas, números, ponto ou hífen (sem espaço).");
    const senha = input.senha;
    if (typeof senha !== "string" || senha.length < 8 || senha.length > 128 || senha.toLowerCase() === login) {
      return fail("A senha precisa ter de 8 a 128 caracteres e ser diferente do usuário.");
    }
    if (input.aceiteTermos !== true) return fail("Para assinar, leia e aceite os termos de uso e a política de privacidade.");

    if (await db.prepare("SELECT 1 FROM usuarios WHERE login = ?").bind(login).first()) {
      return fail("Esse usuário já existe. Escolha outro.", 409);
    }
    if (await db.prepare("SELECT 1 FROM assinaturas WHERE documento = ?").bind(documento).first()) {
      return fail("Já existe uma barbearia cadastrada com este CPF/CNPJ. Entre com o seu usuário ou fale com o suporte do 4blade.", 409);
    }

    const asaas = clienteAsaas(env);   // 503 se ainda não configurado
    const barbeariaId = crypto.randomUUID();
    const propId = crypto.randomUUID();
    const hoje = hojeBrasil();
    const testeAte = somaDias(hoje, TESTE_DIAS - 1);
    const primeiroVenc = somaDias(hoje, TESTE_DIAS);
    const valor = valorDoPlano(plano, ciclo);

    // 1) Asaas: cliente + assinatura (1ª cobrança vence no dia seguinte ao fim do teste).
    const cliente = await asaas.criarCliente({ nome: donoNome, documento, email, telefone, barbeariaId });
    const assin = await asaas.criarAssinatura({
      clienteId: cliente.id, valorCentavos: valor, primeiroVencimento: primeiroVenc, ciclo,
      descricao: descricaoAssinatura(plano, ciclo), barbeariaId
    });

    // 2) Banco: tudo junto. Se falhar (ex.: alguém pegou o mesmo usuário no mesmo segundo), desfaz a assinatura no Asaas.
    const actx = { db, barbeariaId, usuarioId: propId, ipHash };
    try {
      await db.batch([
        db.prepare("INSERT INTO barbearias (id, nome, plano, telefone) VALUES (?, ?, ?, ?)")
          .bind(barbeariaId, nome, plano === "pro" ? "profissional" : "basico", telefone),
        db.prepare(`
          INSERT INTO usuarios (id, barbearia_id, login, nome, telefone, perfil, senha_hash, trocar_senha)
          VALUES (?, ?, ?, ?, ?, 'proprietario', ?, 0)
        `).bind(propId, barbeariaId, login, donoNome, telefone, await hashPassword(senha)),
        ...Object.entries(MODELOS_PADRAO).map(([tipo, texto]) =>
          db.prepare("INSERT INTO modelos_mensagem (id, barbearia_id, tipo, texto) VALUES (?, ?, ?, ?)")
            .bind(crypto.randomUUID(), barbeariaId, tipo, texto)),
        db.prepare(`
          INSERT INTO assinaturas (barbearia_id, plano, ciclo, site_horarios, valor_centavos, origem, documento, email,
            asaas_cliente_id, asaas_assinatura_id, teste_ate, pago_ate, proximo_vencimento,
            termos_versao, termos_aceitos_em, termos_ip_hash)
          VALUES (?, ?, ?, ?, ?, 'asaas', ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?)
        `).bind(barbeariaId, plano, ciclo, 0, valor, documento, email,
          cliente.id, assin.id, testeAte, testeAte, primeiroVenc, TERMOS_VERSAO, ipHash),
        auditoria(actx, "barbearia_assinou", barbeariaId, {
          depois: { nome, plano, ciclo, valor, proprietario: login, testeAte, termos: TERMOS_VERSAO }
        })
      ]);
    } catch (e) {
      try { await asaas.removerAssinatura(assin.id); } catch { /* fica para o suporte conferir no Asaas */ }
      if (/UNIQUE/i.test(String(e?.message))) return fail("Esse usuário ou CPF/CNPJ acabou de ser usado. Confira e tente de novo.", 409);
      throw e;
    }

    // 3) Link da 1ª cobrança (para quem quiser já deixar paga). Se o Asaas demorar, aparece depois em "Minha assinatura".
    let link = null;
    try {
      const pags = await asaas.pagamentosDaAssinatura(assin.id);
      link = pags?.data?.[0]?.invoiceUrl || null;
      if (link) await db.prepare("UPDATE assinaturas SET link_pagamento = ? WHERE barbearia_id = ?").bind(link, barbeariaId).run();
    } catch { /* sem link agora */ }

    return json({
      barbearia: { id: barbeariaId, nome, plano },
      login, testeAte, primeiroVencimento: primeiroVenc, valorCentavos: valor, linkPagamento: link
    }, 201);
  }

  if (path === "/asaas/webhook" && method === "POST") {
    return webhookAsaas({ db, request, env, ipHash });
  }
  return null;
}

// ---------- aviso do Asaas (webhook) ----------
const PAGO = new Set(["RECEIVED", "CONFIRMED", "RECEIVED_IN_CASH"]);
async function webhookAsaas({ db, request, env, ipHash }) {
  if (!env.ASAAS_WEBHOOK_TOKEN) return fail("Não configurado", 503);
  if (!safeEqual(request.headers.get("asaas-access-token") || "", env.ASAAS_WEBHOOK_TOKEN)) return fail("Não autorizado", 401);
  const ev = await readJson(request, 65536);
  const eventoId = typeof ev.id === "string" && ev.id.length <= 100 ? ev.id : null;
  const tipo = typeof ev.event === "string" ? ev.event.slice(0, 60) : null;
  if (!eventoId || !tipo) return fail("Aviso inválido");
  if (await db.prepare("SELECT 1 FROM assinatura_eventos WHERE id = ?").bind(eventoId).first()) {
    return json({ ok: true, repetido: true });
  }

  const pag = ev.payment && typeof ev.payment === "object" ? ev.payment : null;
  const subId = (pag?.subscription || ev.subscription?.id || null);
  const a = subId ? await db.prepare("SELECT * FROM assinaturas WHERE asaas_assinatura_id = ?").bind(String(subId)).first() : null;
  const registro = (resultado, extra = {}) => db.prepare(`
    INSERT OR IGNORE INTO assinatura_eventos (id, barbearia_id, evento, pagamento_id, assinatura_id, situacao, vencimento, valor_centavos, resultado)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(eventoId, a?.barbearia_id ?? null, tipo, pag?.id ?? null, subId ? String(subId) : null,
    extra.situacao ?? pag?.status ?? null, extra.vencimento ?? pag?.dueDate ?? null,
    extra.valor ?? (Number.isFinite(pag?.value) ? Math.round(pag.value * 100) : null), resultado);

  if (!a) {
    await registro("ignorado_sem_barbearia").run();
    return json({ ok: true });
  }
  const actx = { db, barbeariaId: a.barbearia_id, usuarioId: null, ipHash };

  if ((tipo === "PAYMENT_RECEIVED" || tipo === "PAYMENT_CONFIRMED") && pag?.id) {
    // Confere no próprio Asaas (não confia só no aviso).
    const real = await clienteAsaas(env).buscarPagamento(pag.id);
    if (!PAGO.has(real.status) || String(real.subscription) !== String(a.asaas_assinatura_id)) {
      await registro("ignorado_nao_confirmado", { situacao: real.status }).run();
      return json({ ok: true });
    }
    const venc = real.dueDate;
    const ate = coberturaDoPagamento(venc, a.ciclo);
    await db.batch([
      db.prepare(`
        UPDATE assinaturas SET
          pago_ate = CASE WHEN pago_ate IS NULL OR pago_ate < ? THEN ? ELSE pago_ate END,
          ultimo_pagamento_em = CURRENT_TIMESTAMP,
          link_pagamento = CASE WHEN link_pagamento = ? THEN NULL ELSE link_pagamento END,
          atualizado_em = CURRENT_TIMESTAMP
        WHERE barbearia_id = ?
      `).bind(ate, ate, real.invoiceUrl || "", a.barbearia_id),
      registro("pagamento_confirmado", { situacao: real.status, vencimento: venc, valor: Math.round(Number(real.value) * 100) }),
      auditoria(actx, "assinatura_paga", a.barbearia_id, { vencimento: venc, pagoAte: ate, pagamento: real.id })
    ]);
    return json({ ok: true });
  }

  if ((tipo === "PAYMENT_CREATED" || tipo === "PAYMENT_UPDATED" || tipo === "PAYMENT_OVERDUE") && pag) {
    const aberto = pag.status === "PENDING" || pag.status === "OVERDUE";
    const link = aberto && typeof pag.invoiceUrl === "string" && /^https:\/\//.test(pag.invoiceUrl) ? pag.invoiceUrl.slice(0, 300) : null;
    await db.batch([
      db.prepare(`
        UPDATE assinaturas SET link_pagamento = COALESCE(?, link_pagamento), proximo_vencimento = COALESCE(?, proximo_vencimento),
          atualizado_em = CURRENT_TIMESTAMP WHERE barbearia_id = ?
      `).bind(link, aberto && /^\d{4}-\d{2}-\d{2}$/.test(pag.dueDate || "") ? pag.dueDate : null, a.barbearia_id),
      registro(tipo === "PAYMENT_OVERDUE" ? "aviso_atraso" : "cobranca_registrada")
    ]);
    return json({ ok: true });
  }

  if (tipo === "SUBSCRIPTION_DELETED" || tipo === "SUBSCRIPTION_INACTIVATED") {
    await db.batch([
      db.prepare(`
        UPDATE assinaturas SET cancelada = 1, cancelada_em = COALESCE(cancelada_em, CURRENT_TIMESTAMP),
          motivo_cancelamento = COALESCE(motivo_cancelamento, 'Cancelada no Asaas'), atualizado_em = CURRENT_TIMESTAMP
        WHERE barbearia_id = ?
      `).bind(a.barbearia_id),
      registro("assinatura_cancelada"),
      auditoria(actx, "assinatura_cancelada_asaas", a.barbearia_id, { evento: tipo })
    ]);
    return json({ ok: true });
  }

  await registro("sem_acao").run();
  return json({ ok: true });
}

// ---------- rotas COM sessão (proprietário e gerente) ----------
export function assinaturaPublica(a, hoje = hojeBrasil()) {
  if (!a) return null;
  return {
    plano: a.plano, nomePlano: PLANOS[a.plano]?.nome, ciclo: a.ciclo, siteHorarios: Boolean(a.site_horarios),
    valorCentavos: Number(a.valor_centavos), origem: a.origem,
    testeAte: a.teste_ate || null, pagoAte: a.pago_ate || null, proximoVencimento: a.proximo_vencimento || null,
    linkPagamento: a.link_pagamento || null, cancelada: Boolean(Number(a.cancelada)), canceladaEm: a.cancelada_em || null,
    ...situacaoAssinatura(a, hoje)
  };
}

export async function rotasAssinatura(ctx, path, method) {
  if (path !== "/assinatura" && !path.startsWith("/assinatura/")) return null;
  const { db, request, user, env } = ctx;
  if (!user.barbearia_id || (user.perfil !== "proprietario" && user.perfil !== "gerente")) throw new HttpError("Sem permissão", 403);

  if (path === "/assinatura" && method === "GET") {
    let a = await db.prepare("SELECT * FROM assinaturas WHERE barbearia_id = ?").bind(ctx.barbeariaId).first();
    // Sem link guardado: pergunta ao Asaas qual cobrança está em aberto.
    if (a && a.origem === "asaas" && !a.link_pagamento && !Number(a.cancelada) && a.asaas_assinatura_id && asaasConfigurado(env)) {
      try {
        const pags = await clienteAsaas(env).pagamentosDaAssinatura(a.asaas_assinatura_id);
        const aberto = (pags?.data || []).filter(p => p.status === "PENDING" || p.status === "OVERDUE")
          .sort((x, y) => String(x.dueDate).localeCompare(String(y.dueDate)))[0];
        if (aberto?.invoiceUrl) {
          await db.prepare("UPDATE assinaturas SET link_pagamento = ?, proximo_vencimento = ? WHERE barbearia_id = ?")
            .bind(aberto.invoiceUrl, aberto.dueDate, ctx.barbeariaId).run();
          a = { ...a, link_pagamento: aberto.invoiceUrl, proximo_vencimento: aberto.dueDate };
        }
      } catch { /* mostra sem o link */ }
    }
    const pagos = await db.prepare(`
      SELECT vencimento, valor_centavos, recebido_em FROM assinatura_eventos
      WHERE barbearia_id = ? AND resultado = 'pagamento_confirmado' ORDER BY recebido_em DESC LIMIT 24
    `).bind(ctx.barbeariaId).all();
    const plano = a?.plano || planoDaColunaAntiga(user.barbearia_plano_coluna);
    return json({
      assinatura: assinaturaPublica(a) || { plano, nomePlano: PLANOS[plano]?.nome, origem: "manual", situacao: "manual", bloqueada: false },
      pagamentos: pagos.results.map(p => ({ vencimento: p.vencimento, valorCentavos: Number(p.valor_centavos || 0), recebidoEm: p.recebido_em })),
      podeCancelar: user.perfil === "proprietario" && a?.origem === "asaas" && !Number(a.cancelada)
    });
  }

  if (path === "/assinatura/cancelar" && method === "POST") {
    if (user.perfil !== "proprietario") throw new HttpError("Só o proprietário pode cancelar a assinatura.", 403);
    const input = await readJson(request);
    const motivo = exigirMotivo(input.motivo);
    const a = await db.prepare("SELECT * FROM assinaturas WHERE barbearia_id = ?").bind(ctx.barbeariaId).first();
    if (!a || a.origem !== "asaas") return fail("Esta barbearia não tem assinatura on-line. Fale com o suporte do 4blade.");
    if (Number(a.cancelada)) return fail("A assinatura já está cancelada.", 409);
    if (a.asaas_assinatura_id) await clienteAsaas(env).removerAssinatura(a.asaas_assinatura_id);
    await db.batch([
      db.prepare(`
        UPDATE assinaturas SET cancelada = 1, cancelada_em = CURRENT_TIMESTAMP, motivo_cancelamento = ?, link_pagamento = NULL,
          atualizado_em = CURRENT_TIMESTAMP WHERE barbearia_id = ? AND cancelada = 0
      `).bind(motivo, ctx.barbeariaId),
      auditoria(ctx, "assinatura_cancelada", ctx.barbeariaId, { motivo, acessoAte: a.pago_ate })
    ]);
    return json({ mensagem: `Assinatura cancelada. O sistema continua liberado até ${a.pago_ate.split("-").reverse().join("/")}.`, acessoAte: a.pago_ate });
  }

  return null;
}

// Plataforma muda o plano: grava na tabela nova e, se a cobrança é pelo Asaas, atualiza o valor lá.
export async function alterarPlanoAssinatura(ctx, barbeariaId, atual, novoPlano) {
  const { db, env } = ctx;
  const a = await db.prepare("SELECT * FROM assinaturas WHERE barbearia_id = ?").bind(barbeariaId).first();
  const ciclo = a?.ciclo || "mensal";
  const site = false;
  const valor = valorDoPlano(novoPlano, ciclo);
  if (a?.origem === "asaas" && a.asaas_assinatura_id && !Number(a.cancelada)) {
    await clienteAsaas(env).alterarAssinatura(a.asaas_assinatura_id, {
      valorCentavos: valor, ciclo, descricao: descricaoAssinatura(novoPlano, ciclo)
    });
  }
  return db.prepare(`
    INSERT INTO assinaturas (barbearia_id, plano, ciclo, site_horarios, valor_centavos, origem)
    VALUES (?, ?, ?, ?, ?, 'manual')
    ON CONFLICT(barbearia_id) DO UPDATE SET plano = excluded.plano, site_horarios = excluded.site_horarios,
      valor_centavos = excluded.valor_centavos, atualizado_em = CURRENT_TIMESTAMP
  `).bind(barbeariaId, novoPlano, ciclo, site ? 1 : 0, valor);
}
