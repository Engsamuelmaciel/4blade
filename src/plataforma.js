// Painel da plataforma (nós): criar barbearia + 1º acesso do proprietário, bloquear/desbloquear, plano, senha do proprietário.
import {
  json, fail, readJson, validId, validLogin, normalizarLogin, textoLimpo, normalizarTelefone, exigirMotivo,
  hashPassword, gerarSenhaProvisoria, auditoria, diferenca
} from "./util.js";
import { PLANOS, limiteDoPerfil, PERFIS_EQUIPE, valorDoPlano } from "./perfis.js";
import { MODELOS_PADRAO } from "./cadastros.js";
import { SQL_PLANO, assinaturaPublica, alterarPlanoAssinatura } from "./assinatura.js";

function barbeariaPublica(b) {
  return {
    id: b.id,
    nome: b.nome,
    plano: b.plano_atual,
    assinatura: b.a_origem ? assinaturaPublica({
      plano: b.plano_atual, ciclo: b.a_ciclo, site_horarios: b.a_site, valor_centavos: b.a_valor, origem: b.a_origem,
      teste_ate: b.a_teste_ate, pago_ate: b.a_pago_ate, proximo_vencimento: b.a_proximo, link_pagamento: null,
      cancelada: b.a_cancelada, cancelada_em: b.a_cancelada_em, ultimo_pagamento_em: b.a_ultimo_pag
    }) : null,
    email: b.a_email || null,
    barbeirosAdicionais: Number(b.barbeiros_adicionais || 0),
    telefone: b.telefone || null,
    bloqueada: Boolean(b.bloqueada),
    motivoBloqueio: b.motivo_bloqueio || null,
    criadoEm: b.criado_em,
    proprietario: b.prop_login ? { nome: b.prop_nome, login: b.prop_login, trocaPendente: Boolean(b.prop_troca) } : null,
    usuariosAtivos: {
      gerente: Number(b.n_gerente || 0),
      barbeiro: Number(b.n_barbeiro || 0),
      caixa: Number(b.n_caixa || 0)
    }
  };
}

const SELECT_BARBEARIAS = `
  SELECT b.*, ${SQL_PLANO} AS plano_atual,
    a.origem AS a_origem, a.ciclo AS a_ciclo, a.site_horarios AS a_site, a.valor_centavos AS a_valor, a.teste_ate AS a_teste_ate,
    a.pago_ate AS a_pago_ate, a.proximo_vencimento AS a_proximo, a.cancelada AS a_cancelada, a.cancelada_em AS a_cancelada_em,
    a.ultimo_pagamento_em AS a_ultimo_pag, a.email AS a_email,
    p.nome AS prop_nome, p.login AS prop_login, p.trocar_senha AS prop_troca,
    (SELECT COUNT(*) FROM usuarios x WHERE x.barbearia_id = b.id AND x.ativo = 1 AND x.perfil = 'gerente') AS n_gerente,
    (SELECT COUNT(*) FROM usuarios x WHERE x.barbearia_id = b.id AND x.ativo = 1 AND x.perfil = 'barbeiro') AS n_barbeiro,
    (SELECT COUNT(*) FROM usuarios x WHERE x.barbearia_id = b.id AND x.ativo = 1 AND x.perfil = 'caixa') AS n_caixa
  FROM barbearias b
  LEFT JOIN usuarios p ON p.barbearia_id = b.id AND p.perfil = 'proprietario'
  LEFT JOIN assinaturas a ON a.barbearia_id = b.id
`;

