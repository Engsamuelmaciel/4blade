// Apoio da agenda: horas, regras de funcionamento/horário de trabalho/datas fechadas e link do WhatsApp.
import { HttpError, validDate, hojeBrasil } from "./util.js";

// Mês fechado: tudo de um mês que já passou fica só para consulta (nada é corrigido, cancelado nem reaberto).
export const MSG_MES_FECHADO = "Esse mês já foi fechado: os lançamentos de meses anteriores ficam só para consulta.";
export const mesFechado = (dataDia, hoje = hojeBrasil()) => String(dataDia).slice(0, 7) < hoje.slice(0, 7);

const erro = (msg, status = 400) => { throw new HttpError(msg, status); };

// "09:30" → 570. Devolve null se inválido.
export function horaParaMin(h) {
  if (typeof h !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(h)) return null;
  return Number(h.slice(0, 2)) * 60 + Number(h.slice(3));
}
export const minParaHora = m =>
  m === null || m === undefined ? null : `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

export const diaSemana = data => new Date(`${data}T12:00:00Z`).getUTCDay();   // 0 = domingo
export const NOME_DIA = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];
export const momento = (data, min) => `${data}T${minParaHora(min)}`;          // 'AAAA-MM-DDTHH:MM'

export function somarDias(data, n) {
  const d = new Date(`${data}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function exigirData(v, rotulo = "Data") {
  if (!validDate(v)) erro(`${rotulo} inválida (AAAA-MM-DD).`);
  return v;
}

// 'AAAA-MM-DDTHH:MM' válido
export function exigirMomento(v, rotulo) {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(v) || !validDate(v.slice(0, 10)) || horaParaMin(v.slice(11)) === null) {
    erro(`${rotulo} inválido (data e hora).`);
  }
  return v;
}

// Abertura especial (26/11/2026): o dia vira "aberto" com o horário da abertura especial, para TODOS que atendem (sem olhar o
// horário semanal de cada um). Fechamento por data (feriado) continua mandando mais que tudo.
function funcionamentoEspecial(a) {
  return { aberto: 1, abre_min: a.abre_min, fecha_min: a.fecha_min, intervalo_ini_min: a.intervalo_ini_min, intervalo_fim_min: a.intervalo_fim_min,
    especial: { id: a.id, motivo: a.motivo } };
}

// Carrega o que decide se um horário pode ser usado num dia: funcionamento, horário do profissional, data fechada.
export async function regrasDoDia(db, barbeariaId, barbeiroId, data) {
  const dia = diaSemana(data);
  const [func, trab, fechada, especial] = await Promise.all([
    db.prepare("SELECT * FROM funcionamento WHERE barbearia_id = ? AND dia_semana = ?").bind(barbeariaId, dia).first(),
    db.prepare("SELECT * FROM horario_trabalho WHERE barbearia_id = ? AND usuario_id = ? AND dia_semana = ?").bind(barbeariaId, barbeiroId, dia).first(),
    db.prepare(`SELECT motivo FROM datas_fechadas WHERE barbearia_id = ? AND ativo = 1 AND data_ini <= ? AND data_fim >= ? LIMIT 1`)
      .bind(barbeariaId, data, data).first(),
    db.prepare("SELECT * FROM aberturas_especiais WHERE barbearia_id = ? AND ativo = 1 AND data = ?").bind(barbeariaId, data).first()
  ]);
  if (especial) return { dia, func: funcionamentoEspecial(especial), trab: null, fechada };
  return { dia, func, trab, fechada };
}

// Carrega de uma vez as regras de um PERÍODO (poucas consultas, mesmo para meses/anos) e devolve regras(data, barbeiroId).
export async function carregarRegras(db, barbeariaId, ini, fim) {
  const [func, trab, fechadas, especiais] = await Promise.all([
    db.prepare("SELECT * FROM funcionamento WHERE barbearia_id = ?").bind(barbeariaId).all(),
    db.prepare("SELECT * FROM horario_trabalho WHERE barbearia_id = ?").bind(barbeariaId).all(),
    db.prepare("SELECT data_ini, data_fim, motivo FROM datas_fechadas WHERE barbearia_id = ? AND ativo = 1 AND data_ini <= ? AND data_fim >= ?")
      .bind(barbeariaId, fim, ini).all(),
    db.prepare("SELECT * FROM aberturas_especiais WHERE barbearia_id = ? AND ativo = 1 AND data >= ? AND data <= ?").bind(barbeariaId, ini, fim).all()
  ]);
  const funcPor = Object.fromEntries(func.results.map(f => [f.dia_semana, f]));
  const especialPor = Object.fromEntries(especiais.results.map(a => [a.data, a]));
  const trabPor = {};
  for (const t of trab.results) (trabPor[t.usuario_id] ||= {})[t.dia_semana] = t;
  return (data, barbeiroId) => {
    const dia = diaSemana(data);
    const fechada = fechadas.results.find(f => f.data_ini <= data && f.data_fim >= data) || null;
    if (especialPor[data]) return { dia, func: funcionamentoEspecial(especialPor[data]), trab: null, fechada };
    return { dia, func: funcPor[dia] || null, trab: trabPor[barbeiroId]?.[dia] || null, fechada };
  };
}

