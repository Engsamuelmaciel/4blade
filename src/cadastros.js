// Cadastros da barbearia (especificação, seção 3): serviços, produtos, clientes e modelos de mensagem.
// Tudo filtrado pela barbearia da sessão. Nada é apagado: desativar com motivo. Toda mudança auditada (antes/depois).
import {
  json, fail, HttpError, readJson, validId, textoLimpo, textoOpcional, validCentavos, validDate,
  normalizarTelefone, exigirMotivo, auditoria, diferenca
} from "./util.js";
import { isGestao } from "./perfis.js";

// Caixa (recepção) também cuida de clientes: ver, cadastrar e editar (desativar continua com a gestão).
const cuidaDeClientes = (user, nome) => nome === "clientes" && user.perfil === "caixa";
function exigirEdicao(ctx, nome) {
  exigirBarbearia(ctx);
  if (!isGestao(ctx.user) && !cuidaDeClientes(ctx.user, nome)) throw new HttpError("Sem permissão", 403);
}
import { telefoneReal, MODELOS_ADICIONAIS_PADRAO } from "./agenda-util.js";
import { comandosEntrada, lerEstoqueInicial } from "./estoque.js";
import { exigirBarbearia, exigirGestao } from "./usuarios.js";

export const CAMPOS_MENSAGEM = ["cliente", "data", "hora", "barbeiro", "servico", "barbearia"];
export const MODELOS_PADRAO = {
  lembrete: "Olá, {cliente}! Lembrete do seu horário na {barbearia}: {data} às {hora} com {barbeiro} ({servico}). Até lá!",
  proposta: "Olá, {cliente}! Aqui é da {barbearia}. Temos um horário para você: {data} às {hora} com {barbeiro} ({servico}). Podemos confirmar?"
};

// ---------- leitores de campo: devolvem o valor para o banco ou lançam erro com mensagem clara ----------
const erro = msg => { throw new HttpError(msg, 400); };
const ler = {
  nome: (v, rotulo = "o nome") => textoLimpo(v, 2, 80) ?? erro(`Informe ${rotulo} (2 a 80 letras).`),
  centavos: (v, rotulo) => (validCentavos(v) ? v : erro(`${rotulo} inválido (em centavos, de 0 a R$ 100.000,00).`)),
  inteiro: (min, max, rotulo) => v => (Number.isInteger(v) && v >= min && v <= max ? v : erro(`${rotulo} deve ser um número inteiro de ${min} a ${max}.`)),
  bool: rotulo => v => (typeof v === "boolean" ? (v ? 1 : 0) : erro(`${rotulo} inválido.`)),
  dataOpcional: rotulo => v => {
    if (v === null || v === "") return null;
    return validDate(v) ? v : erro(`${rotulo} inválida (AAAA-MM-DD).`);
  },
  codigoOpcional: v => {
    if (v === null || v === "") return null;
    if (typeof v !== "string" || !/^[A-Za-z0-9.-]{1,40}$/.test(v.trim())) return erro("Código inválido (só letras, números, ponto e hífen; até 40).");
    return v.trim();
  },
  telefone: v => normalizarTelefone(v) ?? erro("Telefone inválido: informe DDD + número (ex.: 11 91234-5678)."),
  observacao: v => { const t = textoOpcional(v, 500); return t === false ? erro("Observação muito longa (até 500 letras).") : t; }
};