export async function rotasPlataforma(ctx, path, method) {
  const { db, request } = ctx;

  if (path === "/plataforma/barbearias" && method === "GET") {
    const r = await db.prepare(`${SELECT_BARBEARIAS} ORDER BY b.nome`).all();
    return json({ barbearias: r.results.map(barbeariaPublica) });
  }

  if (path === "/plataforma/barbearias" && method === "POST") {
    const input = await readJson(request);
    const nome = textoLimpo(input.nome, 2, 80);
    if (!nome) return fail("Informe o nome da barbearia (2 a 80 letras).");
    const plano = input.plano ?? "basico";
    if (!PLANOS[plano]) return fail("Plano inválido (basico, standard ou pro).");
    let telefone = null;
    if (input.telefone) {
      telefone = normalizarTelefone(input.telefone);
      if (!telefone) return fail("Telefone da barbearia inválido (DDD + número).");
    }
    const p = input.proprietario || {};
    const propNome = textoLimpo(p.nome);
    const propLogin = normalizarLogin(p.login);
    if (!propNome) return fail("Informe o nome do proprietário.");
    if (!validLogin(propLogin)) return fail("Usuário do proprietário inválido: use 3 a 30 letras minúsculas, números, ponto ou hífen.");
    let propTel = null;
    if (p.telefone) {
      propTel = normalizarTelefone(p.telefone);
      if (!propTel) return fail("Telefone do proprietário inválido (DDD + número).");
    }
    if (await db.prepare("SELECT 1 FROM usuarios WHERE login = ?").bind(propLogin).first()) {
      return fail("Esse usuário de acesso já existe. Escolha outro.", 409);
    }

    const barbeariaId = crypto.randomUUID();
    const propId = crypto.randomUUID();
    const senha = gerarSenhaProvisoria();
    const actx = { ...ctx, barbeariaId };
    await db.batch([
      db.prepare(`INSERT INTO barbearias (id, nome, plano, telefone) VALUES (?, ?, ?, ?)`)
        .bind(barbeariaId, nome, plano === "pro" ? "profissional" : "basico", telefone),
      db.prepare(`INSERT INTO assinaturas (barbearia_id, plano, valor_centavos, origem) VALUES (?, ?, ?, 'manual')`)
        .bind(barbeariaId, plano, valorDoPlano(plano)),
      db.prepare(`
        INSERT INTO usuarios (id, barbearia_id, login, nome, telefone, perfil, senha_hash, trocar_senha)
        VALUES (?, ?, ?, ?, ?, 'proprietario', ?, 1)
      `).bind(propId, barbeariaId, propLogin, propNome, propTel, await hashPassword(senha)),
      ...Object.entries(MODELOS_PADRAO).map(([tipo, texto]) =>
        db.prepare("INSERT INTO modelos_mensagem (id, barbearia_id, tipo, texto) VALUES (?, ?, ?, ?)")
          .bind(crypto.randomUUID(), barbeariaId, tipo, texto)),
      auditoria(actx, "barbearia_criada", barbeariaId, { depois: { nome, plano, telefone, proprietario: propLogin } })
    ]);
    return json({
      barbearia: { id: barbeariaId, nome, plano },
      proprietario: { id: propId, nome: propNome, login: propLogin },
      senhaProvisoria: senha,
      aviso: "Entregue o usuário e a senha provisória ao proprietário. Ele troca a senha no 1º acesso."
    }, 201);
  }

  if (path === "/plataforma/barbearias/alterar" && method === "POST") {
    const input = await readJson(request);
    if (!validId(input.id)) return fail("Barbearia inválida.");
    const motivo = exigirMotivo(input.motivo);
    const atual = await db.prepare(`${SELECT_BARBEARIAS} WHERE b.id = ?`).bind(input.id).first();
    if (!atual) return fail("Barbearia não encontrada.", 404);

    const novo = {
      nome: atual.nome,
      plano: atual.plano_atual,
      barbeiros_adicionais: Number(atual.barbeiros_adicionais),
      bloqueada: Number(atual.bloqueada)
    };
    if (input.nome !== undefined) {
      novo.nome = textoLimpo(input.nome, 2, 80);
      if (!novo.nome) return fail("Nome inválido.");
    }
    if (input.plano !== undefined) {
      if (!PLANOS[input.plano]) return fail("Plano inválido.");
      novo.plano = input.plano;
    }
    if (input.barbeirosAdicionais !== undefined) {
      if (!Number.isInteger(input.barbeirosAdicionais) || input.barbeirosAdicionais < 0 || input.barbeirosAdicionais > 100) {
        return fail("Barbeiros adicionais inválido (0 a 100).");
      }
      novo.barbeiros_adicionais = input.barbeirosAdicionais;
    }
    if (novo.plano !== "pro") novo.barbeiros_adicionais = 0;   // adicionais só no Pro
    if (input.bloqueada !== undefined) {
      if (typeof input.bloqueada !== "boolean") return fail("Situação inválida.");
      novo.bloqueada = input.bloqueada ? 1 : 0;
    }

    const antes = {
      nome: atual.nome, plano: atual.plano_atual,
      barbeiros_adicionais: Number(atual.barbeiros_adicionais), bloqueada: Number(atual.bloqueada)
    };
    const dif = diferenca(antes, novo);
    if (!dif.mudou) return fail("Nada foi alterado.");

    // Reduzir o plano não pode deixar mais usuários ativos que o novo limite.
    for (const perfil of PERFIS_EQUIPE) {
      const ativos = Number(atual[`n_${perfil}`] || 0);
      const lim = limiteDoPerfil(novo, perfil);
      if (ativos > lim) {
        return fail(`O novo plano permite ${lim} ${perfil}(s) ativo(s) e a barbearia tem ${ativos}. Desative antes.`, 409);
      }
    }

    const actx = { ...ctx, barbeariaId: atual.id };
    const comandos = [
      db.prepare(`
        UPDATE barbearias SET nome = ?, plano = ?, barbeiros_adicionais = ?, bloqueada = ?,
          motivo_bloqueio = ?, atualizado_em = CURRENT_TIMESTAMP
        WHERE id = ?
      `).bind(novo.nome, novo.plano === "pro" ? "profissional" : "basico", novo.barbeiros_adicionais, novo.bloqueada,
        novo.bloqueada ? (dif.depois.bloqueada === 1 ? motivo : atual.motivo_bloqueio) : null, atual.id),
      auditoria(actx, novo.bloqueada && !atual.bloqueada ? "barbearia_bloqueada"
        : !novo.bloqueada && atual.bloqueada ? "barbearia_desbloqueada" : "barbearia_alterada",
      atual.id, { motivo, antes: dif.antes, depois: dif.depois })
    ];
    // Plano mudou: tabela nova (e valor no Asaas, se a cobrança é por lá — feito antes de gravar aqui).
    if (novo.plano !== antes.plano) comandos.push(await alterarPlanoAssinatura(ctx, atual.id, atual, novo.plano));
    if (novo.bloqueada && !atual.bloqueada) {
      // Bloqueou: derruba na hora todas as sessões da barbearia.
      comandos.push(db.prepare(`
        UPDATE sessoes SET revogado_em = CURRENT_TIMESTAMP
        WHERE revogado_em IS NULL AND usuario_id IN (SELECT id FROM usuarios WHERE barbearia_id = ?)
      `).bind(atual.id));
    }
    await db.batch(comandos);
    const depois = await db.prepare(`${SELECT_BARBEARIAS} WHERE b.id = ?`).bind(atual.id).first();
    return json({ barbearia: barbeariaPublica(depois) });
  }

  // Suporte: nova senha provisória para o proprietário (ex.: esqueceu a senha).
  if (path === "/plataforma/barbearias/redefinir-senha" && method === "POST") {
    const input = await readJson(request);
    if (!validId(input.id)) return fail("Barbearia inválida.");
    const motivo = exigirMotivo(input.motivo);
    const prop = await db.prepare(
      "SELECT id, login FROM usuarios WHERE barbearia_id = ? AND perfil = 'proprietario'"
    ).bind(input.id).first();
    if (!prop) return fail("Proprietário não encontrado.", 404);
    const senha = gerarSenhaProvisoria();
    await db.batch([
      db.prepare("UPDATE usuarios SET senha_hash = ?, trocar_senha = 1, atualizado_em = CURRENT_TIMESTAMP WHERE id = ?")
        .bind(await hashPassword(senha), prop.id),
      db.prepare("UPDATE sessoes SET revogado_em = CURRENT_TIMESTAMP WHERE usuario_id = ? AND revogado_em IS NULL")
        .bind(prop.id),
      auditoria({ ...ctx, barbeariaId: input.id }, "senha_redefinida", prop.id, { motivo })
    ]);
    return json({ login: prop.login, senhaProvisoria: senha });
  }

  return null;
}
