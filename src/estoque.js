// Estoque (seção 4.4) e vendas de produto. Tudo filtrado pela barbearia da sessão.
// Saldo nunca fica negativo (CHECK no banco): venda sem saldo é bloqueada e nada é gravado.
import {
  json, fail, HttpError, readJson, validId, textoLimpo, textoOpcional, validCentavos, validDate,
  exigirMotivo, auditoria, auditoriaSe, hojeBrasil
} from "./util.js";
import { isGestao, atende } from "./perfis.js";
import { exigirBarbearia, exigirGestao } from "./usuarios.js";
import { lerPagamentos, formaEfetiva, somarDias, mesFechado, MSG_MES_FECHADO } from "./agenda-util.js";
import { exigirClienteDaNota } from "./agenda.js";
import { caixaParaLancar, sqlCaixaOk } from "./caixa.js";

const erro = (msg, status = 400) => { throw new HttpError(msg, status); };
export const MOTIVOS_AJUSTE = { perda: "Perda", vencimento: "Vencimento", quebra: "Quebra", uso_interno: "Uso interno", correcao: "Correção de contagem" };
const SAIDAS = ["perda", "vencimento", "quebra", "uso_interno"];

// Avisos: abaixo do mínimo ("repor") e validade em até 30 dias ("vencendo"/"vencido").
export function avisosProduto(p, hoje = hojeBrasil()) {
  const avisos = [];
  if (p.ativo && p.saldo < p.estoque_minimo) avisos.push("repor");
  if (p.ativo && p.validade && p.saldo > 0) {
    if (p.validade < hoje) avisos.push("vencido");
    else if (p.validade <= somarDias(hoje, 30)) avisos.push("vencendo");
  }
  return avisos;
}

const SELECT_PRODUTOS = `SELECT p.*, COALESCE(e.saldo, 0) AS saldo,
  EXISTS (SELECT 1 FROM produtos_uso_interno ui WHERE ui.produto_id = p.id) AS uso_interno FROM produtos p
  LEFT JOIN produto_estoque e ON e.produto_id = p.id WHERE p.barbearia_id = ?`;

async function produtoDaBarbearia(ctx, id) {
  if (!validId(id)) erro("Produto inválido.");
  const p = await ctx.db.prepare(`${SELECT_PRODUTOS} AND p.id = ?`).bind(ctx.barbeariaId, id).first();
  if (!p) erro("Produto não encontrado.", 404);
  return p;
}

const garantirLinhaEstoque = (ctx, produtoId) =>
  ctx.db.prepare("INSERT OR IGNORE INTO produto_estoque (produto_id, barbearia_id, saldo) VALUES (?, ?, 0)").bind(produtoId, ctx.barbeariaId);

function lerQuantidade(v, rotulo = "Quantidade", { permitirNegativo = false } = {}) {
  if (!Number.isInteger(v) || v === 0 || Math.abs(v) > 100000 || (!permitirNegativo && v < 0)) erro(`${rotulo} inválida.`);
  return v;
}

// Erro de saldo negativo vindo do banco (CHECK) → mensagem simples.
async function lote(db, comandos, msgSaldo) {
  try {
    return await db.batch(comandos);
  } catch (e) {
    if (/CHECK constraint failed|constraint failed/i.test(String(e?.message))) erro(msgSaldo, 409);
    throw e;
  }
}