// Janela de trabalho de um profissional num dia (minutos), sem o intervalo. null = não trabalha/fechado.
export function janelaDoDia(regras) {
  const { func, trab, fechada } = regras;
  if (fechada || !func || !func.aberto) return null;
  if (trab && !trab.trabalha) return null;
  const ini = trab ? trab.ini_min : func.abre_min;
  const fim = trab ? trab.fim_min : func.fecha_min;
  return { ini, fim, intervalo: func.intervalo_ini_min !== null && func.intervalo_ini_min !== undefined ? [func.intervalo_ini_min, func.intervalo_fim_min] : null };
}

// Minutos livres e maior intervalo livre dentro da janela, descontando ocupações [ini, fim).
export function livreNaJanela(janela, ocupados) {
  const ocup = [...ocupados];
  if (janela.intervalo) ocup.push(janela.intervalo);
  const recortes = ocup.map(([a, b]) => [Math.max(a, janela.ini), Math.min(b, janela.fim)]).filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0]);
  let cursor = janela.ini, livre = 0, maior = 0;
  for (const [a, b] of recortes) {
    if (a > cursor) { livre += a - cursor; maior = Math.max(maior, a - cursor); }
    cursor = Math.max(cursor, b);
  }
  if (janela.fim > cursor) { livre += janela.fim - cursor; maior = Math.max(maior, janela.fim - cursor); }
  return { totalMin: janela.fim - janela.ini - (janela.intervalo ? Math.max(0, Math.min(janela.intervalo[1], janela.fim) - Math.max(janela.intervalo[0], janela.ini)) : 0), livreMin: livre, maiorLivreMin: maior };
}

// Confere se [ini, fim) (minutos) cabe no dia. Lança erro com mensagem simples.
export function conferirHorario(regras, ini, fim) {
  const { func, trab, fechada, dia } = regras;
  if (fechada) erro(`A barbearia está fechada nesse dia (${fechada.motivo}).`, 409);
  if (!func) erro("O funcionamento da barbearia ainda não foi cadastrado. Peça ao gerente (menu Funcionamento).", 409);
  if (!func.aberto) erro(`A barbearia não abre às ${NOME_DIA[dia]}s.`, 409);
  if (ini < func.abre_min || fim > func.fecha_min) {
    erro(`Fora do funcionamento: às ${NOME_DIA[dia]}s a barbearia abre das ${minParaHora(func.abre_min)} às ${minParaHora(func.fecha_min)}.`, 409);
  }
  if (func.intervalo_ini_min !== null && ini < func.intervalo_fim_min && fim > func.intervalo_ini_min) {
    erro(`Esse horário cai no intervalo da barbearia (${minParaHora(func.intervalo_ini_min)}–${minParaHora(func.intervalo_fim_min)}).`, 409);
  }
  if (trab) {
    if (!trab.trabalha) erro(`O profissional não trabalha às ${NOME_DIA[dia]}s.`, 409);
    if (ini < trab.ini_min || fim > trab.fim_min) {
      erro(`Fora do horário do profissional (${minParaHora(trab.ini_min)} às ${minParaHora(trab.fim_min)}).`, 409);
    }
  }
}

// ---------- WhatsApp: link wa.me com a mensagem pronta (sem API paga, sem envio automático) ----------
export function preencherModelo(texto, campos) {
  return texto.replace(/\{(cliente|data|hora|barbeiro|servico|barbearia)\}/g, (_, c) => campos[c] ?? "");
}

// Cliente marcado sem telefone fica com o marcador "sem:<id>" na coluna (NOT NULL e única); para a tela, telefone = null.
export const PREFIXO_SEM_TELEFONE = "sem:";
export function telefoneReal(t) {
  return typeof t === "string" && /^\d{10,11}$/.test(t) ? t : null;
}

