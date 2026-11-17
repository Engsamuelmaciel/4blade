// Equipe da barbearia (usuários = colaboradores): listar, criar, editar, desativar/reativar, redefinir senha.
// Proprietário gerencia gerente, barbeiro e caixa; gerente gerencia barbeiro e caixa.
// Limite de usuários ATIVOS por perfil conforme o plano, conferido aqui no servidor.
import {
  json, fail, HttpError, readJson, validId, validLogin, normalizarLogin, textoLimpo, normalizarTelefone, validBp,
  exigirMotivo, hashPassword, gerarSenhaProvisoria, auditoria, diferenca
} from "./util.js";
import { isGestao, podeGerenciarPerfil, limiteDoPerfil, atende, PERFIS_EQUIPE, SEM_LIMITE } from "./perfis.js";

export function exigirBarbearia(ctx) {
  if (!ctx.user.barbearia_id) throw new HttpError("Sem permissão", 403);
}
export function exigirGestao(ctx) {
  exigirBarbearia(ctx);
  if (!isGestao(ctx.user)) throw new HttpError("Sem permissão", 403);
}

const barbeariaDaSessao = ctx => ({
  plano: ctx.user.barbearia_plano,
  barbeiros_adicionais: ctx.user.barbearia_adicionais
});

// Salário base (opcional): vazio/ausente = não mexe; número ≥ 0 em centavos.
function lerSalario(v) {
  if (v === undefined || v === null || v === "") return undefined;
  if (!Number.isInteger(v) || v < 0 || v > 100000000) throw new HttpError("Salário base inválido.", 400);
  return v;
}
const comandoSalario = (ctx, usuarioId, valor) => ctx.db.prepare(`INSERT INTO usuarios_salarios (usuario_id, barbearia_id, salario_centavos, atualizado_por) VALUES (?, ?, ?, ?)
  ON CONFLICT(usuario_id) DO UPDATE SET salario_centavos = excluded.salario_centavos, atualizado_em = CURRENT_TIMESTAMP, atualizado_por = excluded.atualizado_por`)
  .bind(usuarioId, ctx.barbeariaId, valor, ctx.user.id);
const LER_COM_SALARIO = "SELECT usuarios.*, (SELECT s.salario_centavos FROM usuarios_salarios s WHERE s.usuario_id = usuarios.id) AS salario_centavos FROM usuarios WHERE id = ? AND barbearia_id = ?";

function usuarioPublico(u, quemVe) {
  return {
    id: u.id,
    login: u.login,
    nome: u.nome,
    telefone: u.telefone || null,
    perfil: u.perfil,
    comissaoServicoBp: Number(u.comissao_servico_bp),
    comissaoProdutoBp: Number(u.comissao_produto_bp),
    ativo: Boolean(u.ativo),
    motivoDesativacao: u.motivo_desativacao || null,
    trocaPendente: Boolean(u.trocar_senha),
    salarioCentavos: Number(u.salario_centavos || 0),   // salário base (opcional; 17/11/2026), usado nos custos e no pagamento da equipe
    criadoEm: u.criado_em,
    podeGerenciar: u.id !== quemVe.id && podeGerenciarPerfil(quemVe, u.perfil)
  };
}

// Lê comissões do pedido (só para quem atende; caixa fica com 0).
function lerComissoes(input, perfil, atual = { comissao_servico_bp: 0, comissao_produto_bp: 0 }) {
  if (!atende(perfil)) return { comissao_servico_bp: 0, comissao_produto_bp: 0 };
  const s = input.comissaoServicoBp ?? atual.comissao_servico_bp;
  const p = input.comissaoProdutoBp ?? atual.comissao_produto_bp;
  if (!validBp(s) || !validBp(p)) throw new HttpError("Comissão deve ser de 0% a 100%.", 400);
  return { comissao_servico_bp: s, comissao_produto_bp: p };
}

async function vagas(ctx) {
  const r = await ctx.db.prepare(`
    SELECT perfil, COUNT(*) AS n FROM usuarios
    WHERE barbearia_id = ? AND ativo = 1 GROUP BY perfil
  `).bind(ctx.barbeariaId).all();
  const ativos = Object.fromEntries(r.results.map(x => [x.perfil, Number(x.n)]));
  const b = barbeariaDaSessao(ctx);
  // limite null = sem limite no plano (gerente e caixa)
  return Object.fromEntries(PERFIS_EQUIPE.map(p => {
    const lim = limiteDoPerfil(b, p);
    return [p, { ativos: ativos[p] || 0, limite: lim >= SEM_LIMITE ? null : lim }];
  }));
}

