# 4blade — Prompts para o Code (uma entrega por sessão)

Os documentos `docs/ESPECIFICACAO.md`, `docs/PRECIFICACAO.md` e o `CLAUDE.md` já estão neste repositório: cada prompt é curto e o Code lê a especificação aqui.

Use UM prompt por sessão, nesta ordem. Só passe para o próximo depois de avaliar e aprovar a entrega.

---

## Prompt E1 — Base

```
Projeto novo: sistema de gestão para barbearias, vendido para várias barbearias (multi-empresa). Leia CLAUDE.md e docs/ESPECIFICACAO.md antes de qualquer coisa: lá estão perfis, regras, fluxos e as entregas (fase 1 = E1 a E4). Execute SOMENTE a entrega E1 (Base).

Tecnologia (obrigatória): Cloudflare Workers + D1 (migrações versionadas em migrations/) + tela web instalável (PWA, JavaScript sem framework), CSP rígida (sem style="" no HTML). Testes com node --test e D1 local.

Reaproveite, adaptando, a base que já está neste repositório em referencia/frotaz/ (leia referencia/frotaz/LEIAME.md; NÃO acesse nenhum outro repositório): login por usuário e senha com hash, troca obrigatória no 1º acesso, limite de 5 tentativas/15 min, sessão de 12 h, auditoria, util.js, testes com D1 local (test/d1-local.js, test/ambiente.js), service worker e estilo base. Não copie nada específico de frota.

E1 deve entregar:
1. Multi-empresa: tabela barbearias (com campo plano: basico | profissional); toda tabela de dados tem barbearia_id; o servidor SEMPRE filtra pela barbearia da sessão, nunca pelo que vem da tela. Limite de usuários ativos por perfil conforme o plano (Básico: 1 gerente, 3 barbeiros, 1 caixa; Profissional: 2 gerentes, 10 barbeiros + adicionais, 2 caixas), conferido no servidor; desativar libera a vaga.
2. Perfis: plataforma, proprietário, gerente, barbeiro, caixa (permissões da seção 2 da especificação). Usuário caixa ao entrar abre direto a tela do caixa (por enquanto uma página "Caixa — em construção").
3. Painel da plataforma: criar barbearia + 1º acesso do proprietário, bloquear/desbloquear (bloqueada não entra).
4. Proprietário/gerente: criar, editar e desativar usuários (proprietário cria gerentes; gerente cria barbeiro e caixa).
5. Cadastros da seção 3: serviços, produtos (sem estoque ainda; só o cadastro), colaboradores com % de comissão em serviço e em produto, clientes com aceite LGPD, modelos de mensagem editáveis.
6. Dinheiro em centavos (inteiro). Fuso America/Sao_Paulo. Nada é apagado (desativar com motivo). Tudo auditado com antes/depois.

Testes obrigatórios (automáticos): isolamento entre duas barbearias (uma nunca lê/altera dado da outra, inclusive mudando ids na requisição); cada perfil recusado nas rotas que não pode; barbearia bloqueada não entra; login/limite de tentativas; validações dos cadastros.
Teste no navegador (Playwright, já instalado): plataforma cria barbearia → proprietário troca senha → cria gerente, barbeiro e caixa → gerente cadastra 2 serviços, 2 produtos, 1 cliente → barbeiro não vê custo/margem → caixa abre na tela do caixa. Prints em computador 1366 px e celular 390 px.

Dados de teste fictícios. Não faça deploy, não crie recursos na Cloudflare, não use segredos reais. Atualize CLAUDE.md com o que foi feito. Commit e push na ramificação designada. Entregue: resumo em linguagem simples (o responsável não é programador e usa celular), saída dos testes e os prints.
```

---

## Prompt E2 — Agenda e finalização