// ---------- ESTOQUE (gestão) ----------
// Comandos de uma entrada de mercadoria (usados na tela de estoque e no cadastro do produto com estoque inicial).
export function comandosEntrada(ctx, p, { q, c, fornecedor = null, validade = null, id = crypto.randomUUID() }) {
  const { db, user } = ctx;
  return [
    garantirLinhaEstoque(ctx, p.id),
    db.prepare(`UPDATE produtos SET
        custo_medio_centavos = CAST(ROUND((MAX((SELECT saldo FROM produto_estoque WHERE produto_id = ?), 0) * custo_medio_centavos + ? * ?) * 1.0
                               / (MAX((SELECT saldo FROM produto_estoque WHERE produto_id = ?), 0) + ?)) AS INTEGER),
        validade = CASE WHEN ? IS NOT NULL AND (validade IS NULL OR ? < validade) THEN ? ELSE validade END,
        atualizado_em = CURRENT_TIMESTAMP
      WHERE id = ? AND barbearia_id = ?`).bind(p.id, q, c, p.id, q, validade, validade, validade, p.id, ctx.barbeariaId),
    db.prepare("UPDATE produto_estoque SET saldo = saldo + ?, atualizado_em = CURRENT_TIMESTAMP WHERE produto_id = ? AND barbearia_id = ?").bind(q, p.id, ctx.barbeariaId),
    db.prepare(`INSERT INTO estoque_movimentos (id, barbearia_id, produto_id, tipo, quantidade, custo_unit_centavos, custo_medio_apos_centavos, fornecedor, validade, criado_por)
                SELECT ?, ?, ?, 'entrada', ?, ?, custo_medio_centavos, ?, ?, ? FROM produtos WHERE id = ?`)
      .bind(id, ctx.barbeariaId, p.id, q, c, fornecedor, validade, user.id, p.id),
    auditoria(ctx, "estoque_entrada", p.id, { quantidade: q, custoUnit: c, fornecedor, validade, antes: { saldo: p.saldo ?? 0, custoMedio: p.custo_medio_centavos ?? 0 } })
  ];
}

// Estoque inicial informado no cadastro do produto: quantidade (inteiro > 0) e custo unitário (centavos).
export function lerEstoqueInicial(v) {
  if (v === undefined || v === null) return null;
  const q = lerQuantidade(v.quantidade, "Quantidade em estoque");
  if (q < 0) erro("Quantidade em estoque inválida.");
  if (!validCentavos(v.custoUnitCentavos)) erro("Custo unitário inválido.");
  return { q, c: v.custoUnitCentavos };
}

