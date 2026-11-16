// Apoio da agenda: horas, regras de funcionamento/horário de trabalho/datas fechadas e link do WhatsApp.
import { HttpError, validDate } from "./util.js";

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

// Carrega o que decide se um horário pode ser usado num dia: funcionamento, horário do profissional, data fechada.
export async function regrasDoDia(db, barbeariaId, barbeiroId, data) {
  const dia = diaSemana(data);
  const [func, trab, fechada] = await Promise.all([
    db.prepare("SELECT * FROM funcionamento WHERE barbearia_id = ? AND dia_semana = ?").bind(barbeariaId, dia).first(),
    db.prepare("SELECT * FROM horario_trabalho WHERE barbearia_id = ? AND usuario_id = ? AND dia_semana = ?").bind(barbeariaId, barbeiroId, dia).first(),
    db.prepare(`SELECT motivo FROM datas_fechadas WHERE barbearia_id = ? AND ativo = 1 AND data_ini <= ? AND data_fim >= ? LIMIT 1`)
      .bind(barbeariaId, data, data).first()
  ]);
  return { dia, func, trab, fechada };
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

export function linkWhatsapp(telefone, texto) {
  return `https://wa.me/55${telefone}?text=${encodeURIComponent(texto)}`;
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

export function linksWhatsapp(ag, modelos, barbeariaNome) {
  const campos = camposMensagem(ag, barbeariaNome);
  const r = {};
  for (const [tipo, texto] of Object.entries(modelos)) r[tipo] = linkWhatsapp(ag.cliente_telefone, preencherModelo(texto, campos));
  return r;
}

export async function carregarModelos(db, barbeariaId) {
  const r = await db.prepare("SELECT tipo, texto FROM modelos_mensagem WHERE barbearia_id = ?").bind(barbeariaId).all();
  return Object.fromEntries(r.results.map(m => [m.tipo, m.texto]));
}
