// Asaas DE MENTIRA para testes automáticos e para a tela local (nenhum dado sai do computador).
// Guarda clientes, assinaturas e cobranças em memória e responde como a API v3 do Asaas.
export function asaasFalso() {
  const estado = { clientes: new Map(), assinaturas: new Map(), pagamentos: new Map(), chamadas: [], falhar: null, n: 0 };
  const id = pref => `${pref}_${String(++estado.n).padStart(6, "0")}`;
  const resp = (status, corpo) => new Response(JSON.stringify(corpo), { status, headers: { "Content-Type": "application/json" } });

  function novaCobranca(sub, venc) {
    const p = { id: id("pay"), subscription: sub.id, customer: sub.customer, value: sub.value, dueDate: venc,
      status: "PENDING", invoiceUrl: `https://sandbox.asaas.com/i/${id("fat")}` };
    estado.pagamentos.set(p.id, p);
    return p;
  }

  async function buscar(url, init = {}) {
    const u = new URL(url);
    const caminho = u.pathname.replace(/^\/v3/, "");
    const metodo = init.method || "GET";
    const corpo = init.body ? JSON.parse(init.body) : null;
    estado.chamadas.push({ metodo, caminho, corpo, chave: init.headers?.access_token });
    if (estado.falhar) return resp(estado.falhar, { errors: [{ code: "falha", description: "Falha simulada" }] });
    if (!init.headers?.access_token) return resp(401, {});

    if (metodo === "POST" && caminho === "/customers") {
      const c = { id: id("cus"), ...corpo };
      estado.clientes.set(c.id, c);
      return resp(200, c);
    }
    if (metodo === "POST" && caminho === "/subscriptions") {
      if (!estado.clientes.has(corpo.customer)) return resp(400, { errors: [{ description: "Cliente inexistente" }] });
      const s = { id: id("sub"), status: "ACTIVE", ...corpo };
      estado.assinaturas.set(s.id, s);
      novaCobranca(s, corpo.nextDueDate);
      return resp(200, s);
    }
    let m = caminho.match(/^\/subscriptions\/([^/]+)$/);
    if (m && metodo === "POST") {
      const s = estado.assinaturas.get(m[1]);
      if (!s) return resp(404, {});
      Object.assign(s, { value: corpo.value, cycle: corpo.cycle, description: corpo.description });
      return resp(200, s);
    }
    if (m && metodo === "DELETE") {
      const s = estado.assinaturas.get(m[1]);
      if (!s) return resp(404, {});
      s.status = "INACTIVE"; s.deleted = true;
      return resp(200, { deleted: true, id: s.id });
    }
    m = caminho.match(/^\/subscriptions\/([^/]+)\/payments$/);
    if (m && metodo === "GET") {
      return resp(200, { data: [...estado.pagamentos.values()].filter(p => p.subscription === m[1]) });
    }
    m = caminho.match(/^\/payments\/([^/]+)$/);
    if (m && metodo === "GET") {
      const p = estado.pagamentos.get(m[1]);
      return p ? resp(200, p) : resp(404, {});
    }
    return resp(404, { errors: [{ description: `rota falsa desconhecida ${metodo} ${caminho}` }] });
  }

  // Simula o cliente pagando a cobrança em aberto: muda a situação e devolve o aviso (webhook) que o Asaas mandaria.
  function pagar(subId, evento = "PAYMENT_RECEIVED") {
    const p = [...estado.pagamentos.values()].find(x => x.subscription === subId && x.status === "PENDING");
    p.status = evento === "PAYMENT_CONFIRMED" ? "CONFIRMED" : "RECEIVED";
    const s = estado.assinaturas.get(subId);
    const [a, mes, d] = p.dueDate.split("-").map(Number);
    const prox = new Date(Date.UTC(a, mes - 1 + (s.cycle === "YEARLY" ? 12 : 1), d, 12)).toISOString().slice(0, 10);
    const nova = novaCobranca(s, prox);
    return {
      pago: { id: id("evt"), event: evento, payment: { ...p } },
      criada: { id: id("evt"), event: "PAYMENT_CREATED", payment: { ...nova } }
    };
  }

  return { buscar, estado, pagar };
}