export async function rotasEstoque(ctx, path, method) {
  if (path !== "/estoque" && !path.startsWith("/estoque/")) return null;
  exigirGestao(ctx);
  const { db, user, request } = ctx;

  if (path === "/estoque" && method === "GET") {
    const r = await db.prepare(`${SELECT_PRODUTOS} ORDER BY p.ativo DESC, p.nome`).bind(ctx.barbeariaId).all();
    const hoje = hojeBrasil();
    return json({
      produtos: r.results.map(p => ({
        id: p.id, nome: p.nome, codigo: p.codigo || null, ativo: Boolean(p.ativo), usoInterno: Boolean(p.uso_interno),
        saldo: p.saldo, estoqueMinimo: p.estoque_minimo, validade: p.validade || null,
        precoCentavos: p.preco_centavos, custoMedioCentavos: p.custo_medio_centavos,
        margemBp: p.custo_medio_centavos > 0 && p.preco_centavos > 0
          ? Math.round(((p.preco_centavos - p.custo_medio_centavos) * 10000) / p.preco_centavos) : null,
        valorEstoqueCentavos: p.saldo * p.custo_medio_centavos,
        avisos: avisosProduto(p, hoje)
      })),
      motivosAjuste: MOTIVOS_AJUSTE
    });
  }

  if (path === "/estoque/historico" && method === "GET") {
    const p = await produtoDaBarbearia(ctx, new URL(request.url).searchParams.get("produtoId"));
    const r = await db.prepare(`SELECT m.*, u.nome AS usuario FROM estoque_movimentos m JOIN usuarios u ON u.id = m.criado_por
                                WHERE m.barbearia_id = ? AND m.produto_id = ? ORDER BY m.criado_em DESC, m.rowid DESC LIMIT 300`)
      .bind(ctx.barbeariaId, p.id).all();
    return json({
      produto: { id: p.id, nome: p.nome, saldo: p.saldo, custoMedioCentavos: p.custo_medio_centavos },
      movimentos: r.results.map(m => ({
        tipo: m.tipo, quantidade: m.quantidade, custoUnitCentavos: m.custo_unit_centavos, custoMedioAposCentavos: m.custo_medio_apos_centavos,
        fornecedor: m.fornecedor, validade: m.validade, motivo: m.motivo, em: m.criado_em, usuario: m.usuario
      }))
    });
  }

  // Entrada de mercadoria: recalcula o custo médio = (saldo × custo atual + qtd × custo novo) ÷ (saldo + qtd).
  if (path === "/estoque/entrada" && method === "POST") {
    const input = await readJson(request);
    const p = await produtoDaBarbearia(ctx, input.produtoId);
    if (!p.ativo) erro("Produto desativado. Reative antes.");
    const q = lerQuantidade(input.quantidade);
    if (!validCentavos(input.custoUnitCentavos)) erro("Custo unitário inválido.");
    const fornecedor = textoOpcional(input.fornecedor, 80);
    if (fornecedor === false) erro("Fornecedor muito longo (até 80 letras).");
    const validade = input.validade ? (validDate(input.validade) ? input.validade : erro("Validade inválida.")) : null;
    await db.batch(comandosEntrada(ctx, p, { q, c: input.custoUnitCentavos, fornecedor, validade }));
    const depois = await produtoDaBarbearia(ctx, p.id);
    return json({ produto: { id: p.id, saldo: depois.saldo, custoMedioCentavos: depois.custo_medio_centavos, validade: depois.validade } }, 201);
  }

  // Ajuste com motivo obrigatório: perda, vencimento, quebra, uso interno (saídas) ou correção (+/−).
  if (path === "/estoque/ajuste" && method === "POST") {
    const input = await readJson(request);
    const p = await produtoDaBarbearia(ctx, input.produtoId);
    if (!Object.hasOwn(MOTIVOS_AJUSTE, input.motivo)) erro("Escolha o motivo: perda, vencimento, quebra, uso interno ou correção.");
    const q = lerQuantidade(input.quantidade, "Quantidade", { permitirNegativo: true });
    if (SAIDAS.includes(input.motivo) && q > 0) erro(`${MOTIVOS_AJUSTE[input.motivo]} é saída: informe quantidade negativa.`);
    const obs = textoOpcional(input.observacao, 200);
    if (obs === false) erro("Observação muito longa.");
    const motivo = `${MOTIVOS_AJUSTE[input.motivo]}${obs ? `: ${obs}` : ""}`;
    await lote(db, [
      garantirLinhaEstoque(ctx, p.id),
      db.prepare("UPDATE produto_estoque SET saldo = saldo + ?, atualizado_em = CURRENT_TIMESTAMP WHERE produto_id = ? AND barbearia_id = ?").bind(q, p.id, ctx.barbeariaId),
      db.prepare(`INSERT INTO estoque_movimentos (id, barbearia_id, produto_id, tipo, quantidade, custo_unit_centavos, motivo, criado_por)
                  VALUES (?, ?, ?, 'ajuste', ?, ?, ?, ?)`).bind(crypto.randomUUID(), ctx.barbeariaId, p.id, q, p.custo_medio_centavos, motivo, user.id),
      auditoria(ctx, "estoque_ajuste", p.id, { motivo, quantidade: q, antes: { saldo: p.saldo }, depois: { saldo: p.saldo + q } })
    ], `Saldo insuficiente: ${p.nome} tem ${p.saldo} em estoque.`);
    return json({ produto: { id: p.id, saldo: p.saldo + q } }, 201);
  }

  // Material de uso da barbearia (lâminas, cremes…): controla estoque, não é vendido (pedido de 16/11/2026).
  if (path === "/estoque/material" && method === "POST") {
    const input = await readJson(request);
    const nome = textoLimpo(input.nome, 2, 80);
    if (!nome) erro("Informe o nome do material (2 a 80 letras).");
    const codigo = textoOpcional(input.codigo, 40);
    if (codigo === false) erro("Código muito longo.");
    const minimo = input.estoqueMinimo ?? 0;
    if (!Number.isInteger(minimo) || minimo < 0 || minimo > 100000) erro("Estoque mínimo inválido.");
    const validade = input.validade ? (validDate(input.validade) ? input.validade : erro("Validade inválida.")) : null;
    const inicial = lerEstoqueInicial(input.estoqueInicial);
    if (codigo && await db.prepare("SELECT 1 FROM produtos WHERE barbearia_id = ? AND codigo = ?").bind(ctx.barbeariaId, codigo).first()) erro("Já existe um produto com esse código.", 409);
    if (await db.prepare(`SELECT 1 FROM produtos p WHERE p.barbearia_id = ? AND lower(p.nome) = lower(?) AND EXISTS (SELECT 1 FROM produtos_uso_interno ui WHERE ui.produto_id = p.id)`)
      .bind(ctx.barbeariaId, nome).first()) erro("Já existe um material com esse nome.", 409);
    const id = crypto.randomUUID();
    await db.batch([
      db.prepare(`INSERT INTO produtos (id, barbearia_id, nome, codigo, preco_centavos, validade, estoque_minimo, mostrar_site) VALUES (?, ?, ?, ?, 0, ?, ?, 0)`)
        .bind(id, ctx.barbeariaId, nome, codigo || null, validade, minimo),
      db.prepare("INSERT INTO produtos_uso_interno (produto_id, barbearia_id) VALUES (?, ?)").bind(id, ctx.barbeariaId),
      garantirLinhaEstoque(ctx, id),
      auditoria(ctx, "material_criado", id, { depois: { nome, codigo: codigo || null, estoqueMinimo: minimo, validade } }),
      ...(inicial ? comandosEntrada(ctx, { id }, { q: inicial.q, c: inicial.c, validade }) : [])
    ]);
    const novo = await produtoDaBarbearia(ctx, id);
    return json({ material: { id, nome, saldo: novo.saldo, usoInterno: true } }, 201);
  }

  // Inventário: gerente digita o contado; o sistema mostra a diferença e ajusta (com motivo).
  if (path === "/estoque/inventario" && method === "POST") {
    const input = await readJson(request, 32768);
    if (!Array.isArray(input.itens) || input.itens.length < 1 || input.itens.length > 500) erro("Informe a contagem de pelo menos um produto.");
    const motivo = exigirMotivo(input.motivo);
    const r = await db.prepare(SELECT_PRODUTOS).bind(ctx.barbeariaId).all();
    const porId = Object.fromEntries(r.results.map(p => [p.id, p]));
    const vistos = new Set();
    const difs = input.itens.map(i => {
      const p = porId[i?.produtoId];
      if (!p) erro("Produto não encontrado.", 404);
      if (vistos.has(p.id)) erro("Produto repetido na contagem.");
      vistos.add(p.id);
      if (!Number.isInteger(i.contado) || i.contado < 0 || i.contado > 100000) erro(`Contagem de ${p.nome} inválida.`);
      return { p, contado: i.contado, diferenca: i.contado - p.saldo };
    });
    const comDiferenca = difs.filter(d => d.diferenca !== 0);
    const comandos = comDiferenca.flatMap(d => [
      garantirLinhaEstoque(ctx, d.p.id),
      db.prepare("UPDATE produto_estoque SET saldo = ?, atualizado_em = CURRENT_TIMESTAMP WHERE produto_id = ? AND barbearia_id = ?").bind(d.contado, d.p.id, ctx.barbeariaId),
      db.prepare(`INSERT INTO estoque_movimentos (id, barbearia_id, produto_id, tipo, quantidade, custo_unit_centavos, motivo, criado_por)
                  VALUES (?, ?, ?, 'inventario', ?, ?, ?, ?)`).bind(crypto.randomUUID(), ctx.barbeariaId, d.p.id, d.diferenca, d.p.custo_medio_centavos, `Inventário: ${motivo}`, user.id)
    ]);
    comandos.push(auditoria(ctx, "estoque_inventario", null, {
      motivo, itens: difs.map(d => ({ produto: d.p.nome, sistema: d.p.saldo, contado: d.contado, diferenca: d.diferenca }))
    }));
    await db.batch(comandos);
    return json({
      ajustados: comDiferenca.length,
      itens: difs.map(d => ({ produtoId: d.p.id, nome: d.p.nome, sistema: d.p.saldo, contado: d.contado, diferenca: d.diferenca }))
    });
  }

  return fail("Rota não encontrada", 404);
}

