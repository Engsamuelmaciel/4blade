// Perfis, permissões e limites por plano (especificação, seções 2 e 5).

export const PERFIS = ["plataforma", "proprietario", "gerente", "barbeiro", "caixa"];
export const PERFIS_EQUIPE = ["gerente", "barbeiro", "caixa"];   // criados dentro da barbearia

// Usuários ATIVOS por perfil. Desativar libera a vaga. Proprietário é sempre 1 (criado pela plataforma).
export const LIMITES = {
  basico: { gerente: 1, barbeiro: 3, caixa: 1 },
  profissional: { gerente: 2, barbeiro: 10, caixa: 2 }
};

export function limiteDoPerfil(barbearia, perfil) {
  const base = LIMITES[barbearia.plano]?.[perfil] ?? 0;
  if (perfil === "barbeiro" && barbearia.plano === "profissional") {
    return base + Number(barbearia.barbeiros_adicionais || 0);
  }
  return base;
}

// Gestão = proprietário ou gerente (tudo na barbearia: cadastros, preços, comissões...).
export const isGestao = u => u.perfil === "proprietario" || u.perfil === "gerente";

// Quem cria/edita/desativa quem: proprietário → gerente, barbeiro, caixa; gerente → barbeiro, caixa.
export function podeGerenciarPerfil(user, perfilAlvo) {
  if (user.perfil === "proprietario") return PERFIS_EQUIPE.includes(perfilAlvo);
  if (user.perfil === "gerente") return perfilAlvo === "barbeiro" || perfilAlvo === "caixa";
  return false;
}

// Quem atende (tem agenda e comissão).
export const atende = perfil => perfil === "gerente" || perfil === "barbeiro";

// Tela inicial de cada perfil (a tela usa isto para abrir direto no lugar certo).
export const TELA_INICIAL = {
  plataforma: "plataforma",
  proprietario: "inicio",
  gerente: "inicio",
  barbeiro: "inicio",
  caixa: "caixa"
};
