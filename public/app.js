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
  app.replaceChildren(...filhos.flat().filter(Boolean));
  app.focus({ preventScroll: true });
  window.scrollTo(0, 0);
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
const NOME_PERFIL = { plataforma: "Plataforma", proprietario: "Proprietário", gerente: "Gerente", barbeiro: "Barbeiro", caixa: "Caixa" };
const NOME_PLANO = { basico: "Básico", profissional: "Profissional" };

// "45", "45,9", "1.234,56", "R$ 45,00" → centavos (inteiro). null se inválido.
function paraCentavos(texto) {
  const t = String(texto || "").replace(/R\$\s?/i, "").trim().replace(/\./g, "").replace(",", ".");
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return null;
  return Math.round(Number(t) * 100);
}
const centavosParaTexto = c => (Number(c) / 100).toFixed(2).replace(".", ",");
// "40" ou "37,5" → centésimos de % (4000, 3750)
function paraBp(texto) {
  const t = String(texto || "0").trim().replace("%", "").replace(",", ".");
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
  if (!resp.ok) {
    const e = new Error(dados.erro || "Algo deu errado. Tente de novo.");
    e.status = resp.status;
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
  if (attrs.inputmode === "tel") mascaraTelefone(controle);
  else if (attrs.inputmode === "decimal" && !/^com/.test(attrs.name || "")) mascaraDinheiro(controle);   // % de comissão fica livre
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
// Dinheiro: ao sair do campo, "40" vira "40,00" e "1234,5" vira "1.234,50".
function mascaraDinheiro(input) {
  input.addEventListener("blur", () => {
    const c = paraCentavos(input.value);
    if (c !== null && input.value.trim()) input.value = (c / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  });
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

function cabecalho(titulo, subtitulo = null, voltar = "#/inicio") {
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
  if (btn) btn.disabled = true;
  try {
    await acao();
  } catch (e) {
    if (e.message !== "Sessão encerrada") erroForm(form, e.message);
  } finally {
    if (btn) btn.disabled = false;
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
function mostrarSenha(login, senha, quem) {
  return abrirJanela("Acesso criado", [
    el("p", { text: `Entregue estes dados para ${quem}. No 1º acesso o sistema pede para trocar a senha.` }),
    el("dl", { class: "credencial" },
      el("dt", { text: "Usuário" }), el("dd", { class: "credencial-valor", "data-teste": "login", text: login }),
      el("dt", { text: "Senha provisória" }), el("dd", { class: "credencial-valor", "data-teste": "senha", text: senha })),
    el("p", { class: "suave", text: "Esta senha não aparece de novo. Anote ou envie agora." })
  ], { ok: "Pronto, anotei", semCancelar: true, aoConfirmar: () => true });
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
    el("p", { class: "suave centro", text: "Esqueceu a senha? Peça ao gerente ou ao proprietário da barbearia." }));
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
  mostrar(el("section", { class: "estreito" },
    el("img", { class: "logo-entrada", src: "/icons/logo.png", alt: "4blade", width: "320", height: "130" }), form));
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

function atualizarTopo() {
  const sub = document.getElementById("topo-sub");
  const acoes = document.getElementById("topo-acoes");
  if (usuario && !usuario.trocaObrigatoria) {
    sub.textContent = usuario.barbearia ? `${usuario.barbearia.nome} · ${usuario.nome}` : `Plataforma · ${usuario.nome}`;
    acoes.hidden = false;
    document.getElementById("btn-inicio").hidden = usuario.perfil === "plataforma";
  } else {
    sub.textContent = "Gestão para barbearias";
    acoes.hidden = true;
  }
}

function irParaInicial() {
  const destino = `#/${usuario.telaInicial}`;
  if (location.hash === destino) rotear();
  else location.hash = destino;
}

// ---------- PLATAFORMA ----------
async function telaPlataforma() {
  const { barbearias } = await api("/plataforma/barbearias");
  const form = el("form", { class: "cartao" },
    el("h3", { text: "Nova barbearia" }),
    campo("Nome da barbearia", { name: "nome", required: true, maxlength: "80" }),
    campo("Plano", { tag: "select", name: "plano", opcoes: [["basico", "Básico"], ["profissional", "Profissional"]] }),
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
      await mostrarSenha(r.proprietario.login, r.senhaProvisoria, `o proprietário (${r.proprietario.nome})`);
      telaPlataforma();
    });
  });

  const lista = barbearias.length
    ? el("ul", { class: "lista" }, barbearias.map(b => el("li", { class: `item ${b.bloqueada ? "inativo" : ""}`, "data-barbearia": b.nome },
      el("div", { class: "item-topo" },
        el("strong", { text: b.nome }),
        el("span", { class: `etiqueta ${b.bloqueada ? "vermelha" : "verde"}`, text: b.bloqueada ? "Bloqueada" : "Ativa" }),
        el("span", { class: "etiqueta", text: `Plano ${NOME_PLANO[b.plano]}${b.barbeirosAdicionais ? ` +${b.barbeirosAdicionais}` : ""}` })),
      el("p", { class: "suave", text: `Proprietário: ${b.proprietario?.nome || "—"} · usuário ${b.proprietario?.login || "—"}${b.proprietario?.trocaPendente ? " · ainda não entrou" : ""}` }),
      b.telefone ? el("p", { class: "suave", text: `Telefone: ${fone(b.telefone)}` }) : null,
      el("p", { class: "suave", text: `Equipe ativa: ${b.usuariosAtivos.gerente} gerente(s), ${b.usuariosAtivos.barbeiro} barbeiro(s), ${b.usuariosAtivos.caixa} caixa(s)` }),
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
        botao("Nova senha do proprietário", () => pedirMotivo(
          "Nova senha do proprietário", "Gera uma senha provisória. A senha antiga para de funcionar.",
          async motivo => {
            const r = await api("/plataforma/barbearias/redefinir-senha", { metodo: "POST", corpo: { id: b.id, motivo } });
            await mostrarSenha(r.login, r.senhaProvisoria, "o proprietário");
          }, "Gerar senha"), "pequeno"))
    )))
    : el("p", { class: "vazio", text: "Nenhuma barbearia ainda. Crie a primeira ao lado." });

  mostrar(
    cabecalho("Painel da plataforma", "Barbearias clientes do 4blade", null),
    el("p", { class: "info", "data-teste": "explicacao-plataforma", text: "Este painel é só para administrar as barbearias (criar, bloquear, plano e senha do dono). Para usar o sistema de uma barbearia (agenda, caixa, equipe…), toque em Sair e entre com o usuário do proprietário. Se ele não tiver a senha, use \"Nova senha do proprietário\"." }),
    el("div", { class: "duas-colunas" },
      el("section", {}, el("h3", { text: `Barbearias (${barbearias.length})` }), lista),
      el("section", {}, form)));
}

function janelaPlano(b) {
  return abrirJanela(`Plano de ${b.nome}`, [
    campo("Plano", { tag: "select", name: "plano", valor: b.plano, opcoes: [["basico", "Básico (1 gerente, 3 barbeiros, 1 caixa)"], ["profissional", "Profissional (2 gerentes, 10 barbeiros, 2 caixas)"]] }),
    campo("Barbeiros adicionais (só Profissional)", { name: "adicionais", type: "number", min: "0", max: "100", value: String(b.barbeirosAdicionais), inputmode: "numeric" }),
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

function telaInicio() {
  const itens = gestao()
    ? [
      ["#/painel", "Painel", "Faturamento, lucro e avisos"],
      ["#/agenda", "Agenda", "Todos os profissionais"],
      ["#/caixa", "Caixa", "Entradas, vendas e fechamento"],
      ["#/equipe", "Equipe", "Usuários, comissões e horários"],
      ["#/servicos", "Serviços", "Preços e duração"],
      ["#/estoque", "Estoque", "Entradas, ajustes e inventário"],
      ["#/produtos", "Produtos", "Cadastro, preço e validade"],
      ["#/clientes", "Clientes", "Cadastro com aceite LGPD"],
      ["#/comissoes", "Comissões e vales", "Fechamento por período"],
      ["#/contas", "Contas a pagar", "Vencimentos e pagamentos"],
      ["#/contador", "Contador e dados", "Relatório e cópia dos dados"],
      ...(usuario.perfil === "gerente" ? [["#/desempenho", "Meu desempenho", "Minha comissão e extrato"]] : []),
      ["#/funcionamento", "Funcionamento", "Dias, horários e datas fechadas"],
      ["#/mensagens", "Mensagens", "Modelos para o WhatsApp"]
    ]
    : [
      ["#/agenda", "Minha agenda", "Marcar, avisar e finalizar"],
      ["#/desempenho", "Meu desempenho", "Comissão, vales e extrato"],
      ["#/servicos", "Serviços", "Preços da barbearia"],
      ["#/produtos", "Produtos", "Preço e disponível"]
    ];
  mostrar(
    cabecalho(`Olá, ${usuario.nome.split(" ")[0]}!`, `${NOME_PERFIL[usuario.perfil]} · Plano ${NOME_PLANO[usuario.barbearia.plano]}`, null),
    el("nav", { class: "menu" }, itens.map(([href, t, s]) => el("a", { class: "menu-item", href },
      el("span", { class: "menu-letra", "aria-hidden": "true", text: t[0] }),
      el("span", { class: "menu-textos" }, el("strong", { text: t }), el("span", { class: "suave", text: s }))))));
}

// ---------- datas e horas ----------
const DIAS = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];
const DIAS_CURTO = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
const diaDaSemana = d => new Date(`${d}T12:00:00Z`).getUTCDay();
const somaDias = (d, n) => { const x = new Date(`${d}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const hojeLocal = () => new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 10);   // America/Sao_Paulo
const dataLonga = d => `${DIAS_CURTO[diaDaSemana(d)]}, ${dataBR(d).slice(0, 5)}`;
// "2026-11-16 15:04:05" (UTC do banco) → "12:04" (Brasília)
const horaLocal = utc => new Date(`${utc.replace(" ", "T")}Z`).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" });
const NOME_FORMA = { dinheiro: "Dinheiro", pix: "Pix", debito: "Débito", credito: "Crédito" };
const NOME_SITUACAO = { agendado: "Agendado", finalizado: "Finalizado", faltou: "Faltou", cancelado: "Cancelado" };
const COR_SITUACAO = { agendado: "", finalizado: "verde", faltou: "amarela", cancelado: "vermelha" };

// ---------- AGENDA ----------
const estadoAgenda = { data: null, dias: 1, barbeiroId: "" };
let servicosCache = null;

async function carregarServicos() {
  servicosCache = (await api("/servicos")).servicos.filter(s => s.ativo);
  return servicosCache;
}

async function telaAgenda() {
  estadoAgenda.data ||= hojeLocal();
  const q = new URLSearchParams({ data: estadoAgenda.data, dias: String(estadoAgenda.dias) });
  if (gestao() && estadoAgenda.barbeiroId) q.set("barbeiroId", estadoAgenda.barbeiroId);
  const [ag] = await Promise.all([api(`/agenda?${q}`), carregarServicos()]);

  const irPara = d => { estadoAgenda.data = d; telaAgenda(); };
  const passo = estadoAgenda.dias === 7 ? 7 : 1;
  const dataInput = el("input", { type: "date", value: estadoAgenda.data, "aria-label": "Data", class: "data-agenda" });
  dataInput.addEventListener("change", () => dataInput.value && irPara(dataInput.value));
  const filtro = gestao()
    ? el("select", { "aria-label": "Profissional", class: "filtro-prof" },
      el("option", { value: "", text: "Todos os profissionais", selected: !estadoAgenda.barbeiroId || null }),
      ag.profissionais.map(p => el("option", { value: p.id, text: p.nome, selected: p.id === estadoAgenda.barbeiroId || null })))
    : null;
  filtro?.addEventListener("change", () => { estadoAgenda.barbeiroId = filtro.value; telaAgenda(); });

  const barra = el("div", { class: "barra-agenda" },
    el("div", { class: "navega-data" },
      botao("‹", () => irPara(somaDias(estadoAgenda.data, -passo)), "pequeno seta"),
      dataInput,
      botao("›", () => irPara(somaDias(estadoAgenda.data, passo)), "pequeno seta"),
      botao("Hoje", () => irPara(hojeLocal()), "pequeno")),
    el("div", { class: "alterna" },
      botao("Dia", () => { estadoAgenda.dias = 1; telaAgenda(); }, `pequeno ${estadoAgenda.dias === 1 ? "ativo" : ""}`),
      botao("Semana", () => { estadoAgenda.dias = 7; telaAgenda(); }, `pequeno ${estadoAgenda.dias === 7 ? "ativo" : ""}`)),
    filtro,
    el("div", { class: "acoes-agenda" },
      botao("+ Novo horário", () => janelaMarcar(ag), "principal pequeno"),
      botao("Bloquear horário", () => janelaBloquear(ag), "pequeno")));

  const profs = ag.profissionais.filter(p => !estadoAgenda.barbeiroId || p.id === estadoAgenda.barbeiroId);
  let corpo;
  if (estadoAgenda.dias === 1) {
    // Dia: um profissional por coluna (gerente vê todos lado a lado).
    corpo = el("div", { class: `agenda-colunas ${profs.length > 1 ? "varias" : ""}` }, profs.map(p => {
      const itens = itensDoDia(ag, estadoAgenda.data, p.id);
      return el("section", { class: "coluna-prof", "data-prof": p.nome },
        el("h3", { text: p.nome }),
        itens.length ? itens : el("p", { class: "vazio", text: "Nenhum horário." }));
    }));
  } else {
    corpo = el("div", { class: "agenda-semana" }, [0, 1, 2, 3, 4, 5, 6].map(i => {
      const d = somaDias(estadoAgenda.data, i);
      const itens = profs.flatMap(p => itensDoDia(ag, d, p.id, profs.length > 1));
      return el("section", { class: "dia-semana" },
        el("h3", { text: `${DIAS[diaDaSemana(d)]} ${dataBR(d).slice(0, 5)}${d === ag.hoje ? " (hoje)" : ""}` }),
        itens.length ? itens : el("p", { class: "suave", text: "Sem horários." }));
    }));
  }

  mostrar(
    cabecalho(gestao() ? "Agenda" : "Minha agenda",
      estadoAgenda.dias === 1 ? `${DIAS[diaDaSemana(estadoAgenda.data)]}, ${dataBR(estadoAgenda.data)}` : `Semana de ${dataBR(ag.data)} a ${dataBR(ag.ate)}`),
    barra,
    !ag.caixaAberto ? el("p", { class: "info", text: "O caixa de hoje ainda não foi aberto: para finalizar atendimentos, peça para abrir o caixa." }) : null,
    corpo);
}

// Horários e bloqueios de um profissional num dia, em ordem.
function itensDoDia(ag, data, profId, mostrarNome = false) {
  const lista = [
    ...ag.agendamentos.filter(a => a.data === data && a.barbeiroId === profId).map(a => ({ ordem: a.inicio, el: cartaoAgendamento(a, mostrarNome) })),
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
      botao("Desbloquear", () => pedirMotivo("Desbloquear horário", "O horário volta a ficar livre na agenda.", async motivo => {
        await api("/agenda/bloqueios/cancelar", { metodo: "POST", corpo: { id: b.id, motivo } });
        avisar("Horário desbloqueado.");
        telaAgenda();
      }, "Desbloquear"), "pequeno")));
}

// Abre o WhatsApp (link wa.me) e registra o envio (quem, quando, qual modelo).
function botaoWhatsapp(a, tipo, rotulo) {
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

function cartaoAgendamento(a, mostrarNome) {
  const f = a.finalizacao;
  const destaque = gestao() && f?.valorAlterado;
  const ultimaMsg = a.mensagens.at(-1);
  return el("article", { class: `slot ${a.situacao} ${destaque ? "destaque" : ""}`, "data-agendamento": a.cliente.nome },
    el("div", { class: "slot-topo" },
      el("strong", { class: "slot-hora", text: `${a.inicio}–${a.fim}` }),
      el("span", { class: `etiqueta ${COR_SITUACAO[a.situacao]}`, text: NOME_SITUACAO[a.situacao] }),
      destaque ? el("span", { class: "etiqueta laranja", text: "Valor alterado" }) : null),
    el("p", { class: "slot-cliente" }, el("strong", { text: a.cliente.nome }), ` · ${fone(a.cliente.telefone)}`),
    el("p", { class: "suave", text: [mostrarNome ? a.barbeiroNome : null, a.servicos.map(s => s.nome).join(" + ")].filter(Boolean).join(" · ") }),
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
    ultimaMsg ? el("p", { class: "suave", text: `${ultimaMsg.tipo === "lembrete" ? "Lembrete" : "Proposta"} aberto no WhatsApp por ${ultimaMsg.por.split(" ")[0]} às ${horaLocal(ultimaMsg.em)}` }) : null,
    el("div", { class: "item-acoes" },
      a.situacao === "agendado" ? [
        botao("Finalizar", () => janelaFinalizar(a), "pequeno principal"),
        botaoWhatsapp(a, "lembrete", "Enviar lembrete"),
        botaoWhatsapp(a, "proposta", "Propor horário"),
        botao("Faltou", () => abrirJanela(`${a.cliente.nome} faltou?`, el("p", { text: "O horário fica registrado como falta." }), {
          ok: "Registrar falta", aoConfirmar: async () => {
            await api("/agenda/situacao", { metodo: "POST", corpo: { id: a.id, situacao: "faltou" } });
            avisar("Falta registrada."); telaAgenda();
          }
        }), "pequeno"),
        botao("Cancelar", () => pedirMotivo(`Cancelar horário de ${a.cliente.nome}`, "O horário fica livre. Nada é apagado.", async motivo => {
          await api("/agenda/situacao", { metodo: "POST", corpo: { id: a.id, situacao: "cancelado", motivo } });
          avisar("Horário cancelado."); telaAgenda();
        }, "Cancelar horário"), "pequeno perigo")
      ] : null,
      a.situacao === "finalizado" || a.situacao === "agendado"
        ? botao("Vender produto", () => janelaVenda({ agendamento: a, aoTerminar: telaAgenda }), "pequeno") : null,
      a.situacao === "finalizado" ? botao("Reabrir", () => pedirMotivo("Reabrir atendimento", "Estorna a entrada no caixa e a comissão, e o horário volta para agendado. Fica registrado.", async motivo => {
        await api("/agenda/reabrir", { metodo: "POST", corpo: { id: a.id, motivo } });
        avisar("Atendimento reaberto."); telaAgenda();
      }, "Reabrir"), "pequeno") : null,
      a.situacao === "cancelado" || a.situacao === "faltou" ? botaoWhatsapp(a, "proposta", "Propor horário") : null));
}

function campoProfissional(ag) {
  if (!gestao()) return null;
  const padrao = estadoAgenda.barbeiroId || (ag.profissionais.some(p => p.id === usuario.id) ? usuario.id : ag.profissionais[0]?.id);
  return campo("Profissional", { tag: "select", name: "prof", valor: padrao, opcoes: ag.profissionais.map(p => [p.id, p.nome]) });
}

function janelaMarcar(ag) {
  const servicos = servicosCache || [];
  const blocoNovo = el("div", { class: "cliente-novo" },
    campo("Nome do cliente", { name: "cliNome", autocomplete: "off" }),
    caixaMarcar("O cliente aceita que o telefone seja usado para o atendimento (LGPD)", { name: "cliLgpd" }));
  blocoNovo.hidden = true;
  const achado = el("p", { class: "cliente-achado", role: "status" });
  const tel = campo("Telefone do cliente (WhatsApp)", { name: "cliTel", inputmode: "tel", autocomplete: "off", placeholder: "(11) 91234-5678", required: true });
  const buscar = async () => {
    const v = tel.querySelector("input").value.replace(/\D/g, "");
    if (v.length < 10) { achado.textContent = ""; blocoNovo.hidden = true; return; }
    try {
      const r = await api(`/agenda/cliente?telefone=${encodeURIComponent(v)}`);
      if (r.cliente) { achado.textContent = `Cliente: ${r.cliente.nome}`; achado.className = "cliente-achado ok"; blocoNovo.hidden = true; }
      else { achado.textContent = "Cliente novo: informe o nome."; achado.className = "cliente-achado novo"; blocoNovo.hidden = false; }
    } catch (e) { achado.textContent = e.message; }
  };
  tel.querySelector("input").addEventListener("change", buscar);
  tel.querySelector("input").addEventListener("input", () => { if (tel.querySelector("input").value.replace(/\D/g, "").length >= 10) buscar(); });

  return abrirJanela("Novo horário", [
    campoProfissional(ag),
    el("div", { class: "lado-a-lado" },
      campo("Data", { name: "data", type: "date", value: estadoAgenda.data, required: true }),
      campo("Hora", { name: "hora", type: "time", step: "300", required: true })),
    el("fieldset", { class: "servicos-escolha" }, el("legend", { text: "Serviços" }),
      servicos.length ? servicos.map(s => caixaMarcar(`${s.nome} · ${reais(s.precoCentavos)} · ${s.duracaoMin} min`, { name: "serv", value: s.id, id: `serv-${s.id}` }))
        : el("p", { class: "suave", text: "Nenhum serviço cadastrado." })),
    tel, achado, blocoNovo,
    campo("Observação (opcional)", { name: "obs", maxlength: "300", autocomplete: "off" })
  ], {
    ok: "Marcar",
    aoConfirmar: async f => {
      const servicoIds = [...f.querySelectorAll("input[name=serv]:checked")].map(i => i.value);
      if (!servicoIds.length) throw new Error("Escolha pelo menos um serviço.");
      await api("/agenda", {
        metodo: "POST",
        corpo: {
          barbeiroId: f.prof?.value, data: f.data.value, hora: f.hora.value, servicoIds,
          observacao: f.obs.value || null,
          cliente: { telefone: f.cliTel.value, nome: f.cliNome.value || undefined, aceiteLgpd: f.cliLgpd.checked }
        }
      });
      estadoAgenda.data = f.data.value;
      avisar("Horário marcado.");
      telaAgenda();
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
function janelaFinalizar(a) {
  const doHorario = new Set(a.servicos.map(s => s.id));
  const lista = [...(servicosCache || [])];
  for (const s of a.servicos) if (!lista.some(x => x.id === s.id)) lista.push({ id: s.id, nome: s.nome, precoCentavos: 0, duracaoMin: s.duracaoMin });
  const totalEl = el("p", { class: "total-final", "data-teste": "total" });
  const linhas = lista.map(s => {
    const chk = el("input", { type: "checkbox", name: "fserv", value: s.id, id: `f-${s.id}`, checked: doHorario.has(s.id) || null });
    const valor = el("input", { type: "text", inputmode: "decimal", name: `valor-${s.id}`, value: centavosParaTexto(s.precoCentavos), "aria-label": `Valor cobrado de ${s.nome}`, "data-tabela": String(s.precoCentavos) });
    const aviso = el("span", { class: "alterado", text: "valor diferente da tabela" });
    const linha = el("div", { class: "linha-servico" },
      el("div", { class: "marcar" }, chk, el("label", { for: `f-${s.id}`, text: `${s.nome} (tabela ${reais(s.precoCentavos)})` })),
      valor, aviso);
    return { s, chk, valor, aviso, linha };
  });
  const forma1 = campo("Forma de pagamento", { tag: "select", name: "forma1", valor: "pix", opcoes: Object.entries(NOME_FORMA) });
  const dividir = caixaMarcar("Dividir em 2 formas", { name: "dividir" });
  const valor1 = campo("Valor na 1ª forma (R$)", { name: "valor1", inputmode: "decimal" });
  const segunda = el("div", { class: "lado-a-lado" },
    campo("2ª forma", { tag: "select", name: "forma2", valor: "dinheiro", opcoes: Object.entries(NOME_FORMA) }),
    el("div", { class: "campo" }, el("label", { text: "Valor na 2ª forma" }), el("p", { class: "valor2", "data-teste": "valor2" })));
  valor1.hidden = true;
  segunda.hidden = true;

  const total = () => linhas.filter(l => l.chk.checked).reduce((t, l) => t + (paraCentavos(l.valor.value) ?? 0), 0);
  const atualizar = () => {
    for (const l of linhas) l.aviso.hidden = !l.chk.checked || paraCentavos(l.valor.value) === Number(l.valor.dataset.tabela);
    totalEl.textContent = `Total: ${reais(total())}`;
    const dividindo = dividir.querySelector("input").checked;
    valor1.hidden = !dividindo;
    segunda.hidden = !dividindo;
    const v1 = paraCentavos(valor1.querySelector("input").value) ?? 0;
    segunda.querySelector(".valor2").textContent = reais(total() - v1);
  };
  const conteudo = [
    el("p", { class: "suave", text: `${a.cliente.nome} · ${a.inicio} · o valor pode ser alterado (fica registrado e aparece para o gerente).` }),
    el("div", { class: "lista-servicos" }, linhas.map(l => l.linha)),
    totalEl, forma1, dividir, valor1, segunda
  ];
  const promessa = abrirJanela("Finalizar atendimento", conteudo, {
    ok: "Confirmar",
    aoConfirmar: async f => {
      const itens = [];
      for (const l of linhas.filter(x => x.chk.checked)) {
        const v = paraCentavos(l.valor.value);
        if (v === null) throw new Error(`Valor de ${l.s.nome} inválido. Exemplo: 40,00`);
        itens.push({ servicoId: l.s.id, precoCobradoCentavos: v });
      }
      if (!itens.length) throw new Error("Marque pelo menos um serviço.");
      const t = itens.reduce((s, i) => s + i.precoCobradoCentavos, 0);
      let pagamentos = t > 0 ? [{ forma: f.forma1.value, valorCentavos: t }] : [];
      if (f.dividir.checked && t > 0) {
        const v1 = paraCentavos(f.valor1.value);
        if (v1 === null || v1 <= 0 || v1 >= t) throw new Error("Valor da 1ª forma inválido: precisa ser maior que zero e menor que o total.");
        pagamentos = [{ forma: f.forma1.value, valorCentavos: v1 }, { forma: f.forma2.value, valorCentavos: t - v1 }];
      }
      await api("/agenda/finalizar", { metodo: "POST", corpo: { id: a.id, itens, pagamentos } });
      avisar("Atendimento finalizado. Entrada lançada no caixa.");
      telaAgenda();
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
        el("div", { class: "item-acoes" }, el("a", { class: "botao pequeno whats", href: a.whatsapp.proposta, target: "_blank", rel: "noopener", text: "Propor horário" })))))
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
function blocoPagamento(totalAtual) {
  const forma1 = campo("Forma de pagamento", { tag: "select", name: "forma1", valor: "pix", opcoes: Object.entries(NOME_FORMA) });
  const dividir = caixaMarcar("Dividir em 2 formas", { name: "dividir" });
  const valor1 = campo("Valor na 1ª forma (R$)", { name: "valor1", inputmode: "decimal" });
  const segunda = el("div", { class: "lado-a-lado" },
    campo("2ª forma", { tag: "select", name: "forma2", valor: "dinheiro", opcoes: Object.entries(NOME_FORMA) }),
    el("div", { class: "campo" }, el("label", { text: "Valor na 2ª forma" }), el("p", { class: "valor2", "data-teste": "valor2" })));
  const atualizar = () => {
    const d = dividir.querySelector("input").checked;
    valor1.hidden = !d;
    segunda.hidden = !d;
    segunda.querySelector(".valor2").textContent = reais(totalAtual() - (paraCentavos(valor1.querySelector("input").value) ?? 0));
  };
  const ler = f => {
    const t = totalAtual();
    if (t <= 0) return [];
    if (!f.dividir.checked) return [{ forma: f.forma1.value, valorCentavos: t }];
    const v1 = paraCentavos(f.valor1.value);
    if (v1 === null || v1 <= 0 || v1 >= t) throw new Error("Valor da 1ª forma inválido: precisa ser maior que zero e menor que o total.");
    return [{ forma: f.forma1.value, valorCentavos: v1 }, { forma: f.forma2.value, valorCentavos: t - v1 }];
  };
  return { elementos: [forma1, dividir, valor1, segunda], atualizar, ler };
}

// ---------- VENDA DE PRODUTO (caixa, gestão ou barbeiro) ----------
async function janelaVenda({ agendamento = null, aoTerminar } = {}) {
  const produtos = (await api("/produtos")).produtos.filter(p => (p.disponivel ?? (p.ativo && p.saldo > 0)));
  if (!produtos.length) { avisar("Nenhum produto com estoque para vender.", "erro"); return; }
  const linhas = produtos.map(p => {
    const qtd = el("input", { type: "number", min: "0", max: String(p.saldo ?? 999), step: "1", value: "0", inputmode: "numeric", name: `q-${p.id}`, "aria-label": `Quantidade de ${p.nome}` });
    return { p, qtd, el: el("div", { class: "linha-servico", "data-venda-produto": p.nome },
      el("span", { text: `${p.nome} · ${reais(p.precoCentavos)}${p.saldo !== undefined ? ` · estoque ${p.saldo}` : ""}` }), qtd) };
  });
  const totalEl = el("p", { class: "total-final", "data-teste": "total-venda" });
  const total = () => linhas.reduce((t, l) => t + (Math.max(0, parseInt(l.qtd.value, 10) || 0) * l.p.precoCentavos), 0);
  const pag = blocoPagamento(total);
  const atualizar = () => { totalEl.textContent = `Total: ${reais(total())}`; pag.atualizar(); };
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
  estorno_venda: "Estorno (venda cancelada)", sangria: "Sangria", suprimento: "Suprimento"
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
    l.vendaCancelada && l.tipo === "venda" ? el("p", { class: "suave", text: "Venda cancelada" }) : null,
    l.podeCorrigir || l.podeCancelarVenda ? el("div", { class: "item-acoes" },
      l.podeCorrigir ? botao("Corrigir forma", () => abrirJanela("Corrigir forma de pagamento", [
        el("p", { text: `${reais(l.valorCentavos)} está em ${NOME_FORMA[l.formaAtual]}. Qual a forma certa?` }),
        campo("Forma certa", { tag: "select", name: "nova", opcoes: Object.entries(NOME_FORMA).filter(([f]) => f !== l.formaAtual) }),
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

function resumoTotais(c) {
  const t = c.totais;
  return [
    el("div", { class: "resumo-caixa" },
      el("div", { class: "vaga" }, el("strong", { text: reais(c.caixa.trocoCentavos) }), el("span", { text: "Troco inicial" })),
      el("div", { class: "vaga" }, el("strong", { "data-teste": "entradas", text: reais(t.entradasCentavos) }), el("span", { text: "Entradas (bruto)" })),
      el("div", { class: "vaga" }, el("strong", { "data-teste": "esperado", text: reais(t.dinheiroEsperadoCentavos) }), el("span", { text: "Dinheiro na gaveta" }))),
    el("div", { class: "formas" },
      Object.entries(t.porForma).map(([f, v]) => el("span", { class: "etiqueta", text: `${NOME_FORMA[f]}: ${reais(v)}` })),
      el("span", { class: "etiqueta", text: `Atendimentos: ${reais(t.atendimentosCentavos)}` }),
      el("span", { class: "etiqueta", text: `Vendas: ${reais(t.vendasCentavos)}` }),
      t.sangriasCentavos ? el("span", { class: "etiqueta vermelha", text: `Sangrias: ${reais(t.sangriasCentavos)}` }) : null,
      t.suprimentosCentavos ? el("span", { class: "etiqueta verde", text: `Suprimentos: ${reais(t.suprimentosCentavos)}` }) : null)
  ];
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

async function telaCaixa(dataHistorico = null) {
  clearTimeout(timerCaixa);
  const c = dataHistorico ? await api(`/caixa/dia?data=${dataHistorico}`) : await api("/caixa/hoje");
  const recarregar = () => telaCaixa(dataHistorico);
  const voltar = dataHistorico ? "#/caixa-historico" : gestao() ? "#/inicio" : null;
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

  const aberto = c.caixa.situacao === "aberto";
  const ehHoje = !dataHistorico || dataHistorico === hojeLocal();
  mostrar(
    cabecalho(dataHistorico ? `Caixa de ${dataBR(dataHistorico)}` : "Caixa", `${dataBR(c.data)} · aberto por ${c.caixa.abertoPor}`, voltar),
    el("div", { "data-tela": "caixa" }, resumoTotais(c)),
    aberto
      ? el("div", { class: "acoes-caixa" },
        ehHoje ? botao("Vender produto", () => janelaVenda({ aoTerminar: recarregar }), "principal pequeno") : null,
        ehHoje ? botao("Sangria", () => janelaMovimento("sangria", recarregar), "pequeno") : null,
        ehHoje ? botao("Suprimento", () => janelaMovimento("suprimento", recarregar), "pequeno") : null,
        botao("Fechar caixa", () => janelaFechar(c, recarregar, dataHistorico), "pequeno perigo"))
      : el("div", {}, blocoFechamento(c),
        gestao() ? botao("Reabrir caixa", () => pedirMotivo("Reabrir o caixa", "Permite corrigir lançamentos deste dia. Depois, feche de novo.", async motivo => {
          await api("/caixa/reabrir", { metodo: "POST", corpo: { data: c.data, motivo } });
          avisar("Caixa reaberto."); recarregar();
        }, "Reabrir"), "pequeno") : null),
    c.reaberturas?.length ? el("p", { class: "suave", text: `Reaberto ${c.reaberturas.length}x (último motivo: ${c.reaberturas[0].motivo})` }) : null,
    el("h3", { text: "Lançamentos do dia" }),
    listaCaixa(c, recarregar),
    el("div", { class: "acoes-caixa" }, botao("Atualizar", recarregar, "pequeno"), linkHistorico));
  if (aberto && !dataHistorico) {
    timerCaixa = setTimeout(() => { if (location.hash === "#/caixa" && !janela.open) telaCaixa().catch(() => {}); }, 20000);
  }
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
  const avisos = ativos.filter(p => p.avisos.length);
  mostrar(
    cabecalho("Estoque", "Entradas recalculam o custo médio. Vendas baixam sozinhas; cancelamentos devolvem."),
    avisos.length ? el("p", { class: "info", "data-teste": "avisos-estoque", text: `Atenção: ${avisos.map(p => `${p.nome} (${p.avisos.map(a => NOME_AVISO[a][0].toLowerCase()).join(", ")})`).join(" · ")}` }) : null,
    el("div", { class: "acoes-caixa" }, botao("Inventário (contagem)", () => janelaInventario(ativos), "pequeno")),
    ativos.length
      ? el("ul", { class: "lista" }, ativos.map(p => el("li", { class: "item", "data-estoque": p.nome },
        el("div", { class: "item-topo" },
          el("strong", { text: p.nome }),
          el("span", { class: "saldo", "data-teste": "saldo", text: `${p.saldo} un.` }),
          p.avisos.map(a => el("span", { class: `etiqueta ${NOME_AVISO[a][1]}`, text: NOME_AVISO[a][0] }))),
        el("p", { class: "suave", text: [
          `Mínimo ${p.estoqueMinimo}`, `Preço ${reais(p.precoCentavos)}`,
          `Custo médio ${p.custoMedioCentavos ? reais(p.custoMedioCentavos) : "—"}`,
          p.margemBp === null ? null : `Margem ${pct(p.margemBp)}`,
          p.validade ? `Validade ${dataBR(p.validade)}` : null
        ].filter(Boolean).join(" · ") }),
        el("div", { class: "item-acoes" },
          botao("Entrada", () => janelaEntrada(p), "pequeno principal"),
          botao("Ajuste", () => janelaAjuste(p, motivosAjuste), "pequeno"),
          botao("Histórico", () => janelaHistorico(p), "pequeno")))))
      : el("p", { class: "vazio", text: "Nenhum produto cadastrado. Cadastre em Produtos." }));
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

function janelaAjuste(p, motivos) {
  return abrirJanela(`Ajuste de ${p.nome}`, [
    el("p", { class: "suave", text: `Estoque atual: ${p.saldo}. Perda, vencimento, quebra e uso interno são saídas.` }),
    campo("Motivo", { tag: "select", name: "motivoAj", opcoes: Object.entries(motivos) }),
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
    ...av.produtosVencendo.map(n => ["amarela", `Produto vencendo: ${n}`])
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
      el("section", { class: "cartao" }, el("h3", { text: `Faturamento por dia (R$, ${p.faturamentoPorDia.length} dias)` }), graficoBarras(p.faturamentoPorDia)),
      el("section", { class: "cartao" }, el("h3", { text: "Ranking (atendimentos no período)" }),
        p.ranking.length ? graficoRanking(p.ranking) : el("p", { class: "suave", text: "Sem atendimentos." }))));
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

// ---------- COMISSÕES E VALES (gestão) ----------
const estadoComissao = { ini: null, fim: null };
async function telaComissoes() {
  const ontem = somaDias(hojeLocal(), -1);
  estadoComissao.fim ||= ontem;
  estadoComissao.ini ||= somaDias(estadoComissao.fim, -6);
  const q = `dataIni=${estadoComissao.ini}&dataFim=${estadoComissao.fim}`;
  const [prev, fech, vales, ag] = await Promise.all([
    api(`/comissoes/previa?${q}`), api("/comissoes/fechamentos"),
    api(`/vales?dataIni=${somaDias(hojeLocal(), -60)}&dataFim=${hojeLocal()}`), api(`/agenda?data=${hojeLocal()}`)
  ]);
  const formPeriodo = el("form", { class: "cartao" },
    el("h3", { text: "Fechar comissão" }),
    el("div", { class: "lado-a-lado" },
      campo("De", { name: "ini", type: "date", value: estadoComissao.ini, required: true }),
      campo("Até", { name: "fim", type: "date", value: estadoComissao.fim, required: true })),
    el("div", { class: "lado-a-lado" },
      botao("Semana passada", () => { estadoComissao.fim = ontem; estadoComissao.ini = somaDias(ontem, -6); telaComissoes(); }, "pequeno"),
      el("button", { type: "submit", class: "botao pequeno", text: "Ver período" })),
    prev.barbeiros.length
      ? el("table", { class: "tabela" },
        el("thead", {}, el("tr", {}, ["Profissional", "Comissões", "Vales", "A pagar"].map(t => el("th", { text: t })))),
        el("tbody", {}, prev.barbeiros.map(b => el("tr", { "data-previa": b.nome },
          el("td", { text: b.nome }), el("td", { text: reais(b.comissaoCentavos) }), el("td", { text: `− ${reais(b.valesCentavos)}` }),
          el("td", { class: "forte", text: b.jaFechadoNoPeriodo ? "já fechado" : reais(b.aPagarCentavos) })))))
      : el("p", { class: "suave", text: "Nada para fechar nesse período." }),
    prev.barbeiros.some(b => !b.jaFechadoNoPeriodo)
      ? botao("Fechar comissão do período", () => abrirJanela("Fechar comissão", el("p", { text: `Fecha ${dataBR(estadoComissao.ini)} a ${dataBR(estadoComissao.fim)}. Depois de fechado, os atendimentos, vendas e vales do período não podem mais ser alterados.` }), {
        ok: "Fechar", perigo: true,
        aoConfirmar: async () => {
          await api("/comissoes/fechar", { metodo: "POST", corpo: { dataIni: estadoComissao.ini, dataFim: estadoComissao.fim } });
          avisar("Comissão fechada."); telaComissoes();
        }
      }), "principal") : null);
  formPeriodo.addEventListener("submit", ev => { ev.preventDefault(); estadoComissao.ini = formPeriodo.ini.value; estadoComissao.fim = formPeriodo.fim.value; telaComissoes(); });

  const listaFech = fech.fechamentos.length
    ? el("ul", { class: "lista" }, fech.fechamentos.map(f => el("li", { class: "item", "data-fechamento": f.barbeiro },
      el("div", { class: "item-topo" }, el("strong", { text: f.barbeiro }), el("span", { class: "preco", text: reais(f.aPagarCentavos) }),
        el("span", { class: `etiqueta ${f.pagoEm ? "verde" : "amarela"}`, text: f.pagoEm ? `Pago ${dataBR(f.pagoEm)}` : "A pagar" })),
      el("p", { class: "suave", text: `${dataBR(f.dataIni)} a ${dataBR(f.dataFim)} · serviços ${reais(f.comissaoServicoCentavos)} + produtos ${reais(f.comissaoProdutoCentavos)} − vales ${reais(f.valesCentavos)}` }),
      f.pagoEm ? null : el("div", { class: "item-acoes" }, botao("Registrar pagamento", () => abrirJanela(`Pagar ${f.barbeiro}`, [
        el("p", { text: `Valor: ${reais(f.aPagarCentavos)}` }),
        caixaMarcar("Pago com dinheiro do caixa (vira sangria do caixa de hoje)", { name: "comCaixa" })
      ], {
        ok: "Registrar",
        aoConfirmar: async form => {
          await api("/comissoes/fechamentos/pagar", { metodo: "POST", corpo: { id: f.id, comCaixa: form.comCaixa.checked } });
          avisar("Pagamento registrado."); telaComissoes();
        }
      }), "pequeno")))))
    : el("p", { class: "suave", text: "Nenhum fechamento ainda." });

  const formVale = el("form", { class: "cartao" },
    el("h3", { text: "Lançar vale (adiantamento)" }),
    campo("Profissional", { tag: "select", name: "barb", opcoes: ag.profissionais.map(p => [p.id, p.nome]) }),
    el("div", { class: "lado-a-lado" },
      campo("Valor (R$)", { name: "valor", inputmode: "decimal", required: true }),
      campo("Data", { name: "dataVale", type: "date", value: hojeLocal(), required: true })),
    campo("Descrição (opcional)", { name: "desc", maxlength: "120" }),
    el("button", { type: "submit", class: "botao principal", text: "Lançar vale" }));
  formVale.addEventListener("submit", ev => {
    ev.preventDefault();
    enviar(formVale, async () => {
      const v = paraCentavos(formVale.valor.value);
      if (!v) throw new Error("Valor inválido. Exemplo: 50,00");
      await api("/vales", { metodo: "POST", corpo: { barbeiroId: formVale.barb.value, valorCentavos: v, data: formVale.dataVale.value, descricao: formVale.desc.value || null } });
      avisar("Vale lançado."); telaComissoes();
    });
  });
  const listaVales = vales.vales.length
    ? el("ul", { class: "lista" }, vales.vales.map(v => el("li", { class: `item ${v.situacao === "cancelado" ? "inativo" : ""}`, "data-vale": v.barbeiro },
      el("div", { class: "item-topo" }, el("strong", { text: `${dataBR(v.data)} · ${v.barbeiro}` }), el("span", { class: "preco", text: reais(v.valorCentavos) }),
        v.situacao === "cancelado" ? el("span", { class: "etiqueta vermelha", text: "Cancelado" }) : v.fechado ? el("span", { class: "etiqueta", text: "Fechado" }) : null),
      v.descricao || v.motivoCancelamento ? el("p", { class: "suave", text: [v.descricao, v.motivoCancelamento ? `Motivo: ${v.motivoCancelamento}` : null].filter(Boolean).join(" · ") }) : null,
      v.situacao === "ativo" && !v.fechado ? el("div", { class: "item-acoes" }, botao("Cancelar", () => pedirMotivo("Cancelar vale", "Nada é apagado; fica registrado.", async motivo => {
        await api("/vales/cancelar", { metodo: "POST", corpo: { id: v.id, motivo } });
        avisar("Vale cancelado."); telaComissoes();
      }, "Cancelar vale"), "pequeno perigo")) : null)))
    : el("p", { class: "suave", text: "Nenhum vale nos últimos 60 dias." });

  mostrar(cabecalho("Comissões e vales", "Comissão = valor bruto × % de cada profissional (serviços e produtos). A pagar = comissões − vales."),
    el("div", { class: "duas-colunas" },
      el("section", {}, formPeriodo, el("h3", { text: "Fechamentos" }), listaFech),
      el("section", {}, formVale, el("h3", { text: "Vales recentes" }), listaVales)));
}

// ---------- CONTAS A PAGAR ----------
const NOME_CATEGORIA = { aluguel: "Aluguel", luz: "Luz", agua: "Água", fornecedor: "Fornecedor", outros: "Outros" };
const STATUS_CONTA = { atrasada: ["Atrasada", "vermelha"], hoje: ["Vence hoje", "amarela"], proxima: ["Próximos 7 dias", ""], futura: ["Em aberto", ""], paga: ["Paga", "verde"], cancelada: ["Cancelada", "vermelha"] };
async function telaContas() {
  const { contas } = await api("/contas");
  const form = el("form", { class: "cartao" },
    el("h3", { text: "Nova conta" }),
    campo("Descrição", { name: "desc", required: true, maxlength: "100" }),
    el("div", { class: "lado-a-lado" },
      campo("Categoria", { tag: "select", name: "cat", opcoes: Object.entries(NOME_CATEGORIA) }),
      campo("Valor (R$)", { name: "valor", inputmode: "decimal", required: true })),
    campo("Vencimento", { name: "venc", type: "date", required: true, value: hojeLocal() }),
    caixaMarcar("Recorrente (todo mês)", { name: "rec" }),
    el("button", { type: "submit", class: "botao principal", text: "Salvar conta" }));
  form.addEventListener("submit", ev => {
    ev.preventDefault();
    enviar(form, async () => {
      const v = paraCentavos(form.valor.value);
      if (!v) throw new Error("Valor inválido. Exemplo: 1500,00");
      await api("/contas", { metodo: "POST", corpo: { descricao: form.desc.value, categoria: form.cat.value, valorCentavos: v, vencimento: form.venc.value, recorrente: form.rec.checked } });
      avisar("Conta cadastrada."); telaContas();
    });
  });
  const lista = contas.length
    ? el("ul", { class: "lista" }, contas.map(c => el("li", { class: `item conta-${c.status}`, "data-conta": c.descricao },
      el("div", { class: "item-topo" }, el("strong", { text: c.descricao }), el("span", { class: "preco", text: reais(c.valorCentavos) }),
        el("span", { class: `etiqueta ${STATUS_CONTA[c.status][1]}`, text: STATUS_CONTA[c.status][0] })),
      el("p", { class: "suave", text: [NOME_CATEGORIA[c.categoria], `vence ${dataBR(c.vencimento)}`, c.recorrente ? "mensal" : null,
        c.pagoEm ? `paga em ${dataBR(c.pagoEm)}${c.pagoComCaixa ? " com dinheiro do caixa" : ""}` : null, c.motivoCancelamento].filter(Boolean).join(" · ") }),
      c.situacao === "aberta" ? el("div", { class: "item-acoes" },
        botao("Pagar", () => abrirJanela(`Pagar ${c.descricao}`, [
          el("p", { text: `${reais(c.valorCentavos)} · pagamento com data de hoje.${c.recorrente ? " A do mês seguinte já fica cadastrada." : ""}` }),
          caixaMarcar("Pago com dinheiro do caixa (vira sangria do caixa de hoje)", { name: "comCaixa" })
        ], {
          ok: "Confirmar pagamento",
          aoConfirmar: async f => {
            const r = await api("/contas/pagar", { metodo: "POST", corpo: { id: c.id, comCaixa: f.comCaixa.checked } });
            avisar(r.mensagem); telaContas();
          }
        }), "pequeno principal"),
        botao("Cancelar", () => pedirMotivo("Cancelar conta", "Nada é apagado; fica registrado.", async motivo => {
          await api("/contas/cancelar", { metodo: "POST", corpo: { id: c.id, motivo } });
          avisar("Conta cancelada."); telaContas();
        }, "Cancelar conta"), "pequeno perigo")) : null)))
    : el("p", { class: "vazio", text: "Nenhuma conta em aberto." });
  mostrar(cabecalho("Contas a pagar", "Atrasadas em vermelho, vencendo hoje em amarelo. Mostra as em aberto e as pagas nos últimos 30 dias."),
    el("div", { class: "duas-colunas" }, el("section", {}, lista), el("section", {}, form)));
}

// ---------- ENVIAR AO CONTADOR + CÓPIA DOS DADOS ----------
const NOME_PLANILHA = {
  clientes: "Clientes", atendimentos: "Atendimentos", caixa: "Caixa", estoque: "Estoque (saldo)",
  "estoque-movimentos": "Estoque (movimentos)", contas: "Contas a pagar", comissoes: "Comissões e vales"
};
async function telaContador() {
  const [{ contador }, { envios }] = await Promise.all([api("/configuracoes/contador"), api("/contador/envios")]);
  const formContato = el("form", { class: "cartao" },
    el("h3", { text: "Contato do contador" }),
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

  const copia = el("section", { class: "cartao" },
    el("h3", { text: "Cópia dos dados" }),
    el("p", { class: "suave", text: "Baixe todos os dados da barbearia em planilhas (abrem no Excel), quando quiser." }),
    el("div", { class: "botoes-planilha" }, Object.entries(NOME_PLANILHA).map(([k, nome]) =>
      botao(nome, async () => {
        try { await baixarPlanilha(`/exportar/${k}`, `4blade-${k}-${hojeLocal()}.csv`); } catch (e) { avisar(e.message, "erro"); }
      }, "pequeno"))));

  mostrar(cabecalho("Contador e cópia dos dados"),
    el("div", { class: "duas-colunas" },
      el("section", {}, formEnviar, el("h3", { text: "Envios registrados" }), listaEnvios),
      el("section", {}, formContato, copia)));
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
      tel ? el("a", { class: "botao pequeno whats", href: `https://wa.me/55${tel}?text=${encodeURIComponent(`Olá${r.contador.nome ? `, ${r.contador.nome.split(" ")[0]}` : ""}! Segue o relatório da ${usuario.barbearia.nome} de ${rel.periodo.titulo} (PDF e planilha).`)}`, target: "_blank", rel: "noopener", text: "Abrir WhatsApp do contador" }) : null)
  ], { ok: "Fechar", semCancelar: true, aoConfirmar: () => true });
}

// ---------- EQUIPE ----------
async function telaEquipe() {
  const { usuarios, vagas } = await api("/usuarios");
  const perfisQuePossoCriar = usuario.perfil === "proprietario" ? ["gerente", "barbeiro", "caixa"] : ["barbeiro", "caixa"];

  const vagasEl = el("div", { class: "vagas" }, Object.entries(vagas).map(([p, v]) =>
    el("div", { class: `vaga ${v.ativos >= v.limite ? "cheia" : ""}` },
      el("strong", { text: `${v.ativos}/${v.limite}` }), el("span", { text: `${NOME_PERFIL[p]}${v.limite > 1 ? "s" : ""}` }))));

  const lista = el("ul", { class: "lista" }, usuarios.map(u => el("li", { class: `item ${u.ativo ? "" : "inativo"}`, "data-usuario": u.login },
    el("div", { class: "item-topo" },
      el("strong", { text: u.nome }),
      el("span", { class: "etiqueta", text: NOME_PERFIL[u.perfil] }),
      u.ativo ? null : el("span", { class: "etiqueta vermelha", text: "Desativado" }),
      u.ativo && u.trocaPendente ? el("span", { class: "etiqueta amarela", text: "Ainda não entrou" }) : null),
    el("p", { class: "suave", text: [`Usuário: ${u.login}`, u.telefone ? fone(u.telefone) : null].filter(Boolean).join(" · ") }),
    u.perfil === "gerente" || u.perfil === "barbeiro"
      ? el("p", { class: "suave", text: `Comissão: ${pct(u.comissaoServicoBp)} em serviços · ${pct(u.comissaoProdutoBp)} em produtos` }) : null,
    !u.ativo && u.motivoDesativacao ? el("p", { class: "suave", text: `Motivo: ${u.motivoDesativacao}` }) : null,
    !u.podeGerenciar && u.id === usuario.id && u.perfil === "gerente"
      ? el("div", { class: "item-acoes" }, botao("Meu horário", () => janelaHorario(u), "pequeno")) : null,
    u.podeGerenciar ? el("div", { class: "item-acoes" },
      botao("Editar", () => janelaUsuario(u), "pequeno"),
      (u.perfil === "gerente" || u.perfil === "barbeiro") && u.ativo ? botao("Horário", () => janelaHorario(u), "pequeno") : null,
      u.ativo ? botao("Nova senha", () => pedirMotivo(`Nova senha para ${u.nome}`, "Gera uma senha provisória. A senha antiga para de funcionar.", async motivo => {
        const r = await api("/usuarios/redefinir-senha", { metodo: "POST", corpo: { id: u.id, motivo } });
        await mostrarSenha(r.login, r.senhaProvisoria, u.nome);
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
      await mostrarSenha(r.usuario.login, r.senhaProvisoria, r.usuario.nome);
      telaEquipe();
    });
  });
  return form;
}

function janelaUsuario(u) {
  const atendeAgenda = u.perfil === "gerente" || u.perfil === "barbeiro";
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
  const lista = servicos.length
    ? el("ul", { class: "lista" }, servicos.map(s => el("li", { class: `item ${s.ativo ? "" : "inativo"}`, "data-servico": s.nome },
      el("div", { class: "item-topo" }, el("strong", { text: s.nome }), el("span", { class: "preco", text: reais(s.precoCentavos) }),
        s.ativo ? null : el("span", { class: "etiqueta vermelha", text: "Desativado" })),
      el("p", { class: "suave", text: `${s.duracaoMin} min${!s.ativo && s.motivoDesativacao ? ` · Motivo: ${s.motivoDesativacao}` : ""}` }),
      linhaAcoesCadastro("servicos", s, telaServicos, () => editarEmJanela(`Editar ${s.nome}`, def, s)))))
    : el("p", { class: "vazio", text: "Nenhum serviço ainda. Cadastre o primeiro." });
  mostrar(cabecalho("Serviços", "O preço de tabela pode ser alterado na hora de finalizar o atendimento (fica registrado)."),
    el("div", { class: "duas-colunas" }, el("section", {}, lista), el("section", {}, formCadastro(def))));
}

// PRODUTOS
async function telaProdutos() {
  const { produtos } = await api("/produtos");
  if (!gestao()) {
    mostrar(cabecalho("Produtos", "Preços para consulta", usuario.perfil === "caixa" ? "#/caixa" : "#/inicio"),
      produtos.length
        ? el("ul", { class: "lista" }, produtos.map(p => el("li", { class: "item", "data-produto": p.nome },
          el("div", { class: "item-topo" }, el("strong", { text: p.nome }), el("span", { class: "preco", text: reais(p.precoCentavos) }),
            el("span", { class: `etiqueta ${p.disponivel ? "verde" : "vermelha"}`, text: p.disponivel ? "Disponível" : "Indisponível" })))))
        : el("p", { class: "vazio", text: "Nenhum produto cadastrado ainda." }));
    return;
  }
  const profissional = usuario.barbearia.plano === "profissional";
  const def = {
    titulo: "Novo produto",
    rota: "produtos",
    aoSalvar: telaProdutos,
    campos: p => [
      campo("Nome do produto", { name: "nome", required: true, value: p?.nome, maxlength: "80" }),
      el("div", { class: "lado-a-lado" },
        campo("Preço de venda (R$)", { name: "preco", required: true, inputmode: "decimal", value: p ? centavosParaTexto(p.precoCentavos) : "", placeholder: "45,00" }),
        campo("Estoque mínimo", { name: "minimo", type: "number", min: "0", inputmode: "numeric", value: p ? String(p.estoqueMinimo) : "0" })),
      campo("Código (opcional)", { name: "codigo", value: p?.codigo || "", inputmode: "numeric", autocomplete: "off" }, "Pode ser o código de barras."),
      campo("Validade (opcional)", { name: "validade", type: "date", value: p?.validade || "" }),
      caixaMarcar(profissional ? "Mostrar no site" : "Mostrar no site (Plano Profissional)", { name: "site", checked: p?.mostrarSite || null })
    ],
    montarCorpo: f => {
      const preco = paraCentavos(f.preco.value);
      if (preco === null) throw new Error("Preço inválido. Exemplo: 45,00");
      return {
        nome: f.nome.value, precoCentavos: preco, estoqueMinimo: Number(f.minimo.value || 0),
        codigo: f.codigo.value.trim() || null, validade: f.validade.value || null, mostrarSite: f.site.checked
      };
    }
  };
  const lista = produtos.length
    ? el("ul", { class: "lista" }, produtos.map(p => el("li", { class: `item ${p.ativo ? "" : "inativo"}`, "data-produto": p.nome },
      el("div", { class: "item-topo" }, el("strong", { text: p.nome }), el("span", { class: "preco", text: reais(p.precoCentavos) }),
        p.ativo ? null : el("span", { class: "etiqueta vermelha", text: "Desativado" }),
        p.mostrarSite ? el("span", { class: "etiqueta", text: "No site" }) : null),
      el("p", { class: "suave", "data-teste": "custo", text: `Custo médio: ${p.custoMedioCentavos ? reais(p.custoMedioCentavos) : "—"} · Margem: ${p.margemBp === null ? "— (sem entrada de mercadoria)" : pct(p.margemBp)}` }),
      el("p", { class: "suave", text: [p.codigo ? `Código ${p.codigo}` : null, `Mínimo ${p.estoqueMinimo}`, p.validade ? `Validade ${dataBR(p.validade)}` : null].filter(Boolean).join(" · ") }),
      linhaAcoesCadastro("produtos", p, telaProdutos, () => editarEmJanela(`Editar ${p.nome}`, def, p)))))
    : el("p", { class: "vazio", text: "Nenhum produto ainda. Cadastre o primeiro." });
  mostrar(cabecalho("Produtos", "O custo vem da entrada de mercadoria (próximas entregas). Margem = (preço − custo) ÷ preço."),
    el("div", { class: "duas-colunas" }, el("section", {}, lista), el("section", {}, formCadastro(def))));
}

// CLIENTES
async function telaClientes(busca = "") {
  const { clientes } = await api(`/clientes${busca ? `?busca=${encodeURIComponent(busca)}` : ""}`);
  const def = {
    titulo: "Novo cliente",
    rota: "clientes",
    aoSalvar: () => telaClientes(),
    campos: c => [
      campo("Nome", { name: "nome", required: true, value: c?.nome, autocomplete: "off" }),
      campo("Telefone (WhatsApp)", { name: "telefone", required: true, inputmode: "tel", value: c ? fone(c.telefone) : "", placeholder: "(11) 91234-5678", autocomplete: "off" }),
      campo("Observação (opcional)", { tag: "textarea", name: "obs", rows: "2", maxlength: "500", value: c?.observacao || "" }),
      caixaMarcar("O cliente aceita que o telefone seja usado para o atendimento (LGPD)", { name: "lgpd", checked: c?.aceiteLgpd || null })
    ],
    montarCorpo: f => ({ nome: f.nome.value, telefone: f.telefone.value, observacao: f.obs.value || null, aceiteLgpd: f.lgpd.checked })
  };
  const buscaForm = el("form", { class: "busca", role: "search" },
    el("input", { type: "search", name: "q", value: busca, placeholder: "Buscar por nome ou telefone", "aria-label": "Buscar cliente" }),
    el("button", { type: "submit", class: "botao pequeno", text: "Buscar" }));
  buscaForm.addEventListener("submit", ev => { ev.preventDefault(); telaClientes(buscaForm.q.value.trim()); });
  const lista = clientes.length
    ? el("ul", { class: "lista" }, clientes.map(c => el("li", { class: `item ${c.ativo ? "" : "inativo"}`, "data-cliente": c.nome },
      el("div", { class: "item-topo" }, el("strong", { text: c.nome }),
        c.ativo ? null : el("span", { class: "etiqueta vermelha", text: "Desativado" }),
        c.aceiteLgpd ? el("span", { class: "etiqueta verde", text: "LGPD ok" }) : el("span", { class: "etiqueta amarela", text: "Sem aceite" })),
      el("p", { class: "suave", text: fone(c.telefone) }),
      c.observacao ? el("p", { class: "suave", text: c.observacao }) : null,
      linhaAcoesCadastro("clientes", c, () => telaClientes(busca), () => editarEmJanela(`Editar ${c.nome}`, def, c)))))
    : el("p", { class: "vazio", text: busca ? "Nenhum cliente encontrado." : "Nenhum cliente ainda." });
  mostrar(cabecalho("Clientes", "Na agenda (próxima entrega) o cliente também é cadastrado pelo telefone, na hora de marcar."),
    el("div", { class: "duas-colunas" }, el("section", {}, buscaForm, lista), el("section", {}, formCadastro(def))));
}

// MODELOS DE MENSAGEM
async function telaMensagens() {
  const { modelos, campos } = await api("/modelos-mensagem");
  const NOMES = { lembrete: "Lembrete", proposta: "Proposta de horário" };
  const blocos = modelos.map(m => {
    const form = el("form", { class: "cartao", "data-modelo": m.tipo },
      el("h3", { text: NOMES[m.tipo] }),
      campo("Texto da mensagem", { tag: "textarea", name: "texto", rows: "5", maxlength: "1000", id: `texto-${m.tipo}` }),
      el("div", { class: "chips" }, campos.map(c => el("button", {
        type: "button", class: "chip", text: `{${c}}`,
        onclick: () => {
          const t = form.texto;
          const pos = t.selectionStart ?? t.value.length;
          t.value = `${t.value.slice(0, pos)}{${c}}${t.value.slice(t.selectionEnd ?? pos)}`;
          t.focus();
        }
      }))),
      el("div", { class: "lado-a-lado" },
        el("button", { type: "submit", class: "botao principal", text: "Salvar" }),
        el("button", {
          type: "button", class: "botao", text: "Voltar ao padrão",
          onclick: () => enviar(form, async () => {
            await api("/modelos-mensagem/alterar", { metodo: "POST", corpo: { tipo: m.tipo, restaurarPadrao: true } });
            avisar("Texto padrão restaurado.");
            telaMensagens();
          })
        })));
    form.texto.value = m.texto;
    form.addEventListener("submit", ev => {
      ev.preventDefault();
      enviar(form, async () => {
        await api("/modelos-mensagem/alterar", { metodo: "POST", corpo: { tipo: m.tipo, texto: form.texto.value } });
        avisar("Modelo salvo.");
      });
    });
    return form;
  });
  mostrar(cabecalho("Modelos de mensagem", "Usados nos botões \"Enviar lembrete\" e \"Propor horário\" da agenda. Toque num campo para inseri-lo no texto."),
    el("div", { class: "duas-colunas" }, blocos));
}

// ---------- ROTEADOR ----------
const ROTAS = {
  plataforma: { perfis: ["plataforma"], tela: telaPlataforma },
  inicio: { perfis: ["proprietario", "gerente", "barbeiro"], tela: telaInicio },
  caixa: { perfis: ["caixa", "proprietario", "gerente"], tela: telaCaixa },
  funcionamento: { perfis: ["proprietario", "gerente"], tela: telaFuncionamento },
  estoque: { perfis: ["proprietario", "gerente"], tela: telaEstoque },
  painel: { perfis: ["proprietario", "gerente"], tela: telaPainel },
  comissoes: { perfis: ["proprietario", "gerente"], tela: telaComissoes },
  contas: { perfis: ["proprietario", "gerente"], tela: telaContas },
  contador: { perfis: ["proprietario", "gerente"], tela: telaContador },
  desempenho: { perfis: ["gerente", "barbeiro"], tela: telaDesempenho },
  "caixa-historico": { perfis: ["proprietario", "gerente"], tela: telaHistoricoCaixa },
  "caixa-dia": { perfis: ["proprietario", "gerente"], tela: data => telaCaixa(/^\d{4}-\d{2}-\d{2}$/.test(data || "") ? data : hojeLocal()) },
  equipe: { perfis: ["proprietario", "gerente"], tela: telaEquipe },
  servicos: { perfis: ["proprietario", "gerente", "barbeiro"], tela: telaServicos },
  produtos: { perfis: ["proprietario", "gerente", "barbeiro", "caixa"], tela: telaProdutos },
  clientes: { perfis: ["proprietario", "gerente"], tela: () => telaClientes() },
  mensagens: { perfis: ["proprietario", "gerente"], tela: telaMensagens },
  agenda: { perfis: ["proprietario", "gerente", "barbeiro"], tela: telaAgenda }
};

async function rotear() {
  if (janela.open) janela.close();
  if (!usuario) return telaLogin();
  if (usuario.trocaObrigatoria) return telaTrocarSenha();
  atualizarTopo();
  const [nome, parametro] = (location.hash.replace(/^#\/?/, "") || usuario.telaInicial).split("/");
  const rota = ROTAS[nome];
  if (!rota || !rota.perfis.includes(usuario.perfil)) {
    if (nome !== usuario.telaInicial) return irParaInicial();
    return mostrar(el("p", { class: "erro", text: "Tela não disponível para o seu perfil." }));
  }
  try {
    await rota.tela(parametro);
  } catch (e) {
    if (e.message !== "Sessão encerrada") mostrar(el("div", { class: "cartao" }, el("p", { class: "erro", text: e.message }), botao("Tentar de novo", rotear)));
  }
}

async function iniciar() {
  document.getElementById("btn-sair").addEventListener("click", async () => {
    try { await api("/auth/logout", { metodo: "POST" }); } catch { /* sai mesmo assim */ }
    localStorage.removeItem(CHAVE_TOKEN);
    usuario = null;
    document.getElementById("aviso").hidden = true;   // aviso de quem saiu não aparece para o próximo
    clearTimeout(timerCaixa);
    history.replaceState(null, "", "/");
    telaLogin("Você saiu do sistema.");
  });
  document.getElementById("btn-inicio").addEventListener("click", () => irParaInicial());
  window.addEventListener("hashchange", rotear);
  if (localStorage.getItem(CHAVE_TOKEN)) {
    try {
      usuario = (await api("/auth/me")).usuario;
    } catch { /* api() já levou para o login */ return; }
  }
  rotear();
  if ("serviceWorker" in navigator && location.protocol === "https:") {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  }
}

iniciar();