// ---------- VENDAS ----------
// Equipe: só com o caixa aberto; gerente/dono: também com ele fechado (17/11/2026).
const caixaAbertoDeHoje = ctx => caixaParaLancar(ctx);

// Monta os comandos de uma venda (sem gravar): usada na venda avulsa e na cobrança do atendimento com produto (17/11/2026).
// pagamentosDe(total) devolve as formas de pagamento da venda (a soma bate com o total).
export async function montarVenda(ctx, { caixa, vendedor, clienteId = null, agendamentoId = null, itens: itensIn, descontoBp: descontoIn, pagamentosDe }) {
  const { db, user } = ctx;
  const vendedorId = vendedor.id;
  if (!Array.isArray(itensIn) || itensIn.length < 1 || itensIn.length > 20) erro("Escolha de 1 a 20 produtos.");
  const ids = itensIn.map(i => i?.produtoId);
  if (!ids.every(validId) || new Set(ids).size !== ids.length) erro("Produtos inválidos.");
  const r = await db.prepare(`${SELECT_PRODUTOS} AND p.id IN (${ids.map(() => "?").join(",")})`).bind(ctx.barbeariaId, ...ids).all();
  const porId = Object.fromEntries(r.results.map(p => [p.id, p]));
  const itens = itensIn.map(i => {
    const p = porId[i.produtoId];
    if (!p || !p.ativo) erro("Produto não encontrado ou desativado.", 404);
    if (p.uso_interno) erro(`${p.nome} é material de uso da barbearia: não é vendido.`, 409);
    const q = lerQuantidade(i.quantidade);
    if (p.saldo < q) erro(`Estoque insuficiente de ${p.nome} (tem ${p.saldo}). Peça ao gerente para ajustar.`, 409);
    return { p, q, preco: p.preco_centavos, custo: p.custo_medio_centavos };
  });
  const bruto = itens.reduce((t, i) => t + i.preco * i.q, 0);
  // Desconto em % (centésimos: 1000 = 10%), calculado aqui no servidor; o total final é o que entra no caixa.
  let descontoBp = 0;
  if (descontoIn !== undefined && descontoIn !== null && descontoIn !== 0) {
    if (!Number.isInteger(descontoIn) || descontoIn < 1 || descontoIn > 9999) erro("Desconto inválido: de 0,01% a 99,99%.");
    descontoBp = descontoIn;
  }
  const descontoCentavos = Math.round((bruto * descontoBp) / 10000);
  const total = bruto - descontoCentavos;
  const pagamentos = pagamentosDe(total);
  const nota = pagamentos.find(p => p.forma === "promissoria") || null;
  const pagCaixa = pagamentos.filter(p => p.forma !== "promissoria");
  if (nota) await exigirClienteDaNota(ctx, clienteId);

  const id = crypto.randomUUID();
  const existe = ["EXISTS (SELECT 1 FROM vendas WHERE id = ?)", [id]];
  const comSaldo = itens.map(() => "COALESCE((SELECT saldo FROM produto_estoque WHERE produto_id = ?), 0) >= ?").join(" AND ");
  const comandos = [
    // A venda só nasce se o caixa estiver aberto e houver saldo de todos os itens.
    db.prepare(`INSERT INTO vendas (id, barbearia_id, caixa_id, vendedor_id, cliente_id, agendamento_id, total_centavos, criado_por)
                SELECT ?, ?, ?, ?, ?, ?, ?, ? WHERE ${sqlCaixaOk(ctx)} AND ${comSaldo}`)
      .bind(id, ctx.barbeariaId, caixa.id, vendedorId, clienteId, agendamentoId, total, user.id, caixa.id, ...itens.flatMap(i => [i.p.id, i.q])),
    ...itens.flatMap(i => [
      db.prepare(`UPDATE produto_estoque SET saldo = saldo - ?, atualizado_em = CURRENT_TIMESTAMP WHERE produto_id = ? AND barbearia_id = ? AND ${existe[0]}`)
        .bind(i.q, i.p.id, ctx.barbeariaId, ...existe[1]),
      db.prepare(`INSERT INTO venda_itens (id, barbearia_id, venda_id, produto_id, nome, quantidade, preco_unit_centavos, custo_unit_centavos)
                  SELECT ?, ?, ?, ?, ?, ?, ?, ? WHERE ${existe[0]}`)
        .bind(crypto.randomUUID(), ctx.barbeariaId, id, i.p.id, i.p.nome, i.q, i.preco, i.custo, ...existe[1]),
      db.prepare(`INSERT INTO estoque_movimentos (id, barbearia_id, produto_id, tipo, quantidade, custo_unit_centavos, venda_id, criado_por)
                  SELECT ?, ?, ?, 'venda', ?, ?, ?, ? WHERE ${existe[0]}`)
        .bind(crypto.randomUUID(), ctx.barbeariaId, i.p.id, -i.q, i.custo, id, user.id, ...existe[1])
    ]),
    // Comissão de produto: só para quem atende (gerente/barbeiro), pelo % de produto dele, guardada à parte.
    ...(atende(vendedor.perfil) && Number(vendedor.comissao_produto_bp) > 0 ? [
      db.prepare(`INSERT INTO comissoes_produto (id, barbearia_id, barbeiro_id, venda_id, base_centavos, percentual_bp, valor_centavos)
                  SELECT ?, ?, ?, ?, ?, ?, ? WHERE ${existe[0]}`)
        .bind(crypto.randomUUID(), ctx.barbeariaId, vendedorId, id, total, Number(vendedor.comissao_produto_bp),
          Math.round((total * Number(vendedor.comissao_produto_bp)) / 10000), ...existe[1])
    ] : []),
    ...(descontoBp ? [db.prepare(`INSERT INTO venda_descontos (venda_id, barbearia_id, bruto_centavos, percentual_bp, valor_centavos, criado_por)
                  SELECT ?, ?, ?, ?, ?, ? WHERE ${existe[0]}`)
      .bind(id, ctx.barbeariaId, bruto, descontoBp, descontoCentavos, user.id, ...existe[1])] : []),
    ...pagCaixa.map(pg => db.prepare(`INSERT INTO caixa_movimentos (id, barbearia_id, caixa_id, tipo, forma, valor_centavos, venda_id, criado_por)
                  SELECT ?, ?, ?, 'venda', ?, ?, ?, ? WHERE ${existe[0]}`)
      .bind(crypto.randomUUID(), ctx.barbeariaId, caixa.id, pg.forma, pg.valorCentavos, id, user.id, ...existe[1])),
    ...(nota ? [db.prepare(`INSERT INTO promissorias (id, barbearia_id, cliente_id, origem, venda_id, caixa_id, valor_centavos, descricao, criado_por)
                  SELECT ?, ?, ?, 'venda', ?, ?, ?, ?, ? WHERE ${existe[0]}`)
      .bind(crypto.randomUUID(), ctx.barbeariaId, clienteId, id, caixa.id, nota.valorCentavos, itens.map(i => `${i.q}x ${i.p.nome}`).join(", "), user.id, ...existe[1])] : []),
    auditoriaSe(ctx, ...existe, "venda_registrada", id, {
      total, ...(descontoBp ? { bruto, descontoBp, descontoCentavos } : {}), vendedor: vendedorId, itens: itens.map(i => ({ produto: i.p.nome, quantidade: i.q, preco: i.preco })), pagamentos
    })
  ];
  return { id, total, bruto, descontoBp, descontoCentavos, comandos, itens };
}

