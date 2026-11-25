// Navegação (19/11/2026): caixa/barbeiro/plataforma têm menu no topo; gerente/dono, menu lateral. Se o nome é uma aba do topo, toca nela; senão abre "Mais" (#btn-menu) e
// toca no item do painel (que tem todas as telas, por assunto). Tenta algumas vezes: logo após o login o menu é remontado.
// Telas que saíram do menu (25/11/2026): chega pela tela "mãe" e pela aba de dentro.
const DENTRO_DE = {
  "Contador e dados": ["Relatório financeiro", "[data-aba-secao=contador]"],
  "Pagamento da equipe": ["Despesas", "[data-aba-secao=pagamento-equipe]"],
  "Painel": ["Relatório financeiro", "[data-aba-secao=painel]"],
  "Flyers": ["Divulgação", null]
};
export async function ir(page, nome) {
  await page.waitForFunction(() => document.querySelector("#nav-topo:not([hidden]) .nav-aba") || document.querySelector("#menu:not([hidden]) .grupo"));
  // gerente/dono: "Visão do dia" agora é o Início
  if (nome === "Visão do dia" && await page.locator('#menu [data-nav="Início"]').count()) nome = "Início";
  if (DENTRO_DE[nome] && !(await page.locator(`#menu [data-nav="${nome}"], #nav-topo [data-nav="${nome}"]`).count())) {
    const [mae, aba] = DENTRO_DE[nome];
    if (mae) await ir(page, mae);
    if (aba?.startsWith("#/")) { await page.evaluate(h => { location.hash = h; }, aba); await page.waitForTimeout(80); }
    else if (aba) await page.click(aba);
    await page.waitForTimeout(80);
    await page.waitForFunction(() => !document.body.dataset.carregando);
    return;
  }
  for (let tentativa = 0; ; tentativa++) {
    try {
      const aba = page.locator(`#nav-topo:not([hidden]) [data-nav-topo="${nome}"], #nav-topo:not([hidden]) [data-nav="${nome}"]`).first();
      let item = aba;
      let pelo = "topo";
      if (!(await aba.count())) {
        pelo = "mais";
        // menu do topo ("Mais") ou menu lateral no celular (☰); no computador o lateral fica sempre visível
        if (await page.locator("#btn-menu").isVisible() && !(await page.locator("#menu.aberto").count())) {
          await page.click("#btn-menu");
          await page.waitForSelector("#menu.aberto");
          await page.waitForTimeout(250); // animação do painel
        }
        const titulo = page.locator(`#menu .grupo:has([data-nav="${nome}"]) .grupo-titulo`);
        if (await titulo.count() && (await titulo.getAttribute("aria-expanded")) === "false") await titulo.click();
        item = page.locator(`#menu [data-nav="${nome}"]`);
      }
      const destino = await item.getAttribute("href");
      await item.click({ timeout: 3000 });
      await page.waitForFunction(d => location.hash === d, destino);
      if (pelo === "mais") await page.waitForFunction(() => !document.getElementById("menu").classList.contains("aberto"));
      void 0;
      await page.waitForTimeout(80);   // o evento de troca de endereço chega logo depois do clique
      await page.waitForFunction(() => !document.body.dataset.carregando);   // espera a tela terminar de montar
      // Testes antigos olham a agenda de todos: no celular, abre os blocos recolhidos dos outros profissionais (25/11/2026).
      // (test/navegador-agenda.mjs confere o recolhido antes de qualquer abertura: lá a agenda abre em Grade.)
      if (nome === "Agenda") await abrirProfissionais(page);
      return;
    } catch (e) {
      if (tentativa >= 3) throw e;
      await page.waitForTimeout(400);
    }
  }
}

// Agenda: os horários ficam compactos; abre (toca no resumo) para ver as ações. Sem nome = abre todos os da tela.
export async function abrirHorarios(page, nome = null) {
  const sel = `${nome ? `[data-agendamento="${nome}"]` : ".slot"}.recolhivel:not(.aberto) .slot-resumo`;
  await page.waitForFunction(() => !document.body.dataset.carregando);
  for (let i = 0; i < 60; i++) {
    const r = page.locator(sel).first();
    if (!(await r.count())) return;
    await r.click();
  }
}

// Listas limpas: abre o item (toca no resumo) se estiver fechado. sel = seletor do item (ex.: '[data-cliente="Ana"]').
export async function abrirItem(page, sel) {
  const item = page.locator(sel).first();
  await item.waitFor();
  if ((await item.getAttribute("class") || "").includes("aberto")) return;
  await item.locator(".item-x-resumo").click();
}
// Painel "+ Novo …" (no celular vem recolhido).
export async function abrirCadastro(page) {
  const p = page.locator("details.painel-novo").first();
  await p.waitFor();
  if (await p.getAttribute("open") === null) await p.locator(":scope > summary").click();
}
// Ações agrupadas (24/11/2026): "WhatsApp" e "Mais opções" escondem botões; abre o grupo certo antes de clicar.
export async function acao(page, escopo, alvo) {
  await page.locator(escopo).first().waitFor();
  const loc = page.locator(`${escopo} ${alvo}`).first();
  if (!(await loc.isVisible())) {
    for (const g of await page.locator(`${escopo} [data-grupo]`).all()) {
      if (!(await g.isVisible())) continue;
      if (await g.getAttribute("aria-expanded") !== "true") await g.click();
      if (await loc.isVisible()) break;
    }
  }
  await loc.scrollIntoViewIfNeeded();
  await loc.click();
}

// Agenda em lista no celular (25/11/2026): a agenda dos outros profissionais começa recolhida; abre todas.
export async function abrirProfissionais(page) {
  await page.waitForFunction(() => !document.body.dataset.carregando);
  for (let i = 0; i < 12; i++) {
    const c = page.locator(".recolhivel-prof.recolhida .prof-cabeca").first();
    if (!(await c.count()) || !(await c.isVisible())) return;
    if (!(await c.evaluate(e => getComputedStyle(e).pointerEvents !== "none"))) return;
    await c.click();
    await page.waitForFunction(() => !document.body.dataset.carregando);
  }
}
