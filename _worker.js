export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, x-webhook-token",
    };
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    function json(data, status = 200) {
      return new Response(JSON.stringify(data), {
        status,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    const ASAAS_KEY = env.ASSAS_API_KEY;
    const ASAAS_BASE = "https://api.asaas.com/v3";
    const ASAAS_HEADERS = {
      "access_token": ASAAS_KEY,
      "Content-Type": "application/json",
      "User-Agent": "projeto-futebol/1.0",
    };
    const VALOR_MINIMO = 5.00;

    // ═══════════════════════════════════════════════════════════════
    // POST /api/update  →  salva dados da sessão (admin)
    // ═══════════════════════════════════════════════════════════════
    if (request.method === "POST" && url.pathname === "/api/update") {
      const data = await request.json();
      await env.DB.put("SESSAO_LIVE", JSON.stringify(data));
      return new Response("OK", { status: 200, headers: corsHeaders });
    }

    // ═══════════════════════════════════════════════════════════════
    // GET /api/data  →  retorna dados da sessão
    // ═══════════════════════════════════════════════════════════════
    if (url.pathname === "/api/data") {
      const value = await env.DB.get("SESSAO_LIVE");
      return new Response(value || "{}", {
        headers: { "content-type": "application/json", ...corsHeaders },
      });
    }

    // ═══════════════════════════════════════════════════════════════
    // GET /api/status-leilao  →  acumulado + líder + maior lance
    // ═══════════════════════════════════════════════════════════════
    if (url.pathname === "/api/status-leilao") {
      const raw = await env.DB.get("LEILAO_STATUS");
      const status = raw
        ? JSON.parse(raw)
        : { acumulado: 0, lider: "Ninguém ainda", maiorLance: 0 };
      return json(status);
    }

    // ═══════════════════════════════════════════════════════════════
    // POST /api/criar-pix  →  cria cobrança PIX no Asaas
    // ═══════════════════════════════════════════════════════════════
    if (request.method === "POST" && url.pathname === "/api/criar-pix") {
      try {
        const { valor, nome } = await request.json();

        if (!valor || !nome) {
          return json({ success: false, error: "Valor e nome são obrigatórios." }, 400);
        }

        // Validação do valor mínimo
        if (parseFloat(valor) < VALOR_MINIMO) {
          return json({ success: false, error: `O lance mínimo é R$ ${VALOR_MINIMO.toFixed(2)}.` }, 400);
        }

        // Gera CPF válido único para cada cliente
        function gerarCpfFake() {
          const n = () => Math.floor(Math.random() * 9) + 1;
          const nums = [n(),n(),n(),n(),n(),n(),n(),n(),n()];
          let s1 = 0, s2 = 0;
          for (let i = 0; i < 9; i++) s1 += nums[i] * (10 - i);
          let d1 = (s1 * 10) % 11; if (d1 === 10 || d1 === 11) d1 = 0;
          nums.push(d1);
          for (let i = 0; i < 10; i++) s2 += nums[i] * (11 - i);
          let d2 = (s2 * 10) % 11; if (d2 === 10 || d2 === 11) d2 = 0;
          nums.push(d2);
          return nums.join('');
        }

        // 1) Cria cliente no Asaas
        const createRes = await fetch(`${ASAAS_BASE}/customers`, {
          method: "POST",
          headers: ASAAS_HEADERS,
          body: JSON.stringify({
            name: nome,
            cpfCnpj: gerarCpfFake(),
            externalReference: "leilao-live",
          }),
        });
        const createData = await createRes.json();
        if (!createData.id) {
          const erroAsaas = createData.errors?.[0]?.description || JSON.stringify(createData);
          return json({ success: false, error: "Asaas cliente: " + erroAsaas }, 500);
        }

        // 2) Cria cobrança PIX
        const cobRes = await fetch(`${ASAAS_BASE}/payments`, {
          method: "POST",
          headers: ASAAS_HEADERS,
          body: JSON.stringify({
            customer: createData.id,
            billingType: "PIX",
            value: parseFloat(valor),
            dueDate: new Date(Date.now() + 30 * 60 * 1000).toISOString().split("T")[0],
            description: `Lance leilão - ${nome}`,
          }),
        });
        const cobData = await cobRes.json();

        if (!cobData.id) {
          return json({ success: false, error: cobData.errors?.[0]?.description || "Erro ao criar cobrança." }, 500);
        }

        // 3) Busca QR Code PIX
        const qrRes = await fetch(
          `${ASAAS_BASE}/payments/${cobData.id}/pixQrCode`,
          { headers: ASAAS_HEADERS }
        );
        const qrData = await qrRes.json();

        // 4) Salva lance pendente no KV (expira em 2h)
        await env.DB.put(
          `PAGAMENTO_${cobData.id}`,
          JSON.stringify({ nome, valor: parseFloat(valor), status: "PENDING" }),
          { expirationTtl: 7200 }
        );

        return json({
          success: true,
          paymentId: cobData.id,
          encodedImage: qrData.encodedImage,
          payload: qrData.payload,
        });
      } catch (err) {
        return json({ success: false, error: "Erro interno: " + err.message }, 500);
      }
    }

    // ═══════════════════════════════════════════════════════════════
    // GET /api/verificar-liberacao?id=XXX  →  checa se PIX foi pago
    // (polling do frontend a cada 3s enquanto aguarda pagamento)
    // ═══════════════════════════════════════════════════════════════
    if (url.pathname === "/api/verificar-liberacao") {
      const paymentId = url.searchParams.get("id");
      if (!paymentId) return json({ liberado: false, error: "ID não informado." }, 400);

      try {
        const res = await fetch(`${ASAAS_BASE}/payments/${paymentId}`, {
          headers: ASAAS_HEADERS,
        });
        const data = await res.json();

        const pago = data.status === "RECEIVED" || data.status === "CONFIRMED";

        if (pago) {
          await atualizarLeilao(env, paymentId);
        }

        return json({ liberado: pago, status: data.status });
      } catch (err) {
        return json({ liberado: false, error: err.message }, 500);
      }
    }

    // ═══════════════════════════════════════════════════════════════
    // POST /api/webhook-asaas  →  Asaas avisa automaticamente quando pago
    // Configure no painel Asaas: URL = https://projeto-futebol.pages.dev/api/webhook-asaas
    // Eventos: PAYMENT_RECEIVED e PAYMENT_CONFIRMED
    // ═══════════════════════════════════════════════════════════════
    if (request.method === "POST" && url.pathname === "/api/webhook-asaas") {
      try {
        // Valida token do webhook (opcional mas recomendado)
        const tokenRecebido = request.headers.get("asaas-access-token") || "";
        const tokenEsperado = env.ASAAS_WEBHOOK_TOKEN || "";
        if (tokenEsperado && tokenRecebido !== tokenEsperado) {
          return new Response("Unauthorized", { status: 401 });
        }

        const body = await request.json();
        const evento = body.event;
        const payment = body.payment;

        if (
          (evento === "PAYMENT_RECEIVED" || evento === "PAYMENT_CONFIRMED") &&
          payment?.id
        ) {
          await atualizarLeilao(env, payment.id);
        }

        return new Response("OK", { status: 200 });
      } catch (err) {
        return new Response("Erro: " + err.message, { status: 500 });
      }
    }

    return env.ASSETS.fetch(request);
  },
};

// ─── Função compartilhada: atualiza prêmio acumulado + líder ──────
async function atualizarLeilao(env, paymentId) {
  const lanceRaw = await env.DB.get(`PAGAMENTO_${paymentId}`);
  if (!lanceRaw) return; // já processado ou não existe

  const lance = JSON.parse(lanceRaw);
  if (lance.status === "PAGO") return; // evita duplicação

  const raw = await env.DB.get("LEILAO_STATUS");
  const status = raw
    ? JSON.parse(raw)
    : { acumulado: 0, lider: "Ninguém ainda", maiorLance: 0 };

  status.acumulado = +(status.acumulado + lance.valor).toFixed(2);

  if (lance.valor > status.maiorLance) {
    status.maiorLance = lance.valor;
    status.lider = lance.nome;
  }

  await env.DB.put("LEILAO_STATUS", JSON.stringify(status));

  // Marca como pago para não processar duas vezes
  lance.status = "PAGO";
  await env.DB.put(`PAGAMENTO_${paymentId}`, JSON.stringify(lance), { expirationTtl: 300 });
}