```
Leia CLAUDE.md e docs/ESPECIFICACAO.md. A E1 está pronta. Execute SOMENTE a entrega E2 (seções 4.1, 4.2 e 4.9 da especificação), mais a abertura de caixa mínima (abrir com valor de troco; lista das entradas do dia).

Pontos que não podem faltar: sem sobreposição de horário por barbeiro; barbeiro só vê/agenda a própria agenda, gerente todas; situações agendado/finalizado/faltou/cancelado (com motivo); botões "Enviar lembrete" e "Propor horário" abrindo wa.me com o modelo preenchido e envio registrado; finalizar com valor de tabela alterável, alteração registrada (tabela, cobrado, quem, quando); forma de pagamento; entra no caixa com VALOR BRUTO; comissão calculada e guardada à parte (visível só ao barbeiro dono e ao gerente; o caixa nunca vê); finalizar exige caixa aberto; funcionamento da barbearia (dias, horários, intervalo, datas fechadas, fechar agenda com lista para remarcar); bloqueios do barbeiro e do gerente; cliente identificado pelo telefone na própria marcação; até 2 formas de pagamento com soma conferida; barbeiro reabre o próprio atendimento enquanto o caixa está aberto (estorna entrada e comissão, registrado).

Testes automáticos dessas regras (incluindo isolamento entre barbearias e perfis) + navegador (barbeiro agenda, envia mensagem, finaliza com valor alterado; caixa vê o valor bruto e não vê comissão; gerente vê a alteração destacada), prints 1366 px e 390 px. Mesmas regras de entrega da E1.
```

---

## Prompt E3 — Caixa e estoque

```
Leia CLAUDE.md e docs/ESPECIFICACAO.md. E1 e E2 prontas. Execute SOMENTE a entrega E3 (seções 4.3 e 4.4).

Não pode faltar: vendas avulsas baixando estoque; cancelamento devolvendo; sangria/suprimento com motivo; correção de forma de pagamento antes do fechamento (registrada); tela de fechamento com todos os atendimentos e vendas do dia, totais por forma de pagamento, esperado × contado e diferença; caixa fechado imutável, só gerente reabre com motivo; histórico de caixas para o gerente. Estoque: entrada com custo (custo médio), ajustes com motivo, venda sem saldo bloqueada, avisos de mínimo e validade 30 dias, inventário, histórico por produto.

Teste de ponta a ponta: um dia simulado com 6 atendimentos, 3 vendas, 1 sangria, 1 suprimento e fechamento com R$ 5,00 de falta — conferir todos os totais à mão no teste. Navegador + prints 1366 px e 390 px. Mesmas regras de entrega.
```

---

## Prompt E4 — Gestão (comissões, contas, painel)

```
Leia CLAUDE.md e docs/ESPECIFICACAO.md. E1 a E3 prontas. Execute SOMENTE a entrega E4 (seções 4.5 a 4.8, 4.10 e 4.11).

Não pode faltar: comissão de serviço e de produto pelo % de cada barbeiro sobre o valor bruto; vales; fechamento de comissão por período (comissões − vales), imutável depois de fechado; contas a pagar com recorrência mensal e "pago com dinheiro do caixa" (vira sangria); painel do gerente com filtro Hoje/Semana/Mês, cartões, gráfico de faturamento por dia, ranking de barbeiros e avisos (seção 4.7, fórmula de lucro exatamente como lá); desempenho do barbeiro só com os dados dele; Enviar ao contador (PDF + CSV, Compartilhar do celular, registro do envio e aviso de alteração posterior, separação cota-parte barbearia × barbeiros); extrato mensal do barbeiro; cópia de todos os dados em planilhas.

Teste: semana simulada com 2 barbeiros (% diferentes), vales e 3 contas — conferir no teste os números do painel e do fechamento de comissão calculados à mão. Visual simples e legível no celular (gráficos em SVG/CSS, sem biblioteca externa). Navegador + prints 1366 px e 390 px. Mesmas regras de entrega.
```


---

## Página da Barbearia (24/11/2026)

Decisões do responsável depois do plano: página para TODOS os planos; sem agendamento pelo site (só WhatsApp); horários livres só se o gerente ligar.

### Prompt: Página da Barbearia no 4Blade (link da bio)

> Copie tudo a partir de "PROMPT" e cole na conversa do 4Blade (repositório do 4Blade). Preparado em 24/11/2026.

