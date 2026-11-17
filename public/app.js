/*
 * 4blade — tela (PWA, JavaScript sem framework).
 * CSP rígida: nada de style="" nem script inline; cor/forma por classe (style.css).
 * replaceChildren(...) com null insere "null": sempre filtrar com .filter(Boolean) (feito em el()).
 */
"use strict";

const CHAVE_TOKEN = "4blade.token";
const app = document.getElementById("app");
const janela = document.getElementById("janela");
let usuario = null;

// ---------- utilidades de tela ----------
function el(tag, attrs = {}, ...filhos) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === "class") e.className = v;
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else if (k === "text") e.textContent = v;
    else if (v === true) e.setAttribute(k, "");
    else e.setAttribute(k, v);
  }
  e.append(...filhos.flat().filter(f => f !== null && f !== undefined && f !== false));
  return e;
}

function mostrar(...filhos) {
  document.body.classList.remove("tela-entrada");
  app.replaceChildren(...filhos.flat().filter(Boolean));
  aplicarMascaras(app);
  app.focus({ preventScroll: true });
  window.scrollTo(0, 0);
}

// ---------- CARREGANDO (logo animada) ----------
// Aparece só se a espera passar de 250 ms (evita piscar). A 1ª vez (abertura do app) é a tela cheia com a frase.
const carga = { n: 0, timer: null, inicio: Date.now() };
function carregadorEl() { return document.getElementById("carregador"); }
function inicioCarga() {
  if (carga.n++ === 0 && carregadorEl().hidden) carga.timer = setTimeout(() => { carregadorEl().hidden = false; }, 250);
}
function fimCarga() {
  carga.n = Math.max(0, carga.n - 1);
  if (carga.n) return;
  clearTimeout(carga.timer);
  const c = carregadorEl();
  if (c.classList.contains("inicial")) {
    // abertura: deixa a marca aparecer por um instante e some suave
    const resta = Math.max(0, 700 - (Date.now() - carga.inicio));
    setTimeout(() => {
      if (carga.n) return;
      c.classList.add("saindo");
      setTimeout(() => { c.hidden = true; c.classList.remove("inicial", "saindo"); }, 250);
    }, resta);
    return;
  }
  c.hidden = true;
}
async function comCarga(fn) {
  inicioCarga();
  try { return await fn(); } finally { fimCarga(); }
}

let avisoTimer;
function avisar(texto, tipo = "ok") {
  const a = document.getElementById("aviso");
  a.textContent = texto;
  a.className = `aviso-flutuante ${tipo}`;
  a.hidden = false;
  clearTimeout(avisoTimer);
  avisoTimer = setTimeout(() => { a.hidden = true; }, 4000);
}

const reais = c => (Number(c) / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const pct = bp => `${(Number(bp) / 100).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`;
const dataBR = iso => (iso ? iso.slice(0, 10).split("-").reverse().join("/") : "");
const fone = d => {
  if (!d) return "";
  return d.length === 11 ? `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}` : `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
};
// O dono entra como gerente (também atende: agenda, horário, comissão, desempenho) e tem os poderes de proprietário.
const NOME_PERFIL = { plataforma: "Plataforma", proprietario: "Gerente (dono)", gerente: "Gerente", barbeiro: "Barbeiro", caixa: "Caixa" };
const atendePerfil = p => p === "proprietario" || p === "gerente" || p === "barbeiro";
const NOME_PLANO = { basico: "Básico", standard: "Standard", pro: "Pro", profissional: "Pro" };
const OPCOES_PLANO = [["basico", "Básico (até 2 barbeiros)"], ["standard", "Standard (até 4 barbeiros)"], ["pro", "Pro (até 10 barbeiros)"]];

// Ponto digitado como vírgula decimal ("38.5" → "38,5"); "1.234" continua sendo milhar.
const pontoDecimal = t => (!t.includes(",") && (t.match(/\./g) || []).length === 1 && /\.\d{0,2}$/.test(t) ? t.replace(".", ",") : t);
// "45", "45,9", "38.5", "1.234,56", "R$ 45,00" → centavos (inteiro). null se inválido.
function paraCentavos(texto) {
  const t = pontoDecimal(String(texto || "").replace(/R\$\s?/i, "").trim()).replace(/\./g, "").replace(",", ".");
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return null;
  return Math.round(Number(t) * 100);
}
const centavosParaTexto = c => (Number(c) / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
// "40" ou "37,5" → centésimos de % (4000, 3750)
function paraBp(texto) {
  const t = pontoDecimal(String(texto || "0").trim().replace("%", "")).replace(",", ".");
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return null;
  const v = Math.round(Number(t) * 100);
  return v <= 10000 ? v : null;
}
const bpParaTexto = bp => (Number(bp) / 100).toString().replace(".", ",");

// ---------- API ----------
async function api(caminho, { metodo = "GET", corpo } = {}) {
  const token = localStorage.getItem(CHAVE_TOKEN);
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (corpo !== undefined) headers["Content-Type"] = "application/json";
  let resp;
  try {
    resp = await fetch(`/api${caminho}`, { method: metodo, headers, body: corpo !== undefined ? JSON.stringify(corpo) : undefined });
  } catch {
    throw new Error("Sem conexão com o servidor. Confira a internet.");
  }
  const dados = await resp.json().catch(() => ({}));
  if (resp.status === 401 && caminho !== "/auth/login") {
    localStorage.removeItem(CHAVE_TOKEN);
    usuario = null;
    telaLogin("Sua sessão terminou. Entre novamente.");
    throw new Error("Sessão encerrada");
  }
  if (resp.status === 402 && usuario) {
    // Mensalidade atrasada além da tolerância (mudou enquanto o app estava aberto): vai para a assinatura.
    usuario.assinatura = { ...(usuario.assinatura || {}), situacao: "bloqueada", bloqueada: true };
    setTimeout(() => { if (location.hash === "#/assinatura") rotear(); else location.hash = "#/assinatura"; }, 0);
  }
  if (!resp.ok) {
    const e = new Error(dados.erro || "Algo deu errado. Tente de novo.");
    e.status = resp.status;
    e.dados = dados;
    throw e;
  }
  return dados;
}

// ---------- componentes ----------
function campo(rotulo, attrs = {}, ajuda = null) {
  const id = attrs.id || `c-${attrs.name}`;
  const controle = attrs.tag === "textarea"
    ? el("textarea", { ...attrs, tag: null, value: null, id, text: attrs.value || "" })
    : attrs.tag === "select"
      ? el("select", { ...attrs, tag: null, opcoes: null, valor: null, id }, ...(attrs.opcoes || []).map(([v, t]) => el("option", { value: v, selected: v === attrs.valor || null, text: t })))
      : el("input", { type: "text", ...attrs, id });
  return el("div", { class: "campo" },
    el("label", { for: id, text: rotulo }),
    controle,
    ajuda ? el("p", { class: "ajuda", text: ajuda }) : null);
}

// Telefone formatado enquanto digita: (11) 91234-5678 ou (11) 3456-7890. Aceita +55 na frente.
function formatarTelefone(v) {
  let d = String(v || "").replace(/\D/g, "");
  if (d.length > 11 && d.startsWith("55")) d = d.slice(2);
  d = d.slice(0, 11);
  if (d.length <= 2) return d ? `(${d}` : "";
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}
function mascaraTelefone(input) {
  input.setAttribute("maxlength", "16");
  input.setAttribute("autocomplete", input.getAttribute("autocomplete") || "tel-national");
  if (input.value) input.value = formatarTelefone(input.value);
  input.addEventListener("input", () => {
    const antes = input.value;
    const digitosAntesDoCursor = antes.slice(0, input.selectionStart ?? antes.length).replace(/\D/g, "").length;
    input.value = formatarTelefone(antes);
    // mantém o cursor depois do mesmo número de dígitos
    let pos = 0, vistos = 0;
    while (pos < input.value.length && vistos < digitosAntesDoCursor) { if (/\d/.test(input.value[pos])) vistos++; pos++; }
    if (document.activeElement === input) input.setSelectionRange(pos, pos);
  });
}
// Número com vírgula (dinheiro e %): só dígitos, pontos de milhar e UMA vírgula com até 2 casas.
function limparDecimal(v) {
  let t = pontoDecimal(String(v).replace(/[^\d.,]/g, ""));
  const i = t.indexOf(",");
  if (i >= 0) t = t.slice(0, i + 1) + t.slice(i + 1).replace(/[.,]/g, "").slice(0, 2);
  return t;
}
function mascaraDecimal(input) {
  input.addEventListener("input", () => {
    const limpo = limparDecimal(input.value);
    if (limpo !== input.value) input.value = limpo;
  });
}
// Dinheiro: além da limpeza, ao sair do campo "40" vira "40,00" e "1234,5" vira "1.234,50".
function mascaraDinheiro(input) {
  mascaraDecimal(input);
  input.addEventListener("blur", () => {
    const c = paraCentavos(input.value);
    if (c !== null && input.value.trim()) input.value = centavosParaTexto(c);
  });
}
// Quantidade: só números inteiros (sem letra "e", sinal, ponto ou vírgula).
function mascaraInteiro(input) {
  input.addEventListener("keydown", e => { if (["e", "E", "+", "-", ".", ","].includes(e.key)) e.preventDefault(); });
  input.addEventListener("input", () => {
    const limpo = input.value.replace(/\D/g, "");
    if (input.type !== "number" && limpo !== input.value) input.value = limpo;
  });
}
// Hora digitada (09:00): substitui o relógio do celular, que em telas com letra grande fica cortado (botão "Definir" some).
function mascaraHora(input) {
  input.type = "text";
  input.setAttribute("inputmode", "numeric");
  input.setAttribute("autocomplete", "off");
  input.setAttribute("maxlength", "5");
  input.setAttribute("placeholder", "00:00");
  input.setAttribute("pattern", "([01][0-9]|2[0-3]):[0-5][0-9]");
  input.setAttribute("title", "Hora no formato 00:00 (ex.: 09:30)");
  input.classList.add("hora-digitada");
  const formatar = () => {
    const d = input.value.replace(/\D/g, "").slice(0, 4);
    input.value = d.length > 2 ? `${d.slice(0, 2)}:${d.slice(2)}` : d;
  };
  input.addEventListener("input", formatar);
  input.addEventListener("blur", () => {
    const d = input.value.replace(/\D/g, "");
    if (d.length === 1 || d.length === 2) input.value = `${d.padStart(2, "0")}:00`;   // "9" → 09:00
    else if (d.length === 3) input.value = `0${d[0]}:${d.slice(1)}`;                   // "930" → 09:30
  });
  formatar();
}
// Aplica a formatação certa em TODOS os campos numéricos de uma tela ou janela (uma vez por campo).
//   telefone: inputmode="tel" · dinheiro: inputmode="decimal" · %: inputmode="decimal" com name com* ou data-numero="percentual"
//   quantidade: inputmode="numeric" (exceto código de produto, que aceita letras)
// Campo de senha com botão de olho (mostrar/ocultar). Funciona em todas as telas e janelas.
function botaoOlho(input) {
  if (input.dataset.olho) return;
  input.dataset.olho = "1";
  const caixa = el("div", { class: "campo-senha" });
  input.replaceWith(caixa);
  const btn = el("button", { type: "button", class: "olho-senha", "aria-label": "Mostrar senha", title: "Mostrar senha", "aria-pressed": "false", "data-olho": input.id || input.name });
  const desenhar = () => {
    const visivel = input.type === "text";
    btn.replaceChildren(icone(visivel ? "olhoFechado" : "olho"));
    btn.setAttribute("aria-label", visivel ? "Ocultar senha" : "Mostrar senha");
    btn.title = visivel ? "Ocultar senha" : "Mostrar senha";
    btn.setAttribute("aria-pressed", visivel ? "true" : "false");
  };
  btn.addEventListener("click", () => { input.type = input.type === "password" ? "text" : "password"; desenhar(); input.focus(); });
  caixa.append(input, btn);
  desenhar();
}

function aplicarMascaras(raiz) {
  for (const input of raiz.querySelectorAll("input[type=password]")) botaoOlho(input);
  for (const input of raiz.querySelectorAll("input:not([data-mascara])")) {
    const modo = input.getAttribute("inputmode");
    const nome = input.name || "";
    let tipo = null;
    if (input.type === "time") { input.dataset.mascara = "hora"; mascaraHora(input); continue; }
    if (modo === "tel") tipo = "telefone";
    else if (modo === "decimal") tipo = /^com/.test(nome) || input.dataset.numero === "percentual" ? "percentual" : "dinheiro";
    else if (modo === "numeric" && nome !== "codigo") tipo = "inteiro";
    if (!tipo) continue;
    input.dataset.mascara = tipo;
    ({ telefone: mascaraTelefone, dinheiro: mascaraDinheiro, percentual: mascaraDecimal, inteiro: mascaraInteiro })[tipo](input);
  }
}

function caixaMarcar(rotulo, attrs = {}) {
  const id = attrs.id || `c-${attrs.name}`;
  return el("div", { class: "marcar" },
    el("input", { type: "checkbox", ...attrs, id }),
    el("label", { for: id, text: rotulo }));
}

function botao(texto, onclick, classe = "") {
  return el("button", { type: "button", class: `botao ${classe}`.trim(), onclick, text: texto });
}

function cabecalho(titulo, subtitulo = null, voltar = null) {
  return el("div", { class: "cabecalho" },
    voltar ? el("a", { class: "voltar", href: voltar, text: "‹ Voltar" }) : null,
    el("h2", { text: titulo }),
    subtitulo ? el("p", { class: "suave", text: subtitulo }) : null);
}

function erroForm(form, msg) {
  let p = form.querySelector(".erro");
  if (!p) {
    p = el("p", { class: "erro", role: "alert" });
    form.prepend(p);
  }
  p.textContent = msg;
  p.hidden = !msg;
  if (msg) p.scrollIntoView({ block: "nearest" });
}

// Envia o formulário com o botão travado (evita duplo toque).
async function enviar(form, acao) {
  const btn = form.querySelector("button[type=submit]");
  erroForm(form, "");
  if (btn) { btn.disabled = true; btn.classList.add("ocupado"); }
  const naJanela = Boolean(form.closest("dialog"));   // na janela, o próprio botão mostra que está carregando
  try {
    await (naJanela ? acao() : comCarga(acao));
  } catch (e) {
    if (e.message !== "Sessão encerrada") erroForm(form, e.message);
  } finally {
    if (btn) { btn.disabled = false; btn.classList.remove("ocupado"); }
  }
}

// Janela (dialog) com conteúdo e botões. Devolve o valor de "ok" ou null se cancelar.
function abrirJanela(titulo, conteudo, { ok = "Confirmar", perigo = false, aoConfirmar, semCancelar = false } = {}) {
  return new Promise(resolve => {
    const form = el("form", { class: "janela-form", method: "dialog" },
      el("h3", { text: titulo }),
      ...[conteudo].flat().filter(Boolean),
      el("div", { class: `janela-botoes ${semCancelar ? "um" : ""}` },
        semCancelar ? null : el("button", { type: "button", class: "botao", value: "cancelar", text: "Cancelar", onclick: () => { janela.close(); resolve(null); } }),
        aoConfirmar ? el("button", { type: "submit", class: `botao ${perigo ? "perigo-cheio" : "principal"}`, text: ok }) : null));
    form.addEventListener("submit", ev => {
      ev.preventDefault();
      enviar(form, async () => {
        const r = await aoConfirmar(form);
        janela.close();
        resolve(r ?? true);
      });
    });
    janela.replaceChildren(form);
    aplicarMascaras(form);
    janela.addEventListener("close", () => resolve(null), { once: true });   // Esc também fecha
    janela.showModal();
    const primeiro = form.querySelector("input, textarea, select");
    if (primeiro) primeiro.focus();
  });
}

function pedirMotivo(titulo, explicacao, executar, ok = "Confirmar") {
  return abrirJanela(titulo, [
    el("p", { text: explicacao }),
    campo("Motivo", { name: "motivo", required: true, minlength: "3", maxlength: "300", autocomplete: "off" })
  ], { ok, perigo: true, aoConfirmar: form => executar(form.motivo.value.trim()) });
}

// Mostra usuário e senha provisória para entregar à pessoa.
// Mensagem pronta com link, usuário e senha provisória (para mandar pelo WhatsApp da loja ou da pessoa).
function mensagemAcesso(login, senha, { nome = "", barbearia = "" } = {}) {
  const primeiro = (nome || "").trim().split(" ")[0];
  return [
    `Olá${primeiro ? `, ${primeiro}` : ""}! Seu acesso ao 4blade${barbearia ? ` da ${barbearia}` : ""}:`,
    "",
    `Link: ${location.origin}/#/entrar`,
    `Usuário: ${login}`,
    `Senha provisória: ${senha}`,
    "",
    "No 1º acesso o sistema pede para você criar uma senha só sua. Dá para instalar no celular: abra o link e toque em \"Adicionar à tela inicial\"."
  ].join("\n");
}

function mostrarSenha(login, senha, quem, { nome = "", telefone = null, barbearia = usuario?.barbearia?.nome || "" } = {}) {
  const texto = mensagemAcesso(login, senha, { nome, barbearia });
  const tel = (telefone || "").replace(/\D/g, "");
  const copiar = el("button", { type: "button", class: "botao largo", "data-teste": "copiar-acesso", text: "Copiar mensagem",
    onclick: async () => {
      try { await navigator.clipboard.writeText(texto); copiar.textContent = "Copiado ✓"; }
      catch { copiar.textContent = "Não deu para copiar: use o WhatsApp"; }
    } });
  return abrirJanela("Acesso criado", [
    el("p", { text: `Entregue estes dados para ${quem}. No 1º acesso o sistema pede para trocar a senha.` }),
    el("dl", { class: "credencial" },
      el("dt", { text: "Link" }), el("dd", { class: "credencial-valor", "data-teste": "link", text: `${location.host}/#/entrar` }),
      el("dt", { text: "Usuário" }), el("dd", { class: "credencial-valor", "data-teste": "login", text: login }),
      el("dt", { text: "Senha provisória" }), el("dd", { class: "credencial-valor", "data-teste": "senha", text: senha })),
    el("div", { class: "enviar-acesso" },
      tel.length >= 10 ? el("a", { class: "botao principal whats largo", href: `https://wa.me/55${tel}?text=${encodeURIComponent(texto)}`, target: "_blank", rel: "noopener", "data-teste": "whats-acesso", text: `Enviar no WhatsApp de ${fone(tel)}` }) : null,
      el("a", { class: `botao ${tel.length >= 10 ? "" : "principal whats"} largo`, href: `https://wa.me/?text=${encodeURIComponent(texto)}`, target: "_blank", rel: "noopener", "data-teste": "whats-escolher", text: tel.length >= 10 ? "Enviar para outro contato" : "Enviar pelo WhatsApp (escolher contato)" }),
      copiar),
    el("p", { class: "suave", text: "Esta senha não aparece de novo. Envie agora ou anote." })
  ], { ok: "Pronto", semCancelar: true, aoConfirmar: () => true });
}

// ---------- LOGIN e TROCA DE SENHA ----------
function telaLogin(mensagem = "") {
  atualizarTopo();
  const form = el("form", { class: "cartao", autocomplete: "on" },
    el("h2", { text: "Entrar" }),
    mensagem ? el("p", { class: "info", text: mensagem }) : null,
    campo("Usuário", { name: "login", autocomplete: "username", autocapitalize: "none", spellcheck: "false", required: true }),
    campo("Senha", { name: "senha", type: "password", autocomplete: "current-password", required: true }),
    el("button", { type: "submit", class: "botao principal", text: "Entrar" }),
    el("p", { class: "suave centro", text: "Esqueceu a senha? Peça ao gerente ou ao proprietário da barbearia." }),
    el("p", { class: "centro chamada-planos" }, "Ainda não usa o 4blade? ", el("a", { href: "#/planos", "data-teste": "link-planos", text: "Conheça os planos" })));
  form.addEventListener("submit", ev => {
    ev.preventDefault();
    enviar(form, async () => {
      const r = await api("/auth/login", { metodo: "POST", corpo: { login: form.login.value.trim().toLowerCase(), senha: form.senha.value } });
      localStorage.setItem(CHAVE_TOKEN, r.token);
      usuario = r.usuario;
      if (usuario.trocaObrigatoria) telaTrocarSenha(form.senha.value);
      else irParaInicial();
    });
  });
  form.classList.add("entrada-form");
  mostrar(el("section", { class: "entrada" },
    el("div", { class: "entrada-hero" },
      el("img", { class: "logo-entrada", src: "/icons/logo.png", alt: "4blade", width: "320", height: "130" }),
      el("p", { class: "slogan", "data-teste": "slogan" }, "Gestão ", el("span", { text: "afiada" }), " para sua barbearia."),
      el("p", { class: "entrada-sub", text: "Agenda, caixa, estoque e comissões num só lugar." })),
    el("div", { class: "entrada-lado" }, form)));
  document.body.classList.add("tela-entrada");
}

function telaTrocarSenha(senhaAtual = "") {
  atualizarTopo();
  const form = el("form", { class: "cartao" },
    el("h2", { text: "Crie sua senha" }),
    el("p", { text: `Olá, ${usuario.nome}! Para sua segurança, troque a senha provisória por uma só sua.` }),
    campo("Senha atual (provisória)", { name: "atual", type: "password", autocomplete: "current-password", required: true, value: senhaAtual || null }),
    campo("Nova senha", { name: "nova", type: "password", autocomplete: "new-password", required: true, minlength: "8" }, "Mínimo de 8 caracteres, diferente do seu usuário."),
    campo("Repita a nova senha", { name: "nova2", type: "password", autocomplete: "new-password", required: true, minlength: "8" }),
    el("button", { type: "submit", class: "botao principal", text: "Salvar nova senha" }));
  form.addEventListener("submit", ev => {
    ev.preventDefault();
    enviar(form, async () => {
      if (form.nova.value !== form.nova2.value) throw new Error("As duas senhas novas não são iguais.");
      await api("/auth/trocar-senha", { metodo: "POST", corpo: { senhaAtual: form.atual.value, novaSenha: form.nova.value } });
      // A troca encerra a sessão: entra de novo com a senha nova.
      const r = await api("/auth/login", { metodo: "POST", corpo: { login: usuario.login, senha: form.nova.value } });
      localStorage.setItem(CHAVE_TOKEN, r.token);
      usuario = r.usuario;
      avisar("Senha alterada com sucesso.");
      irParaInicial();
    });
  });
  mostrar(el("section", { class: "estreito" }, form));
}

// ---------- PLANOS, ASSINAR e TEXTOS LEGAIS (sem login) ----------
let infoPlanos = null;
let cicloPlanos = "mensal";
async function carregarPlanos() {
  if (!infoPlanos) infoPlanos = await api("/planos");
  return infoPlanos;
}
const RECURSOS_BASE = [
  "Agenda com horários livres e lembrete por WhatsApp",
  "Caixa: Pix, cartão, dinheiro, troco e notas (fiado)",
  "Estoque e venda de produtos com desconto",
  "Comissões, vales e contas a pagar",
  "Relatório pronto para o contador",
  "Gerentes e caixas sem limite"
];
const dataCurta = d => dataBR(d);
const precoPlano = (p, ciclo) => (ciclo === "anual" ? p.anualCentavos : p.mensalCentavos);
const reaisInteiro = c => reais(c).replace(/,00$/, "");

function cartaoPlano(p, info, ciclo) {
  const extras = {
    basico: [],
    standard: [`Site da barbearia para o cliente ver os horários livres (só consulta)${info.siteDisponivel ? "" : " — em breve"}`],
    pro: [`Site completo, integrado à agenda: o cliente escolhe o horário, vê a lista de produtos e já inicia a compra pelo site${info.siteDisponivel ? "" : " — em breve"}`]
  }[p.id] || [];
  const valor = precoPlano(p, ciclo);
  return el("article", { class: `plano ${p.id === "pro" ? "destaque" : ""}`, "data-plano": p.id },
    p.id === "pro" ? el("span", { class: "plano-selo", text: "Mais completo" }) : null,
    el("h3", { text: p.nome }),
    el("p", { class: "plano-barbeiros", text: `Até ${p.barbeiros} barbeiros` }),
    info.cobrancaAtiva ? el("p", { class: "plano-preco" }, el("strong", { text: reaisInteiro(valor) }), el("span", { text: ciclo === "anual" ? "/ano" : "/mês" })) : null,
    info.cobrancaAtiva ? el("p", { class: "suave plano-nota", text: ciclo === "anual"
      ? `Equivale a ${reais(Math.round(valor / 12))} por mês · ${12 - info.mesesDoAnual} meses grátis`
      : `ou ${reaisInteiro(p.anualCentavos)} no plano anual` }) : null,
    el("ul", { class: "plano-recursos" },
      p.id === "basico" ? null : el("li", { class: "forte", text: p.id === "pro" ? "Tudo do Standard, para equipes grandes" : "Tudo do Básico, para equipes maiores" }),
      ...(p.id === "basico" ? RECURSOS_BASE : []).map(t => el("li", { text: t })),
      ...extras.map(t => el("li", { class: "extra", text: t }))),
    info.cobrancaAtiva
      ? el("a", { class: "botao principal largo", href: `#/assinar/${p.id}`, "data-assinar": p.id, text: `Começar ${info.testeDias} dias grátis` })
      : el("a", { class: "botao principal largo", href: `#/teste-gratis/${p.id}`, "data-teste-gratis": p.id, text: "Solicitar teste grátis" }));
}

async function telaPlanos() {
  const info = await carregarPlanos();
  const { alterna, area } = blocoPlanos(info);
  mostrar(el("section", { class: "publica" },
    el("div", { class: "publica-topo" },
      el("h2", { text: "Escolha o plano da sua barbearia" }),
      el("p", { class: "suave", text: info.cobrancaAtiva ? `Teste grátis por ${info.testeDias} dias, sem cartão. Cancele quando quiser.` : "Escolha pelo número de barbeiros e solicite um teste grátis: a gente cadastra sua barbearia e acompanha os primeiros dias." }),
      alterna),
    area,
    info.cobrancaAtiva ? el("div", { class: "cartao perguntas" },
      el("h3", { text: "Como funciona" }),
      el("ol", {},
        el("li", { text: "Escolha o plano e preencha os dados da barbearia e o seu usuário e senha." }),
        el("li", { text: `Pronto: você já entra no sistema. São ${info.testeDias} dias grátis.` }),
        el("li", { text: "A 1ª mensalidade vence no fim do teste. Você paga por Pix, boleto ou cartão, pelo Asaas." }),
        el("li", { text: "Cadastre sua equipe, serviços e horários de funcionamento e comece a usar." }))) : null,
    el("p", { class: "centro" }, "Já usa o 4blade? ", el("a", { href: "#/entrar", text: "Entrar" }), " · ",
      el("a", { href: "#/duvidas", text: "Dúvidas frequentes" }), " · ",
      el("a", { href: "#/termos", text: "Termos de uso" }), " · ", el("a", { href: "#/privacidade", text: "Privacidade" }))));
}

function mascaraDocumento(input) {
  input.addEventListener("input", () => {
    const d = input.value.replace(/\D/g, "").slice(0, 14);
    input.value = d.length <= 11
      ? d.replace(/(\d{3})(\d)/, "$1.$2").replace(/(\d{3})(\d)/, "$1.$2").replace(/(\d{3})(\d{1,2})$/, "$1-$2")
      : d.replace(/^(\d{2})(\d)/, "$1.$2").replace(/^(\d{2})\.(\d{3})(\d)/, "$1.$2.$3").replace(/\.(\d{3})(\d)/, ".$1/$2").replace(/(\d{4})(\d)/, "$1-$2");
  });
}

function janelaLegal(tipo) {
  return abrirJanela(tipo === "termos" ? "Termos de uso" : "Política de privacidade", textoLegal(tipo), { ok: "Fechar", semCancelar: true, aoConfirmar: () => true });
}
function textoLegal(tipo) {
  const t = window.TEXTOS_LEGAIS;
  if (!t) return el("p", { text: "Texto indisponível. Atualize a página." });
  return el("div", { class: "texto-legal" },
    el("p", { class: "suave", text: `Versão de ${t.versao}` }),
    ...t[tipo].map(([k, x]) => el(k === "h" ? "h4" : k === "l" ? "p" : "p", { class: k === "l" ? "item-legal" : null, text: k === "l" ? `• ${x}` : x })));
}
async function telaLegal(tipo) {
  mostrar(el("section", { class: "publica estreita" },
    el("a", { class: "voltar", href: usuario ? `#/${usuario.telaInicial}` : "#/planos", text: "‹ Voltar" }),
    el("h2", { text: tipo === "termos" ? "Termos de uso" : "Política de privacidade" }),
    el("div", { class: "cartao" }, textoLegal(tipo))));
}

// Sugere um usuário a partir do nome da barbearia: "Barbearia do Zé" → "dono.barbeariadoze"
const sugerirLogin = nome => `dono.${nome.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 24)}`;

async function telaAssinar(planoInicial) {
  const info = await carregarPlanos();
  if (!info.cobrancaAtiva) { location.hash = "#/planos"; return; }   // cadastro on-line fechado
  const planos = Object.fromEntries(info.planos.map(p => [p.id, p]));
  const plano = planos[planoInicial] ? planoInicial : "standard";
  const resumo = el("div", { class: "resumo-assinatura", "data-teste": "resumo-assinatura", "aria-live": "polite" });
  const form = el("form", { class: "cartao form-assinar", autocomplete: "on" },
    el("h3", { text: "1. Plano" }),
    campo("Plano", { tag: "select", name: "plano", valor: plano, opcoes: info.planos.map(p => [p.id, `${p.nome} — até ${p.barbeiros} barbeiros`]) }),
    campo("Pagamento", { tag: "select", name: "ciclo", valor: cicloPlanos, opcoes: [["mensal", "Mensal"], ["anual", `Anual (paga ${info.mesesDoAnual} meses)`]] }),
    el("h3", { text: "2. Sua barbearia e seus dados" }),
    campo("Nome da barbearia", { name: "barbearia", required: true, maxlength: "80", autocomplete: "organization" }),
    campo("Seu nome completo", { name: "nome", required: true, maxlength: "100", autocomplete: "name" }),
    el("div", { class: "lado-a-lado" },
      campo("CPF ou CNPJ", { name: "documento", required: true, inputmode: "numeric", "data-mascara": "documento", maxlength: "18", autocomplete: "off" }, "Usado só para a cobrança da mensalidade."),
      campo("WhatsApp", { name: "telefone", required: true, inputmode: "tel", autocomplete: "tel" })),
    campo("E-mail", { name: "email", type: "email", required: true, maxlength: "120", autocomplete: "email" }, "Para receber as cobranças e avisos."),
    el("h3", { text: "3. Seu acesso ao sistema" }),
    campo("Usuário", { name: "login", required: true, autocapitalize: "none", spellcheck: "false", maxlength: "30", autocomplete: "username" }, "Minúsculas, sem espaço. Ex.: joao.barbeariadojoao"),
    el("div", { class: "lado-a-lado" },
      campo("Senha", { name: "senha", type: "password", required: true, minlength: "8", autocomplete: "new-password" }, "Mínimo de 8 caracteres."),
      campo("Repita a senha", { name: "senha2", type: "password", required: true, minlength: "8", autocomplete: "new-password" })),
    el("div", { class: "marcar aceite" },
      el("input", { type: "checkbox", name: "aceite", id: "c-aceite", required: true }),
      el("label", { for: "c-aceite" }, "Li e aceito os ",
        el("button", { type: "button", class: "link", "data-legal": "termos", text: "termos de uso", onclick: () => janelaLegal("termos") }),
        " e a ",
        el("button", { type: "button", class: "link", "data-legal": "privacidade", text: "política de privacidade", onclick: () => janelaLegal("privacidade") }), ".")),
    resumo,
    info.assinaturaDisponivel ? null : el("p", { class: "info", "data-teste": "assinatura-indisponivel", text: "A assinatura on-line ainda não está ligada. Fale com o suporte do 4blade para assinar." }),
    el("button", { type: "submit", class: "botao principal largo", disabled: info.assinaturaDisponivel ? null : true, text: `Começar ${info.testeDias} dias grátis` }));

  const atualizar = () => {
    const p = planos[form.plano.value];
    const ciclo = form.ciclo.value;
    const valor = precoPlano(p, ciclo);
    const hoje = hojeLocal();
    resumo.replaceChildren(
      el("strong", { text: `Plano ${p.nome} ${ciclo === "anual" ? "anual" : "mensal"}: ${reais(valor)} ${ciclo === "anual" ? "por ano" : "por mês"}` }),
      el("span", { text: `Grátis até ${dataCurta(somaDias(hoje, info.testeDias - 1))}. 1ª cobrança em ${dataCurta(somaDias(hoje, info.testeDias))}. Cancele quando quiser.` }));
  };
  form.plano.addEventListener("change", atualizar);
  form.ciclo.addEventListener("change", () => { cicloPlanos = form.ciclo.value; atualizar(); });
  form.barbearia.addEventListener("change", () => { if (!form.login.value && form.barbearia.value.trim()) form.login.value = sugerirLogin(form.barbearia.value); });
  mascaraDocumento(form.documento);
  atualizar();

  form.addEventListener("submit", ev => {
    ev.preventDefault();
    enviar(form, async () => {
      if (form.senha.value !== form.senha2.value) throw new Error("As duas senhas não são iguais.");
      const login = form.login.value.trim().toLowerCase();
      const r = await api("/assinar", {
        metodo: "POST",
        corpo: {
          plano: form.plano.value, ciclo: form.ciclo.value, barbearia: form.barbearia.value, nome: form.nome.value, documento: form.documento.value,
          telefone: form.telefone.value, email: form.email.value, login, senha: form.senha.value, aceiteTermos: form.aceite.checked
        }
      });
      const l = await api("/auth/login", { metodo: "POST", corpo: { login, senha: form.senha.value } });
      localStorage.setItem(CHAVE_TOKEN, l.token);
      usuario = l.usuario;
      telaBoasVindas(r);
    });
  });

  mostrar(el("section", { class: "publica estreita" },
    el("a", { class: "voltar", href: "#/planos", text: "‹ Ver os planos" }),
    el("h2", { text: "Assinar o 4blade" }),
    el("p", { class: "suave", text: `Leva 2 minutos. ${info.testeDias} dias grátis, sem cartão.` }),
    form));
}

function telaBoasVindas(r) {
  history.replaceState(null, "", "#/bem-vindo");
  atualizarTopo();
  mostrar(el("section", { class: "estreito" },
    el("div", { class: "cartao boas-vindas", "data-teste": "boas-vindas" },
      el("h2", { text: `Tudo pronto, ${usuario.nome.split(" ")[0]}!` }),
      el("p", { text: `A ${r.barbearia.nome} já está no 4blade. Seu teste grátis vai até ${dataCurta(r.testeAte)}.` }),
      el("p", { class: "suave", text: `A 1ª mensalidade (${reais(r.valorCentavos)}) vence em ${dataCurta(r.primeiroVencimento)}. Você acompanha e paga em Equipe e ajustes → Minha assinatura.` }),
      el("h4", { text: "Primeiros passos" }),
      el("ol", {},
        el("li", { text: "Funcionamento: dias e horários em que a barbearia abre." }),
        el("li", { text: "Serviços: cortes, barba e preços." }),
        el("li", { text: "Equipe: cadastre os barbeiros, o gerente e o caixa." })),
      el("div", { class: "item-acoes" },
        el("a", { class: "botao principal", href: "#/funcionamento", text: "Começar pelo funcionamento" }),
        r.linkPagamento ? el("a", { class: "botao", href: r.linkPagamento, target: "_blank", rel: "noopener", text: "Já deixar o pagamento pronto" }) : null))));
}

// ---------- MINHA ASSINATURA (proprietário e gerente) ----------
const NOME_SIT_ASSINATURA = {
  teste: ["Teste grátis", "amarela"], em_dia: ["Em dia", "verde"], atrasada: ["Mensalidade em atraso", "vermelha"],
  bloqueada: ["Acesso suspenso", "vermelha"], cancelada_ate_fim: ["Cancelada", "amarela"], cancelada: ["Cancelada", "vermelha"],
  manual: ["Combinada com o suporte", ""]
};
function textoSituacao(a) {
  switch (a.situacao) {
    case "teste": return `Faltam ${a.diasRestantes} dia(s) de teste grátis (até ${dataCurta(a.pagoAte)}).`;
    case "em_dia": return `Paga até ${dataCurta(a.pagoAte)}.`;
    case "atrasada": return `A mensalidade venceu há ${a.diasAtraso} dia(s). Se não for paga, o acesso da equipe é suspenso em ${a.diasParaBloqueio} dia(s).`;
    case "bloqueada": return "O acesso da equipe está suspenso. Pague a mensalidade para liberar na hora.";
    case "cancelada_ate_fim": return `Assinatura cancelada. O sistema funciona até ${dataCurta(a.pagoAte)}.`;
    case "cancelada": return "Assinatura cancelada. Para voltar, fale com o suporte do 4blade.";
    default: return "A cobrança desta barbearia é combinada direto com o suporte do 4blade.";
  }
}

const TEXTO_SITE_PLANO = {
  visual: "Site da barbearia para o cliente ver os horários livres (só consulta)",
  completo: "Site completo, integrado à agenda: o cliente escolhe o horário, vê a lista de produtos e já inicia a compra pelo site"
};
// Cobrança desligada: só o plano e as vagas, sem valores nem pagamento.
function telaMeuPlano(p) {
  const cheio = p.barbeirosAtivos >= p.barbeirosLimite;
  mostrar(
    cabecalho("Meu plano", "O que o plano da sua barbearia inclui"),
    el("div", { class: "duas-colunas" },
      el("section", { class: "cartao", "data-teste": "meu-plano" },
        el("div", { class: "item-topo" },
          el("h3", { text: `Plano ${p.nome}` }),
          el("span", { class: "etiqueta verde", text: "Ativo" })),
        el("div", { class: "vagas" },
          el("div", { class: `vaga ${cheio ? "cheia" : ""}`, "data-vaga": "barbeiro" },
            el("strong", { text: `${p.barbeirosAtivos}/${p.barbeirosLimite}` }), el("span", { text: "Barbeiros ativos" })),
          el("div", { class: "vaga" }, el("strong", { text: "∞" }), el("span", { text: "Gerentes e caixas · sem limite" }))),
        el("ul", { class: "plano-recursos" },
          ...RECURSOS_BASE.map(t => el("li", { text: t })),
          p.site ? el("li", { class: "extra", text: `${TEXTO_SITE_PLANO[p.site]}${p.siteDisponivel ? "" : " — em breve"}` }) : null),
        cheio ? el("p", { class: "info", text: "Todas as vagas de barbeiro estão ocupadas. Desative alguém em Equipe ou fale com o suporte para mudar de plano." }) : null),
      el("section", { class: "cartao" },
        el("h3", { text: "Quer mudar de plano?" }),
        el("p", { text: "Fale com a gente pelo suporte. A troca é feita pelo 4blade e vale na hora." }),
        el("a", { class: "botao principal", href: "#/suporte", text: "Falar com o suporte" }))));
}

async function telaAssinatura() {
  const resp = await api("/assinatura");
  if (resp.cobrancaAtiva === false) return telaMeuPlano(resp.plano);
  const { assinatura: a, pagamentos, podeCancelar } = resp;
  const [rotulo, cor] = NOME_SIT_ASSINATURA[a.situacao] || ["—", ""];
  const pagar = a.linkPagamento && !a.cancelada
    ? el("a", { class: "botao principal largo", href: a.linkPagamento, target: "_blank", rel: "noopener", "data-teste": "pagar",
      text: a.situacao === "teste" ? "Deixar a 1ª mensalidade paga" : "Pagar mensalidade (Pix, boleto ou cartão)" })
    : null;
  mostrar(
    cabecalho("Minha assinatura", "Plano e mensalidade do 4blade"),
    el("div", { class: "duas-colunas" },
      el("section", { class: "cartao", "data-teste": "assinatura" },
        el("div", { class: "item-topo" },
          el("h3", { text: `Plano ${a.nomePlano || NOME_PLANO[a.plano] || a.plano}` }),
          el("span", { class: `etiqueta ${cor}`, "data-situacao": a.situacao, text: rotulo })),
        el("p", { text: textoSituacao(a) }),
        a.origem === "asaas" ? el("p", { class: "suave", text: `${reais(a.valorCentavos)} ${a.ciclo === "anual" ? "por ano" : "por mês"}${a.proximoVencimento && !a.cancelada ? ` · próximo vencimento ${dataCurta(a.proximoVencimento)}` : ""}` }) : null,
        pagar,
        a.origem === "asaas" && !a.linkPagamento && !a.cancelada ? el("p", { class: "suave", text: "O link de pagamento aparece aqui quando a cobrança for gerada (alguns dias antes do vencimento)." }) : null,
        el("p", { class: "suave", text: "Para mudar de plano, fale com o suporte do 4blade." }),
        podeCancelar ? botao("Cancelar assinatura", () => pedirMotivo("Cancelar assinatura",
          `O sistema continua funcionando até ${dataCurta(a.pagoAte)}. Depois disso, ninguém da equipe entra. Nada é apagado. Antes, se quiser, exporte seus dados em Contador e dados.`,
          async motivo => {
            const r = await api("/assinatura/cancelar", { metodo: "POST", corpo: { motivo } });
            avisar(r.mensagem);
            usuario = (await api("/auth/me")).usuario;
            atualizarTopo();
            telaAssinatura();
          }, "Cancelar assinatura"), "perigo pequeno") : null),
      el("section", {},
        el("h3", { text: "Pagamentos recebidos" }),
        pagamentos.length
          ? el("ul", { class: "lista" }, pagamentos.map(p => el("li", { class: "item" },
            el("div", { class: "item-topo" }, el("strong", { text: reais(p.valorCentavos) }), el("span", { class: "etiqueta verde", text: "Pago" })),
            el("p", { class: "suave", text: `Vencimento ${dataCurta(p.vencimento)} · recebido em ${dataBR(p.recebidoEm)}` }))))
          : el("p", { class: "vazio", text: "Nenhum pagamento ainda." }))));
}

// Faixa no alto da tela (só proprietário e gerente) quando o teste está acabando, há atraso ou a assinatura foi cancelada.
function atualizarFaixa() {
  const f = document.getElementById("faixa-assinatura");
  const a = usuario && !usuario.trocaObrigatoria ? usuario.assinatura : null;
  const mostrarFaixa = a && (a.situacao === "atrasada" || a.situacao === "bloqueada" || a.situacao === "cancelada_ate_fim"
    || (a.situacao === "teste" && a.diasRestantes <= 5));
  f.hidden = !mostrarFaixa;
  if (!mostrarFaixa) return f.replaceChildren();
  f.className = `faixa-assinatura ${a.situacao === "teste" || a.situacao === "cancelada_ate_fim" ? "amarela" : "vermelha"}`;
  f.replaceChildren(...[el("span", { text: textoSituacao(a) }),
    rotaAtual() === "assinatura" ? null : el("a", { href: "#/assinatura", text: a.situacao === "teste" || a.situacao.startsWith("cancelada") ? "Ver assinatura" : "Pagar agora" })].filter(Boolean));
}

// ---------- AJUDA: dúvidas frequentes, tutoriais e suporte ----------
// Cobrança on-line ligada? (vem do servidor: no usuário logado ou na página de planos). Desligada = nada de preço/pagamento.
const cobrancaOn = () => Boolean(usuario ? usuario.cobrancaAtiva : infoPlanos?.cobrancaAtiva);
const visivelCobranca = x => (x.pagamento ? cobrancaOn() : x.semCobranca ? !cobrancaOn() : true);
const AJUDA = () => {
  const a = window.AJUDA || { duvidas: [], tutoriais: [] };
  return { duvidas: a.duvidas.filter(visivelCobranca), tutoriais: a.tutoriais.filter(visivelCobranca) };
};
const tutoriaisDoPerfil = () => AJUDA().tutoriais.filter(t => !usuario || usuario.perfil === "plataforma" || t.perfis.includes(usuario.perfil));
const semAcento = t => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

async function telaDuvidas() {
  if (!usuario) await carregarPlanos().catch(() => null);
  const lista = el("div", { class: "duvidas" });
  const busca = el("input", { type: "search", class: "busca-ajuda", placeholder: "Buscar dúvida (ex.: senha, caixa, comissão)", "aria-label": "Buscar dúvida" });
  const desenhar = () => {
    const q = semAcento(busca.value.trim());
    const itens = AJUDA().duvidas.filter(d => !q || semAcento(`${d.p} ${d.r} ${d.cat}`).includes(q));
    const cats = [...new Set(itens.map(d => d.cat))];
    lista.replaceChildren(...(cats.length ? cats.map(c => el("section", { class: "duvidas-grupo" },
      el("h3", { text: c }),
      ...itens.filter(d => d.cat === c).map(d => el("details", { class: "duvida", "data-duvida": d.p },
        el("summary", { text: d.p }), el("p", { text: d.r })))))
      : [el("p", { class: "vazio", text: "Nenhuma dúvida com essas palavras. Veja os tutoriais ou fale com o suporte." })]));
  };
  busca.addEventListener("input", desenhar);
  desenhar();
  const rodape = usuario
    ? el("p", { class: "suave centro" }, "Não achou? ", el("a", { href: "#/tutoriais", text: "Veja os tutoriais" }),
      gestao() ? el("span", {}, " ou ", el("a", { href: "#/suporte", text: "fale com o suporte" })) : el("span", { text: " ou fale com o gerente da barbearia." }))
    : el("p", { class: "suave centro" }, el("a", { href: "#/planos", text: "‹ Ver os planos" }), " · ", el("a", { href: "#/entrar", text: "Entrar" }));
  mostrar(el("section", { class: usuario ? "" : "publica estreita" },
    cabecalho("Dúvidas frequentes", "Respostas rápidas sobre o uso do 4blade"),
    busca, lista, rodape));
}

function cartaoTutorial(t) {
  return el("a", { class: "tutorial-cartao", href: `#/tutoriais/${t.id}`, "data-tutorial": t.id },
    el("img", { src: `/tutoriais/${t.id}.jpg`, alt: "", width: "390", height: "300", loading: "lazy", onerror: e => { e.target.hidden = true; } }),
    el("strong", { text: t.titulo }),
    el("span", { class: "suave", text: t.onde }));
}

function conteudoTutorial(t, { comVoltar = true } = {}) {
  return el("article", { class: "tutorial", "data-tutorial-aberto": t.id },
    comVoltar ? el("a", { class: "voltar", href: "#/tutoriais", text: "‹ Todos os tutoriais" }) : null,
    el("h2", { text: t.titulo }),
    el("p", { class: "tutorial-onde" }, el("strong", { text: "Onde acessar: " }), t.onde),
    el("div", { class: "tutorial-corpo" },
      el("figure", { class: "tutorial-print" },
        el("img", { src: `/tutoriais/${t.id}.jpg`, alt: `Tela: ${t.titulo}`, width: "390", height: "600", loading: "lazy", onerror: e => { e.target.closest("figure").hidden = true; } }),
        el("figcaption", { class: "suave", text: "Exemplo com dados fictícios." })),
      el("div", {},
        el("h3", { text: "Como fazer" }),
        el("ol", { class: "tutorial-passos" }, t.passos.map(p => el("li", { text: p }))),
        t.exemplo ? el("div", { class: "tutorial-exemplo" }, el("strong", { text: "Exemplo" }), el("p", { text: t.exemplo })) : null,
        t.dica ? el("div", { class: "tutorial-dica" }, el("strong", { text: "Dica" }), el("p", { text: t.dica })) : null)));
}

async function telaTutoriais(id) {
  const lista = tutoriaisDoPerfil();
  const t = lista.find(x => x.id === id);
  if (t) return mostrar(conteudoTutorial(t));
  mostrar(cabecalho("Tutoriais", "Passo a passo de cada tela, com exemplos"),
    el("div", { class: "tutoriais-grade" }, lista.map(cartaoTutorial)));
}

// Botão "?" no topo: tutoriais da tela aberta.
function ajudaDaTela() {
  const rota = rotaAtual();
  const daTela = tutoriaisDoPerfil().filter(t => t.rotas.includes(rota));
  return abrirJanela(daTela.length ? "Ajuda desta tela" : "Ajuda", [
    ...(daTela.length ? daTela.map(t => conteudoTutorial(t, { comVoltar: false })) : [el("p", { text: "Esta tela não tem tutorial próprio. Veja todos os tutoriais ou as dúvidas frequentes." })]),
    el("div", { class: "item-acoes" },
      el("a", { class: "botao pequeno", href: "#/tutoriais", onclick: () => janela.close(), text: "Todos os tutoriais" }),
      el("a", { class: "botao pequeno", href: "#/duvidas", onclick: () => janela.close(), text: "Dúvidas frequentes" }),
      gestao() ? el("a", { class: "botao pequeno", href: "#/suporte", onclick: () => janela.close(), text: "Falar com o suporte" }) : null)
  ], { ok: "Fechar", semCancelar: true, aoConfirmar: () => true });
}

const NOME_SIT_CHAMADO = { aguardando_suporte: ["Aguardando o suporte", "amarela"], respondido: ["Respondido", "verde"], encerrado: ["Encerrado", ""] };
const horaCurta = utc => `${dataBR(utc.slice(0, 10)).slice(0, 5)} ${horaLocal(utc)}`;

function conversaChamado(mensagens) {
  return el("div", { class: "conversa" }, mensagens.map(m => el("div", { class: `balao ${m.lado}` },
    el("span", { class: "balao-autor", text: `${m.autor} · ${horaCurta(m.criadoEm)}` }),
    el("p", { text: m.texto }))));
}

function itemChamado(c, href, comBarbearia = false) {
  const [rot, cor] = NOME_SIT_CHAMADO[c.situacao];
  return el("li", { class: "item" }, el("a", { class: "item-link", href, "data-chamado": c.numero },
    el("div", { class: "item-topo" },
      el("strong", { text: `#${c.numero} · ${c.assunto}` }),
      el("span", { class: `etiqueta ${cor}`, text: rot })),
    el("p", { class: "suave", text: [comBarbearia ? c.barbearia : null, c.abertoPor, horaCurta(c.atualizadoEm)].filter(Boolean).join(" · ") }),
    c.ultima ? el("p", { class: "suave", text: `${c.ultima.lado === "suporte" ? "Suporte: " : ""}${c.ultima.texto}` }) : null));
}

async function telaSuporte(id) {
  if (id) {
    const { chamado: c, mensagens } = await api(`/suporte/chamado?id=${encodeURIComponent(id)}`);
    const [rot, cor] = NOME_SIT_CHAMADO[c.situacao];
    const form = el("form", { class: "cartao" },
      campo(c.situacao === "encerrado" ? "Escrever de novo (reabre o chamado)" : "Responder", { tag: "textarea", name: "msg", required: true, rows: "3", maxlength: "3000" }),
      el("div", { class: "item-acoes" },
        el("button", { type: "submit", class: "botao principal", text: "Enviar" }),
        c.situacao !== "encerrado" ? botao("Encerrar chamado", async () => {
          await api("/suporte/encerrar", { metodo: "POST", corpo: { id: c.id } });
          avisar("Chamado encerrado.");
          telaSuporte(c.id);
        }) : null));
    form.addEventListener("submit", ev => {
      ev.preventDefault();
      enviar(form, async () => {
        await api("/suporte/responder", { metodo: "POST", corpo: { id: c.id, mensagem: form.msg.value } });
        avisar("Mensagem enviada ao suporte.");
        telaSuporte(c.id);
      });
    });
    return mostrar(
      el("a", { class: "voltar", href: "#/suporte", text: "‹ Meus chamados" }),
      el("div", { class: "item-topo" }, el("h2", { text: `Chamado #${c.numero}` }), el("span", { class: `etiqueta ${cor}`, "data-situacao-chamado": c.situacao, text: rot })),
      el("p", { class: "suave", text: `${CATEGORIAS_CHAMADO[c.categoria]} · ${c.assunto}` }),
      conversaChamado(mensagens), form);
  }

  const { contato, categorias, chamados } = await api("/suporte");
  const b = usuario.barbearia;
  const textoWhats = `Olá, suporte 4blade! Sou ${usuario.nome} (${NOME_PERFIL[usuario.perfil]}) da ${b.nome}. Preciso de ajuda com: `;
  const contatoEl = el("section", { class: "cartao contato-suporte", "data-teste": "contato-suporte" },
    el("h3", { text: "Fale com a gente" }),
    contato.whatsapp ? el("a", { class: "botao principal largo whats", href: `https://wa.me/55${contato.whatsapp}?text=${encodeURIComponent(textoWhats)}`, target: "_blank", rel: "noopener", "data-teste": "whats-suporte", text: "Chamar no WhatsApp" }) : null,
    contato.email ? el("p", {}, "E-mail: ", el("a", { href: `mailto:${contato.email}`, text: contato.email })) : null,
    contato.horario ? el("p", { class: "suave", text: `Atendimento: ${contato.horario}` }) : null,
    !contato.whatsapp && !contato.email ? el("p", { class: "suave", text: "Abra um chamado ao lado: a resposta aparece aqui mesmo, em Meus chamados." }) : null,
    el("p", { class: "suave" }, "Antes, veja se a resposta está nas ", el("a", { href: "#/duvidas", text: "dúvidas frequentes" }), " ou nos ", el("a", { href: "#/tutoriais", text: "tutoriais" }), "."));

  const form = el("form", { class: "cartao" },
    el("h3", { text: "Abrir chamado" }),
    campo("Tipo", { tag: "select", name: "categoria", opcoes: Object.entries(categorias) }),
    campo("Assunto", { name: "assunto", required: true, maxlength: "100", placeholder: "Ex.: Caixa não fecha" }),
    campo("O que aconteceu?", { tag: "textarea", name: "mensagem", required: true, rows: "4", maxlength: "3000" }, "Conte em qual tela estava, o que fez e o que apareceu."),
    el("button", { type: "submit", class: "botao principal", text: "Enviar chamado" }));
  form.addEventListener("submit", ev => {
    ev.preventDefault();
    enviar(form, async () => {
      const r = await api("/suporte/chamados", { metodo: "POST", corpo: { categoria: form.categoria.value, assunto: form.assunto.value, mensagem: form.mensagem.value, tela: telaAnterior || null } });
      avisar(`Chamado #${r.chamado.numero} aberto. A resposta aparece aqui.`);
      telaSuporte();
    });
  });

  mostrar(cabecalho("Suporte", "Atendimento do 4blade para proprietário e gerente"),
    el("div", { class: "duas-colunas" },
      el("div", {}, contatoEl, form),
      el("section", {},
        el("h3", { text: "Meus chamados" }),
        chamados.length ? el("ul", { class: "lista" }, chamados.map(c => itemChamado(c, `#/suporte/${c.id}`)))
          : el("p", { class: "vazio", text: "Nenhum chamado ainda." }))));
}
const CATEGORIAS_CHAMADO = { duvida: "Dúvida", problema: "Problema no sistema", assinatura: "Assinatura e pagamento", sugestao: "Sugestão" };

// Plataforma: fila de chamados e contato do suporte.
let filtroChamados = "abertos";
async function telaChamados(id) {
  if (id) {
    const { chamado: c, mensagens } = await api(`/plataforma/chamado?id=${encodeURIComponent(id)}`);
    const [rot, cor] = NOME_SIT_CHAMADO[c.situacao];
    const form = el("form", { class: "cartao" },
      campo("Resposta", { tag: "textarea", name: "msg", required: true, rows: "4", maxlength: "3000" }),
      caixaMarcar("Encerrar o chamado junto com a resposta", { name: "encerrar" }),
      el("div", { class: "item-acoes" },
        el("button", { type: "submit", class: "botao principal", text: "Responder" }),
        c.situacao !== "encerrado" ? botao("Encerrar sem responder", async () => {
          await api("/plataforma/chamados/encerrar", { metodo: "POST", corpo: { id: c.id } });
          avisar("Chamado encerrado."); telaChamados(c.id);
        }) : null));
    form.addEventListener("submit", ev => {
      ev.preventDefault();
      enviar(form, async () => {
        await api("/plataforma/chamados/responder", { metodo: "POST", corpo: { id: c.id, mensagem: form.msg.value, encerrar: form.encerrar.checked } });
        avisar("Resposta enviada."); telaChamados(c.id);
      });
    });
    const tel = c.telefone ? `https://wa.me/55${c.telefone}?text=${encodeURIComponent(`Olá, ${c.abertoPor}! Aqui é o suporte do 4blade, sobre o chamado #${c.numero}.`)}` : null;
    return mostrar(
      el("a", { class: "voltar", href: "#/chamados", text: "‹ Chamados" }),
      el("div", { class: "item-topo" }, el("h2", { text: `Chamado #${c.numero}` }), el("span", { class: `etiqueta ${cor}`, text: rot })),
      el("p", { class: "suave", text: `${c.barbearia} · ${c.abertoPor} (${NOME_PERFIL[c.perfil] || c.perfil}) · ${CATEGORIAS_CHAMADO[c.categoria]} · ${c.assunto}${c.tela ? ` · tela: ${c.tela}` : ""}` }),
      tel ? el("a", { class: "botao pequeno whats", href: tel, target: "_blank", rel: "noopener", text: "Chamar no WhatsApp" }) : null,
      conversaChamado(mensagens), form);
  }
  const [{ chamados, aguardando }, { contato }] = await Promise.all([api(`/plataforma/chamados?situacao=${filtroChamados}`), api("/plataforma/contato-suporte")]);
  const formContato = el("form", { class: "cartao" },
    el("h3", { text: "Contato do suporte (aparece para as barbearias)" }),
    campo("WhatsApp do suporte", { name: "whatsapp", inputmode: "tel", value: contato.whatsapp || "" }),
    campo("E-mail do suporte", { name: "email", type: "email", value: contato.email || "", placeholder: "suporte@forblade.com.br" }),
    campo("Horário de atendimento", { name: "horario", value: contato.horario || "", placeholder: "Seg a sex, 9h às 18h" }),
    el("button", { type: "submit", class: "botao principal", text: "Salvar contato" }));
  formContato.addEventListener("submit", ev => {
    ev.preventDefault();
    enviar(formContato, async () => {
      await api("/plataforma/contato-suporte", { metodo: "POST", corpo: { whatsapp: formContato.whatsapp.value, email: formContato.email.value, horario: formContato.horario.value } });
      avisar("Contato salvo.");
    });
  });
  mostrar(cabecalho("Chamados", `${aguardando} aguardando resposta`),
    el("div", { class: "alterna" }, [["abertos", "Abertos"], ["encerrados", "Encerrados"]].map(([f, t]) =>
      el("button", { type: "button", class: `botao pequeno ${filtroChamados === f ? "ativo" : ""}`, text: t, onclick: () => { filtroChamados = f; telaChamados(); } }))),
    el("div", { class: "duas-colunas" },
      el("section", {}, chamados.length ? el("ul", { class: "lista" }, chamados.map(c => itemChamado(c, `#/chamados/${c.id}`, true)))
        : el("p", { class: "vazio", text: "Nenhum chamado aqui." })),
      el("section", {}, formContato)));
}

// ---------- LANDING PAGE (forblade.com.br, sem login) ----------
const LP_RECURSOS = [
  ["agenda", "Agenda que não se perde", "Horários livres de cada barbeiro na hora, cliente fixo toda semana, remarcar com um toque e visão do mês por cores."],
  ["caixa", "Caixa sem erro", "Pix, dinheiro com troco, cartões e notas (fiado). Abertura, sangria, fechamento com diferença registrada."],
  ["comissao", "Comissão automática", "Cada atendimento e venda já calcula a comissão. Vales descontados e fechamento do período sem planilha."],
  ["estoque", "Estoque com custo médio", "Entrada, ajuste e inventário. Avisa o que precisa repor e o que está vencendo."],
  ["mensagem", "WhatsApp pronto", "Lembrete, confirmação e promoções com o nome do cliente, abertos no seu WhatsApp. Sem custo por mensagem."],
  ["contador", "Pronto para o contador", "Resumo do mês em PDF e planilha com tudo, enviados pelo celular. Seus dados sempre seus."]
];
const LP_DORES = [
  ["O que fica de cabeça, fica pelo caminho.", "Cada horário, atendimento e venda fica registrado na hora, no celular."],
  ["Comissão anotada à mão é comissão discutida.", "O sistema calcula a comissão de cada atendimento. O barbeiro vê o mesmo número que você."],
  ["Estoque de memória acaba na hora errada.", "O 4blade avisa o que precisa repor antes de faltar na prateleira."],
  ["Quem não anota não sabe se lucrou.", "O painel mostra o que entrou, o que saiu e o lucro do dia, da semana e do mês."]
];
const LP_PERFIS = [
  ["Dono (gerente)", "Atende com agenda própria e vê o lucro, o painel e tudo o que acontece, de onde estiver."],
  ["Gerente", "Organiza agenda, equipe, comissões e contas — e também atende."],
  ["Barbeiro", "Vê a própria agenda, finaliza atendimentos e acompanha quanto ganhou."],
  ["Caixa / recepção", "Marca horários para todos, cobra, vende e fecha o caixa."]
];
const LP_PRINTS = [["marcar-horario", "Novo horário mostra só o que está livre"], ["cobrar", "Caixa separado por forma de pagamento"], ["painel", "Painel com faturamento, comissões e lucro"]];
const LP_DUVIDAS = ["Dá para usar no celular? Como instalo o app?", "Qual a diferença entre os planos?", "O que acontece se eu atrasar?", "Meus dados ficam salvos? Posso baixar tudo?", "Por onde eu começo?"];

function blocoPlanos(info) {
  const area = el("div", { class: "planos" });
  const alterna = el("div", { class: "alterna", role: "group", "aria-label": "Forma de pagamento" });
  const desenhar = () => {
    alterna.replaceChildren(...[["mensal", "Mensal"], ["anual", `Anual (paga ${info.mesesDoAnual} meses)`]].map(([c, t]) =>
      el("button", { type: "button", class: `botao pequeno ${cicloPlanos === c ? "ativo" : ""}`, "data-ciclo": c, "aria-pressed": cicloPlanos === c ? "true" : "false", text: t,
        onclick: () => { cicloPlanos = c; desenhar(); } })));
    area.replaceChildren(...info.planos.map(p => cartaoPlano(p, info, cicloPlanos)));
  };
  desenhar();
  alterna.hidden = !info.cobrancaAtiva;
  return { alterna, area };
}

async function telaInicio() {
  const info = await carregarPlanos();
  const { alterna, area } = blocoPlanos(info);
  const todas = AJUDA().duvidas;
  const duvidas = LP_DUVIDAS.map(q => todas.find(d => d.p === q)).filter(Boolean).slice(0, 4);
  const contato = info.contato || {};
  const whats = contato.whatsapp ? `https://wa.me/55${contato.whatsapp}?text=${encodeURIComponent("Olá! Quero conhecer o 4blade para a minha barbearia.")}` : null;
  const cta = (classe = "") => el("div", { class: `lp-acoes ${classe}` },
    info.cobrancaAtiva
      ? el("a", { class: "botao lp-botao-principal", href: "#/planos", "data-teste": "lp-comecar", text: `Começar ${info.testeDias} dias grátis` })
      : el("a", { class: "botao lp-botao-principal", href: "#/teste-gratis", "data-teste": "lp-teste-gratis", text: "Solicitar teste grátis" }),
    el("a", { class: "botao lp-botao-secundario", href: "#/entrar", "data-teste": "lp-entrar", text: "Já sou cliente: entrar" }));

  mostrar(el("div", { class: "lp" },
    el("header", { class: "lp-barra" },
      el("img", { src: "/icons/logo.png", alt: "4blade", width: "110", height: "45" }),
      el("nav", {}, el("a", { href: "#lp-planos", onclick: e => { e.preventDefault(); document.getElementById("lp-planos").scrollIntoView({ behavior: "smooth" }); }, text: "Planos" }),
        el("a", { class: "botao pequeno", href: "#/entrar", text: "Entrar" }))),
    el("section", { class: "lp-hero" },
      el("div", { class: "lp-hero-texto" },
        el("p", { class: "lp-kicker", text: "Da cadeira ao caixa, sem erro." }),
        el("h1", {}, "Gestão ", el("span", { text: "afiada" }), " para sua barbearia."),
        el("p", { class: "lp-sub", text: "Agenda, caixa, estoque, comissões e WhatsApp num só lugar. Funciona no celular e no computador, sem instalar nada." }),
        cta(),
        el("p", { class: "lp-miudo", text: info.cobrancaAtiva ? "Sem cartão para testar · Cancele quando quiser · Seus dados são seus" : "Teste grátis com acompanhamento · Funciona no celular e no computador · Seus dados são seus" })),
      el("div", { class: "lp-hero-print" },
        el("img", { src: "/tutoriais/agenda-dia.jpg", alt: "Agenda do 4blade no celular", width: "390", height: "760" }))),
    el("section", { class: "lp-secao", "data-teste": "lp-caderno" },
      el("h2", { text: "Ainda no caderninho?" }),
      el("p", { class: "lp-intro", text: "Anotar à mão funciona até o dia em que não funciona." }),
      el("div", { class: "lp-dores" }, LP_DORES.map(([dor, solucao]) => el("div", { class: "lp-dor" },
        el("strong", { text: dor }), el("p", { text: solucao }))))),
    el("section", { class: "lp-secao" },
      el("h2", { text: "Feito para a rotina da barbearia" }),
      el("p", { class: "lp-intro", text: "Menos papel, menos conta de cabeça, mais tempo na cadeira." }),
      el("div", { class: "lp-recursos" }, LP_RECURSOS.map(([ic, t, d]) => el("article", { class: "lp-recurso" },
        el("span", { class: "lp-icone" }, icone(ic)), el("h3", { text: t }), el("p", { text: d }))))),
    el("section", { class: "lp-secao lp-escura" },
      el("h2", { text: "Veja por dentro" }),
      el("div", { class: "lp-prints" }, LP_PRINTS.map(([id, leg]) => el("figure", {},
        el("img", { src: `/tutoriais/${id}.jpg`, alt: leg, width: "390", height: "700", loading: "lazy" }),
        el("figcaption", { text: leg })))),
      el("p", { class: "lp-miudo centro", text: "Telas reais do sistema, com dados fictícios." })),
    el("section", { class: "lp-secao" },
      el("h2", { text: "Cada um vê o que precisa" }),
      el("div", { class: "lp-perfis" }, LP_PERFIS.map(([t, d]) => el("div", { class: "lp-perfil" }, el("strong", { text: t }), el("p", { text: d })))),
      el("p", { class: "lp-intro", text: "Cada pessoa tem o próprio usuário e senha. Tudo o que é feito fica registrado: quem, quando e o que mudou." })),
    !info.cobrancaAtiva ? null : el("section", { class: "lp-secao lp-passos-secao" },
      el("h2", { text: "Comece hoje, em 3 passos" }),
      el("ol", { class: "lp-passos" },
        el("li", {}, el("strong", { text: "Escolha o plano" }), el("span", { text: "e crie seu acesso em 2 minutos." })),
        el("li", {}, el("strong", { text: "Cadastre o básico" }), el("span", { text: "horário de funcionamento, serviços e equipe. Os tutoriais mostram cada tela." })),
        el("li", {}, el("strong", { text: "Use por 14 dias grátis" }), el("span", { text: "e só então decida. A 1ª mensalidade vence no fim do teste." })))),
    el("section", { class: "lp-secao", id: "lp-planos" },
      el("h2", { text: "Planos" }),
      el("p", { class: "lp-intro", text: "Escolha pelo número de barbeiros. Gerentes e caixas sem limite em todos." }),
      el("div", { class: "centro lp-alterna" }, alterna),
      area),
    el("section", { class: "lp-secao" },
      el("h2", { text: "Dúvidas comuns" }),
      el("div", { class: "lp-duvidas" }, duvidas.map(d => el("details", { class: "duvida" }, el("summary", { text: d.p }), el("p", { text: d.r })))),
      el("p", { class: "centro" }, el("a", { href: "#/duvidas", text: "Ver todas as dúvidas frequentes" }))),
    el("section", { class: "lp-final" },
      el("h2", { text: "Corte certo nos números da sua barbearia." }),
      cta("centro"),
      whats ? el("p", {}, el("a", { class: "lp-whats", href: whats, target: "_blank", rel: "noopener", "data-teste": "lp-whats", text: "Prefere conversar? Chame no WhatsApp" })) : null),
    el("footer", { class: "lp-rodape" },
      el("img", { src: "/icons/logo.png", alt: "4blade", width: "86", height: "35" }),
      el("nav", {},
        el("a", { href: "#/planos", text: "Planos" }), el("a", { href: "#/duvidas", text: "Dúvidas" }),
        el("a", { href: "#/termos", text: "Termos de uso" }), el("a", { href: "#/privacidade", text: "Privacidade" }), el("a", { href: "#/entrar", text: "Entrar" })),
      contato.email ? el("p", {}, el("a", { href: `mailto:${contato.email}`, text: contato.email })) : null,
      el("p", { class: "lp-miudo", text: `© ${new Date().getFullYear()} 4blade · Gestão para barbearias` }))));
  document.body.classList.add("tela-entrada");
}

// ---------- SOLICITAR TESTE GRÁTIS (site, sem login) ----------
async function telaSolicitarTeste(planoInicial) {
  const info = await carregarPlanos();
  const form = el("form", { class: "cartao form-assinar", autocomplete: "on" },
    campo("Nome da barbearia", { name: "barbearia", required: true, maxlength: "80", autocomplete: "organization" }),
    campo("Seu nome", { name: "nome", required: true, maxlength: "100", autocomplete: "name" }),
    el("div", { class: "lado-a-lado" },
      campo("WhatsApp", { name: "telefone", required: true, inputmode: "tel", autocomplete: "tel" }),
      campo("Cidade", { name: "cidade", required: true, maxlength: "80", placeholder: "Ex.: Belo Horizonte - MG" })),
    el("div", { class: "lado-a-lado" },
      campo("Quantos barbeiros?", { tag: "select", name: "barbeiros", valor: "2", opcoes: [["1", "1"], ["2", "2"], ["3", "3"], ["4", "4"], ["6", "5 a 6"], ["10", "7 a 10"], ["11", "Mais de 10"]] }),
      campo("Plano de interesse", { tag: "select", name: "plano", valor: info.planos.some(p => p.id === planoInicial) ? planoInicial : "", opcoes: [["", "Ainda não sei"], ...info.planos.map(p => [p.id, p.nome])] })),
    campo("Quer contar algo? (opcional)", { tag: "textarea", name: "mensagem", rows: "3", maxlength: "500" }, "Ex.: hoje uso caderno; quero controlar comissão."),
    el("div", { class: "marcar aceite" },
      el("input", { type: "checkbox", name: "aceite", id: "c-aceite", required: true }),
      el("label", { for: "c-aceite" }, "Aceito que o 4blade entre em contato pelo WhatsApp e li a ",
        el("button", { type: "button", class: "link", text: "política de privacidade", onclick: () => janelaLegal("privacidade") }), ".")),
    el("button", { type: "submit", class: "botao principal largo", text: "Solicitar teste grátis" }));
  form.addEventListener("submit", ev => {
    ev.preventDefault();
    enviar(form, async () => {
      const r = await api("/solicitar-teste", { metodo: "POST", corpo: {
        barbearia: form.barbearia.value, nome: form.nome.value, telefone: form.telefone.value, cidade: form.cidade.value,
        barbeiros: Number(form.barbeiros.value), planoInteresse: form.plano.value || null, mensagem: form.mensagem.value || undefined, aceite: form.aceite.checked
      } });
      mostrar(el("section", { class: "publica estreita" },
        el("div", { class: "cartao boas-vindas", "data-teste": "teste-recebido" },
          el("h2", { text: "Pedido recebido!" }),
          el("p", { text: r.mensagem }),
          el("p", { class: "suave", text: `Número do pedido: ${r.numero}. Enquanto isso, veja como o sistema funciona nos tutoriais e nas dúvidas frequentes.` }),
          el("div", { class: "item-acoes" },
            el("a", { class: "botao principal", href: "#/", text: "Voltar ao início" }),
            el("a", { class: "botao", href: "#/duvidas", text: "Dúvidas frequentes" })))));
    });
  });
  mostrar(el("section", { class: "publica estreita" },
    el("a", { class: "voltar", href: "#/", text: "‹ Voltar" }),
    el("h2", { text: "Solicitar teste grátis" }),
    el("p", { class: "suave", text: "Preencha e a gente fala com você pelo WhatsApp para cadastrar sua barbearia e acompanhar os primeiros dias." }),
    form));
}

// ---------- PLATAFORMA: pedidos de teste grátis ----------
const NOME_SIT_PEDIDO = { nova: ["Novo", "amarela"], em_contato: ["Em contato", ""], cadastrada: ["Cadastrada", "verde"], descartada: ["Descartado", "vermelha"] };
let filtroPedidos = "abertas";
async function telaPedidos() {
  const { solicitacoes, novas } = await api(`/plataforma/solicitacoes${filtroPedidos === "todas" ? "?situacao=todas" : ""}`);
  const mudar = async (s, situacao, observacao) => {
    await api("/plataforma/solicitacoes/situacao", { metodo: "POST", corpo: { id: s.id, situacao, observacao } });
    avisar("Pedido atualizado."); telaPedidos();
  };
  const lista = solicitacoes.length ? el("ul", { class: "lista" }, solicitacoes.map(s => {
    const [rot, cor] = NOME_SIT_PEDIDO[s.situacao];
    const whats = `https://wa.me/55${s.telefone}?text=${encodeURIComponent(`Olá, ${s.nome.split(" ")[0]}! Aqui é do 4blade. Recebemos o seu pedido de teste grátis para a ${s.barbearia}.`)}`;
    const aberto = s.situacao === "nova" || s.situacao === "em_contato";
    return el("li", { class: "item", "data-pedido": s.numero },
      el("div", { class: "item-topo" },
        el("strong", { text: `#${s.numero} · ${s.barbearia}` }),
        el("span", { class: `etiqueta ${cor}`, text: rot })),
      el("p", { class: "suave", text: `${s.nome} · ${fone(s.telefone)} · ${s.cidade}` }),
      el("p", { class: "suave", text: `${s.barbeiros} barbeiro(s)${s.planoInteresse ? ` · interesse: ${NOME_PLANO[s.planoInteresse]}` : ""} · pedido em ${dataBR(s.criadoEm)}` }),
      s.mensagem ? el("p", { text: `"${s.mensagem}"` }) : null,
      s.observacao ? el("p", { class: "suave", text: `Obs.: ${s.observacao}` }) : null,
      aberto ? el("div", { class: "item-acoes" },
        el("a", { class: "botao pequeno whats", href: whats, target: "_blank", rel: "noopener", text: "WhatsApp" }),
        s.situacao === "nova" ? botao("Em contato", () => mudar(s, "em_contato"), "pequeno") : null,
        botao("Cadastrar barbearia", () => janelaCadastrarPedido(s), "pequeno principal"),
        botao("Descartar", () => pedirMotivo(`Descartar pedido #${s.numero}`, "O pedido sai da fila. Nada é apagado.", motivo => mudar(s, "descartada", motivo), "Descartar"), "pequeno perigo")) : null);
  })) : el("p", { class: "vazio", text: filtroPedidos === "todas" ? "Nenhum pedido ainda." : "Nenhum pedido aguardando." });
  mostrar(cabecalho("Pedidos de teste grátis", `${novas} novo(s) · vindos do site`),
    el("div", { class: "alterna" }, [["abertas", "Em aberto"], ["todas", "Todos"]].map(([f, t]) =>
      el("button", { type: "button", class: `botao pequeno ${filtroPedidos === f ? "ativo" : ""}`, text: t, onclick: () => { filtroPedidos = f; telaPedidos(); } }))),
    lista);
}

function janelaCadastrarPedido(s) {
  return abrirJanela(`Cadastrar ${s.barbearia}`, [
    campo("Nome da barbearia", { name: "nome", required: true, value: s.barbearia, maxlength: "80" }),
    campo("Plano", { tag: "select", name: "plano", valor: s.planoInteresse || (s.barbeiros > 4 ? "pro" : s.barbeiros > 2 ? "standard" : "basico"), opcoes: OPCOES_PLANO }),
    campo("Nome do proprietário", { name: "propNome", required: true, value: s.nome }),
    campo("Usuário de acesso", { name: "propLogin", required: true, value: sugerirLogin(s.barbearia), autocapitalize: "none", spellcheck: "false" }),
    campo("WhatsApp do proprietário", { name: "propTel", inputmode: "tel", value: fone(s.telefone) })
  ], {
    ok: "Cadastrar",
    aoConfirmar: async form => {
      const r = await api("/plataforma/barbearias", { metodo: "POST", corpo: {
        nome: form.nome.value, plano: form.plano.value, telefone: form.propTel.value || undefined, solicitacaoId: s.id,
        proprietario: { nome: form.propNome.value, login: form.propLogin.value.trim().toLowerCase(), telefone: form.propTel.value || undefined }
      } });
      setTimeout(async () => { await mostrarSenha(r.proprietario.login, r.senhaProvisoria, `o proprietário (${r.proprietario.nome})`, { nome: r.proprietario.nome, telefone: s.telefone, barbearia: r.barbearia.nome }); telaPedidos(); }, 0);
    }
  });
}

function atualizarTopo() {
  const sub = document.getElementById("topo-sub");
  const acoes = document.getElementById("topo-acoes");
  const logado = Boolean(usuario && !usuario.trocaObrigatoria);
  if (logado) {
    sub.textContent = usuario.barbearia ? usuario.barbearia.nome : "Plataforma";
    montarMenu();
  } else {
    sub.textContent = "Gestão para barbearias";
    menuEl().hidden = true;
    fecharMenu();
  }
  acoes.hidden = !logado;
  document.getElementById("btn-notif").hidden = !(logado && usuario.barbearia && usuario.perfil !== "plataforma");
  atualizarFaixa();
  document.getElementById("btn-menu").hidden = !logado;
  document.body.classList.toggle("com-menu", logado);
}

function irParaInicial() {
  const destino = `#/${usuario.telaInicial}`;
  if (location.hash === destino) rotear();
  else location.hash = destino;
}

// ---------- PLATAFORMA ----------
// O dono já é gerente (seção 16): entra na conta dos gerentes.
function textoGerentes(b) {
  const outros = b.usuariosAtivos.gerente;
  if (!b.proprietario) return `${outros} gerente(s)`;
  return outros ? `${outros + 1} gerentes (o dono + ${outros})` : "1 gerente (o dono)";
}
async function telaPlataforma() {
  const { barbearias } = await api("/plataforma/barbearias");
  const form = el("form", { class: "cartao" },
    el("h3", { text: "Nova barbearia" }),
    campo("Nome da barbearia", { name: "nome", required: true, maxlength: "80" }),
    campo("Plano", { tag: "select", name: "plano", opcoes: OPCOES_PLANO }),
    campo("Telefone da barbearia (opcional)", { name: "telefone", inputmode: "tel", autocomplete: "off" }),
    el("h4", { text: "1º acesso do proprietário" }),
    campo("Nome do proprietário", { name: "propNome", required: true }),
    campo("Usuário de acesso", { name: "propLogin", required: true, autocapitalize: "none", spellcheck: "false" }, "Ex.: joao.barbeariadojoao (minúsculas, sem espaço)."),
    campo("Telefone do proprietário (opcional)", { name: "propTel", inputmode: "tel", autocomplete: "off" }),
    el("button", { type: "submit", class: "botao principal", text: "Criar barbearia" }));
  form.addEventListener("submit", ev => {
    ev.preventDefault();
    enviar(form, async () => {
      const r = await api("/plataforma/barbearias", {
        metodo: "POST",
        corpo: {
          nome: form.nome.value, plano: form.plano.value, telefone: form.telefone.value || undefined,
          proprietario: { nome: form.propNome.value, login: form.propLogin.value.trim().toLowerCase(), telefone: form.propTel.value || undefined }
        }
      });
      await mostrarSenha(r.proprietario.login, r.senhaProvisoria, `o proprietário (${r.proprietario.nome})`, { nome: r.proprietario.nome, telefone: form.propTel.value, barbearia: r.barbearia.nome });
      telaPlataforma();
    });
  });

  const lista = barbearias.length
    ? el("ul", { class: "lista" }, barbearias.map(b => el("li", { class: `item ${b.bloqueada ? "inativo" : ""}`, "data-barbearia": b.nome },
      el("div", { class: "item-topo" },
        el("strong", { text: b.nome }),
        el("span", { class: `etiqueta ${b.bloqueada ? "vermelha" : "verde"}`, text: b.bloqueada ? "Bloqueada" : "Ativa" }),
        el("span", { class: "etiqueta", text: `Plano ${NOME_PLANO[b.plano]}${b.barbeirosAdicionais ? ` +${b.barbeirosAdicionais}` : ""}` }),
        b.assinatura?.origem === "asaas" ? el("span", { class: `etiqueta ${(NOME_SIT_ASSINATURA[b.assinatura.situacao] || [])[1] || ""}`, "data-situacao": b.assinatura.situacao, text: NOME_SIT_ASSINATURA[b.assinatura.situacao]?.[0] || b.assinatura.situacao }) : null),
      b.assinatura?.origem !== "asaas" ? el("p", { class: "suave", "data-teste": "origem-barbearia", text: "Cadastrada pelo suporte" }) : null,
      b.assinatura?.origem === "asaas" ? el("p", { class: "suave", text: `Assinou pelo site · ${reais(b.assinatura.valorCentavos)}/${b.assinatura.ciclo === "anual" ? "ano" : "mês"} · ${textoSituacao(b.assinatura)}${b.email ? ` · ${b.email}` : ""}` }) : null,
      el("p", { class: "suave", text: `Proprietário: ${b.proprietario?.nome || "—"} · usuário ${b.proprietario?.login || "—"}${b.proprietario?.telefone ? ` · WhatsApp ${fone(b.proprietario.telefone)}` : ""}${b.proprietario?.trocaPendente ? " · ainda não entrou" : ""}` }),
      b.telefone ? el("p", { class: "suave", text: `Telefone: ${fone(b.telefone)}` }) : null,
      el("p", { class: "suave", "data-teste": "equipe-ativa", text: `Equipe ativa: ${textoGerentes(b)}, ${b.usuariosAtivos.barbeiro} barbeiro(s), ${b.usuariosAtivos.caixa} caixa(s)` }),
      b.bloqueada && b.motivoBloqueio ? el("p", { class: "suave", text: `Motivo do bloqueio: ${b.motivoBloqueio}` }) : null,
      el("div", { class: "item-acoes" },
        botao(b.bloqueada ? "Desbloquear" : "Bloquear", () => pedirMotivo(
          `${b.bloqueada ? "Desbloquear" : "Bloquear"} ${b.nome}`,
          b.bloqueada ? "A equipe volta a entrar no sistema." : "Ninguém da barbearia consegue entrar enquanto estiver bloqueada. Quem está usando sai na hora.",
          async motivo => {
            await api("/plataforma/barbearias/alterar", { metodo: "POST", corpo: { id: b.id, bloqueada: !b.bloqueada, motivo } });
            avisar(b.bloqueada ? "Barbearia desbloqueada." : "Barbearia bloqueada.");
            telaPlataforma();
          }, b.bloqueada ? "Desbloquear" : "Bloquear"), "pequeno"),
        botao("Plano", () => janelaPlano(b), "pequeno"),
        botao("Editar dados", () => janelaEditarBarbearia(b), "pequeno"),
        botao("Equipe", () => janelaEquipeBarbearia(b), "pequeno"),
        botao("Enviar acesso ao dono", () => pedirMotivo(
          "Enviar acesso ao dono",
          b.proprietario?.trocaPendente
            ? "Gera uma senha provisória nova para o dono e abre a mensagem pronta (link, usuário e senha) para enviar."
            : "O dono já criou a senha dele. Gerar uma provisória nova SUBSTITUI a senha atual. Use só se ele esqueceu ou pediu.",
          async motivo => {
            const r = await api("/plataforma/barbearias/redefinir-senha", { metodo: "POST", corpo: { id: b.id, motivo } });
            setTimeout(() => mostrarSenha(r.login, r.senhaProvisoria, `o proprietário (${r.nome})`, { nome: r.nome, telefone: r.telefone, barbearia: b.nome }), 0);
          }, "Gerar e enviar"), "pequeno principal"))
    )))
    : el("p", { class: "vazio", text: "Nenhuma barbearia ainda. Crie a primeira ao lado." });

  mostrar(
    cabecalho("Painel da plataforma", "Barbearias clientes do 4blade", null),
    el("p", { class: "info", "data-teste": "explicacao-plataforma", text: "Este painel é só para administrar as barbearias (criar, bloquear, plano e senha do dono). Para usar o sistema de uma barbearia (agenda, caixa, equipe…), toque em Sair e entre com o usuário do proprietário. Para mandar o acesso ao dono (ou à equipe), use \"Enviar acesso ao dono\" ou \"Equipe\"." }),
    el("div", { class: "duas-colunas" },
      el("section", {}, el("h3", { text: `Barbearias (${barbearias.length})` }), lista),
      el("section", {}, form)));
}

// Suporte: corrigir nome/telefones da barbearia e o nome, USUÁRIO e telefone do dono.
function janelaEditarBarbearia(b) {
  const p = b.proprietario || {};
  return abrirJanela(`Editar ${b.nome}`, [
    campo("Nome da barbearia", { name: "nome", required: true, maxlength: "80", value: b.nome }),
    campo("Telefone da barbearia (opcional)", { name: "telefone", inputmode: "tel", value: b.telefone ? fone(b.telefone) : "" }),
    el("h4", { text: "Proprietário" }),
    campo("Nome do proprietário", { name: "propNome", required: true, value: p.nome || "" }),
    campo("Usuário de acesso", { name: "propLogin", required: true, value: p.login || "", autocapitalize: "none", spellcheck: "false" }, "Se trocar, o dono passa a entrar com o usuário novo (a senha continua a mesma)."),
    campo("WhatsApp do proprietário (opcional)", { name: "propTel", inputmode: "tel", value: p.telefone ? fone(p.telefone) : "" }, "Com o WhatsApp preenchido, o envio do acesso vai direto para ele."),
    campo("Motivo", { name: "motivo", required: true, minlength: "3", value: "Atualização de cadastro" })
  ], {
    ok: "Salvar",
    aoConfirmar: async form => {
      await api("/plataforma/barbearias/editar", { metodo: "POST", corpo: {
        id: b.id, nome: form.nome.value, telefone: form.telefone.value, motivo: form.motivo.value,
        proprietario: { nome: form.propNome.value, login: form.propLogin.value.trim().toLowerCase(), telefone: form.propTel.value }
      } });
      avisar("Dados atualizados.");
      telaPlataforma();
    }
  });
}

// Suporte: equipe da barbearia — ver, criar usuário e enviar o acesso de cada pessoa.
async function janelaEquipeBarbearia(b) {
  const { usuarios, vagaBarbeiro } = await api(`/plataforma/barbearias/equipe?id=${encodeURIComponent(b.id)}`);
  const enviarAcesso = u => pedirMotivo(`Enviar acesso para ${u.nome}`,
    u.trocaPendente ? "Gera uma senha provisória nova e abre a mensagem pronta para enviar." : "Essa pessoa já criou a senha dela. Gerar uma provisória nova SUBSTITUI a senha atual.",
    async motivo => {
      const r = u.perfil === "proprietario"
        ? await api("/plataforma/barbearias/redefinir-senha", { metodo: "POST", corpo: { id: b.id, motivo } })
        : await api("/plataforma/barbearias/equipe/senha", { metodo: "POST", corpo: { barbeariaId: b.id, usuarioId: u.id, motivo } });
      setTimeout(() => mostrarSenha(r.login, r.senhaProvisoria, u.nome, { nome: r.nome, telefone: r.telefone, barbearia: b.nome }), 0);
    }, "Gerar e enviar");
  const lista = el("ul", { class: "lista" }, usuarios.map(u => el("li", { class: `item ${u.ativo ? "" : "inativo"}`, "data-equipe": u.login },
    el("div", { class: "item-topo" },
      el("strong", { text: u.nome }), el("span", { class: "etiqueta", text: NOME_PERFIL[u.perfil] }),
      !u.ativo ? el("span", { class: "etiqueta vermelha", text: "Desativado" }) : u.trocaPendente ? el("span", { class: "etiqueta amarela", text: "Ainda não entrou" }) : null),
    el("p", { class: "suave", text: [`Usuário: ${u.login}`, u.telefone ? fone(u.telefone) : null].filter(Boolean).join(" · ") }),
    u.ativo ? el("div", { class: "item-acoes" }, botao("Enviar acesso", () => enviarAcesso(u), "pequeno")) : null)));
  const erroNovo = el("p", { class: "erro", role: "alert", hidden: true });
  const criar = el("button", { type: "button", class: "botao principal", "data-teste": "criar-usuario-suporte", text: "Criar e enviar acesso" });
  const novo = el("div", { class: "cartao" },
    el("h4", { text: "Criar usuário" }),
    campo("Perfil", { tag: "select", name: "eqPerfil", id: "c-eqPerfil", opcoes: [["barbeiro", "Barbeiro"], ["gerente", "Gerente"], ["caixa", "Caixa"]] }),
    campo("Nome", { name: "eqNome", id: "c-eqNome" }),
    campo("Usuário de acesso", { name: "eqLogin", id: "c-eqLogin", autocapitalize: "none", spellcheck: "false" }, "Minúsculas, sem espaço. Ex.: pedro.stylos"),
    campo("WhatsApp (opcional)", { name: "eqTel", id: "c-eqTel", inputmode: "tel" }),
    el("p", { class: "suave", text: `Vagas de barbeiro: ${vagaBarbeiro.ativos}/${vagaBarbeiro.limite}. Comissões começam em 0%: o dono ajusta em Equipe.` }),
    erroNovo, criar);
  const valor = id => novo.querySelector(`#${id}`).value;
  criar.addEventListener("click", async () => {
    erroNovo.hidden = true;
    criar.disabled = true;
    try {
      const r = await api("/plataforma/barbearias/equipe", { metodo: "POST", corpo: {
        barbeariaId: b.id, perfil: valor("c-eqPerfil"), nome: valor("c-eqNome"), login: valor("c-eqLogin").trim().toLowerCase(), telefone: valor("c-eqTel") || undefined } });
      janela.close();
      setTimeout(async () => {
        await mostrarSenha(r.usuario.login, r.senhaProvisoria, r.usuario.nome, { nome: r.usuario.nome, telefone: r.usuario.telefone, barbearia: b.nome });
        telaPlataforma();
      }, 0);
    } catch (e) {
      erroNovo.textContent = e.message; erroNovo.hidden = false;
    } finally { criar.disabled = false; }
  });
  return abrirJanela(`Equipe — ${b.nome}`, [lista, novo], { ok: "Fechar", semCancelar: true, aoConfirmar: () => true });
}

function janelaPlano(b) {
  return abrirJanela(`Plano de ${b.nome}`, [
    campo("Plano", { tag: "select", name: "plano", valor: b.plano, opcoes: OPCOES_PLANO }),
    b.assinatura?.origem === "asaas" ? el("p", { class: "suave", text: "Assinatura pelo Asaas: o valor das próximas cobranças muda junto." }) : null,
    campo("Barbeiros adicionais (só Pro)", { name: "adicionais", type: "number", min: "0", max: "100", value: String(b.barbeirosAdicionais), inputmode: "numeric" }),
    campo("Motivo", { name: "motivo", required: true, minlength: "3" })
  ], {
    ok: "Salvar",
    aoConfirmar: async form => {
      await api("/plataforma/barbearias/alterar", {
        metodo: "POST",
        corpo: { id: b.id, plano: form.plano.value, barbeirosAdicionais: Number(form.adicionais.value || 0), motivo: form.motivo.value }
      });
      avisar("Plano atualizado.");
      telaPlataforma();
    }
  });
}

// ---------- INÍCIO (menu por perfil) ----------
const gestao = () => usuario.perfil === "proprietario" || usuario.perfil === "gerente";
const ehCaixa = () => usuario.perfil === "caixa";
// Gestão e caixa (recepção) veem e marcam na agenda de todos os profissionais.
const veTodas = () => gestao() || ehCaixa();


// ---------- datas e horas ----------
const DIAS = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];
const DIAS_CURTO = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
const diaDaSemana = d => new Date(`${d}T12:00:00Z`).getUTCDay();
const somaDias = (d, n) => { const x = new Date(`${d}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const hojeLocal = () => new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 10);   // America/Sao_Paulo
const dataLonga = d => `${DIAS_CURTO[diaDaSemana(d)]}, ${dataBR(d).slice(0, 5)}`;
// "2026-11-16 15:04:05" (UTC do banco) → "12:04" (Brasília)
const horaLocal = utc => new Date(`${utc.replace(" ", "T")}Z`).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" });
const NOME_FORMA = { dinheiro: "Dinheiro", pix: "Pix", debito: "Débito", credito: "Crédito", promissoria: "Promissória (paga depois)" };
// Formas que entram no caixa na hora (sem a promissória, que é a nota do cliente para pagar depois).
const OPCOES_FORMA = Object.entries(NOME_FORMA).filter(([f]) => f !== "promissoria");
const NOME_SITUACAO = { agendado: "Agendado", finalizado: "Finalizado", faltou: "Faltou", cancelado: "Cancelado" };
const COR_SITUACAO = { agendado: "", finalizado: "verde", faltou: "amarela", cancelado: "vermelha" };

// ---------- AGENDA ----------
const estadoAgenda = { data: null, visao: "dia", barbeiroId: "", diasAbertos: new Set(), modoDia: (() => { try { return localStorage.getItem("4blade.agendaModo") || "grade"; } catch { return "grade"; } })() };
let marcarParaCliente = null;
let ultimaAgenda = null;   // profissionais da agenda aberta (usados ao remarcar)   // cliente escolhido na tela Clientes → abre o "Novo horário" já com ele
let servicosCache = null;
const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const NOME_STATUS = { livre: "livre", poucos: "poucos horários", cheio: "agenda cheia", fechado: "fechado" };

async function carregarServicos() {
  servicosCache = (await api("/servicos")).servicos.filter(s => s.ativo);
  return servicosCache;
}
const ultimoDiaMes = ym => somaDias(`${somaMes(ym, 1)}-01`, -1);
function somaMes(ym, n) { const [a, m] = ym.split("-").map(Number); const d = new Date(Date.UTC(a, m - 1 + n, 1)); return d.toISOString().slice(0, 7); }

async function telaAgenda() {
  estadoAgenda.data ||= hojeLocal();
  const v = estadoAgenda.visao;
  const d0 = estadoAgenda.data;
  const q = new URLSearchParams({ data: v === "mes" ? `${d0.slice(0, 7)}-01` : d0, dias: v === "semana" ? "7" : v === "mes" ? ultimoDiaMes(d0.slice(0, 7)).slice(8) : "1" });
  if (veTodas() && estadoAgenda.barbeiroId) q.set("barbeiroId", estadoAgenda.barbeiroId);
  // Mês e Ano usam o cálculo de ocupação (livre / poucos / cheio / fechado) por dia.
  const periodo = v === "mes" ? [`${d0.slice(0, 7)}-01`, ultimoDiaMes(d0.slice(0, 7))] : v === "ano" ? [`${d0.slice(0, 4)}-01-01`, `${d0.slice(0, 4)}-12-31`]
    : v === "semana" ? [d0, somaDias(d0, 6)] : null;   // semana: livres por dia na barra de cada dia
  const qo = periodo ? new URLSearchParams({ inicio: periodo[0], fim: periodo[1], ...(veTodas() && estadoAgenda.barbeiroId ? { barbeiroId: estadoAgenda.barbeiroId } : {}) }) : null;
  const qd = new URLSearchParams({ data: d0, ...(veTodas() && estadoAgenda.barbeiroId ? { barbeiroId: estadoAgenda.barbeiroId } : {}) });
  // Semana: os dias abertos mostram a grade do dia (precisa do expediente e dos livres de cada profissional).
  const diasGrade = v !== "semana" ? [] : estadoAgenda.modoDia === "grade" ? [0, 1, 2, 3, 4, 5, 6].map(i => somaDias(d0, i))
    : [...estadoAgenda.diasAbertos].filter(x => x >= d0 && x <= somaDias(d0, 6));
  const qDia = x => new URLSearchParams({ data: x, ...(veTodas() && estadoAgenda.barbeiroId ? { barbeiroId: estadoAgenda.barbeiroId } : {}) });
  const [ag, oc, , disp, ...dispsSemana] = await Promise.all([api(`/agenda?${q}`), qo ? api(`/agenda/ocupacao?${qo}`) : null, carregarServicos(),
    v === "dia" ? api(`/agenda/disponibilidade?${qd}`) : null, ...diasGrade.map(x => api(`/agenda/disponibilidade?${qDia(x)}`))]);
  const dispDoDia = Object.fromEntries(diasGrade.map((x, i) => [x, dispsSemana[i]]));
  ultimaAgenda = ag;
  // Dia: situação de cada profissional e horários livres (tocar abre o "Novo horário" já preenchido).
  const dispDe = id => disp?.profissionais.find(x => x.id === id);
  const resumoDia = p => {
    const x = dispDe(p.id);
    if (!x) return null;
    if (disp.passado) return null;
    if (x.situacao !== "aberto") {
      const rotulo = { fechado: "Fechado", folga: "Folga", bloqueado: "Dia bloqueado", sem_funcionamento: "Sem funcionamento" }[x.situacao];
      return el("div", { class: "resumo-dia fechado", "data-teste": "resumo-dia" }, el("strong", { text: rotulo }), x.motivo ? ` · ${x.motivo}` : "");
    }
    return el("div", { class: `resumo-dia ${x.livres.length ? "livre" : "cheio"}`, "data-teste": "resumo-dia" },
      el("div", { class: "resumo-topo" },
        el("strong", { text: x.livres.length ? `${x.livres.length} horário(s) livre(s)` : "Agenda cheia" }),
        el("span", { class: "suave", text: `${x.janela.ini}–${x.janela.fim}` })),
      x.livres.length ? el("p", { class: "suave", text: "Toque num horário livre da lista para marcar." }) : null);
  };

  const irPara = (d, visao = v) => { estadoAgenda.data = d; estadoAgenda.visao = visao; comCarga(telaAgenda).catch(e => avisar(e.message, "erro")); };
  const mover = n => irPara(v === "mes" ? `${somaMes(d0.slice(0, 7), n)}-01` : v === "ano" ? `${Number(d0.slice(0, 4)) + n}-01-01` : somaDias(d0, n * (v === "semana" ? 7 : 1)));
  const dataInput = el("input", { type: "date", value: d0, "aria-label": "Data", class: "data-agenda" });
  dataInput.addEventListener("change", () => dataInput.value && irPara(dataInput.value));
  const rotuloPeriodo = v === "mes" ? el("strong", { class: "rotulo-periodo", text: `${MESES[Number(d0.slice(5, 7)) - 1]} ${d0.slice(0, 4)}` })
    : v === "ano" ? el("strong", { class: "rotulo-periodo", text: d0.slice(0, 4) }) : dataInput;
  const filtro = veTodas()
    ? el("select", { "aria-label": "Profissional", class: "filtro-prof" },
      el("option", { value: "", text: "Todos os profissionais", selected: !estadoAgenda.barbeiroId || null }),
      ag.profissionais.map(p => el("option", { value: p.id, text: p.nome, selected: p.id === estadoAgenda.barbeiroId || null })))
    : null;
  filtro?.addEventListener("change", () => { estadoAgenda.barbeiroId = filtro.value; telaAgenda(); });

  const barra = el("div", { class: "barra-agenda" },
    el("div", { class: "alterna", role: "group", "aria-label": "Visão da agenda" },
      [["dia", "Dia"], ["semana", "Semana"], ["mes", "Mês"], ["ano", "Ano"]].map(([k, t]) =>
        botao(t, () => irPara(d0, k), `pequeno ${v === k ? "ativo" : ""}`))),
    el("div", { class: "navega-data" },
      botao("‹", () => mover(-1), "pequeno seta"), rotuloPeriodo, botao("›", () => mover(1), "pequeno seta"),
      botao("Hoje", () => irPara(hojeLocal()), "pequeno")),
    filtro,
    el("div", { class: "acoes-agenda" },
      botao("+ Novo horário", () => janelaMarcar(ag), "principal pequeno"),
      ehCaixa() ? null : botao("Bloquear", () => janelaBloquear(ag), "pequeno")));

  const profs = ag.profissionais.filter(p => !estadoAgenda.barbeiroId || p.id === estadoAgenda.barbeiroId);
  let corpo;
  if ((v === "dia" || v === "semana") && !profs.length) {
    corpo = el("p", { class: "vazio", "data-teste": "sem-profissionais", text: "Nenhum profissional com agenda. Cadastre gerente ou barbeiro em Equipe e ajustes → Equipe." });
  } else if (v === "dia") {
    // Dia: grade (horas × profissionais) ou lista (cartões por profissional). A escolha fica guardada no aparelho.
    const modo = alternaModoAgenda();
    corpo = estadoAgenda.modoDia === "grade"
      ? el("div", {}, modo, gradeAgenda(ag, d0, profs, disp))
      : el("div", {}, modo, el("div", { class: `agenda-colunas ${profs.length > 1 ? "varias" : ""}` }, profs.map(p => {
        const x = dispDe(p.id);
        const itens = itensDoDia(ag, d0, p.id, false, x && !disp.passado && x.situacao === "aberto" ? x.livres : null);
        return el("section", { class: "coluna-prof", "data-prof": p.nome },
          el("h3", { text: p.nome }),
          resumoDia(p),
          itens.length ? itens : el("p", { class: "vazio", text: "Nenhum horário." }));
      })));
  } else if (v === "semana" && estadoAgenda.modoDia === "grade") {
    corpo = el("div", {}, alternaModoAgenda(), gradeSemana(ag, d0, profs, dispDoDia, oc));
  } else if (v === "semana") {
    // Semana (pedido de 16/11/2026): cada dia é só uma barra com "marcados" e "livres" (horários ocultos).
    // Tocar na barra abre a lista do dia (hora · cliente · serviço); tocar num horário abre a ficha com todas as opções.
    const varios = profs.length > 1;
    const idsProfs = new Set(profs.map(p => p.id));
    const ocDe = d => oc?.dias.find(x => x.data === d);
    corpo = el("div", { class: "agenda-semana" }, alternaModoAgenda(), [0, 1, 2, 3, 4, 5, 6].map(i => {
      const d = somaDias(d0, i);
      const doDia = ag.agendamentos.filter(a => a.data === d && idsProfs.has(a.barbeiroId)).sort((x, y) => x.inicio.localeCompare(y.inicio));
      const marcados = doDia.filter(a => a.situacao === "agendado" || a.situacao === "finalizado").length;
      const o = ocDe(d);
      const fechado = o?.status === "fechado";
      const passado = d < ag.hoje;
      const aberto = estadoAgenda.diasAbertos.has(d);
      const titulo = el("button", { type: "button", class: `dia-semana-titulo ${d === ag.hoje ? "hoje" : ""}`, "aria-expanded": aberto ? "true" : "false", "data-dia": d,
        onclick: () => { if (aberto) estadoAgenda.diasAbertos.delete(d); else estadoAgenda.diasAbertos.add(d); telaAgenda(); } },
        el("strong", { text: `${DIAS[diaDaSemana(d)]} ${dataBR(d).slice(0, 5)}${d === ag.hoje ? " (hoje)" : ""}` }),
        el("span", { class: "contagens" },
          el("span", { class: `etiqueta ${marcados ? "" : "neutra"}`, "data-marcados": String(marcados), text: `${marcados} marcado${marcados === 1 ? "" : "s"}` }),
          fechado ? el("span", { class: "etiqueta neutra", text: "fechado" })
            : !passado && o ? el("span", { class: `etiqueta ${o.livres ? "verde" : "vermelha"}`, "data-livres": String(o.livres), text: o.livres ? `${o.livres} livre${o.livres === 1 ? "" : "s"}` : "cheio" }) : null),
        svg("svg", { viewBox: "0 0 24 24", class: "icone seta", "aria-hidden": "true" }, svg("path", { d: ICONES.seta })));
      const conteudo = !aberto ? [] : [
        fechado && !doDia.length ? el("p", { class: "suave", text: "Fechado neste dia." }) : gradeAgenda(ag, d, profs, dispDoDia[d]),
        el("div", { class: "acoes-dia-semana" },
          !passado && !fechado ? botao("+ Marcar neste dia", () => janelaMarcar(ag, { data: d }), "pequeno") : null,
          botao("Ver o dia completo", () => irPara(d, "dia"), "pequeno"))
      ];
      return el("section", { class: `dia-semana ${aberto ? "aberto" : ""}` }, titulo, ...conteudo);
    }));
  } else {
    const legenda = el("p", { class: "legenda" },
      el("span", { class: "l-livre", text: "Horários livres" }), el("span", { class: "l-poucos", text: "Poucos horários" }),
      el("span", { class: "l-cheio", text: "Agenda cheia" }), el("span", { class: "l-fechado", text: "Fechado / folga" }));
    corpo = v === "mes" ? calendarioMesNovo(oc, ag, d0.slice(0, 7), irPara, profs) : el("div", {}, legenda, calendarioAno(oc, d0.slice(0, 4), irPara));
  }

  const subtitulo = v === "dia" ? `${DIAS[diaDaSemana(d0)]}, ${dataBR(d0)}` : v === "semana" ? `Semana de ${dataBR(ag.data)} a ${dataBR(ag.ate)}`
    : v === "mes" ? "Toque num dia para ver os horários" : "Toque num mês para ver o calendário";
  if (marcarParaCliente) {
    const c = marcarParaCliente;
    marcarParaCliente = null;
    setTimeout(() => janelaMarcar(ag, { cliente: c }));
  }
  mostrar(
    cabecalho(veTodas() ? "Agenda" : "Minha agenda", subtitulo),
    barra,
    !ag.caixaAberto && (v === "dia" || v === "semana") ? el("p", { class: "info", text: ehCaixa() ? "O caixa de hoje ainda não foi aberto: abra o caixa para cobrar os atendimentos." : "O caixa de hoje ainda não foi aberto: para finalizar atendimentos, peça para abrir o caixa." }) : null,
    corpo);
}

// Calendário do mês: cada dia com a cor da ocupação e quantos horários livres.
// Ano: 12 mini calendários coloridos; toque abre o mês.
function calendarioAno(oc, ano, irPara) {
  const porData = Object.fromEntries(oc.dias.map(d => [d.data, d]));
  return el("div", { class: "ano-grade" }, MESES.map((nome, i) => {
    const ym = `${ano}-${String(i + 1).padStart(2, "0")}`;
    const pts = [];
    for (let k = 0; k < diaDaSemana(`${ym}-01`); k++) pts.push(el("span", { class: "pt nada" }));
    const ultimo = Number(ultimoDiaMes(ym).slice(8));
    let cheios = 0;
    for (let n = 1; n <= ultimo; n++) {
      const d = porData[`${ym}-${String(n).padStart(2, "0")}`];
      if (d?.status === "cheio") cheios++;
      pts.push(el("span", { class: `pt ${d?.status || "fechado"} ${d?.passado ? "passado" : ""}`, title: d ? `${n}/${i + 1}: ${NOME_STATUS[d.status]}` : null }));
    }
    return el("button", { type: "button", class: "mes-mini", "data-mes": ym, onclick: () => irPara(`${ym}-01`, "mes") },
      el("strong", { text: nome }), el("div", { class: "mini-cal" }, pts),
      cheios ? el("span", { class: "suave", text: `${cheios} dia(s) cheio(s)` }) : null);
  }));
}

// Horários e bloqueios de um profissional num dia, em ordem.
// ---------- AGENDA EM GRADE (17/11/2026): horas à esquerda, uma coluna por profissional ----------
// Cada linha da grade = 5 minutos. Posição dos blocos pela grade CSS (definida via CSSOM, sem style="" no HTML).
const MIN_LINHA = 5;
const iniciais = nome => nome.trim().split(/\s+/).slice(0, 2).map(x => x[0]).join("").toUpperCase();
const minDe = h => { const [a, b] = h.split(":").map(Number); return a * 60 + b; };
function posicionar(e, linha, linhas, coluna) {
  e.style.gridRow = `${linha} / span ${Math.max(1, linhas)}`;
  e.style.gridColumn = String(coluna);
  return e;
}
function gradeAgenda(ag, d, profs, disp) {
  const dispDe = id => disp?.profissionais.find(x => x.id === id);
  const doDia = ag.agendamentos.filter(a => a.data === d && profs.some(p => p.id === a.barbeiroId));
  const ativos = doDia.filter(a => a.situacao === "agendado" || a.situacao === "finalizado");
  const outros = doDia.filter(a => a.situacao === "faltou" || a.situacao === "cancelado");
  // Faixa de horas: do primeiro início ao último fim (expediente e horários marcados), em horas cheias; padrão 08–20.
  const marcas = [...profs.flatMap(p => { const j = dispDe(p.id)?.janela; return j ? [minDe(j.ini), minDe(j.fim)] : []; }),
    ...ativos.flatMap(a => [minDe(a.inicio), minDe(a.fim)])];
  let ini = marcas.length ? Math.min(...marcas) : 8 * 60, fim = marcas.length ? Math.max(...marcas) : 20 * 60;
  ini = Math.floor(ini / 60) * 60; fim = Math.min(24 * 60, Math.max(ini + 60, Math.ceil(fim / 60) * 60));
  const linhas = (fim - ini) / MIN_LINHA;
  const linha = t => (Math.max(ini, Math.min(fim, t)) - ini) / MIN_LINHA + 2;   // linha 1 = cabeçalho
  const grade = el("div", { class: "grade-agenda", "data-grade": d });
  grade.style.setProperty("--cols", String(profs.length));
  grade.style.setProperty("--linhas", String(linhas));
  const filhos = [el("div", { class: "grade-canto", text: "" })];
  for (let h = ini; h < fim; h += 60) filhos.push(posicionar(el("div", { class: "grade-hora", text: minParaHoraTela(h) }), linha(h), 60 / MIN_LINHA, 1));
  const hoje = d === ag.hoje;
  const colunas = [];
  profs.forEach((p, i) => {
    const col = i + 2;
    const x = dispDe(p.id);
    const meus = ativos.filter(a => a.barbeiroId === p.id);
    const livres = x?.livres || [];
    const cab = el("div", { class: "grade-cab", "data-prof": p.nome },
      el("span", { class: "grade-avatar", text: iniciais(p.nome) }),
      el("span", { class: "grade-cab-txt" },
        el("strong", { text: p.nome.split(" ")[0] }),
        el("small", { class: "grade-cab-info", text: x && x.situacao !== "aberto" ? { fechado: "Fechado", folga: "Folga", bloqueado: "Bloqueado", sem_funcionamento: "Sem funcionamento" }[x.situacao]
          : `${meus.length} marcado${meus.length === 1 ? "" : "s"}${disp && !disp.passado ? ` · ${livres.length} livre${livres.length === 1 ? "" : "s"}` : ""}` })));
    filhos.push(posicionar(cab, 1, 1, col));
    colunas.push({ el: cab, data: d, barbeiroId: p.id, nome: p.nome.split(" ")[0] });
    filhos.push(posicionar(el("div", { class: `grade-fundo ${i % 2 ? "par" : ""}` }), 2, linhas, col));
    // Fora do expediente, intervalo e bloqueios: faixas cinzas.
    const j = x?.janela;
    const faixas = !x || x.situacao !== "aberto" ? [[ini, fim, x ? ({ fechado: "Fechado", folga: "Folga", bloqueado: x.motivo || "Bloqueado", sem_funcionamento: "Sem funcionamento" }[x.situacao]) : ""]]
      : [[ini, minDe(j.ini), ""], [minDe(j.fim), fim, ""], ...x.ocupados.filter(o => o.tipo !== "horario").map(o => [minDe(o.ini), minDe(o.fim), o.texto])];
    for (const [a, b, txt] of faixas) if (b > a) filhos.push(posicionar(el("div", { class: "grade-fora", text: b - a >= 30 ? txt : "" }), linha(a), (Math.min(b, fim) - Math.max(a, ini)) / MIN_LINHA, col));
    // Horários livres: tocar marca já com o profissional e a hora.
    const inicios = livres.map(minDe);
    const fimsMarcados = meus.map(a => minDe(a.inicio));
    inicios.forEach((t, k) => {
      const prox = Math.min(t + 30, ...[inicios[k + 1], ...fimsMarcados.filter(s => s > t)].filter(v => v !== undefined));
      filhos.push(posicionar(el("button", { type: "button", class: "grade-livre", "data-livre-grade": `${p.nome}|${minParaHoraTela(t)}`, "aria-label": `Marcar ${minParaHoraTela(t)} com ${p.nome}`,
        "data-hora": minParaHoraTela(t), onclick: () => janelaMarcar(ag, { barbeiroId: p.id, hora: minParaHoraTela(t), data: d }) }, el("span", { class: "mais", text: "+" })), linha(t), (prox - t) / MIN_LINHA, col));
    });
    // Atendimentos: bloco do tamanho da duração; tocar abre a ficha com todas as opções.
    for (const a of meus) {
      const dur = minDe(a.fim) - minDe(a.inicio);
      const curto = dur < 30, medio = dur >= 30 && dur < 45;
      const hora = el("span", { class: "ev-hora", text: `${medio || curto ? a.inicio : `${a.inicio}–${a.fim}`}${a.situacao === "finalizado" ? " ✓" : ""}` });
      const cliente = el("strong", { class: "ev-cliente", text: a.cliente.nome });
      const card = posicionar(el("button", { type: "button", class: `grade-evento ${a.situacao} ${curto ? "curto" : medio ? "medio" : ""} ${gestao() && a.finalizacao?.valorAlterado ? "alterado" : ""}`, "data-evento": a.cliente.nome,
        title: `${a.inicio}–${a.fim} · ${a.cliente.nome} · ${a.servicos.map(s => s.nome).join(" + ")}`, "data-arrastavel": podeArrastar(a) ? "1" : null,
        onclick: ev => { if (ev.currentTarget.dataset.arrastou) return; janelaAtendimento(a, profs.length > 1); } },
        medio || curto ? el("span", { class: "ev-linha" }, hora, cliente) : [hora, cliente],
        curto ? null : el("span", { class: "ev-servico", text: a.servicos.map(s => s.nome).join(" + ") })), linha(minDe(a.inicio)), dur / MIN_LINHA, col);
      card._agendamento = a;
      filhos.push(card);
    }
  });
  // Linha de "agora" (hoje).
  if (hoje) {
    const agora = new Date(Date.now() - 3 * 3600 * 1000);
    const m = agora.getUTCHours() * 60 + agora.getUTCMinutes();
    if (m >= ini && m <= fim) { const l = posicionar(el("div", { class: "grade-agora", "aria-hidden": "true" }), linha(m), 1, 2); l.style.gridColumn = "2 / -1"; filhos.push(l); }
  }
  grade.append(...filhos);
  ativarArrastar(grade, { ini, colunas });
  return el("div", { class: "grade-envolve" },
    ativos.some(podeArrastar) ? el("p", { class: "suave dica-arrastar", text: "Para mudar um horário, segure o cartão e arraste (para outra hora ou outro barbeiro)." }) : null,
    el("div", { class: "grade-rolagem" }, grade),
    outros.length ? el("div", { class: "grade-outros" }, el("span", { class: "suave", text: "Faltas e cancelados:" }),
      outros.map(a => el("button", { type: "button", class: `chip-outro ${a.situacao}`, "data-mini": a.cliente.nome, onclick: () => janelaAtendimento(a, profs.length > 1) },
        `${a.inicio} ${a.cliente.nome} · ${NOME_SITUACAO[a.situacao]}`))) : null);
}
const minParaHoraTela = m => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

// ---------- ARRASTAR O CARTÃO PARA MUDAR HORÁRIO / PROFISSIONAL / DIA (17/11/2026) ----------
// Computador: segurar e arrastar. Celular: segurar ~0,4 s e arrastar. Ao soltar, confirma e usa "Remarcar".
// colunas: [{ el (cabeçalho), data, barbeiroId (null = mantém o do horário), nome }]
function ativarArrastar(grade, { ini, colunas }) {
  const PASSO = 5;
  let arr = null;
  const alturaLinha = () => parseFloat(getComputedStyle(grade).getPropertyValue("--altura")) || 8;
  const topoLinhas = () => Math.max(...colunas.map(c => c.el.getBoundingClientRect().bottom));
  const colunaEm = x => colunas.find(c => { const r = c.el.getBoundingClientRect(); return x >= r.left && x <= r.right; });
  const fmt = m => minParaHoraTela(Math.max(0, Math.min(24 * 60 - PASSO, m)));
  const fim = () => {
    if (!arr) return;
    clearTimeout(arr.timer);
    window.removeEventListener("pointermove", mover);
    window.removeEventListener("pointerup", soltar);
    window.removeEventListener("pointercancel", cancelar);
    arr.card.classList.remove("arrastando", "segurando");
    colunas.forEach(c => c.el.classList.remove("alvo"));
    arr = null;
  };
  const destino = ev => {
    const dy = ev.clientY - arr.y0;
    const topo = arr.cardTopo + dy;
    const minuto = ini + Math.round((topo - topoLinhas()) / alturaLinha()) * PASSO;
    const col = colunaEm(ev.clientX) || arr.colOrigem;
    return { minuto, col };
  };
  const iniciar = () => {
    arr.ativo = true;
    arr.card.classList.remove("segurando");
    arr.card.classList.add("arrastando");
    try { arr.card.setPointerCapture(arr.pid); } catch { /* sem captura */ }
    navigator.vibrate?.(15);
  };
  function mover(ev) {
    if (!arr) return;
    const dx = ev.clientX - arr.x0, dy = ev.clientY - arr.y0;
    if (!arr.ativo) {
      if (arr.toque) { if (Math.hypot(dx, dy) > 10) fim(); return; }   // no celular: mexeu antes de segurar = rolar a tela
      if (Math.hypot(dx, dy) < 5) return;
      iniciar();
    }
    ev.preventDefault();
    arr.card.style.transform = `translate(${dx}px, ${dy}px)`;
    const { minuto, col } = destino(ev);
    colunas.forEach(c => c.el.classList.toggle("alvo", c === col));
    arr.rotulo.textContent = `${fmt(minuto)}${col && col !== arr.colOrigem ? ` · ${col.nome}` : ""}`;
  }
  function soltar(ev) {
    if (!arr) return;
    if (!arr.ativo) { fim(); return; }
    const { minuto, col } = destino(ev);
    const a = arr.a, card = arr.card, horaAntes = arr.horaAntes;
    card.dataset.arrastou = "1";
    setTimeout(() => { delete card.dataset.arrastou; }, 400);
    fim();
    card.style.transform = "";
    arr = null;
    card.querySelector(".ev-hora").textContent = horaAntes;
    const hora = fmt(minuto);
    const data = col?.data || a.data;
    const barbeiroId = col?.barbeiroId || a.barbeiroId;
    if (hora === a.inicio && data === a.data && barbeiroId === a.barbeiroId) return;
    const nomeProf = barbeiroId !== a.barbeiroId ? (col?.nome || "") : null;
    abrirJanela("Mudar o horário?", el("p", { text: `${a.cliente.nome}: ${dataBR(a.data)} ${a.inicio} → ${dataBR(data)} ${hora}${nomeProf ? ` com ${nomeProf}` : ""}. O tempo do atendimento continua o mesmo.` }), {
      ok: "Mudar", aoConfirmar: async () => {
        const r = await api("/agenda/remarcar", { metodo: "POST", corpo: { id: a.id, data, hora, ...(barbeiroId !== a.barbeiroId ? { barbeiroId } : {}) } });
        avisar(r.mensagem || "Horário mudado.");
        telaAgenda();
      }
    });
  }
  function cancelar() { if (arr) { arr.card.style.transform = ""; arr.card.querySelector(".ev-hora").textContent = arr.horaAntes; } fim(); }
  grade.addEventListener("pointerdown", ev => {
    const card = ev.target.closest(".grade-evento[data-arrastavel]");
    if (!card || ev.button > 0) return;
    const a = card._agendamento;
    const r = card.getBoundingClientRect();
    arr = { card, a, pid: ev.pointerId, x0: ev.clientX, y0: ev.clientY, cardTopo: r.top, toque: ev.pointerType !== "mouse", ativo: false,
      colOrigem: colunas.find(c => c.data === a.data && (c.barbeiroId === null || c.barbeiroId === a.barbeiroId)),
      rotulo: card.querySelector(".ev-hora"), horaAntes: card.querySelector(".ev-hora").textContent };
    if (arr.toque) { card.classList.add("segurando"); arr.timer = setTimeout(() => arr && iniciar(), 400); }
    window.addEventListener("pointermove", mover, { passive: false });
    window.addEventListener("pointerup", soltar);
    window.addEventListener("pointercancel", cancelar);
  });
  // Segurar no celular não abre o menu do navegador.
  grade.addEventListener("contextmenu", ev => { if (ev.target.closest(".grade-evento[data-arrastavel]")) ev.preventDefault(); });
}
// Pode arrastar: agendado, de hoje em diante, e quem vê pode remarcar (barbeiro só o dele; caixa e gestão qualquer).
const podeArrastar = a => a.situacao === "agendado" && a.data >= hojeLocal() && (veTodas() || a.barbeiroId === usuario.id);

// ---------- SEMANA EM GRADE (17/11/2026): horas à esquerda, um dia por coluna; atendimentos lado a lado quando se cruzam ----------
const CORES_PROF = 6;
function gradeSemana(ag, d0, profs, disps, oc) {
  const dias = [0, 1, 2, 3, 4, 5, 6].map(i => somaDias(d0, i));
  const corDe = Object.fromEntries(profs.map((p, i) => [p.id, i % CORES_PROF]));
  const varios = profs.length > 1;
  const evs = ag.agendamentos.filter(a => (a.situacao === "agendado" || a.situacao === "finalizado") && profs.some(p => p.id === a.barbeiroId));
  // Faixa de horas: expedientes da semana e atendimentos.
  const janelas = dias.flatMap(d => (disps[d]?.profissionais || []).filter(x => x.janela).map(x => [minDe(x.janela.ini), minDe(x.janela.fim)]));
  const marcas = [...janelas.flat(), ...evs.flatMap(a => [minDe(a.inicio), minDe(a.fim)])];
  let ini = marcas.length ? Math.min(...marcas) : 8 * 60, fim = marcas.length ? Math.max(...marcas) : 20 * 60;
  ini = Math.floor(ini / 60) * 60; fim = Math.min(24 * 60, Math.max(ini + 60, Math.ceil(fim / 60) * 60));
  const linhas = (fim - ini) / MIN_LINHA;
  const linha = t => (Math.max(ini, Math.min(fim, t)) - ini) / MIN_LINHA + 2;
  // Faixas (lanes) por dia: atendimentos que se cruzam ficam lado a lado.
  const faixasDia = {};
  for (const d of dias) {
    const doDia = evs.filter(a => a.data === d).sort((x, y) => x.inicio.localeCompare(y.inicio));
    const fins = [];
    for (const a of doDia) {
      let k = fins.findIndex(f => f <= minDe(a.inicio));
      if (k < 0) { k = fins.length; fins.push(0); }
      fins[k] = minDe(a.fim);
      a._faixa = k;
    }
    faixasDia[d] = { lista: doDia, n: Math.max(1, fins.length) };
  }
  let col = 2;
  const colDia = {};
  for (const d of dias) { colDia[d] = col; col += faixasDia[d].n; }
  const grade = el("div", { class: "grade-agenda grade-semana", "data-grade-semana": d0 });
  grade.style.setProperty("--linhas", String(linhas));
  grade.style.gridTemplateColumns = `var(--col-horas) ${dias.map(d => { const n = faixasDia[d].n; return `repeat(${n}, minmax(calc(var(--col-dia) / ${n}), ${(1 / n).toFixed(4)}fr))`; }).join(" ")}`;
  const filhos = [el("div", { class: "grade-canto" })];
  for (let h = ini; h < fim; h += 60) filhos.push(posicionar(el("div", { class: "grade-hora", text: minParaHoraTela(h) }), linha(h), 60 / MIN_LINHA, 1));
  const colunas = [];
  const filtroProf = estadoAgenda.barbeiroId || (!veTodas() ? usuario.id : null);
  for (const d of dias) {
    const c0 = colDia[d], n = faixasDia[d].n;
    const o = oc?.dias.find(x => x.data === d);
    const ds = disps[d]?.profissionais || [];
    const abertos = ds.filter(x => x.janela);
    const marcados = faixasDia[d].lista.length;
    const cab = el("button", { type: "button", class: `grade-cab grade-cab-dia ${d === ag.hoje ? "hoje" : ""}`, "data-dia-grade": d, onclick: () => { estadoAgenda.data = d; estadoAgenda.visao = "dia"; comCarga(telaAgenda); } },
      el("span", { class: "dia-nome", text: DIAS_CURTO[diaDaSemana(d)] }),
      el("span", { class: "dia-num", text: d.slice(8) }),
      !abertos.length ? el("small", { text: "fechado" })
        : el("small", {}, `${marcados} marc.`, o && !o.passado ? el("span", { class: "so-largo", text: ` · ${o.livres} livres` }) : null));
    const cabPos = posicionar(cab, 1, 1, c0);
    cabPos.style.gridColumn = `${c0} / span ${n}`;
    filhos.push(cabPos);
    colunas.push({ el: cab, data: d, barbeiroId: null, nome: `${DIAS_CURTO[diaDaSemana(d)]} ${d.slice(8)}` });
    const fundo = posicionar(el("div", { class: `grade-fundo ${d === ag.hoje ? "hoje" : ""}` }), 2, linhas, c0);
    fundo.style.gridColumn = `${c0} / span ${n}`;
    filhos.push(fundo);
    // Fora do expediente (de todos os profissionais mostrados) e dia fechado.
    const faixa = (a, b, txt) => { if (b > a) { const f = posicionar(el("div", { class: "grade-fora", text: b - a >= 60 ? txt : "" }), linha(a), (Math.min(b, fim) - Math.max(a, ini)) / MIN_LINHA, c0); f.style.gridColumn = `${c0} / span ${n}`; filhos.push(f); } };
    if (!abertos.length) faixa(ini, fim, disps[d] ? "Fechado" : "");
    else {
      const jIni = Math.min(...abertos.map(x => minDe(x.janela.ini))), jFim = Math.max(...abertos.map(x => minDe(x.janela.fim)));
      faixa(ini, jIni, ""); faixa(jFim, fim, "");
    }
    // Toque no espaço livre do dia: marcar (de meia em meia hora, dentro do expediente, de hoje em diante).
    if (abertos.length && d >= ag.hoje) {
      const jIni = Math.min(...abertos.map(x => minDe(x.janela.ini))), jFim = Math.max(...abertos.map(x => minDe(x.janela.fim)));
      for (let t = jIni; t < jFim; t += 30) {
        const b = posicionar(el("button", { type: "button", class: "grade-livre", "data-hora": minParaHoraTela(t), "aria-label": `Marcar ${dataBR(d)} ${minParaHoraTela(t)}`,
          onclick: () => janelaMarcar(ag, { data: d, hora: minParaHoraTela(t), ...(filtroProf ? { barbeiroId: filtroProf } : {}) }) }, el("span", { class: "mais", text: "+" })), linha(t), 30 / MIN_LINHA, c0);
        b.style.gridColumn = `${c0} / span ${n}`;
        filhos.push(b);
      }
    }
    for (const a of faixasDia[d].lista) {
      const dur = minDe(a.fim) - minDe(a.inicio);
      const card = posicionar(el("button", { type: "button", class: `grade-evento ${a.situacao} cor-${corDe[a.barbeiroId]} ${dur < 30 ? "curto" : dur < 45 ? "medio" : ""}`, "data-evento": a.cliente.nome,
        title: `${a.inicio}–${a.fim} · ${a.cliente.nome} · ${a.barbeiroNome || ""} · ${a.servicos.map(s => s.nome).join(" + ")}`,
        "data-arrastavel": podeArrastar(a) ? "1" : null,
        onclick: ev => { if (ev.currentTarget.dataset.arrastou) return; janelaAtendimento(a, varios); } },
        el("span", { class: "ev-linha" }, el("span", { class: "ev-hora", text: `${a.inicio}${a.situacao === "finalizado" ? " ✓" : ""}` }), varios ? el("span", { class: "ev-prof", text: iniciais(a.barbeiroNome || "") }) : null),
        dur >= 30 ? el("strong", { class: "ev-cliente", text: a.cliente.nome }) : null,
        dur >= 60 ? el("span", { class: "ev-servico", text: a.servicos.map(s => s.nome).join(" + ") }) : null), linha(minDe(a.inicio)), dur / MIN_LINHA, c0 + a._faixa);
      card._agendamento = a;
      filhos.push(card);
    }
  }
  if (dias.includes(ag.hoje)) {
    const agora = new Date(Date.now() - 3 * 3600 * 1000);
    const m = agora.getUTCHours() * 60 + agora.getUTCMinutes();
    if (m >= ini && m <= fim) { const l = posicionar(el("div", { class: "grade-agora", "aria-hidden": "true" }), linha(m), 1, colDia[ag.hoje]); l.style.gridColumn = `${colDia[ag.hoje]} / span ${faixasDia[ag.hoje].n}`; filhos.push(l); }
  }
  grade.append(...filhos);
  ativarArrastar(grade, { ini, colunas });
  const legenda = varios ? el("div", { class: "grade-legenda" }, profs.map(p => el("span", { class: `leg-prof cor-${corDe[p.id]}` }, el("i"), p.nome.split(" ")[0]))) : null;
  return el("div", { class: "grade-envolve" },
    legenda,
    el("p", { class: "suave dica-arrastar", text: "Toque no dia para abrir o Dia. Para mudar um horário, segure o cartão e arraste." }),
    el("div", { class: "grade-rolagem" }, grade));
}

// ---------- MÊS (17/11/2026): calendário com ocupação e os atendimentos de cada dia ----------
function calendarioMesNovo(oc, ag, ym, irPara, profs) {
  const porData = Object.fromEntries(oc.dias.map(d => [d.data, d]));
  const corDe = Object.fromEntries(profs.map((p, i) => [p.id, i % CORES_PROF]));
  const primeiro = `${ym}-01`;
  const vazios = diaDaSemana(primeiro);
  const ultimo = Number(ultimoDiaMes(ym).slice(8));
  const hoje = hojeLocal();
  const evsDia = d => ag.agendamentos.filter(a => a.data === d && (a.situacao === "agendado" || a.situacao === "finalizado")).sort((x, y) => x.inicio.localeCompare(y.inicio));
  const celulas = [];
  for (let i = 0; i < vazios; i++) celulas.push(el("span", { class: "mes-dia vazio-cal", "aria-hidden": "true" }));
  let totalMarc = 0, totalLivres = 0, cheios = 0;
  for (let n = 1; n <= ultimo; n++) {
    const data = `${ym}-${String(n).padStart(2, "0")}`;
    const d = porData[data] || { status: "fechado", livres: 0, agendados: 0 };
    const evs = evsDia(data);
    totalMarc += evs.length; if (!d.passado) totalLivres += d.livres || 0; if (d.status === "cheio" && !d.passado) cheios++;
    const ocup = evs.length + (d.passado ? 0 : d.livres || 0);
    const pctOcup = ocup ? Math.round((evs.length / ocup) * 100) : 0;
    const barra = el("progress", { class: `ocupacao ${d.status}`, max: "100", value: String(d.status === "fechado" ? 0 : pctOcup), "aria-label": `Ocupação ${pctOcup}%` });
    celulas.push(el("button", {
      type: "button", class: `mes-dia dia-cal ${d.status} ${d.passado ? "passado" : ""} ${data === hoje ? "hoje" : ""}`,
      "data-dia": data, "data-status": d.status, "aria-label": `${dataBR(data)}: ${evs.length} marcado(s)${d.status === "fechado" ? ", fechado" : `, ${d.livres || 0} livre(s)`}`,
      onclick: () => irPara(data, "dia")
    },
      el("span", { class: "mes-topo" }, el("span", { class: "num", text: String(n) }),
        d.status === "fechado" ? el("span", { class: "mes-tag", text: "fechado" }) : evs.length ? el("span", { class: "mes-qtd", text: String(evs.length) }) : null),
      d.status === "fechado" ? null : barra,
      el("span", { class: "mes-evs" }, evs.slice(0, 3).map(a => el("span", { class: `mes-ev cor-${corDe[a.barbeiroId] ?? 0} ${a.situacao}` }, el("i"), `${a.inicio} ${a.cliente.nome.split(" ")[0]}`)),
        evs.length > 3 ? el("span", { class: "mes-mais", text: `+${evs.length - 3} mais` }) : null),
      d.status !== "fechado" && !d.passado ? el("span", { class: "mes-livres", text: d.livres ? `${d.livres} livres` : "cheio" }) : null));
  }
  const resumo = el("div", { class: "mes-resumo" },
    el("div", {}, el("strong", { text: String(totalMarc) }), el("span", { text: "marcados no mês" })),
    el("div", {}, el("strong", { text: String(totalLivres) }), el("span", { text: "horários livres (de hoje em diante)" })),
    el("div", {}, el("strong", { text: String(cheios) }), el("span", { text: "dias cheios" })));
  return el("div", { class: "mes-novo" }, resumo,
    el("div", { class: "calendario mes-calendario" }, DIAS_CURTO.map(x => el("span", { class: "cal-semana", text: x })), celulas));
}

// Grade (horas × colunas) ou Lista: vale para Dia e Semana; a escolha fica guardada no aparelho.
function alternaModoAgenda() {
  return el("div", { class: "alterna modo-dia", role: "group", "aria-label": "Jeito de ver a agenda" },
    [["grade", "Grade"], ["lista", "Lista"]].map(([k, t]) => botao(t, () => {
      estadoAgenda.modoDia = k; try { localStorage.setItem("4blade.agendaModo", k); } catch { /* sem espaço */ }
      comCarga(telaAgenda);
    }, `pequeno ${estadoAgenda.modoDia === k ? "ativo" : ""}`)));
}

function itensDoDia(ag, data, profId, mostrarNome = false, livres = null) {
  const lista = [
    // Horários livres na própria lista (pedido de 17/11/2026): tocar marca já com profissional, dia e hora.
    ...(livres || []).map(h => ({ ordem: h, el: el("button", { type: "button", class: "slot slot-livre", "data-livre-lista": h,
      "aria-label": `Marcar às ${h}`, onclick: () => janelaMarcar(ag, { barbeiroId: profId, hora: h, data }) },
      el("strong", { class: "slot-hora", text: h }), el("span", { text: "Livre" }), el("span", { class: "marcar-aqui", text: "+ Marcar" })) })),
    ...ag.agendamentos.filter(a => a.data === data && a.barbeiroId === profId).map(a => ({ ordem: a.inicio, el: cartaoAgendamento(a, mostrarNome, { recolhivel: true }) })),
    ...ag.bloqueios.filter(b => b.barbeiroId === profId && b.inicio.slice(0, 10) <= data && b.fim.slice(0, 10) >= data).map(b => {
      const ini = b.inicio.slice(0, 10) === data ? b.inicio.slice(11) : "00:00";
      const fim = b.fim.slice(0, 10) === data ? b.fim.slice(11) : "23:59";
      return { ordem: ini, el: cartaoBloqueio(b, ini, fim, mostrarNome) };
    })
  ];
  return lista.sort((x, y) => x.ordem.localeCompare(y.ordem)).map(x => x.el);
}

function cartaoBloqueio(b, ini, fim, mostrarNome) {
  return el("article", { class: "slot bloqueio", "data-bloqueio": b.motivo || "Bloqueado" },
    el("div", { class: "slot-topo" },
      el("strong", { class: "slot-hora", text: ini === "00:00" && fim === "23:59" ? "Dia todo" : `${ini}–${fim}` }),
      el("span", { class: "etiqueta", text: "Bloqueado" })),
    el("p", { class: "suave", text: [mostrarNome ? b.barbeiroNome : null, b.motivo || "Sem motivo informado"].filter(Boolean).join(" · ") }),
    el("div", { class: "item-acoes" },
      ehCaixa() ? null : botao("Desbloquear", () => pedirMotivo("Desbloquear horário", "O horário volta a ficar livre na agenda.", async motivo => {
        await api("/agenda/bloqueios/cancelar", { metodo: "POST", corpo: { id: b.id, motivo } });
        avisar("Horário desbloqueado.");
        telaAgenda();
      }, "Desbloquear"), "pequeno")));
}

// Abre o WhatsApp (link wa.me) e registra o envio (quem, quando, qual modelo).
// Mensagem pronta (tela Mensagens) direto no WhatsApp: com o número do cadastro ou, sem telefone, escolhendo o contato.
function linkWhatsappCliente(a, texto) {
  const msg = texto.replace(/\{cliente\}/g, a.cliente.nome.split(" ")[0]).replace(/\{barbearia\}/g, usuario?.barbearia?.nome || "");
  return a.cliente.telefone ? `https://wa.me/55${a.cliente.telefone}?text=${encodeURIComponent(msg)}` : `https://wa.me/?text=${encodeURIComponent(msg)}`;
}
function janelaOutraMensagem(a) {
  return abrirJanela(`Mensagem para ${a.cliente.nome}`, [
    el("p", { class: "suave", text: a.cliente.telefone
      ? `Toque na mensagem: o WhatsApp abre na conversa de ${fone(a.cliente.telefone)}, com o texto pronto.`
      : "Cliente sem telefone: toque na mensagem e escolha no WhatsApp para quem enviar." }),
    el("div", { class: "chips-modelo lista-outras" }, Object.entries(MENSAGENS_PRONTAS).map(([v, [t, texto]]) =>
      el("a", { class: "chip-modelo", href: linkWhatsappCliente(a, texto), target: "_blank", rel: "noopener", "data-pronta": v, text: t })))
  ], { ok: "Fechar", semCancelar: true, aoConfirmar: () => true });
}
function botaoWhatsapp(a, tipo, rotulo) {
  if (!a.whatsapp) return null;   // sem link (ex.: horário sem mensagens)
  return el("a", {
    class: "botao pequeno whats", href: a.whatsapp[tipo], target: "_blank", rel: "noopener", "data-whats": tipo,
    onclick: () => {
      const token = localStorage.getItem(CHAVE_TOKEN);
      fetch("/api/agenda/mensagem", {
        method: "POST", keepalive: true,
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ id: a.id, tipo })
      }).then(r => { if (r.ok) setTimeout(() => location.hash.startsWith("#/agenda") && telaAgenda(), 400); }).catch(() => {});
    }
  }, rotulo);
}

// Horários abertos (expandidos) na agenda: continuam abertos quando a tela é montada de novo.
const cartoesAbertos = new Set();
// recolhivel: na agenda o cartão fica compacto (hora, situação, cliente e serviço); tocar abre as informações e as ações.
function cartaoAgendamento(a, mostrarNome, { recolhivel = false } = {}) {
  const f = a.finalizacao;
  const destaque = gestao() && f?.valorAlterado;
  const ultimaMsg = a.mensagens.at(-1);
  const aberto = !recolhivel || cartoesAbertos.has(a.id);
  const resumo = [
    el("div", { class: "slot-topo" },
      el("strong", { class: "slot-hora", text: `${a.inicio}–${a.fim}` }),
      el("span", { class: `etiqueta ${COR_SITUACAO[a.situacao]}`, text: NOME_SITUACAO[a.situacao] }),
      a.serie ? el("span", { class: "etiqueta fixo", text: a.serie.intervaloSemanas === 1 ? "Fixo semanal" : `Fixo a cada ${a.serie.intervaloSemanas} sem.` }) : null,
      destaque ? el("span", { class: "etiqueta laranja", text: "Valor alterado" }) : null,
      recolhivel ? el("span", { class: "slot-seta", "aria-hidden": "true" }) : null),
    el("p", { class: "slot-cliente" }, el("strong", { text: a.cliente.nome }), a.cliente.telefone ? ` · ${fone(a.cliente.telefone)}` : " · sem telefone", " ", seloCliente(a.cliente)),
    el("p", { class: "suave", text: [mostrarNome ? a.barbeiroNome : null, a.servicos.map(s => s.nome).join(" + ")].filter(Boolean).join(" · ") })
  ];
  const detalhes = el("div", { class: "slot-detalhes", hidden: aberto ? null : true },
    a.observacao ? el("p", { class: "suave", text: `Obs.: ${a.observacao}` }) : null,
    a.motivo ? el("p", { class: "suave", text: `Motivo: ${a.motivo}` }) : null,
    f ? el("div", { class: "slot-final" },
      el("p", {}, el("strong", { text: `Total ${reais(f.totalCentavos)}` }), ` · ${f.pagamentos.map(p => `${NOME_FORMA[p.forma]} ${reais(p.valorCentavos)}`).join(" + ") || "sem pagamento"}`),
      destaque ? el("ul", { class: "alteracoes" },
        f.itens.filter(i => i.cobradoCentavos !== i.tabelaCentavos).map(i => el("li", { text: `${i.nome}: tabela ${reais(i.tabelaCentavos)} → cobrado ${reais(i.cobradoCentavos)}` })),
        f.totalAnteriorCentavos !== null && f.totalAnteriorCentavos !== f.totalCentavos
          ? el("li", { text: `Reaberto: total anterior ${reais(f.totalAnteriorCentavos)} → agora ${reais(f.totalCentavos)}` }) : null) : null,
      f.comissaoCentavos !== undefined
        ? el("p", { class: "suave", "data-teste": "comissao", text: `${a.barbeiroId === usuario.id ? "Sua comissão" : "Comissão"}: ${reais(f.comissaoCentavos)} (${pct(f.comissaoBp)})` }) : null) : null,
    gestao() && a.reaberturas ? el("p", { class: "suave", text: `Reaberto ${a.reaberturas}x` }) : null,
    a.situacao === "agendado" && a.whatsapp && a.whatsappComNumero === false
      ? el("p", { class: "suave", "data-teste": "whats-sem-numero", text: "Sem telefone no cadastro: os botões do WhatsApp abrem para você escolher o contato." }) : null,
    ultimaMsg ? el("p", { class: "suave", text: `${{ lembrete: "Lembrete aberto", proposta: "Proposta aberta", confirmacao: "Confirmação aberta" }[ultimaMsg.tipo] || "Mensagem aberta"} no WhatsApp por ${ultimaMsg.por.split(" ")[0]} às ${horaLocal(ultimaMsg.em)}` }) : null,
    el("div", { class: "item-acoes" },
      a.situacao === "agendado" ? [
        ehCaixa() ? null : botao("Finalizar", () => janelaFinalizar(a), "pequeno principal"),
        botao("Remarcar", () => janelaRemarcar(a, ultimaAgenda), "pequeno"),
        botaoWhatsapp(a, "confirmacao", "Confirmar horário"),
        botaoWhatsapp(a, "lembrete", "Enviar lembrete"),
        botaoWhatsapp(a, "proposta", "Propor horário"),
        a.whatsapp ? botao("Outra mensagem", () => janelaOutraMensagem(a), "pequeno whats") : null,
        botao("Faltou", () => abrirJanela(`${a.cliente.nome} faltou?`, el("p", { text: "O horário fica registrado como falta." }), {
          ok: "Registrar falta", aoConfirmar: async () => {
            await api("/agenda/situacao", { metodo: "POST", corpo: { id: a.id, situacao: "faltou" } });
            avisar("Falta registrada."); telaAgenda();
          }
        }), "pequeno"),
        botao("Cancelar", () => abrirJanela(`Cancelar horário de ${a.cliente.nome}`, [
          el("p", { text: "O horário fica livre. Nada é apagado." }),
          campo("Motivo", { name: "motivo", required: true, minlength: "3", maxlength: "300", autocomplete: "off" }),
          a.serie ? caixaMarcar("Cancelar também os próximos deste horário fixo (encerra a repetição)", { name: "serie" }) : null
        ], {
          ok: "Cancelar horário", perigo: true,
          aoConfirmar: async f => {
            const r = await api("/agenda/situacao", { metodo: "POST", corpo: { id: a.id, situacao: "cancelado", motivo: f.motivo.value.trim(), ...(f.serie?.checked ? { serie: true } : {}) } });
            avisar(r.mensagem || "Horário cancelado."); telaAgenda();
          }
        }), "pequeno perigo"),
        botao("Editar", () => janelaEditarHorario(a), "pequeno")
      ] : null,
      a.situacao === "faltou" || a.situacao === "cancelado"
        ? botao(a.situacao === "faltou" ? "Desfazer falta" : "Desfazer cancelamento", () => abrirJanela(a.situacao === "faltou" ? "Desfazer a falta?" : "Desfazer o cancelamento?",
          el("p", { text: "O horário volta para agendado (se ninguém ocupou o lugar). Fica registrado." }), {
            ok: "Voltar para agendado", aoConfirmar: async () => {
              const r = await api("/agenda/desfazer", { metodo: "POST", corpo: { id: a.id } });
              avisar(r.mensagem); telaAgenda();
            }
          }), "pequeno") : null,
      !ehCaixa() && (a.situacao === "finalizado" || a.situacao === "agendado")
        ? botao("Vender produto", () => janelaVenda({ agendamento: a, aoTerminar: telaAgenda }), "pequeno") : null,
      a.situacao === "finalizado" && !ehCaixa() ? botao("Reabrir", () => pedirMotivo("Reabrir atendimento", "Estorna a entrada no caixa e a comissão, e o horário volta para agendado. Fica registrado.", async motivo => {
        await api("/agenda/reabrir", { metodo: "POST", corpo: { id: a.id, motivo } });
        avisar("Atendimento reaberto."); telaAgenda();
      }, "Reabrir"), "pequeno") : null,
      a.situacao === "cancelado" || a.situacao === "faltou" ? botaoWhatsapp(a, "proposta", "Propor horário") : null,
      // Lixeira (canto de baixo, à direita): tira o horário da agenda (fica registrado). Finalizado: só reabrindo antes.
      a.situacao !== "finalizado" ? el("button", { type: "button", class: "botao-lixeira", "aria-label": "Excluir horário", title: "Excluir horário", "data-excluir": a.cliente.nome,
        onclick: () => pedirMotivo("Excluir horário", `O horário de ${a.cliente.nome} (${dataBR(a.data)} ${a.inicio}) sai da agenda. Fica registrado quem excluiu e o motivo.`, async motivo => {
          const r = await api("/agenda/excluir", { metodo: "POST", corpo: { id: a.id, motivo } });
          cartoesAbertos.delete(a.id);
          avisar(r.mensagem); telaAgenda();
        }, "Excluir") }, icone("lixeira")) : null));
  const cartao = el("article", { class: `slot ${a.situacao} ${destaque ? "destaque" : ""} ${recolhivel ? "recolhivel" : ""} ${recolhivel && aberto ? "aberto" : ""}`, "data-agendamento": a.cliente.nome });
  if (!recolhivel) { cartao.append(...resumo.filter(Boolean), detalhes); return cartao; }
  const cabeca = el("div", { class: "slot-resumo", role: "button", tabindex: "0", "aria-expanded": String(aberto), "data-resumo": a.cliente.nome,
    title: "Toque para ver as opções" }, ...resumo);
  const alternar = () => {
    const abrir = detalhes.hidden;
    detalhes.hidden = !abrir;
    cartao.classList.toggle("aberto", abrir);
    cabeca.setAttribute("aria-expanded", String(abrir));
    if (abrir) cartoesAbertos.add(a.id); else cartoesAbertos.delete(a.id);
  };
  cabeca.addEventListener("click", alternar);
  cabeca.addEventListener("keydown", ev => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); alternar(); } });
  cartao.append(cabeca, detalhes);
  return cartao;
}

// Editar horário lançado errado: serviços (o fim acompanha a duração), cliente e observação. Dia/hora/profissional: Remarcar.
async function janelaEditarHorario(a) {
  const servicos = servicosCache || await carregarServicos();
  const atuais = new Set(a.servicos.map(x => x.id));
  const novoCli = el("div", { class: "cliente-avulso" },
    el("p", { class: "separador-ou", text: "ou outro cliente (não cadastrado)" }),
    campo("Nome do cliente", { name: "eNome", autocomplete: "off" }),
    campo("Telefone (WhatsApp) — opcional", { name: "eTel", inputmode: "tel", autocomplete: "off" }),
    Object.assign(caixaMarcar("O cliente aceita que o telefone seja usado para o atendimento (LGPD)", { name: "eLgpd" }), { hidden: true }));
  const seletor = seletorCliente({ id: "ed-cli", aoMudar: c => { novoCli.hidden = Boolean(c); } });
  const promessa = abrirJanela(`Editar horário · ${a.inicio}`, [
    el("p", { class: "suave", text: "Corrija o que foi lançado errado. Para mudar dia, hora ou profissional, use Remarcar." }),
    el("fieldset", { class: "servicos-escolha" }, el("legend", { text: "Serviços" }),
      servicos.map(sv => caixaMarcar(`${sv.nome} · ${reais(sv.precoCentavos)} · ${sv.duracaoMin} min`, { name: "eserv", value: sv.id, id: `eserv-${sv.id}`, checked: atuais.has(sv.id) || null }))),
    el("fieldset", { class: "servicos-escolha bloco-cliente" }, el("legend", { text: `Cliente: ${a.cliente.nome} (trocar só se estiver errado)` }), seletor.el, novoCli),
    campo("Observação (opcional)", { name: "eObs", maxlength: "300", autocomplete: "off", value: a.observacao || "" })
  ], {
    ok: "Salvar",
    aoConfirmar: async f => {
      const servicoIds = [...f.querySelectorAll("input[name=eserv]:checked")].map(i => i.value);
      if (!servicoIds.length) throw new Error("Marque pelo menos um serviço.");
      const esc = seletor.escolhido();
      const cliente = esc ? { id: esc.id }
        : (f.eNome.value.trim() || f.eTel.value.trim()) ? { nome: f.eNome.value.trim() || undefined, telefone: f.eTel.value, aceiteLgpd: f.eLgpd.checked } : undefined;
      const r = await comAceiteNota(extra => api("/agenda/editar", { metodo: "POST", corpo: { ...extra, id: a.id, servicoIds, observacao: f.eObs.value, ...(cliente ? { cliente } : {}) } }));
      avisar(`${r.mensagem} Termina às ${r.fim}.`);
      telaAgenda();
    }
  });
  const f = janela.querySelector("form");
  f.addEventListener("input", () => { f.eLgpd.closest(".marcar").hidden = !f.eTel.value.replace(/\D/g, ""); });
  return promessa;
}

// Ficha do atendimento (a partir da lista pequena da semana): tudo o que está registrado + as mesmas ações do cartão.
function janelaAtendimento(a, mostrarNome = true) {
  return abrirJanela(`${dataLonga(a.data)} · ${a.inicio}–${a.fim}`, [cartaoAgendamento(a, mostrarNome)], { ok: "Fechar", semCancelar: true, aoConfirmar: () => true });
}

function campoProfissional(ag, escolhido = null) {
  if (!veTodas()) return null;
  const padrao = escolhido || estadoAgenda.barbeiroId || (ag.profissionais.some(p => p.id === usuario.id) ? usuario.id : ag.profissionais[0]?.id);
  return campo("Profissional", { tag: "select", name: "prof", valor: padrao, opcoes: ag.profissionais.map(p => [p.id, p.nome]) });
}

// Escolher cliente: da base (busca por nome ou telefone) ou digitar um cliente novo/avulso.
// nomes = nomes dos campos do cliente novo (a agenda usa cli*, o caixa a*). Devolve { el, ler(), escolhido() }.
function seletorCliente({ id, preSelecionado = null, aoMudar = () => {} }) {
  let escolhido = preSelecionado;
  const resultados = el("ul", { class: "resultados-cliente", "data-teste": `${id}-resultados` });
  const busca = el("input", { type: "search", id: `${id}-busca`, autocomplete: "off", placeholder: "Digite o nome ou o telefone", "aria-label": "Buscar cliente cadastrado" });
  const blocoBusca = el("div", { class: "campo" }, el("label", { for: `${id}-busca`, text: "Cliente cadastrado" }), busca, resultados);
  const escolhidoEl = el("div", { class: "cliente-escolhido", "data-teste": `${id}-escolhido` });
  let temporizador;
  const desenhar = () => {
    blocoBusca.hidden = Boolean(escolhido);
    escolhidoEl.hidden = !escolhido;
    if (escolhido) {
      escolhidoEl.replaceChildren(
        el("span", { class: "conta-avatar pequeno", text: escolhido.nome.trim().charAt(0).toUpperCase() }),
        el("div", {}, el("strong", { text: escolhido.nome }), el("span", { class: "suave", text: escolhido.telefone ? fone(escolhido.telefone) : "sem telefone" }), avisoCliente(escolhido)),
        botao("Trocar", () => { escolhido = null; busca.value = ""; resultados.replaceChildren(); desenhar(); busca.focus(); }, "pequeno"));
    }
    aoMudar(escolhido);
  };
  busca.addEventListener("input", () => {
    clearTimeout(temporizador);
    const termo = busca.value.trim();
    if (termo.length < 2) { resultados.replaceChildren(); return; }
    temporizador = setTimeout(async () => {
      try {
        const { clientes } = await api(`/agenda/clientes?busca=${encodeURIComponent(termo)}`);
        resultados.replaceChildren(...(clientes.length ? clientes.map(c => el("li", {},
          el("button", { type: "button", class: "resultado-cliente", "data-cliente-opcao": c.nome, onclick: () => { escolhido = c; desenhar(); } },
            el("strong", { text: c.nome }), el("span", { class: "suave", text: c.telefone ? fone(c.telefone) : "sem telefone" }), seloCliente(c))))
          : [el("li", { class: "suave sem-resultado", text: "Nenhum cliente com esse nome ou telefone. Preencha abaixo como cliente novo." })]));
      } catch (e) { resultados.replaceChildren(el("li", { class: "erro", text: e.message })); }
    }, 250);
  });
  desenhar();
  return { el: el("div", { class: "seletor-cliente" }, blocoBusca, escolhidoEl), escolhido: () => escolhido };
}

// Painel de disponibilidade do dia: situação do profissional, ocupados e horários livres (tocar preenche a hora).
function painelDisponibilidade() {
  const painel = el("div", { class: "disponibilidade", "data-teste": "disponibilidade", "aria-live": "polite" });
  let vez = 0;
  async function atualizar({ data, barbeiroId, duracao, hora, aoEscolher }) {
    const minha = ++vez;
    if (!data) { painel.replaceChildren(); return; }
    painel.replaceChildren(el("p", { class: "suave", text: "Conferindo a agenda do dia…" }));
    try {
      const q = new URLSearchParams({ data, ...(barbeiroId ? { barbeiroId } : {}), ...(duracao ? { duracao: String(duracao) } : {}) });
      const d = await api(`/agenda/disponibilidade?${q}`);
      if (minha !== vez) return;
      const p = d.profissionais[0];
      if (!p) { painel.replaceChildren(el("p", { class: "disp-aviso fechado", text: "Escolha o profissional." })); return; }
      const titulo = `${p.nome.split(" ")[0]} em ${DIAS[diaDaSemana(data)].toLowerCase()}, ${dataBR(data).slice(0, 5)}`;
      if (d.passado) { painel.replaceChildren(el("p", { class: "disp-aviso fechado", text: `${dataBR(data)} já passou.` })); return; }
      if (p.situacao !== "aberto") {
        const rotulo = { fechado: "Fechado", folga: "Folga", bloqueado: "Dia bloqueado", sem_funcionamento: "Sem funcionamento" }[p.situacao];
        painel.replaceChildren(el("p", { class: "disp-aviso fechado", "data-teste": "disp-situacao" }, el("strong", { text: `${rotulo}: ` }), p.motivo || ""));
        return;
      }
      const chips = p.livres.map(h => el("button", { type: "button", class: `chip-hora ${h === hora ? "ativo" : ""}`, "data-hora-livre": h, text: h,
        onclick: () => { aoEscolher(h); painel.querySelectorAll(".chip-hora").forEach(b => b.classList.toggle("ativo", b.dataset.horaLivre === h)); } }));
      painel.replaceChildren(...[
        el("div", { class: "disp-topo" },
          el("strong", { text: titulo }),
          el("span", { class: `etiqueta ${p.livres.length ? "verde" : "vermelha"}`, "data-teste": "disp-situacao", text: p.livres.length ? `${p.livres.length} horário(s) livre(s)` : "Agenda cheia" })),
        el("p", { class: "suave", text: `Atende das ${p.janela.ini} às ${p.janela.fim} · horários para ${d.duracao} min. Toque num horário livre:` }),
        p.livres.length ? el("div", { class: "chips-hora" }, chips) : el("p", { class: "disp-aviso cheio", text: "Nenhum horário livre para essa duração neste dia. Tente outro dia ou outro profissional." }),
        p.ocupados.length ? el("ul", { class: "disp-ocupados" }, p.ocupados.map(o => el("li", { class: `ocup-${o.tipo}` },
          el("span", { class: "hora", text: `${o.ini}–${o.fim}` }), el("span", { text: o.tipo === "horario" ? `Ocupado · ${o.texto}` : o.texto })))) : null
      ].filter(Boolean));
    } catch (e) { if (minha === vez) painel.replaceChildren(el("p", { class: "erro", text: e.message })); }
  }
  return { el: painel, atualizar };
}

function janelaMarcar(ag, pre = {}) {
  const servicos = servicosCache || [];
  // Sem profissional ou sem serviço não há como marcar: explica o que falta em vez de um formulário vazio.
  if (veTodas() && !ag.profissionais.length) return abrirJanela("Novo horário", el("p", { text: "Nenhum profissional com agenda. Cadastre um gerente ou barbeiro em Equipe e ajustes → Equipe." }), { ok: "Entendi", semCancelar: true, aoConfirmar: () => true });
  if (!servicos.length) return abrirJanela("Novo horário", el("p", { text: "Nenhum serviço cadastrado. Cadastre em Catálogo e estoque → Serviços (nome, preço e duração)." }), { ok: "Entendi", semCancelar: true, aoConfirmar: () => true });
  // Cliente: da base (busca) ou novo/avulso. Telefone é opcional: sem ele, o cliente fica só com o nome (sem WhatsApp).
  const nomeCampo = campo("Nome do cliente", { name: "cliNome", autocomplete: "off" });
  const lgpd = caixaMarcar("O cliente aceita que o telefone seja usado para o atendimento (LGPD)", { name: "cliLgpd" });
  const blocoNovo = el("div", { class: "cliente-novo" }, nomeCampo, lgpd);
  lgpd.hidden = true;
  const achado = el("p", { class: "cliente-achado", role: "status" });
  const tel = campo("Telefone do cliente (WhatsApp) — opcional", { name: "cliTel", inputmode: "tel", autocomplete: "off", placeholder: "(11) 91234-5678" },
    "Sem telefone, o cliente fica só com o nome. As mensagens abrem o WhatsApp para você escolher o contato.");
  const blocoAvulso = el("div", { class: "cliente-avulso" }, el("p", { class: "separador-ou", text: "ou cliente novo / avulso" }), tel, achado, blocoNovo);
  const seletor = seletorCliente({ id: "cli", preSelecionado: pre.cliente || null, aoMudar: c => { blocoAvulso.hidden = Boolean(c); } });
  const buscar = async () => {
    const v = tel.querySelector("input").value.replace(/\D/g, "");
    if (v.length < 10) { achado.textContent = ""; blocoNovo.hidden = false; lgpd.hidden = true; return; }
    try {
      const r = await api(`/agenda/cliente?telefone=${encodeURIComponent(v)}`);
      if (r.cliente) { achado.textContent = `Cliente: ${r.cliente.nome}`; achado.className = "cliente-achado ok"; blocoNovo.hidden = true; }
      else { achado.textContent = "Cliente novo: informe o nome."; achado.className = "cliente-achado novo"; blocoNovo.hidden = false; lgpd.hidden = false; }
    } catch (e) { achado.textContent = e.message; }
  };
  tel.querySelector("input").addEventListener("change", buscar);
  tel.querySelector("input").addEventListener("input", buscar);
  const disp = painelDisponibilidade();

  setTimeout(() => {
    const f = janela.querySelector("form");
    if (!f?.repetir) return;
    const atualizarRep = () => {
      const campoAte = f.repAte.closest(".campo");
      campoAte.hidden = !f.repetir.value;
      if (f.repetir.value && !f.repAte.value) f.repAte.value = somaDias(f.data.value || hojeLocal(), 56);
    };
    f.repetir.addEventListener("change", atualizarRep);
    if (pre.hora) f.hora.value = pre.hora;
    // Disponibilidade: muda com profissional, data e serviços escolhidos (a duração soma os serviços).
    const duracao = () => servicos.filter(sv => f.querySelector(`#serv-${sv.id}`)?.checked).reduce((t, sv) => t + sv.duracaoMin, 0);
    const recalcular = () => disp.atualizar({
      data: f.data.value, barbeiroId: f.prof?.value || null, duracao: duracao(), hora: f.hora.value,
      aoEscolher: h => { f.hora.value = h; }
    });
    f.data.addEventListener("change", recalcular);
    f.prof?.addEventListener("change", recalcular);
    f.querySelectorAll("input[name=serv]").forEach(c => c.addEventListener("change", recalcular));
    recalcular();
  });
  return abrirJanela("Novo horário", [
    campoProfissional(ag, pre.barbeiroId),
    el("div", { class: "lado-a-lado" },
      campo("Data", { name: "data", type: "date", value: pre.data || estadoAgenda.data, required: true }),
      campo("Hora", { name: "hora", type: "time", step: "300", required: true })),
    el("fieldset", { class: "servicos-escolha" }, el("legend", { text: "Serviços" }),
      servicos.map(s => caixaMarcar(`${s.nome} · ${reais(s.precoCentavos)} · ${s.duracaoMin} min`, { name: "serv", value: s.id, id: `serv-${s.id}` }))),
    disp.el,
    el("fieldset", { class: "servicos-escolha bloco-cliente" }, el("legend", { text: "Cliente" }), seletor.el, blocoAvulso),
    campo("Observação (opcional)", { name: "obs", maxlength: "300", autocomplete: "off" }),
    el("div", { class: "lado-a-lado" },
      campo("Repetir (horário fixo)", { tag: "select", name: "repetir", opcoes: [["", "Não repete"], ["1", "Toda semana"], ["2", "A cada 2 semanas"], ["3", "A cada 3 semanas"], ["4", "A cada 4 semanas"]] }),
      Object.assign(campo("Repetir até", { name: "repAte", type: "date" }), { hidden: true }))
  ], {
    ok: "Marcar",
    aoConfirmar: async f => {
      const servicoIds = [...f.querySelectorAll("input[name=serv]:checked")].map(i => i.value);
      if (!servicoIds.length) throw new Error("Escolha pelo menos um serviço.");
      const daBase = seletor.escolhido();
      const r = await comAceiteNota(extra => api("/agenda", {
        metodo: "POST",
        corpo: { ...extra,
          barbeiroId: f.prof?.value, data: f.data.value, hora: f.hora.value, servicoIds,
          observacao: f.obs.value || null,
          cliente: daBase ? { id: daBase.id } : { telefone: f.cliTel.value, nome: f.cliNome.value || undefined, aceiteLgpd: f.cliLgpd.checked },
          ...(f.repetir.value ? { repetir: { intervaloSemanas: Number(f.repetir.value), ate: f.repAte.value } } : {})
        }
      }));
      estadoAgenda.data = f.data.value;
      telaAgenda();
      // Confirmação pelo WhatsApp (cliente com telefone): o link já vem com a mensagem do modelo "Confirmação".
      const confirmar = r.whatsappConfirmacao && r.agendamento ? botaoWhatsapp({ id: r.agendamento.id, whatsapp: { confirmacao: r.whatsappConfirmacao } }, "confirmacao", r.whatsappComNumero === false ? "Enviar confirmação no WhatsApp (escolher contato)" : "Enviar confirmação no WhatsApp") : null;
      confirmar?.classList.add("largo");
      if (r.serie) {
        const sr = r.serie;
        const cada = sr.intervaloSemanas === 1 ? `toda ${sr.diaSemana}` : `a cada ${sr.intervaloSemanas} semanas (${sr.diaSemana})`;
        return abrirJanela("Horário fixo criado", [
          el("p", { text: `${sr.criados} horário(s) marcado(s), ${cada} às ${sr.hora}.` }),
          sr.pulados.length ? el("div", { class: "info" },
            el("strong", { text: "Datas que ficaram de fora:" }),
            el("ul", { class: "lista-pulados" }, sr.pulados.map(x => el("li", { text: `${dataBR(x.data)} — ${x.motivo}` })))) : null,
          confirmar
        ], { ok: "Pronto", semCancelar: true, aoConfirmar: () => true });
      }
      if (confirmar) {
        return abrirJanela("Horário marcado", [
          el("p", { text: `${dataBR(f.data.value)} às ${f.hora.value}. Quer avisar o cliente que o horário está confirmado?` }),
          confirmar
        ], { ok: "Agora não", semCancelar: true, aoConfirmar: () => true });
      }
      avisar("Horário marcado.");
    }
  });
}

// Remarcar: mesmo cliente e serviços (mesma duração), em outra hora/dia/profissional. Mostra o dia escolhido com os livres.
function janelaRemarcar(a, ag) {
  const durMin = (h => Number(h.slice(0, 2)) * 60 + Number(h.slice(3)));
  const duracao = durMin(a.fim) - durMin(a.inicio);
  const disp = painelDisponibilidade();
  setTimeout(() => {
    const f = janela.querySelector("form");
    if (!f?.rData) return;
    const recalcular = () => disp.atualizar({ data: f.rData.value, barbeiroId: f.prof?.value || a.barbeiroId, duracao, hora: f.rHora.value, aoEscolher: h => { f.rHora.value = h; } });
    f.rData.addEventListener("change", recalcular);
    f.prof?.addEventListener("change", recalcular);
    recalcular();
  });
  return abrirJanela(`Remarcar ${a.cliente.nome}`, [
    el("p", { class: "info", text: `Está marcado para ${dataBR(a.data)} às ${a.inicio} com ${a.barbeiroNome} · ${a.servicos.map(x => x.nome).join(" + ")} (${duracao} min).` }),
    veTodas() && ag ? campoProfissional(ag, a.barbeiroId) : null,
    el("div", { class: "lado-a-lado" },
      campo("Nova data", { name: "rData", id: "c-rData", type: "date", value: a.data, required: true }),
      campo("Nova hora", { name: "rHora", id: "c-rHora", type: "time", required: true })),
    disp.el
  ], {
    ok: "Remarcar",
    aoConfirmar: async f => {
      const r = await api("/agenda/remarcar", { metodo: "POST", corpo: { id: a.id, data: f.rData.value, hora: f.rHora.value, ...(f.prof ? { barbeiroId: f.prof.value } : {}) } });
      estadoAgenda.data = f.rData.value;
      telaAgenda();
      if (r.whatsapp) {
        return abrirJanela("Horário remarcado", [
          el("p", { text: r.mensagem }),
          el("a", { class: "botao whats largo", href: r.whatsapp, target: "_blank", rel: "noopener", "data-teste": "avisar-remarcado", text: "Avisar o cliente no WhatsApp" })
        ], { ok: "Pronto", semCancelar: true, aoConfirmar: () => true });
      }
      avisar(r.mensagem);
    }
  });
}

function janelaBloquear(ag) {
  return abrirJanela("Bloquear horário", [
    el("p", { class: "suave", text: "Almoço, folga, férias ou compromisso. A agenda não aceita marcação no período." }),
    campoProfissional(ag),
    el("div", { class: "lado-a-lado" },
      campo("De (data)", { name: "dIni", type: "date", value: estadoAgenda.data, required: true }),
      campo("Hora", { name: "hIni", type: "time", value: "12:00", required: true })),
    el("div", { class: "lado-a-lado" },
      campo("Até (data)", { name: "dFim", type: "date", value: estadoAgenda.data, required: true }),
      campo("Hora", { name: "hFim", type: "time", value: "13:00", required: true })),
    campo("Motivo (opcional)", { name: "motivoBloq", maxlength: "120", placeholder: "Ex.: almoço, folga, férias", autocomplete: "off" })
  ], {
    ok: "Bloquear",
    aoConfirmar: async f => {
      await api("/agenda/bloqueios", {
        metodo: "POST",
        corpo: { barbeiroId: f.prof?.value, inicio: `${f.dIni.value}T${f.hIni.value}`, fim: `${f.dFim.value}T${f.hFim.value}`, motivo: f.motivoBloq.value || null }
      });
      avisar("Horário bloqueado.");
      telaAgenda();
    }
  });
}

// Finalizar: serviços com valor de tabela (alterável), até 2 formas de pagamento com soma conferida.
function janelaFinalizar(a, { endpoint = "/agenda/finalizar", aoTerminar = telaAgenda, titulo = "Finalizar atendimento" } = {}) {
  // Começa só com o(s) serviço(s) do horário; "Adicionar outro serviço" abre a lista dos demais (sem repetir:
  // serviço repetido = quantidade). Pedido de 17/11/2026.
  const catalogo = [...(servicosCache || [])];
  for (const s of a.servicos) if (!catalogo.some(x => x.id === s.id)) catalogo.push({ id: s.id, nome: s.nome, precoCentavos: 0, duracaoMin: s.duracaoMin });
  const totalEl = el("p", { class: "total-final", "data-teste": "total" });
  const caixaLinhas = el("div", { class: "lista-servicos" });
  const linhas = [];
  const painelMais = el("div", { class: "mais-servicos", hidden: true, "data-teste": "mais-servicos" });
  const botaoMais = el("button", { type: "button", class: "botao pequeno botao-mais", "data-teste": "adicionar-servico", text: "+ Adicionar outro serviço" });
  const novaLinha = (s, qtd = 1) => {
    const valor = el("input", { type: "text", inputmode: "decimal", name: `valor-${s.id}`, value: centavosParaTexto(s.precoCentavos), "aria-label": `Valor cobrado de ${s.nome} (cada)`, "data-tabela": String(s.precoCentavos) });
    const qtdEl = el("span", { class: "qtd-num", "data-teste": "qtd", text: String(qtd) });
    const aviso = el("span", { class: "alterado", text: "valor diferente da tabela" });
    const l = { s, valor, aviso, qtd };
    const menos = el("button", { type: "button", class: "qtd-btn", "aria-label": `Menos ${s.nome}`, text: "−", onclick: () => { if (l.qtd > 1) { l.qtd--; qtdEl.textContent = String(l.qtd); atualizar(); } } });
    const mais = el("button", { type: "button", class: "qtd-btn", "aria-label": `Mais ${s.nome}`, text: "+", onclick: () => { if (l.qtd < 20) { l.qtd++; qtdEl.textContent = String(l.qtd); atualizar(); } } });
    const tirar = el("button", { type: "button", class: "tirar-servico", "aria-label": `Tirar ${s.nome}`, title: "Tirar este serviço", text: "×", onclick: () => {
      if (linhas.length === 1) { avisar("Deixe pelo menos um serviço.", "erro"); return; }
      linhas.splice(linhas.indexOf(l), 1); l.linha.remove(); desenharMais(); atualizar();
    } });
    l.linha = el("div", { class: "linha-servico linha-final", "data-servico-final": s.nome },
      el("div", { class: "nome-servico" }, el("strong", { text: s.nome }), el("small", { class: "suave", text: `tabela ${reais(s.precoCentavos)}` })),
      el("div", { class: "qtd" }, menos, qtdEl, mais),
      valor, tirar, aviso);
    linhas.push(l);
    caixaLinhas.append(l.linha);
    return l;
  };
  function desenharMais() {
    const restantes = catalogo.filter(s => !linhas.some(l => l.s.id === s.id));
    botaoMais.hidden = !restantes.length;
    if (!restantes.length) painelMais.hidden = true;
    painelMais.replaceChildren(...(restantes.length ? restantes.map(s => el("button", { type: "button", class: "chip-modelo", "data-servico-opcao": s.nome,
      text: `${s.nome} · ${reais(s.precoCentavos)}`, onclick: () => { novaLinha(s); painelMais.hidden = true; desenharMais(); atualizar(); } })) : []));
  }
  botaoMais.addEventListener("click", () => { painelMais.hidden = !painelMais.hidden; });
  for (const s of a.servicos) novaLinha(catalogo.find(x => x.id === s.id));
  desenharMais();

  // Produtos levados junto (17/11/2026): corte + pomada no mesmo pagamento, sem abrir outra venda.
  const prodLinhas = [];   // { p, q, linha, qtdEl }
  const caixaProdutos = el("div", { class: "lista-servicos", "data-teste": "produtos-cobranca" });
  const painelProd = el("div", { class: "mais-servicos", hidden: true, "data-teste": "mais-produtos" });
  const botaoProd = el("button", { type: "button", class: "botao pequeno botao-mais", "data-teste": "adicionar-produto", text: "+ Adicionar produto" });
  let produtosDisp = null;
  const totalProdutos = () => prodLinhas.reduce((t, l) => t + l.p.precoCentavos * l.q, 0);
  const saldoP = p => p.saldo ?? (p.disponivel === false ? 0 : 999);   // barbeiro não vê o saldo, só "disponível"
  function desenharProdutos() {
    const restantes = (produtosDisp || []).filter(p => !prodLinhas.some(l => l.p.id === p.id));
    painelProd.replaceChildren(...(produtosDisp === null ? [el("p", { class: "suave", text: "Carregando produtos…" })]
      : restantes.length ? restantes.map(p => el("button", { type: "button", class: "chip-modelo", "data-produto-opcao": p.nome, disabled: saldoP(p) < 1 || null,
        text: `${p.nome} · ${reais(p.precoCentavos)}${saldoP(p) < 1 ? " · sem estoque" : ""}`,
        onclick: () => { novoProduto(p); painelProd.hidden = true; desenharProdutos(); atualizar(); } }))
      : [el("p", { class: "suave", text: "Nenhum outro produto disponível." })]));
  }
  function novoProduto(p) {
    const qtdEl = el("span", { class: "qtd-num", text: "1" });
    const l = { p, q: 1, qtdEl };
    const mudar = d => { const n = l.q + d; if (n < 1) return; if (n > saldoP(p)) { avisar(`Só há ${saldoP(p)} em estoque.`, "erro"); return; } l.q = n; qtdEl.textContent = String(n); atualizar(); };
    l.linha = el("div", { class: "linha-servico linha-final linha-produto", "data-produto-final": p.nome },
      el("div", { class: "nome-servico" }, el("strong", { text: p.nome }), el("small", { class: "suave", text: `produto · ${reais(p.precoCentavos)} cada` })),
      el("div", { class: "qtd" },
        el("button", { type: "button", class: "qtd-btn", "aria-label": `Menos ${p.nome}`, text: "−", onclick: () => mudar(-1) }), qtdEl,
        el("button", { type: "button", class: "qtd-btn", "aria-label": `Mais ${p.nome}`, text: "+", onclick: () => mudar(1) })),
      el("strong", { class: "valor-produto" }),
      el("button", { type: "button", class: "tirar-servico", "aria-label": `Tirar ${p.nome}`, title: "Tirar este produto", text: "×",
        onclick: () => { prodLinhas.splice(prodLinhas.indexOf(l), 1); l.linha.remove(); desenharProdutos(); atualizar(); } }));
    prodLinhas.push(l);
    caixaProdutos.append(l.linha);
  }
  botaoProd.addEventListener("click", async () => {
    painelProd.hidden = !painelProd.hidden;
    if (produtosDisp === null) {
      desenharProdutos();
      try { produtosDisp = (await api("/produtos")).produtos.filter(p => p.ativo !== false && !p.usoInterno); } catch (e) { produtosDisp = []; avisar(e.message, "erro"); }
      desenharProdutos();
    }
  });
  const forma1 = campo("Forma de pagamento", { tag: "select", name: "forma1", valor: "pix", opcoes: Object.entries(NOME_FORMA) });
  const dividir = caixaMarcar("Dividir em 2 formas", { name: "dividir" });
  const valor1 = campo("Valor na 1ª forma (R$)", { name: "valor1", inputmode: "decimal" });
  const segunda = el("div", { class: "lado-a-lado" },
    campo("2ª forma", { tag: "select", name: "forma2", valor: "dinheiro", opcoes: Object.entries(NOME_FORMA) }),
    el("div", { class: "campo" }, el("label", { text: "Valor na 2ª forma" }), el("p", { class: "valor2", "data-teste": "valor2" })));
  valor1.hidden = true;
  segunda.hidden = true;

  const total = () => linhas.reduce((t, l) => t + (paraCentavos(l.valor.value) ?? 0) * l.qtd, 0) + totalProdutos();
  const troco = campoTroco(() => {
    const t = total();
    const f1 = forma1.querySelector("select").value;
    if (!dividir.querySelector("input").checked) return f1 === "dinheiro" ? t : 0;
    const v1 = Math.min(t, Math.max(0, paraCentavos(valor1.querySelector("input").value) ?? 0));
    return (f1 === "dinheiro" ? v1 : 0) + (segunda.querySelector("select").value === "dinheiro" ? t - v1 : 0);
  });
  const atualizar = () => {
    troco.atualizar();
    for (const l of linhas) l.aviso.hidden = paraCentavos(l.valor.value) === Number(l.valor.dataset.tabela);
    for (const l of prodLinhas) l.linha.querySelector(".valor-produto").textContent = reais(l.p.precoCentavos * l.q);
    totalEl.textContent = prodLinhas.length ? `Total: ${reais(total())} (produtos ${reais(totalProdutos())})` : `Total: ${reais(total())}`;
    const dividindo = dividir.querySelector("input").checked;
    valor1.hidden = !dividindo;
    segunda.hidden = !dividindo;
    const v1 = paraCentavos(valor1.querySelector("input").value) ?? 0;
    segunda.querySelector(".valor2").textContent = reais(total() - v1);
  };
  const conteudo = [
    el("p", { class: "suave", text: `${a.cliente.nome} · ${a.inicio} · o valor pode ser alterado (fica registrado e aparece para o gerente).` }),
    caixaLinhas, botaoMais, painelMais,
    caixaProdutos, botaoProd, painelProd,
    totalEl, forma1, dividir, valor1, segunda, troco.el
  ];
  const promessa = abrirJanela(titulo, conteudo, {
    ok: "Confirmar",
    aoConfirmar: async f => {
      const itens = [];
      for (const l of linhas) {
        const v = paraCentavos(l.valor.value);
        if (v === null) throw new Error(`Valor de ${l.s.nome} inválido. Exemplo: 40,00`);
        itens.push({ servicoId: l.s.id, precoCobradoCentavos: v, ...(l.qtd > 1 ? { quantidade: l.qtd } : {}) });
      }
      if (!itens.length) throw new Error("Deixe pelo menos um serviço.");
      const t = itens.reduce((s, i) => s + i.precoCobradoCentavos * (i.quantidade || 1), 0) + totalProdutos();
      const produtos = prodLinhas.map(l => ({ produtoId: l.p.id, quantidade: l.q }));
      let pagamentos = t > 0 ? [{ forma: f.forma1.value, valorCentavos: t }] : [];
      if (f.dividir.checked && t > 0) {
        const v1 = paraCentavos(f.valor1.value);
        if (v1 === null || v1 <= 0 || v1 >= t) throw new Error("Valor da 1ª forma inválido: precisa ser maior que zero e menor que o total.");
        pagamentos = [{ forma: f.forma1.value, valorCentavos: v1 }, { forma: f.forma2.value, valorCentavos: t - v1 }];
      }
      await api(endpoint, { metodo: "POST", corpo: { id: a.id, itens, pagamentos, ...(produtos.length ? { produtos } : {}) } });
      avisar(produtos.length ? "Atendimento e produtos cobrados. Entrada lançada no caixa." : "Atendimento finalizado. Entrada lançada no caixa.");
      aoTerminar();
    }
  });
  janela.querySelector("form").addEventListener("input", atualizar);
  janela.querySelector("form").addEventListener("change", atualizar);
  atualizar();
  return promessa;
}

// ---------- FUNCIONAMENTO (gestão) ----------
async function telaFuncionamento() {
  const f = await api("/funcionamento");
  const linhas = f.dias.map(d => {
    const id = `d${d.dia}`;
    return el("div", { class: "linha-dia", "data-dia": String(d.dia) },
      el("div", { class: "marcar" },
        el("input", { type: "checkbox", id: `${id}-aberto`, name: `${id}-aberto`, checked: d.aberto || null }),
        el("label", { for: `${id}-aberto`, text: DIAS[d.dia] })),
      el("div", { class: "horas" },
        el("label", { class: "mini" }, "Abre", el("input", { type: "time", name: `${id}-abre`, value: d.abre || "09:00" })),
        el("label", { class: "mini" }, "Fecha", el("input", { type: "time", name: `${id}-fecha`, value: d.fecha || "19:00" })),
        el("label", { class: "mini" }, "Intervalo de", el("input", { type: "time", name: `${id}-ii`, value: d.intervaloIni || "" })),
        el("label", { class: "mini" }, "até", el("input", { type: "time", name: `${id}-if`, value: d.intervaloFim || "" }))));
  });
  const form = el("form", { class: "cartao" },
    el("h3", { text: "Dias e horários da semana" }),
    !f.configurado ? el("p", { class: "info", text: "Ainda não cadastrado: a agenda só aceita horários depois que o funcionamento for salvo." }) : null,
    el("div", { class: "dias-func" }, linhas),
    el("p", { class: "ajuda", text: "Intervalo é opcional (ex.: almoço 12:00 até 13:00). Deixe em branco se não houver." }),
    el("button", { type: "submit", class: "botao principal", text: "Salvar funcionamento" }));
  form.addEventListener("submit", ev => {
    ev.preventDefault();
    enviar(form, async () => {
      const dias = f.dias.map(d => {
        const g = n => form.elements[`d${d.dia}-${n}`];
        return g("aberto").checked
          ? { dia: d.dia, aberto: true, abre: g("abre").value, fecha: g("fecha").value, intervaloIni: g("ii").value || null, intervaloFim: g("if").value || null }
          : { dia: d.dia, aberto: false };
      });
      await api("/funcionamento/salvar", { metodo: "POST", corpo: { dias } });
      avisar("Funcionamento salvo.");
      telaFuncionamento();
    });
  });

  const formFechar = el("form", { class: "cartao" },
    el("h3", { text: "Fechar a agenda (feriado, folga coletiva, reforma)" }),
    el("div", { class: "lado-a-lado" },
      campo("De", { name: "fIni", type: "date", required: true, value: hojeLocal() }),
      campo("Até (opcional)", { name: "fFim", type: "date" })),
    campo("Motivo", { name: "fMotivo", required: true, minlength: "3", placeholder: "Ex.: Feriado de Natal" }),
    el("button", { type: "submit", class: "botao principal", text: "Fechar agenda" }));
  formFechar.addEventListener("submit", ev => {
    ev.preventDefault();
    enviar(formFechar, async () => {
      const ini = formFechar.fIni.value;
      const fim = formFechar.fFim.value || ini;
      const { afetados } = await api(`/funcionamento/afetados?dataIni=${ini}&dataFim=${fim}`);
      const ok = await abrirJanela("Confirmar fechamento", [
        el("p", { text: afetados.length
          ? `Há ${afetados.length} horário(s) marcado(s) nesse período. A agenda NÃO cancela sozinha: depois de fechar, você recebe a lista para remarcar com cada cliente.`
          : "Não há horários marcados nesse período." })
      ], { ok: "Fechar agenda", aoConfirmar: () => true });
      if (!ok) return;
      const r = await api("/funcionamento/datas-fechadas", { metodo: "POST", corpo: { dataIni: ini, dataFim: fim, motivo: formFechar.fMotivo.value } });
      avisar("Agenda fechada no período.");
      await telaFuncionamento();
      if (r.afetados.length) mostrarAfetados(r.afetados);
    });
  });

  const fechadas = el("section", { class: "cartao" },
    el("h3", { text: "Datas fechadas" }),
    f.datasFechadas.length
      ? el("ul", { class: "lista" }, f.datasFechadas.map(d => el("li", { class: "item", "data-fechada": d.motivo },
        el("div", { class: "item-topo" }, el("strong", { text: d.dataIni === d.dataFim ? dataBR(d.dataIni) : `${dataBR(d.dataIni)} a ${dataBR(d.dataFim)}` })),
        el("p", { class: "suave", text: d.motivo }),
        el("div", { class: "item-acoes" },
          botao("Ver horários marcados", async () => mostrarAfetados((await api(`/funcionamento/afetados?dataIni=${d.dataIni}&dataFim=${d.dataFim}`)).afetados), "pequeno"),
          botao("Reabrir agenda", () => pedirMotivo("Reabrir a agenda nessas datas", "A agenda volta a aceitar horários no período.", async motivo => {
            await api("/funcionamento/datas-fechadas/desativar", { metodo: "POST", corpo: { id: d.id, motivo } });
            avisar("Agenda reaberta."); telaFuncionamento();
          }, "Reabrir"), "pequeno")))))
      : el("p", { class: "suave", text: "Nenhuma data fechada daqui para frente." }));

  mostrar(cabecalho("Funcionamento", "O horário de cada profissional fica dentro do funcionamento (Equipe → Horário)."),
    el("div", { class: "duas-colunas" }, el("section", {}, form), el("section", {}, formFechar, fechadas)));
}

function mostrarAfetados(afetados) {
  return abrirJanela("Horários para remarcar", [
    afetados.length
      ? el("ul", { class: "lista" }, afetados.map(a => el("li", { class: "item", "data-afetado": a.cliente },
        el("strong", { text: `${dataLonga(a.data)} ${a.hora} · ${a.cliente}` }),
        el("p", { class: "suave", text: `${a.barbeiro} · ${a.servicos}` }),
        a.whatsapp ? el("div", { class: "item-acoes" }, el("a", { class: "botao pequeno whats", href: a.whatsapp.proposta, target: "_blank", rel: "noopener", text: "Propor horário" })) : el("p", { class: "suave", text: "Cliente sem telefone: avise pessoalmente." }))))
      : el("p", { text: "Nenhum horário marcado nesse período." }),
    el("p", { class: "suave", text: "Remarque cada um pela agenda (cancele com o motivo e marque no novo horário)." })
  ], { ok: "Pronto", semCancelar: true, aoConfirmar: () => true });
}

// ---------- HORÁRIO DE TRABALHO (Equipe) ----------
async function janelaHorario(u) {
  const [h, f] = await Promise.all([api(`/horarios-trabalho?id=${u.id}`), api("/funcionamento")]);
  if (!f.configurado) { avisar("Cadastre primeiro o funcionamento da barbearia.", "erro"); return; }
  const linhas = h.dias.map(d => {
    const fd = f.dias[d.dia];
    const trabalha = h.configurado ? d.trabalha : fd.aberto;
    return el("div", { class: "linha-dia" },
      el("div", { class: "marcar" },
        el("input", { type: "checkbox", id: `h${d.dia}`, name: `h${d.dia}`, checked: trabalha || null, disabled: !fd.aberto || null }),
        el("label", { for: `h${d.dia}`, text: fd.aberto ? DIAS[d.dia] : `${DIAS[d.dia]} (fechado)` })),
      el("div", { class: "horas" },
        el("label", { class: "mini" }, "De", el("input", { type: "time", name: `h${d.dia}-ini`, value: (h.configurado && d.ini) || fd.abre || "" })),
        el("label", { class: "mini" }, "Até", el("input", { type: "time", name: `h${d.dia}-fim`, value: (h.configurado && d.fim) || fd.fecha || "" }))));
  });
  return abrirJanela(`Horário de ${u.nome}`, [
    el("p", { class: "suave", text: h.configurado ? "Dias e horas em que atende." : "Ainda segue o funcionamento da barbearia. Ajuste e salve." }),
    el("div", { class: "dias-func" }, linhas)
  ], {
    ok: "Salvar",
    aoConfirmar: async form => {
      const dias = h.dias.map(d => form.elements[`h${d.dia}`].checked
        ? { dia: d.dia, trabalha: true, ini: form.elements[`h${d.dia}-ini`].value, fim: form.elements[`h${d.dia}-fim`].value }
        : { dia: d.dia, trabalha: false });
      await api("/horarios-trabalho", { metodo: "POST", corpo: { id: u.id, dias } });
      avisar("Horário salvo.");
    }
  });
}

// ---------- PAGAMENTO (1 ou 2 formas) — usado na venda ----------
// Troco: quando parte (ou tudo) é em dinheiro, digita quanto o cliente entregou e o sistema mostra o troco.
// Só ajuda na conta: no caixa entra o valor da compra, não o que o cliente entregou.
let contadorTroco = 0;
function campoTroco(valorEmDinheiro) {
  const id = `troco-${++contadorTroco}`;
  const input = el("input", { type: "text", id, name: "recebidoDinheiro", inputmode: "decimal", autocomplete: "off", placeholder: "Ex.: 50,00", "data-teste": "recebido-dinheiro" });
  const resultado = el("p", { class: "troco-resultado", "data-teste": "troco", "aria-live": "polite" });
  const bloco = el("div", { class: "bloco-troco" },
    el("div", { class: "campo" }, el("label", { for: id, text: "Valor recebido em dinheiro (R$)" }), input), resultado);
  const atualizar = () => {
    const devido = valorEmDinheiro();
    bloco.hidden = devido <= 0;
    const recebido = paraCentavos(input.value);
    if (!input.value.trim() || recebido === null) { resultado.textContent = `Em dinheiro: ${reais(devido)}`; resultado.className = "troco-resultado"; return; }
    if (recebido >= devido) { resultado.textContent = `Troco: ${reais(recebido - devido)}`; resultado.className = "troco-resultado ok"; }
    else { resultado.textContent = `Faltam ${reais(devido - recebido)}`; resultado.className = "troco-resultado falta"; }
  };
  input.addEventListener("input", atualizar);
  input.addEventListener("blur", atualizar);
  return { el: bloco, atualizar };
}

function blocoPagamento(totalAtual, { nota = true } = {}) {
  const opcoes = nota ? Object.entries(NOME_FORMA) : OPCOES_FORMA;
  const forma1 = campo("Forma de pagamento", { tag: "select", name: "forma1", valor: "pix", opcoes });
  const dividir = caixaMarcar("Dividir em 2 formas", { name: "dividir" });
  const valor1 = campo("Valor na 1ª forma (R$)", { name: "valor1", inputmode: "decimal" });
  const segunda = el("div", { class: "lado-a-lado" },
    campo("2ª forma", { tag: "select", name: "forma2", valor: "dinheiro", opcoes }),
    el("div", { class: "campo" }, el("label", { text: "Valor na 2ª forma" }), el("p", { class: "valor2", "data-teste": "valor2" })));
  const emDinheiro = () => {
    const t = totalAtual();
    const f1 = forma1.querySelector("select").value;
    if (!dividir.querySelector("input").checked) return f1 === "dinheiro" ? t : 0;
    const v1 = Math.min(t, Math.max(0, paraCentavos(valor1.querySelector("input").value) ?? 0));
    return (f1 === "dinheiro" ? v1 : 0) + (segunda.querySelector("select").value === "dinheiro" ? t - v1 : 0);
  };
  const troco = campoTroco(emDinheiro);
  const avisoNota = el("p", { class: "aviso-nota", "data-teste": "aviso-nota", hidden: true, text: "Para lançar promissória, o cliente precisa estar cadastrado na base de clientes (escolha o cliente da lista). Cliente avulso não pode ficar na nota." });
  const atualizar = () => {
    avisoNota.hidden = !temNota();
    const d = dividir.querySelector("input").checked;
    valor1.hidden = !d;
    segunda.hidden = !d;
    segunda.querySelector(".valor2").textContent = reais(totalAtual() - (paraCentavos(valor1.querySelector("input").value) ?? 0));
    troco.atualizar();
  };
  const ler = f => {
    const t = totalAtual();
    if (t <= 0) return [];
    if (!f.dividir.checked) return [{ forma: f.forma1.value, valorCentavos: t }];
    const v1 = paraCentavos(f.valor1.value);
    if (v1 === null || v1 <= 0 || v1 >= t) throw new Error("Valor da 1ª forma inválido: precisa ser maior que zero e menor que o total.");
    return [{ forma: f.forma1.value, valorCentavos: v1 }, { forma: f.forma2.value, valorCentavos: t - v1 }];
  };
  // Alguma das formas escolhidas é promissória? (exige cliente identificado)
  const temNota = () => forma1.querySelector("select").value === "promissoria" || (dividir.querySelector("input").checked && segunda.querySelector("select").value === "promissoria");
  return { elementos: [forma1, dividir, valor1, segunda, avisoNota, troco.el], atualizar, ler, temNota };
}

// ---------- VENDA DE PRODUTO (caixa, gestão ou barbeiro) ----------
async function janelaVenda({ agendamento = null, aoTerminar } = {}) {
  const produtos = (await api("/produtos")).produtos.filter(p => !p.usoInterno && (p.disponivel ?? (p.ativo && p.saldo > 0)));
  if (!produtos.length) { avisar("Nenhum produto com estoque para vender.", "erro"); return; }
  const linhas = produtos.map(p => {
    const qtd = el("input", { type: "number", min: "0", max: String(p.saldo ?? 999), step: "1", value: "0", inputmode: "numeric", name: `q-${p.id}`, "aria-label": `Quantidade de ${p.nome}` });
    return { p, qtd, el: el("div", { class: "linha-servico", "data-venda-produto": p.nome },
      el("span", { text: `${p.nome} · ${reais(p.precoCentavos)}${p.saldo !== undefined ? ` · estoque ${p.saldo}` : ""}` }), qtd) };
  });
  const totalEl = el("p", { class: "total-final", "data-teste": "total-venda" });
  const total = () => linhas.reduce((t, l) => t + (Math.max(0, parseInt(l.qtd.value, 10) || 0) * l.p.precoCentavos), 0);
  const pag = blocoPagamento(total);
  const atualizar = () => {
    totalEl.textContent = `Total: ${reais(total())}`; pag.atualizar();
    const f = janela.querySelector("form");
    f.aLgpd.closest(".marcar").hidden = !f.aTel.value.replace(/\D/g, "");   // aceite só se houver telefone
  };
  const promessa = abrirJanela(agendamento ? `Vender para ${agendamento.cliente.nome}` : "Vender produto", [
    el("p", { class: "suave", text: "Informe a quantidade de cada produto. A venda baixa o estoque na hora." }),
    el("div", { class: "lista-servicos" }, linhas.map(l => l.el)),
    totalEl, ...pag.elementos
  ], {
    ok: "Registrar venda",
    aoConfirmar: async f => {
      const itens = linhas.map(l => ({ produtoId: l.p.id, quantidade: parseInt(l.qtd.value, 10) || 0 })).filter(i => i.quantidade > 0);
      if (!itens.length) throw new Error("Informe a quantidade de pelo menos um produto.");
      await api("/vendas", {
        metodo: "POST",
        corpo: {
          itens, pagamentos: pag.ler(f),
          ...(agendamento ? { agendamentoId: agendamento.id, vendedorId: agendamento.barbeiroId } : {})
        }
      });
      avisar(`Venda registrada: ${reais(total())}.`);
      aoTerminar?.();
    }
  });
  janela.querySelector("form").addEventListener("input", atualizar);
  janela.querySelector("form").addEventListener("change", atualizar);
  atualizar();
  return promessa;
}

// ---------- CAIXA ----------
let timerCaixa;
const NOME_TIPO_CAIXA = {
  atendimento: "Atendimento", estorno_atendimento: "Estorno (atendimento reaberto)", venda: "Venda",
  estorno_venda: "Estorno (venda cancelada)", sangria: "Sangria", suprimento: "Suprimento",
  promissoria: "Na promissória (não entrou dinheiro)", recebimento_promissoria: "Nota recebida"
};

function listaCaixa(c, recarregar) {
  if (!c.lancamentos.length) return el("p", { class: "vazio", text: "Nenhum lançamento ainda. Atendimentos finalizados e vendas aparecem aqui na hora." });
  return el("ul", { class: "lista" }, c.lancamentos.map(l => el("li", {
    class: `item mov-${l.tipo} ${l.valorCentavos < 0 ? "estorno" : ""} ${l.vendaCancelada ? "inativo" : ""}`,
    "data-lancamento": l.cliente || l.descricao || l.tipo
  },
    el("div", { class: "item-topo" },
      el("strong", { text: [l.hora, l.cliente || NOME_TIPO_CAIXA[l.tipo]].filter(Boolean).join(" ") }),
      el("span", { class: `preco ${l.valorCentavos < 0 ? "negativo" : ""}`, text: reais(l.valorCentavos) })),
    el("p", { class: "suave", text: [
      l.cliente ? NOME_TIPO_CAIXA[l.tipo] : null, l.barbeiro, l.descricao,
      l.tipo === "sangria" || l.tipo === "suprimento" ? null : NOME_FORMA[l.formaAtual]
    ].filter(Boolean).join(" · ") }),
    l.corrigido ? el("p", { class: "suave destaque-texto", text: `Forma corrigida: ${NOME_FORMA[l.forma]} → ${NOME_FORMA[l.formaAtual]}` }) : null,
    l.desconto ? el("p", { class: "suave", "data-teste": "desconto-lancamento", text: `Desconto de ${bpParaTexto(l.desconto.percentualBp)}% (− ${reais(l.desconto.valorCentavos)}; sem desconto seria ${reais(l.desconto.brutoCentavos)})` }) : null,
    l.vendaCancelada && l.tipo === "venda" ? el("p", { class: "suave", text: "Venda cancelada" }) : null,
    l.tipo === "promissoria" ? el("span", { class: `etiqueta ${{ aberta: "amarela", quitada: "verde", estornada: "" }[l.notaSituacao]}`, "data-teste": "nota-situacao",
      text: { aberta: "Nota em aberto", quitada: "Nota paga", estornada: "Nota estornada" }[l.notaSituacao] }) : null,
    l.podeCorrigir || l.podeCancelarVenda ? el("div", { class: "item-acoes" },
      l.podeCorrigir ? botao("Corrigir forma", () => abrirJanela("Corrigir forma de pagamento", [
        el("p", { text: `${reais(l.valorCentavos)} está em ${NOME_FORMA[l.formaAtual]}. Qual a forma certa?` }),
        campo("Forma certa", { tag: "select", name: "nova", opcoes: OPCOES_FORMA.filter(([f]) => f !== l.formaAtual) }),
        campo("Motivo", { name: "motivo", required: true, minlength: "3" })
      ], {
        ok: "Corrigir",
        aoConfirmar: async f => {
          await api("/caixa/corrigir-forma", { metodo: "POST", corpo: { id: l.id, novaForma: f.nova.value, motivo: f.motivo.value } });
          avisar("Forma corrigida."); recarregar();
        }
      }), "pequeno") : null,
      l.podeCancelarVenda ? botao("Cancelar venda", () => pedirMotivo("Cancelar venda", "O estoque volta e a entrada é estornada. Nada é apagado.", async motivo => {
        await api("/vendas/cancelar", { metodo: "POST", corpo: { id: l.vendaId, motivo } });
        avisar("Venda cancelada."); recarregar();
      }, "Cancelar venda"), "pequeno perigo") : null) : null)));
}

function janelaMovimento(tipo, recarregar) {
  return abrirJanela(tipo === "sangria" ? "Sangria (retirada de dinheiro)" : "Suprimento (reforço de dinheiro)", [
    campo("Valor (R$)", { name: "valor", inputmode: "decimal", required: true }),
    campo("Motivo", { name: "motivo", required: true, minlength: "3", placeholder: tipo === "sangria" ? "Ex.: depósito no banco" : "Ex.: troco extra" })
  ], {
    ok: "Registrar",
    aoConfirmar: async f => {
      const v = paraCentavos(f.valor.value);
      if (!v) throw new Error("Valor inválido. Exemplo: 50,00");
      await api("/caixa/movimento", { metodo: "POST", corpo: { tipo, valorCentavos: v, motivo: f.motivo.value } });
      avisar(tipo === "sangria" ? "Sangria registrada." : "Suprimento registrado.");
      recarregar();
    }
  });
}

function janelaFechar(c, recarregar, data = null) {
  const t = c.totais;
  const dif = el("p", { class: "total-final", "data-teste": "diferenca" });
  const promessa = abrirJanela("Fechar o caixa", [
    el("dl", { class: "conferencia" },
      el("dt", { text: "Troco inicial" }), el("dd", { text: reais(c.caixa.trocoCentavos) }),
      el("dt", { text: "Entradas em dinheiro" }), el("dd", { text: reais(t.porForma.dinheiro) }),
      el("dt", { text: "Suprimentos" }), el("dd", { text: `+ ${reais(t.suprimentosCentavos)}` }),
      el("dt", { text: "Sangrias" }), el("dd", { text: `− ${reais(t.sangriasCentavos)}` }),
      el("dt", { class: "forte", text: "Dinheiro esperado" }), el("dd", { class: "forte", text: reais(t.dinheiroEsperadoCentavos) })),
    el("p", { class: "suave", text: `Pix ${reais(t.porForma.pix)} · Débito ${reais(t.porForma.debito)} · Crédito ${reais(t.porForma.credito)} (conferir na maquininha/banco).` }),
    campo("Dinheiro contado na gaveta (R$)", { name: "contado", inputmode: "decimal", required: true }),
    dif,
    campo("Observação (obrigatória se houver diferença)", { name: "obs", maxlength: "300" })
  ], {
    ok: "Fechar caixa", perigo: true,
    aoConfirmar: async f => {
      const contado = paraCentavos(f.contado.value);
      if (contado === null) throw new Error("Valor contado inválido. Exemplo: 248,50");
      await api("/caixa/fechar", { metodo: "POST", corpo: { contadoCentavos: contado, observacao: f.obs.value || null, ...(data ? { data } : {}) } });
      avisar("Caixa fechado.");
      recarregar();
    }
  });
  const atualizar = () => {
    const v = paraCentavos(janela.querySelector("[name=contado]").value);
    if (v === null) { dif.textContent = ""; return; }
    const d = v - t.dinheiroEsperadoCentavos;
    dif.textContent = d === 0 ? "Sem diferença" : d > 0 ? `Sobra de ${reais(d)}` : `Falta de ${reais(-d)}`;
    dif.className = `total-final ${d === 0 ? "ok-texto" : "erro-texto"}`;
  };
  janela.querySelector("form").addEventListener("input", atualizar);
  return promessa;
}

function blocoFechamento(c) {
  const f = c.fechamento;
  return el("div", { class: "cartao fechamento", "data-tela": "caixa-fechado" },
    el("p", { class: "grande", text: "Caixa fechado" }),
    el("dl", { class: "conferencia" },
      el("dt", { text: "Dinheiro esperado" }), el("dd", { text: reais(f.esperadoCentavos) }),
      el("dt", { text: "Dinheiro contado" }), el("dd", { text: reais(f.contadoCentavos) }),
      el("dt", { class: "forte", text: "Diferença" }),
      el("dd", { class: `forte ${f.diferencaCentavos ? "erro-texto" : "ok-texto"}`, "data-teste": "diferenca-fechada",
        text: f.diferencaCentavos === 0 ? "Sem diferença" : f.diferencaCentavos > 0 ? `Sobra de ${reais(f.diferencaCentavos)}` : `Falta de ${reais(-f.diferencaCentavos)}` })),
    f.observacao ? el("p", { class: "suave", text: `Observação: ${f.observacao}` }) : null,
    el("p", { class: "suave", text: `Fechado por ${f.fechadoPor} às ${horaLocal(f.fechadoEm)}` }));
}

// ---------- CAIXA (PDV): cobrar atendimento, vender produto, lançamentos ----------
const estadoCaixa = { aba: "cobrar", carrinho: new Map() };

async function telaCaixa(dataHistorico = null) {
  clearTimeout(timerCaixa);
  const c = dataHistorico ? await api(`/caixa/dia?data=${dataHistorico}`) : await api("/caixa/hoje");
  const recarregar = () => telaCaixa(dataHistorico);
  const voltar = dataHistorico ? "#/caixa-historico" : null;
  const linkHistorico = gestao() && !dataHistorico ? el("a", { class: "botao pequeno", href: "#/caixa-historico", text: "Caixas de outros dias" }) : null;

  if (!c.caixa) {
    if (dataHistorico) { mostrar(cabecalho("Caixa", dataBR(dataHistorico), voltar), el("p", { class: "vazio", text: "Não houve caixa nesse dia." })); return; }
    const form = el("form", { class: "cartao" },
      el("h3", { text: "Abrir o caixa de hoje" }),
      campo("Troco inicial (R$)", { name: "troco", inputmode: "decimal", required: true, placeholder: "100,00" }),
      el("button", { type: "submit", class: "botao principal", text: "Abrir caixa" }));
    form.addEventListener("submit", ev => {
      ev.preventDefault();
      enviar(form, async () => {
        const troco = paraCentavos(form.troco.value);
        if (troco === null) throw new Error("Valor do troco inválido. Exemplo: 100,00");
        await api("/caixa/abrir", { metodo: "POST", corpo: { trocoCentavos: troco } });
        avisar("Caixa aberto.");
        telaCaixa();
      });
    });
    mostrar(cabecalho("Caixa", `${dataBR(c.data)} · ${usuario.barbearia.nome}`, voltar),
      el("p", { class: "info", text: "Enquanto o caixa não for aberto, ninguém consegue finalizar atendimentos nem vender." }),
      el("section", { class: "estreito-esq", "data-tela": "caixa" }, form), linkHistorico);
    return;
  }

  const t = c.totais;
  const aberto = c.caixa.situacao === "aberto";
  const ehHoje = !dataHistorico || dataHistorico === hojeLocal();
  const topo = [
    // Topo do caixa: quanto entrou no total e quanto deve ter na gaveta; abaixo, uma linha compacta por forma.
    el("div", { class: "pdv-topo", "data-tela": "caixa" },
      el("div", { class: "pdv-num" }, el("span", { text: "Recebido hoje" }), el("strong", { "data-teste": "entradas", text: reais(t.entradasCentavos) }),
        el("small", { text: `Atendimentos ${reais(t.atendimentosCentavos)} · produtos ${reais(t.vendasCentavos)}${t.notasRecebidasCentavos ? ` · notas ${reais(t.notasRecebidasCentavos)}` : ""}` })),
      el("div", { class: "pdv-num ouro" }, el("span", { text: "Dinheiro na gaveta" }), el("strong", { "data-teste": "esperado", text: reais(t.dinheiroEsperadoCentavos) }),
        el("small", { "data-teste": "composicao-gaveta", text: [`Troco ${reais(c.caixa.trocoCentavos)}`, `+ dinheiro ${reais(t.porForma.dinheiro)}`,
          t.suprimentosCentavos ? `+ suprimentos ${reais(t.suprimentosCentavos)}` : null, t.sangriasCentavos ? `− sangrias ${reais(t.sangriasCentavos)}` : null].filter(Boolean).join(" ") }))),
    el("div", { class: "pdv-formas", "data-teste": "por-forma" },
      [["dinheiro", "Dinheiro"], ["pix", "Pix"], ["debito", "Débito"], ["credito", "Crédito"]].map(([f, nome]) =>
        el("div", { class: `forma-card forma-${f}`, "data-forma": f }, el("span", { text: nome }), el("strong", { text: reais(t.porForma[f] || 0) }))),
      el("div", { class: "forma-card forma-promissoria", "data-forma": "promissoria", "data-teste": "notas-lancadas", title: "Promissória: a receber (não entrou no caixa)" },
        el("span", { text: "Promissória" }), el("strong", { text: reais(t.notasLancadasCentavos || 0) })))
  ];

  if (!aberto || !ehHoje) {
    mostrar(
      cabecalho(dataHistorico ? `Caixa de ${dataBR(dataHistorico)}` : "Caixa", `${dataBR(c.data)} · aberto por ${c.caixa.abertoPor}`, voltar),
      topo,
      aberto ? el("div", { class: "pdv-barra" }, el("div", { class: "pdv-acoes" }, botao("Fechar caixa", () => janelaFechar(c, recarregar, dataHistorico), "pequeno perigo")))
        : el("div", {}, blocoFechamento(c),
          gestao() ? botao("Reabrir caixa", () => pedirMotivo("Reabrir o caixa", "Permite corrigir lançamentos deste dia. Depois, feche de novo.", async motivo => {
            await api("/caixa/reabrir", { metodo: "POST", corpo: { data: c.data, motivo } });
            avisar("Caixa reaberto."); recarregar();
          }, "Reabrir"), "pequeno") : null),
      c.reaberturas?.length ? el("p", { class: "suave", text: `Reaberto ${c.reaberturas.length}x (último motivo: ${c.reaberturas[0].motivo})` }) : null,
      el("h3", { text: "Lançamentos do dia" }), listaCaixa(c, recarregar), linkHistorico);
    return;
  }

  // Caixa de hoje aberto: PDV
  const aba = estadoCaixa.aba;
  const trocarAba = nova => { estadoCaixa.aba = nova; recarregar(); };
  let conteudo;
  if (aba === "cobrar") conteudo = await abaCobrar(recarregar);
  else if (aba === "vender") conteudo = await abaVender(recarregar);
  else conteudo = listaCaixa(c, recarregar);

  mostrar(
    cabecalho("Caixa", `${dataBR(c.data)} · aberto por ${c.caixa.abertoPor}`),
    topo,
    c.reaberturas?.length ? el("p", { class: "suave", text: `Reaberto ${c.reaberturas.length}x (último motivo: ${c.reaberturas[0].motivo})` }) : null,
    // Três botões grandes (o que o caixa mais usa) e, separado, as ações do caixa com ícones.
    el("div", { class: "pdv-barra pdv-principal" },
      el("div", { class: "alterna pdv-abas", role: "tablist", "aria-label": "O que fazer" },
        [["cobrar", "Cobrar", "atendimento", "recibo"], ["vender", "Vender", "produto", "sacola"], ["lancamentos", "Lançamentos", "do dia", "lista"]].map(([k, txt, sub, ic]) =>
          el("button", { type: "button", role: "tab", "aria-selected": String(aba === k), class: `botao pdv-aba aba-${k} ${aba === k ? "ativo" : ""}`, onclick: () => trocarAba(k) },
            icone(ic), el("span", { class: "pdv-aba-txt" }, el("strong", { text: txt }), el("small", { text: sub })))))),
    conteudo,
    el("section", { class: "pdv-ferramentas", "aria-label": "Ações do caixa" },
      el("h3", { text: "Caixa" }),
      el("div", { class: "pdv-acoes" },
        el("a", { class: "botao ferramenta", href: "#/notas" }, icone("contas"), el("span", { text: "Notas em aberto" })),
        el("button", { type: "button", class: "botao ferramenta", onclick: () => janelaMovimento("sangria", recarregar) }, icone("setaBaixo"), el("span", { text: "Sangria" })),
        el("button", { type: "button", class: "botao ferramenta", onclick: () => janelaMovimento("suprimento", recarregar) }, icone("setaCima"), el("span", { text: "Suprimento" })),
        el("button", { type: "button", class: "botao ferramenta perigo", onclick: () => janelaFechar(c, recarregar, dataHistorico) }, icone("cadeado"), el("span", { text: "Fechar caixa" })),
        linkHistorico)));
  timerCaixa = setTimeout(() => { if (location.hash === "#/caixa" && !janela.open && estadoCaixa.aba !== "vender") telaCaixa().catch(() => {}); }, 30000);
}

// Aba "Cobrar atendimento": fila de hoje + atendimento sem horário.
async function abaCobrar(recarregar) {
  const [{ atendimentos, profissionais }] = await Promise.all([api("/caixa/atendimentos"), carregarServicos()]);
  const aCobrar = atendimentos.filter(a => a.situacao === "agendado");
  const pagos = atendimentos.filter(a => a.situacao === "finalizado");
  const tabela = s => s.reduce((t, x) => t + (x.precoCentavos || 0), 0);
  const cobrar = a => janelaFinalizar(a, { endpoint: "/caixa/cobrar", aoTerminar: recarregar, titulo: `Concluir atendimento de ${a.cliente.nome}` });
  const quando = a => (a.atrasado ? `${dataBR(a.data).slice(0, 5)} ${a.inicio}` : a.inicio);
  const ticket = a => el("div", { class: `ticket-at ${a.situacao === "finalizado" ? "pago" : ""} ${a.atrasado ? "atrasado" : ""}`, "data-cobrar": a.cliente.nome },
    el("span", { class: "hora", text: quando(a) }),
    el("div", { class: "dados" }, el("strong", { text: a.cliente.nome }), el("span", { text: `${a.barbeiro} · ${a.servicos.map(x => x.nome).join(" + ")}${a.atrasado ? " · ficou sem cobrar" : ""}` })),
    a.situacao === "finalizado"
      ? el("span", { class: "etiqueta verde", text: `Pago ${reais(a.totalCentavos)}` })
      : [el("span", { class: "valor", text: reais(tabela(a.servicos)) }), botao("Cobrar", () => cobrar(a), "pequeno principal")]);
  return el("div", { class: "pdv-cobrar" },
    el("div", { class: "pdv-concluir" },
      botao("✓ Concluir atendimento", () => janelaConcluir(aCobrar, profissionais, cobrar, recarregar), "principal grande-acao"),
      botao("+ Atendimento sem horário", () => janelaAvulso(profissionais, recarregar), "dourado grande-acao")),
    el("div", { class: "pdv-barra" }, el("h3", { text: `Aguardando pagamento (${aCobrar.length})` })),
    aCobrar.length ? el("div", { class: "fila" }, aCobrar.map(ticket)) : el("p", { class: "vazio", text: "Nenhum atendimento da agenda aguardando pagamento." }),
    pagos.length ? [el("h3", { class: "titulo-pagos", text: `Pagos hoje (${pagos.length})` }), el("div", { class: "fila" }, pagos.map(ticket))] : null);
}

// Concluir atendimento: escolhe um horário da agenda (de hoje ou que ficou sem cobrar) e lança a entrada.
// O horário fica "Finalizado" na agenda do cliente e a comissão vai para o barbeiro.
function janelaConcluir(aCobrar, profissionais, cobrar, recarregar) {
  const busca = el("input", { type: "search", id: "concluir-busca", autocomplete: "off", placeholder: "Buscar cliente ou barbeiro", "aria-label": "Buscar atendimento" });
  const lista = el("ul", { class: "lista-concluir", "data-teste": "lista-concluir" });
  const desenhar = () => {
    const t = busca.value.trim().toLowerCase();
    const itens = aCobrar.filter(a => !t || a.cliente.nome.toLowerCase().includes(t) || a.barbeiro.toLowerCase().includes(t));
    lista.replaceChildren(...(itens.length ? itens.map(a => el("li", {},
      el("button", { type: "button", class: "concluir-opcao", "data-concluir": a.cliente.nome, onclick: () => { janela.close(); setTimeout(() => cobrar(a)); } },
        el("span", { class: "hora", text: a.atrasado ? `${dataBR(a.data).slice(0, 5)} ${a.inicio}` : a.inicio }),
        el("span", { class: "dados" }, el("strong", { text: a.cliente.nome }), el("small", { text: `${a.barbeiro} · ${a.servicos.map(x => x.nome).join(" + ")}` })),
        el("strong", { class: "valor", text: reais(a.servicos.reduce((x, s) => x + (s.precoCentavos || 0), 0)) }))))
      : [el("li", { class: "suave sem-resultado", text: aCobrar.length ? "Nenhum atendimento com esse nome." : "Nenhum horário da agenda aguardando pagamento." })]));
  };
  busca.addEventListener("input", desenhar);
  desenhar();
  return abrirJanela("Concluir atendimento", [
    el("p", { class: "suave", text: "Escolha o atendimento que o barbeiro terminou. Depois confira o valor e a forma de pagamento: o horário fica concluído na agenda." }),
    aCobrar.length > 4 ? busca : null,
    lista,
    el("p", { class: "suave centro" }, "O cliente não estava na agenda? ",
      el("button", { type: "button", class: "link-acao", text: "Lançar atendimento sem horário", onclick: () => { janela.close(); setTimeout(() => janelaAvulso(profissionais, recarregar)); } }))
  ], { ok: "Fechar", semCancelar: true, aoConfirmar: () => true });
}

// Atendimento sem horário marcado (cliente chegou na hora): registra e já cobra.
function janelaAvulso(profissionais, recarregar) {
  const servicos = servicosCache || [];
  const avulsoCampos = el("div", { class: "cliente-avulso" },
    el("p", { class: "separador-ou", text: "ou cliente novo / avulso" }),
    campo("Telefone do cliente (WhatsApp) — opcional", { name: "aTel", inputmode: "tel", autocomplete: "off" }),
    campo("Nome do cliente — opcional", { name: "aNome", autocomplete: "off" }, "Sem nome e sem telefone, fica como \"Cliente não identificado\"."),
    Object.assign(caixaMarcar("O cliente aceita que o telefone seja usado para o atendimento (LGPD)", { name: "aLgpd" }), { hidden: true }));
  const seletor = seletorCliente({ id: "av-cli", aoMudar: c => { avulsoCampos.hidden = Boolean(c); } });
  const linhas = servicos.map(s => {
    const chk = el("input", { type: "checkbox", name: "aserv", value: s.id, id: `av-${s.id}` });
    const valor = el("input", { type: "text", inputmode: "decimal", value: centavosParaTexto(s.precoCentavos), "aria-label": `Valor cobrado de ${s.nome}` });
    return { s, chk, valor, el: el("div", { class: "linha-servico" }, el("div", { class: "marcar" }, chk, el("label", { for: `av-${s.id}`, text: s.nome })), valor) };
  });
  const totalEl = el("p", { class: "total-final", "data-teste": "total" });
  const total = () => linhas.filter(l => l.chk.checked).reduce((t, l) => t + (paraCentavos(l.valor.value) ?? 0), 0);
  const pag = blocoPagamento(total);
  const promessa = abrirJanela("Atendimento sem horário", [
    campo("Quem atendeu", { tag: "select", name: "prof", opcoes: profissionais.map(p => [p.id, p.nome]) }),
    el("div", { class: "lista-servicos" }, linhas.map(l => l.el)),
    totalEl,
    el("fieldset", { class: "servicos-escolha bloco-cliente" }, el("legend", { text: "Cliente" }), seletor.el, avulsoCampos),
    ...pag.elementos
  ], {
    ok: "Cobrar",
    aoConfirmar: async f => {
      const itens = [];
      for (const l of linhas.filter(x => x.chk.checked)) {
        const v = paraCentavos(l.valor.value);
        if (v === null) throw new Error(`Valor de ${l.s.nome} inválido.`);
        itens.push({ servicoId: l.s.id, precoCobradoCentavos: v });
      }
      if (!itens.length) throw new Error("Marque pelo menos um serviço.");
      if (pag.temNota() && !seletor.escolhido()) throw new Error("Para lançar promissória, o cliente precisa estar cadastrado na base de clientes. Busque e escolha o cliente na lista (cliente avulso não pode ficar na nota).");
      await api("/caixa/atendimento-avulso", {
        metodo: "POST",
        corpo: { barbeiroId: f.prof.value, itens, pagamentos: pag.ler(f),
          cliente: seletor.escolhido() ? { id: seletor.escolhido().id } : { telefone: f.aTel.value, nome: f.aNome.value || undefined, aceiteLgpd: f.aLgpd.checked } }
      });
      avisar(`Atendimento lançado: ${reais(total())}.`);
      recarregar();
    }
  });
  const atualizar = () => {
    totalEl.textContent = `Total: ${reais(total())}`; pag.atualizar();
    const f = janela.querySelector("form");
    f.aLgpd.closest(".marcar").hidden = !f.aTel.value.replace(/\D/g, "");   // aceite só se houver telefone
  };
  janela.querySelector("form").addEventListener("input", atualizar);
  janela.querySelector("form").addEventListener("change", atualizar);
  atualizar();
  return promessa;
}

// Aba "Vender produto": produtos em botões grandes + carrinho com pagamento.
async function abaVender(recarregar) {
  const produtos = (await api("/produtos")).produtos.filter(p => !p.usoInterno && (p.disponivel ?? p.ativo));
  const carrinho = estadoCaixa.carrinho;
  for (const id of [...carrinho.keys()]) if (!produtos.some(p => p.id === id)) carrinho.delete(id);
  const saldoDe = p => p.saldo ?? 999;
  const bruto = () => produtos.reduce((t, p) => t + (carrinho.get(p.id) || 0) * p.precoCentavos, 0);
  // Desconto em %: o sistema calcula o valor e o total final (o servidor confere o mesmo cálculo).
  const descontoInput = el("input", { type: "text", id: "c-desconto", name: "desconto", inputmode: "decimal", "data-numero": "percentual", placeholder: "0", autocomplete: "off" });
  const descontoBp = () => { const v = paraBp(descontoInput.value || "0"); return v === null || v >= 10000 ? null : v; };
  const descontoValor = () => Math.round((bruto() * (descontoBp() || 0)) / 10000);
  const total = () => bruto() - descontoValor();
  const linhasEl = el("div", { class: "linhas-carrinho" });
  const totalEl = el("strong", { "data-teste": "total-venda" });
  const subtotalEl = el("span", { "data-teste": "subtotal-venda" });
  const descontoEl = el("span", { class: "valor-desconto", "data-teste": "desconto-venda" });
  const linhaSubtotal = el("div", { class: "linha-resumo" }, el("span", { text: "Subtotal" }), subtotalEl);
  const linhaDesconto = el("div", { class: "linha-resumo desconto" }, el("span", { "data-teste": "rotulo-desconto" }), descontoEl);
  const pag = blocoPagamento(total);
  // Promissória: a venda fica na nota do cliente (escolher o cliente é obrigatório).
  const seletor = seletorCliente({ id: "venda-cli" });
  const blocoNota = el("fieldset", { class: "servicos-escolha bloco-cliente", "data-teste": "cliente-nota" },
    el("legend", { text: "Cliente da nota (promissória)" }), seletor.el);
  blocoNota.hidden = true;
  const form = el("form", { class: "carrinho", "data-teste": "carrinho" },
    el("h3", {}, el("span", { text: "Venda" }), botao("Limpar", () => { carrinho.clear(); descontoInput.value = ""; desenhar(); }, "pequeno")),
    linhasEl,
    el("div", { class: "campo campo-desconto" }, el("label", { for: "c-desconto", text: "Desconto (%)" }), descontoInput),
    linhaSubtotal, linhaDesconto,
    el("div", { class: "total-carrinho" }, el("span", { text: "Total" }), totalEl),
    ...pag.elementos,
    blocoNota,
    el("button", { type: "submit", class: "botao principal", text: "Finalizar venda" }));
  const tiles = el("div", { class: "produtos-grade" }, produtos.map(p => el("button", {
    type: "button", class: "produto-tile", "data-produto-pdv": p.nome, disabled: saldoDe(p) < 1 || null,
    onclick: () => { const q = carrinho.get(p.id) || 0; if (q < saldoDe(p)) { carrinho.set(p.id, q + 1); desenhar(); } else avisar(`Só há ${saldoDe(p)} em estoque.`, "erro"); }
  }, el("strong", { text: p.nome }), el("span", { class: "preco", text: reais(p.precoCentavos) }),
    p.saldo !== undefined ? el("span", { class: "suave", text: `Estoque: ${p.saldo}` }) : null)));
  function desenhar() {
    const itens = produtos.filter(p => carrinho.get(p.id));
    linhasEl.replaceChildren(...(itens.length ? itens.map(p => el("div", { class: "linha-carrinho", "data-linha": p.nome },
      el("span", { text: p.nome }),
      el("span", { class: "qtd" },
        el("button", { type: "button", "aria-label": `Menos ${p.nome}`, text: "−", onclick: () => { const q = carrinho.get(p.id) - 1; if (q > 0) carrinho.set(p.id, q); else carrinho.delete(p.id); desenhar(); } }),
        el("span", { text: String(carrinho.get(p.id)) }),
        el("button", { type: "button", "aria-label": `Mais ${p.nome}`, text: "+", onclick: () => { const q = carrinho.get(p.id); if (q < saldoDe(p)) { carrinho.set(p.id, q + 1); desenhar(); } } })),
      el("span", { class: "preco", text: reais(carrinho.get(p.id) * p.precoCentavos) }))) : [el("p", { class: "suave", text: "Toque nos produtos para adicionar." })]));
    atualizarTotais();
  }
  function atualizarTotais() {
    const bp = descontoBp();
    const temDesconto = Boolean(bp) && bruto() > 0;
    subtotalEl.textContent = reais(bruto());
    descontoEl.textContent = `− ${reais(descontoValor())}`;
    linhaDesconto.querySelector("[data-teste=rotulo-desconto]").textContent = `Desconto (${bpParaTexto(bp || 0)}%)`;
    linhaSubtotal.hidden = !temDesconto;
    linhaDesconto.hidden = !temDesconto;
    totalEl.textContent = reais(total());
    pag.atualizar();
  }
  form.addEventListener("change", () => { blocoNota.hidden = !pag.temNota(); });
  form.addEventListener("input", atualizarTotais);
  form.addEventListener("change", atualizarTotais);
  form.addEventListener("submit", ev => {
    ev.preventDefault();
    enviar(form, async () => {
      const itens = [...carrinho.entries()].map(([produtoId, quantidade]) => ({ produtoId, quantidade }));
      if (!itens.length) throw new Error("Adicione pelo menos um produto.");
      const bp = descontoBp();
      if (bp === null) throw new Error("Desconto inválido: use um número de 0 a 99 (ex.: 10 ou 7,5).");
      const valor = total();
      const naNota = pag.temNota();
      if (naNota && !seletor.escolhido()) throw new Error("Para lançar promissória, o cliente precisa estar cadastrado na base de clientes. Escolha o cliente da nota na lista.");
      await api("/vendas", { metodo: "POST", corpo: { itens, pagamentos: pag.ler(form), ...(bp ? { descontoBp: bp } : {}), ...(naNota ? { clienteId: seletor.escolhido().id } : {}) } });
      carrinho.clear();
      avisar(bp ? `Venda registrada: ${reais(valor)} (desconto de ${bpParaTexto(bp)}%).` : `Venda registrada: ${reais(valor)}.`);
      recarregar();
    });
  });
  desenhar();
  return produtos.length
    ? el("div", { class: "pdv-grade" }, el("section", {}, tiles), form)
    : el("p", { class: "vazio", text: "Nenhum produto com estoque para vender." });
}

async function telaHistoricoCaixa() {
  const { caixas } = await api("/caixa/historico");
  mostrar(cabecalho("Caixas de outros dias", "Toque num dia para ver os lançamentos e o fechamento.", "#/caixa"),
    caixas.length
      ? el("ul", { class: "lista" }, caixas.map(c => el("li", { class: "item", "data-caixa-dia": c.data },
        el("a", { class: "item-link", href: `#/caixa-dia/${c.data}` },
          el("div", { class: "item-topo" },
            el("strong", { text: `${DIAS[diaDaSemana(c.data)]}, ${dataBR(c.data)}` }),
            el("span", { class: `etiqueta ${c.situacao === "aberto" ? "amarela" : ""}`, text: c.situacao === "aberto" ? "Aberto" : "Fechado" })),
          el("p", { class: "suave", text: [
            `Entradas ${reais(c.entradasCentavos)}`,
            c.diferencaCentavos === null ? null : c.diferencaCentavos === 0 ? "sem diferença" : c.diferencaCentavos > 0 ? `sobra ${reais(c.diferencaCentavos)}` : `falta ${reais(-c.diferencaCentavos)}`
          ].filter(Boolean).join(" · ") })))))
      : el("p", { class: "vazio", text: "Nenhum caixa ainda." }));
}

// ---------- ESTOQUE (gestão) ----------
const NOME_AVISO = { repor: ["Repor", "vermelha"], vencendo: ["Vencendo", "amarela"], vencido: ["Vencido", "vermelha"] };

async function telaEstoque() {
  const { produtos, motivosAjuste } = await api("/estoque");
  const ativos = produtos.filter(p => p.ativo);
  const estado = estadoEstoque;
  const ul = el("ul", { class: "lista-x" });
  const filtros = { todos: () => true, venda: p => !p.usoInterno, uso: p => p.usoInterno, atencao: p => p.avisos.length };
  const desenhar = () => {
    const t = normalizar(estado.busca);
    const vis = ativos.filter(p => (filtros[estado.filtro] || filtros.todos)(p) && (!t || normalizar(p.nome).includes(t)));
    ul.replaceChildren(...(vis.length ? vis.map(p => itemExpansivel({
      chave: `e:${p.id}`, attrs: { "data-estoque": p.nome },
      titulo: [p.nome, p.usoInterno ? el("span", { class: "etiqueta roxa", text: "Uso da barbearia" }) : null],
      sub: [`Mínimo ${p.estoqueMinimo}`, `custo médio ${p.custoMedioCentavos ? reais(p.custoMedioCentavos) : "—"}`].join(" · "),
      direita: [p.avisos.map(a => el("span", { class: `etiqueta ${NOME_AVISO[a][1]}`, text: NOME_AVISO[a][0] })), el("span", { class: "saldo", "data-teste": "saldo", text: `${p.saldo} un.` })],
      detalhes: () => [
        el("p", { class: "suave", text: [
          p.usoInterno ? "Não é vendido" : `Preço ${reais(p.precoCentavos)}`,
          `Custo médio ${p.custoMedioCentavos ? reais(p.custoMedioCentavos) : "—"}`,
          p.margemBp === null ? null : `Margem ${pct(p.margemBp)}`,
          p.validade ? `Validade ${dataBR(p.validade)}` : null
        ].filter(Boolean).join(" · ") }),
        acoesItem(
          botao("Entrada", () => janelaEntrada(p), "pequeno principal"),
          p.usoInterno ? botao("Usei (dar baixa)", () => janelaAjuste(p, motivosAjuste, "uso_interno"), "pequeno") : null,
          botao("Ajuste", () => janelaAjuste(p, motivosAjuste), "pequeno"),
          botao("Histórico", () => janelaHistorico(p), "pequeno"))
      ]
    })) : [el("li", { class: "vazio", text: ativos.length ? "Nada encontrado." : "Nada no estoque ainda. Cadastre um material de uso (+ Material de uso) ou um produto para vender em Produtos." })]));
  };
  desenhar();
  const avisos = ativos.filter(p => p.avisos.length);
  telaLista({
    titulo: "Estoque", subtitulo: "Toque no item para lançar entrada, baixa, ajuste ou ver o histórico.",
    topo: [
      avisos.length ? el("p", { class: "info", "data-teste": "avisos-estoque", text: `Atenção: ${avisos.map(p => `${p.nome} (${p.avisos.map(a => NOME_AVISO[a][0].toLowerCase()).join(", ")})`).join(" · ")}` }) : null,
      el("div", { class: "acoes-topo" },
        botao("+ Material de uso", () => janelaMaterial(), "principal"),
        botao("Inventário (contagem)", () => janelaInventario(ativos), ""))
    ],
    barra: barraBusca({ placeholder: "Buscar no estoque", filtros: [["todos", "Todos"], ["venda", "Para vender"], ["uso", "Uso da barbearia"], ["atencao", "Atenção"]], estado, aoMudar: desenhar }),
    lista: ul
  });
}
const estadoEstoque = { busca: "", filtro: "todos" };

// Material de uso da barbearia (lâminas, cremes…): entra no estoque, não é vendido.
function janelaMaterial() {
  return abrirJanela("Novo material de uso", [
    el("p", { class: "suave", text: "Para controlar o que a barbearia usa no dia a dia. Não aparece para vender." }),
    campo("Nome do material", { name: "mNome", required: true, minlength: "2", maxlength: "80", autocomplete: "off", placeholder: "Ex.: Lâmina descartável" }),
    el("div", { class: "lado-a-lado" },
      campo("Quantidade que já tem (opcional)", { name: "mQtd", type: "number", min: "0", inputmode: "numeric" }),
      campo("Custo de cada um (R$)", { name: "mCusto", inputmode: "decimal" })),
    el("div", { class: "lado-a-lado" },
      campo("Avisar quando ficar abaixo de", { name: "mMin", type: "number", min: "0", inputmode: "numeric", value: "0" }),
      campo("Validade (opcional)", { name: "mVal", type: "date" })),
    campo("Código (opcional)", { name: "mCod", maxlength: "40", autocomplete: "off" })
  ], {
    ok: "Cadastrar material",
    aoConfirmar: async f => {
      const q = parseInt(f.mQtd.value || "0", 10);
      let estoqueInicial;
      if (q > 0) {
        const c = paraCentavos(f.mCusto.value || "0");
        if (c === null) throw new Error("Custo inválido. Exemplo: 0,35");
        estoqueInicial = { quantidade: q, custoUnitCentavos: c };
      }
      await api("/estoque/material", { metodo: "POST", corpo: { nome: f.mNome.value.trim(), codigo: f.mCod.value.trim() || null,
        estoqueMinimo: parseInt(f.mMin.value || "0", 10) || 0, validade: f.mVal.value || null, ...(estoqueInicial ? { estoqueInicial } : {}) } });
      avisar("Material cadastrado no estoque.");
      telaEstoque();
    }
  });
}

function janelaEntrada(p) {
  return abrirJanela(`Entrada de ${p.nome}`, [
    el("p", { class: "suave", text: `Estoque atual: ${p.saldo} · custo médio ${p.custoMedioCentavos ? reais(p.custoMedioCentavos) : "—"}` }),
    el("div", { class: "lado-a-lado" },
      campo("Quantidade", { name: "qtd", type: "number", min: "1", inputmode: "numeric", required: true }),
      campo("Custo unitário (R$)", { name: "custo", inputmode: "decimal", required: true })),
    campo("Fornecedor (opcional)", { name: "forn", maxlength: "80", autocomplete: "off" }),
    campo("Validade (opcional)", { name: "val", type: "date" })
  ], {
    ok: "Registrar entrada",
    aoConfirmar: async f => {
      const custo = paraCentavos(f.custo.value);
      if (custo === null) throw new Error("Custo inválido. Exemplo: 22,50");
      const r = await api("/estoque/entrada", { metodo: "POST", corpo: { produtoId: p.id, quantidade: parseInt(f.qtd.value, 10), custoUnitCentavos: custo, fornecedor: f.forn.value || null, validade: f.val.value || null } });
      avisar(`Entrada registrada. Novo custo médio: ${reais(r.produto.custoMedioCentavos)}.`);
      telaEstoque();
    }
  });
}

function janelaAjuste(p, motivos, motivoPadrao = null) {
  return abrirJanela(motivoPadrao === "uso_interno" ? `Usei ${p.nome}` : `Ajuste de ${p.nome}`, [
    el("p", { class: "suave", text: `Estoque atual: ${p.saldo}. Perda, vencimento, quebra e uso interno são saídas.` }),
    campo("Motivo", { tag: "select", name: "motivoAj", opcoes: Object.entries(motivos), valor: motivoPadrao }),
    campo("Quantidade", { name: "qtd", type: "number", min: "1", inputmode: "numeric", required: true }),
    caixaMarcar("É entrada (só para correção de contagem)", { name: "entra" }),
    campo("Observação (opcional)", { name: "obsAj", maxlength: "200" })
  ], {
    ok: "Registrar ajuste",
    aoConfirmar: async f => {
      const q = parseInt(f.qtd.value, 10);
      if (!q || q < 1) throw new Error("Quantidade inválida.");
      await api("/estoque/ajuste", { metodo: "POST", corpo: { produtoId: p.id, motivo: f.motivoAj.value, quantidade: f.entra.checked ? q : -q, observacao: f.obsAj.value || null } });
      avisar("Ajuste registrado.");
      telaEstoque();
    }
  });
}

const NOME_MOV = { entrada: "Entrada", venda: "Venda", cancelamento_venda: "Venda cancelada", ajuste: "Ajuste", inventario: "Inventário" };
async function janelaHistorico(p) {
  const h = await api(`/estoque/historico?produtoId=${p.id}`);
  return abrirJanela(`Histórico de ${p.nome}`, [
    el("p", { class: "suave", text: `Saldo atual: ${h.produto.saldo}` }),
    h.movimentos.length
      ? el("ul", { class: "lista historico" }, h.movimentos.map(m => el("li", { class: "item" },
        el("div", { class: "item-topo" },
          el("strong", { text: NOME_MOV[m.tipo] }),
          el("span", { class: `preco ${m.quantidade < 0 ? "negativo" : ""}`, text: `${m.quantidade > 0 ? "+" : ""}${m.quantidade}` })),
        el("p", { class: "suave", text: [
          dataBR(m.em.slice(0, 10)), m.usuario,
          m.tipo === "entrada" ? `custo ${reais(m.custoUnitCentavos)} · médio ${reais(m.custoMedioAposCentavos)}` : null,
          m.fornecedor, m.validade ? `validade ${dataBR(m.validade)}` : null, m.motivo
        ].filter(Boolean).join(" · ") }))))
      : el("p", { class: "suave", text: "Sem movimentos." })
  ], { ok: "Fechar", semCancelar: true, aoConfirmar: () => true });
}

function janelaInventario(produtos) {
  const linhas = produtos.map(p => {
    const inp = el("input", { type: "number", min: "0", inputmode: "numeric", name: `c-${p.id}`, value: String(p.saldo), "aria-label": `Contado de ${p.nome}` });
    const dif = el("span", { class: "alterado" });
    return { p, inp, dif, el: el("div", { class: "linha-servico", "data-inventario": p.nome }, el("span", { text: `${p.nome} (sistema: ${p.saldo})` }), inp, dif) };
  });
  const promessa = abrirJanela("Inventário", [
    el("p", { class: "suave", text: "Digite quanto tem de cada produto na prateleira. O sistema mostra a diferença e ajusta." }),
    el("div", { class: "lista-servicos" }, linhas.map(l => l.el)),
    campo("Motivo", { name: "motivoInv", required: true, minlength: "3", value: "Contagem de estoque" })
  ], {
    ok: "Ajustar estoque",
    aoConfirmar: async f => {
      const itens = linhas.map(l => ({ produtoId: l.p.id, contado: parseInt(l.inp.value, 10) }));
      if (itens.some(i => !Number.isInteger(i.contado) || i.contado < 0)) throw new Error("Contagem inválida.");
      const r = await api("/estoque/inventario", { metodo: "POST", corpo: { itens, motivo: f.motivoInv.value } });
      avisar(r.ajustados ? `${r.ajustados} produto(s) ajustado(s).` : "Contagem confere: nada a ajustar.");
      telaEstoque();
    }
  });
  const atualizar = () => {
    for (const l of linhas) {
      const d = (parseInt(l.inp.value, 10) || 0) - l.p.saldo;
      l.dif.textContent = d === 0 ? "" : `diferença ${d > 0 ? "+" : ""}${d}`;
    }
  };
  janela.querySelector("form").addEventListener("input", atualizar);
  atualizar();
  return promessa;
}

// ---------- ARQUIVOS: compartilhar (celular) ou baixar (computador) ----------
function blobDeBase64(b64, tipo) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: tipo });
}
function baixar(nome, blob) {
  const url = URL.createObjectURL(blob);
  const a = el("a", { href: url, download: nome, class: "oculto" });
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 2000);
}
const ehCelular = () => window.matchMedia("(pointer: coarse)").matches;
// No celular abre o "Compartilhar" (WhatsApp, e-mail…); no computador baixa os arquivos.
async function compartilharOuBaixar(arquivos, titulo) {
  const files = arquivos.map(([nome, blob]) => new File([blob], nome, { type: blob.type }));
  if (ehCelular() && navigator.canShare?.({ files })) {
    try { await navigator.share({ files, title: titulo }); return "compartilhado"; } catch (e) { if (e.name === "AbortError") return "cancelado"; }
  }
  for (const [nome, blob] of arquivos) baixar(nome, blob);
  return "baixado";
}
async function baixarPlanilha(caminho, nome) {
  const resp = await fetch(`/api${caminho}`, { headers: { Authorization: `Bearer ${localStorage.getItem(CHAVE_TOKEN)}` } });
  if (!resp.ok) throw new Error((await resp.json().catch(() => ({}))).erro || "Não foi possível gerar a planilha.");
  return compartilharOuBaixar([[nome, await resp.blob()]], nome);
}

// ---------- GRÁFICOS EM SVG (sem biblioteca; CSP permite atributos em SVG) ----------
const SVG_NS = "http://www.w3.org/2000/svg";
function svg(tag, attrs = {}, ...filhos) {
  const e = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== null && v !== undefined) e.setAttribute(k, String(v));
  e.append(...filhos.filter(Boolean));
  return e;
}
const reaisCurto = c => (c >= 100000 ? `${Math.round(c / 100000)} mil` : reais(c).replace("R$", "").trim().replace(/,00$/, ""));

function graficoBarras(dados) {
  const L = 640, A = 220, ME = 8, MB = 34, MT = 20;
  const max = Math.max(1, ...dados.map(d => d.valorCentavos));
  const largura = (L - ME * 2) / dados.length;
  const poucos = dados.length <= 7;
  return svg("svg", { viewBox: `0 0 ${L} ${A}`, class: "grafico", role: "img", "aria-label": "Faturamento por dia" },
    svg("line", { x1: ME, y1: A - MB, x2: L - ME, y2: A - MB, class: "eixo" }),
    ...dados.flatMap((d, i) => {
      const h = Math.round(((A - MB - MT) * d.valorCentavos) / max);
      const x = ME + i * largura + largura * 0.15;
      const w = largura * 0.7;
      const rotulo = poucos || i % 5 === 4 || i === dados.length - 1;
      return [
        svg("rect", { x, y: A - MB - h, width: w, height: Math.max(h, d.valorCentavos ? 2 : 0), rx: 3, class: "barra" },
          svg("title", {}, `${dataBR(d.data)}: ${reais(d.valorCentavos)}`)),
        poucos && d.valorCentavos ? svg("text", { x: x + w / 2, y: A - MB - h - 5, "text-anchor": "middle", class: "rotulo-valor" }, reaisCurto(d.valorCentavos)) : null,
        rotulo ? svg("text", { x: x + w / 2, y: A - MB + 16, "text-anchor": "middle", class: "rotulo" }, poucos ? `${DIAS_CURTO[diaDaSemana(d.data)]} ${d.data.slice(8)}` : d.data.slice(8)) : null
      ];
    }));
}

// Ranking com barras de progresso (sem estilo inline; legível no celular).
function graficoRanking(lista) {
  const max = Math.max(1, ...lista.map(r => r.faturamentoCentavos));
  return el("ol", { class: "ranking" }, lista.map((r, i) => el("li", { class: i === 0 ? "primeiro" : "", "data-ranking": r.nome },
    el("div", { class: "ranking-topo" }, el("strong", { text: `${i + 1}º ${r.nome}` }), el("span", { text: `${reais(r.faturamentoCentavos)} · ${r.atendimentosQtd} atend.` })),
    el("progress", { max: String(max), value: String(r.faturamentoCentavos), "aria-label": `Faturamento de ${r.nome}` }))));
}

// ---------- PAINEL DO GERENTE ----------
let periodoPainel = "hoje";
function filtroPeriodo(atual, aoMudar) {
  return el("div", { class: "alterna filtro-periodo", role: "group", "aria-label": "Período" },
    [["hoje", "Hoje"], ["semana", "Semana"], ["mes", "Mês"]].map(([v, t]) =>
      botao(t, () => aoMudar(v), `pequeno ${atual === v ? "ativo" : ""}`)));
}
function cartao(titulo, valor, detalhe = null, classe = "", teste = null) {
  return el("div", { class: `cartao-num ${classe}`, "data-cartao": teste || titulo },
    el("span", { class: "cartao-tit", text: titulo }),
    el("strong", { text: valor }),
    detalhe ? el("span", { class: "suave", text: detalhe }) : null);
}

async function telaPainel() {
  const p = await api(`/painel?periodo=${periodoPainel}`);
  const c = p.cartoes;
  const av = p.avisos;
  const avisos = [
    ...av.caixasAbertosDiasAnteriores.map(d => ["vermelha", `Caixa de ${dataBR(d)} ainda aberto`]),
    ...av.diferencasCaixa.map(d => ["vermelha", `Diferença no caixa de ${dataBR(d.data)}: ${d.diferencaCentavos > 0 ? "sobra" : "falta"} de ${reais(Math.abs(d.diferencaCentavos))}`]),
    av.valoresAlterados ? ["amarela", `${av.valoresAlterados} atendimento(s) com valor alterado (veja na agenda)`] : null,
    ...av.estoqueBaixo.map(n => ["amarela", `Estoque baixo: ${n}`]),
    ...av.produtosVencendo.map(n => ["amarela", `Produto vencendo: ${n}`]),
    av.notasAbertas?.notas ? ["amarela", `Notas em aberto (promissória): ${av.notasAbertas.clientes} cliente(s) · ${reais(av.notasAbertas.totalCentavos)}`] : null
  ].filter(Boolean);
  const textoPeriodo = p.periodo.ini === p.periodo.fim ? dataBR(p.periodo.ini) : `${dataBR(p.periodo.ini)} a ${dataBR(p.periodo.fim)}`;
  mostrar(
    cabecalho("Painel", textoPeriodo),
    filtroPeriodo(periodoPainel, v => { periodoPainel = v; telaPainel(); }),
    el("div", { class: "cartoes" },
      cartao("Faturamento bruto", reais(c.brutoCentavos), `Serviços ${reais(c.atendimentosCentavos)} · produtos ${reais(c.vendasCentavos)}`, "", "bruto"),
      cartao("Atendimentos", String(c.atendimentosQtd), `Ticket médio ${reais(c.ticketMedioCentavos)}`, "", "atendimentos"),
      cartao("Vendas de produtos", reais(c.vendasCentavos), `${c.vendasQtd} venda(s) · ${c.unidadesVendidas} un.`, "", "vendas"),
      cartao("Comissões", reais(c.comissoesCentavos), c.comissoesPorBarbeiro.filter(b => b.comissaoCentavos).map(b => `${b.nome.split(" ")[0]} ${reais(b.comissaoCentavos)}`).join(" · ") || "—", "", "comissoes"),
      cartao("Gastos com pessoal", reais(c.pessoalCentavos || 0), `Comissões ${reais(c.comissoesCentavos)} · salários pagos ${reais(c.salariosCentavos || 0)}`, "", "pessoal"),
      cartao("Lucro", reais(c.lucroCentavos),
        p.periodo.nome === "mes" ? `Bruto − comissões − custo dos produtos (${reais(c.custoProdutosCentavos)}) − contas pagas (${reais(c.contasPagasCentavos)})`
          : `Bruto − comissões − custo dos produtos (${reais(c.custoProdutosCentavos)})`, c.lucroCentavos < 0 ? "negativo" : "positivo", "lucro"),
      el("a", { class: "cartao-num contas-cartao", href: "#/contas", "data-cartao": "contas" },
        el("span", { class: "cartao-tit", text: "Contas a pagar" }),
        el("span", { class: `linha-conta ${p.contas.atrasadas.qtd ? "vermelha" : ""}`, text: `Atrasadas: ${p.contas.atrasadas.qtd} · ${reais(p.contas.atrasadas.totalCentavos)}` }),
        el("span", { class: `linha-conta ${p.contas.hoje.qtd ? "amarela" : ""}`, text: `Vencem hoje: ${p.contas.hoje.qtd} · ${reais(p.contas.hoje.totalCentavos)}` }),
        el("span", { class: "linha-conta", text: `Próximos 7 dias: ${p.contas.proximos7Dias.qtd} · ${reais(p.contas.proximos7Dias.totalCentavos)}` }))),
    avisos.length ? el("section", { class: "cartao avisos" }, el("h3", { text: "Avisos" }),
      el("ul", { class: "lista-avisos" }, avisos.map(([cor, t]) => el("li", { class: `aviso-${cor}`, text: t })))) : null,
    el("div", { class: "duas-colunas iguais" },
      el("section", { class: "cartao" }, el("h3", { text: `Faturamento por dia (R$, ${p.faturamentoPorDia.length} dias)` }), p.faturamentoPorDia.some(d => d.valorCentavos) ? graficoBarras(p.faturamentoPorDia) : el("p", { class: "vazio", text: "Ainda não há faturamento nestes dias. O gráfico aparece com os primeiros atendimentos." })),
      el("section", { class: "cartao" }, el("h3", { text: "Ranking (atendimentos no período)" }),
        p.ranking.length ? graficoRanking(p.ranking) : el("p", { class: "vazio", text: "Sem atendimentos no período." }))));
}

// ---------- RELATÓRIO FINANCEIRO (gestão): entradas e saídas por dia, semana, mês e ano ----------
// Cores das séries: --serie-entrada (azul) e --serie-saida (laranja), validadas para daltonismo e nos dois temas.
const estadoFin = { periodo: "mes", data: null, filtroMov: "todos", movVisiveis: 30 };
const NOME_ANTERIOR = { dia: "o dia anterior", semana: "a semana anterior", mes: "o mês anterior", ano: "o ano anterior" };
const NO_ANTERIOR = { dia: "no dia anterior", semana: "na semana anterior", mes: "no mês anterior", ano: "no ano anterior" };
const AO_ANTERIOR = { dia: "ao dia anterior", semana: "à semana anterior", mes: "ao mês anterior", ano: "ao ano anterior" };
const graficoLargo = () => window.matchMedia("(min-width: 700px)").matches;
const MESES_CURTO = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const NOME_FORMA_FIN = { dinheiro: "Dinheiro", pix: "Pix", debito: "Débito", credito: "Crédito", promissoria: "Nota (a receber)" };

function moverData(data, tipo, n) {
  const d = new Date(`${data}T12:00:00Z`);
  if (tipo === "dia") d.setUTCDate(d.getUTCDate() + n);
  else if (tipo === "semana") d.setUTCDate(d.getUTCDate() + 7 * n);
  else if (tipo === "mes") { d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() + n); }
  else d.setUTCFullYear(d.getUTCFullYear() + n);
  return d.toISOString().slice(0, 10);
}
const rotuloChave = (chave, porMes) => (porMes ? `${MESES[Number(chave.slice(5, 7)) - 1]} de ${chave.slice(0, 4)}` : `${DIAS_CURTO[diaDaSemana(chave)]} ${dataBR(chave)}`);

// Variação contra o período anterior: seta + texto (a cor só reforça; "bom" depende do número).
function variacao(atual, anterior, tipo, subirEhBom = true) {
  if (!anterior && !atual) return el("span", { class: "variacao", text: `Igual a ${NOME_ANTERIOR[tipo]}` });
  if (!anterior) return el("span", { class: "variacao", text: `Sem movimento ${NO_ANTERIOR[tipo]}` });
  const pct = Math.round(((atual - anterior) / Math.abs(anterior)) * 100);
  if (pct === 0) return el("span", { class: "variacao", text: `Igual a ${NOME_ANTERIOR[tipo]}` });
  const bom = (pct > 0) === subirEhBom;
  return el("span", { class: `variacao ${bom ? "var-boa" : "var-ruim"}`, "data-variacao": String(pct),
    text: `${pct > 0 ? "▲" : "▼"} ${Math.abs(pct)}% em relação ${AO_ANTERIOR[tipo]}` });
}
function cartaoFin(titulo, valor, detalhe, varEl, teste, classe = "") {
  return el("div", { class: `cartao-num fin-cartao ${classe}`, "data-cartao": teste },
    el("span", { class: "cartao-tit", text: titulo }), el("strong", { text: valor }),
    detalhe ? el("span", { class: "suave", text: detalhe }) : null, varEl || null);
}

// Barras com cantos de cima arredondados (4 px) e base reta no eixo.
function caminhoBarra(x, yBase, w, h) {
  if (h <= 0) return "";
  const r = Math.min(4, w / 2, h);
  return `M${x},${yBase}V${yBase - h + r}Q${x},${yBase - h} ${x + r},${yBase - h}H${x + w - r}Q${x + w},${yBase - h} ${x + w},${yBase - h + r}V${yBase}Z`;
}
// Escala "bonita" para o eixo: 0 até um teto redondo, com 4 divisões.
function escala(max) {
  if (max <= 0) return { teto: 100, passo: 25 };
  const bruto = max / 4;
  const pot = 10 ** Math.floor(Math.log10(bruto));
  const passo = [1, 2, 2.5, 5, 10].map(m => m * pot).find(p => p >= bruto);
  return { teto: passo * 4, passo };
}
const eixoReais = c => (Math.abs(c) >= 100000 ? `${(c / 100000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mil` : (c / 100).toLocaleString("pt-BR", { maximumFractionDigits: 0 }));

// Leitura do ponto tocado/apontado (fica abaixo do gráfico: funciona igual no celular e no computador).
function leituraGrafico() {
  return el("div", { class: "fin-leitura", "aria-live": "polite", "data-teste": "leitura" },
    el("span", { class: "suave", text: "Toque ou passe o mouse nas barras para ver os valores." }));
}

function graficoEntradasSaidas(serie, periodo, aoEscolher) {
  const pts = serie.pontos;
  const largo = graficoLargo();
  const L = largo ? 1000 : 520, A = largo ? 290 : 300, ME = largo ? 58 : 66, MD = 8, MT = 12, MB = 32;
  const max = Math.max(1, ...pts.flatMap(p => [p.entradasCentavos, p.saidasCentavos]));
  const { teto, passo } = escala(max);
  const larg = (L - ME - MD) / pts.length;
  const w = Math.max(2, Math.min(22, (larg - 6) / 2));
  const y = v => A - MB - ((A - MB - MT) * v) / teto;
  const muitos = pts.length > 12;
  const leitura = leituraGrafico();
  const faixas = [];
  const mostrarPonto = (i) => {
    const p = pts[i];
    faixas.forEach((f, j) => f.classList.toggle("ativa", i === j));
    leitura.replaceChildren(...[
      el("strong", { text: rotuloChave(p.chave, serie.porMes) }),
      el("span", { class: "fin-leg-item" }, el("i", { class: "marca-entrada" }), `Entradas ${reais(p.entradasCentavos)}`),
      el("span", { class: "fin-leg-item" }, el("i", { class: "marca-saida" }), `Saídas ${reais(p.saidasCentavos)}`),
      el("span", { class: "fin-leg-item", text: `Saldo ${reais(p.entradasCentavos - p.saidasCentavos)}` }),
      aoEscolher && !(periodo.tipo === "dia" && p.chave === periodo.ini)
        ? botao(serie.porMes ? "Ver este mês" : "Ver este dia", () => aoEscolher(p.chave), "pequeno") : null
    ].filter(Boolean));
  };
  const grade = [];
  for (let v = 0; v <= teto; v += passo) {
    grade.push(svg("line", { x1: ME, y1: y(v), x2: L - MD, y2: y(v), class: v ? "grade" : "eixo" }));
    grade.push(svg("text", { x: ME - 6, y: y(v) + 5, "text-anchor": "end", class: "rotulo" }, eixoReais(v)));
  }
  const g = svg("svg", { viewBox: `0 0 ${L} ${A}`, class: "grafico grafico-fin", role: "img", "aria-label": "Entradas e saídas por período; os valores estão também na tabela abaixo" },
    ...grade,
    ...pts.flatMap((p, i) => {
      const x0 = ME + i * larg;
      const meio = x0 + larg / 2;
      const faixa = svg("rect", { x: x0, y: MT, width: larg, height: A - MB - MT, class: "faixa", "data-ponto": p.chave });
      faixa.addEventListener("pointerenter", () => mostrarPonto(i));
      faixa.addEventListener("click", () => mostrarPonto(i));
      faixas.push(faixa);
      const rotulo = serie.porMes ? MESES_CURTO[Number(p.chave.slice(5, 7)) - 1]
        : muitos ? (i % 5 === 0 || i === pts.length - 1 ? p.chave.slice(8) : null)
          : `${DIAS_CURTO[diaDaSemana(p.chave)]} ${p.chave.slice(8)}`;
      const escolhido = periodo.tipo === "dia" && p.chave === periodo.ini;
      return [
        faixa,
        svg("path", { d: caminhoBarra(meio - w - 1, A - MB, w, A - MB - y(p.entradasCentavos)), class: "barra-entrada" }),
        svg("path", { d: caminhoBarra(meio + 1, A - MB, w, A - MB - y(p.saidasCentavos)), class: "barra-saida" }),
        rotulo ? svg("text", { x: meio, y: A - MB + 20, "text-anchor": "middle", class: `rotulo ${escolhido ? "rotulo-forte" : ""}` }, rotulo) : null
      ];
    }));
  return el("div", { class: "fin-grafico" },
    el("div", { class: "fin-legenda" },
      el("span", { class: "fin-leg-item" }, el("i", { class: "marca-entrada" }), "Entradas"),
      el("span", { class: "fin-leg-item" }, el("i", { class: "marca-saida" }), "Saídas")),
    g, leitura);
}

// Saldo acumulado (entradas − saídas somadas dia a dia / mês a mês), até hoje.
function graficoSaldo(serie, hoje) {
  const pts = [];
  let acum = 0;
  for (const p of serie.pontos) {
    if ((serie.porMes ? `${p.chave}-01` : p.chave) > hoje) break;
    acum += p.entradasCentavos - p.saidasCentavos;
    pts.push({ chave: p.chave, valor: acum });
  }
  if (pts.length < 2) return null;
  const largo = graficoLargo();
  const L = largo ? 1000 : 520, A = largo ? 240 : 260, ME = largo ? 58 : 66, MD = 12, MT = 14, MB = 16;
  const n = serie.pontos.length;
  const minV = Math.min(0, ...pts.map(p => p.valor)), maxV = Math.max(0, ...pts.map(p => p.valor));
  const { passo } = escala(Math.max(1, maxV - minV));
  const baixo = Math.floor(minV / passo) * passo, alto = Math.max(baixo + passo, Math.ceil(maxV / passo) * passo);
  const y = v => A - MB - ((A - MB - MT) * (v - baixo)) / (alto - baixo);
  const x = i => ME + ((L - ME - MD) * (i + 0.5)) / n;
  const grade = [];
  for (let v = baixo; v <= alto; v += passo) {
    grade.push(svg("line", { x1: ME, y1: y(v), x2: L - MD, y2: y(v), class: v === 0 ? "eixo" : "grade" }));
    grade.push(svg("text", { x: ME - 6, y: y(v) + 5, "text-anchor": "end", class: "rotulo" }, eixoReais(v)));
  }
  const leitura = leituraGrafico();
  leitura.firstChild.textContent = `Saldo no fim: ${reais(pts[pts.length - 1].valor)}. Toque ou passe o mouse na linha para ver cada ${serie.porMes ? "mês" : "dia"}.`;
  const marcador = svg("circle", { r: 6, class: "ponto-saldo", cx: -20, cy: -20 });
  const mostrar = i => {
    marcador.setAttribute("cx", x(i)); marcador.setAttribute("cy", y(pts[i].valor));
    leitura.replaceChildren(el("strong", { text: `Até ${rotuloChave(pts[i].chave, serie.porMes)}` }), el("span", { text: `Saldo acumulado ${reais(pts[i].valor)}` }));
  };
  const ultimo = pts[pts.length - 1];
  return el("div", { class: "fin-grafico" },
    svg("svg", { viewBox: `0 0 ${L} ${A}`, class: "grafico grafico-fin", role: "img", "aria-label": `Saldo acumulado: ${reais(ultimo.valor)} no fim` },
      ...grade,
      svg("polyline", { points: pts.map((p, i) => `${x(i)},${y(p.valor)}`).join(" "), class: "linha-saldo" }),
      marcador,
      ...pts.map((p, i) => {
        const r = svg("rect", { x: x(i) - (L - ME - MD) / n / 2, y: MT, width: (L - ME - MD) / n, height: A - MB - MT, class: "faixa" });
        r.addEventListener("pointerenter", () => mostrar(i));
        r.addEventListener("click", () => mostrar(i));
        return r;
      })),
    leitura);
}

function tabelaSerie(serie) {
  return el("details", { class: "fin-tabela" },
    el("summary", { text: "Ver os números em tabela" }),
    el("div", { class: "rolagem-x" }, el("table", { class: "tabela" },
      el("thead", {}, el("tr", {}, ...["Período", "Entradas", "Saídas", "Saldo"].map(t => el("th", { text: t })))),
      el("tbody", {}, ...serie.pontos.map(p => el("tr", {},
        el("td", { text: serie.porMes ? `${MESES_CURTO[Number(p.chave.slice(5, 7)) - 1]}/${p.chave.slice(0, 4)}` : `${DIAS_CURTO[diaDaSemana(p.chave)]} ${dataBR(p.chave)}` }),
        el("td", { class: "num", text: reais(p.entradasCentavos) }), el("td", { class: "num", text: reais(p.saidasCentavos) }),
        el("td", { class: "num", text: reais(p.entradasCentavos - p.saidasCentavos) })))))));
}

// Lista de partes com barra proporcional (progress: sem estilo inline).
function listaPartes(itens, classe, total) {
  const max = Math.max(1, ...itens.map(i => i.valor));
  const soma = total ?? itens.reduce((t, i) => t + i.valor, 0);
  return el("ul", { class: `fin-partes ${classe}` }, itens.map(i => el("li", { "data-parte": i.nome },
    el("div", { class: "ranking-topo" }, el("span", { text: i.nome }),
      el("strong", { text: `${reais(i.valor)}${soma ? ` · ${Math.round((i.valor / soma) * 100)}%` : ""}` })),
    i.detalhe ? el("span", { class: "suave pequeno", text: i.detalhe }) : null,
    el("progress", { max: String(max), value: String(Math.max(0, i.valor)), "aria-label": i.nome }))));
}

async function telaFinanceiro() {
  estadoFin.data ||= hojeLocal();
  const e = estadoFin;
  const f = await api(`/financeiro?periodo=${e.periodo}&data=${e.data}`);
  const t = f.totais, a = f.anterior, tipo = f.periodo.tipo;
  const ir = async (periodo, data) => {
    Object.assign(estadoFin, { periodo, data, movVisiveis: 30 });
    document.body.dataset.carregando = "1";   // tela sendo montada (os testes esperam por isto)
    try { await comCarga(telaFinanceiro); } catch (erro) { avisar(erro.message, "erro"); } finally { delete document.body.dataset.carregando; }
  };
  const ehAtual = f.periodo.ini <= f.periodo.hoje && f.periodo.hoje <= f.periodo.fim;
  const nomePer = { dia: "Dia", semana: "Semana", mes: "Mês", ano: "Ano" };

  const controles = el("div", { class: "fin-controles" },
    el("div", { class: "alterna", role: "group", "aria-label": "Período" },
      Object.entries(nomePer).map(([v, txt]) => botao(txt, () => ir(v, ehAtual ? f.periodo.hoje : e.data), `pequeno ${tipo === v ? "ativo" : ""}`))),
    el("div", { class: "fin-navega" },
      botao("‹", () => ir(tipo, moverData(e.data, tipo, -1)), "pequeno", ),
      el("strong", { class: "rotulo-periodo fin-titulo", "data-teste": "periodo-fin", text: tipo === "mes" ? f.periodo.titulo.replace(/^./, c => c.toUpperCase()) : f.periodo.titulo }),
      botao("›", () => ir(tipo, moverData(e.data, tipo, 1)), "pequeno"),
      ehAtual ? null : botao("Hoje", () => ir(tipo, hojeLocal()), "pequeno")));
  controles.querySelectorAll(".fin-navega .botao").forEach(b => {
    if (b.textContent === "‹") b.setAttribute("aria-label", "Período anterior");
    if (b.textContent === "›") b.setAttribute("aria-label", "Próximo período");
  });

  const sd = f.saidas, en = f.entradas, ds = f.destaques;
  const cartoes = el("div", { class: "cartoes fin-cartoes" },
    cartaoFin("Entradas", reais(t.entradasCentavos), "Dinheiro que entrou no caixa", variacao(t.entradasCentavos, a.entradasCentavos, tipo), "entradas", "fin-entrada"),
    cartaoFin("Saídas", reais(t.saidasCentavos), "Contas, compras, vales, comissões e retiradas", variacao(t.saidasCentavos, a.saidasCentavos, tipo, false), "saidas", "fin-saida"),
    cartaoFin("Saldo do período", reais(t.saldoCentavos), "Entradas − saídas", variacao(t.saldoCentavos, a.saldoCentavos, tipo), "saldo", t.saldoCentavos < 0 ? "negativo" : "positivo"),
    cartaoFin("Resultado (lucro)", reais(t.resultadoCentavos), "Faturamento − comissões − custo dos produtos − contas", variacao(t.resultadoCentavos, a.resultadoCentavos, tipo), "resultado", t.resultadoCentavos < 0 ? "negativo" : "positivo"));
  // 17/11/2026: os 4 números principais ficam à vista; os outros em "Mais números" (aberto no computador).
  const largo = window.matchMedia("(min-width: 1024px)").matches;
  const maisNumeros = el("div", { class: "cartoes fin-cartoes" },
    cartaoFin("Faturamento", reais(t.faturamentoCentavos), `Serviços ${reais(en.servicosCentavos)} · produtos ${reais(en.produtosCentavos)}`, variacao(t.faturamentoCentavos, a.faturamentoCentavos, tipo), "faturamento"),
    cartaoFin("Atendimentos", String(t.atendimentosQtd), `Ticket médio ${reais(ds.ticketMedioCentavos)}`, variacao(t.atendimentosQtd, a.atendimentosQtd, tipo), "atendimentos"),
    tipo === "dia" ? cartaoFin("Vendas de produtos", String(t.vendasQtd), reais(en.produtosCentavos), variacao(t.vendasQtd, a.vendasQtd, tipo), "vendas")
      : tipo === "ano" ? cartaoFin("Média de entradas por mês", reais(Math.round(t.entradasCentavos / (ehAtual ? Number(f.periodo.hoje.slice(5, 7)) : 12))), ehAtual ? "Até este mês" : "No ano", null, "media")
        : cartaoFin("Média de entradas por dia", reais(ds.mediaPorDiaCentavos), ehAtual ? "Até hoje" : "No período", null, "media"),
    tipo === "dia" ? cartaoFin("Notas (a receber)", reais(en.notasLancadasCentavos), `Recebidas no dia ${reais(en.notasRecebidasCentavos)}`, null, "notas")
      : cartaoFin(tipo === "ano" ? "Melhor mês" : "Melhor dia", ds.melhor ? reais(ds.melhor.entradasCentavos) : "—",
        ds.melhor ? rotuloChave(ds.melhor.chave, f.serie.porMes) : "Sem entradas ainda", null, "melhor"));
  const blocoMais = el("details", { class: "fin-mais", "data-teste": "fin-mais", open: largo || null },
    el("summary", {}, `Mais números · faturamento ${reais(t.faturamentoCentavos)} · ${t.atendimentosQtd} atendimento(s)`), maisNumeros);

  const tituloGrafico = tipo === "dia" ? "Entradas e saídas nos últimos 7 dias" : tipo === "ano" ? "Entradas e saídas por mês" : "Entradas e saídas por dia";
  const temSerie = f.serie.pontos.some(p => p.entradasCentavos || p.saidasCentavos);
  const aoEscolher = (chave) => (f.serie.porMes ? ir("mes", `${chave}-01`) : ir("dia", chave));
  const saldo = tipo === "dia" ? null : graficoSaldo(f.serie, f.periodo.hoje);

  const formas = Object.entries(en.porForma).map(([forma, v]) => ({ nome: NOME_FORMA_FIN[forma], valor: v.servicosCentavos + v.produtosCentavos + v.notasCentavos,
    detalhe: [v.servicosCentavos && `serviços ${reais(v.servicosCentavos)}`, v.produtosCentavos && `produtos ${reais(v.produtosCentavos)}`, v.notasCentavos && `notas recebidas ${reais(v.notasCentavos)}`].filter(Boolean).join(" · ") }))
    .filter(x => x.valor).sort((x, y) => y.valor - x.valor);
  const origens = [["Serviços (atendimentos)", en.servicosCentavos], ["Venda de produtos", en.produtosCentavos], ["Notas recebidas", en.notasRecebidasCentavos]]
    .map(([nome, valor]) => ({ nome, valor })).filter(x => x.valor);
  const saidas = [
    ...sd.contasPorCategoria.map(c => ({ nome: c.id === "pessoal" ? c.nome : `Conta: ${c.nome}`, valor: c.valorCentavos })),
    { nome: "Compra de mercadoria", valor: sd.comprasMercadoriaCentavos },
    { nome: "Comissões pagas", valor: sd.comissoesPagasCentavos },
    { nome: "Vales (adiantamentos)", valor: sd.valesCentavos },
    { nome: "Retiradas do caixa (sangrias avulsas)", valor: sd.retiradasCentavos }
  ].filter(x => x.valor).sort((x, y) => y.valor - x.valor);

  const r = f.resultado;
  const linhaRes = (txt, v, cls = "") => el("tr", { class: cls }, el("td", { text: txt }), el("td", { class: "num", text: reais(v) }));
  const demonstrativo = el("table", { class: "tabela fin-demonstrativo", "data-teste": "demonstrativo" },
    el("tbody", {},
      linhaRes("Faturamento (serviços + produtos)", r.brutoCentavos),
      linhaRes("− Comissões da equipe", -r.comissoesCentavos),
      linhaRes("− Custo dos produtos vendidos", -r.custoProdutosVendidosCentavos),
      linhaRes("− Contas pagas", -r.contasPagasCentavos),
      linhaRes("= Resultado (lucro)", r.resultadoCentavos, `forte ${r.resultadoCentavos < 0 ? "negativo" : "positivo"}`)));

  const profs = f.profissionais.length ? el("div", { class: "rolagem-x" }, el("table", { class: "tabela", "data-teste": "fin-profissionais" },
    el("thead", {}, el("tr", {}, ...["Pessoa", "Atend.", "Serviços", "Produtos", "Comissão", "Salário", "Custo"].map(x => el("th", { text: x })))),
    el("tbody", {}, ...f.profissionais.map(p => el("tr", { "data-pessoa-fin": p.nome }, el("td", { text: p.nome }), el("td", { class: "num", text: String(p.atendimentosQtd) }),
      el("td", { class: "num", text: reais(p.servicosCentavos) }), el("td", { class: "num", text: reais(p.produtosCentavos) }), el("td", { class: "num", text: reais(p.comissaoCentavos) }),
      el("td", { class: "num", text: reais(p.salarioCentavos || 0) }), el("td", { class: "num forte", text: reais(p.custoCentavos ?? p.comissaoCentavos) }))))))
    : el("p", { class: "vazio", text: "Sem atendimentos no período." });
  const top = (lista, un) => (lista.length ? el("ol", { class: "fin-top" }, lista.map(x => el("li", {},
    el("span", { text: x.nome }), el("span", { class: "suave", text: `${x.qtd} ${un}` }), el("strong", { text: reais(x.totalCentavos) }))))
    : el("p", { class: "vazio", text: "Nada no período." }));

  // Movimentos (mais recentes primeiro), com filtro
  const listaMov = el("div", { class: "fin-movs" });
  const desenharMov = () => {
    const filtrados = f.movimentos.filter(m => e.filtroMov === "todos" || m.classe === (e.filtroMov === "entradas" ? "entrada" : "saida"));
    const vis = filtrados.slice(0, e.movVisiveis);
    listaMov.replaceChildren(...[
      el("div", { class: "alterna", role: "group", "aria-label": "Filtrar movimentos" },
        [["todos", "Todos"], ["entradas", "Entradas"], ["saidas", "Saídas"]].map(([v, txt]) =>
          botao(txt, () => { e.filtroMov = v; e.movVisiveis = 30; desenharMov(); }, `pequeno ${e.filtroMov === v ? "ativo" : ""}`))),
      vis.length ? el("ul", { class: "fin-mov-lista" }, vis.map(m => el("li", { class: `mov-${m.classe}`, "data-mov": m.tipo },
        el("div", { class: "mov-linha" }, el("strong", { text: m.tipo }), el("strong", { class: "mov-valor", text: `${m.valorCentavos > 0 ? "+" : m.valorCentavos < 0 ? "−" : ""} ${reais(Math.abs(m.valorCentavos))}` })),
        el("span", { class: "suave", text: [dataBR(m.data), m.descricao, m.forma ? NOME_FORMA_FIN[m.forma] || m.forma : null, m.classe === "outro" ? "não entra no saldo" : null].filter(Boolean).join(" · ") }))))
        : el("p", { class: "vazio", text: "Nenhum movimento." }),
      filtrados.length > vis.length ? botao(`Mostrar mais (${filtrados.length - vis.length})`, () => { e.movVisiveis += 50; desenharMov(); }, "pequeno") : null,
      f.movimentosTotal > f.movimentos.length ? el("p", { class: "suave", text: `Mostrando os ${f.movimentos.length} mais recentes de ${f.movimentosTotal}. A lista completa está em Contador e dados (planilha).` }) : null
    ].filter(Boolean));
  };
  desenharMov();

  const secaoFixa = (titulo, ...filhos) => el("section", { class: "cartao" }, el("h3", { text: titulo }), ...filhos);
  // Demais blocos: recolhidos no celular (toque no título abre), abertos no computador. O resumo já mostra o principal.
  const secao = (titulo, resumo, id, ...filhos) => el("details", { class: "cartao fin-secao", "data-secao-fin": id, open: largo || null },
    el("summary", {}, el("span", { class: "fin-secao-tit", text: titulo }), resumo ? el("span", { class: "fin-secao-res", text: resumo }) : null), ...filhos);
  const maiorDe = l => (l[0] ? `${l[0].nome} ${reais(l[0].valor)}` : "");
  mostrar(
    cabecalho("Relatório financeiro", "Entradas, saídas e resultado da barbearia"),
    controles,
    cartoes,
    blocoMais,
    secaoFixa(tituloGrafico, temSerie ? graficoEntradasSaidas(f.serie, f.periodo, aoEscolher) : el("p", { class: "vazio", text: "Sem entradas nem saídas neste período." }), temSerie ? tabelaSerie(f.serie) : null),
    saldo ? secao("Saldo acumulado no período", `Fim: ${reais(t.saldoCentavos)}`, "saldo", saldo) : null,
    el("div", { class: "duas-colunas iguais" },
      secao("De onde veio o dinheiro", maiorDe(formas), "entradas",
        formas.length ? listaPartes(formas, "partes-entrada") : el("p", { class: "vazio", text: "Sem entradas no período." }),
        origens.length ? el("h4", { text: "Por origem" }) : null, origens.length ? listaPartes(origens, "partes-entrada") : null,
        en.notasLancadasCentavos ? el("p", { class: "suave", text: `Vendido em nota (a receber depois): ${reais(en.notasLancadasCentavos)}. Entra no faturamento, mas só vira entrada quando o cliente paga.` }) : null),
      secao("Para onde foi o dinheiro", maiorDe(saidas), "saidas",
        saidas.length ? listaPartes(saidas, "partes-saida") : el("p", { class: "vazio", text: "Sem saídas no período." }))),
    el("div", { class: "duas-colunas iguais" },
      secao("Resultado do período", reais(r.resultadoCentavos), "resultado", demonstrativo,
        el("p", { class: "suave", text: "Entradas e saídas mostram o dinheiro que passou pelo caixa. O resultado mostra se a barbearia ganhou ou perdeu no período." }),
        ds.diferencasCaixa.length ? el("ul", { class: "lista-avisos" }, ds.diferencasCaixa.map(x => el("li", { class: "aviso-vermelha",
          text: `Diferença no caixa de ${dataBR(x.data)}: ${x.diferencaCentavos > 0 ? "sobra" : "falta"} de ${reais(Math.abs(x.diferencaCentavos))}` }))) : null),
      secao("Equipe: produção e custo", f.profissionais.length ? `pessoal ${reais(f.saidas.pessoalCentavos || 0)}` : "", "profissionais", profs,
        el("p", { class: "suave", text: "Custo = comissões + salário pago no período. Para pagar a equipe: Financeiro → Pagamento da equipe." }))),
    el("div", { class: "duas-colunas iguais" },
      secao("Serviços que mais faturaram", f.maisVendidos.servicos[0]?.nome || "", "servicos", top(f.maisVendidos.servicos, "vez(es)")),
      secao("Produtos mais vendidos", f.maisVendidos.produtos[0]?.nome || "", "produtos", top(f.maisVendidos.produtos, "un."))),
    secao("Movimentos do período", `${f.movimentosTotal ?? f.movimentos.length} lançamento(s)`, "movimentos", listaMov));
}

// ---------- DESEMPENHO DO BARBEIRO (só dele) + EXTRATO ----------
let periodoDesempenho = "semana";
async function telaDesempenho() {
  const d = await api(`/desempenho?periodo=${periodoDesempenho}`);
  const pf = d.proximoFechamento;
  const mesInput = el("input", { type: "month", value: hojeLocal().slice(0, 7), "aria-label": "Mês do extrato", name: "mesExtrato" });
  const formExtrato = el("form", { class: "cartao" },
    el("h3", { text: "Extrato do mês" }),
    el("p", { class: "suave", text: "Atendimentos, comissões e vales do mês, em PDF e planilha (útil para quem é MEI)." }),
    el("div", { class: "campo" }, el("label", { for: "mes-extrato", text: "Mês" }), Object.assign(mesInput, { id: "mes-extrato" })),
    el("button", { type: "submit", class: "botao principal", text: "Baixar extrato" }));
  formExtrato.addEventListener("submit", ev => {
    ev.preventDefault();
    enviar(formExtrato, async () => {
      const e = await api(`/extrato?mes=${mesInput.value}`);
      const r = await compartilharOuBaixar([
        [`${e.arquivos.nomeBase}.pdf`, blobDeBase64(e.arquivos.pdfBase64, "application/pdf")],
        [`${e.arquivos.nomeBase}.csv`, new Blob([e.arquivos.csv], { type: "text/csv" })]
      ], "Extrato 4blade");
      if (r !== "cancelado") avisar(r === "compartilhado" ? "Extrato compartilhado." : "Extrato baixado (PDF e planilha).");
    });
  });
  mostrar(
    cabecalho("Meu desempenho", d.barbeiro.nome),
    filtroPeriodo(periodoDesempenho, v => { periodoDesempenho = v; telaDesempenho(); }),
    el("div", { class: "cartoes" },
      cartao("Atendimentos", String(d.atendimentosQtd), null, "", "atendimentos"),
      cartao("Faturamento bruto", reais(d.faturamentoCentavos), null, "", "bruto"),
      cartao("Minha comissão", reais(d.comissaoCentavos), `Serviços ${reais(d.comissaoServicoCentavos)} · produtos ${reais(d.comissaoProdutoCentavos)}`, "positivo", "comissao"),
      cartao("Vales", reais(d.valesCentavos), null, "", "vales"),
      cartao("Próximo fechamento", reais(pf.previstoCentavos), `${pf.desde ? `Desde ${dataBR(pf.desde)}: ` : ""}comissões ${reais(pf.comissoesCentavos)} − vales ${reais(pf.valesCentavos)}`, "", "proximo")),
    formExtrato);
}

// ---------- PAGAMENTO DA EQUIPE (17/11/2026) ----------
// Por mês: o que cada pessoa produziu, comissão, salário fixo, vales e quanto falta pagar. "Pagar" registra tudo de uma vez.
const estadoEquipePag = { mes: null };
const NOME_MES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const mesMais = (mes, n) => { const [a, m] = mes.split("-").map(Number); const d = new Date(Date.UTC(a, m - 1 + n, 1)); return d.toISOString().slice(0, 7); };
function janelaSalario(p, recarregar) {
  return abrirJanela(`Salário de ${p.nome}`, [
    el("p", { class: "suave", text: "Salário fixo por mês (0 = só comissão). Vale a partir do mês que ainda não foi pago. Fica registrado quem mudou." }),
    campo("Salário fixo mensal (R$)", { name: "sal", inputmode: "decimal", value: centavosParaTexto(p.salario.valorCentavos), placeholder: "0,00" })
  ], {
    ok: "Salvar salário",
    aoConfirmar: async f => {
      const v = paraCentavos(f.sal.value || "0");
      if (v === null || v < 0) throw new Error("Valor inválido. Exemplo: 1500,00");
      const r = await api("/equipe/salario", { metodo: "POST", corpo: { usuarioId: p.id, salarioCentavos: v } });
      avisar(r.mensagem); recarregar();
    }
  });
}
function janelaPagarPessoa(p, mes, titulo, recarregar) {
  const linhaCaixa = caixaMarcar("Saiu do dinheiro do caixa (vira retirada do caixa de hoje)", { name: "comCaixa" });
  const ajustar = sel => { linhaCaixa.hidden = sel.value !== "dinheiro"; if (linhaCaixa.hidden) linhaCaixa.querySelector("input").checked = false; };
  setTimeout(() => { const sel = janela.querySelector("#c-pgForma"); if (sel) { ajustar(sel); sel.addEventListener("change", () => ajustar(sel)); } }, 0);
  const a = p.aPagar;
  return abrirJanela(`Pagar ${p.nome}`, [
    el("p", { class: "destaque-valor", text: reais(Math.max(0, a.totalCentavos)) }),
    el("dl", { class: "dados-item" },
      a.salarioCentavos ? [el("dt", { text: "Salário" }), el("dd", { text: reais(a.salarioCentavos) })] : null,
      a.comissaoCentavos || p.vales.aDescontarCentavos ? [el("dt", { text: "Comissão" }), el("dd", { text: `${reais(p.comissao.abertaCentavos + p.comissao.fechadaAPagarCentavos)}${p.vales.aDescontarCentavos ? ` − vales ${reais(p.vales.aDescontarCentavos)}` : ""}` })] : null),
    el("p", { class: "suave", text: `Referente a ${titulo}. O salário vira uma despesa paga e a comissão do mês fica fechada (não muda mais).` }),
    campo("Pago com", { tag: "select", name: "pgForma", valor: "pix", opcoes: FORMAS_DESPESA }),
    linhaCaixa
  ], {
    ok: "Confirmar pagamento",
    aoConfirmar: async f => {
      const r = await api("/equipe/pagar", { metodo: "POST", corpo: { usuarioId: p.id, mes, forma: f.pgForma.value, comCaixa: f.comCaixa.checked } });
      avisar(r.mensagem); recarregar();
    }
  });
}
async function telaPagamentoEquipe() {
  const hojeMes = hojeLocal().slice(0, 7);
  estadoEquipePag.mes ||= hojeMes;
  const mes = estadoEquipePag.mes;
  const q = await api(`/equipe/pagamento?mes=${mes}`);
  const recarregar = () => telaPagamentoEquipe();
  const irMes = n => { estadoEquipePag.mes = mesMais(mes, n); comCarga(telaPagamentoEquipe).catch(e => avisar(e.message, "erro")); };
  const titulo = q.titulo;
  const navega = el("div", { class: "fin-navega", "data-teste": "mes-equipe" },
    el("button", { type: "button", class: "botao pequeno", "aria-label": "Mês anterior", text: "‹", onclick: () => irMes(-1) }),
    el("strong", { class: "rotulo-periodo fin-titulo", text: titulo.replace(/^./, c => c.toUpperCase()) }),
    el("button", { type: "button", class: "botao pequeno", "aria-label": "Próximo mês", text: "›", disabled: mes >= hojeMes || null, onclick: () => irMes(1) }));
  const T = q.totais;
  const resumo = el("div", { class: "resumo-despesas", "data-teste": "resumo-equipe" },
    el("div", { class: "resumo-item" }, el("small", { text: "Produção da equipe" }), el("strong", { text: reais(T.producaoCentavos) }), el("span", { text: "serviços + produtos" })),
    el("div", { class: "resumo-item" }, el("small", { text: "Gastos com pessoal" }), el("strong", { text: reais(T.custoCentavos) }), el("span", { text: `comissões ${reais(T.comissaoCentavos)} + salários ${reais(T.salariosCentavos)}` })),
    el("div", { class: `resumo-item ${T.aPagarCentavos ? "alerta" : "ok"}` }, el("small", { text: "Falta pagar" }), el("strong", { "data-teste": "falta-pagar", text: reais(T.aPagarCentavos) }), el("span", { text: T.aPagarCentavos ? "toque na pessoa para pagar" : "tudo pago ✔" })));
  const ul = el("ul", { class: "lista-x" }, q.pessoas.length ? q.pessoas.map(p => {
    const a = p.aPagar;
    const pago = a.totalCentavos <= 0 && (p.salario.pago || p.comissao.pagaCentavos);
    return itemExpansivel({
      chave: `eq:${p.id}:${mes}`, attrs: { "data-pessoa": p.nome }, classe: p.ativo ? "" : "inativo", avatar: iniciais(p.nome),
      titulo: p.nome, sub: `${NOME_PERFIL[p.perfil]} · produção ${reais(p.producao.totalCentavos)}`,
      direita: a.totalCentavos > 0 ? [el("span", { class: "preco", "data-teste": "a-pagar", text: reais(a.totalCentavos) }), el("span", { class: "etiqueta amarela", text: "A pagar" })]
        : el("span", { class: `etiqueta ${pago ? "verde" : ""}`, text: pago ? "Pago" : "Nada a pagar" }),
      detalhes: () => [
        el("dl", { class: "dados-item quadro-pessoa" },
          el("dt", { text: "Produção" }), el("dd", { text: `${p.producao.atendimentosQtd} atend. · serviços ${reais(p.producao.servicosCentavos)} · produtos ${reais(p.producao.produtosCentavos)}` }),
          el("dt", { text: "Comissão" }), el("dd", { text: `${reais(p.comissao.totalCentavos)} (serviços ${reais(p.comissao.servicoCentavos)} · produtos ${reais(p.comissao.produtoCentavos)})` }),
          el("dt", { text: "Salário fixo" }), el("dd", { text: p.salario.pago ? `${reais(p.salario.pago.valorCentavos)} · pago em ${dataBR(p.salario.pago.em)}` : p.salario.valorCentavos ? reais(p.salario.valorCentavos) : "Sem salário (só comissão)" }),
          el("dt", { text: "Vales" }), el("dd", { text: p.vales.totalCentavos ? `− ${reais(p.vales.totalCentavos)}${p.vales.aDescontarCentavos !== p.vales.totalCentavos ? ` (a descontar ${reais(p.vales.aDescontarCentavos)})` : ""}` : "Nenhum" }),
          p.comissao.pagaCentavos ? [el("dt", { text: "Comissão já paga" }), el("dd", { text: reais(p.comissao.pagaCentavos) })] : null,
          el("dt", { class: "forte", text: "A pagar" }), el("dd", { class: "forte", text: a.totalCentavos > 0 ? `${reais(a.totalCentavos)}${a.salarioCentavos && a.comissaoCentavos ? ` (salário ${reais(a.salarioCentavos)} + comissão ${reais(a.comissaoCentavos)})` : ""}` : "Nada" }),
          el("dt", { text: "Custo para a barbearia" }), el("dd", { text: reais(p.custoCentavos) })),
        acoesItem(
          a.totalCentavos > 0 || (a.salarioCentavos > 0) ? botao(`Pagar ${reais(Math.max(0, a.totalCentavos))}`, () => janelaPagarPessoa(p, mes, titulo, recarregar), "pequeno principal") : null,
          (usuario.perfil === "proprietario" || (p.id !== usuario.id && ["barbeiro", "caixa"].includes(p.perfil))) ? botao(p.salario.valorCentavos ? "Alterar salário" : "Definir salário", () => janelaSalario(p, recarregar), "pequeno") : null)
      ]
    });
  }) : [el("li", { class: "vazio", text: "Ninguém na equipe ainda." })]);
  mostrar(cabecalho("Pagamento da equipe", "Quanto pagar a cada um no mês: salário + comissão − vales. Toque na pessoa para ver o detalhe e pagar."),
    navega, resumo, ul,
    el("p", { class: "suave nota-rodape", text: "O salário pago entra nas despesas (\"Salários (equipe)\") e no relatório financeiro; a comissão fica fechada. Gastos com pessoal = comissões + salários." }));
}

// ---------- COMISSÕES E VALES (gestão) ----------
// 17/11/2026: tela em 3 partes simples — 1) quanto pagar a cada um no período, 2) pagamentos (fechamentos), 3) vales.
const estadoComissao = { ini: null, fim: null, atalho: "semana", filtroPag: "apagar" };
function periodoAtalho(id) {
  const ontem = somaDias(hojeLocal(), -1);
  if (id === "semana") return [somaDias(ontem, -6), ontem];
  if (id === "mes") { const fim = somaDias(`${hojeLocal().slice(0, 7)}-01`, -1); return [`${fim.slice(0, 7)}-01`, fim]; }
  if (id === "quinzena") return [somaDias(ontem, -14), ontem];
  return [estadoComissao.ini, estadoComissao.fim];
}
function janelaLancarVale(profs) {
  return abrirJanela("Lançar vale (adiantamento)", [
    el("p", { class: "suave", text: "O vale é descontado da próxima comissão do profissional." }),
    campo("Profissional", { tag: "select", name: "barb", opcoes: profs.map(p => [p.id, p.nome]) }),
    el("div", { class: "lado-a-lado" },
      campo("Valor (R$)", { name: "valor", inputmode: "decimal", required: true, placeholder: "0,00" }),
      campo("Data", { name: "dataVale", type: "date", value: hojeLocal(), required: true })),
    campo("Descrição (opcional)", { name: "desc", maxlength: "120" })
  ], {
    ok: "Lançar vale",
    aoConfirmar: async f => {
      const v = paraCentavos(f.valor.value);
      if (!v) throw new Error("Valor inválido. Exemplo: 50,00");
      await api("/vales", { metodo: "POST", corpo: { barbeiroId: f.barb.value, valorCentavos: v, data: f.dataVale.value, descricao: f.desc.value || null } });
      avisar("Vale lançado."); telaComissoes();
    }
  });
}
function janelaPagarFechamento(f) {
  return abrirJanela(`Pagar ${f.barbeiro}`, [
    el("p", { class: "destaque-valor", text: reais(f.aPagarCentavos) }),
    el("p", { class: "suave", text: `Comissão de ${dataBR(f.dataIni)} a ${dataBR(f.dataFim)}.` }),
    caixaMarcar("Saiu do dinheiro do caixa (vira retirada do caixa de hoje)", { name: "comCaixa" })
  ], {
    ok: "Registrar pagamento",
    aoConfirmar: async form => {
      await api("/comissoes/fechamentos/pagar", { metodo: "POST", corpo: { id: f.id, comCaixa: form.comCaixa.checked } });
      avisar("Pagamento registrado."); telaComissoes();
    }
  });
}
async function telaComissoes() {
  const est = estadoComissao;
  if (est.atalho !== "outro" || !est.ini) [est.ini, est.fim] = periodoAtalho(est.atalho === "outro" ? "semana" : est.atalho);
  const q = `dataIni=${est.ini}&dataFim=${est.fim}`;
  const [prev, fech, vales, ag] = await Promise.all([
    api(`/comissoes/previa?${q}`), api("/comissoes/fechamentos"),
    api(`/vales?dataIni=${somaDias(hojeLocal(), -60)}&dataFim=${hojeLocal()}`), api(`/agenda?data=${hojeLocal()}`)
  ]);

  // 1) Quanto pagar no período
  const mudar = id => { est.atalho = id; if (id !== "outro") [est.ini, est.fim] = periodoAtalho(id); telaComissoes(); };
  const chips = el("div", { class: "chips-filtro", role: "group", "aria-label": "Período" },
    [["semana", "Últimos 7 dias"], ["quinzena", "Últimos 15 dias"], ["mes", "Mês passado"], ["outro", "Outro período"]].map(([id, t]) =>
      el("button", { type: "button", class: `chip-filtro ${est.atalho === id ? "ativo" : ""}`, "data-periodo": id, text: t, onclick: () => mudar(id) })));
  const formOutro = el("form", { class: "lado-a-lado periodo-outro", hidden: est.atalho === "outro" ? null : true },
    campo("De", { name: "ini", type: "date", value: est.ini, required: true }),
    campo("Até", { name: "fim", type: "date", value: est.fim, required: true }),
    el("button", { type: "submit", class: "botao pequeno", text: "Ver período" }));
  formOutro.addEventListener("submit", ev => { ev.preventDefault(); est.atalho = "outro"; est.ini = formOutro.ini.value; est.fim = formOutro.fim.value; telaComissoes(); });
  const livres = prev.barbeiros.filter(b => !b.jaFechadoNoPeriodo);
  const total = livres.reduce((t, b) => t + b.aPagarCentavos, 0);
  const cartaoPrevia = el("section", { class: "cartao", "data-teste": "previa-comissao" },
    el("h3", { text: "1. Quanto pagar" }),
    chips, formOutro,
    el("p", { class: "suave", "data-teste": "periodo-comissao", text: `De ${dataBR(est.ini)} a ${dataBR(est.fim)}` }),
    prev.barbeiros.length
      ? [el("div", {}, prev.barbeiros.map(b => el("div", { class: "linha-pessoa", "data-previa": b.nome },
          el("span", { class: "item-x-avatar", text: iniciais(b.nome) }),
          el("span", { class: "nome" }, el("strong", { text: b.nome }),
            el("small", { text: b.jaFechadoNoPeriodo ? "Já tem fechamento neste período" : `Comissão ${reais(b.comissaoCentavos)}${b.valesCentavos ? ` − vales ${reais(b.valesCentavos)}` : ""}` })),
          el("span", { class: "valor", text: b.jaFechadoNoPeriodo ? "—" : reais(b.aPagarCentavos) })))),
        livres.length > 1 ? el("div", { class: "total-comissao" }, el("span", { text: "Total" }), el("span", { text: reais(total) })) : null]
      : el("p", { class: "vazio", text: "Nada para pagar neste período." }),
    livres.length
      ? botao("Fechar comissão do período", () => abrirJanela("Fechar comissão", [
          el("p", { text: `Fecha ${dataBR(est.ini)} a ${dataBR(est.fim)}: ${reais(total)} para ${livres.length} profissional(is).` }),
          el("p", { class: "suave", text: "Depois de fechado, os atendimentos, vendas e vales deste período não podem mais ser alterados. O pagamento você registra em seguida." })
        ], {
          ok: "Fechar", perigo: true,
          aoConfirmar: async () => {
            await api("/comissoes/fechar", { metodo: "POST", corpo: { dataIni: est.ini, dataFim: est.fim } });
            est.filtroPag = "apagar";
            avisar("Comissão fechada. Agora registre os pagamentos."); telaComissoes();
          }
        }), "principal largo") : null);

  // 2) Pagamentos (fechamentos)
  const ulPag = el("ul", { class: "lista-x" });
  const desenharPag = () => {
    const vis = fech.fechamentos.filter(f => est.filtroPag === "pagos" ? f.pagoEm : !f.pagoEm);
    ulPag.replaceChildren(...(vis.length ? vis.map(f => itemExpansivel({
      chave: `fech:${f.id}`, attrs: { "data-fechamento": f.barbeiro }, avatar: iniciais(f.barbeiro),
      titulo: f.barbeiro, sub: `${dataBR(f.dataIni)} a ${dataBR(f.dataFim)}`,
      direita: [el("span", { class: "preco", text: reais(f.aPagarCentavos) }),
        el("span", { class: `etiqueta ${f.pagoEm ? "verde" : "amarela"}`, text: f.pagoEm ? `Pago ${dataBR(f.pagoEm)}` : "A pagar" })],
      detalhes: () => [
        el("dl", { class: "dados-item" },
          el("dt", { text: "Serviços" }), el("dd", { text: reais(f.comissaoServicoCentavos) }),
          el("dt", { text: "Produtos" }), el("dd", { text: reais(f.comissaoProdutoCentavos) }),
          el("dt", { text: "Vales" }), el("dd", { text: `− ${reais(f.valesCentavos)}` }),
          el("dt", { text: "A pagar" }), el("dd", { text: reais(f.aPagarCentavos) }),
          f.pagoEm ? [el("dt", { text: "Pago em" }), el("dd", { text: `${dataBR(f.pagoEm)}${f.pagoComCaixa ? " com dinheiro do caixa" : ""}` })] : null),
        f.pagoEm ? null : acoesItem(botao("Registrar pagamento", () => janelaPagarFechamento(f), "pequeno principal"))
      ]
    })) : [el("li", { class: "vazio", text: est.filtroPag === "pagos" ? "Nenhum pagamento ainda." : "Nada esperando pagamento." })]));
  };
  desenharPag();
  const qtdAPagar = fech.fechamentos.filter(f => !f.pagoEm).length;
  const blocoPag = el("section", {},
    el("div", { class: "secao-titulo" }, el("h3", { text: "2. Pagamentos" })),
    barraBusca({ placeholder: "", filtros: [["apagar", `A pagar${qtdAPagar ? ` (${qtdAPagar})` : ""}`], ["pagos", "Pagos"]], estado: { get filtro() { return est.filtroPag; }, set filtro(v) { est.filtroPag = v; }, busca: "" }, aoMudar: desenharPag })
      .querySelector(".chips-filtro"),
    ulPag);

  // 3) Vales
  const estVales = estadoComissaoVales;
  const ulVales = el("ul", { class: "lista-x" });
  const desenharVales = () => {
    const vis = vales.vales.filter(v => estVales.filtro === "todos" || v.situacao === "ativo");
    ulVales.replaceChildren(...(vis.length ? vis.map(v => itemExpansivel({
      chave: `vale:${v.id}`, attrs: { "data-vale": v.barbeiro }, classe: v.situacao === "cancelado" ? "inativo" : "", avatar: iniciais(v.barbeiro),
      titulo: v.barbeiro, sub: [dataBR(v.data), v.descricao].filter(Boolean).join(" · "),
      direita: [el("span", { class: "preco", text: reais(v.valorCentavos) }),
        v.situacao === "cancelado" ? el("span", { class: "etiqueta vermelha", text: "Cancelado" }) : v.fechado ? el("span", { class: "etiqueta", text: "Descontado" }) : null],
      detalhes: () => [
        el("p", { class: "suave", text: v.situacao === "cancelado" ? `Cancelado. Motivo: ${v.motivoCancelamento}` : v.fechado ? "Já descontado num fechamento de comissão." : "Será descontado no próximo fechamento." }),
        v.situacao === "ativo" && !v.fechado ? acoesItem(botao("Cancelar vale", () => pedirMotivo("Cancelar vale", "Nada é apagado; fica registrado.", async motivo => {
          await api("/vales/cancelar", { metodo: "POST", corpo: { id: v.id, motivo } });
          avisar("Vale cancelado."); telaComissoes();
        }, "Cancelar vale"), "pequeno texto-perigo")) : null
      ]
    })) : [el("li", { class: "vazio", text: "Nenhum vale nos últimos 60 dias." })]));
  };
  desenharVales();
  const blocoVales = el("section", {},
    el("div", { class: "secao-titulo" }, el("h3", { text: "3. Vales (adiantamentos)" }),
      botao("+ Lançar vale", () => janelaLancarVale(ag.profissionais), "pequeno principal")),
    barraBusca({ placeholder: "", filtros: [["ativos", "Ativos"], ["todos", "Todos (inclui cancelados)"]], estado: estVales, aoMudar: desenharVales }).querySelector(".chips-filtro"),
    ulVales);

  mostrar(cabecalho("Comissões e vales", "Escolha o período, confira quanto pagar a cada um, feche e registre o pagamento. Vales são descontados automaticamente."),
    el("div", { class: "duas-colunas" },
      el("section", {}, cartaoPrevia, blocoPag),
      blocoVales));
}
const estadoComissaoVales = { filtro: "ativos", busca: "" };

// ---------- DESPESAS (contas a pagar) ----------
// 17/11/2026: lista limpa que expande ao tocar, forma de pagamento (cartão, boleto, Pix…) e parcelamento.
const NOME_CATEGORIA = { aluguel: "Aluguel", luz: "Luz", agua: "Água", fornecedor: "Fornecedor", outros: "Outros" };
const STATUS_CONTA = { atrasada: ["Atrasada", "vermelha"], hoje: ["Vence hoje", "amarela"], proxima: ["Próximos 7 dias", ""], futura: ["Em aberto", ""], paga: ["Paga", "verde"], cancelada: ["Cancelada", "vermelha"] };
const FORMAS_DESPESA = [["pix", "Pix"], ["dinheiro", "Dinheiro"], ["debito", "Débito"], ["credito", "Crédito"], ["boleto", "Boleto"], ["transferencia", "Transferência"]];
const NOME_FORMA_DESPESA = Object.fromEntries(FORMAS_DESPESA);
const opcoesForma = () => [["", "Não informar"], ...FORMAS_DESPESA];
const estadoDespesas = { busca: "", filtro: "abertas" };

// Editar despesa: em aberto muda tudo; paga muda só descrição, categoria e forma.
function janelaEditarConta(c) {
  const aberta = c.situacao === "aberta";
  return abrirJanela(`Editar ${c.descricao}`, [
    aberta ? null : el("p", { class: "info", text: "Despesa já paga: dá para corrigir a descrição, a categoria e a forma. Valor e data já entraram nos relatórios." }),
    campo("Descrição (opcional)", { name: "eDesc", maxlength: "100", value: c.descricao }),
    el("div", { class: "lado-a-lado" },
      campo("Categoria", { tag: "select", name: "eCat", valor: c.categoria, opcoes: Object.entries(NOME_CATEGORIA) }),
      campo("Forma de pagamento", { tag: "select", name: "eForma", valor: c.forma || "", opcoes: opcoesForma() })),
    aberta ? el("div", { class: "lado-a-lado" },
      campo("Valor (R$)", { name: "eValor", inputmode: "decimal", required: true, value: centavosParaTexto(c.valorCentavos) }),
      campo("Vencimento", { name: "eVenc", type: "date", required: true, value: c.vencimento })) : null,
    aberta && c.parcelas === 1 ? caixaMarcar("Repete todo mês", { name: "eRec", checked: c.recorrente || null }) : null
  ], {
    ok: "Salvar alterações",
    aoConfirmar: async f => {
      const corpo = { id: c.id, descricao: f.eDesc.value.trim() || null, categoria: f.eCat.value, forma: f.eForma.value || null };
      if (aberta) {
        const v = paraCentavos(f.eValor.value);
        if (!v) throw new Error("Valor inválido. Exemplo: 1500,00");
        Object.assign(corpo, { valorCentavos: v, vencimento: f.eVenc.value });
        if (f.eRec) corpo.recorrente = f.eRec.checked;
      }
      await api("/contas/alterar", { metodo: "POST", corpo });
      avisar("Despesa alterada."); telaContas();
    }
  });
}

function janelaPagarConta(c) {
  const linhaCaixa = caixaMarcar("Saiu do dinheiro do caixa (vira retirada do caixa de hoje)", { name: "comCaixa" });
  const conteudo = [
    el("p", { class: "destaque-valor", text: reais(c.valorCentavos) }),
    el("p", { class: "suave", text: `Pagamento com data de hoje.${c.recorrente ? " A do mês seguinte já fica cadastrada." : ""}` }),
    campo("Pago com", { tag: "select", name: "pForma", valor: c.forma || "", opcoes: opcoesForma() }),
    linhaCaixa
  ];
  const ajustar = sel => { linhaCaixa.hidden = Boolean(sel.value) && sel.value !== "dinheiro"; if (linhaCaixa.hidden) linhaCaixa.querySelector("input").checked = false; };
  setTimeout(() => { const sel = janela.querySelector("#c-pForma"); if (sel) { ajustar(sel); sel.addEventListener("change", () => ajustar(sel)); } }, 0);
  return abrirJanela(`Pagar ${c.descricao}`, conteudo, {
    ok: "Confirmar pagamento",
    aoConfirmar: async f => {
      const r = await api("/contas/pagar", { metodo: "POST", corpo: { id: c.id, comCaixa: f.comCaixa.checked, ...(f.pForma.value ? { forma: f.pForma.value } : {}) } });
      avisar(r.mensagem); telaContas();
    }
  });
}

function janelaCancelarConta(c) {
  return abrirJanela(`Cancelar ${c.descricao}`, [
    el("p", { text: "Nada é apagado: a despesa fica registrada como cancelada." }),
    c.parcelas > 1 ? caixaMarcar("Cancelar também as outras parcelas em aberto desta compra", { name: "todas", checked: true }) : null,
    campo("Motivo", { name: "motivo", required: true, minlength: "3", maxlength: "300", autocomplete: "off" })
  ], {
    ok: "Cancelar despesa", perigo: true,
    aoConfirmar: async f => {
      const r = await api("/contas/cancelar", { metodo: "POST", corpo: { id: c.id, motivo: f.motivo.value.trim(), todasParcelas: Boolean(f.todas?.checked) } });
      avisar(r.mensagem); telaContas();
    }
  });
}

function formNovaDespesa(doEstoque) {
  const parcelasOps = Array.from({ length: 24 }, (_, i) => [String(i + 1), i ? `${i + 1}x` : "À vista (1x)"]);
  const blocoParcelas = el("div", { class: "campo-parcelas", hidden: true }, campo("Parcelas", { tag: "select", name: "parc", opcoes: parcelasOps, valor: "1" }));
  const resumoParc = el("p", { class: "info", "data-teste": "resumo-parcelas", hidden: true });
  const linhaPaga = caixaMarcar("Já está paga (paguei hoje)", { name: "paga" });
  const linhaCaixa = caixaMarcar("Saiu do dinheiro do caixa", { name: "comCaixa" });
  linhaCaixa.hidden = true;
  const rotuloVenc = el("label", { for: "c-venc", text: "Vencimento" });
  const campoVenc = el("div", { class: "campo" }, rotuloVenc, el("input", { type: "date", id: "c-venc", name: "venc", required: true, value: hojeLocal() }));
  // Estoque: despesa que já lança o material/produto no estoque (custo de cada = valor total ÷ quantidade).
  const blocoEst = el("div", { class: "servicos-escolha", "data-teste": "conta-estoque", hidden: true },
    doEstoque.length
      ? [campo("Material ou produto", { tag: "select", name: "estProd", opcoes: doEstoque.map(p => [p.id, `${p.nome}${p.usoInterno ? " (uso da barbearia)" : ""} · tem ${p.saldo}`]) }),
        campo("Quantidade que chegou", { name: "estQtd", type: "number", min: "1", inputmode: "numeric" }),
        el("p", { class: "suave", "data-teste": "custo-unidade", text: "" })]
      : el("p", { class: "suave", text: "Nenhum material ou produto no estoque. Cadastre primeiro em Estoque → + Material de uso (ou em Produtos)." }));
  const mais = el("details", { class: "mais-opcoes" }, el("summary", { text: "Mais opções" }),
    caixaMarcar("Repete todo mês (aluguel, luz…)", { name: "rec" }),
    caixaMarcar("É compra de material/produto: lançar no estoque", { name: "lancaEst" }),
    blocoEst);
  const form = el("form", { class: "cartao form-despesa" },
    campo("Descrição (opcional)", { name: "desc", maxlength: "100", placeholder: "Em branco: usa o nome da categoria" }),
    el("div", { class: "lado-a-lado" },
      campo("Valor total (R$)", { name: "valor", inputmode: "decimal", required: true, placeholder: "0,00" }),
      campo("Categoria", { tag: "select", name: "cat", opcoes: Object.entries(NOME_CATEGORIA) })),
    el("div", { class: "lado-a-lado" },
      campo("Forma de pagamento", { tag: "select", name: "forma", opcoes: opcoesForma() }),
      blocoParcelas),
    campoVenc, resumoParc, linhaPaga, linhaCaixa, mais,
    el("button", { type: "submit", class: "botao principal", text: "Salvar despesa" }));
  const parcelas = () => blocoParcelas.hidden ? 1 : parseInt(form.parc.value, 10) || 1;
  const atualizar = () => {
    const forma = form.forma.value;
    blocoParcelas.hidden = !["credito", "boleto"].includes(forma);
    const n = parcelas();
    if (n > 1) { form.rec.checked = false; form.rec.disabled = true; } else form.rec.disabled = false;
    rotuloVenc.textContent = n > 1 ? (forma === "credito" ? "1ª parcela (vencimento da fatura)" : "1º vencimento") : "Vencimento";
    const v = paraCentavos(form.valor.value || "");
    if (n > 1 && v) {
      const base = Math.floor(v / n), primeira = v - base * (n - 1);
      resumoParc.hidden = false;
      resumoParc.textContent = `${n}x de ${reais(base)}${primeira !== base ? ` (1ª de ${reais(primeira)})` : ""} — uma por mês, de ${dataBR(form.venc.value)} a ${dataBR(somaMeses(form.venc.value, n - 1))}.`;
    } else resumoParc.hidden = true;
    // "Já paga" serve para o que sai na hora (Pix, dinheiro, débito, transferência) ou para a 1ª parcela.
    linhaPaga.querySelector("label").textContent = n > 1 ? "A 1ª parcela já está paga" : "Já está paga (paguei hoje)";
    linhaCaixa.hidden = !(form.paga.checked && (forma === "dinheiro" || !forma));
    if (linhaCaixa.hidden) form.comCaixa.checked = false;
    blocoEst.hidden = !form.lancaEst.checked;
    if (form.lancaEst.checked) form.rec.checked = false;
    const out = blocoEst.querySelector("[data-teste=custo-unidade]");
    if (out) {
      const q = parseInt(form.estQtd?.value || "0", 10);
      out.textContent = v && q > 0 ? `Custo de cada unidade: ${reais(Math.round(v / q))} (entra no estoque com esse custo).` : "";
    }
  };
  form.addEventListener("input", atualizar);
  form.addEventListener("change", atualizar);
  form.addEventListener("submit", ev => {
    ev.preventDefault();
    enviar(form, async () => {
      const v = paraCentavos(form.valor.value);
      if (!v) throw new Error("Valor inválido. Exemplo: 1500,00");
      let estoque;
      if (form.lancaEst.checked) {
        if (!doEstoque.length) throw new Error("Cadastre o material primeiro em Estoque → + Material de uso.");
        const q = parseInt(form.estQtd.value, 10);
        if (!q || q < 1) throw new Error("Informe a quantidade que chegou.");
        estoque = { produtoId: form.estProd.value, quantidade: q };
      }
      const n = parcelas();
      const r = await api("/contas", { metodo: "POST", corpo: {
        descricao: form.desc.value.trim() || null, categoria: form.cat.value, valorCentavos: v, vencimento: form.venc.value, recorrente: form.rec.checked,
        ...(form.forma.value ? { forma: form.forma.value } : {}), ...(n > 1 ? { parcelas: n } : {}),
        ...(form.paga.checked ? { jaPaga: true, comCaixa: form.comCaixa.checked } : {}), ...(estoque ? { estoque } : {}) } });
      estadoDespesas.filtro = form.paga.checked && n === 1 ? "pagas" : "abertas";
      avisar([r.contasCriadas > 1 ? `Despesa lançada em ${r.contasCriadas} parcelas.` : "Despesa lançada.", estoque ? "Material lançado no estoque." : null].filter(Boolean).join(" "));
      telaContas();
    });
  });
  return form;
}
// Soma meses mantendo o dia (31 → último dia do mês), igual ao servidor.
function somaMeses(data, n) {
  const [a, m, d] = data.split("-").map(Number);
  const alvo = new Date(Date.UTC(a, m - 1 + n, 1));
  const ultimo = new Date(Date.UTC(alvo.getUTCFullYear(), alvo.getUTCMonth() + 1, 0)).getUTCDate();
  alvo.setUTCDate(Math.min(d, ultimo));
  return alvo.toISOString().slice(0, 10);
}

async function telaContas() {
  const [{ contas }, { produtos: itensEstoque }] = await Promise.all([api("/contas"), api("/estoque")]);
  const doEstoque = itensEstoque.filter(p => p.ativo);
  const estado = estadoDespesas;
  const abertas = contas.filter(c => c.situacao === "aberta");
  const soma = l => l.reduce((t, c) => t + c.valorCentavos, 0);
  const atrasadas = abertas.filter(c => c.status === "atrasada");
  const semana = abertas.filter(c => ["hoje", "proxima"].includes(c.status));
  const resumo = el("div", { class: "resumo-despesas", "data-teste": "resumo-despesas" },
    el("div", { class: `resumo-item ${atrasadas.length ? "alerta" : ""}` }, el("small", { text: "Atrasadas" }), el("strong", { text: reais(soma(atrasadas)) }), el("span", { text: `${atrasadas.length} conta(s)` })),
    el("div", { class: "resumo-item" }, el("small", { text: "Vencem em 7 dias" }), el("strong", { text: reais(soma(semana)) }), el("span", { text: `${semana.length} conta(s)` })),
    el("div", { class: "resumo-item" }, el("small", { text: "Total a pagar" }), el("strong", { text: reais(soma(abertas)) }), el("span", { text: `${abertas.length} conta(s)` })));
  const ul = el("ul", { class: "lista-x" });
  const filtros = { abertas: c => c.situacao === "aberta", pagas: c => c.situacao === "paga", todas: () => true };
  const desenhar = () => {
    const t = normalizar(estado.busca);
    const vis = contas.filter(c => filtros[estado.filtro](c) && (!t || normalizar(`${c.descricao} ${NOME_CATEGORIA[c.categoria]}`).includes(t)));
    if (estado.filtro === "pagas") vis.sort((x, y) => (y.pagoEm || "").localeCompare(x.pagoEm || ""));
    ul.replaceChildren(...(vis.length ? vis.map(c => {
      const [stTxt, stCor] = STATUS_CONTA[c.status];
      const quando = c.situacao === "paga" ? `Paga ${dataBR(c.pagoEm)}` : c.situacao === "cancelada" ? "Cancelada" : `Vence ${dataBR(c.vencimento)}`;
      return itemExpansivel({
        chave: `conta:${c.id}`, attrs: { "data-conta": c.descricao }, classe: `conta-${c.status} ${c.situacao === "cancelada" ? "inativo" : ""}`,
        titulo: c.descricao, sub: [quando, c.forma ? NOME_FORMA_DESPESA[c.forma] : null].filter(Boolean).join(" · "),
        direita: [el("span", { class: "preco", text: reais(c.valorCentavos) }), el("span", { class: `etiqueta ${stCor}`, text: stTxt })],
        detalhes: () => [
          el("dl", { class: "dados-item" },
            el("dt", { text: "Categoria" }), el("dd", { text: NOME_CATEGORIA[c.categoria] }),
            el("dt", { text: "Vencimento" }), el("dd", { text: dataBR(c.vencimento) }),
            el("dt", { text: "Forma" }), el("dd", { text: c.forma ? NOME_FORMA_DESPESA[c.forma] : "Não informada" }),
            c.parcelas > 1 ? [el("dt", { text: "Parcela" }), el("dd", { text: `${c.parcela} de ${c.parcelas}` })] : null,
            c.recorrente ? [el("dt", { text: "Repete" }), el("dd", { text: "Todo mês" })] : null,
            c.pagoEm ? [el("dt", { text: "Paga em" }), el("dd", { text: `${dataBR(c.pagoEm)}${c.pagoComCaixa ? " com dinheiro do caixa" : ""}` })] : null,
            c.motivoCancelamento ? [el("dt", { text: "Motivo" }), el("dd", { text: c.motivoCancelamento })] : null),
          c.estoque ? el("p", { class: "suave", "data-teste": "conta-no-estoque", text: `+${c.estoque.quantidade} ${c.estoque.produto} no estoque${c.situacao === "cancelada" ? " (devolvido ao cancelar)" : ""}` }) : null,
          c.situacao === "aberta" ? acoesItem(botao("Pagar", () => janelaPagarConta(c), "pequeno principal"), botao("Editar", () => janelaEditarConta(c), "pequeno"),
            botao("Cancelar", () => janelaCancelarConta(c), "pequeno texto-perigo")) : null,
          c.situacao === "paga" ? acoesItem(botao("Editar", () => janelaEditarConta(c), "pequeno")) : null
        ]
      });
    }) : [el("li", { class: "vazio", text: estado.filtro === "abertas" ? "Nenhuma despesa a pagar. 🎉" : "Nenhuma despesa encontrada." })]));
  };
  desenhar();
  telaLista({
    titulo: "Despesas", subtitulo: "Contas e compras da barbearia. Toque numa despesa para pagar, editar ou cancelar.",
    topo: resumo,
    barra: barraBusca({ placeholder: "Buscar despesa", filtros: [["abertas", "A pagar"], ["pagas", "Pagas"], ["todas", "Todas"]], estado, aoMudar: desenhar }),
    lista: ul, painel: painelCadastro("Nova despesa", formNovaDespesa(doEstoque))
  });
}

// ---------- ENVIAR AO CONTADOR + CÓPIA DOS DADOS ----------
const NOME_PLANILHA = {
  clientes: "Clientes", atendimentos: "Atendimentos", caixa: "Caixa", estoque: "Estoque (saldo)",
  "estoque-movimentos": "Estoque (movimentos)", contas: "Contas a pagar", comissoes: "Comissões e vales"
};
async function telaContador() {
  const [{ contador }, { envios }] = await Promise.all([api("/configuracoes/contador"), api("/contador/envios")]);
  // 17/11/2026: contato e cópia dos dados ficam recolhidos (o contato abre sozinho enquanto não estiver preenchido).
  const temContato = Boolean(contador.nome || contador.telefone || contador.email);
  const formContato = el("form", {},
    campo("Nome", { name: "nome", value: contador.nome || "", maxlength: "80" }),
    el("div", { class: "lado-a-lado" },
      campo("WhatsApp", { name: "tel", value: contador.telefone ? fone(contador.telefone) : "", inputmode: "tel" }),
      campo("E-mail", { name: "email", type: "email", value: contador.email || "" })),
    el("button", { type: "submit", class: "botao", text: "Salvar contato" }));
  formContato.addEventListener("submit", ev => {
    ev.preventDefault();
    enviar(formContato, async () => {
      await api("/configuracoes/contador", { metodo: "POST", corpo: { nome: formContato.nome.value || null, telefone: formContato.tel.value || null, email: formContato.email.value || null } });
      avisar("Contato salvo.");
    });
  });

  const mesPassado = somaDias(`${hojeLocal().slice(0, 7)}-01`, -1).slice(0, 7);
  const formEnviar = el("form", { class: "cartao" },
    el("h3", { text: "Enviar ao contador" }),
    el("p", { class: "suave", text: "Gera o resumo em PDF e a planilha com todos os lançamentos. No celular abre o Compartilhar (WhatsApp, e-mail…); no computador baixa os arquivos. Não é nota fiscal." }),
    campo("Período", { tag: "select", name: "tipo", opcoes: [["mes", "Um mês"], ["ano", "Um ano inteiro"]] }),
    el("div", { class: "campo", "data-campo": "mes" }, el("label", { for: "ref-mes", text: "Mês" }), el("input", { type: "month", id: "ref-mes", name: "refMes", value: mesPassado })),
    Object.assign(el("div", { class: "campo", "data-campo": "ano" }, el("label", { for: "ref-ano", text: "Ano" }),
      el("input", { type: "number", id: "ref-ano", name: "refAno", min: "2020", max: "2100", value: hojeLocal().slice(0, 4), inputmode: "numeric" })), { hidden: true }),
    el("button", { type: "submit", class: "botao principal", text: "Gerar e enviar" }));
  formEnviar.tipo.addEventListener("change", () => {
    formEnviar.querySelector("[data-campo=mes]").hidden = formEnviar.tipo.value !== "mes";
    formEnviar.querySelector("[data-campo=ano]").hidden = formEnviar.tipo.value !== "ano";
  });
  formEnviar.addEventListener("submit", ev => {
    ev.preventDefault();
    enviar(formEnviar, async () => {
      const tipo = formEnviar.tipo.value;
      const ref = tipo === "mes" ? formEnviar.refMes.value : formEnviar.refAno.value;
      const r = await api("/contador/enviar", { metodo: "POST", corpo: { tipo, ref } });
      const arqs = [
        [`${r.arquivos.nomeBase}.pdf`, blobDeBase64(r.arquivos.pdfBase64, "application/pdf")],
        [`${r.arquivos.nomeBase}.csv`, new Blob([r.arquivos.csv], { type: "text/csv" })]
      ];
      await janelaEnvio(r, arqs);
      telaContador();
    });
  });

  const listaEnvios = envios.length
    ? el("ul", { class: "lista" }, envios.map(e => el("li", { class: `item ${e.alteradoDepois ? "conta-atrasada" : ""}`, "data-envio": e.referencia },
      el("div", { class: "item-topo" }, el("strong", { text: e.tipo === "mes" ? `Mês ${e.referencia.split("-").reverse().join("/")}` : `Ano ${e.referencia}` }),
        e.alteradoDepois ? el("span", { class: "etiqueta vermelha", text: "Alterado depois do envio" }) : null),
      el("p", { class: "suave", text: `Enviado em ${dataBR(e.em.slice(0, 10))} por ${e.por}` }),
      e.alteradoDepois ? el("p", { class: "erro", text: "Houve alteração depois do envio ao contador; gere de novo." }) : null)))
    : el("p", { class: "suave", text: "Nenhum envio ainda." });

  const blocoContato = el("details", { class: "cartao fin-secao", "data-teste": "contato-contador", open: temContato ? null : true },
    el("summary", {}, el("span", { class: "fin-secao-tit", text: "Contato do contador" }),
      el("span", { class: "fin-secao-res", text: temContato ? [contador.nome, contador.telefone ? fone(contador.telefone) : null].filter(Boolean).join(" · ") : "Não preenchido" })),
    formContato);
  const copia = el("details", { class: "cartao fin-secao", "data-teste": "copia-dados" },
    el("summary", {}, el("span", { class: "fin-secao-tit", text: "Cópia dos dados (planilhas)" }), el("span", { class: "fin-secao-res", text: "Excel" })),
    el("p", { class: "suave", text: "Baixe todos os dados da barbearia em planilhas (abrem no Excel), quando quiser." }),
    el("div", { class: "botoes-planilha" }, Object.entries(NOME_PLANILHA).map(([k, nome]) =>
      botao(nome, async () => {
        try { await baixarPlanilha(`/exportar/${k}`, `4blade-${k}-${hojeLocal()}.csv`); } catch (e) { avisar(e.message, "erro"); }
      }, "pequeno"))));

  mostrar(cabecalho("Contador e cópia dos dados", "Gere o relatório do mês e mande para o contador em 1 toque."),
    el("div", { class: "duas-colunas" },
      el("section", {}, formEnviar, el("h3", { text: "Envios registrados" }), listaEnvios),
      el("section", {}, blocoContato, copia)));
}

function janelaEnvio(r, arqs) {
  const rel = r.relatorio;
  const tel = r.contador?.telefone;
  return abrirJanela(`Relatório ${rel.periodo.titulo} pronto`, [
    el("dl", { class: "conferencia" },
      el("dt", { text: "Entradas" }), el("dd", { text: reais(rel.entradas.totalCentavos) }),
      el("dt", { text: "Comissões" }), el("dd", { text: `− ${reais(rel.comissoes.totalCentavos)}` }),
      el("dt", { text: "Custo dos produtos vendidos" }), el("dd", { text: `− ${reais(rel.resultado.custoProdutosVendidosCentavos)}` }),
      el("dt", { text: "Contas pagas" }), el("dd", { text: `− ${reais(rel.saidas.contasPagasCentavos)}` }),
      el("dt", { class: "forte", text: "Resultado" }), el("dd", { class: "forte", "data-teste": "resultado", text: reais(rel.resultado.resultadoCentavos) })),
    el("p", { class: "suave", text: `Cota-parte da barbearia ${reais(rel.cotaParte.barbeariaCentavos)} · dos profissionais ${reais(rel.cotaParte.profissionaisCentavos)} (o contador confirma se a barbearia usa a Lei do Salão-Parceiro).` }),
    el("div", { class: "item-acoes" },
      botao(ehCelular() ? "Compartilhar PDF e planilha" : "Baixar PDF e planilha", async () => {
        const res = await compartilharOuBaixar(arqs, `Relatório ${rel.periodo.titulo}`);
        if (res !== "cancelado") avisar(res === "compartilhado" ? "Arquivos compartilhados." : "Arquivos baixados.");
      }, "principal pequeno"),
      // Sem WhatsApp do contador cadastrado: abre o WhatsApp com a mensagem pronta para escolher o contato.
      el("a", { class: "botao pequeno whats", href: `https://wa.me/${tel ? `55${tel}` : ""}?text=${encodeURIComponent(`Olá${r.contador?.nome ? `, ${r.contador.nome.split(" ")[0]}` : ""}! Segue o relatório da ${usuario.barbearia.nome} de ${rel.periodo.titulo} (PDF e planilha).`)}`,
        target: "_blank", rel: "noopener", text: tel ? "Abrir WhatsApp do contador" : "Enviar pelo WhatsApp (escolher contato)" }))
  ], { ok: "Fechar", semCancelar: true, aoConfirmar: () => true });
}

// ---------- EQUIPE ----------
async function telaEquipe() {
  const { usuarios, vagas } = await api("/usuarios");
  const perfisQuePossoCriar = usuario.perfil === "proprietario" ? ["gerente", "barbeiro", "caixa"] : ["barbeiro", "caixa"];

  const vagasEl = el("div", { class: "vagas" }, Object.entries(vagas).map(([p, v]) =>
    el("div", { class: `vaga ${v.limite !== null && v.ativos >= v.limite ? "cheia" : ""}`, "data-vaga": p },
      el("strong", { text: v.limite === null ? String(v.ativos) : `${v.ativos}/${v.limite}` }),
      el("span", { text: `${NOME_PERFIL[p]}${v.limite === null || v.limite > 1 ? "s" : ""}${v.limite === null ? " · sem limite" : ""}` }))));

  const lista = el("ul", { class: "lista" }, usuarios.map(u => el("li", { class: `item ${u.ativo ? "" : "inativo"}`, "data-usuario": u.login },
    el("div", { class: "item-topo" },
      el("strong", { text: u.nome }),
      el("span", { class: "etiqueta", text: NOME_PERFIL[u.perfil] }),
      u.ativo ? null : el("span", { class: "etiqueta vermelha", text: "Desativado" }),
      u.ativo && u.trocaPendente ? el("span", { class: "etiqueta amarela", text: "Ainda não entrou" }) : null),
    el("p", { class: "suave", text: [`Usuário: ${u.login}`, u.telefone ? fone(u.telefone) : null].filter(Boolean).join(" · ") }),
    atendePerfil(u.perfil)
      ? el("p", { class: "suave", text: `Comissão: ${pct(u.comissaoServicoBp)} em serviços · ${pct(u.comissaoProdutoBp)} em produtos` }) : null,
    !u.ativo && u.motivoDesativacao ? el("p", { class: "suave", text: `Motivo: ${u.motivoDesativacao}` }) : null,
    !u.podeGerenciar && u.id === usuario.id && (u.perfil === "gerente" || u.perfil === "proprietario")
      ? el("div", { class: "item-acoes" },
        botao("Meu horário", () => janelaHorario(u), "pequeno"),
        u.perfil === "proprietario" ? botao("Meus dados e comissão", () => janelaUsuario(u), "pequeno") : null) : null,
    u.podeGerenciar ? el("div", { class: "item-acoes" },
      botao("Editar", () => janelaUsuario(u), "pequeno"),
      (u.perfil === "gerente" || u.perfil === "barbeiro") && u.ativo ? botao("Horário", () => janelaHorario(u), "pequeno") : null,
      u.ativo ? botao("Nova senha", () => pedirMotivo(`Nova senha para ${u.nome}`, "Gera uma senha provisória. A senha antiga para de funcionar.", async motivo => {
        const r = await api("/usuarios/redefinir-senha", { metodo: "POST", corpo: { id: u.id, motivo } });
        await mostrarSenha(r.login, r.senhaProvisoria, u.nome, { nome: u.nome, telefone: u.telefone });
      }, "Gerar senha"), "pequeno") : null,
      botao(u.ativo ? "Desativar" : "Reativar", () => pedirMotivo(
        `${u.ativo ? "Desativar" : "Reativar"} ${u.nome}`,
        u.ativo ? "A pessoa não consegue mais entrar e a vaga do plano fica livre. Nada é apagado." : "A pessoa volta a entrar (se houver vaga no plano).",
        async motivo => {
          await api("/usuarios/alterar", { metodo: "POST", corpo: { id: u.id, ativo: !u.ativo, motivo } });
          avisar(u.ativo ? "Pessoa desativada." : "Pessoa reativada.");
          telaEquipe();
        }, u.ativo ? "Desativar" : "Reativar"), `pequeno ${u.ativo ? "perigo" : ""}`)) : null)));

  const form = formUsuario(perfisQuePossoCriar);
  mostrar(
    cabecalho("Equipe", "Vagas do plano (usuários ativos):"),
    vagasEl,
    el("div", { class: "duas-colunas" },
      el("section", {}, el("h3", { text: "Pessoas" }), lista),
      el("section", {}, form)));
}

function camposComissao(u = null) {
  return el("div", { class: "lado-a-lado bloco-comissao" },
    campo("Comissão serviços (%)", { name: "comServ", inputmode: "decimal", value: u ? bpParaTexto(u.comissaoServicoBp) : "", placeholder: "ex.: 40" }),
    campo("Comissão produtos (%)", { name: "comProd", inputmode: "decimal", value: u ? bpParaTexto(u.comissaoProdutoBp) : "", placeholder: "ex.: 10" }));
}

function lerComissoes(form) {
  if (!form.comServ) return {};
  const s = paraBp(form.comServ.value || "0");
  const p = paraBp(form.comProd.value || "0");
  if (s === null || p === null) throw new Error("Comissão inválida: use um número de 0 a 100 (ex.: 40 ou 37,5).");
  return { comissaoServicoBp: s, comissaoProdutoBp: p };
}

function formUsuario(perfis) {
  const blocoComissao = camposComissao();
  const form = el("form", { class: "cartao" },
    el("h3", { text: "Nova pessoa" }),
    campo("Perfil", { tag: "select", name: "perfil", opcoes: perfis.map(p => [p, NOME_PERFIL[p]]), valor: "barbeiro" }),
    campo("Nome", { name: "nome", required: true, autocomplete: "off" }),
    campo("Usuário de acesso", { name: "login", required: true, autocapitalize: "none", spellcheck: "false", autocomplete: "off" }, "Minúsculas, sem espaço. Ex.: pedro.silva"),
    campo("Telefone (opcional)", { name: "telefone", inputmode: "tel", autocomplete: "off" }),
    blocoComissao,
    el("button", { type: "submit", class: "botao principal", text: "Criar acesso" }));
  const ajustar = () => { blocoComissao.hidden = form.perfil.value === "caixa"; };
  form.perfil.addEventListener("change", ajustar);
  ajustar();
  form.addEventListener("submit", ev => {
    ev.preventDefault();
    enviar(form, async () => {
      const corpo = {
        perfil: form.perfil.value, nome: form.nome.value, login: form.login.value.trim().toLowerCase(),
        telefone: form.telefone.value || undefined,
        ...(form.perfil.value === "caixa" ? {} : lerComissoes(form))
      };
      const r = await api("/usuarios", { metodo: "POST", corpo });
      await mostrarSenha(r.usuario.login, r.senhaProvisoria, r.usuario.nome, { nome: r.usuario.nome, telefone: r.usuario.telefone });
      telaEquipe();
    });
  });
  return form;
}

function janelaUsuario(u) {
  const atendeAgenda = atendePerfil(u.perfil);
  return abrirJanela(`Editar ${u.nome}`, [
    campo("Nome", { name: "nome", value: u.nome, required: true }),
    campo("Telefone", { name: "telefone", value: u.telefone ? fone(u.telefone) : "", inputmode: "tel" }),
    atendeAgenda ? camposComissao(u) : null
  ], {
    ok: "Salvar",
    aoConfirmar: async form => {
      await api("/usuarios/alterar", {
        metodo: "POST",
        corpo: { id: u.id, nome: form.nome.value, telefone: form.telefone.value || null, ...(atendeAgenda ? lerComissoes(form) : {}) }
      });
      avisar("Dados salvos.");
      telaEquipe();
    }
  });
}

// ---------- CADASTROS (serviços, produtos, clientes) ----------
// ---------- LISTAS LIMPAS (17/11/2026): item compacto que expande ao tocar + busca, filtros e painel de cadastro ----------
const itensAbertos = new Set();   // continuam abertos quando a tela é montada de novo
function itemExpansivel({ chave, attrs = {}, classe = "", avatar = null, titulo, sub = null, direita = null, detalhes }) {
  const aberto = itensAbertos.has(chave);
  const det = el("div", { class: "item-x-det", hidden: aberto ? null : true }, detalhes());
  const resumo = el("button", { type: "button", class: "item-x-resumo", "aria-expanded": String(aberto) },
    avatar ? el("span", { class: "item-x-avatar", text: avatar }) : null,
    el("span", { class: "item-x-txt" }, el("strong", {}, [titulo].flat(3)), sub ? el("small", {}, [sub].flat(3)) : null),
    direita ? el("span", { class: "item-x-dir" }, [direita].flat(3)) : null,
    el("span", { class: "slot-seta", "aria-hidden": "true" }));
  const li = el("li", { class: `item-x ${classe} ${aberto ? "aberto" : ""}`, ...attrs }, resumo, det);
  resumo.addEventListener("click", () => {
    const abrir = det.hidden;
    det.hidden = !abrir;
    li.classList.toggle("aberto", abrir);
    resumo.setAttribute("aria-expanded", String(abrir));
    if (abrir) itensAbertos.add(chave); else itensAbertos.delete(chave);
  });
  return li;
}
// Barra de busca (filtra na hora) + filtros em botões. filtros: [[id, rótulo, fn(item)]].
function barraBusca({ placeholder, filtros = [], estado, aoMudar }) {
  const input = el("input", { type: "search", class: "busca-viva", placeholder, value: estado.busca || "", "aria-label": placeholder, autocomplete: "off" });
  input.addEventListener("input", () => { estado.busca = input.value; aoMudar(); });
  const chips = filtros.length ? el("div", { class: "chips-filtro", role: "group", "aria-label": "Filtrar" }, filtros.map(([id, rotulo]) =>
    el("button", { type: "button", class: `chip-filtro ${estado.filtro === id ? "ativo" : ""}`, "data-filtro": id, text: rotulo,
      onclick: ev => { estado.filtro = id; ev.currentTarget.parentElement.querySelectorAll(".chip-filtro").forEach(b => b.classList.toggle("ativo", b.dataset.filtro === id)); aoMudar(); } }))) : null;
  return el("div", { class: "barra-busca" }, el("div", { class: "busca-campo" }, icone("busca"), input), chips);
}
const normalizar = t => String(t || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
// Painel de cadastro: no computador fica aberto ao lado; no celular, recolhido em "+ Novo …".
function painelCadastro(rotulo, form) {
  return el("details", { class: "painel-novo", "data-teste": "painel-novo", open: window.matchMedia("(min-width: 1024px)").matches || null },
    el("summary", {}, el("span", { class: "mais-novo", text: "+" }), rotulo), form);
}
// Ações dentro do item aberto: principal em destaque, demais discretas; desativar/excluir no fim, em vermelho.
function acoesItem(...botoes) { return el("div", { class: "item-x-acoes" }, ...botoes.flat().filter(Boolean)); }
function botaoDesativar(rota, registro, recarregar) {
  return registro.ativo
    ? botao("Desativar", () => pedirMotivo(`Desativar ${registro.nome}`, "Sai das listas da equipe, mas nada é apagado. Dá para reativar depois.", async motivo => {
      await api(`/${rota}/alterar`, { metodo: "POST", corpo: { id: registro.id, ativo: false, motivo } });
      avisar("Desativado."); recarregar();
    }, "Desativar"), "pequeno texto-perigo")
    : botao("Reativar", async () => {
      try { await api(`/${rota}/alterar`, { metodo: "POST", corpo: { id: registro.id, ativo: true } }); avisar("Reativado."); recarregar(); } catch (e) { avisar(e.message, "erro"); }
    }, "pequeno");
}
function telaLista({ titulo, subtitulo, topo = null, barra, lista, contador, painel }) {
  mostrar(cabecalho(titulo, subtitulo),
    el("div", { class: `tela-lista ${painel ? "com-lado" : ""}` },
      el("section", { class: "tela-lista-principal" }, topo, barra, contador, lista),
      painel ? el("aside", { class: "tela-lista-lado" }, painel) : null));
}

function linhaAcoesCadastro(rota, registro, recarregar, editar) {
  return el("div", { class: "item-acoes" },
    botao("Editar", editar, "pequeno"),
    registro.ativo
      ? botao("Desativar", () => pedirMotivo(`Desativar ${registro.nome}`, "Sai das listas da equipe, mas nada é apagado. Dá para reativar depois.", async motivo => {
        await api(`/${rota}/alterar`, { metodo: "POST", corpo: { id: registro.id, ativo: false, motivo } });
        avisar("Desativado.");
        recarregar();
      }, "Desativar"), "pequeno perigo")
      : botao("Reativar", async () => {
        try {
          await api(`/${rota}/alterar`, { metodo: "POST", corpo: { id: registro.id, ativo: true } });
          avisar("Reativado.");
          recarregar();
        } catch (e) { avisar(e.message, "erro"); }
      }, "pequeno"));
}

// Formulário de cadastro novo (o mesmo "def" monta a janela de edição).
function formCadastro(def) {
  const form = el("form", { class: "cartao" },
    el("h3", { text: def.titulo }),
    def.campos(null),
    el("button", { type: "submit", class: "botao principal", text: "Salvar" }));
  form.addEventListener("submit", ev => {
    ev.preventDefault();
    enviar(form, async () => {
      await api(`/${def.rota}`, { metodo: "POST", corpo: def.montarCorpo(form) });
      avisar("Cadastrado com sucesso.");
      def.aoSalvar();
    });
  });
  return form;
}

function editarEmJanela(titulo, def, registro) {
  return abrirJanela(titulo, def.campos(registro), {
    ok: "Salvar",
    aoConfirmar: async f => {
      await api(`/${def.rota}/alterar`, { metodo: "POST", corpo: { id: registro.id, ...def.montarCorpo(f) } });
      avisar("Alterações salvas.");
      def.aoSalvar();
    }
  });
}

// SERVIÇOS
async function telaServicos() {
  const { servicos } = await api("/servicos");
  if (!gestao()) {
    mostrar(cabecalho("Serviços", "Tabela de preços da barbearia"),
      servicos.length
        ? el("ul", { class: "lista" }, servicos.map(s => el("li", { class: "item" },
          el("div", { class: "item-topo" }, el("strong", { text: s.nome }), el("span", { class: "preco", text: reais(s.precoCentavos) })),
          el("p", { class: "suave", text: `${s.duracaoMin} min` }))))
        : el("p", { class: "vazio", text: "Nenhum serviço cadastrado ainda." }));
    return;
  }
  const def = {
    titulo: "Novo serviço",
    rota: "servicos",
    aoSalvar: telaServicos,
    campos: s => [
      campo("Nome do serviço", { name: "nome", required: true, value: s?.nome, maxlength: "80" }),
      el("div", { class: "lado-a-lado" },
        campo("Preço (R$)", { name: "preco", required: true, inputmode: "decimal", value: s ? centavosParaTexto(s.precoCentavos) : "", placeholder: "40,00" }),
        campo("Duração (min)", { name: "duracao", required: true, type: "number", min: "5", max: "480", step: "5", inputmode: "numeric", value: s ? String(s.duracaoMin) : "30" }))
    ],
    montarCorpo: f => {
      const preco = paraCentavos(f.preco.value);
      if (preco === null) throw new Error("Preço inválido. Exemplo: 40,00");
      return { nome: f.nome.value, precoCentavos: preco, duracaoMin: Number(f.duracao.value) };
    }
  };
  const estado = estadoServicos;
  const ul = el("ul", { class: "lista-x" });
  const desenhar = () => {
    const t = normalizar(estado.busca);
    const vis = servicos.filter(s => (estado.filtro === "desativados" ? !s.ativo : s.ativo) && (!t || normalizar(s.nome).includes(t)));
    ul.replaceChildren(...(vis.length ? vis.map(s => itemExpansivel({
      chave: `s:${s.id}`, attrs: { "data-servico": s.nome }, classe: s.ativo ? "" : "inativo",
      titulo: s.nome, sub: `${s.duracaoMin} min`,
      direita: [el("span", { class: "preco", text: reais(s.precoCentavos) }), s.ativo ? null : el("span", { class: "etiqueta vermelha", text: "Desativado" })],
      detalhes: () => [
        !s.ativo && s.motivoDesativacao ? el("p", { class: "suave", text: `Motivo: ${s.motivoDesativacao}` }) : null,
        acoesItem(botao("Editar", () => editarEmJanela(`Editar ${s.nome}`, def, s), "pequeno principal"), botaoDesativar("servicos", s, telaServicos))
      ]
    })) : [el("li", { class: "vazio", text: servicos.length ? "Nenhum serviço encontrado." : "Nenhum serviço ainda. Cadastre o primeiro." })]));
  };
  desenhar();
  telaLista({
    titulo: "Serviços", subtitulo: "Toque no serviço para editar. O preço pode mudar na hora de finalizar (fica registrado).",
    barra: barraBusca({ placeholder: "Buscar serviço", filtros: [["ativos", "Ativos"], ["desativados", "Desativados"]], estado, aoMudar: desenhar }),
    lista: ul, painel: painelCadastro("Novo serviço", formCadastro(def))
  });
}
const estadoServicos = { busca: "", filtro: "ativos" };

// PRODUTOS
async function telaProdutos() {
  const produtos = (await api("/produtos")).produtos.filter(p => !p.usoInterno);   // material de uso fica só em Estoque
  if (!gestao()) {
    mostrar(cabecalho("Produtos", "Preços para consulta", usuario.perfil === "caixa" ? "#/caixa" : "#/inicio"),
      produtos.length
        ? el("ul", { class: "lista" }, produtos.map(p => el("li", { class: "item", "data-produto": p.nome },
          el("div", { class: "item-topo" }, el("strong", { text: p.nome }), el("span", { class: "preco", text: reais(p.precoCentavos) }),
            el("span", { class: `etiqueta ${p.disponivel ? "verde" : "vermelha"}`, text: p.disponivel ? "Disponível" : "Indisponível" })))))
        : el("p", { class: "vazio", text: "Nenhum produto cadastrado ainda." }));
    return;
  }
  const profissional = usuario.barbearia.plano === "pro";   // site completo (fase 2)
  const def = {
    titulo: "Novo produto",
    rota: "produtos",
    aoSalvar: telaProdutos,
    campos: p => [
      campo("Nome do produto", { name: "nome", required: true, value: p?.nome, maxlength: "80" }),
      el("div", { class: "lado-a-lado" },
        campo("Preço de venda (R$)", { name: "preco", required: true, inputmode: "decimal", value: p ? centavosParaTexto(p.precoCentavos) : "", placeholder: "45,00" }),
        campo("Estoque mínimo", { name: "minimo", type: "number", min: "0", inputmode: "numeric", value: p ? String(p.estoqueMinimo) : "0" })),
      // No cadastro já dá para lançar o estoque (evita ir depois em Estoque → Entrada).
      p ? null : el("div", { class: "lado-a-lado" },
        campo("Quantidade em estoque", { name: "qtdInicial", inputmode: "numeric", autocomplete: "off", placeholder: "0" }),
        campo("Custo unitário (R$)", { name: "custoInicial", inputmode: "decimal", autocomplete: "off", placeholder: "20,00" })),
      p ? null : el("p", { class: "suave", text: "Opcional: quanto você tem hoje e quanto pagou por unidade. Depois, novas compras entram em Estoque." }),
      campo("Código (opcional)", { name: "codigo", value: p?.codigo || "", inputmode: "numeric", autocomplete: "off" }, "Pode ser o código de barras."),
      campo("Validade (opcional)", { name: "validade", type: "date", value: p?.validade || "" }),
      caixaMarcar(profissional ? "Mostrar no site" : "Mostrar no site (Plano Pro)", { name: "site", checked: p?.mostrarSite || null })
    ],
    montarCorpo: f => {
      const preco = paraCentavos(f.preco.value);
      if (preco === null) throw new Error("Preço inválido. Exemplo: 45,00");
      let estoqueInicial;
      const qtd = f.qtdInicial ? Number(f.qtdInicial.value || 0) : 0;
      if (qtd > 0) {
        const custo = paraCentavos(f.custoInicial.value);
        if (custo === null) throw new Error("Informe o custo unitário do estoque (quanto pagou por unidade). Exemplo: 20,00");
        estoqueInicial = { quantidade: qtd, custoUnitCentavos: custo };
      }
      return {
        nome: f.nome.value, precoCentavos: preco, estoqueMinimo: Number(f.minimo.value || 0),
        codigo: f.codigo.value.trim() || null, validade: f.validade.value || null, mostrarSite: f.site.checked, estoqueInicial
      };
    }
  };
  const estado = estadoProdutos;
  const ul = el("ul", { class: "lista-x" });
  const desenhar = () => {
    const t = normalizar(estado.busca);
    const vis = produtos.filter(p => (estado.filtro === "desativados" ? !p.ativo : estado.filtro === "repor" ? p.ativo && p.saldo < p.estoqueMinimo : p.ativo)
      && (!t || normalizar(p.nome).includes(t) || (p.codigo || "").includes(estado.busca.trim())));
    ul.replaceChildren(...(vis.length ? vis.map(p => itemExpansivel({
      chave: `p:${p.id}`, attrs: { "data-produto": p.nome }, classe: p.ativo ? "" : "inativo",
      titulo: p.nome, sub: `Estoque ${p.saldo} un.${p.margemBp === null ? "" : ` · margem ${pct(p.margemBp)}`}`,
      direita: [el("span", { class: "preco", text: reais(p.precoCentavos) }), p.ativo ? null : el("span", { class: "etiqueta vermelha", text: "Desativado" })],
      detalhes: () => [
        el("p", { class: "suave", "data-teste": "custo", text: `Custo médio: ${p.custoMedioCentavos ? reais(p.custoMedioCentavos) : "—"} · Margem: ${p.margemBp === null ? "— (sem entrada de mercadoria)" : pct(p.margemBp)}` }),
        el("p", { class: "suave", text: [p.codigo ? `Código ${p.codigo}` : null, `Mínimo ${p.estoqueMinimo}`, p.validade ? `Validade ${dataBR(p.validade)}` : null, p.mostrarSite ? "No site" : null].filter(Boolean).join(" · ") }),
        acoesItem(botao("Editar", () => editarEmJanela(`Editar ${p.nome}`, def, p), "pequeno principal"), botaoDesativar("produtos", p, telaProdutos))
      ]
    })) : [el("li", { class: "vazio", text: produtos.length ? "Nenhum produto encontrado." : "Nenhum produto ainda. Cadastre o primeiro." })]));
  };
  desenhar();
  telaLista({
    titulo: "Produtos", subtitulo: "Toque no produto para ver custo, margem e editar. Entradas de mercadoria ficam em Estoque.",
    barra: barraBusca({ placeholder: "Buscar produto ou código", filtros: [["ativos", "Ativos"], ["repor", "Repor"], ["desativados", "Desativados"]], estado, aoMudar: desenhar }),
    lista: ul, painel: painelCadastro("Novo produto", formCadastro(def))
  });
}
const estadoProdutos = { busca: "", filtro: "ativos" };

// CLIENTES (17/11/2026): uma lista só, compacta, que expande ao tocar; busca por nome/apelido/telefone e filtros.
const estadoClientes = { busca: "", filtro: "todos" };
async function telaClientes(busca = null) {
  if (busca !== null) estadoClientes.busca = busca;
  const { clientes } = await api("/clientes");
  const recarregar = () => telaClientes();
  const def = {
    titulo: "Novo cliente",
    rota: "clientes",
    aoSalvar: recarregar,
    campos: c => [
      campo("Nome", { name: "nome", required: true, value: c?.nome, autocomplete: "off" }),
      campo("Apelido (opcional)", { name: "apelido", value: c?.apelido || "", maxlength: "40", autocomplete: "off", placeholder: "Como ele é chamado na barbearia" }),
      campo(c && !c.telefone ? "Telefone (WhatsApp) — opcional" : "Telefone (WhatsApp)", { name: "telefone", required: !c || Boolean(c.telefone) || null, inputmode: "tel", value: c ? fone(c.telefone) : "", placeholder: "(11) 91234-5678", autocomplete: "off" }),
      campo("Observação (opcional)", { tag: "textarea", name: "obs", rows: "2", maxlength: "500", value: c?.observacao || "" }),
      caixaMarcar("O cliente aceita que o telefone seja usado para o atendimento (LGPD)", { name: "lgpd", checked: c?.aceiteLgpd || null })
    ],
    montarCorpo: f => ({ nome: f.nome.value, apelido: f.apelido.value.trim(), telefone: f.telefone.value, observacao: f.obs.value || null, aceiteLgpd: f.lgpd.checked })
  };
  const filtros = [["todos", "Todos", c => c.ativo], ["whats", "Com WhatsApp", c => c.ativo && c.telefone], ["semfone", "Sem telefone", c => c.ativo && !c.telefone],
    ["pendencia", "Nota vencida ou bloqueado", c => c.ativo && (c.bloqueado || c.notaVencidaCentavos)],
    ...(gestao() ? [["desativados", "Desativados", c => !c.ativo]] : [])];
  const ul = el("ul", { class: "lista-x" });
  const contador = el("p", { class: "suave contador-lista" });
  const desenhar = () => {
    const f = (filtros.find(x => x[0] === estadoClientes.filtro) || filtros[0])[2];
    const t = normalizar(estadoClientes.busca), dig = estadoClientes.busca.replace(/\D/g, "");
    const vis = clientes.filter(c => f(c) && (!t || normalizar(c.nome).includes(t) || normalizar(c.apelido).includes(t) || (dig.length >= 3 && (c.telefone || "").includes(dig))));
    contador.textContent = `${vis.length} cliente${vis.length === 1 ? "" : "s"}`;
    ul.replaceChildren(...(vis.length ? vis.map(c => itemExpansivel({
      chave: `c:${c.id}`, attrs: { "data-cliente": c.nome }, classe: c.ativo ? "" : "inativo", avatar: iniciais(c.nome),
      titulo: [c.nome, c.apelido ? el("span", { class: "apelido", text: `“${c.apelido}”` }) : null],
      sub: c.telefone ? fone(c.telefone) : "sem telefone",
      direita: c.ativo ? seloCliente(c) : el("span", { class: "etiqueta vermelha", text: "Desativado" }),
      detalhes: () => [
        avisoCliente(c),
        el("p", { class: "suave", text: [c.telefone ? (c.aceiteLgpd ? "Aceitou o uso do telefone (LGPD)" : "Sem aceite LGPD") : null, c.observacao].filter(Boolean).join(" · ") || "Sem observação." }),
        acoesItem(
          c.ativo ? botao("Marcar horário", () => { marcarParaCliente = { id: c.id, nome: c.nome, telefone: c.telefone, bloqueado: c.bloqueado, notaVencida: c.notaVencidaCentavos ? { totalCentavos: c.notaVencidaCentavos } : null }; estadoAgenda.visao = "dia"; location.hash = "#/agenda"; }, "pequeno principal") : null,
          // Com telefone: abre a conversa do cliente. Sem telefone: abre o WhatsApp com "Olá, Nome!" para escolher o contato.
          el("a", { class: "botao pequeno whats", "data-whats-cliente": c.telefone ? "numero" : "escolher", href: c.telefone ? `https://wa.me/55${c.telefone}?text=${encodeURIComponent(`Olá, ${c.nome.split(" ")[0]}!`)}` : `https://wa.me/?text=${encodeURIComponent(`Olá, ${c.nome.split(" ")[0]}!`)}`,
            target: "_blank", rel: "noopener", text: c.telefone ? "WhatsApp" : "WhatsApp (escolher contato)" }),
          botao("Editar", () => editarEmJanela(`Editar ${c.nome}`, def, c), "pequeno"),
          c.ativo && veTodas() ? botao(c.bloqueado ? "Desbloquear" : "Bloquear", () => janelaBloquearCliente(c, recarregar), "pequeno") : null,
          ehCaixa() ? null : botaoDesativar("clientes", c, recarregar),
          botao("Excluir", () => pedirMotivo(`Excluir ${c.nome}`,
            "O cliente sai da lista, da busca e da agenda, e o telefone fica livre para outro cadastro. O histórico (atendimentos, vendas e notas) continua guardado.",
            async motivo => {
              await api("/clientes/excluir", { metodo: "POST", corpo: { id: c.id, motivo } });
              avisar("Cliente excluído."); recarregar();
            }, "Excluir cliente"), "pequeno texto-perigo"))
      ]
    })) : [el("li", { class: "vazio", text: clientes.length ? "Nenhum cliente encontrado." : "Nenhum cliente ainda." })]));
  };
  desenhar();
  telaLista({
    titulo: "Clientes", subtitulo: "Toque no cliente para ver as opções.",
    barra: barraBusca({ placeholder: "Buscar por nome, apelido ou telefone", filtros, estado: estadoClientes, aoMudar: desenhar }),
    contador, lista: ul, painel: painelCadastro("Novo cliente", formCadastro(def))
  });
}

// MODELOS DE MENSAGEM
async function telaMensagens() {
  const { modelos, campos } = await api("/modelos-mensagem");   // o envio usa os modelos como ponto de partida
  const NOMES = { confirmacao: "Confirmação de horário", lembrete: "Lembrete", proposta: "Proposta de horário" };
  const USO = { confirmacao: "Botão \"Confirmar horário\" e aviso logo depois de marcar.", lembrete: "Botão \"Enviar lembrete\" do horário na agenda.", proposta: "Botão \"Propor horário\" (cliente faltou, cancelou ou dia fechado)." };
  // Um quadro só: escolhe o modelo na lista e o texto troca na hora.
  let atual = estadoMensagens.modelo && modelos.some(m => m.tipo === estadoMensagens.modelo) ? estadoMensagens.modelo : modelos[0].tipo;
  const escolha = el("select", { id: "modelo-escolha", "aria-label": "Modelo de mensagem" }, modelos.map(m => el("option", { value: m.tipo, text: NOMES[m.tipo] || m.tipo, selected: m.tipo === atual || null })));
  const uso = el("p", { class: "suave", "data-teste": "uso-modelo" });
  const texto = el("textarea", { name: "texto", id: "texto-modelo", rows: "4", maxlength: "1000" });
  const form = el("form", { class: "cartao modelo-unico", "data-modelo": atual },
    el("div", { class: "campo" }, el("label", { for: "modelo-escolha", text: "Modelo" }), escolha),
    uso,
    el("div", { class: "campo" }, el("label", { for: "texto-modelo", text: "Texto da mensagem" }), texto),
    el("div", { class: "chips" }, campos.map(c => el("button", {
      type: "button", class: "chip", text: `{${c}}`,
      onclick: () => {
        const pos = texto.selectionStart ?? texto.value.length;
        texto.value = `${texto.value.slice(0, pos)}{${c}}${texto.value.slice(texto.selectionEnd ?? pos)}`;
        texto.focus();
      }
    }))),
    el("div", { class: "lado-a-lado" },
      el("button", { type: "submit", class: "botao principal", text: "Salvar" }),
      el("button", {
        type: "button", class: "botao", text: "Voltar ao padrão",
        onclick: () => enviar(form, async () => {
          await api("/modelos-mensagem/alterar", { metodo: "POST", corpo: { tipo: atual, restaurarPadrao: true } });
          avisar("Texto padrão restaurado.");
          telaMensagens();
        })
      })));
  const mostrarModelo = () => {
    const m = modelos.find(x => x.tipo === atual);
    texto.value = m.texto;
    texto.id = `texto-${atual}`;   // id por modelo (os testes e o rótulo usam)
    form.querySelector("label[for^=texto]").setAttribute("for", texto.id);
    form.dataset.modelo = atual;
    uso.textContent = `Usado em: ${USO[atual] || ""}`;
    estadoMensagens.modelo = atual;
  };
  escolha.addEventListener("change", () => { atual = escolha.value; mostrarModelo(); });
  form.addEventListener("submit", ev => {
    ev.preventDefault();
    enviar(form, async () => {
      await api("/modelos-mensagem/alterar", { metodo: "POST", corpo: { tipo: atual, texto: texto.value } });
      modelos.find(x => x.tipo === atual).texto = texto.value.trim();
      avisar("Modelo salvo.");
    });
  });
  mostrarModelo();
  const envio = await blocoEnviarMensagem(modelos, campos);
  mostrar(cabecalho("Mensagens", "Escolha a mensagem, escolha os clientes e envie pelo WhatsApp."),
    el("div", { class: "tela-mensagens" },
      envio,
      el("details", { class: "painel-novo painel-modelos", "data-teste": "painel-modelos" },
        el("summary", {}, el("span", { class: "mais-novo", text: "✎" }), "Textos dos botões da agenda (confirmação, lembrete, proposta)"),
        el("div", { class: "painel-modelos-corpo" }, el("h3", { class: "titulo-secao", text: "Modelos da agenda" }), form))));
}
const estadoMensagens = { modelo: null };

// ENVIAR MENSAGEM: escolhe clientes do dia (com telefone), escreve o texto e abre o WhatsApp de cada um, já personalizado.
let dataEnvioMensagem = null;
// Mensagens prontas para enviar a clientes (com ou sem horário). Dá para mudar o texto antes de enviar.
const MENSAGENS_PRONTAS = {
  saudade: ["Sentimos sua falta", "Olá, {cliente}! Faz tempo que você não passa aqui na {barbearia}. Que tal marcar um horário esta semana? É só responder esta mensagem."],
  promocao: ["Promoção", "Olá, {cliente}! Temos uma promoção especial na {barbearia} nesta semana. Responda esta mensagem para garantir o seu horário!"],
  aviso: ["Aviso (feriado ou horário)", "Olá, {cliente}! Aviso da {barbearia}: (escreva aqui o aviso, por exemplo: no feriado estaremos fechados)."],
  obrigado: ["Agradecimento", "Olá, {cliente}! Obrigado pela preferência na {barbearia}. Esperamos você na próxima!"]
};
let origemEnvio = "dia";   // "dia" = clientes com horário no dia; "cadastrados" = qualquer cliente (sem telefone: escolhe o contato no WhatsApp)
async function blocoEnviarMensagem(modelos, campos) {
  dataEnvioMensagem ||= hojeLocal();
  const doDia = origemEnvio === "dia";
  const dados = doDia ? await api(`/mensagens/clientes-do-dia?data=${dataEnvioMensagem}`) : await api("/mensagens/contatos");
  // Itens da lista: { id, titulo, detalhe, pode }
  const itens = doDia
    ? dados.clientes.map(c => ({ id: c.agendamentoId, nome: c.cliente, titulo: `${c.hora} · ${c.cliente}`, pode: c.podeReceber, hora: c.hora, barbeiro: c.barbeiro, servico: c.servicos || "",
      detalhe: c.podeReceber ? `${c.telefone ? fone(c.telefone) : "Sem telefone (escolhe o contato no WhatsApp)"} · ${c.barbeiro}${c.servicos ? ` · ${c.servicos}` : ""}` : "Cliente desativado" }))
    : dados.contatos.map(c => ({ id: c.clienteId, nome: c.nome, titulo: c.nome, pode: true, detalhe: c.telefone ? fone(c.telefone) : "Sem telefone (escolhe o contato no WhatsApp)" }));
  const origem = el("div", { class: "alterna largo", role: "tablist", "aria-label": "Para quem" },
    [["dia", "Com horário marcado"], ["cadastrados", "Clientes cadastrados"]].map(([k, t]) =>
      botao(t, () => { origemEnvio = k; comCarga(telaMensagens).catch(e => avisar(e.message, "erro")); }, `pequeno ${origemEnvio === k ? "ativo" : ""}`)));
  const dataInput = el("input", { type: "date", id: "env-data", value: dataEnvioMensagem, "aria-label": "Dia dos clientes" });
  dataInput.addEventListener("change", () => { if (dataInput.value) { dataEnvioMensagem = dataInput.value; telaMensagens(); } });
  const filtro = el("input", { type: "search", id: "env-filtro", autocomplete: "off", placeholder: "Filtrar por nome", "aria-label": "Filtrar clientes" });
  const contador = el("span", { class: "suave", "data-teste": "selecionados" });
  const textoEl = el("textarea", { id: "env-texto", name: "envTexto", rows: "2", maxlength: "1000", "aria-label": "Mensagem",
    placeholder: doDia ? "Ex.: Olá {cliente}! Hoje às {hora} te esperamos na {barbearia}." : "Ex.: Olá {cliente}! Novidade na {barbearia}: ..." });
  const selecionaveis = itens.filter(c => c.pode);
  const caixas = [];
  const linhas = itens.map(c => {
    const chk = el("input", { type: "checkbox", id: `dest-${c.id}`, value: c.id, disabled: c.pode ? null : true });
    if (c.pode) caixas.push(chk);
    return el("li", { class: `destino ${c.pode ? "" : "sem-fone"}`, "data-destino": c.nome },
      el("span", { class: "zap-avatar", text: iniciais(c.nome) }),
      el("label", { for: `dest-${c.id}` }, el("strong", { text: c.titulo }), el("span", { class: "suave", text: c.detalhe })), chk);
  });
  const lista = itens.length ? el("ul", { class: "lista-destinos rolavel" }, linhas)
    : el("p", { class: "vazio", text: doDia ? "Nenhum cliente com horário neste dia." : "Nenhum cliente cadastrado com telefone." });
  filtro.addEventListener("input", () => {
    const t = filtro.value.trim().toLowerCase();
    linhas.forEach(li => { li.hidden = Boolean(t) && !li.dataset.destino.toLowerCase().includes(t); });
  });
  const atualizarContador = () => { const n = caixas.filter(c => c.checked).length; contador.textContent = `${n} de ${selecionaveis.length} selecionado(s)`; };
  const todos = el("button", { type: "button", class: "botao pequeno", text: "Marcar todos", onclick: () => {
    const visiveis = caixas.filter(c => !c.closest("li").hidden);
    const marcar = visiveis.some(c => !c.checked);
    visiveis.forEach(c => { c.checked = marcar; });
    todos.textContent = marcar ? "Desmarcar todos" : "Marcar todos";
    atualizarContador();
  } });
  caixas.forEach(c => c.addEventListener("change", atualizarContador));
  atualizarContador();
  const usar = tipo => { const m = modelos.find(x => x.tipo === tipo); if (m) { textoEl.value = m.texto; textoEl.focus(); } };
  // Mensagens prontas: servem para qualquer cliente (só {cliente} e {barbearia}); os modelos da agenda só para clientes do dia.
  // Escolha por botões em dois grupos (no celular a lista suspensa ficava confusa).
  const opcoesModelo = [];
  const botaoModelo = (valor, texto, aplicar) => {
    const b = el("button", { type: "button", class: "chip-modelo", "data-modelo": valor, "aria-pressed": "false", text: texto, onclick: () => {
      opcoesModelo.forEach(o => { o.classList.toggle("ativo", o === b); o.setAttribute("aria-pressed", String(o === b)); });
      aplicar();
    } });
    opcoesModelo.push(b);
    return b;
  };
  const grupoModelo = (titulo, botoes) => el("div", { class: "grupo-modelos" }, el("span", { class: "grupo-modelos-tit", text: titulo }), el("div", { class: "chips-modelo" }, botoes));
  const escolhaModelo = el("div", { id: "env-modelo", class: "escolha-modelos", role: "group", "aria-labelledby": "env-modelo-tit" },
    doDia ? grupoModelo("Do horário marcado (com data e hora)",
      [["confirmacao", "Confirmação"], ["lembrete", "Lembrete"], ["proposta", "Proposta de horário"]].map(([v, t]) => botaoModelo(v, t, () => usar(v)))) : null,
    grupoModelo("Para qualquer cliente",
      Object.entries(MENSAGENS_PRONTAS).map(([v, [t, texto]]) => botaoModelo(`pronta:${v}`, t, () => { textoEl.value = texto; textoEl.focus(); }))),
    el("button", { type: "button", class: "botao pequeno limpar-modelo", text: "Escrever do zero", onclick: () => {
      opcoesModelo.forEach(o => { o.classList.remove("ativo"); o.setAttribute("aria-pressed", "false"); });
      textoEl.value = ""; textoEl.focus();
    } }));
  const camposUsaveis = doDia ? campos : campos.filter(c => c === "cliente" || c === "barbearia");
  const fila = el("div", { class: "fila-envio", "data-teste": "fila-envio" });
  // Prévia como no WhatsApp: a mensagem já com os dados do 1º cliente escolhido.
  const bolha = el("div", { class: "zap-bolha enviada", "data-teste": "previa" });
  const atualizarPrevia = () => {
    const c = itens.find(x => caixas.some(k => k.checked && k.value === x.id)) || null;
    const campos = { cliente: c ? c.nome.split(" ")[0] : "Cliente", barbearia: usuario?.barbearia?.nome || "", data: dataBR(dataEnvioMensagem).slice(0, 5),
      hora: c?.hora || "10:00", barbeiro: (c?.barbeiro || "").split(" ")[0], servico: c?.servico || "" };
    const txt = textoEl.value.trim() ? textoEl.value.replace(/\{(cliente|barbearia|data|hora|barbeiro|servico)\}/g, (_, k) => campos[k] ?? "") : "";
    const n = caixas.filter(k => k.checked).length;
    bolha.replaceChildren(...(txt ? [el("span", { class: "zap-texto", text: txt }), el("small", { class: "zap-hora", text: `${n ? `para ${n} cliente${n === 1 ? "" : "s"}` : "escolha os clientes"} ✓✓` })]
      : [el("span", { class: "zap-vazio", text: "Escolha uma mensagem pronta ou escreva abaixo. A prévia aparece aqui." })]));
  };
  textoEl.addEventListener("input", atualizarPrevia);
  caixas.forEach(c => c.addEventListener("change", atualizarPrevia));
  escolhaModelo.addEventListener("click", () => setTimeout(atualizarPrevia));
  const atalhoDia = (rot, d) => el("button", { type: "button", class: `chip-filtro ${dataEnvioMensagem === d ? "ativo" : ""}`, text: rot,
    onclick: () => { dataEnvioMensagem = d; comCarga(telaMensagens).catch(e => avisar(e.message, "erro")); } });
  const enviarBtn = el("button", { type: "submit", class: "zap-enviar", "aria-label": "Enviar mensagem", title: "Enviar mensagem" }, icone("enviar"));
  const form = el("form", { class: "enviar-mensagem zap", "data-teste": "enviar-mensagem" },
    el("div", { class: "zap-topo" }, el("span", { class: "zap-avatar grande", text: "4b" }),
      el("div", {}, el("strong", { text: "Mensagem pelo WhatsApp" }), el("small", { text: "Uma mensagem, já com o nome de cada cliente" }))),
    el("div", { class: "zap-corpo" },
      el("div", { class: "zap-passo" }, el("span", { class: "zap-num", text: "1" }), el("span", { id: "env-modelo-tit", text: "Escolha a mensagem" })),
      escolhaModelo,
      el("div", { class: "zap-passo" }, el("span", { class: "zap-num", text: "2" }), el("span", { text: "Para quem?" })),
      origem,
      doDia ? el("div", { class: "zap-dia" },
        el("div", { class: "chips-filtro" }, atalhoDia("Hoje", hojeLocal()), atalhoDia("Amanhã", somaDias(hojeLocal(), 1))),
        el("label", { for: "env-data", class: "suave", text: "ou outro dia:" }), dataInput)
        : el("div", { class: "busca-campo" }, icone("busca"), filtro),
      el("div", { class: "zap-contatos" },
        el("div", { class: "zap-contatos-topo" }, contador, selecionaveis.length ? todos : null),
        lista),
      el("div", { class: "zap-passo" }, el("span", { class: "zap-num", text: "3" }), el("span", { text: "Confira e envie" })),
      bolha),
    el("div", { class: "zap-compositor" },
      el("div", { class: "chips" }, camposUsaveis.map(c => el("button", {
        type: "button", class: "chip", text: `{${c}}`,
        onclick: () => { const pos = textoEl.selectionStart ?? textoEl.value.length; textoEl.value = `${textoEl.value.slice(0, pos)}{${c}}${textoEl.value.slice(textoEl.selectionEnd ?? pos)}`; textoEl.focus(); atualizarPrevia(); }
      }))),
      el("div", { class: "zap-escrever" }, el("label", { for: "env-texto", class: "oculto", text: "Mensagem" }), textoEl, enviarBtn),
      doDia ? null : el("p", { class: "suave", text: "Para clientes sem horário, use só {cliente} e {barbearia}." })),
    fila);
  atualizarPrevia();
  form.addEventListener("submit", ev => {
    ev.preventDefault();
    enviar(form, async () => {
      const ids = caixas.filter(c => c.checked).map(c => c.value);
      if (!ids.length) throw new Error("Escolha pelo menos um cliente.");
      if (textoEl.value.trim().length < 2) throw new Error("Escreva a mensagem.");
      const corpo = doDia ? { data: dataEnvioMensagem, texto: textoEl.value, agendamentoIds: ids } : { texto: textoEl.value, clienteIds: ids };
      const { envio } = await api("/mensagens/envios", { metodo: "POST", corpo });
      mostrarFilaEnvio(fila, envio);
    });
  });
  return form;
}
// O WhatsApp abre uma conversa por vez: um botão por cliente e o "Abrir o próximo", que vai seguindo a lista.
function mostrarFilaEnvio(fila, envio) {
  let abertos = 0;
  const progresso = el("p", { class: "progresso-envio", "data-teste": "progresso-envio" });
  const marcadores = [];
  const proximo = el("a", { class: "botao whats largo proximo-envio", target: "_blank", rel: "noopener", "data-teste": "abrir-proximo" });
  const atualizar = () => {
    progresso.textContent = abertos === envio.total ? `Pronto: WhatsApp aberto para os ${envio.total} cliente(s).` : `${abertos} de ${envio.total} aberto(s) no WhatsApp. Em cada conversa, toque em "Enviar" e volte aqui.`;
    const p = marcadores.find(m => !m.feito);
    proximo.hidden = !p;
    if (p) { proximo.href = p.d.link; proximo.textContent = `Abrir o próximo: ${p.d.cliente.split(" ")[0]} (${abertos + 1} de ${envio.total})`; proximo.dataset.destino = p.d.id; }
  };
  const marcar = m => {
    if (m.feito) return;
    m.feito = true; m.estado.textContent = "Aberto ✓"; m.estado.className = "etiqueta verde";
    abertos++;
    api("/mensagens/envios/aberto", { metodo: "POST", corpo: { destinoId: m.d.id } }).catch(() => {});
  };
  proximo.addEventListener("click", () => {
    const m = marcadores.find(x => x.d.id === proximo.dataset.destino);
    if (m) marcar(m);
    setTimeout(atualizar);   // depois que o link abriu, aponta para o seguinte
  });
  fila.replaceChildren(
    el("h4", { text: "Agora envie para cada cliente" }),
    progresso, proximo,
    el("ul", { class: "lista-destinos" }, envio.destinos.map(d => {
      const estado = el("span", { class: "etiqueta", text: "A enviar" });
      const m = { d, estado, feito: false };
      marcadores.push(m);
      const link = el("a", {
        class: "botao pequeno whats", href: d.link, target: "_blank", rel: "noopener", "data-enviar": d.cliente, "data-com-numero": d.comNumero ? "sim" : "nao", text: d.comNumero === false ? `Enviar para ${d.cliente.split(" ")[0]} (escolher contato)` : `Enviar para ${d.cliente.split(" ")[0]}`,
        onclick: () => { marcar(m); setTimeout(atualizar); }
      });
      return el("li", { class: "destino" }, el("div", {}, el("strong", { text: [d.hora, d.cliente].filter(Boolean).join(" · ") })), estado, link);
    })));
  atualizar();
  fila.scrollIntoView({ block: "nearest" });
}


// ---------- MENU LATERAL (categorias com sub-opções; ícones em SVG) ----------

// ---------- NOTA VENCIDA E BLOQUEIO (17/11/2026) ----------
// Selo curto na lista (busca, agenda, clientes) e aviso maior quando o cliente é escolhido.
function seloCliente(c) {
  if (!c) return null;
  if (c.bloqueado) return el("span", { class: "etiqueta vermelha selo-cliente", "data-selo": "bloqueado", text: "Bloqueado" });
  const v = c.notaVencida?.totalCentavos || c.notaVencidaCentavos;
  return v ? el("span", { class: "etiqueta vermelha selo-cliente", "data-selo": "nota-vencida", text: `Nota vencida ${reais(v)}` }) : null;
}
function avisoCliente(c) {
  if (c?.bloqueado) return el("p", { class: "erro aviso-cliente", "data-teste": "aviso-bloqueado", text: `Cliente bloqueado: ${c.bloqueado.motivo}. Desbloqueie em Clientes para marcar.` });
  if (c?.notaVencida) return el("p", { class: "aviso-cliente alerta-nota", "data-teste": "aviso-nota-vencida",
    text: `⚠ Nota vencida: ${reais(c.notaVencida.totalCentavos)}${c.notaVencida.desde ? ` desde ${dataBR(c.notaVencida.desde)} (${c.notaVencida.dias} dias)` : " (há 30 dias ou mais)"}.` });
  if (c?.notaVencidaCentavos) return el("p", { class: "aviso-cliente alerta-nota", "data-teste": "aviso-nota-vencida", text: `⚠ Nota vencida: ${reais(c.notaVencidaCentavos)} em aberto há 30 dias ou mais.` });
  return null;
}
// Pop-up por cima da janela aberta (2ª camada), com "aceite". Devolve true/false.
function alertaAceite({ titulo, texto, detalhe = null, ok = "Aceito e quero continuar", cancelar = "Não marcar" }) {
  return new Promise(resolve => {
    const d = el("dialog", { class: "janela alerta-aceite", "data-teste": "alerta-aceite", role: "alertdialog" });
    const fechar = v => { d.close(); d.remove(); resolve(v); };
    d.append(el("div", { class: "janela-form" },
      el("div", { class: "alerta-icone", "aria-hidden": "true", text: "!" }),
      el("h3", { text: titulo }), el("p", { text: texto }), detalhe ? el("p", { class: "suave", text: detalhe }) : null,
      el("div", { class: "janela-botoes" },
        el("button", { type: "button", class: "botao", text: cancelar, onclick: () => fechar(false) }),
        el("button", { type: "button", class: "botao perigo-cheio", "data-teste": "aceitar", text: ok, onclick: () => fechar(true) }))));
    d.addEventListener("cancel", ev => { ev.preventDefault(); fechar(false); });
    document.body.append(d);
    d.showModal();
  });
}
// Marca (ou repete) pedindo o aceite quando o servidor avisa nota vencida.
async function comAceiteNota(chamar) {
  try {
    return await chamar({});
  } catch (e) {
    if (e.dados?.codigo !== "nota_vencida") throw e;
    const n = e.dados.nota;
    const sim = await alertaAceite({
      titulo: "Cliente com nota vencida",
      texto: `${n.cliente} deve ${reais(n.totalCentavos)} desde ${dataBR(n.desde)} (${n.dias} dias).`,
      detalhe: "Para marcar mesmo assim, confirme que está ciente. Fica registrado quem aceitou. Aproveite para combinar o pagamento com o cliente.",
      ok: "Estou ciente, marcar"
    });
    if (!sim) throw new Error("Horário não marcado (nota vencida).");
    return chamar({ aceiteNotaVencida: true });
  }
}
function janelaBloquearCliente(c, recarregar) {
  return c.bloqueado
    ? pedirMotivo(`Desbloquear ${c.nome}`, `Bloqueado por: ${c.bloqueado.motivo}. Depois de desbloquear, ele volta a poder marcar horário.`, async motivo => {
      const r = await api("/clientes/desbloquear", { metodo: "POST", corpo: { clienteId: c.id || c.clienteId, motivo } });
      avisar(r.mensagem); recarregar();
    }, "Desbloquear")
    : pedirMotivo(`Bloquear ${c.nome || c.cliente}`, "Cliente bloqueado não consegue marcar horário novo (os já marcados continuam). Dá para desbloquear depois.", async motivo => {
      const r = await api("/clientes/bloquear", { metodo: "POST", corpo: { clienteId: c.id || c.clienteId, motivo } });
      avisar(r.mensagem); recarregar();
    }, "Bloquear cliente");
}

// ---------- NOTIFICAÇÕES (17/11/2026) ----------
// Calculadas no servidor; aqui só guardamos neste aparelho quais já foram vistas (para o número no sino).
const CHAVE_VISTAS = "4blade.notificacoesVistas";
let ultimasNotificacoes = { em: 0, itens: [] };
const vistas = () => { try { return new Set(JSON.parse(localStorage.getItem(CHAVE_VISTAS) || "[]")); } catch { return new Set(); } };
function marcarVistas(itens) {
  const v = vistas();
  for (const i of itens) v.add(i.id);
  localStorage.setItem(CHAVE_VISTAS, JSON.stringify([...v].slice(-500)));
  atualizarSino();
}
function atualizarSino() {
  const b = document.getElementById("btn-notif");
  if (!b) return;
  const v = vistas();
  const n = ultimasNotificacoes.itens.filter(i => !v.has(i.id)).length;
  const bolha = b.querySelector(".sino-num");
  bolha.textContent = n > 99 ? "99+" : String(n);
  bolha.hidden = !n;
  b.setAttribute("aria-label", n ? `Notificações: ${n} nova(s)` : "Notificações");
}
async function buscarNotificacoes(forcar = false) {
  if (!usuario?.barbearia || usuario.perfil === "plataforma") return ultimasNotificacoes;
  if (!forcar && Date.now() - ultimasNotificacoes.em < 60000) { atualizarSino(); return ultimasNotificacoes; }
  try {
    const r = await api("/notificacoes");
    ultimasNotificacoes = { em: Date.now(), itens: r.itens };
  } catch { /* sem conexão: mantém o que tinha */ }
  atualizarSino();
  return ultimasNotificacoes;
}
const NIVEL_NOTIF = { alerta: ["Importante", "vermelha"], aviso: ["Atenção", "amarela"], info: ["Para saber", ""] };
const ICONE_NOTIF = { nota: "contas", atendimento: "agenda", produto: "estoque", valor: "dinheiro", despesa: "contas", caixa: "caixa", comissao: "comissao" };
const estadoNotif = { filtro: "todas" };
async function telaNotificacoes() {
  const { itens } = await buscarNotificacoes(true);
  const v = vistas();
  const tipos = [...new Set(itens.map(i => i.tipo))];
  const NOME_TIPO = { nota: "Notas", atendimento: "Atendimentos", produto: "Produtos", valor: "Valores", despesa: "Despesas", caixa: "Caixa", comissao: "Comissões" };
  if (estadoNotif.filtro !== "todas" && !tipos.includes(estadoNotif.filtro)) estadoNotif.filtro = "todas";
  const ul = el("ul", { class: "lista-notif" });
  const desenhar = () => {
    const vis = itens.filter(i => estadoNotif.filtro === "todas" || i.tipo === estadoNotif.filtro);
    ul.replaceChildren(...(vis.length ? vis.map(i => el("li", { class: `notif nivel-${i.nivel} ${v.has(i.id) ? "vista" : "nova"}`, "data-notif": i.tipo },
      el("a", { href: `#/${i.rota}`, class: "notif-link" },
        el("span", { class: "notif-icone", "aria-hidden": "true" }, icone(ICONE_NOTIF[i.tipo] || "ajuda")),
        el("span", { class: "notif-txt" }, el("strong", { text: i.titulo }), el("small", { text: i.texto })),
        el("span", { class: `etiqueta ${NIVEL_NOTIF[i.nivel][1]}`, text: NIVEL_NOTIF[i.nivel][0] }))))
      : [el("li", { class: "vazio", text: "Tudo em dia por aqui. ✔" })]));
  };
  desenhar();
  const chips = el("div", { class: "chips-filtro chips-quebra", role: "group", "aria-label": "Filtrar" },
    [["todas", `Todas (${itens.length})`], ...tipos.map(t => [t, `${NOME_TIPO[t] || t} (${itens.filter(i => i.tipo === t).length})`])].map(([id, t]) =>
      el("button", { type: "button", class: `chip-filtro ${estadoNotif.filtro === id ? "ativo" : ""}`, "data-filtro": id, text: t,
        onclick: ev => { estadoNotif.filtro = id; chips.querySelectorAll(".chip-filtro").forEach(b => b.classList.toggle("ativo", b === ev.currentTarget)); desenhar(); } })));
  const novas = itens.filter(i => !v.has(i.id)).length;
  mostrar(cabecalho("Notificações", "O que precisa da sua atenção. Toque num aviso para ir direto à tela certa. Some sozinho quando for resolvido."),
    el("div", { class: "notif-topo" },
      el("p", { class: "suave", "data-teste": "notif-novas", text: novas ? `${novas} nova(s) desde a última visita.` : "Nenhuma nova." }),
      novas ? botao("Marcar todas como vistas", () => { marcarVistas(itens); telaNotificacoes(); }, "pequeno") : null),
    chips, ul);
}


// ---------- VISÃO DO DIA (caixa e gestão, 17/11/2026): o dia e a semana num lugar só, com as ações mais usadas ----------
const NOME_DIA_CURTO = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
async function telaVisaoDia() {
  const v = await api("/visao-dia");
  const recarregar = () => telaVisaoDia();
  const r = v.resumo;
  const NOME_CAIXA = { aberto: "Caixa aberto", fechado: "Caixa fechado", nao_aberto: "Caixa ainda não aberto" };
  const resumo = el("div", { class: "resumo-despesas quatro", "data-teste": "visao-resumo" },
    el("div", { class: "resumo-item" }, el("small", { text: "Marcados hoje" }), el("strong", { text: String(r.marcados) }), el("span", { text: `${r.faltas} falta(s)` })),
    el("div", { class: "resumo-item ok" }, el("small", { text: "Atendidos" }), el("strong", { text: String(r.finalizados) }), el("span", { text: `${r.aguardando} aguardando` })),
    el("div", { class: `resumo-item ${v.naoFechados.length ? "alerta" : ""}` }, el("small", { text: "Sem fechar" }), el("strong", { text: String(v.naoFechados.length) }), el("span", { text: "atendimento(s)" })),
    el("div", { class: "resumo-item" }, el("small", { text: "Recebido hoje" }), el("strong", { text: reais(r.recebidoCentavos) }), el("span", { "data-teste": "situacao-caixa", text: NOME_CAIXA[r.caixa] })));
  const maior = Math.max(1, ...v.semana.map(d => d.marcados));
  const semana = el("div", { class: "semana-mini", "data-teste": "visao-semana", role: "list" }, v.semana.map((d, i) => {
    const dt = new Date(`${d.data}T12:00:00`);
    const barra = el("span", { class: "semana-mini-barra" });
    barra.style.height = `${Math.round((d.marcados / maior) * 100)}%`;
    return el("button", { type: "button", class: `semana-mini-dia ${i === 0 ? "hoje" : ""}`, role: "listitem", "data-dia": d.data,
      "aria-label": `${NOME_DIA_CURTO[dt.getDay()]} ${dataBR(d.data).slice(0, 5)}: ${d.marcados} marcado(s)`,
      onclick: () => { estadoAgenda.data = d.data; estadoAgenda.visao = "dia"; location.hash = "#/agenda"; } },
      el("small", { text: i === 0 ? "Hoje" : NOME_DIA_CURTO[dt.getDay()] }),
      el("span", { class: "semana-mini-trilho" }, barra),
      el("strong", { text: String(d.marcados) }), el("small", { text: dataBR(d.data).slice(0, 5) }));
  }));
  const secao = (titulo, qtd, teste, conteudo, acaoTopo = null) => el("section", { class: "cartao visao-secao", "data-secao": teste },
    el("div", { class: "secao-titulo" }, el("h3", {}, titulo, qtd !== null ? el("span", { class: `contagem ${qtd ? "tem" : ""}`, text: String(qtd) }) : null), acaoTopo),
    conteudo);
  const lista = (itens, vazio) => itens.length ? el("ul", { class: "lista-x" }, itens) : el("p", { class: "suave", text: vazio });
  // Sem telefone no cadastro: o link abre o WhatsApp com a mensagem pronta para escolher o contato.
  const whats = (link, texto, comNumero = true) => link ? el("a", { class: "botao pequeno whats", href: link, target: "_blank", rel: "noopener",
    "data-com-numero": comNumero ? "sim" : "nao", text: comNumero ? texto : `${texto} (escolher contato)` }) : null;

  const naoFechados = secao("Sem fechar", v.naoFechados.length, "nao-fechados", lista(v.naoFechados.map(a => el("li", { class: "item-x linha-simples", "data-nao-fechado": a.cliente },
    el("div", { class: "item-x-resumo estatico" }, el("span", { class: "item-x-txt" }, el("strong", { text: a.cliente }), el("small", { text: `${dataBR(a.data)} às ${a.hora} · ${a.barbeiro}` })),
      el("a", { class: "botao pequeno principal", href: "#/caixa", text: "Cobrar" })))), "Tudo fechado. ✔"));

  const notas = secao("Notas vencidas (30 dias ou mais)", v.notasVencidas.length, "notas-vencidas", lista(v.notasVencidas.map(n => itemExpansivel({
    chave: `vd-nota:${n.clienteId}`, attrs: { "data-nota-vencida": n.cliente }, avatar: iniciais(n.cliente),
    titulo: n.cliente, sub: `${n.qtd} nota(s) · desde ${dataBR(n.desde)} (${n.dias} dias)`,
    direita: [el("span", { class: "preco", text: reais(n.totalCentavos) }), n.bloqueado ? el("span", { class: "etiqueta vermelha", text: "Bloqueado" }) : null],
    detalhes: () => acoesItem(
      whats(n.whatsapp, "Cobrar no WhatsApp", n.comNumero),
      // Recebe aqui mesmo (mesma janela da tela Notas); o valor entra no caixa de hoje.
      botao("Receber", async () => {
        try {
          const { clientes } = await api("/promissorias");
          const c = clientes.find(x => x.clienteId === n.clienteId);
          if (!c) { avisar("Esse cliente não tem mais nota em aberto."); return recarregar(); }
          janelaReceberNota(c, recarregar);
        } catch (e) { avisar(e.message, "erro"); }
      }, "pequeno principal"),
      botao(n.bloqueado ? "Desbloquear" : "Bloquear", () => janelaBloquearCliente({ clienteId: n.clienteId, nome: n.cliente, cliente: n.cliente, bloqueado: n.bloqueado ? { motivo: "nota vencida" } : null }, recarregar), "pequeno texto-perigo"))
  })), "Nenhuma nota vencida. ✔"));

  const COR = { agendado: "", finalizado: "verde", faltou: "vermelha" };
  const NOME = { agendado: "Marcado", finalizado: "Atendido", faltou: "Faltou" };
  const agenda = secao("Hoje na agenda", v.agenda.length, "agenda-hoje", lista(v.agenda.map(a => itemExpansivel({
    chave: `vd-ag:${a.id}`, attrs: { "data-hoje": a.cliente },
    titulo: [el("span", { class: "hora-lista", text: a.hora }), a.cliente], sub: a.barbeiro,
    direita: [seloCliente(a), el("span", { class: `etiqueta ${COR[a.situacao]}`, text: NOME[a.situacao] })],
    detalhes: () => [avisoCliente(a), acoesItem(
      a.situacao === "agendado" ? whats(a.whatsapp, "Lembrar no WhatsApp", a.comNumero) : null,
      a.situacao === "agendado" ? el("a", { class: "botao pequeno principal", href: "#/caixa", text: "Cobrar no caixa" }) : null,
      el("a", { class: "botao pequeno", href: "#/agenda", text: "Ver na agenda", onclick: () => { estadoAgenda.data = v.hoje; estadoAgenda.visao = "dia"; } }))]
  })), "Ninguém marcado hoje."), el("a", { class: "botao pequeno", href: "#/mensagens", text: "Enviar mensagens" }));

  const faltas = secao("Faltaram (últimos 7 dias)", v.faltas.length, "faltas", lista(v.faltas.map(f => itemExpansivel({
    chave: `vd-falta:${f.id}`, attrs: { "data-falta": f.cliente }, avatar: iniciais(f.cliente),
    titulo: f.cliente, sub: `${dataBR(f.data)} às ${f.hora} · ${f.barbeiro}`,
    direita: f.bloqueado ? el("span", { class: "etiqueta vermelha", text: "Bloqueado" }) : null,
    detalhes: () => acoesItem(
      whats(f.whatsapp, "Chamar para remarcar", f.comNumero),
      f.bloqueado ? null : botao("Bloquear", () => janelaBloquearCliente({ clienteId: f.clienteId, nome: f.cliente, cliente: f.cliente }, recarregar), "pequeno texto-perigo"))
  })), "Nenhuma falta. ✔"));

  const produtos = secao("Produtos a vencer (60 dias)", v.produtosAVencer.length, "produtos-vencer", lista(v.produtosAVencer.map(p => el("li", { class: "item-x linha-simples", "data-produto-vencer": p.nome },
    el("div", { class: "item-x-resumo estatico" }, el("span", { class: "item-x-txt" }, el("strong", { text: p.nome }), el("small", { text: `${p.saldo} un. no estoque` })),
      el("span", { class: `etiqueta ${p.vencido ? "vermelha" : "amarela"}`, text: `${p.vencido ? "Venceu" : "Vence"} ${dataBR(p.validade)}` })))), "Nenhum produto perto de vencer. ✔"));

  const bloqueados = v.bloqueados.length ? secao("Clientes bloqueados", v.bloqueados.length, "bloqueados", lista(v.bloqueados.map(b => el("li", { class: "item-x linha-simples", "data-bloqueado": b.cliente },
    el("div", { class: "item-x-resumo estatico" }, el("span", { class: "item-x-txt" }, el("strong", { text: b.cliente }), el("small", { text: `${b.motivo} · desde ${dataBR(b.desde)}` })),
      botao("Desbloquear", () => janelaBloquearCliente({ id: b.clienteId, nome: b.cliente, bloqueado: { motivo: b.motivo } }, recarregar), "pequeno")))), "")) : null;

  const d = new Date(`${v.hoje}T12:00:00`);
  mostrar(cabecalho("Visão do dia", `${["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"][d.getDay()]}, ${dataBR(v.hoje)} — tudo que importa hoje e na semana.`),
    resumo,
    el("section", { class: "cartao" }, el("div", { class: "secao-titulo" }, el("h3", { text: "Próximos 7 dias" }), el("small", { class: "suave", text: "Toque no dia para abrir a agenda" })), semana),
    el("div", { class: "duas-colunas visao-colunas" },
      el("div", {}, naoFechados, agenda, faltas),
      el("div", {}, notas, produtos, bloqueados)));
}

// ---------- NOTAS EM ABERTO (promissória) ----------
// Quem levou serviço/produto para pagar depois. "Receber" só quando o cliente quita: o valor entra no caixa de hoje.
// Nota paga continua registrada (aba Pagas). Cancelar nota em aberto: só gerente/proprietário, com motivo.
const estadoNotas = { aba: "abertas", busca: "" };
// 17/11/2026: uma linha por cliente (nome + total); toque abre as notas e as ações. Abas viraram filtros simples.
async function telaNotas() {
  const aba = estadoNotas.aba;
  const [{ clientes, resumo }, hist, rec] = await Promise.all([
    api("/promissorias"),
    aba === "canceladas" ? api("/promissorias/historico?situacao=canceladas") : null,
    aba === "pagas" ? api("/promissorias/recebimentos") : null
  ]);
  const ul = el("ul", { class: "lista-x" });
  const casa = txt => !estadoNotas.busca || normalizar(txt).includes(normalizar(estadoNotas.busca));
  const desenhar = () => {
    let itens = [];
    if (aba === "abertas") {
      itens = clientes.filter(c => casa(c.cliente)).map(c => itemExpansivel({
        chave: `nota:${c.clienteId}`, attrs: { "data-nota-cliente": c.cliente }, avatar: iniciais(c.cliente),
        titulo: c.cliente, sub: `${c.notas.length} nota(s) · desde ${dataBR(c.desde)}`,
        direita: el("span", { class: "preco", "data-teste": "nota-total", text: reais(c.totalCentavos) }),
        detalhes: () => [
          el("ul", { class: "notas-itens" }, c.notas.map(n => el("li", { "data-nota": n.descricao },
            el("span", { text: `${dataBR(n.data).slice(0, 5)} · ${n.descricao}` }),
            el("strong", { text: reais(n.valorCentavos) }),
            gestao() ? el("button", { type: "button", class: "link-perigo", "data-cancelar-nota": n.descricao, text: "Cancelar", "aria-label": `Cancelar nota ${n.descricao}`,
              onclick: () => pedirMotivo("Cancelar nota", `${reais(n.valorCentavos)} de ${c.cliente}. A nota fica registrada como cancelada (nada é apagado).`, async motivo => {
                await api("/promissorias/cancelar", { metodo: "POST", corpo: { id: n.id, motivo } });
                avisar("Nota cancelada."); telaNotas();
              }, "Cancelar nota") }) : null))),
          acoesItem(
            botao("Receber", () => janelaReceberNota(c), "pequeno principal"),
            c.whatsapp ? el("a", { class: "botao pequeno whats", href: c.whatsapp, target: "_blank", rel: "noopener", "data-com-numero": c.comNumero ? "sim" : "nao", text: c.comNumero ? "Lembrar no WhatsApp" : "Lembrar no WhatsApp (escolher contato)" }) : null)
        ]
      }));
    } else if (aba === "pagas") {
      itens = rec.recebimentos.filter(r => casa(r.cliente)).map(r => itemExpansivel({
        chave: `rec:${r.id}`, attrs: { "data-recebimento": r.cliente }, classe: r.situacao === "estornado" ? "inativo" : "", avatar: iniciais(r.cliente),
        titulo: r.cliente, sub: `Pagou em ${dataBR(r.data)} · ${r.notas} nota(s)`,
        direita: [el("span", { class: "preco", text: reais(r.totalCentavos) }),
          r.situacao === "estornado" ? el("span", { class: "etiqueta vermelha", text: "Estornado" }) : el("span", { class: "etiqueta verde", text: "Pago" })],
        detalhes: () => [
          el("dl", { class: "dados-item" },
            el("dt", { text: "Pago com" }), el("dd", { text: r.pagamentos.map(p => `${NOME_FORMA[p.forma]} ${reais(p.valorCentavos)}`).join(" + ") }),
            el("dt", { text: "Recebido por" }), el("dd", { text: r.por.split(" ")[0] }),
            r.motivoEstorno ? [el("dt", { text: "Motivo do estorno" }), el("dd", { text: r.motivoEstorno })] : null),
          r.podeEstornar ? acoesItem(botao("Estornar recebimento", () => pedirMotivo("Estornar recebimento", "O dinheiro sai do caixa de hoje e as notas voltam a ficar em aberto. Fica registrado.", async motivo => {
            await api("/promissorias/estornar-recebimento", { metodo: "POST", corpo: { recebimentoId: r.id, motivo } });
            avisar("Recebimento estornado."); telaNotas();
          }, "Estornar"), "pequeno texto-perigo")) : null
        ]
      }));
    } else {
      itens = hist.notas.filter(n => casa(n.cliente)).map(n => itemExpansivel({
        chave: `ncanc:${n.id}`, attrs: { "data-nota-historico": n.cliente }, classe: "inativo", avatar: iniciais(n.cliente),
        titulo: n.cliente, sub: `${dataBR(n.data)} · ${n.descricao}`,
        direita: [el("span", { class: "preco", text: reais(n.valorCentavos) }), el("span", { class: "etiqueta vermelha", text: "Cancelada" })],
        detalhes: () => el("p", { class: "suave", text: n.motivo || "Sem motivo registrado." })
      }));
    }
    const vazio = { abertas: clientes.length ? "Nenhum cliente encontrado." : "Ninguém devendo. Para lançar, escolha \"Promissória (paga depois)\" no caixa.",
      pagas: "Nenhum recebimento nos últimos 30 dias.", canceladas: "Nenhuma nota cancelada nos últimos 90 dias." }[aba];
    ul.replaceChildren(...(itens.length ? itens : [el("li", { class: "vazio", text: vazio })]));
  };
  desenhar();
  const resumoEl = el("div", { class: "resumo-despesas duas" },
    el("div", { class: `resumo-item ${resumo.totalCentavos ? "alerta" : ""}`, "data-cartao": "notas-total" }, el("small", { text: "Total a receber" }), el("strong", { text: reais(resumo.totalCentavos) })),
    el("div", { class: "resumo-item", "data-cartao": "notas-clientes" }, el("small", { text: "Clientes devendo" }), el("strong", { text: String(resumo.clientes) })));
  const barra = barraBusca({
    placeholder: "Buscar cliente",
    filtros: [["abertas", `A receber (${resumo.clientes})`], ["pagas", "Pagas"], ["canceladas", "Canceladas"]],
    estado: { busca: estadoNotas.busca, get filtro() { return estadoNotas.aba; }, set filtro(v) { estadoNotas.aba = v; } },
    aoMudar: () => {
      const campoB = document.querySelector(".busca-viva");
      if (estadoNotas.aba !== aba) { estadoNotas.busca = campoB?.value || ""; comCarga(telaNotas).catch(e => avisar(e.message, "erro")); return; }
      estadoNotas.busca = campoB?.value || ""; desenhar();
    }
  });
  telaLista({ titulo: "Notas (fiado)", subtitulo: "Quem levou para pagar depois. Toque no cliente para ver as notas e dar baixa quando ele pagar (entra no caixa de hoje).",
    topo: resumoEl, barra, lista: ul });
}

function janelaReceberNota(c, depois = null) {
  const linhas = c.notas.map(n => ({ n, chk: el("input", { type: "checkbox", name: "nota", value: n.id, id: `nota-${n.id}`, checked: true }) }));
  const totalEl = el("p", { class: "total-final", "data-teste": "total" });
  const total = () => linhas.filter(l => l.chk.checked).reduce((t, l) => t + l.n.valorCentavos, 0);
  const pag = blocoPagamento(total, { nota: false });
  const promessa = abrirJanela(`Receber nota de ${c.cliente}`, [
    el("p", { class: "suave", text: "Marque o que o cliente está pagando agora. O valor entra no caixa de hoje." }),
    el("div", { class: "lista-servicos" }, linhas.map(l => el("div", { class: "linha-servico" },
      el("div", { class: "marcar" }, l.chk, el("label", { for: `nota-${l.n.id}`, text: `${dataBR(l.n.data).slice(0, 5)} · ${l.n.descricao}` })),
      el("strong", { text: reais(l.n.valorCentavos) })))),
    totalEl, ...pag.elementos
  ], {
    ok: "Confirmar recebimento",
    aoConfirmar: async f => {
      const ids = linhas.filter(l => l.chk.checked).map(l => l.n.id);
      if (!ids.length) throw new Error("Marque pelo menos uma nota.");
      await api("/promissorias/receber", { metodo: "POST", corpo: { clienteId: c.clienteId, promissoriaIds: ids, pagamentos: pag.ler(f) } });
      avisar(`Nota recebida: ${reais(total())}.`);
      estadoNotas.aba = "abertas";
      (depois || telaNotas)();
    }
  });
  const atualizar = () => { totalEl.textContent = `Total: ${reais(total())}`; pag.atualizar(); };
  janela.querySelector("form").addEventListener("input", atualizar);
  janela.querySelector("form").addEventListener("change", atualizar);
  atualizar();
  return promessa;
}

const ICONES = {
  olho: "M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z",
  olhoFechado: "M3 3l18 18M10.6 10.6a2 2 0 0 0 2.8 2.8M9.9 5.2A10 10 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3.2 4.2M6.2 6.3C3.6 8 2 12 2 12s3.5 7 10 7a9.8 9.8 0 0 0 4.3-1",
  ajuda: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3M12 17h.01",
  suporte: "M3 18v-6a9 9 0 0 1 18 0v6M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z",
  tutorial: "M4 5h16v11H4zM10 8.5l4 2-4 2zM8 20h8",
  menu: "M4 6h16M4 12h16M4 18h16",
  seta: "M9 6l6 6-6 6",
  painel: "M4 13h6V4H4zM14 20h6v-9h-6zM4 20h6v-4H4zM14 4v4h6V4z",
  agenda: "M7 3v3M17 3v3M4 8h16M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zM8 12h3M8 16h3M14 12h2",
  caixa: "M4 7h16v12H4zM4 7l2-3h12l2 3M9 12h6M12 10v4",
  clientes: "M16 19v-1a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v1M9.5 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM21 19v-1a4 4 0 0 0-3-3.8M16 4.2a3 3 0 0 1 0 5.6",
  dinheiro: "M3 7h18v10H3zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6 10v.01M18 14v.01",
  comissao: "M19 5L5 19M7.5 9a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zM16.5 18a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z",
  contas: "M7 3h10l3 3v15H4V3zM8 9h8M8 13h8M8 17h5",
  contador: "M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8zM14 3v5h5M9 13h6M9 17h6",
  enviar: "M4 12l16-8-6 16-2.5-6.5zM11.5 13.5L20 4",
  busca: "M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-4-4",
  recibo: "M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6M9 16h3",
  sacola: "M5 8h14l-1 12H6zM9 8V7a3 3 0 0 1 6 0v1",
  lista: "M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01",
  setaBaixo: "M12 4v14M6 12l6 6 6-6",
  setaCima: "M12 20V6M6 12l6-6 6 6",
  cadeado: "M6 11h12v9H6zM8.5 11V8a3.5 3.5 0 0 1 7 0v3",
  sino: "M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.9 1.9 0 0 0 3.4 0",
  lixeira: "M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6",
  estoque: "M21 8l-9-5-9 5 9 5 9-5zM3 8v8l9 5 9-5V8M12 13v8",
  produtos: "M6 2h12l2 6H4zM4 8v13h16V8M9 12h6",
  servicos: "M6 3l12 18M18 3L6 21M6 3a3 3 0 1 0 0 .01M18 21a3 3 0 1 0 0-.01",
  equipe: "M17 20v-1a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v1M10 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM21 20v-1a4 4 0 0 0-3-3.87",
  relogio: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2",
  mensagem: "M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z",
  grafico: "M4 20V10M10 20V4M16 20v-7M22 20H2",
  config: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z",
  loja: "M3 9l2-5h14l2 5M3 9h18v11H3zM9 20v-6h6v6",
  usuario: "M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z"
};
function icone(nome) {
  return svg("svg", { viewBox: "0 0 24 24", class: "icone", "aria-hidden": "true" }, svg("path", { d: ICONES[nome] || "" }));
}

// Categorias de cada perfil. Rota = endereço da tela (#/rota).
function gruposDoMenu() {
  const p = usuario.perfil;
  if (p === "plataforma") return [{ id: "plataforma", titulo: "Plataforma", icone: "loja", itens: [["plataforma", "Barbearias", "loja"], ["pedidos", "Pedidos de teste", "clientes"], ["chamados", "Chamados", "suporte"]] }];
  if (usuario.assinatura?.bloqueada) return [{ id: "config", titulo: "Assinatura", icone: "dinheiro", itens: [["assinatura", "Minha assinatura", "dinheiro"], ["suporte", "Suporte", "suporte"]] }];
  return [...gruposDoPerfil(p), {
    id: "ajuda", titulo: "Ajuda", icone: "ajuda",
    itens: [["duvidas", "Dúvidas frequentes", "ajuda"], ["tutoriais", "Tutoriais", "tutorial"], ...(p === "proprietario" || p === "gerente" ? [["suporte", "Suporte", "suporte"]] : [])]
  }];
}
function gruposDoPerfil(p) {
  if (p === "caixa") return [
    { id: "atendimento", titulo: "Atendimento", icone: "agenda", itens: [["visao-dia", "Visão do dia", "painel"], ["caixa", "Caixa", "caixa"], ["agenda", "Agenda", "agenda"], ["notas", "Notas em aberto", "contas"], ["clientes", "Clientes", "clientes"], ["mensagens", "Mensagens", "mensagem"], ["notificacoes", "Notificações", "sino"]] },
    { id: "catalogo", titulo: "Catálogo", icone: "produtos", itens: [["servicos", "Serviços", "servicos"], ["produtos", "Produtos", "produtos"]] }
  ];
  if (p === "barbeiro") return [
    { id: "atendimento", titulo: "Meu trabalho", icone: "agenda", itens: [["agenda", "Minha agenda", "agenda"], ["desempenho", "Meu desempenho", "grafico"], ["notificacoes", "Notificações", "sino"]] },
    { id: "catalogo", titulo: "Catálogo", icone: "produtos", itens: [["servicos", "Serviços", "servicos"], ["produtos", "Produtos", "produtos"]] }
  ];
  return [
    { id: "inicio", titulo: "Visão geral", icone: "painel", itens: [["painel", "Painel", "painel"], ["visao-dia", "Visão do dia", "lista"], ["notificacoes", "Notificações", "sino"], ...(p === "gerente" || p === "proprietario" ? [["desempenho", "Meu desempenho", "grafico"]] : [])] },
    { id: "atendimento", titulo: "Atendimento", icone: "agenda", itens: [["agenda", "Agenda", "agenda"], ["caixa", "Caixa", "caixa"], ["clientes", "Clientes", "clientes"], ["mensagens", "Mensagens", "mensagem"]] },
    { id: "financeiro", titulo: "Financeiro", icone: "dinheiro", itens: [["financeiro", "Relatório financeiro", "grafico"], ["pagamento-equipe", "Pagamento da equipe", "equipe"], ["comissoes", "Comissões e vales", "comissao"], ["notas", "Notas em aberto", "contas"], ["contas", "Despesas", "contas"], ["contador", "Contador e dados", "contador"]] },
    { id: "catalogo", titulo: "Catálogo e estoque", icone: "estoque", itens: [["servicos", "Serviços", "servicos"], ["produtos", "Produtos", "produtos"], ["estoque", "Estoque", "estoque"]] },
    { id: "config", titulo: "Equipe e ajustes", icone: "config", itens: [["equipe", "Equipe", "equipe"], ["funcionamento", "Funcionamento", "relogio"], ["assinatura", "Meu plano", "dinheiro"]] }
  ];
}

const menuEl = () => document.getElementById("menu");
const gruposAbertos = new Set();
function rotaAtual() {
  const r = location.hash.replace(/^#\/?/, "").split("/")[0] || (usuario?.telaInicial ?? "");
  return r === "inicio" ? (gestao() ? "painel" : "agenda") : r === "caixa-historico" || r === "caixa-dia" ? "caixa" : r;
}
function montarMenu() {
  const aside = menuEl();
  const atual = rotaAtual();
  const grupos = gruposDoMenu();
  for (const g of grupos) if (g.itens.some(([r]) => r === atual)) gruposAbertos.add(g.id);
  aside.replaceChildren(
    el("div", { class: "menu-cabecalho" },
      el("img", { class: "menu-logo", src: "/icons/logo.png", alt: "4blade", width: "98", height: "40" }),
      el("strong", { text: usuario.barbearia ? usuario.barbearia.nome : "Plataforma" }),
      el("span", { text: `${usuario.nome.split(" ")[0]} · ${NOME_PERFIL[usuario.perfil]}` })),
    el("nav", { class: "menu-nav" }, grupos.map(g => {
      const aberto = gruposAbertos.has(g.id) || grupos.length === 1;
      const itens = el("div", { class: "grupo-itens", id: `grupo-${g.id}` }, g.itens.map(([rota, titulo, ic]) =>
        el("a", { class: `nav-item ${rota === atual ? "ativo" : ""}`, href: `#/${rota}`, "data-nav": titulo, "aria-current": rota === atual ? "page" : null,
          onclick: () => { fecharMenu(); if (location.hash === `#/${rota}`) rotear(); } }, icone(ic), el("span", { text: titulo }))));
      itens.hidden = !aberto;
      const titulo = el("button", { type: "button", class: "grupo-titulo", "aria-expanded": aberto ? "true" : "false", "aria-controls": `grupo-${g.id}`,
        onclick: () => {
          const abrir = itens.hidden;
          itens.hidden = !abrir;
          titulo.setAttribute("aria-expanded", abrir ? "true" : "false");
          grupo.classList.toggle("aberto", abrir);
          if (abrir) gruposAbertos.add(g.id); else gruposAbertos.delete(g.id);
        } }, icone(g.icone), el("span", { text: g.titulo }), svg("svg", { viewBox: "0 0 24 24", class: "icone seta", "aria-hidden": "true" }, svg("path", { d: ICONES.seta })));
      const grupo = el("div", { class: `grupo ${aberto ? "aberto" : ""}`, "data-grupo": g.id }, titulo, itens);
      return grupo;
    })),
    el("div", { class: "menu-rodape", text: "4blade · gestão para barbearias" }));
  aside.hidden = false;
}
function abrirMenu() {
  menuEl().classList.add("aberto");
  document.getElementById("fundo-menu").hidden = false;
  document.getElementById("btn-menu").setAttribute("aria-expanded", "true");
}
function fecharMenu() {
  menuEl().classList.remove("aberto");
  document.getElementById("fundo-menu").hidden = true;
  document.getElementById("btn-menu").setAttribute("aria-expanded", "false");
}

// ---------- ROTEADOR ----------
const ROTAS = {
  plataforma: { perfis: ["plataforma"], tela: telaPlataforma },
  inicio: { perfis: ["proprietario", "gerente", "barbeiro"], tela: () => (gestao() ? telaPainel() : telaAgenda()) },
  caixa: { perfis: ["caixa", "proprietario", "gerente"], tela: telaCaixa },
  funcionamento: { perfis: ["proprietario", "gerente"], tela: telaFuncionamento },
  estoque: { perfis: ["proprietario", "gerente"], tela: telaEstoque },
  painel: { perfis: ["proprietario", "gerente"], tela: telaPainel },
  comissoes: { perfis: ["proprietario", "gerente"], tela: telaComissoes },
  contas: { perfis: ["proprietario", "gerente"], tela: telaContas },
  contador: { perfis: ["proprietario", "gerente"], tela: telaContador },
  financeiro: { perfis: ["proprietario", "gerente"], tela: telaFinanceiro },
  desempenho: { perfis: ["proprietario", "gerente", "barbeiro"], tela: telaDesempenho },
  "caixa-historico": { perfis: ["proprietario", "gerente"], tela: telaHistoricoCaixa },
  "caixa-dia": { perfis: ["proprietario", "gerente"], tela: data => telaCaixa(/^\d{4}-\d{2}-\d{2}$/.test(data || "") ? data : hojeLocal()) },
  equipe: { perfis: ["proprietario", "gerente"], tela: telaEquipe },
  servicos: { perfis: ["proprietario", "gerente", "barbeiro", "caixa"], tela: telaServicos },
  produtos: { perfis: ["proprietario", "gerente", "barbeiro", "caixa"], tela: telaProdutos },
  clientes: { perfis: ["proprietario", "gerente", "caixa"], tela: () => telaClientes() },
  mensagens: { perfis: ["proprietario", "gerente", "caixa"], tela: telaMensagens },
  agenda: { perfis: ["proprietario", "gerente", "barbeiro", "caixa"], tela: telaAgenda },
  notas: { perfis: ["proprietario", "gerente", "caixa"], tela: telaNotas },
  "pagamento-equipe": { perfis: ["proprietario", "gerente"], tela: telaPagamentoEquipe },
  notificacoes: { perfis: ["proprietario", "gerente", "caixa", "barbeiro"], tela: telaNotificacoes },
  "visao-dia": { perfis: ["proprietario", "gerente", "caixa"], tela: telaVisaoDia },
  assinatura: { perfis: ["proprietario", "gerente"], tela: telaAssinatura },
  duvidas: { perfis: ["plataforma", "proprietario", "gerente", "barbeiro", "caixa"], tela: telaDuvidas },
  tutoriais: { perfis: ["plataforma", "proprietario", "gerente", "barbeiro", "caixa"], tela: telaTutoriais },
  suporte: { perfis: ["proprietario", "gerente"], tela: telaSuporte },
  chamados: { perfis: ["plataforma"], tela: telaChamados },
  pedidos: { perfis: ["plataforma"], tela: telaPedidos },
  termos: { perfis: ["plataforma", "proprietario", "gerente", "barbeiro", "caixa"], tela: () => telaLegal("termos") },
  privacidade: { perfis: ["plataforma", "proprietario", "gerente", "barbeiro", "caixa"], tela: () => telaLegal("privacidade") }
};
// Telas sem login (página de planos, assinar e textos legais).
const ROTAS_PUBLICAS = {
  "": telaInicio,
  inicio: telaInicio,
  planos: telaPlanos,
  "teste-gratis": plano => telaSolicitarTeste(plano),
  duvidas: telaDuvidas,
  assinar: plano => telaAssinar(plano),
  termos: () => telaLegal("termos"),
  privacidade: () => telaLegal("privacidade")
};

async function montarTela(fn, parametro) {
  const vez = ++vezRota;
  document.body.dataset.carregando = "1";   // a tela está sendo montada (usado também pelos testes)
  inicioCarga();
  try {
    await fn(parametro);
  } catch (e) {
    if (e.message !== "Sessão encerrada") mostrar(el("div", { class: "cartao" }, el("p", { class: "erro", text: e.message }), botao("Tentar de novo", rotear)));
  } finally {
    fimCarga();
    if (vez === vezRota) delete document.body.dataset.carregando;
  }
}

async function rotear() {
  if (janela.open) janela.close();
  if (!usuario) {
    const [nomeP, parP] = location.hash.replace(/^#\/?/, "").split("/");
    if (Object.hasOwn(ROTAS_PUBLICAS, nomeP)) { atualizarTopo(); return montarTela(ROTAS_PUBLICAS[nomeP], parP); }
    return telaLogin();
  }
  if (usuario.trocaObrigatoria) return telaTrocarSenha();
  // Mensalidade atrasada além da tolerância: o proprietário só vê a assinatura.
  if (usuario.assinatura?.bloqueada && !/^#\/(assinatura|suporte)/.test(location.hash)) { location.hash = "#/assinatura"; return; }
  atualizarTopo();
  const [nome, parametro] = (location.hash.replace(/^#\/?/, "") || usuario.telaInicial).split("/");
  const rota = ROTAS[nome];
  if (!rota || !rota.perfis.includes(usuario.perfil)) {
    if (nome !== usuario.telaInicial) return irParaInicial();
    return mostrar(el("p", { class: "erro", text: "Tela não disponível para o seu perfil." }));
  }
  if (!["suporte", "duvidas", "tutoriais"].includes(nome)) telaAnterior = nome;
  if (nome !== "notificacoes") buscarNotificacoes().catch(() => {});   // número do sino (no máximo 1 busca por minuto)
  return montarTela(rota.tela, parametro);
}
let telaAnterior = null;   // última tela de trabalho (vai junto no chamado de suporte)
let vezRota = 0;

async function sairDoSistema() {
  if (janela.open) janela.close();
  try { await api("/auth/logout", { metodo: "POST" }); } catch { /* sai mesmo assim */ }
  localStorage.removeItem(CHAVE_TOKEN);
  usuario = null;
  document.getElementById("aviso").hidden = true;   // aviso de quem saiu não aparece para o próximo
  estadoCaixa.aba = "cobrar"; estadoCaixa.carrinho.clear();
  ultimasNotificacoes = { em: 0, itens: [] };
  Object.assign(estadoAgenda, { data: null, visao: "dia", barbeiroId: "" });
  clearTimeout(timerCaixa);
  dataEnvioMensagem = null;
  origemEnvio = "dia";
  estadoMensagens.modelo = null;
  estadoNotas.aba = "abertas";
  history.replaceState(null, "", "/#/entrar");
  telaLogin("Você saiu do sistema.");
}

// "Minha conta": quem está usando, em qual barbearia, e o botão Sair.
function janelaConta() {
  const b = usuario.barbearia;
  return abrirJanela("Minha conta", [
    el("div", { class: "conta-cartao" },
      el("span", { class: "conta-avatar", text: usuario.nome.trim().charAt(0).toUpperCase() }),
      el("div", {},
        el("strong", { text: usuario.nome }),
        el("span", { text: `${NOME_PERFIL[usuario.perfil]} · usuário ${usuario.login}` }),
        b ? el("span", { text: `${b.nome} · Plano ${NOME_PLANO[b.plano] || b.plano}` }) : null)),
    blocoAparencia(),
    el("button", { type: "button", class: "botao perigo largo", id: "btn-sair", text: "Sair do sistema", onclick: sairDoSistema })
  ], { ok: "Fechar", semCancelar: true, aoConfirmar: () => true });
}

// Aparência (paleta de cores + claro/escuro/sistema): muda na hora e fica guardada neste aparelho (public/tema.js).
const NOME_PALETA = { navalha: ["Navalha", "grafite e dourado"], oceano: ["Oceano", "azul"], esmeralda: ["Esmeralda", "verde"], bordo: ["Bordô", "vinho e coral"] };
const NOME_MODO = { claro: "Claro", escuro: "Escuro", sistema: "Do celular" };
function blocoAparencia() {
  const t = window.temaApp;
  if (!t) return null;
  const bloco = el("section", { class: "aparencia", "data-teste": "aparencia" });
  const desenhar = () => {
    const pref = t.ler();
    bloco.replaceChildren(
      el("h4", { text: "Aparência" }),
      el("div", { class: "alterna largo", role: "group", "aria-label": "Tema" }, t.MODOS.map(m =>
        el("button", { type: "button", class: `botao pequeno ${pref.modo === m ? "ativo" : ""}`, "data-modo": m, "aria-pressed": pref.modo === m ? "true" : "false", text: NOME_MODO[m],
          onclick: () => { t.salvar({ modo: m }); desenhar(); } }))),
      el("div", { class: "paletas", role: "group", "aria-label": "Paleta de cores" }, t.PALETAS.map(p =>
        el("button", { type: "button", class: `paleta-opcao ${pref.paleta === p ? "ativa" : ""}`, "data-paleta-opcao": p, "aria-pressed": pref.paleta === p ? "true" : "false",
          onclick: () => { t.salvar({ paleta: p }); desenhar(); } },
          el("span", { class: `amostra amostra-${p}`, "aria-hidden": "true" }, el("span"), el("span")),
          el("strong", { text: NOME_PALETA[p][0] }), el("small", { text: NOME_PALETA[p][1] })))),
      el("p", { class: "suave", text: "Fica guardado neste aparelho." }));
  };
  desenhar();
  return bloco;
}

async function iniciar() {
  const btnConta = document.getElementById("btn-conta");
  btnConta.replaceChildren(icone("usuario"), el("span", { class: "topo-conta-txt", text: "Minha conta" }));
  btnConta.setAttribute("aria-label", "Minha conta");
  btnConta.addEventListener("click", janelaConta);
  const btnNotif = document.getElementById("btn-notif");
  btnNotif.append(icone("sino"), el("span", { class: "sino-num", hidden: true }));
  btnNotif.addEventListener("click", () => { if (location.hash === "#/notificacoes") rotear(); else location.hash = "#/notificacoes"; });
  const btnAjuda = document.getElementById("btn-ajuda");
  btnAjuda.append(icone("ajuda"));
  btnAjuda.addEventListener("click", ajudaDaTela);
  const btnMenu = document.getElementById("btn-menu");
  btnMenu.append(icone("menu"));
  btnMenu.addEventListener("click", () => (menuEl().classList.contains("aberto") ? fecharMenu() : abrirMenu()));
  document.getElementById("fundo-menu").addEventListener("click", fecharMenu);
  document.addEventListener("keydown", e => { if (e.key === "Escape") fecharMenu(); });
  window.addEventListener("hashchange", rotear);
  inicioCarga();   // tela de abertura (logo + frase) até a 1ª tela ficar pronta
  try {
    if (localStorage.getItem(CHAVE_TOKEN)) {
      try {
        usuario = (await api("/auth/me")).usuario;
      } catch { /* api() já levou para o login */ return; }
    }
    await rotear();
  } finally {
    fimCarga();
  }
  if ("serviceWorker" in navigator && location.protocol === "https:") {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  }
}

iniciar();
