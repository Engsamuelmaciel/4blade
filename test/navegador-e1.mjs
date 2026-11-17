// Teste no navegador da entrega E1 (Playwright, Chromium já instalado). Dados FICTÍCIOS.
// Caminho: plataforma cria barbearia → proprietário troca senha → cria gerente, barbeiro e caixa →
// gerente cadastra 2 serviços, 2 produtos e 1 cliente → barbeiro não vê custo/margem → caixa abre na tela do caixa.
// Extra: plataforma bloqueia a barbearia → ninguém entra; desbloqueia → volta a entrar.
// Roda em computador (1366 px) e celular (390 px) e salva os prints em docs/prints/e1/.
// Uso: node test/navegador-e1.mjs
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { ir } from "./navegacao.mjs";

const { chromium } = createRequire(import.meta.url)("playwright");
const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
const PRINTS = join(RAIZ, "docs", "prints", "e1");
mkdirSync(PRINTS, { recursive: true });

const TELAS = [
  { nome: "computador", largura: 1366, altura: 768, movel: false, porta: 8791 },
  { nome: "celular", largura: 390, altura: 844, movel: true, porta: 8792 }
];

async function subirServidor(porta) {
  const proc = spawn(process.execPath, [join(RAIZ, "test", "servidor-local.mjs"), String(porta)], { stdio: ["ignore", "pipe", "inherit"] });
  await new Promise((ok, falha) => {
    proc.stdout.on("data", d => { if (String(d).includes(`localhost:${porta}`)) ok(); });
    proc.on("exit", c => falha(new Error(`servidor saiu (${c})`)));
  });
  return proc;
}