---

## PROMPT

Quero criar no **4Blade** um recurso novo: a **Página da Barbearia**. É uma página pública, bonita e moderna, dentro do domínio do 4Blade (`forblade.com.br/<nome-da-barbearia>`), para o barbeiro colocar no **link da bio do Instagram**, no WhatsApp, no Google Meu Negócio e em anúncios.

Na página, o cliente final:
- conhece a barbearia (fotos, logo, sobre);
- vê os serviços com preço e duração;
- vê horários de funcionamento e a localização;
- toca em **"Solicitar meu horário"**.

Esse recurso entra **no valor dos planos**, sem cobrança à parte, como benefício e argumento de venda.

Responda sempre em português do Brasil e em linguagem simples (o responsável não é programador e usa principalmente o celular). Antes de mudar qualquer coisa, **leia o código atual** e siga as convenções que já existem: telas, rotas, perfis, auditoria, estilo, segurança, testes e o jeito de publicar. Onde este pedido conflitar com uma regra já existente no projeto (CLAUDE.md, LEIAME), **me avise antes**.

### 1. O que já existe e deve ser aproveitado
- **Os planos já preveem um site.** No servidor existem `PLANOS` com o campo `site` (`basico: null`, `standard: "visual"`, `pro: "completo"`) e a constante `SITE_DISPONIVEL = false` ("fase 2"). Este recurso é exatamente essa fase 2: ligar o que os planos já prometem.
- **Os dados já estão no sistema e devem ser reaproveitados**, sem cadastrar duas vezes:
  - nome da barbearia;
  - serviços (nome, preço, duração);
  - profissionais;
  - horário de funcionamento e intervalos;
  - horários livres da agenda (a tela "Novo horário" já calcula isso);
  - WhatsApp e endereço, se já existirem no cadastro.
- **Canal de suporte:** o 4Blade já tem suporte. Ele será usado para o barbeiro mandar fotos, logo e textos quando quiser que a equipe monte a página por ele (ver item 5).
- **Landing page:** a página inicial do forblade.com.br (sem login) já existe e deve continuar igual. A rota nova não pode quebrá-la, nem quebrar `#/entrar`, `#/planos` e as demais rotas.

### 2. Endereço da página (o "link")
- Formato: **`https://forblade.com.br/<slug>`**, por exemplo `forblade.com.br/navalhaeco`. Deve funcionar também com `www`.
- O **slug** é escolhido pelo barbeiro, com sugestão automática a partir do nome:
  - só letras minúsculas sem acento, números e hífen;
  - de 3 a 40 caracteres;
  - único no sistema.
- **Palavras reservadas, que não podem virar slug:** `api`, `entrar`, `planos`, `assinar`, `duvidas`, `suporte`, `admin`, `master`, `icons`, `tutoriais`, `app`, `sw`, `manifest`, `termos`, `privacidade`, `login`, `cadastro`, `ajuda`, `contato`, `www`, `static`, `assets`, `b` e as rotas e pastas que já existirem no projeto (confira no código).
- **Trocar o slug:** pode, mas o endereço antigo continua redirecionando para o novo por pelo menos 90 dias. Assim, um link já postado no Instagram não quebra.
- **Barbearia inativa, inadimplente além da tolerância ou com a página despublicada:** o endereço mostra uma página neutra "Esta página não está disponível no momento", com link para o 4Blade. Sem erro técnico e sem dados da barbearia.

### 3. O que a página pública mostra (de cima para baixo)
Feita **primeiro para o celular** (390 px), perfeita no computador, leve e rápida.