async function vender(ctx) {
  const { db, user, request } = ctx;
  const input = await readJson(request);
  const caixa = await caixaAbertoDeHoje(ctx);

  // Quem vendeu: barbeiro = ele mesmo; caixa/gestão podem indicar o barbeiro (comissão de produto vai para ele).
  let vendedor = { id: user.id, perfil: user.perfil, comissao_produto_bp: user.comissao_produto_bp };
  if (input.vendedorId && input.vendedorId !== user.id) {
    if (user.perfil === "barbeiro") erro("Você só registra venda em seu nome.", 403);
    if (!validId(input.vendedorId)) erro("Vendedor inválido.");
    const v = await db.prepare("SELECT id, perfil, ativo, comissao_produto_bp FROM usuarios WHERE id = ? AND barbearia_id = ?").bind(input.vendedorId, ctx.barbeariaId).first();
    if (!v) erro("Vendedor não encontrado.", 404);
    if (!atende(v.perfil) || !v.ativo) erro("Vendedor deve ser um gerente ou barbeiro ativo.");
    vendedor = v;
  }
  const vendedorId = vendedor.id;
  let clienteId = null;
  let agendamentoId = null;
  if (input.agendamentoId) {
    if (!validId(input.agendamentoId)) erro("Horário inválido.");
    const a = await db.prepare("SELECT id, cliente_id, barbeiro_id FROM agendamentos WHERE id = ? AND barbearia_id = ?").bind(input.agendamentoId, ctx.barbeariaId).first();
    if (!a) erro("Horário não encontrado.", 404);
    if (user.perfil === "barbeiro" && a.barbeiro_id !== user.id) erro("Esse horário é de outro profissional.", 403);
    clienteId = a.cliente_id;
    agendamentoId = a.id;
  }

  // Cliente da venda: do horário (agenda) ou escolhido no caixa (obrigatório na promissória).
  if (input.clienteId !== undefined && input.clienteId !== null) {
    if (!validId(input.clienteId)) erro("Cliente inválido.");
    const c = await db.prepare("SELECT id FROM clientes WHERE id = ? AND barbearia_id = ?").bind(input.clienteId, ctx.barbeariaId).first();
    if (!c) erro("Cliente não encontrado.", 404);
    clienteId = c.id;
  }
  const v = await montarVenda(ctx, { caixa, vendedor, clienteId, agendamentoId, itens: input.itens, descontoBp: input.descontoBp,
    pagamentosDe: total => lerPagamentos(input.pagamentos, total, { promissoria: true }) });
  const { id, total, bruto, descontoBp, descontoCentavos } = v;
  await lote(db, v.comandos, "Estoque insuficiente (outra venda acabou de usar o saldo). Peça ao gerente para ajustar.");
  if (!(await db.prepare("SELECT 1 FROM vendas WHERE id = ?").bind(id).first())) {
    erro("Não foi possível registrar: o caixa foi fechado ou o estoque acabou. Atualize a tela.", 409);
  }
  return json({ venda: { id, totalCentavos: total, brutoCentavos: bruto, descontoBp, descontoCentavos } }, 201);
}