async function rodar(tela) {
  const servidor = await subirServidor(tela.porta);
  const base = `http://localhost:${tela.porta}`;
  const navegador = await chromium.launch();
  const contexto = await navegador.newContext({
    viewport: { width: tela.largura, height: tela.altura },
    deviceScaleFactor: 2, isMobile: tela.movel, hasTouch: tela.movel, locale: "pt-BR"
  });
  // Agenda do dia: os testes antigos usam o modo "Lista" (a grade é testada à parte em navegador-e2).
  await contexto.addInitScript(() => { try { if (!localStorage.getItem("4blade.agendaModo")) localStorage.setItem("4blade.agendaModo", "lista"); } catch { /* about:blank */ } });
  const page = await contexto.newPage();
  const problemas = [];
  // Recusas esperadas do servidor (limite do plano 409, falta de aceite LGPD 400, barbearia bloqueada 403) aparecem
  // no console como "Failed to load resource"; qualquer outro erro (CSP, JavaScript) reprova o teste.
  page.on("console", m => {
    if (m.type() === "error" && !/^Failed to load resource: the server responded with a status of (400|403|409)\b/.test(m.text())) problemas.push(m.text());
  });
  page.on("pageerror", e => problemas.push(e.message));
  let n = 0;
  const print = async nome => {
    n++;
    const arq = join(PRINTS, `${tela.nome}-${String(n).padStart(2, "0")}-${nome}.png`);
    await page.waitForTimeout(150);
    await page.evaluate(() => window.scrollTo(0, 0));   // print de página inteira com o topo fixo no lugar certo
    await page.screenshot({ path: arq, fullPage: true });
    // nenhum "null"/"undefined" perdido na tela
    const texto = await page.locator("body").innerText();
    assert.ok(!/\bnull\b|\bundefined\b|NaN/.test(texto), `texto estranho na tela ${nome}: ${texto}`);
    console.log(`  print: docs/prints/e1/${tela.nome}-${String(n).padStart(2, "0")}-${nome}.png`);
  };
  const passo = t => console.log(`[${tela.nome}] ${t}`);

  const entrar = async (login, senha) => {
    await page.fill("#c-login", login);
    await page.fill("#c-senha", senha);
    await page.click("button:has-text('Entrar')");
  };
  const sair = async () => {
    await page.click("#btn-conta"); await page.click("#btn-sair");
    await page.waitForSelector("text=Você saiu do sistema.");
  };
  // 1º acesso: entra com a provisória e troca (a tela já traz a provisória preenchida).
  const primeiroAcesso = async (login, provisoria, nova, printar = false) => {
    await entrar(login, provisoria);
    await page.waitForSelector("text=Crie sua senha");
    await page.fill("#c-nova", nova);
    await page.fill("#c-nova2", nova);
    if (printar) await print("troca-de-senha");
    await page.click("button:has-text('Salvar nova senha')");
  };
  const lerSenhaDaJanela = async () => {
    await page.waitForSelector("dialog[open] [data-teste=senha]");
    const s = (await page.textContent("dialog[open] [data-teste=senha]")).trim();
    assert.match(s, /^[A-HJ-NP-Z2-9]{10}$/);
    // botão de enviar pelo WhatsApp: mensagem com link, usuário e senha
    const login = (await page.textContent("dialog[open] [data-teste=login]")).trim();
    const msg = decodeURIComponent((await page.getAttribute("dialog[open] [data-teste=whats-escolher]", "href")).split("?text=")[1]);
    assert.match(msg, new RegExp(`Link: http://localhost:\\d+/#/entrar\\nUsuário: ${login.replace(".", "\\.")}\\nSenha provisória: ${s}`));
    return s;
  };
  const fecharJanela = () => page.click("dialog[open] button[type=submit]");
  const criarPessoa = async (perfil, nome, login, comServ, comProd, printarSenha = false) => {
    await page.selectOption("#c-perfil", perfil);
    await page.fill("#c-nome", nome);
    await page.fill("#c-login", login);
    if (comServ !== undefined) {
      await page.fill("#c-comServ", comServ);
      await page.fill("#c-comProd", comProd);
    }
    await page.click("button:has-text('Criar acesso')");
    const senha = await lerSenhaDaJanela();
    if (printarSenha) await print("senha-provisoria-da-equipe", false);
    await fecharJanela();
    await page.waitForSelector(`[data-usuario="${login}"]`);
    return senha;
  };

  try {
    // ---------- PLATAFORMA ----------
    passo("plataforma entra e cria a barbearia");
    await page.goto(`${base}/#/entrar`);
    await page.waitForSelector("text=Entrar");
    // olho da senha: mostra e oculta
    await page.fill("#c-senha", "Senha-de-olho-1");
    assert.equal(await page.getAttribute("#c-senha", "type"), "password");
    await page.click('[data-olho="c-senha"]');
    assert.equal(await page.getAttribute("#c-senha", "type"), "text");
    assert.equal(await page.getAttribute('[data-olho="c-senha"]', "aria-label"), "Ocultar senha");
    await print("login-senha-visivel");
    await page.click('[data-olho="c-senha"]');
    assert.equal(await page.getAttribute("#c-senha", "type"), "password");
    await page.fill("#c-senha", "");
    await print("login");
    await entrar("suporte", "Nova-suporte-senha");
    await page.waitForSelector("text=Painel da plataforma");
    await page.fill("#c-nome", "Barbearia Navalha Fictícia");
    await page.selectOption("#c-plano", "basico");
    await page.fill("#c-propNome", "Carlos Fictício");
    await page.fill("#c-propLogin", "carlos.navalha");
    // telefone formata enquanto digita
    await page.locator("#c-telefone").pressSequentially("11987654321");
    assert.equal(await page.inputValue("#c-telefone"), "(11) 98765-4321");
    await page.locator("#c-propTel").pressSequentially("1133334444");
    assert.equal(await page.inputValue("#c-propTel"), "(11) 3333-4444");
    assert.deepEqual(await page.locator("#menu [data-nav]").allInnerTexts(), ["Barbearias", "Pedidos de teste", "Chamados"], "plataforma: barbearias e chamados");
    assert.match(await page.textContent("[data-teste=explicacao-plataforma]"), /entre com o usuário do proprietário/);
    await page.click("button:has-text('Criar barbearia')");
    let senhaProp = await lerSenhaDaJanela();
    await print("plataforma-senha-do-proprietario");
    await fecharJanela();
    await page.waitForSelector('[data-barbearia="Barbearia Navalha Fictícia"]');
    assert.match(await page.textContent('[data-barbearia="Barbearia Navalha Fictícia"]'), /Telefone: \(11\) 98765-4321/);
    const cartaoB = await page.textContent('[data-barbearia="Barbearia Navalha Fictícia"]');
    assert.match(cartaoB, /Cadastrada pelo suporte/);
    assert.ok(!/Assinou pelo site|R\$/.test(cartaoB), "barbearia do suporte sem valor nem 'assinou pelo site'");
    assert.match(cartaoB, /Equipe ativa: 1 gerente \(o dono\), 0 barbeiro\(s\), 0 caixa\(s\)/, "o dono conta como gerente");
    await print("plataforma-painel");

    // suporte edita os dados do dono (WhatsApp) e envia o acesso direto para ele
    const cartaoNavalha = '[data-barbearia="Barbearia Navalha Fictícia"]';
    await page.click(`${cartaoNavalha} button:has-text("Editar dados")`);
    await page.waitForSelector("dialog[open] #c-propLogin");
    assert.equal(await page.inputValue("dialog[open] #c-propLogin"), "carlos.navalha");
    await page.fill("dialog[open] #c-propTel", "");
    await page.locator("dialog[open] #c-propTel").pressSequentially("11900005555");
    await print("plataforma-editar-dados", false);
    await page.click("dialog[open] button[type=submit]");
    await page.waitForSelector(`${cartaoNavalha} >> text=WhatsApp (11) 90000-5555`);
    await page.click(`${cartaoNavalha} button:has-text("Enviar acesso ao dono")`);
    await page.fill("dialog[open] #c-motivo", "Envio do 1º acesso");
    await page.click("dialog[open] button[type=submit]");
    senhaProp = await lerSenhaDaJanela();
    const hrefDono = await page.getAttribute("dialog[open] [data-teste=whats-acesso]", "href");
    assert.match(hrefDono, /^https:\/\/wa\.me\/5511900005555\?text=/);
    assert.match(decodeURIComponent(hrefDono), /Usuário: carlos\.navalha/);
    await print("plataforma-enviar-acesso", false);
    await fecharJanela();

    // suporte cria um usuário (caixa) na equipe da barbearia
    await page.click(`${cartaoNavalha} button:has-text("Equipe")`);
    await page.waitForSelector("dialog[open] [data-equipe='carlos.navalha']");
    await page.selectOption("dialog[open] #c-eqPerfil", "caixa");
    await page.fill("dialog[open] #c-eqNome", "Caixa do Suporte");
    await page.fill("dialog[open] #c-eqLogin", "caixa.suporte");
    await print("plataforma-equipe", false);
    await page.click("dialog[open] [data-teste=criar-usuario-suporte]");
    await lerSenhaDaJanela();
    await fecharJanela();
    passo("suporte: editou o WhatsApp do dono, enviou o acesso e criou um usuário na equipe");
    await sair();

    // ---------- PROPRIETÁRIO ----------
    passo("proprietário troca a senha e cria gerente, barbeiro e caixa");
    await primeiroAcesso("carlos.navalha", senhaProp, "Senha-Carlos-2026", true);
    await page.waitForSelector("[data-cartao=bruto]");   // gestão abre direto no painel
    await print("proprietario-inicio");
    await ir(page, "Equipe");
    await page.waitForSelector("text=Nova pessoa");
    const senhaGer = await criarPessoa("gerente", "Gabriel Gerente", "gabriel.navalha", "40", "10");
    const senhaBarb = await criarPessoa("barbeiro", "Bruno Barbeiro", "bruno.navalha", "50", "10", true);
    const senhaCx = await criarPessoa("caixa", "Camila Caixa", "camila.navalha");
    // limite do plano Básico: 2 barbeiros; o 3º é recusado pelo servidor (gerentes e caixas sem limite)
    await criarPessoa("barbeiro", "Diego Barbeiro", "diego.navalha", "50", "10");
    await page.waitForSelector('[data-vaga="barbeiro"] >> text=2/2');
    await page.selectOption("#c-perfil", "barbeiro");
    await page.fill("#c-nome", "Outro Barbeiro");
    await page.fill("#c-login", "outro.navalha");
    await page.click("button:has-text('Criar acesso')");
    await page.waitForSelector("form .erro:has-text('Limite do plano')");
    await print("proprietario-equipe-limite-do-plano");
    await sair();

    // ---------- GERENTE ----------
    passo("gerente cadastra 2 serviços, 2 produtos e 1 cliente");
    await primeiroAcesso("gabriel.navalha", senhaGer, "Senha-Gabriel-2026");
    await page.waitForSelector("[data-cartao=bruto]");
    await ir(page, "Serviços");
    // formatação de dinheiro: ponto vira vírgula, milhar com ponto, no máximo 2 casas, letras ignoradas
    for (const [digitado, esperado] of [["38.5", "38,50"], ["1234,5", "1.234,50"], ["12,345", "12,34"], ["4a0", "40,00"]]) {
      await page.fill("#c-preco", "");
      await page.locator("#c-preco").pressSequentially(digitado);
      await page.locator("#c-preco").blur();
      assert.equal(await page.inputValue("#c-preco"), esperado, `preço digitado ${digitado}`);
    }
    for (const [nome, preco, dur] of [["Corte masculino", "40,00", "30"], ["Barba completa", "30,00", "20"]]) {
      await page.fill("#c-nome", nome);
      await page.fill("#c-preco", preco.replace(",00", ""));   // digita "40" → vira "40,00" ao sair do campo
      await page.fill("#c-duracao", dur);
      assert.equal(await page.inputValue("#c-preco"), preco);
      await page.click("form.cartao button:has-text('Salvar')");
      await page.waitForSelector(`[data-servico="${nome}"]`);
    }
    assert.match(await page.textContent('[data-servico="Corte masculino"]'), /R\$\s?40,00/);
    await print("gerente-servicos");

    await ir(page, "Produtos");
    for (const [nome, preco, cod] of [["Pomada modeladora", "45,00", "7890000000011"], ["Óleo para barba", "38,50", ""]]) {
      await page.fill("#c-nome", nome);
      await page.fill("#c-preco", preco);
      await page.fill("#c-minimo", "");
      await page.locator("#c-minimo").pressSequentially("2-e,");   // só o número fica
      assert.equal(await page.inputValue("#c-minimo"), "2");
      if (cod) await page.fill("#c-codigo", cod);
      await page.click("form.cartao button:has-text('Salvar')");
      await page.waitForSelector(`[data-produto="${nome}"]`);
    }
    assert.match(await page.textContent('[data-produto="Pomada modeladora"]'), /Custo médio/);
    await print("gerente-produtos-com-custo-e-margem");

    await ir(page, "Clientes");
    await page.fill("#c-nome", "Diego Cliente Fictício");
    await page.locator("#c-telefone").pressSequentially("11900001234");
    assert.equal(await page.inputValue("#c-telefone"), "(11) 90000-1234");
    // sem o aceite LGPD o servidor recusa
    await page.click("form.cartao button:has-text('Salvar')");
    await page.waitForSelector("form .erro:has-text('LGPD')");
    await page.check("#c-lgpd");
    await page.click("form.cartao button:has-text('Salvar')");
    await page.waitForSelector('[data-cliente="Diego Cliente Fictício"]');
    assert.match(await page.textContent('[data-cliente="Diego Cliente Fictício"]'), /\(11\) 90000-1234/);
    await print("gerente-clientes");

    await ir(page, "Mensagens");
    await page.waitForSelector("#modelo-escolha");
    await page.selectOption("#modelo-escolha", "lembrete");   // um quadro só: escolhe o modelo na lista
    await page.waitForSelector("#texto-lembrete");
    await print("gerente-modelos-de-mensagem");
    await sair();

    // ---------- BARBEIRO ----------
    passo("barbeiro entra e não vê custo/margem");
    await primeiroAcesso("bruno.navalha", senhaBarb, "Senha-Bruno-2026");
    await page.waitForSelector("h2:has-text('Minha agenda')");   // barbeiro abre direto na própria agenda
    assert.equal(await page.locator("#menu [data-nav='Equipe']").count(), 0, "barbeiro não tem Equipe");
    await print("barbeiro-inicio");
    await ir(page, "Produtos");
    await page.waitForSelector('[data-produto="Pomada modeladora"]');
    const textoBarbeiro = await page.locator("main").innerText();
    assert.ok(!/custo|margem/i.test(textoBarbeiro), "barbeiro viu custo/margem!");
    assert.match(textoBarbeiro, /R\$\s?45,00/);
    await print("barbeiro-produtos-sem-custo");
    // tentar abrir a tela da equipe pelo endereço leva de volta ao início
    await page.goto(`${base}/#/equipe`);
    await page.waitForSelector("h2:has-text('Minha agenda')");
    await sair();

    // ---------- CAIXA ----------
    passo("caixa entra e abre direto na tela do caixa");
    await primeiroAcesso("camila.navalha", senhaCx, "Senha-Camila-2026");
    await page.waitForSelector("[data-tela=caixa]");
    assert.match(page.url(), /#\/caixa$/);
    await print("caixa-tela-inicial");
    await sair();

    // ---------- BLOQUEIO ----------
    passo("plataforma bloqueia a barbearia: ninguém entra");
    await entrar("suporte", "Nova-suporte-senha");
    await page.waitForSelector('[data-barbearia="Barbearia Navalha Fictícia"]');
    await page.click('[data-barbearia="Barbearia Navalha Fictícia"] button:has-text("Bloquear")');
    await page.fill("dialog[open] #c-motivo", "Teste de bloqueio (fictício)");
    await page.click("dialog[open] button[type=submit]");
    await page.waitForSelector('[data-barbearia="Barbearia Navalha Fictícia"] .etiqueta:has-text("Bloqueada")');
    await print("plataforma-barbearia-bloqueada");
    await sair();
    await entrar("camila.navalha", "Senha-Camila-2026");
    await page.waitForSelector("form .erro:has-text('bloqueado')");
    await print("login-recusado-barbearia-bloqueada");
    await entrar("suporte", "Nova-suporte-senha");
    await page.click('[data-barbearia="Barbearia Navalha Fictícia"] button:has-text("Desbloquear")');
    await page.fill("dialog[open] #c-motivo", "Fim do teste");
    await page.click("dialog[open] button[type=submit]");
    await page.waitForSelector('[data-barbearia="Barbearia Navalha Fictícia"] .etiqueta:has-text("Ativa")');
    await sair();
    await entrar("camila.navalha", "Senha-Camila-2026");
    await page.waitForSelector("[data-tela=caixa]");

    assert.deepEqual(problemas, [], `erros no console (CSP etc.): ${problemas.join(" | ")}`);
    passo("OK — nenhum erro no console (inclui bloqueios de CSP)");
  } catch (e) {
    await page.screenshot({ path: join(PRINTS, `${tela.nome}-FALHA.png`), fullPage: true }).catch(() => {});
    throw e;
  } finally {
    await navegador.close();
    servidor.kill();
  }
}

for (const tela of TELAS) await rodar(tela);
console.log("TESTE NO NAVEGADOR: OK (computador 1366 px e celular 390 px)");
