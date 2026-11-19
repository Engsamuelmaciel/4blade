// Navegação (19/11/2026): caixa/barbeiro/plataforma têm menu no topo; gerente/dono, menu lateral. Se o nome é uma aba do topo, toca nela; senão abre "Mais" (#btn-menu) e
// toca no item do painel (que tem todas as telas, por assunto). Tenta algumas vezes: logo após o login o menu é remontado.
export async function ir(page, nome) {
  await page.waitForFunction(() => document.querySelector("#nav-topo:not([hidden]) .nav-aba") || document.querySelector("#menu:not([hidden]) .grupo"));
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
        if ((await titulo.getAttribute("aria-expanded")) === "false") await titulo.click();
        item = page.locator(`#menu [data-nav="${nome}"]`);
      }
      const destino = await item.getAttribute("href");
      await item.click({ timeout: 3000 });
      await page.waitForFunction(d => location.hash === d, destino);
      if (pelo === "mais") await page.waitForFunction(() => !document.getElementById("menu").classList.contains("aberto"));
      void 0;
      await page.waitForTimeout(80);   // o evento de troca de endereço chega logo depois do clique
      await page.waitForFunction(() => !document.body.dataset.carregando);   // espera a tela terminar de montar
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