// ---------- definição de cada cadastro ----------
const CADASTROS = {
  servicos: {
    tabela: "servicos",
    singular: "servico",
    campos: {
      nome: { col: "nome", ler: v => ler.nome(v, "o nome do serviço"), obrig: true },
      precoCentavos: { col: "preco_centavos", ler: v => ler.centavos(v, "Preço"), obrig: true },
      duracaoMin: { col: "duracao_min", ler: ler.inteiro(5, 480, "Duração (minutos)"), obrig: true }
    },
    unico: { col: "nome", msg: "Já existe um serviço com esse nome.", semCaixa: true },
    ordem: "ativo DESC, nome",
    publico: r => ({
      id: r.id, nome: r.nome, precoCentavos: r.preco_centavos, duracaoMin: r.duracao_min,
      ativo: Boolean(r.ativo), motivoDesativacao: r.motivo_desativacao || null
    }),
    // Todos os perfis da barbearia veem serviços ativos (nome, preço, duração).
    publicoRestrito: r => ({ id: r.id, nome: r.nome, precoCentavos: r.preco_centavos, duracaoMin: r.duracao_min, ativo: true }),
    leituraRestrita: true
  },
  produtos: {
    tabela: "produtos",
    singular: "produto",
    campos: {
      nome: { col: "nome", ler: v => ler.nome(v, "o nome do produto"), obrig: true },
      codigo: { col: "codigo", ler: ler.codigoOpcional, padrao: null },
      precoCentavos: { col: "preco_centavos", ler: v => ler.centavos(v, "Preço de venda"), obrig: true },
      validade: { col: "validade", ler: ler.dataOpcional("Validade"), padrao: null },
      estoqueMinimo: { col: "estoque_minimo", ler: ler.inteiro(0, 100000, "Estoque mínimo"), padrao: 0 },
      mostrarSite: { col: "mostrar_site", ler: ler.bool("Mostrar no site"), padrao: 0 }
    },
    unico: { col: "codigo", msg: "Já existe um produto com esse código." },
    ordem: "ativo DESC, nome",
    // Gestão vê custo e margem. Margem = (preço − custo) ÷ preço, em centésimos de % (null sem custo ainda).
    publico: r => ({
      id: r.id, nome: r.nome, codigo: r.codigo || null, precoCentavos: r.preco_centavos,
      custoMedioCentavos: r.custo_medio_centavos,
      margemBp: r.custo_medio_centavos > 0 && r.preco_centavos > 0
        ? Math.round(((r.preco_centavos - r.custo_medio_centavos) * 10000) / r.preco_centavos)
        : null,
      validade: r.validade || null, estoqueMinimo: r.estoque_minimo, mostrarSite: Boolean(r.mostrar_site),
      saldo: r.saldo ?? 0, usoInterno: Boolean(r.uso_interno),
      ativo: Boolean(r.ativo), motivoDesativacao: r.motivo_desativacao || null
    }),
    // Barbeiro e caixa: só nome, preço e disponível (ativo e com saldo). NUNCA custo ou margem. O caixa vê também o saldo (para vender).
    publicoRestrito: (r, user) => ({
      id: r.id, nome: r.nome, precoCentavos: r.preco_centavos, disponivel: Boolean(r.ativo) && r.saldo > 0,
      ...(user?.perfil === "caixa" ? { saldo: r.saldo } : {})
    }),
    selectLista: "SELECT p.*, COALESCE(e.saldo, 0) AS saldo, EXISTS (SELECT 1 FROM produtos_uso_interno ui WHERE ui.produto_id = p.id) AS uso_interno FROM produtos p LEFT JOIN produto_estoque e ON e.produto_id = p.id WHERE p.barbearia_id = ?",
    leituraRestrita: true
  },
  clientes: {
    tabela: "clientes",
    singular: "cliente",
    campos: {
      nome: { col: "nome", ler: v => ler.nome(v, "o nome do cliente"), obrig: true },
      telefone: { col: "telefone", ler: ler.telefone, obrig: true },
      observacao: { col: "observacao", ler: ler.observacao, padrao: null },
      aceiteLgpd: { col: "aceite_lgpd", ler: ler.bool("Aceite LGPD"), obrig: true }
    },
    unico: { col: "telefone", msg: "Já existe um cliente com esse telefone." },
    ordem: "ativo DESC, nome",
    // Apelido fica em clientes_apelidos (migração 0016); a lista já traz junto.
    selectLista: "SELECT clientes.*, (SELECT ap.apelido FROM clientes_apelidos ap WHERE ap.cliente_id = clientes.id) AS apelido FROM clientes WHERE barbearia_id = ?",
    ativoCol: "ativo",
    publico: r => ({
      id: r.id, nome: r.nome, apelido: r.apelido || null, telefone: telefoneReal(r.telefone), observacao: r.observacao || null,
      aceiteLgpd: Boolean(r.aceite_lgpd), aceiteLgpdEm: r.aceite_lgpd_em || null,
      ativo: Boolean(r.ativo), motivoDesativacao: r.motivo_desativacao || null, criadoEm: r.criado_em
    }),
    leituraRestrita: false,
    validarNovo: v => {
      if (v.aceite_lgpd !== 1) erro("Para cadastrar, o cliente precisa aceitar o uso do telefone para o atendimento (LGPD).");
    }
  }
};

