// 4blade — motor dos flyers (25/11/2026). Desenha no <canvas> do próprio aparelho: 8 estilos × 3 formatos.
// Carregado só quando a tela "Flyers" abre. Fontes locais (SIL OFL 1.1, ver /fontes/LICENCA.txt).
// Referências de estilo: modelos de flyer de barbearia (Canva, Kapwing, PosterMyWall, Template.net) e guias de
// paleta (vintage: vermelho-escuro + trigo + ardósia + dourado; street: preto/branco + laranja neon; luxo: preto + dourado).
(function () {
  "use strict";

  const FORMATOS = {
    story: { w: 1080, h: 1920, nome: "Story / Status", sub: "9:16 · Instagram e WhatsApp" },
    quadrado: { w: 1080, h: 1080, nome: "Post quadrado", sub: "1:1 · feed" },
    retrato: { w: 1080, h: 1350, nome: "Post retrato", sub: "4:5 · feed" }
  };

  const ESTILOS = [
    { id: "moderno", nome: "Moderno", sub: "foto forte e faixa diagonal", destaque: "#f5b700" },
    { id: "contemporaneo", nome: "Contemporâneo", sub: "minimalista e elegante", destaque: "#b08d57" },
    { id: "retro", nome: "Retrô anos 70", sub: "sol, curvas e cores quentes", destaque: "#e76f2e" },
    { id: "vintage", nome: "Barbearia clássica", sub: "vintage com listras do poste", destaque: "#c0392b" },
    { id: "neon", nome: "Neon", sub: "letreiro luminoso à noite", destaque: "#ff2bd6" },
    { id: "luxo", nome: "Luxo", sub: "preto e dourado", destaque: "#d4af37" },
    { id: "urbano", nome: "Urbano / street", sub: "amarelo, preto e fita", destaque: "#ffd400" },
    { id: "editorial", nome: "Editorial", sub: "capa de revista", destaque: "#e63946" }
  ];

  const CORES = [
    ["#f5b700", "Amarelo"], ["#d4af37", "Dourado"], ["#e63946", "Vermelho"], ["#e76f2e", "Laranja"],
    ["#ff2bd6", "Rosa neon"], ["#23c4ff", "Azul"], ["#2ecc71", "Verde"], ["#ffffff", "Branco"]
  ];

  // ---------- Fontes ----------
  const FONTES = [
    ["Anton", "anton.woff2"], ["Bebas Neue", "bebas-neue.woff2"], ["Abril Fatface", "abril-fatface.woff2"],
    ["Pacifico", "pacifico.woff2"], ["Rye", "rye.woff2"], ["Monoton", "monoton.woff2"],
    ["Montserrat", "montserrat-500.woff2", "500"], ["Montserrat", "montserrat-800.woff2", "800"],
    ["Playfair Display", "playfair-700.woff2", "700"], ["Playfair Display", "playfair-700-italic.woff2", "700", "italic"]
  ];
  let fontesProntas = null;
  function carregarFontes() {
    if (fontesProntas) return fontesProntas;
    fontesProntas = Promise.all(FONTES.map(async ([fam, arq, peso = "400", estilo = "normal"]) => {
      try {
        const f = new FontFace(fam, `url(/fontes/${arq})`, { weight: peso, style: estilo });
        await f.load();
        document.fonts.add(f);
      } catch { /* sem a fonte, o navegador usa a do sistema */ }
    }));
    return fontesProntas;
  }
  const RESERVA = ", system-ui, sans-serif";

  // ---------- Ferramentas de desenho ----------
  function fonte(g, familia, tam, peso = "400", estilo = "normal") {
    g.font = `${estilo} ${peso} ${Math.round(tam)}px "${familia}"${RESERVA}`;
  }
  function espaco(g, px) { if ("letterSpacing" in g) g.letterSpacing = `${px}px`; }

  // Quebra o texto em até maxLinhas, diminuindo a letra até caber na largura.
  function caber(g, texto, { familia, peso = "400", estilo = "normal", maxL, tam, min = 28, maxLinhas = 2, maiusculas = false, track = 0 }) {
    const t = String(texto || "").trim();
    const base = maiusculas ? t.toLocaleUpperCase("pt-BR") : t;
    if (!base) return { tam: 0, linhas: [] };
    for (let s = tam; s >= min; s -= 2) {
      fonte(g, familia, s, peso, estilo);
      espaco(g, track * s);
      const palavras = base.split(/\s+/);
      const linhas = [];
      let atual = "";
      let ok = true;
      for (const p of palavras) {
        const tenta = atual ? `${atual} ${p}` : p;
        if (g.measureText(tenta).width <= maxL) atual = tenta;
        else {
          if (!atual) { ok = false; break; }
          linhas.push(atual); atual = p;
          if (g.measureText(p).width > maxL) { ok = false; break; }
        }
      }
      if (atual) linhas.push(atual);
      if (ok && linhas.length <= maxLinhas) return { tam: s, linhas };
    }
    // não coube: corta com reticências na menor letra
    fonte(g, familia, min, peso, estilo);
    let s = base;
    while (s.length > 1 && g.measureText(`${s}…`).width > maxL * maxLinhas) s = s.slice(0, -1);
    return caber(g, `${s}…`, { familia, peso, estilo, maxL, tam: min, min: min - 2, maxLinhas, maiusculas, track });
  }
  // Escreve as linhas; devolve a posição y logo abaixo do bloco.
  function escrever(g, bloco, x, y, { cor, alin = "left", entre = 1.05, familia, peso = "400", estilo = "normal", track = 0, sombra = null, contorno = null }) {
    if (!bloco.linhas.length) return y;
    fonte(g, familia, bloco.tam, peso, estilo);
    espaco(g, track * bloco.tam);
    g.textAlign = alin; g.textBaseline = "alphabetic";
    let yy = y;
    for (const l of bloco.linhas) {
      yy += bloco.tam * (yy === y ? 0.86 : entre);
      if (sombra) { g.save(); Object.assign(g, sombra); g.fillStyle = cor; g.fillText(l, x, yy); g.restore(); }
      if (contorno) { g.save(); g.lineJoin = "round"; g.strokeStyle = contorno.cor; g.lineWidth = contorno.largura; g.strokeText(l, x, yy); g.restore(); }
      g.fillStyle = cor; g.fillText(l, x, yy);
    }
    espaco(g, 0);
    return yy + bloco.tam * 0.24;
  }
  function retRed(g, x, y, w, h, r) {
    g.beginPath();
    if (g.roundRect) g.roundRect(x, y, w, h, r);
    else { g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }
  }
  // Foto preenchendo a área (corta o que sobra), com o ponto de foco vertical escolhido (0 = topo, 1 = base).
  function cobrir(g, img, x, y, w, h, foco = 0.5) {
    if (!img) return false;
    const esc = Math.max(w / img.width, h / img.height);
    const sw = w / esc, sh = h / esc;
    const sx = (img.width - sw) / 2, sy = Math.max(0, Math.min(img.height - sh, (img.height - sh) * foco));
    g.drawImage(img, sx, sy, sw, sh, x, y, w, h);
    return true;
  }
  function tingir(g, x, y, w, h, cor, modo = "multiply", alfa = 1) {
    g.save(); g.globalCompositeOperation = modo; g.globalAlpha = alfa; g.fillStyle = cor; g.fillRect(x, y, w, h); g.restore();
  }
  function pretoEBranco(g, x, y, w, h) { tingir(g, x, y, w, h, "#808080", "saturation"); }
  function degrade(g, x0, y0, x1, y1, paradas) {
    const d = g.createLinearGradient(x0, y0, x1, y1);
    for (const [p, c] of paradas) d.addColorStop(p, c);
    return d;
  }
  // No Story, o Instagram cobre a parte de baixo (barra de resposta): o rodapé sobe 120 px.
  const fimUtil = (W, H) => (H > W * 1.5 ? H - 120 : H);
  function textoPreco(d) {
    const de = String(d.precoDe || "").trim(), por = String(d.precoPor || "").trim();
    const fmt = v => (/^[\d.,]+$/.test(v) ? `R$ ${/^\d+\.\d{1,2}$/.test(v) ? v.replace(".", ",") : v}` : v);
    return { de: de ? fmt(de) : "", por: por ? fmt(por) : "" };
  }
  const dataCurta = v => (v ? v.split("-").reverse().slice(0, 2).join("/") : "");
  function rodapeTexto(d) {
    return [d.detalhe, d.validade ? `Válido até ${dataCurta(d.validade)}` : ""].filter(Boolean);
  }
  // QR Code (matriz booleana pronta) com fundo claro e margem
  function qr(g, mod, x, y, lado, { fundo = "#ffffff", frente = "#000000", raio = 16 } = {}) {
    if (!mod) return;
    g.save();
    g.fillStyle = fundo; retRed(g, x, y, lado, lado, raio); g.fill();
    const n = mod.length, m = lado * 0.08, cel = (lado - 2 * m) / n;
    g.fillStyle = frente;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) if (mod[i][j]) g.fillRect(x + m + j * cel, y + m + i * cel, Math.ceil(cel), Math.ceil(cel));
    g.restore();
  }
  // Rodapé padrão: nome + link (e QR à direita, se ligado)
  function rodape(g, d, W, H, { cor, corSuave, fundoQr = "#ffffff", frenteQr = "#000000", altura = null, xIni = 64, familia = "Montserrat", corLink }) {
    const alt = altura || Math.round(Math.min(W, H) * 0.17);
    const y = H - alt;
    const temQr = d.qr && d.mod;
    const lado = temQr ? alt - 56 : 0;
    const maxL = W - xIni * 2 - (temQr ? lado + 28 : 0);
    const b1 = caber(g, d.nome, { familia, peso: "800", maxL, tam: 44, min: 26, maxLinhas: 1 });
    let yy = escrever(g, b1, xIni, y + 10, { cor, familia, peso: "800" });
    const b2 = caber(g, d.linkCurto, { familia, peso: "500", maxL, tam: 30, min: 20, maxLinhas: 1 });
    escrever(g, b2, xIni, yy + 2, { cor: corLink || corSuave, familia, peso: "500" });
    if (temQr) qr(g, d.mod, W - xIni - lado, y + 8, lado, { fundo: fundoQr, frente: frenteQr });
    return y;
  }
  function seloPreco(g, cx, cy, r, d, { fundo, cor, corDe, familia = "Anton", estrela = false, girar = 0 }) {
    const p = textoPreco(d);
    if (!p.por && !p.de) return;
    g.save(); g.translate(cx, cy); g.rotate(girar);
    g.fillStyle = fundo;
    if (estrela) {
      g.beginPath();
      const pontas = 18;
      for (let i = 0; i < pontas * 2; i++) { const a = (Math.PI * i) / pontas; const rr = i % 2 ? r * 0.86 : r; g.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); }
      g.closePath(); g.fill();
    } else { g.beginPath(); g.arc(0, 0, r, 0, Math.PI * 2); g.fill(); }
    g.textAlign = "center";
    if (p.de) {
      fonte(g, "Montserrat", r * 0.22, "800"); g.fillStyle = corDe || cor;
      const yDe = p.por ? -r * 0.34 : r * 0.08;
      g.fillText(`de ${p.de}`, 0, yDe);
      const w = g.measureText(`de ${p.de}`).width;
      g.fillRect(-w / 2, yDe - r * 0.07, w, Math.max(3, r * 0.025));
    }
    if (p.por) {
      const b = caber(g, p.por, { familia, peso: familia === "Montserrat" ? "800" : "400", maxL: r * 1.55, tam: r * 0.62, min: r * 0.3, maxLinhas: 1 });
      fonte(g, familia, b.tam, familia === "Montserrat" ? "800" : "400"); g.fillStyle = cor;
      g.fillText(b.linhas[0] || "", 0, (p.de ? r * 0.24 : 0) + b.tam * 0.32);
    }
    g.restore();
  }

  // ---------- Os 8 estilos ----------
  // d = { chamada, titulo, precoDe, precoPor, detalhe, validade, nome, linkCurto, cor, foto, foco, logo, qr, mod }
  const DESENHAR = {
    moderno(g, W, H, d) {
      const cor = d.cor;
      g.fillStyle = "#0f1115"; g.fillRect(0, 0, W, H);
      const fotoH = Math.round(H * (H > W * 1.5 ? 0.56 : 0.5));
      if (!cobrir(g, d.foto, 0, 0, W, fotoH, d.foco)) { g.fillStyle = degrade(g, 0, 0, W, fotoH, [[0, "#2b2f36"], [1, "#0f1115"]]); g.fillRect(0, 0, W, fotoH); }
      g.fillStyle = degrade(g, 0, fotoH * 0.55, 0, fotoH, [[0, "rgba(15,17,21,0)"], [1, "rgba(15,17,21,0.85)"]]); g.fillRect(0, 0, W, fotoH);
      // faixa diagonal
      g.fillStyle = "#0f1115"; g.beginPath(); g.moveTo(0, fotoH - 40); g.lineTo(W, fotoH - 150); g.lineTo(W, H); g.lineTo(0, H); g.closePath(); g.fill();
      g.fillStyle = cor; g.beginPath(); g.moveTo(0, fotoH - 40); g.lineTo(W, fotoH - 150); g.lineTo(W, fotoH - 132); g.lineTo(0, fotoH - 22); g.closePath(); g.fill();
      let y = fotoH - 10;
      const x = 64, maxL = W - 128;
      if (d.chamada) {
        const c = caber(g, d.chamada, { familia: "Montserrat", peso: "800", maxL: maxL * 0.8, tam: 40, min: 24, maxLinhas: 1, maiusculas: true, track: 0.12 });
        fonte(g, "Montserrat", c.tam, "800"); espaco(g, c.tam * 0.12);
        const w = g.measureText(c.linhas[0]).width + 40;
        g.fillStyle = cor; retRed(g, x, y + 10, w, c.tam * 1.6, 8); g.fill(); espaco(g, 0);
        escrever(g, c, x + 20, y + 10 + c.tam * 0.18, { cor: "#0f1115", familia: "Montserrat", peso: "800", track: 0.12 });
        y += c.tam * 1.6 + 26;
      }
      const t = caber(g, d.titulo, { familia: "Anton", maxL, tam: H > 1500 ? 150 : 120, min: 54, maxLinhas: 3, maiusculas: true });
      y = escrever(g, t, x, y, { cor: "#ffffff", familia: "Anton", entre: 1.0 });
      const p = textoPreco(d);
      if (p.por || p.de) {
        y += 10;
        if (p.de) { fonte(g, "Montserrat", 38, "800"); g.fillStyle = "#9aa0a8"; g.textAlign = "left"; g.fillText(`de ${p.de}`, x, y + 40); const w = g.measureText(`de ${p.de}`).width; g.fillRect(x, y + 27, w, 4); y += 52; }
        if (p.por) { const b = caber(g, `por ${p.por}`, { familia: "Anton", maxL, tam: 110, min: 50, maxLinhas: 1 }); y = escrever(g, b, x, y, { cor, familia: "Anton" }); }
      }
      const r = rodapeTexto(d);
      if (r.length) { const b = caber(g, r.join(" · "), { familia: "Montserrat", peso: "500", maxL, tam: 36, min: 24, maxLinhas: 2 }); escrever(g, b, x, y + 6, { cor: "#c9ccd1", familia: "Montserrat", peso: "500", entre: 1.25 }); }
      g.fillStyle = "rgba(255,255,255,.12)"; g.fillRect(64, fimUtil(W, H) - Math.round(Math.min(W, H) * 0.17) - 24, W - 128, 2);
      rodape(g, d, W, fimUtil(W, H), { cor: "#ffffff", corSuave: "#c9ccd1", corLink: cor });
    },

    contemporaneo(g, W, H, d) {
      const cor = d.cor, tinta = "#1e1e1e";
      g.fillStyle = "#f3f0ea"; g.fillRect(0, 0, W, H);
      const m = 64;
      const fotoH = Math.round(H * (H > W * 1.5 ? 0.56 : 0.44));
      g.save(); retRed(g, m, m, W - 2 * m, fotoH, 28); g.clip();
      if (!cobrir(g, d.foto, m, m, W - 2 * m, fotoH, d.foco)) { g.fillStyle = "#dcd6cb"; g.fillRect(m, m, W - 2 * m, fotoH); }
      g.restore();
      let y = m + fotoH + 54;
      if (d.chamada) {
        const c = caber(g, d.chamada, { familia: "Montserrat", peso: "500", maxL: W - 2 * m, tam: 30, min: 20, maxLinhas: 1, maiusculas: true, track: 0.32 });
        y = escrever(g, c, m, y, { cor, familia: "Montserrat", peso: "500", track: 0.32 });
        g.fillStyle = cor; g.fillRect(m, y + 6, 90, 3); y += 34;
      }
      const t = caber(g, d.titulo, { familia: "Playfair Display", peso: "700", maxL: W - 2 * m, tam: H > 1500 ? 118 : 96, min: 48, maxLinhas: 3 });
      y = escrever(g, t, m, y, { cor: tinta, familia: "Playfair Display", peso: "700", entre: 1.08 });
      const p = textoPreco(d);
      if (p.por || p.de) {
        y += 18;
        fonte(g, "Montserrat", 40, "500"); g.textAlign = "left";
        let x = m;
        if (p.de) { g.fillStyle = "#8a857c"; g.fillText(p.de, x, y + 40); const w = g.measureText(p.de).width; g.fillRect(x, y + 27, w, 2); x += w + 26; }
        if (p.por) { fonte(g, "Playfair Display", 64, "700"); g.fillStyle = tinta; g.fillText(p.por, x, y + 46); }
        y += 74;
      }
      const r = rodapeTexto(d);
      if (r.length) { const b = caber(g, r.join(" · "), { familia: "Montserrat", peso: "500", maxL: W - 2 * m, tam: 32, min: 22, maxLinhas: 2 }); escrever(g, b, m, y + 10, { cor: "#5b5750", familia: "Montserrat", peso: "500", entre: 1.3 }); }
      g.fillStyle = tinta; g.fillRect(m, fimUtil(W, H) - Math.round(Math.min(W, H) * 0.17) - 22, W - 2 * m, 2);
      rodape(g, d, W, fimUtil(W, H), { cor: tinta, corSuave: "#5b5750", corLink: cor, fundoQr: "#f3f0ea", frenteQr: tinta });
    },

    retro(g, W, H, d) {
      const laranja = d.cor, mostarda = "#f2a541", marrom = "#5c3d2e", creme = "#f6e7c8", verde = "#2a9d8f";
      g.fillStyle = creme; g.fillRect(0, 0, W, H);
      // sol com raios
      const cx = W / 2, cy = H * (H > W * 1.5 ? 0.33 : 0.36), R = Math.max(W, H);
      for (let i = 0; i < 24; i++) {
        g.fillStyle = i % 2 ? "rgba(242,165,65,.28)" : "rgba(231,111,46,.18)";
        g.beginPath(); g.moveTo(cx, cy); g.arc(cx, cy, R, (i * Math.PI) / 12, ((i + 1) * Math.PI) / 12); g.closePath(); g.fill();
      }
      // ondas no fim
      const faixas = [laranja, mostarda, verde, marrom];
      const yOnda = H * 0.7;
      faixas.forEach((c, i) => {
        g.fillStyle = c; g.beginPath(); g.moveTo(0, yOnda + i * 26);
        for (let x = 0; x <= W; x += 20) g.lineTo(x, yOnda + i * 26 + Math.sin(x / 120 + i) * 22);
        g.lineTo(W, H); g.lineTo(0, H); g.closePath(); g.fill();
      });
      g.fillStyle = marrom; g.fillRect(0, yOnda + 4 * 26 + 10, W, H);
      // foto num círculo
      const rf = Math.min(W, H) * (H > W * 1.5 ? 0.3 : 0.24);
      g.save(); g.beginPath(); g.arc(cx, cy, rf, 0, Math.PI * 2); g.clip();
      if (!cobrir(g, d.foto, cx - rf, cy - rf, rf * 2, rf * 2, d.foco)) { g.fillStyle = mostarda; g.fillRect(cx - rf, cy - rf, rf * 2, rf * 2); }
      tingir(g, cx - rf, cy - rf, rf * 2, rf * 2, "#f2a541", "multiply", 0.25);
      g.restore();
      g.lineWidth = 16; g.strokeStyle = marrom; g.beginPath(); g.arc(cx, cy, rf + 8, 0, Math.PI * 2); g.stroke();
      g.lineWidth = 8; g.strokeStyle = laranja; g.beginPath(); g.arc(cx, cy, rf + 22, 0, Math.PI * 2); g.stroke();
      let y = cy + rf + 40;
      if (d.chamada) {
        const c = caber(g, d.chamada, { familia: "Pacifico", maxL: W - 160, tam: 74, min: 36, maxLinhas: 1 });
        y = escrever(g, c, cx, y, { cor: laranja, alin: "center", familia: "Pacifico", contorno: { cor: creme, largura: 10 } }) - 6;
      }
      const t = caber(g, d.titulo, { familia: "Abril Fatface", maxL: W - 120, tam: H > 1500 ? 120 : 92, min: 44, maxLinhas: 2, maiusculas: true });
      y = escrever(g, t, cx, y, { cor: marrom, alin: "center", familia: "Abril Fatface", sombra: { shadowColor: mostarda, shadowOffsetX: 6, shadowOffsetY: 6 } });
      seloPreco(g, W - Math.min(W, H) * 0.17, cy - rf * 0.75, Math.min(W, H) * 0.13, d, { fundo: verde, cor: creme, corDe: "#d7efe9", familia: "Abril Fatface", girar: -0.18 });
      const r = rodapeTexto(d);
      if (r.length) { const b = caber(g, r.join(" · "), { familia: "Montserrat", peso: "800", maxL: W - 160, tam: 34, min: 22, maxLinhas: 2 }); escrever(g, b, cx, Math.max(y, yOnda - 70), { cor: marrom, alin: "center", familia: "Montserrat", peso: "800", entre: 1.25 }); }
      rodape(g, d, W, fimUtil(W, H), { cor: creme, corSuave: "#f2d9b0", corLink: mostarda, fundoQr: creme, frenteQr: marrom });
    },

    vintage(g, W, H, d) {
      const vermelho = d.cor, trigo = "#f5deb3", ouro = "#daa520", fundo = "#1d1a16";
      g.fillStyle = fundo; g.fillRect(0, 0, W, H);
      // listras do poste de barbeiro (topo e base)
      const listras = (y, h) => {
        g.save(); g.beginPath(); g.rect(0, y, W, h); g.clip();
        const cores = [vermelho, "#f8f4ec", "#1f3b73", "#f8f4ec"];
        for (let i = -4, k = 0; i * 34 < W + h; i++, k++) {
          g.fillStyle = cores[k % 4]; g.beginPath();
          g.moveTo(i * 34, y + h); g.lineTo(i * 34 + 34, y + h); g.lineTo(i * 34 + 34 + h, y); g.lineTo(i * 34 + h, y); g.closePath(); g.fill();
        }
        g.restore();
      };
      listras(0, 34); listras(H - 34, 34);
      // moldura dupla
      g.strokeStyle = ouro; g.lineWidth = 4; g.strokeRect(40, 66, W - 80, H - 132); g.lineWidth = 1.5; g.strokeRect(54, 80, W - 108, H - 160);
      const fotoH = Math.round(H * (H > W * 1.5 ? 0.44 : 0.34));
      const fx = 90, fy = 120, fw = W - 180;
      if (cobrir(g, d.foto, fx, fy, fw, fotoH, d.foco)) {
        pretoEBranco(g, fx, fy, fw, fotoH);
        tingir(g, fx, fy, fw, fotoH, "#9c6b30", "multiply", 0.5);
        tingir(g, fx, fy, fw, fotoH, "#000", "source-over", 0.12);
      } else { g.fillStyle = "#2b2620"; g.fillRect(fx, fy, fw, fotoH); }
      g.strokeStyle = ouro; g.lineWidth = 3; g.strokeRect(fx, fy, fw, fotoH);
      let y = fy + fotoH + 40;
      const ornamento = yy => {
        g.strokeStyle = ouro; g.lineWidth = 2; g.beginPath(); g.moveTo(W / 2 - 220, yy); g.lineTo(W / 2 - 30, yy); g.moveTo(W / 2 + 30, yy); g.lineTo(W / 2 + 220, yy); g.stroke();
        g.fillStyle = ouro; g.save(); g.translate(W / 2, yy); g.rotate(Math.PI / 4); g.fillRect(-10, -10, 20, 20); g.restore();
      };
      if (d.chamada) {
        const c = caber(g, d.chamada, { familia: "Playfair Display", peso: "700", estilo: "italic", maxL: W - 240, tam: 54, min: 30, maxLinhas: 1 });
        y = escrever(g, c, W / 2, y, { cor: ouro, alin: "center", familia: "Playfair Display", peso: "700", estilo: "italic" });
      }
      ornamento(y + 8); y += 34;
      const t = caber(g, d.titulo, { familia: "Rye", maxL: W - 200, tam: H > 1500 ? 104 : 80, min: 40, maxLinhas: 3, maiusculas: true });
      y = escrever(g, t, W / 2, y, { cor: trigo, alin: "center", familia: "Rye", entre: 1.12 });
      const p = textoPreco(d);
      if (p.por || p.de) {
        y += 12;
        const txt = [p.de ? `de ${p.de}` : "", p.por ? `por ${p.por}` : ""].filter(Boolean).join("  ");
        const b = caber(g, txt, { familia: "Rye", maxL: W - 260, tam: 70, min: 34, maxLinhas: 1 });
        fonte(g, "Rye", b.tam); const w = g.measureText(b.linhas[0]).width + 80;
        g.fillStyle = vermelho; retRed(g, W / 2 - w / 2, y, w, b.tam * 1.55, 10); g.fill();
        g.strokeStyle = ouro; g.lineWidth = 3; retRed(g, W / 2 - w / 2 + 8, y + 8, w - 16, b.tam * 1.55 - 16, 6); g.stroke();
        escrever(g, b, W / 2, y + b.tam * 0.28, { cor: "#fff8ec", alin: "center", familia: "Rye" });
        y += b.tam * 1.55 + 24;
      }
      const r = rodapeTexto(d);
      if (r.length) { const b = caber(g, r.join(" · "), { familia: "Playfair Display", peso: "700", estilo: "italic", maxL: W - 240, tam: 38, min: 24, maxLinhas: 2 }); escrever(g, b, W / 2, y, { cor: trigo, alin: "center", familia: "Playfair Display", peso: "700", estilo: "italic", entre: 1.25 }); }
      const alt = Math.round(Math.min(W, H) * 0.19);
      const fimV = fimUtil(W, H) - 60;
      ornamento(fimV - alt - 22);
      rodape(g, d, W, fimV, { cor: trigo, corSuave: "#cbb994", corLink: ouro, altura: alt, xIni: 96, fundoQr: trigo, frenteQr: fundo });
    },

    neon(g, W, H, d) {
      const rosa = d.cor, ciano = "#23f0ff";
      g.fillStyle = "#07070d"; g.fillRect(0, 0, W, H);
      if (cobrir(g, d.foto, 0, 0, W, H, d.foco)) { pretoEBranco(g, 0, 0, W, H); tingir(g, 0, 0, W, H, "#1a0b3a", "multiply", 0.9); g.fillStyle = "rgba(7,7,13,.55)"; g.fillRect(0, 0, W, H); }
      // brilho de fundo
      g.fillStyle = degrade(g, 0, 0, 0, H, [[0, "rgba(255,43,214,.10)"], [0.5, "rgba(0,0,0,0)"], [1, "rgba(35,240,255,.10)"]]); g.fillRect(0, 0, W, H);
      const brilho = (c, b) => ({ shadowColor: c, shadowBlur: b });
      // moldura neon
      g.save(); Object.assign(g, brilho(ciano, 30)); g.strokeStyle = ciano; g.lineWidth = 8; retRed(g, 48, 48, W - 96, H - 96, 40); g.stroke(); g.restore();
      g.save(); g.strokeStyle = "#e9fdff"; g.lineWidth = 2.5; retRed(g, 48, 48, W - 96, H - 96, 40); g.stroke(); g.restore();
      let y = H * (H > W * 1.5 ? 0.3 : 0.16);
      if (d.chamada) {
        const c = caber(g, d.chamada, { familia: "Monoton", maxL: W - 200, tam: 96, min: 40, maxLinhas: 1, maiusculas: true });
        y = escrever(g, c, W / 2, y, { cor: "#ffe8fb", alin: "center", familia: "Monoton", sombra: brilho(rosa, 40) });
        y += 20;
      }
      const t = caber(g, d.titulo, { familia: "Bebas Neue", maxL: W - 180, tam: H > 1500 ? 200 : 150, min: 64, maxLinhas: 3, maiusculas: true, track: 0.02 });
      g.save(); Object.assign(g, brilho(ciano, 36));
      y = escrever(g, t, W / 2, y, { cor: "#e9fdff", alin: "center", familia: "Bebas Neue", entre: 0.95, track: 0.02, contorno: { cor: ciano, largura: 6 } });
      g.restore();
      const p = textoPreco(d);
      if (p.por || p.de) {
        y += 20;
        if (p.de) { fonte(g, "Bebas Neue", 64); g.textAlign = "center"; g.fillStyle = "#b9b4d6"; g.fillText(`DE ${p.de}`, W / 2, y + 56); const w = g.measureText(`DE ${p.de}`).width; g.fillStyle = rosa; g.fillRect(W / 2 - w / 2, y + 34, w, 5); y += 72; }
        if (p.por) { const b = caber(g, `POR ${p.por}`, { familia: "Bebas Neue", maxL: W - 200, tam: 150, min: 60, maxLinhas: 1 }); g.save(); Object.assign(g, brilho(rosa, 40)); y = escrever(g, b, W / 2, y, { cor: "#ffe8fb", alin: "center", familia: "Bebas Neue", contorno: { cor: rosa, largura: 6 } }); g.restore(); }
      }
      const r = rodapeTexto(d);
      if (r.length) { const b = caber(g, r.join(" · "), { familia: "Montserrat", peso: "500", maxL: W - 200, tam: 36, min: 24, maxLinhas: 2 }); escrever(g, b, W / 2, y + 16, { cor: "#d7d3f0", alin: "center", familia: "Montserrat", peso: "500", entre: 1.3 }); }
      rodape(g, d, W, fimUtil(W, H) - 40, { cor: "#ffffff", corSuave: "#c7c2ea", corLink: ciano, xIni: 96 });
    },

    luxo(g, W, H, d) {
      const ouro = degrade(g, 0, 0, W, H, [[0, "#bf953f"], [0.3, "#fcf6ba"], [0.55, "#b38728"], [0.8, "#fbf5b7"], [1, "#aa771c"]]);
      const ouroSolido = d.cor;
      g.fillStyle = "#0b0b0b"; g.fillRect(0, 0, W, H);
      const fotoH = Math.round(H * (H > W * 1.5 ? 0.5 : 0.46));
      if (cobrir(g, d.foto, 0, 0, W, fotoH, d.foco)) {
        pretoEBranco(g, 0, 0, W, fotoH);
        g.fillStyle = degrade(g, 0, fotoH * 0.4, 0, fotoH, [[0, "rgba(11,11,11,0)"], [1, "rgba(11,11,11,1)"]]); g.fillRect(0, 0, W, fotoH);
      } else { g.fillStyle = degrade(g, 0, 0, 0, fotoH, [[0, "#1c1c1c"], [1, "#0b0b0b"]]); g.fillRect(0, 0, W, fotoH); }
      g.strokeStyle = ouro; g.lineWidth = 3; g.strokeRect(36, 36, W - 72, H - 72); g.lineWidth = 1; g.strokeRect(48, 48, W - 96, H - 96);
      let y = fotoH - (H > W * 1.5 ? 40 : 70);
      if (d.chamada) {
        const c = caber(g, d.chamada, { familia: "Montserrat", peso: "500", maxL: W - 200, tam: 30, min: 20, maxLinhas: 1, maiusculas: true, track: 0.45 });
        y = escrever(g, c, W / 2, y, { cor: ouro, alin: "center", familia: "Montserrat", peso: "500", track: 0.45 });
        y += 8;
      }
      const t = caber(g, d.titulo, { familia: "Playfair Display", peso: "700", estilo: "italic", maxL: W - 180, tam: H > 1500 ? 130 : 100, min: 48, maxLinhas: 3 });
      y = escrever(g, t, W / 2, y, { cor: ouro, alin: "center", familia: "Playfair Display", peso: "700", estilo: "italic", entre: 1.06 });
      g.fillStyle = ouro; g.fillRect(W / 2 - 70, y + 14, 140, 2); y += 46;
      const p = textoPreco(d);
      if (p.por || p.de) {
        fonte(g, "Montserrat", 36, "500"); g.textAlign = "center";
        if (p.de) { g.fillStyle = "#8f8a7e"; g.fillText(`de ${p.de}`, W / 2, y + 30); const w = g.measureText(`de ${p.de}`).width; g.fillRect(W / 2 - w / 2, y + 19, w, 2); y += 48; }
        if (p.por) { const b = caber(g, p.por, { familia: "Playfair Display", peso: "700", maxL: W - 260, tam: 100, min: 48, maxLinhas: 1 }); y = escrever(g, b, W / 2, y, { cor: "#f7f1df", alin: "center", familia: "Playfair Display", peso: "700" }); }
      }
      const r = rodapeTexto(d);
      if (r.length) { const b = caber(g, r.join(" · "), { familia: "Montserrat", peso: "500", maxL: W - 220, tam: 30, min: 20, maxLinhas: 2, track: 0.08 }); escrever(g, b, W / 2, y + 12, { cor: "#cfc8b6", alin: "center", familia: "Montserrat", peso: "500", entre: 1.35, track: 0.08 }); }
      rodape(g, d, W, fimUtil(W, H) - 56, { cor: "#f7f1df", corSuave: "#a39d8f", corLink: ouroSolido, xIni: 88, fundoQr: "#f7f1df", frenteQr: "#0b0b0b", familia: "Montserrat" });
    },

    urbano(g, W, H, d) {
      const amarelo = d.cor, preto = "#111111";
      g.fillStyle = amarelo; g.fillRect(0, 0, W, H);
      // pontinhos (meio-tom)
      g.fillStyle = "rgba(0,0,0,.10)";
      for (let y = 0; y < H; y += 26) for (let x = (y / 26) % 2 ? 13 : 0; x < W; x += 26) { g.beginPath(); g.arc(x, y, 4, 0, Math.PI * 2); g.fill(); }
      const fotoH = Math.round(H * (H > W * 1.5 ? 0.46 : 0.42));
      g.save(); g.translate(W / 2, fotoH / 2 + 70); g.rotate(-0.035);
      g.fillStyle = preto; g.fillRect(-W / 2 + 40, -fotoH / 2 - 12, W - 80, fotoH + 24);
      if (cobrir(g, d.foto, -W / 2 + 52, -fotoH / 2, W - 104, fotoH, d.foco)) { pretoEBranco(g, -W / 2 + 52, -fotoH / 2, W - 104, fotoH); tingir(g, -W / 2 + 52, -fotoH / 2, W - 104, fotoH, amarelo, "multiply", 0.55); }
      else { g.fillStyle = "#2a2a2a"; g.fillRect(-W / 2 + 52, -fotoH / 2, W - 104, fotoH); }
      g.restore();
      // fitas
      const fita = (x, y, ang) => { g.save(); g.translate(x, y); g.rotate(ang); g.fillStyle = "rgba(255,255,255,.75)"; g.fillRect(-90, -24, 180, 48); g.restore(); };
      fita(150, 70, -0.6); fita(W - 150, 70, 0.6);
      let y = fotoH + 120;
      if (d.chamada) {
        const c = caber(g, d.chamada, { familia: "Anton", maxL: W - 200, tam: 70, min: 36, maxLinhas: 1, maiusculas: true, track: 0.04 });
        fonte(g, "Anton", c.tam); espaco(g, c.tam * 0.04);
        const w = g.measureText(c.linhas[0]).width + 50; espaco(g, 0);
        g.save(); g.translate(80, y); g.rotate(-0.04); g.fillStyle = preto; g.fillRect(0, 0, w, c.tam * 1.35); g.restore();
        escrever(g, c, 105, y + c.tam * 0.12, { cor: amarelo, familia: "Anton", track: 0.04 });
        y += c.tam * 1.35 + 18;
      }
      const t = caber(g, d.titulo, { familia: "Anton", maxL: W - 150, tam: H > 1500 ? 170 : 130, min: 60, maxLinhas: 3, maiusculas: true });
      y = escrever(g, t, 74, y, { cor: preto, familia: "Anton", entre: 0.98, contorno: { cor: "#ffffff", largura: 10 } });
      seloPreco(g, W - Math.min(W, H) * 0.19, fotoH + 40, Math.min(W, H) * 0.155, d, { fundo: preto, cor: amarelo, corDe: "#ffffff", estrela: true, girar: 0.12 });
      const r = rodapeTexto(d);
      if (r.length) { const b = caber(g, r.join(" · ").toLocaleUpperCase("pt-BR"), { familia: "Montserrat", peso: "800", maxL: W - 150, tam: 34, min: 22, maxLinhas: 2 }); escrever(g, b, 74, y + 8, { cor: preto, familia: "Montserrat", peso: "800", entre: 1.25 }); }
      const alt = Math.round(Math.min(W, H) * 0.17);
      g.fillStyle = preto; g.fillRect(0, fimUtil(W, H) - alt - 16, W, H);
      rodape(g, d, W, fimUtil(W, H), { cor: "#ffffff", corSuave: "#d0d0d0", corLink: amarelo, altura: alt });
    },

    editorial(g, W, H, d) {
      const cor = d.cor;
      g.fillStyle = "#151515"; g.fillRect(0, 0, W, H);
      if (!cobrir(g, d.foto, 0, 0, W, H, d.foco)) { g.fillStyle = degrade(g, 0, 0, W, H, [[0, "#3a3a3a"], [1, "#111"]]); g.fillRect(0, 0, W, H); }
      g.fillStyle = degrade(g, 0, 0, 0, H * 0.28, [[0, "rgba(0,0,0,.65)"], [1, "rgba(0,0,0,0)"]]); g.fillRect(0, 0, W, H * 0.28);
      g.fillStyle = degrade(g, 0, H * 0.42, 0, H, [[0, "rgba(0,0,0,0)"], [0.55, "rgba(0,0,0,.72)"], [1, "rgba(0,0,0,.95)"]]); g.fillRect(0, H * 0.42, W, H * 0.58);
      // cabeçalho de revista: nome da barbearia
      const topo = caber(g, d.nome, { familia: "Bebas Neue", maxL: W - 120, tam: H > 1500 ? 190 : 150, min: 70, maxLinhas: 1, maiusculas: true, track: 0.04 });
      let yTopo = escrever(g, topo, W / 2, 40, { cor: "#ffffff", alin: "center", familia: "Bebas Neue", track: 0.04 });
      const meses = ["JANEIRO", "FEVEREIRO", "MARÇO", "ABRIL", "MAIO", "JUNHO", "JULHO", "AGOSTO", "SETEMBRO", "OUTUBRO", "NOVEMBRO", "DEZEMBRO"];
      const agora = new Date();
      fonte(g, "Montserrat", 24, "800"); espaco(g, 6); g.textAlign = "center"; g.fillStyle = cor;
      g.fillText(`EDIÇÃO DE ${meses[agora.getMonth()]} ${agora.getFullYear()}`, W / 2, yTopo + 18); espaco(g, 0);
      // bloco de baixo
      const alt = Math.round(Math.min(W, H) * 0.17);
      let y = fimUtil(W, H) - alt - 60;
      const t = caber(g, d.titulo, { familia: "Playfair Display", peso: "700", maxL: W - 128, tam: H > 1500 ? 128 : 96, min: 48, maxLinhas: 3 });
      const r = rodapeTexto(d);
      const br = r.length ? caber(g, r.join(" · "), { familia: "Montserrat", peso: "500", maxL: W - 128, tam: 32, min: 22, maxLinhas: 2 }) : null;
      const altT = t.linhas.length * t.tam * 1.06 + 10, altR = br ? br.linhas.length * br.tam * 1.3 + 16 : 0;
      y -= altT + altR;
      const c = d.chamada ? caber(g, d.chamada, { familia: "Montserrat", peso: "800", maxL: W - 128, tam: 32, min: 22, maxLinhas: 1, maiusculas: true, track: 0.2 }) : null;
      if (c) {
        fonte(g, "Montserrat", c.tam, "800"); espaco(g, c.tam * 0.2); const w = g.measureText(c.linhas[0]).width + 36; espaco(g, 0);
        g.fillStyle = cor; g.fillRect(64, y - c.tam * 1.7, w, c.tam * 1.5);
        escrever(g, c, 82, y - c.tam * 1.7 + c.tam * 0.2, { cor: "#ffffff", familia: "Montserrat", peso: "800", track: 0.2 });
      }
      y = escrever(g, t, 64, y, { cor: "#ffffff", familia: "Playfair Display", peso: "700", entre: 1.06 });
      if (br) escrever(g, br, 64, y + 6, { cor: "#e0e0e0", familia: "Montserrat", peso: "500", entre: 1.3 });
      seloPreco(g, W - Math.min(W, H) * 0.2, H * (H > W * 1.5 ? 0.42 : 0.36), Math.min(W, H) * 0.14, d, { fundo: cor, cor: "#ffffff", corDe: "#ffe5e5", familia: "Playfair Display" });
      rodape(g, d, W, fimUtil(W, H), { cor: "#ffffff", corSuave: "#cfcfcf", corLink: cor });
    }
  };

  // Desenha o flyer inteiro num canvas (tamanho real do formato). opcoes.escala < 1 = miniatura.
  async function desenhar(canvas, d, { escala = 1 } = {}) {
    await carregarFontes();
    const f = FORMATOS[d.formato] || FORMATOS.story;
    canvas.width = Math.round(f.w * escala); canvas.height = Math.round(f.h * escala);
    const g = canvas.getContext("2d");
    g.setTransform(escala, 0, 0, escala, 0, 0);
    g.imageSmoothingQuality = "high";
    const estilo = ESTILOS.find(e => e.id === d.estilo) || ESTILOS[0];
    const dados = { ...d, cor: d.cor || estilo.destaque };
    (DESENHAR[estilo.id] || DESENHAR.moderno)(g, f.w, f.h, dados);
    g.setTransform(1, 0, 0, 1, 0, 0);
    return canvas;
  }

  // JPEG até ~1,1 MB (o servidor aceita 1,2 MB).
  async function exportar(canvas) {
    for (const q of [0.9, 0.84, 0.76, 0.66, 0.55]) {
      const b = await new Promise(ok => canvas.toBlob(ok, "image/jpeg", q));
      if (b && b.size <= 1100 * 1024) return b;
    }
    throw new Error("O flyer ficou pesado demais. Tente outra foto.");
  }

  window.FLYERS = { FORMATOS, ESTILOS, CORES, desenhar, exportar, carregarFontes };
})();
