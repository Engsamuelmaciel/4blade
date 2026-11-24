// Página da Barbearia: escolher serviços (monta a mensagem do WhatsApp), ampliar fotos e contar toques (anônimo).
(function () {
  const corpo = document.body;
  const slug = corpo.dataset.slug;
  const nome = corpo.dataset.nome || "";
  const whats = corpo.dataset.whats;
  const padrao = corpo.dataset.msgPadrao || "";

  // Toques nos botões (WhatsApp, Como chegar, Instagram): só a contagem, sem dados de quem tocou.
  document.addEventListener("click", ev => {
    const a = ev.target.closest("[data-evento]");
    if (!a || !slug || /[?&]previa=/.test(location.search)) return;
    const dados = new Blob([JSON.stringify({ slug, tipo: a.dataset.evento })], { type: "application/json" });
    try { navigator.sendBeacon("/api/pagina/evento", dados); } catch (e) { /* sem contagem, sem problema */ }
  });

  // Escolher mais de um serviço: o botão principal leva a lista para o WhatsApp.
  const reais = c => "R$ " + (c / 100).toFixed(2).replace(".", ",").replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  const dur = m => (m >= 60 ? Math.floor(m / 60) + "h" + (m % 60 ? String(m % 60).padStart(2, "0") : "") : m + " min");
  const botao = document.getElementById("pg-solicitar");
  const ajuda = document.getElementById("pg-escolhidos");
  function atualizar() {
    if (!botao || !whats) return;
    const escolhidos = [...document.querySelectorAll(".pg-servico.escolhido")].map(li => ({
      nome: li.dataset.nome, preco: Number(li.dataset.preco), dur: Number(li.dataset.dur)
    }));
    let texto = padrao;
    if (escolhidos.length) {
      const total = escolhidos.reduce((s, x) => s + x.preco, 0);
      const tempo = escolhidos.reduce((s, x) => s + x.dur, 0);
      texto = "Olá, " + nome + "! Vim pela sua página e quero agendar: " + escolhidos.map(x => x.nome).join(" + ") +
        " (" + reais(total) + ", " + dur(tempo) + "). Qual horário vocês têm?";
      ajuda.textContent = escolhidos.length + (escolhidos.length === 1 ? " serviço escolhido" : " serviços escolhidos") + " · " + reais(total) + " · " + dur(tempo);
      ajuda.hidden = false;
    } else ajuda.hidden = true;
    botao.href = "https://wa.me/55" + whats + "?text=" + encodeURIComponent(texto);
  }
  document.querySelectorAll(".pg-escolher").forEach(b => b.addEventListener("click", () => {
    const li = b.closest(".pg-servico");
    const on = !li.classList.contains("escolhido");
    li.classList.toggle("escolhido", on);
    b.setAttribute("aria-pressed", on ? "true" : "false");
    b.textContent = on ? "✓" : "+";
    atualizar();
  }));

  // Ampliar foto da galeria
  const caixa = document.getElementById("pg-ampliar");
  if (caixa && caixa.showModal) {
    const img = caixa.querySelector("img");
    const leg = caixa.querySelector("p");
    document.querySelectorAll(".pg-foto").forEach(b => b.addEventListener("click", () => {
      const fonte = b.querySelector("img");
      img.src = fonte.src;
      img.alt = fonte.alt;
      leg.textContent = fonte.alt && !/^Foto \d+ da /.test(fonte.alt) ? fonte.alt : "";
      caixa.showModal();
    }));
    caixa.querySelector(".pg-fechar").addEventListener("click", () => caixa.close());
    caixa.addEventListener("click", ev => { if (ev.target === caixa) caixa.close(); });
  }
})();
