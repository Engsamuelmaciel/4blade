// 4blade — aplica a aparência escolhida (paleta + claro/escuro/sistema) ANTES de a tela aparecer (evita piscar).
// Guardado neste aparelho (localStorage). Usado também por app.js (window.temaApp).
(function () {
  const CHAVE = "4blade.aparencia";
  const PALETAS = ["navalha", "oceano", "esmeralda", "bordo"];
  const MODOS = ["claro", "escuro", "sistema"];
  const COR_TOPO = { navalha: ["#24272c", "#0f1114"], oceano: ["#16263d", "#0b1524"], esmeralda: ["#17302a", "#0b1a15"], bordo: ["#3a1d26", "#1c0e13"] };
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