async function cancelarVenda(ctx) {
  const { db, user, request } = ctx;
  if (!isGestao(user) && user.perfil !== "caixa") erro("Sem permissão", 403);
  const input = await readJson(request);
  if (!validId(input.id)) erro("Venda inválida.");
  const motivo = exigirMotivo(input.motivo);
  const v = await db.prepare(`SELECT v.*, c.situacao AS caixa_situacao, c.data AS caixa_data FROM vendas v JOIN caixas c ON c.id = v.caixa_id
                              WHERE v.id = ? AND v.barbearia_id = ?`).bind(input.id, ctx.barbeariaId).first();
  if (!v) erro("Venda não encontrada.", 404);
  if (v.situacao !== "ativa") erro("Essa venda já foi cancelada.", 409);
  if (mesFechado(v.caixa_data)) erro(MSG_MES_FECHADO, 409);
  if (!isGestao(user) && await db.prepare("SELECT 1 FROM promissorias WHERE venda_id = ? AND situacao = 'aberta'").bind(v.id).first()) {
    erro("Essa venda está numa nota (promissória) em aberto: só o gerente pode cancelar (a nota é cancelada junto).", 403);
  }
  if (await db.prepare("SELECT 1 FROM promissorias WHERE venda_id = ? AND situacao = 'quitada'").bind(v.id).first()) {
    erro("Essa venda foi na promissória e a nota já foi paga: estorne o recebimento da nota antes de cancelar.", 409);
  }
  if (await db.prepare(`SELECT 1 FROM comissoes_produto c JOIN fechamento_comissao_itens i ON i.tipo = 'produto' AND i.ref_id = c.id
                        WHERE c.venda_id = ?`).bind(v.id).first()) {
    erro("A comissão dessa venda já entrou num fechamento de comissão: não dá para cancelar.", 409);
  }
  const itens = (await db.prepare("SELECT * FROM venda_itens WHERE venda_id = ?").bind(v.id).all()).results;
  // Momento único deste pedido: os passos seguintes só acontecem se ESTE cancelamento foi o que valeu.
  const momento = new Date().toISOString();
  const feito = ["EXISTS (SELECT 1 FROM vendas WHERE id = ? AND cancelada_por = ? AND cancelada_em = ?)", [v.id, user.id, momento]];
  await db.batch([
    db.prepare(`UPDATE vendas SET situacao = 'cancelada', motivo_cancelamento = ?, cancelada_por = ?, cancelada_em = ?
                WHERE id = ? AND barbearia_id = ? AND situacao = 'ativa' AND EXISTS (SELECT 1 FROM caixas WHERE id = ?)
                  AND NOT EXISTS (SELECT 1 FROM promissorias WHERE venda_id = ? AND situacao = 'quitada')`)
      .bind(motivo, user.id, momento, v.id, ctx.barbeariaId, v.caixa_id, v.id),
    db.prepare(`UPDATE promissorias SET situacao = 'estornada', motivo_estorno = ? WHERE venda_id = ? AND situacao = 'aberta' AND ${feito[0]}`)
      .bind(`Venda cancelada: ${motivo}`, v.id, ...feito[1]),
    // devolve o estoque
    ...itens.flatMap(i => [
      garantirLinhaEstoque(ctx, i.produto_id),
      db.prepare(`UPDATE produto_estoque SET saldo = saldo + ?, atualizado_em = CURRENT_TIMESTAMP WHERE produto_id = ? AND barbearia_id = ? AND ${feito[0]}`)
        .bind(i.quantidade, i.produto_id, ctx.barbeariaId, ...feito[1]),
      db.prepare(`INSERT INTO estoque_movimentos (id, barbearia_id, produto_id, tipo, quantidade, custo_unit_centavos, venda_id, motivo, criado_por)
                  SELECT ?, ?, ?, 'cancelamento_venda', ?, ?, ?, ?, ? WHERE ${feito[0]}`)
        .bind(crypto.randomUUID(), ctx.barbeariaId, i.produto_id, i.quantidade, i.custo_unit_centavos, v.id, motivo, user.id, ...feito[1])
    ]),
    // estorna a entrada no caixa (na forma atual de cada pagamento)
    db.prepare(`INSERT INTO caixa_movimentos (id, barbearia_id, caixa_id, tipo, forma, valor_centavos, venda_id, referencia_id, motivo, criado_por)
                SELECT 'est-' || lower(hex(randomblob(16))), barbearia_id, caixa_id, 'estorno_venda', ${formaEfetiva("m.id", "m.forma")}, -valor_centavos, venda_id, m.id, ?, ?
                FROM caixa_movimentos m WHERE m.venda_id = ? AND m.tipo = 'venda' AND ${feito[0]}`).bind(motivo, user.id, v.id, ...feito[1]),
    db.prepare(`UPDATE comissoes_produto SET estornada = 1 WHERE venda_id = ? AND ${feito[0]}`).bind(v.id, ...feito[1]),
    auditoriaSe(ctx, ...feito, "venda_cancelada", v.id, { motivo, total: v.total_centavos })
  ]);
  if (!(await db.prepare("SELECT 1 FROM vendas WHERE id = ? AND cancelada_por = ? AND cancelada_em = ?").bind(v.id, user.id, momento).first())) {
    erro("Não foi possível cancelar: o caixa foi fechado ou a venda já foi cancelada.", 409);
  }
  return json({ mensagem: "Venda cancelada: estoque devolvido e entrada estornada." });
}

export async function rotasVendas(ctx, path, method) {
  if (path !== "/vendas" && !path.startsWith("/vendas/")) return null;
  exigirBarbearia(ctx);
  if (!isGestao(ctx.user) && !["caixa", "barbeiro"].includes(ctx.user.perfil)) erro("Sem permissão", 403);
  if (path === "/vendas" && method === "POST") return vender(ctx);
  if (path === "/vendas/cancelar" && method === "POST") return cancelarVenda(ctx);
  return fail("Rota não encontrada", 404);
}