export async function rotasUsuarios(ctx, path, method) {
  if (path !== "/usuarios" && !path.startsWith("/usuarios/")) return null;
  exigirGestao(ctx);
  const { db, request, user } = ctx;

  if (path === "/usuarios" && method === "GET") {
    const r = await db.prepare(`
      SELECT usuarios.*, (SELECT s.salario_centavos FROM usuarios_salarios s WHERE s.usuario_id = usuarios.id) AS salario_centavos
      FROM usuarios WHERE barbearia_id = ?
      ORDER BY ativo DESC, CASE perfil WHEN 'proprietario' THEN 0 WHEN 'gerente' THEN 1 WHEN 'barbeiro' THEN 2 ELSE 3 END, nome
    `).bind(ctx.barbeariaId).all();
    return json({ usuarios: r.results.map(u => usuarioPublico(u, user)), vagas: await vagas(ctx) });
  }

  if (path === "/usuarios" && method === "POST") {
    const input = await readJson(request);
    const perfil = input.perfil;
    if (!PERFIS_EQUIPE.includes(perfil)) return fail("Perfil inválido (gerente, barbeiro ou caixa).");
    if (!podeGerenciarPerfil(user, perfil)) {
      return fail(perfil === "gerente" ? "Só o proprietário cria gerentes." : "Sem permissão", 403);
    }
    const nome = textoLimpo(input.nome);
    if (!nome) return fail("Informe o nome (2 a 120 letras).");
    const login = normalizarLogin(input.login);
    if (!validLogin(login)) return fail("Usuário de acesso inválido: use 3 a 30 letras minúsculas, números, ponto ou hífen.");
    let telefone = null;
    if (input.telefone) {
      telefone = normalizarTelefone(input.telefone);
      if (!telefone) return fail("Telefone inválido (DDD + número).");
    }
    const com = lerComissoes(input, perfil);
    const salario = lerSalario(input.salarioCentavos);
    if (await db.prepare("SELECT 1 FROM usuarios WHERE login = ?").bind(login).first()) {
      return fail("Esse usuário de acesso já existe. Escolha outro.", 409);
    }

    const limite = limiteDoPerfil(barbeariaDaSessao(ctx), perfil);
    const id = crypto.randomUUID();
    const senha = gerarSenhaProvisoria();
    // Insere só se ainda houver vaga (conferência e gravação no mesmo comando).
    const ins = await db.prepare(`
      INSERT INTO usuarios (id, barbearia_id, login, nome, telefone, perfil, comissao_servico_bp, comissao_produto_bp, senha_hash, trocar_senha)
      SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, 1
      WHERE (SELECT COUNT(*) FROM usuarios WHERE barbearia_id = ? AND perfil = ? AND ativo = 1) < ?
    `).bind(id, ctx.barbeariaId, login, nome, telefone, perfil, com.comissao_servico_bp, com.comissao_produto_bp,
      await hashPassword(senha), ctx.barbeariaId, perfil, limite).run();
    if (ins.meta.changes !== 1) {
      return fail(`Limite do plano atingido: ${limite} ${perfil}(s) ativo(s). Desative alguém ou mude de plano.`, 409);
    }
    await db.batch([
      auditoria(ctx, "usuario_criado", id, { depois: { login, nome, telefone, perfil, ...com, ...(salario !== undefined ? { salario } : {}) } }),
      ...(salario !== undefined ? [comandoSalario(ctx, id, salario)] : [])
    ]);
    const novo = await db.prepare(LER_COM_SALARIO).bind(id, ctx.barbeariaId).first();
    return json({ usuario: usuarioPublico(novo, user), senhaProvisoria: senha }, 201);
  }

  // Busca o alvo SEMPRE dentro da barbearia da sessão: id de outra barbearia = "não encontrado".
  async function alvoGerenciavel(id, { proprioDono = false } = {}) {
    if (!validId(id)) throw new HttpError("Pessoa inválida.", 400);
    const alvo = await db.prepare("SELECT * FROM usuarios WHERE id = ? AND barbearia_id = ?").bind(id, ctx.barbeariaId).first();
    if (!alvo) throw new HttpError("Pessoa não encontrada.", 404);
    // O dono edita os PRÓPRIOS dados (nome, telefone e comissão, já que ele também atende); não se desativa.
    if (proprioDono && alvo.id === user.id && user.perfil === "proprietario") return alvo;
    if (alvo.id === user.id || !podeGerenciarPerfil(user, alvo.perfil)) {
      throw new HttpError("Sem permissão para alterar esta pessoa.", 403);
    }
    return alvo;
  }

  if (path === "/usuarios/alterar" && method === "POST") {
    const input = await readJson(request);
    const alvo = await alvoGerenciavel(input.id, { proprioDono: true });
    if (alvo.id === user.id && input.ativo !== undefined) return fail("Você não pode desativar o seu próprio acesso.", 403);
    const salarioNovo = lerSalario(input.salarioCentavos);
    const salarioAntes = Number((await db.prepare("SELECT salario_centavos FROM usuarios_salarios WHERE usuario_id = ?").bind(alvo.id).first())?.salario_centavos || 0);
    const mudaSalario = salarioNovo !== undefined && salarioNovo !== salarioAntes;
    const novo = {
      nome: alvo.nome,
      telefone: alvo.telefone,
      comissao_servico_bp: Number(alvo.comissao_servico_bp),
      comissao_produto_bp: Number(alvo.comissao_produto_bp),
      ativo: Number(alvo.ativo)
    };
    if (input.nome !== undefined) {
      novo.nome = textoLimpo(input.nome);
      if (!novo.nome) return fail("Nome inválido (2 a 120 letras).");
    }
    if (input.telefone !== undefined) {
      if (input.telefone === null || input.telefone === "") novo.telefone = null;
      else {
        novo.telefone = normalizarTelefone(input.telefone);
        if (!novo.telefone) return fail("Telefone inválido (DDD + número).");
      }
    }
    Object.assign(novo, lerComissoes(input, alvo.perfil, novo));
    if (input.ativo !== undefined) {
      if (typeof input.ativo !== "boolean") return fail("Situação inválida.");
      novo.ativo = input.ativo ? 1 : 0;
    }
    const antes = {
      nome: alvo.nome, telefone: alvo.telefone, comissao_servico_bp: Number(alvo.comissao_servico_bp),
      comissao_produto_bp: Number(alvo.comissao_produto_bp), ativo: Number(alvo.ativo)
    };
    const dif = diferenca(antes, novo);
    if (!dif.mudou && !mudaSalario) return fail("Nada foi alterado.");
    const desativando = alvo.ativo && !novo.ativo;
    const reativando = !alvo.ativo && novo.ativo;
    const motivo = desativando || reativando ? exigirMotivo(input.motivo) : (textoLimpo(input.motivo, 3, 300) || null);

    if (reativando) {
      const limite = limiteDoPerfil(barbeariaDaSessao(ctx), alvo.perfil);
      const r = await db.prepare(`
        UPDATE usuarios SET ativo = 1, motivo_desativacao = NULL, atualizado_em = CURRENT_TIMESTAMP
        WHERE id = ? AND barbearia_id = ? AND ativo = 0
          AND (SELECT COUNT(*) FROM usuarios WHERE barbearia_id = ? AND perfil = ? AND ativo = 1) < ?
      `).bind(alvo.id, ctx.barbeariaId, ctx.barbeariaId, alvo.perfil, limite).run();
      if (r.meta.changes !== 1) {
        return fail(`Limite do plano atingido: ${limite} ${alvo.perfil}(s) ativo(s). Desative alguém antes.`, 409);
      }
    }

    const comandos = [
      db.prepare(`
        UPDATE usuarios SET nome = ?, telefone = ?, comissao_servico_bp = ?, comissao_produto_bp = ?, ativo = ?,
          motivo_desativacao = ?, atualizado_em = CURRENT_TIMESTAMP
        WHERE id = ? AND barbearia_id = ?
      `).bind(novo.nome, novo.telefone, novo.comissao_servico_bp, novo.comissao_produto_bp, novo.ativo,
        novo.ativo ? null : (desativando ? motivo : alvo.motivo_desativacao), alvo.id, ctx.barbeariaId),
      auditoria(ctx, desativando ? "usuario_desativado" : reativando ? "usuario_reativado" : "usuario_alterado",
        alvo.id, { motivo, antes: dif.antes, depois: dif.depois })
    ];
    if (mudaSalario) {
      comandos.push(comandoSalario(ctx, alvo.id, salarioNovo),
        auditoria(ctx, "salario_alterado", alvo.id, { antes: { salario: salarioAntes }, depois: { salario: salarioNovo } }));
    }
    if (desativando) {
      comandos.push(db.prepare(
        "UPDATE sessoes SET revogado_em = CURRENT_TIMESTAMP WHERE usuario_id = ? AND revogado_em IS NULL"
      ).bind(alvo.id));
    }
    await db.batch(comandos);
    const depois = await db.prepare(LER_COM_SALARIO).bind(alvo.id, ctx.barbeariaId).first();
    return json({ usuario: usuarioPublico(depois, user) });
  }

  if (path === "/usuarios/redefinir-senha" && method === "POST") {
    const input = await readJson(request);
    const alvo = await alvoGerenciavel(input.id);
    if (!alvo.ativo) return fail("Pessoa desativada. Reative antes.");
    const motivo = exigirMotivo(input.motivo);
    const senha = gerarSenhaProvisoria();
    await db.batch([
      db.prepare("UPDATE usuarios SET senha_hash = ?, trocar_senha = 1, atualizado_em = CURRENT_TIMESTAMP WHERE id = ? AND barbearia_id = ?")
        .bind(await hashPassword(senha), alvo.id, ctx.barbeariaId),
      db.prepare("UPDATE sessoes SET revogado_em = CURRENT_TIMESTAMP WHERE usuario_id = ? AND revogado_em IS NULL").bind(alvo.id),
      auditoria(ctx, "senha_redefinida", alvo.id, { motivo })
    ]);
    return json({ login: alvo.login, senhaProvisoria: senha });
  }

  return fail("Rota não encontrada", 404);
}