async function conferirUnico(ctx, def, valores, idIgnorar = null) {
  const u = def.unico;
  if (!u || valores[u.col] === null || valores[u.col] === undefined) return;
  const cond = u.semCaixa ? `lower(${u.col}) = lower(?)` : `${u.col} = ?`;
  const r = await ctx.db.prepare(
    `SELECT 1 FROM ${def.tabela} WHERE barbearia_id = ? AND ${cond} AND id <> ?`
  ).bind(ctx.barbeariaId, valores[u.col], idIgnorar || "").first();
  if (r) throw new HttpError(u.msg, 409);
}

// Apelido: opcional, até 40 letras (vazio = sem apelido).
function lerApelido(v) {
  if (v === undefined || v === null || String(v).trim() === "") return null;
  const t = textoLimpo(v, 1, 40);
  if (!t) throw new HttpError("Apelido muito longo (até 40 letras).", 400);
  return t;
}
// Um registro com as colunas da lista (clientes: com o apelido).
const lerRegistro = (ctx, nome, def, id) => ctx.db.prepare(`${def.selectLista || `SELECT * FROM ${def.tabela} WHERE barbearia_id = ?`} AND ${nome === "produtos" ? "p.id" : "id"} = ?`).bind(ctx.barbeariaId, id).first();

