export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // ─── CORS helper ───────────────────────────────────────────────
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
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

    // ─── ASAAS config ──────────────────────────────────────────────
    // Usa a variável de ambiente ASSAS_API_KEY que você já tem configurada
    const ASAAS_KEY = env.ASSAS_API_KEY;
    const ASAAS_BASE = "https://api.asaas.com/v3"; // produção
    // Se for sandbox, troque por: https://sandbox.asaas.com/api/v3

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
    // GET /api/status-leilao  →  retorna acumulado, líder e maior lance
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
        const { valor, nome, telefone } = await request.json();

        if (!valor || !nome) {
          return json({ success: false, error: "Valor e nome são obrigatórios." }, 400);
        }

        // Gera CPF fictício único baseado no timestamp para satisfazer o Asaas
        function gerarCpfFake() {
          const n = () => Math.floor(Math.random() * 9) + 1;
          const nums = [n(),n(),n(),n(),n(),n(),n(),n(),n()];
          // Dígitos verificadores simples
          let s1 = 0, s2 = 0;
          for (let i = 0; i < 9; i++) s1 += nums[i] * (10 - i);
          let d1 = (s1 * 10) % 11; if (d1 === 10 || d1 === 11) d1 = 0;
          nums.push(d1);
          for (let i = 0; i < 10; i++) s2 += nums[i] * (11 - i);
          let d2 = (s2 * 10) % 11; if (d2 === 10 || d2 === 11) d2 = 0;
          nums.push(d2);
          return nums.join('');
        }

        // 1) Cria cliente no Asaas com CPF único
        let customerId = null;
        const cpfUnico = gerarCpfFake();
        const createRes = await fetch(`${ASAAS_BASE}/customers`, {
          method: "POST",
          headers: {
            access_token: ASAAS_KEY,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            name: nome,
            cpfCnpj: cpfUnico,
            externalReference: "leilao-live",
          }),
        });
        const createData = await createRes.json();
        if (!createData.id) {
          // Log do erro real do Asaas para debug
          const erroAsaas = createData.errors?.[0]?.description || JSON.stringify(createData);
          return json({ success: false, error: "Asaas cliente: " + erroAsaas }, 500);
        }
        customerId = createData.id;

        // 2) Cria cobrança PIX
        const cobRes = await fetch(`${ASAAS_BASE}/payments`, {
          method: "POST",
          headers: {
            access_token: ASAAS_KEY,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            customer: customerId,
            billingType: "PIX",
            value: valor,
            dueDate: new Date(Date.now() + 30 * 60 * 1000)
              .toISOString()
              .split("T")[0],
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
          { headers: { access_token: ASAAS_KEY } }
        );
        const qrData = await qrRes.json();

        // 4) Salva lance pendente no KV para verificação posterior
        await env.DB.put(
          `PAGAMENTO_${cobData.id}`,
          JSON.stringify({ nome, valor, status: "PENDING" }),
          { expirationTtl: 3600 } // expira em 1 hora
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
    // ═══════════════════════════════════════════════════════════════
    if (url.pathname === "/api/verificar-liberacao") {
      const paymentId = url.searchParams.get("id");
      if (!paymentId) return json({ liberado: false, error: "ID não informado." }, 400);

      try {
        const res = await fetch(`${ASAAS_BASE}/payments/${paymentId}`, {
          headers: { access_token: ASAAS_KEY },
        });
        const data = await res.json();

        const pago = data.status === "RECEIVED" || data.status === "CONFIRMED";

        if (pago) {
          // Atualiza o leilão com o novo lance
          const raw = await env.DB.get("LEILAO_STATUS");
          const status = raw
            ? JSON.parse(raw)
            : { acumulado: 0, lider: "Ninguém ainda", maiorLance: 0 };

          const lanceRaw = await env.DB.get(`PAGAMENTO_${paymentId}`);
          const lance = lanceRaw ? JSON.parse(lanceRaw) : null;

          if (lance) {
            status.acumulado = +(status.acumulado + lance.valor).toFixed(2);
            if (lance.valor > status.maiorLance) {
              status.maiorLance = lance.valor;
              status.lider = lance.nome;
            }
            await env.DB.put("LEILAO_STATUS", JSON.stringify(status));
            await env.DB.delete(`PAGAMENTO_${paymentId}`);
          }
        }

        return json({ liberado: pago, status: data.status });
      } catch (err) {
        return json({ liberado: false, error: err.message }, 500);
      }
    }

    // ─── Qualquer outra rota → serve arquivos estáticos ────────────
    return env.ASSETS.fetch(request);
  },
};