1. **Capa:** foto de capa em largura total, com escurecimento suave; **logo** redonda sobreposta; **nome da barbearia**; **frase de efeito** (ex.: "Corte de respeito desde 2012"); nota ou selo opcional; ícone do Instagram com o @.
2. **Botão principal "Solicitar meu horário"**, grande. No celular fica **fixo no rodapé da tela** enquanto a pessoa rola.
3. **Serviços**, vindos do 4Blade: cartões com nome, descrição curta (opcional), duração e preço, e um botão "Agendar" em cada um. O barbeiro escolhe quais serviços aparecem e em que ordem. Serviços inativos no sistema não aparecem.
4. **Galeria de fotos:** cortes, ambiente e equipe. Até 12 fotos, em grade, ampliando ao tocar, com descrição (texto alternativo) para acessibilidade.
5. **Equipe (opcional):** foto, nome e especialidade de cada profissional, vindos do cadastro de profissionais. O barbeiro escolhe quem aparece.
6. **Sobre:** texto curto da barbearia, até cerca de 600 caracteres.
7. **Horário de funcionamento:** vindo do 4Blade, por dia da semana. Mostra "Aberto agora" ou "Fechado agora" pelo horário de Brasília.
8. **Localização:** endereço completo, mapa e botão **"Como chegar"**, que abre o Google Maps ou o Waze com o endereço.
   - Se a política de segurança (CSP) do 4Blade não permitir mapa incorporado, usar uma imagem estática ou um cartão com o endereço e o botão.
   - Não liberar domínios externos na CSP sem me perguntar.
9. **Redes e contato:** Instagram, WhatsApp e telefone.
10. **Formas de pagamento aceitas (opcional):** Pix, cartão, dinheiro.
11. **Rodapé:** "Página criada com o **4Blade**", com link para a landing do 4Blade. É marketing gratuito: cada barbearia vira vitrine do produto.

**Visual**
- Moderno e sofisticado, seguindo a identidade do 4Blade (grafite e dourado).
- **Temas e cor de destaque escolhidos pelo barbeiro:** pelo menos 4 temas prontos (Clássico escuro e dourado, Claro minimalista, Vintage, Moderno colorido). Sem cor totalmente livre, para nunca ficar feio ou ilegível.
- Respeitar contraste (WCAG AA), tamanho de toque e `prefers-reduced-motion`.

### 4. O botão "Solicitar meu horário" (depende do plano)

| Plano | O que acontece |
|---|---|
| **Básico** | Sem Página da Barbearia (como está hoje: `site: null`). No painel aparece um convite "Disponível nos planos Standard e Pro", com prévia e botão para mudar de plano. |
| **Standard** ("site visual") | Abre o **WhatsApp da barbearia** com mensagem pronta. Se a pessoa escolheu serviços na página: "Olá, Navalha & Co.! Vim pela sua página e quero agendar: Corte + barba (R$ 65, 50 min). Qual horário vocês têm?". Sem serviço escolhido, uma mensagem padrão que o barbeiro pode editar. |
| **Pro** ("site completo integrado") | **Agendamento online de verdade**, descrito logo abaixo. A opção "falar pelo WhatsApp" continua disponível. |

**O agendamento online do plano Pro, passo a passo:**
1. O cliente escolhe um ou mais serviços e, opcionalmente, o profissional (ou "qualquer um").
2. Vê os **dias e horários livres** calculados pela mesma regra da agenda: funcionamento, intervalo, duração dos serviços, bloqueios e horários já marcados.
3. Informa nome e WhatsApp e confirma.
4. O horário **entra na agenda do 4Blade** como "Solicitado pela página" e aparece para o barbeiro. O barbeiro escolhe em Configurações se o horário entra já confirmado ou precisa de aprovação.
5. O cliente vê uma tela de "Pedido enviado". Se o 4Blade já tiver o envio de lembrete e confirmação por WhatsApp, usar.
6. **Proteções:**
   - não deixa marcar horário que acabou de ser ocupado (checar de novo no servidor na hora de gravar);
   - limite de pedidos por aparelho e por telefone, contra abuso;
   - antecedência mínima e máxima configurável (ex.: até 30 dias, pelo menos 1 hora antes).
7. Cliente novo fica cadastrado como cliente da barbearia, sem duplicar se o telefone já existir.

### 5. Edição da página (painel do 4Blade) e montagem pela equipe
Tela nova no menu: **"Minha página"** (ou "Página da barbearia").

**Quem edita:** o proprietário e o gerente. Barbeiro e caixa não editam. Confira os perfis que existem no 4Blade.

