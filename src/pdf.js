// Gerador de PDF mínimo, sem biblioteca: texto em Helvetica (WinAnsi, aceita acentos do português), várias páginas A4.
// Uso: gerarPdf([{ texto, tamanho?, negrito?, espaco? }, ...]) → Uint8Array

// Troca o que não existe em WinAnsi por equivalentes simples.
function paraLatin1(t) {
  return String(t)
    .replace(/[–—−]/g, "-").replace(/[→]/g, "->").replace(/[×]/g, "x").replace(/[“”]/g, '"').replace(/[‘’]/g, "'")
    .replace(/…/g, "...").replace(/[^\x20-\x7E\xA0-\xFF]/g, "?");
}
const escapar = t => paraLatin1(t).replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");

// Quebra linhas longas (largura aproximada da Helvetica: 0,5 × tamanho por letra).
function quebrar(texto, tamanho, largura) {
  const max = Math.max(20, Math.floor(largura / (tamanho * 0.5)));
  const saida = [];
  for (const parte of String(texto).split("\n")) {
    let linha = "";
    for (const palavra of parte.split(" ")) {
      if ((linha + " " + palavra).trim().length > max && linha) { saida.push(linha); linha = palavra; }
      else linha = (linha + " " + palavra).trim();
    }
    saida.push(linha);
  }
  return saida;
}

export function gerarPdf(linhas, { rodape = "" } = {}) {
  const L = 595, A = 842, M = 40;
  const paginas = [];
  let atual = [];
  let y = A - M;
  const novaPagina = () => { paginas.push(atual); atual = []; y = A - M; };
  for (const l of linhas) {
    const tam = l.tamanho || 10;
    y -= l.espaco || 0;
    for (const t of quebrar(l.texto ?? "", tam, L - 2 * M)) {
      if (y - tam * 1.35 < M + 20) novaPagina();
      y -= tam * 1.35;
      atual.push(`BT /${l.negrito ? "F2" : "F1"} ${tam} Tf ${M} ${y.toFixed(1)} Td (${escapar(t)}) Tj ET`);
    }
  }
  paginas.push(atual);

  const objetos = [];
  const add = conteudo => { objetos.push(conteudo); return objetos.length; };
  const catalogo = add(null);
  const raiz = add(null);
  const f1 = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
  const f2 = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");
  const kids = [];
  paginas.forEach((cmds, i) => {
    const rod = `BT /F1 8 Tf ${M} 24 Td (${escapar(`${rodape}  ·  página ${i + 1} de ${paginas.length}`)}) Tj ET`;
    const stream = [...cmds, rod].join("\n");
    const conteudo = add(`<< /Length ${latin1Bytes(stream).length} >>\nstream\n${stream}\nendstream`);
    kids.push(add(`<< /Type /Page /Parent ${raiz} 0 R /MediaBox [0 0 ${L} ${A}] /Resources << /Font << /F1 ${f1} 0 R /F2 ${f2} 0 R >> >> /Contents ${conteudo} 0 R >>`));
  });
  objetos[catalogo - 1] = `<< /Type /Catalog /Pages ${raiz} 0 R >>`;
  objetos[raiz - 1] = `<< /Type /Pages /Kids [${kids.map(k => `${k} 0 R`).join(" ")}] /Count ${kids.length} >>`;

  let saida = "%PDF-1.4\n%\xE2\xE3\xCF\xD3\n";
  const offsets = [];
  objetos.forEach((o, i) => { offsets.push(latin1Bytes(saida).length); saida += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = latin1Bytes(saida).length;
  saida += `xref\n0 ${objetos.length + 1}\n0000000000 65535 f \n${offsets.map(o => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  saida += `trailer\n<< /Size ${objetos.length + 1} /Root ${catalogo} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return latin1Bytes(saida);
}

function latin1Bytes(s) {
  const b = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i) & 0xff;
  return b;
}

export function base64(bytes) {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
