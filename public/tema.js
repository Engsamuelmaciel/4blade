// 4blade — aplica a aparência escolhida (paleta + claro/escuro/sistema) ANTES de a tela aparecer (evita piscar).
// Guardado neste aparelho (localStorage). Usado também por app.js (window.temaApp).
(function () {
  const CHAVE = "4blade.aparencia";
  const PALETAS = ["navalha", "ganache", "berinjela", "violeta", "indigo", "cereja"];
  const MODOS = ["claro", "escuro", "sistema"];
  // 27/11/2026: "Visual antigo" (o de sempre) ou "Visual novo" (pele Navalha Noir + fluxos novos). Cada um guarda o próprio claro/escuro;
  // o novo começa escuro. Fica neste aparelho, como o resto da aparência.
  const VISUAIS = ["antigo", "novo"];
  const COR_TOPO = { navalha: ["#24272c", "#0f1114"], ganache: ["#4a2c21", "#1e130f"], berinjela: ["#3d2147", "#1a0f1f"], violeta: ["#1b1716", "#0f0d0c"], indigo: ["#231a4f", "#120d2b"], cereja: ["#2f3748", "#171b24"] };
  const escuroDoSistema = window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;
  function ler() {
    try {
      const v = JSON.parse(localStorage.getItem(CHAVE) || "{}");
      return { paleta: PALETAS.includes(v.paleta) ? v.paleta : "navalha", modo: MODOS.includes(v.modo) ? v.modo : "claro",
        visual: VISUAIS.includes(v.visual) ? v.visual : "antigo", modoNovo: MODOS.includes(v.modoNovo) ? v.modoNovo : "escuro" };
    } catch { return { paleta: "navalha", modo: "claro", visual: "antigo", modoNovo: "escuro" }; }
  }
  function aplicar(pref = ler()) {
    const modo = pref.visual === "novo" ? pref.modoNovo : pref.modo;
    const escuro = modo === "escuro" || (modo === "sistema" && Boolean(escuroDoSistema?.matches));
    const raiz = document.documentElement;
    raiz.dataset.visual = pref.visual;
    raiz.dataset.paleta = pref.paleta;
    raiz.dataset.tema = escuro ? "escuro" : "claro";
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", pref.visual === "novo" ? (escuro ? "#0e1012" : "#f6f5f2") : COR_TOPO[pref.paleta][escuro ? 1 : 0]);
  }
  function salvar(pref) {
    const atual = { ...ler(), ...pref };
    try { localStorage.setItem(CHAVE, JSON.stringify(atual)); } catch { /* sem espaço: só aplica */ }
    aplicar(atual);
    return atual;
  }
  escuroDoSistema?.addEventListener?.("change", () => { const p = ler(); if ((p.visual === "novo" ? p.modoNovo : p.modo) === "sistema") aplicar(); });
  aplicar();
  window.temaApp = { ler, salvar, aplicar, PALETAS, MODOS, VISUAIS };
})();
