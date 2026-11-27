// 4blade — aplica a aparência escolhida (paleta + claro/escuro/sistema) ANTES de a tela aparecer (evita piscar).
// Guardado neste aparelho (localStorage). Usado também por app.js (window.temaApp).
(function () {
  const CHAVE = "4blade.aparencia";
  const PALETAS = ["navalha", "ganache", "berinjela", "violeta", "indigo", "cereja"];
  const MODOS = ["claro", "escuro", "sistema"];
  const COR_TOPO = { navalha: ["#24282b", "#0c0e10"], ganache: ["#3d251c", "#140d0a"], berinjela: ["#3a2044", "#120a16"], violeta: ["#1d1918", "#0c0a0a"], indigo: ["#231a4f", "#0d0921"], cereja: ["#2f3748", "#12151c"] };
  const escuroDoSistema = window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;
  function ler() {
    try {
      const v = JSON.parse(localStorage.getItem(CHAVE) || "{}");
      return { paleta: PALETAS.includes(v.paleta) ? v.paleta : "navalha", modo: MODOS.includes(v.modo) ? v.modo : "claro" };
    } catch { return { paleta: "navalha", modo: "claro" }; }
  }
  function aplicar(pref = ler()) {
    const escuro = pref.modo === "escuro" || (pref.modo === "sistema" && Boolean(escuroDoSistema?.matches));
    const raiz = document.documentElement;
    raiz.dataset.paleta = pref.paleta;
    raiz.dataset.tema = escuro ? "escuro" : "claro";
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", COR_TOPO[pref.paleta][escuro ? 1 : 0]);
  }
  function salvar(pref) {
    const atual = { ...ler(), ...pref };
    try { localStorage.setItem(CHAVE, JSON.stringify(atual)); } catch { /* sem espaço: só aplica */ }
    aplicar(atual);
    return atual;
  }
  escuroDoSistema?.addEventListener?.("change", () => { if (ler().modo === "sistema") aplicar(); });
  aplicar();
  window.temaApp = { ler, salvar, aplicar, PALETAS, MODOS };
})();
