// Planilha CSV que abre direto no Excel em português: ponto e vírgula, vírgula decimal, datas dd/mm/aaaa, BOM UTF-8.
export const dinheiroCsv = c => (c === null || c === undefined ? "" : (Number(c) / 100).toFixed(2).replace(".", ","));
export const dataCsv = d => (d ? String(d).slice(0, 10).split("-").reverse().join("/") : "");

function celula(v) {
  if (v === null || v === undefined) return "";
  let t = String(v);
  // evita que o Excel execute fórmulas vindas de texto digitado (=, +, -, @)
  if (/^[=+\-@]/.test(t) && !/^-?\d+(,\d+)?$/.test(t)) t = `'${t}`;
  return /[;"\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
}

export function gerarCsv(cabecalho, linhas) {
  return "﻿" + [cabecalho, ...linhas].map(l => l.map(celula).join(";")).join("\r\n") + "\r\n";
}
