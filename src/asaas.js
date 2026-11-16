// Conversa com o Asaas (cobrança da assinatura). Documentação: https://docs.asaas.com
// Segredos do Worker: ASAAS_API_KEY (chave da API) e ASAAS_WEBHOOK_TOKEN (senha que o Asaas manda nos avisos).
// ASAAS_URL (variável comum): padrão = ambiente de TESTES do Asaas (sandbox). Produção: https://api.asaas.com/v3
// Nos testes automáticos, env.ASAAS_FETCH substitui o fetch (Asaas de mentira, test/asaas-falso.mjs).
import { HttpError } from "./util.js";

export const ASAAS_SANDBOX = "https://api-sandbox.asaas.com/v3";

export class ErroAsaas extends HttpError {
  constructor(mensagem, detalhe = null) {
    super(mensagem, 502);
    this.detalhe = detalhe;
  }
}

export const asaasConfigurado = env => Boolean(env.ASAAS_API_KEY);

export function clienteAsaas(env) {
  if (!env.ASAAS_API_KEY) throw new HttpError("A assinatura on-line ainda não está disponível. Fale com o suporte do 4blade.", 503);
  const base = (env.ASAAS_URL || ASAAS_SANDBOX).replace(/\/$/, "");
  const buscar = env.ASAAS_FETCH || fetch;

  async function chamar(metodo, caminho, corpo) {
    let resp;
    try {
      resp = await buscar(`${base}${caminho}`, {
        method: metodo,
        headers: {
          "access_token": env.ASAAS_API_KEY,
          "Content-Type": "application/json",
          "User-Agent": "4blade"
        },
        body: corpo ? JSON.stringify(corpo) : undefined
      });
    } catch (e) {
      throw new ErroAsaas("Não foi possível falar com o sistema de pagamento. Tente de novo em alguns minutos.", e?.message);
    }
    const dados = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      const msg = dados?.errors?.[0]?.description;
      // Erro de dado do cliente (ex.: CPF inválido para o Asaas) volta com a explicação deles.
      if (resp.status === 400 && msg) throw new HttpError(`Sistema de pagamento: ${msg}`, 400);
      console.error("Asaas", metodo, caminho, resp.status, msg || "");
      throw new ErroAsaas("O sistema de pagamento não respondeu como esperado. Tente de novo em alguns minutos.", msg);
    }
    return dados;
  }

  return {
    criarCliente: c => chamar("POST", "/customers", {
      name: c.nome, cpfCnpj: c.documento, email: c.email, mobilePhone: c.telefone,
      externalReference: c.barbeariaId, notificationDisabled: false
    }),
    criarAssinatura: a => chamar("POST", "/subscriptions", {
      customer: a.clienteId,
      billingType: "UNDEFINED",          // a pessoa escolhe Pix, boleto ou cartão na tela do Asaas
      value: a.valorCentavos / 100,
      nextDueDate: a.primeiroVencimento,
      cycle: a.ciclo === "anual" ? "YEARLY" : "MONTHLY",
      description: a.descricao,
      externalReference: a.barbeariaId
    }),
    alterarAssinatura: (id, a) => chamar("POST", `/subscriptions/${encodeURIComponent(id)}`, {
      value: a.valorCentavos / 100, cycle: a.ciclo === "anual" ? "YEARLY" : "MONTHLY",
      description: a.descricao, updatePendingPayments: true
    }),
    removerAssinatura: id => chamar("DELETE", `/subscriptions/${encodeURIComponent(id)}`),
    pagamentosDaAssinatura: id => chamar("GET", `/subscriptions/${encodeURIComponent(id)}/payments`),
    buscarPagamento: id => chamar("GET", `/payments/${encodeURIComponent(id)}`)
  };
}
