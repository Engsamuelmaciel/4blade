// Perfis, permissões e limites por plano (especificação, seções 2 e 5).

export const PERFIS = ["plataforma", "proprietario", "gerente", "barbeiro", "caixa"];
export const PERFIS_EQUIPE = ["gerente", "barbeiro", "caixa"];   // criados dentro da barbearia

// Planos (especificação, seção 11). Limite só de BARBEIROS ativos; gerentes e caixas sem limite.
// Proprietário é sempre 1. Desativar libera a vaga. Preços em centavos; anual = 10 mensalidades.
export const SEM_LIMITE = 1_000_000;
export const PLANOS = {
  basico: { nome: "Básico", barbeiros: 2, mensalCentavos: 7900, site: null },
  standard: { nome: "Standard", barbeiros: 4, mensalCentavos: 11900, site: "horarios_opcional" },
  pro: { nome: "Pro", barbeiros: 10, mensalCentavos: 17900, site: "completo" }
};
// Adicional do Standard: site só para o cliente ver os horários livres (valor a confirmar com o responsável).
export const SITE_STANDARD_MENSAL_CENTAVOS = 2000;
// O site (fase 2) ainda não está no ar: enquanto for false, o adicional não pode ser contratado.
export const SITE_DISPONIVEL = false;
export const MESES_DO_ANUAL = 10;

// Plano antigo (coluna barbearias.plano) → novo.
export const planoDaColunaAntiga = p => (p === "profissional" ? "pro" : "basico");

export function valorDoPlano(plano, ciclo = "mensal", siteHorarios = false) {
  const p = PLANOS[plano];
  if (!p) return null;
  const mensal = p.mensalCentavos + (plano === "standard" && siteHorarios ? SITE_STANDARD_MENSAL_CENTAVOS : 0);
  return ciclo === "anual" ? mensal * MESES_DO_ANUAL : mensal;
}

// barbearia = { plano, barbeiros_adicionais } (plano já no formato novo).
export function limiteDoPerfil(barbearia, perfil) {
  const p = PLANOS[barbearia.plano];
  if (!p) return 0;
  if (perfil !== "barbeiro") return PERFIS_EQUIPE.includes(perfil) ? SEM_LIMITE : 0;
  return p.barbeiros + (barbearia.plano === "pro" ? Number(barbearia.barbeiros_adicionais || 0) : 0);
}

// Gestão = proprietário ou gerente (tudo na barbearia: cadastros, preços, comissões...).
export const isGestao = u => u.perfil === "proprietario" || u.perfil === "gerente";

// Quem cria/edita/desativa quem: proprietário → gerente, barbeiro, caixa; gerente → barbeiro, caixa.
export function podeGerenciarPerfil(user, perfilAlvo) {
  if (user.perfil === "proprietario") return PERFIS_EQUIPE.includes(perfilAlvo);
  if (user.perfil === "gerente") return perfilAlvo === "barbeiro" || perfilAlvo === "caixa";
  return false;
}

// Quem vê e marca na agenda de todos os profissionais: gestão e caixa (recepção). O caixa não vê comissão.
export const veTodasAgendas = u => isGestao(u) || u.perfil === "caixa";

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