// Com telefone: abre a conversa direto com o cliente. Sem telefone (17/11/2026): abre o WhatsApp com a mensagem pronta
// para a pessoa escolher o contato (wa.me/?text=) — não precisa digitar nome nem horário.
export function linkWhatsapp(telefone, texto) {
  return telefone ? `https://wa.me/55${telefone}?text=${encodeURIComponent(texto)}` : `https://wa.me/?text=${encodeURIComponent(texto)}`;
}

export function camposMensagem(ag, barbeariaNome) {
  return {
    cliente: ag.cliente_nome.split(" ")[0],
    data: ag.data.split("-").reverse().slice(0, 2).join("/"),
    hora: ag.inicio.slice(11, 16),
    barbeiro: ag.barbeiro_nome.split(" ")[0],
    servico: ag.servicos_nomes || "",
    barbearia: barbeariaNome
  };
}

// semNumero: cliente sem telefone → link que abre o WhatsApp para a pessoa escolher o contato (wa.me/?text=).
export function linksWhatsapp(ag, modelos, barbeariaNome, { semNumero = false } = {}) {
  const tel = telefoneReal(ag.cliente_telefone);
  if (!tel && !semNumero) return null;   // sem telefone: sem WhatsApp
  const campos = camposMensagem(ag, barbeariaNome);
  const r = {};
  for (const [tipo, texto] of Object.entries(modelos)) {
    const msg = preencherModelo(texto, campos);
    r[tipo] = tel ? linkWhatsapp(tel, msg) : `https://wa.me/?text=${encodeURIComponent(msg)}`;
  }
  return r;
}

// Modelos adicionais (não cabem na tabela antiga): texto padrão quando a barbearia ainda não editou.
export const MODELOS_ADICIONAIS_PADRAO = {
  confirmacao: "Olá, {cliente}! Seu horário na {barbearia} está confirmado: {data} às {hora} com {barbeiro} ({servico}). Te esperamos!"
};
export async function carregarModelos(db, barbeariaId) {
  const [r, extra] = await Promise.all([
    db.prepare("SELECT tipo, texto FROM modelos_mensagem WHERE barbearia_id = ?").bind(barbeariaId).all(),
    db.prepare("SELECT tipo, texto FROM modelos_mensagem_adicionais WHERE barbearia_id = ?").bind(barbeariaId).all()
  ]);
  return { ...MODELOS_ADICIONAIS_PADRAO, ...Object.fromEntries(extra.results.map(m => [m.tipo, m.texto])), ...Object.fromEntries(r.results.map(m => [m.tipo, m.texto])) };
}

// ---------- pagamentos (atendimento e venda): até 2 formas, soma igual ao total ----------
export const FORMAS = ["dinheiro", "pix", "debito", "credito"];
const reaisTexto = c => (c / 100).toFixed(2).replace(".", ",");
// promissoria: aceita a forma "promissoria" (a nota do cliente: paga depois; não entra no caixa do dia).
export function lerPagamentos(pagIn, total, { promissoria = false } = {}) {
  if (!Array.isArray(pagIn)) erro("Informe a forma de pagamento.");
  if (total > 0 && (pagIn.length < 1 || pagIn.length > 2)) erro("Use 1 ou 2 formas de pagamento.");
  if (total === 0 && pagIn.length !== 0) erro("Sem valor não tem pagamento.");
  const formas = pagIn.map(p => p?.forma);
  const validas = promissoria ? [...FORMAS, "promissoria"] : FORMAS;
  if (!formas.every(f => validas.includes(f))) erro(`Forma de pagamento inválida (dinheiro, pix, débito, crédito${promissoria ? " ou promissória" : ""}).`);
  if (new Set(formas).size !== formas.length) erro("Use formas de pagamento diferentes.");
  if (!pagIn.every(p => Number.isInteger(p.valorCentavos) && p.valorCentavos > 0 && p.valorCentavos <= 10_000_000)) erro("Valor de pagamento inválido.");
  const soma = pagIn.reduce((t, p) => t + p.valorCentavos, 0);
  if (soma !== total) erro(`A soma dos pagamentos (${reaisTexto(soma)}) precisa ser igual ao total (${reaisTexto(total)}).`);
  return pagIn.map(p => ({ forma: p.forma, valorCentavos: p.valorCentavos }));
}

// Forma de pagamento ATUAL de um lançamento (considera correções de forma feitas no caixa).
export const formaEfetiva = (idCol, formaCol) => `COALESCE((SELECT cm.forma FROM caixa_movimentos cm
  WHERE cm.referencia_id = ${idCol} AND cm.tipo = 'correcao_entrada' ORDER BY cm.criado_em DESC, cm.rowid DESC LIMIT 1), ${formaCol})`;