**O que dá para editar:**
- **Endereço (slug)**, com verificação na hora se está livre.
- **Logo** (quadrada, recortada redonda na página) e **foto de capa**.
- **Galeria:** até 12 fotos, com reordenar, excluir e legenda.
- Nome de exibição, frase de efeito e texto "Sobre".
- **Serviços:** quais aparecem, a ordem e uma descrição curta opcional. Preço e duração vêm do cadastro e não são duplicados.
- **Equipe:** quem aparece, com foto e especialidade.
- WhatsApp da página e mensagem padrão.
- Endereço completo (rua, número, bairro, cidade, UF, CEP) e um link do Google Maps opcional.
- Instagram (@), telefone e formas de pagamento.
- **Tema** e cor de destaque, entre as opções prontas.
- Plano Pro: as regras do agendamento online (item 4).
- **"Publicar" / "Despublicar"**, com a data da última publicação.

**Na mesma tela:**
- **Pré-visualização** de como a página fica no celular, antes de publicar.
- Botões **"Copiar link"**, **"Compartilhar no WhatsApp"** e **"Baixar QR Code"**: PNG para imprimir no balcão ou no espelho, com o nome e a logo da barbearia.
- Dica: "Cole este link na bio do seu Instagram".

**Fotos**
- Aceitar JPG, PNG, WEBP e HEIC, se possível.
- Reduzir e converter **no próprio celular** antes de enviar: WEBP, capa até cerca de 1600 px, galeria até cerca de 1200 px, logo até cerca de 512 px, cada foto até cerca de 500 KB.
- Conferir o tipo pelo conteúdo no servidor e remover dados de localização (EXIF).
- Guardar no armazenamento que o projeto já usa para arquivos. Se não houver, propor o caminho (ex.: R2 ou KV) e **me perguntar antes de criar**.
- Limite total por barbearia (ex.: 30 MB).
- Ao trocar ou excluir uma foto, apagar o arquivo antigo.

**Montagem pela equipe 4Blade/Axia**
O barbeiro pode **mandar tudo pelo suporte** (fotos, logo, nome, endereço, textos) e a nossa equipe monta a página por ele.
- O perfil administrador (Master ou suporte, conforme existir) precisa conseguir **abrir e editar a página de qualquer barbearia** pelo painel administrativo.
- Precisa também poder **anexar as fotos recebidas no suporte** direto na página.
- Toda edição feita pela equipe fica registrada na **auditoria**: quem, quando e o que mudou.
- No canal de suporte, incluir um assunto pronto: **"Quero que montem minha página"**, com uma lista do que mandar:
  - logo;
  - 1 foto de capa;
  - até 12 fotos;
  - nome;
  - endereço;
  - Instagram;
  - frase de efeito;
  - texto sobre;
  - quais serviços mostrar.

### 6. Números da página (painel)
Na tela "Minha página" e no Painel:
- **visitas à página;**
- toques em **"Solicitar meu horário"** e toques em **"Como chegar"**;
- plano Pro: **agendamentos feitos pela página.**

Por dia e por período (7 dias, 30 dias, mês), com um gráfico simples. A contagem é anônima: sem guardar IP puro nem dados pessoais de quem só visitou. Não usar Google Analytics nem pixel externo sem me perguntar.

### 7. Google, Instagram e compartilhamento
- Título e descrição por barbearia, como "Navalha & Co. — Barbearia em São Paulo | Agende seu horário".
- Imagem de compartilhamento (`og:image`) = capa ou logo, para aparecer bonita no WhatsApp e no Instagram.
- Dados estruturados `schema.org` (`HairSalon` ou `LocalBusiness`) com nome, endereço, telefone, horário e serviços, para o Google entender.
- Página despublicada ou inativa não pode ser indexada.
- URL canônica com o slug atual.