async function rotasCadastro(ctx, nome, def, path, method) {
  const { db, request, user } = ctx;
  const base = `/${nome}`;

  if (path === base && method === "GET") {
    exigirBarbearia(ctx);
    const gestao = isGestao(user) || cuidaDeClientes(user, nome);
    if (!gestao && !def.leituraRestrita) return fail("Sem permissão", 403);
    const url = new URL(request.url);
    let sql = def.selectLista || `SELECT * FROM ${def.tabela} WHERE barbearia_id = ?`;
    const params = [ctx.barbeariaId];
    if (!gestao) sql += ` AND ${def.ativoCol || (def.selectLista ? "p.ativo" : "ativo")} = 1`;
    // Material de uso da barbearia (lâminas, cremes…) não aparece para quem vende.
    if (!gestao && nome === "produtos") sql += " AND NOT EXISTS (SELECT 1 FROM produtos_uso_interno ui WHERE ui.produto_id = p.id)";
    if (nome === "clientes") { sql += " AND id NOT IN (SELECT cliente_id FROM clientes_excluidos WHERE barbearia_id = ?)"; params.push(ctx.barbeariaId); }
    const busca = (url.searchParams.get("busca") || "").trim().slice(0, 60);
    if (busca && nome === "clientes") {
      const digitos = busca.replace(/\D/g, "");
      const apelido = "EXISTS (SELECT 1 FROM clientes_apelidos ap WHERE ap.cliente_id = clientes.id AND ap.apelido LIKE ?)";
      sql += digitos.length >= 3 ? ` AND ((telefone LIKE ? AND telefone NOT LIKE 'sem:%') OR nome LIKE ? OR ${apelido})` : ` AND (nome LIKE ? OR ${apelido})`;
      if (digitos.length >= 3) params.push(`%${digitos}%`);
      params.push(`%${busca.replace(/[%_]/g, "")}%`, `%${busca.replace(/[%_]/g, "")}%`);
    }
    sql += ` ORDER BY ${def.ordem} LIMIT 500`;
    const r = await db.prepare(sql).bind(...params).all();
    return json({ [nome]: r.results.map(x => (gestao ? def.publico(x) : def.publicoRestrito(x, user))) });
  }

  if (path === base && method === "POST") {
    exigirEdicao(ctx, nome);
    const input = await readJson(request);
    const valores = {};
    for (const [api, c] of Object.entries(def.campos)) {
      if (input[api] === undefined || input[api] === null) {
        if (c.obrig) {
          valores[c.col] = c.ler(input[api]);   // dá a mensagem certa de campo faltando
        } else valores[c.col] = c.padrao;
      } else valores[c.col] = c.ler(input[api]);
    }
    def.validarNovo?.(valores);
    // Produto novo pode já entrar com estoque (quantidade + custo): grava junto, no mesmo lote.
    const estoqueInicial = nome === "produtos" ? lerEstoqueInicial(input.estoqueInicial) : null;
    await conferirUnico(ctx, def, valores);
    const id = crypto.randomUUID();
    const extras = nome === "clientes" ? { aceite_lgpd_em: new Date().toISOString(), aceite_lgpd_por: user.id } : {};
    const cols = ["id", "barbearia_id", ...Object.keys(valores), ...Object.keys(extras)];
    const vals = [id, ctx.barbeariaId, ...Object.values(valores), ...Object.values(extras)];
    const apelido = nome === "clientes" ? lerApelido(input.apelido) : null;
    await db.batch([
      db.prepare(`INSERT INTO ${def.tabela} (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`).bind(...vals),
      auditoria(ctx, `${def.singular}_criado`, id, { depois: apelido ? { ...valores, apelido } : valores }),
      ...(apelido ? [db.prepare("INSERT INTO clientes_apelidos (cliente_id, barbearia_id, apelido) VALUES (?, ?, ?)").bind(id, ctx.barbeariaId, apelido)] : []),
      ...(estoqueInicial ? comandosEntrada(ctx, { id }, { q: estoqueInicial.q, c: estoqueInicial.c, validade: valores.validade ?? null }) : [])
    ]);
    const novo = await lerRegistro(ctx, nome, def, id);
    return json({ [def.singular]: def.publico(novo) }, 201);
  }

  // Excluir cliente: sai das listas/busca/marcação; histórico guardado; telefone liberado. Gestão: qualquer um.
  // Caixa: só cadastro sem histórico (ex.: duplicado por engano). Com nota (promissória) em aberto: ninguém.
  if (nome === "clientes" && path === "/clientes/excluir" && method === "POST") {
    exigirEdicao(ctx, nome);
    const input = await readJson(request);
    if (!validId(input.id)) return fail("Cliente inválido.");
    const motivo = exigirMotivo(input.motivo);
    const c = await db.prepare("SELECT * FROM clientes WHERE id = ? AND barbearia_id = ?").bind(input.id, ctx.barbeariaId).first();
    if (!c) return fail("Cliente não encontrado.", 404);
    if (await db.prepare("SELECT 1 FROM clientes_excluidos WHERE cliente_id = ?").bind(c.id).first()) return fail("Esse cliente já foi excluído.", 409);
    if (await db.prepare("SELECT 1 FROM promissorias WHERE cliente_id = ? AND barbearia_id = ? AND situacao = 'aberta'").bind(c.id, ctx.barbeariaId).first()) {
      return fail("Esse cliente tem nota (promissória) em aberto: receba ou cancele a nota antes de excluir.", 409);
    }
    if (!isGestao(user)) {
      const hist = await db.prepare(`SELECT (SELECT COUNT(*) FROM agendamentos WHERE cliente_id = ?1 AND barbearia_id = ?2)
                                          + (SELECT COUNT(*) FROM vendas WHERE cliente_id = ?1 AND barbearia_id = ?2)
                                          + (SELECT COUNT(*) FROM promissorias WHERE cliente_id = ?1 AND barbearia_id = ?2) AS n`).bind(c.id, ctx.barbeariaId).first();
      if (Number(hist.n) > 0) return fail("Esse cliente já tem atendimentos ou vendas: só o gerente ou o proprietário pode excluir.", 403);
    }
    await db.batch([
      db.prepare(`INSERT INTO clientes_excluidos (cliente_id, barbearia_id, nome, telefone_original, motivo, excluido_por) VALUES (?, ?, ?, ?, ?, ?)`)
        .bind(c.id, ctx.barbeariaId, c.nome, telefoneReal(c.telefone), motivo, user.id),
      db.prepare(`UPDATE clientes SET ativo = 0, motivo_desativacao = ?, telefone = 'sem:' || id, atualizado_em = CURRENT_TIMESTAMP
                  WHERE id = ? AND barbearia_id = ?`).bind(`Excluído: ${motivo}`, c.id, ctx.barbeariaId),
      auditoria(ctx, "cliente_excluido", c.id, { motivo, antes: { nome: c.nome, telefone: telefoneReal(c.telefone), ativo: c.ativo }, depois: { excluido: true } })
    ]);
    return json({ mensagem: "Cliente excluído." });
  }

  if (path === `${base}/alterar` && method === "POST") {
    exigirEdicao(ctx, nome);
    const input = await readJson(request);
    if (!isGestao(user) && input.ativo !== undefined) return fail("Só o gerente ou o proprietário desativa ou reativa.", 403);
    if (!validId(input.id)) return fail("Registro inválido.");
    // Sempre dentro da barbearia da sessão: id de outra barbearia = "não encontrado".
    const atual = await db.prepare(`SELECT * FROM ${def.tabela} WHERE id = ? AND barbearia_id = ?`).bind(input.id, ctx.barbeariaId).first();
    if (!atual) return fail("Registro não encontrado.", 404);
    if (nome === "clientes" && await db.prepare("SELECT 1 FROM clientes_excluidos WHERE cliente_id = ?").bind(atual.id).first()) return fail("Cliente excluído não pode ser alterado.", 409);

    // Cliente marcado sem telefone: ao editar, pode continuar sem (o marcador fica).
    if (nome === "clientes" && !telefoneReal(atual.telefone) && !String(input.telefone ?? "").replace(/\D/g, "")) delete input.telefone;
    const novo = {};
    const antes = {};
    for (const [api, c] of Object.entries(def.campos)) {
      antes[c.col] = atual[c.col];
      novo[c.col] = input[api] === undefined ? atual[c.col] : c.ler(input[api] === null && !c.obrig ? null : input[api]);
    }
    antes.ativo = Number(atual.ativo);
    novo.ativo = antes.ativo;
    if (input.ativo !== undefined) {
      if (typeof input.ativo !== "boolean") return fail("Situação inválida.");
      novo.ativo = input.ativo ? 1 : 0;
    }
    const dif = diferenca(antes, novo);
    // Apelido (só clientes): muda à parte, em clientes_apelidos.
    let apelidoNovo;
    const apelidoAntes = nome === "clientes" ? ((await db.prepare("SELECT apelido FROM clientes_apelidos WHERE cliente_id = ?").bind(atual.id).first())?.apelido || null) : null;
    if (nome === "clientes" && input.apelido !== undefined) apelidoNovo = lerApelido(input.apelido);
    const mudaApelido = apelidoNovo !== undefined && apelidoNovo !== apelidoAntes;
    if (mudaApelido) { dif.mudou = true; dif.antes.apelido = apelidoAntes; dif.depois.apelido = apelidoNovo; }
    if (!dif.mudou) return fail("Nada foi alterado.");
    const desativando = antes.ativo === 1 && novo.ativo === 0;
    const motivo = desativando ? exigirMotivo(input.motivo) : (textoLimpo(input.motivo, 3, 300) || null);
    await conferirUnico(ctx, def, novo, atual.id);

    const extras = {};
    if (nome === "clientes" && novo.aceite_lgpd === 1 && antes.aceite_lgpd !== 1) {
      extras.aceite_lgpd_em = new Date().toISOString();
      extras.aceite_lgpd_por = user.id;
    }
    extras.motivo_desativacao = novo.ativo ? null : (desativando ? motivo : atual.motivo_desativacao);
    const sets = { ...novo, ...extras };
    await db.batch([
      db.prepare(`
        UPDATE ${def.tabela} SET ${Object.keys(sets).map(k => `${k} = ?`).join(", ")}, atualizado_em = CURRENT_TIMESTAMP
        WHERE id = ? AND barbearia_id = ?
      `).bind(...Object.values(sets), atual.id, ctx.barbeariaId),
      auditoria(ctx, desativando ? `${def.singular}_desativado` : `${def.singular}_alterado`, atual.id,
        { motivo, antes: dif.antes, depois: dif.depois }),
      ...(mudaApelido ? [db.prepare(`INSERT INTO clientes_apelidos (cliente_id, barbearia_id, apelido) VALUES (?, ?, ?)
        ON CONFLICT(cliente_id) DO UPDATE SET apelido = excluded.apelido, atualizado_em = CURRENT_TIMESTAMP`).bind(atual.id, ctx.barbeariaId, apelidoNovo)] : [])
    ]);
    const depois = await lerRegistro(ctx, nome, def, atual.id);
    return json({ [def.singular]: def.publico(depois) });
  }

  return fail("Rota não encontrada", 404);
}

