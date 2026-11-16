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
  return el("div", { class: "campo" },
    el("label", { for: id, text: rotulo }),
    controle,
    ajuda ? el("p", { class: "ajuda", text: ajuda }) : null);
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
  mostrar(el("section", { class: "estreito" }, form));
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
      el("p", { class: "suave", text: `Proprietário: ${b.proprietario?.nome || "—"} (${b.proprietario?.login || "—"})${b.proprietario?.trocaPendente ? " · ainda não entrou" : ""}` }),
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
      ["#/equipe", "Equipe", "Usuários, perfis e comissões"],
      ["#/servicos", "Serviços", "Preços e duração"],
      ["#/produtos", "Produtos", "Preço, custo e margem"],
      ["#/clientes", "Clientes", "Cadastro com aceite LGPD"],
      ["#/mensagens", "Mensagens", "Modelos para o WhatsApp"],
      ["#/agenda", "Agenda", "Em construção"]
    ]
    : [
      ["#/agenda", "Minha agenda", "Em construção"],
      ["#/servicos", "Serviços", "Preços da barbearia"],
      ["#/produtos", "Produtos", "Preço e disponível"]
    ];
  mostrar(
    cabecalho(`Olá, ${usuario.nome.split(" ")[0]}!`, `${NOME_PERFIL[usuario.perfil]} · Plano ${NOME_PLANO[usuario.barbearia.plano]}`, null),
    el("nav", { class: "menu" }, itens.map(([href, t, s]) => el("a", { class: "menu-item", href },
      el("span", { class: "menu-letra", "aria-hidden": "true", text: t[0] }),
      el("span", { class: "menu-textos" }, el("strong", { text: t }), el("span", { class: "suave", text: s }))))));
}

function telaEmConstrucao(titulo, texto, voltar = "#/inicio") {
  mostrar(
    cabecalho(titulo, null, voltar),
    el("div", { class: "cartao construcao" },
      el("p", { class: "grande", text: `${titulo} — em construção` }),
      el("p", { class: "suave", text: texto })));
}

function telaCaixa() {
  mostrar(
    cabecalho("Caixa", usuario.barbearia.nome, null),
    el("div", { class: "cartao construcao", "data-tela": "caixa" },
      el("p", { class: "grande", text: "Caixa — em construção" }),
      el("p", { class: "suave", text: "Aqui você vai abrir e fechar o caixa, acompanhar as entradas do dia, vender produtos e registrar sangria e suprimento. Chega nas próximas entregas." })),
    el("nav", { class: "menu" },
      el("a", { class: "menu-item", href: "#/produtos" },
        el("span", { class: "menu-letra", "aria-hidden": "true", text: "P" }),
        el("span", { class: "menu-textos" }, el("strong", { text: "Produtos" }), el("span", { class: "suave", text: "Preços para consulta" })))));
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
    u.podeGerenciar ? el("div", { class: "item-acoes" },
      botao("Editar", () => janelaUsuario(u), "pequeno"),
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
  caixa: { perfis: ["caixa"], tela: telaCaixa },
  equipe: { perfis: ["proprietario", "gerente"], tela: telaEquipe },
  servicos: { perfis: ["proprietario", "gerente", "barbeiro"], tela: telaServicos },
  produtos: { perfis: ["proprietario", "gerente", "barbeiro", "caixa"], tela: telaProdutos },
  clientes: { perfis: ["proprietario", "gerente"], tela: () => telaClientes() },
  mensagens: { perfis: ["proprietario", "gerente"], tela: telaMensagens },
  agenda: { perfis: ["proprietario", "gerente", "barbeiro"], tela: () => telaEmConstrucao("Agenda", "A agenda (marcar, lembrar pelo WhatsApp e finalizar atendimento) chega na próxima entrega.") }
};

async function rotear() {
  if (janela.open) janela.close();
  if (!usuario) return telaLogin();
  if (usuario.trocaObrigatoria) return telaTrocarSenha();
  atualizarTopo();
  const nome = location.hash.replace(/^#\/?/, "") || usuario.telaInicial;
  const rota = ROTAS[nome];
  if (!rota || !rota.perfis.includes(usuario.perfil)) {
    if (nome !== usuario.telaInicial) return irParaInicial();
    return mostrar(el("p", { class: "erro", text: "Tela não disponível para o seu perfil." }));
  }
  try {
    await rota.tela();
  } catch (e) {
    if (e.message !== "Sessão encerrada") mostrar(el("div", { class: "cartao" }, el("p", { class: "erro", text: e.message }), botao("Tentar de novo", rotear)));
  }
}

async function iniciar() {
  document.getElementById("btn-sair").addEventListener("click", async () => {
    try { await api("/auth/logout", { metodo: "POST" }); } catch { /* sai mesmo assim */ }
    localStorage.removeItem(CHAVE_TOKEN);
    usuario = null;
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