### 8. Regras e segurança
- A página pública **nunca** mostra faturamento, comissões, clientes, contas ou qualquer dado interno.
- Todo texto vindo do barbeiro é tratado como texto (escapar HTML), nunca como código.
- Manter a política de segurança (CSP) atual: nada de estilo ou script inline, e cor e forma só por classe.
- Limites de envio e de tamanho no servidor. Validar tudo no servidor, não só na tela.
- **LGPD:** no agendamento online, um aviso curto de que os dados vão para a barbearia para marcar o horário, com link para a política de privacidade que já existe.
- A verificação de plano é feita **no servidor**:
  - se o plano cair para Básico, a página é despublicada sozinha e volta ao subir de plano, sem perder o que foi cadastrado;
  - se o plano cair de Pro para Standard, o agendamento online desliga e o botão volta a ser WhatsApp.
- Dados de teste sempre fictícios.
- **Me pergunte antes de:** criar tabelas, rodar migração no banco real, criar armazenamento ou segredo novo, e publicar.

### 9. Mudanças na landing e nos planos
- Atualizar a tela de planos e a landing do forblade.com.br para mostrar o benefício:
  - Standard: "**Página da sua barbearia** com link para a bio do Instagram";
  - Pro: "**Página com agendamento online** direto na sua agenda".
- Mostrar na landing um exemplo de página de barbearia (fictícia).
- Ligar `SITE_DISPONIVEL` (ou a regra equivalente) só quando tudo estiver testado.

### 10. Como quero receber (entrega e testes)
1. **Antes de programar:** um plano curto em linguagem simples, com as telas, o que muda no banco, onde ficam as fotos e o que cada plano libera. Espere meu "ok".
2. **Testes automáticos:**
   - slug válido, reservado e repetido;
   - redirecionamento do slug antigo;
   - página inativa;
   - controle por plano (Básico sem página, Standard com WhatsApp, Pro com agendamento);
   - não deixar marcar horário ocupado;
   - limites de envio;
   - texto malicioso escapado;
   - fotos com tipo e tamanho inválidos;
   - edição pela equipe registrada na auditoria.
3. **Teste no navegador local**, com prints no celular (390 px) e no computador (1366 px):
   - criar a página do zero;
   - enviar logo, capa e galeria;
   - publicar;
   - abrir o link público;
   - tocar em "Solicitar meu horário" no Standard (WhatsApp com a mensagem certa);
   - agendar online no Pro (o horário aparecendo na agenda);
   - página despublicada;
   - QR Code baixado;
   - a equipe editando a página de outra barbearia.
4. Atualizar o CLAUDE.md e o LEIAME com o que foi feito e o que ficou pendente.
5. Não dizer que algo está testado ou publicado sem mostrar a evidência (saída dos testes e prints).

### 11. Exemplo para os testes (fictício)
- **Barbearia:** Navalha & Co. — slug `navalhaeco`.
- **Frase:** "Corte de respeito desde 2012."
- **Endereço:** Rua Exemplo, 123 — Centro — São Paulo/SP.
- **WhatsApp:** (11) 90000-0000.
- **Instagram:** @navalhaeco.
- **Serviços:**
  - Corte masculino, R$ 40, 30 min;
  - Barba completa, R$ 30, 20 min;
  - Corte + barba, R$ 65, 50 min;
  - Pigmentação, R$ 50, 40 min.
- **Funcionamento:** seg a sex 9h–20h (intervalo 12h–13h), sáb 8h–14h.
- **Equipe:** Gustavo, Bruno e Paulo (fictícios).

---

## Resumo do que você está pedindo (para conferir)
- Página pública da barbearia em `forblade.com.br/nome`, para a bio do Instagram.
- Fotos, logo, capa, serviços com preço, equipe, sobre, horários, localização com "Como chegar", Instagram e WhatsApp.
- Botão "Solicitar meu horário": WhatsApp com mensagem pronta no Standard e agendamento online direto na agenda no Pro. O Básico não tem página.
- Tela "Minha página" para o dono editar, com prévia, publicar e despublicar, copiar link e QR Code.
- A equipe 4Blade/Axia também pode montar e editar a página com o material mandado pelo suporte (com auditoria).
- Números: visitas, cliques e agendamentos pela página.
- Incluído no valor dos planos.