// Confere o texto do modelo: só os campos conhecidos entre chaves.
export function validarModelo(texto) {
  if (typeof texto !== "string") erro("Texto inválido.");
  const t = texto.trim();
  if (t.length < 10 || t.length > 1000) erro("O texto deve ter de 10 a 1000 letras.");
  for (const m of t.matchAll(/\{([^{}]*)\}/g)) {
    if (!CAMPOS_MENSAGEM.includes(m[1])) {
      erro(`Campo {${m[1]}} não existe. Use: ${CAMPOS_MENSAGEM.map(c => `{${c}}`).join(" ")}.`);
    }
  }
  return t;
}

async function rotasModelos(ctx, path, method) {
  const { db, request } = ctx;
  // Modelos de mensagem do WhatsApp: gestão e caixa (recepção, que envia os lembretes).
  exigirBarbearia(ctx);
  if (!isGestao(ctx.user) && ctx.user.perfil !== "caixa") throw new HttpError("Sem permissão", 403);
  if (path === "/modelos-mensagem" && method === "GET") {
    const [r, extra] = await Promise.all([
      db.prepare("SELECT tipo, texto, atualizado_em FROM modelos_mensagem WHERE barbearia_id = ? ORDER BY tipo").bind(ctx.barbeariaId).all(),
      db.prepare("SELECT tipo, texto, atualizado_em FROM modelos_mensagem_adicionais WHERE barbearia_id = ?").bind(ctx.barbeariaId).all()
    ]);
    const adicionais = Object.entries(MODELOS_ADICIONAIS_PADRAO).map(([tipo, padrao]) => {
      const m = extra.results.find(x => x.tipo === tipo);
      return { tipo, texto: m ? m.texto : padrao, atualizadoEm: m ? m.atualizado_em : null };
    });
    return json({
      modelos: [...adicionais, ...r.results.map(m => ({ tipo: m.tipo, texto: m.texto, atualizadoEm: m.atualizado_em }))],
      campos: CAMPOS_MENSAGEM
    });
  }
  if (path === "/modelos-mensagem/alterar" && method === "POST") {
    const input = await readJson(request);
    const adicional = Object.hasOwn(MODELOS_ADICIONAIS_PADRAO, input.tipo);
    if (!Object.hasOwn(MODELOS_PADRAO, input.tipo) && !adicional) return fail("Tipo de modelo inválido (confirmação, lembrete ou proposta).");
    const texto = input.restaurarPadrao === true ? (adicional ? MODELOS_ADICIONAIS_PADRAO : MODELOS_PADRAO)[input.tipo] : validarModelo(input.texto);
    if (adicional) {
      const atualAd = await db.prepare("SELECT id, texto FROM modelos_mensagem_adicionais WHERE barbearia_id = ? AND tipo = ?").bind(ctx.barbeariaId, input.tipo).first();
      if ((atualAd ? atualAd.texto : MODELOS_ADICIONAIS_PADRAO[input.tipo]) === texto) return fail("Nada foi alterado.");
      await db.batch([
        db.prepare(`INSERT INTO modelos_mensagem_adicionais (id, barbearia_id, tipo, texto) VALUES (?, ?, ?, ?)
                    ON CONFLICT(barbearia_id, tipo) DO UPDATE SET texto = excluded.texto, atualizado_em = CURRENT_TIMESTAMP`)
          .bind(crypto.randomUUID(), ctx.barbeariaId, input.tipo, texto),
        auditoria(ctx, "modelo_mensagem_alterado", input.tipo, { antes: { texto: atualAd?.texto ?? MODELOS_ADICIONAIS_PADRAO[input.tipo] }, depois: { texto } })
      ]);
      return json({ modelo: { tipo: input.tipo, texto } });
    }
    const atual = await db.prepare("SELECT id, texto FROM modelos_mensagem WHERE barbearia_id = ? AND tipo = ?")
      .bind(ctx.barbeariaId, input.tipo).first();
    if (atual && atual.texto === texto) return fail("Nada foi alterado.");
    await db.batch([
      atual
        ? db.prepare("UPDATE modelos_mensagem SET texto = ?, atualizado_em = CURRENT_TIMESTAMP WHERE id = ? AND barbearia_id = ?")
          .bind(texto, atual.id, ctx.barbeariaId)
        : db.prepare("INSERT INTO modelos_mensagem (id, barbearia_id, tipo, texto) VALUES (?, ?, ?, ?)")
          .bind(crypto.randomUUID(), ctx.barbeariaId, input.tipo, texto),
      auditoria(ctx, "modelo_mensagem_alterado", input.tipo, { antes: { texto: atual?.texto ?? null }, depois: { texto } })
    ]);
    return json({ modelo: { tipo: input.tipo, texto } });
  }
  return fail("Rota não encontrada", 404);
}

export async function rotasCadastros(ctx, path, method) {
  const nome = path.split("/")[1];
  if (CADASTROS[nome]) return rotasCadastro(ctx, nome, CADASTROS[nome], path, method);
  if (nome === "modelos-mensagem") return rotasModelos(ctx, path, method);
  return null;
}
