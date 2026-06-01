// _worker.js
export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS, DELETE",
      "Access-Control-Allow-Headers": "Content-Type, x-webhook-token, x-admin-senha",
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

    const userAgent = request.headers.get("User-Agent") || "";
    const rotasProtegidas = ["/api/criar-pix", "/api/usar-token", "/api/webhook-asaas"];

    if (rotasProtegidas.includes(url.pathname)) {
      const botsConhecidos = ["curl", "wget", "python-requests", "go-http", "scrapy", "httpclient"];
      if (botsConhecidos.some(bot => userAgent.toLowerCase().includes(bot))) {
        return new Response("Forbidden", { status: 403 });
      }
      const origin = request.headers.get("Origin") || "";
      const referer = request.headers.get("Referer") || "";
      const dominioPermitido = env.DOMINIO_PERMITIDO || "";
      if (dominioPermitido && !origin.includes(dominioPermitido) && !referer.includes(dominioPermitido)) {
        return new Response("Forbidden", { status: 403 });
      }
    }

    // ═══════════════════════════════════════════════════════════════
    // MÍDIA API (Upload e Servir Arquivos Base64)
    // ═══════════════════════════════════════════════════════════════
    if (request.method === "GET" && url.pathname.startsWith("/api/media/")) {
      const id = url.pathname.replace("/api/media/", "");
      const data = await env.DB.get("MEDIA_" + id);
      if (!data) return new Response("Not found", { status: 404 });
      try {
          const parsed = JSON.parse(data);
          const binary = Uint8Array.from(atob(parsed.base64), c => c.charCodeAt(0));
          return new Response(binary, {
              headers: { 
                  "Content-Type": parsed.mime, 
                  "Cache-Control": "public, max-age=60" 
              }
          });
      } catch(e) {
          return new Response("Error parsing media", { status: 500 });
      }
    }

    if (request.method === "POST" && url.pathname.startsWith("/api/media/")) {
      const senhaHeader = request.headers.get("x-admin-senha");
      if (senhaHeader !== "23100311") return new Response("Unauthorized", { status: 401 });
      const id = url.pathname.replace("/api/media/", "");
      const { mime, base64, ts } = await request.json();
      await env.DB.put("MEDIA_" + id, JSON.stringify({ mime, base64, ts }));
      return json({ success: true });
    }

    if (request.method === "DELETE" && url.pathname.startsWith("/api/media/")) {
       const senhaHeader = request.headers.get("x-admin-senha");
       if (senhaHeader !== "23100311") return new Response("Unauthorized", { status: 401 });
       const id = url.pathname.replace("/api/media/", "");
       await env.DB.delete("MEDIA_" + id);
       return json({ success: true });
    }

    // ═══════════════════════════════════════════════════════════════
    // POST /api/update  →  salva dados da sessão (admin)
    // ═══════════════════════════════════════════════════════════════
    if (request.method === "POST" && url.pathname === "/api/update") {
      const senhaHeader = request.headers.get("x-admin-senha");
      if (senhaHeader !== "23100311") {
        return new Response("Unauthorized", { status: 401 });
      }
      const data = await request.json();
      await env.DB.put("SESSAO_LIVE", JSON.stringify(data));
      return new Response("OK", { status: 200, headers: corsHeaders });
    }

    if (url.pathname === "/api/data") {
      const value = await env.DB.get("SESSAO_LIVE");
      return new Response(value || "{}", {
        headers: { "content-type": "application/json", ...corsHeaders },
      });
    }

    if (url.pathname === "/api/status-leilao") {
      const raw = await env.DB.get("LEILAO_STATUS");
      const status = raw
        ? JSON.parse(raw)
        : { acumulado: 0, lider: "Ninguém ainda", maiorLance: 0 };
      return json(status);
    }

    if (request.method === "GET" && url.pathname === "/api/chat") {
      const raw = await env.DB.get("CHAT_MENSAGENS");
      const msgs = raw ? JSON.parse(raw) : [];
      return json(msgs);
    }

    if (request.method === "POST" && url.pathname === "/api/chat") {
      try {
        const { nome, mensagem, tipo } = await request.json();
        if (!nome || !mensagem) return json({ success: false, error: "Campos obrigatórios." }, 400);

        const ip = request.headers.get("CF-Connecting-IP") || "unknown";
        const rlChatKey = `RATELIMIT_CHAT_${ip}`;
        const rlChatRaw = await env.DB.get(rlChatKey);
        const rlChat = rlChatRaw ? JSON.parse(rlChatRaw) : { count: 0, inicio: Date.now() };
        if (Date.now() - rlChat.inicio > 60000) { rlChat.count = 0; rlChat.inicio = Date.now(); }
        rlChat.count++;
        await env.DB.put(rlChatKey, JSON.stringify(rlChat), { expirationTtl: 120 });
        if (rlChat.count > 10) {
          return json({ success: false, error: "Muitas mensagens. Aguarde um momento." }, 429);
        }

        const raw = await env.DB.get("CHAT_MENSAGENS");
        const msgs = raw ? JSON.parse(raw) : [];

        msgs.push({
          id: Date.now(),
          nome: nome.trim().substring(0, 30),
          mensagem: mensagem.trim().substring(0, 300),
          tipo: tipo || "user",
          ts: Date.now(),
        });

        const recentes = msgs.slice(-80);
        await env.DB.put("CHAT_MENSAGENS", JSON.stringify(recentes));

        return json({ success: true });
      } catch (err) {
        return json({ success: false, error: err.message }, 500);
      }
    }

    if (request.method === "POST" && url.pathname === "/api/limpar-chat") {
      const senhaHeader = request.headers.get("x-admin-senha");
      if (senhaHeader !== "23100311") {
        return new Response("Unauthorized", { status: 401 });
      }
      await env.DB.put("CHAT_MENSAGENS", JSON.stringify([]));
      return json({ success: true });
    }

    if (request.method === "POST" && url.pathname === "/api/gerar-token") {
      const senhaHeader = request.headers.get("x-admin-senha");
      if (senhaHeader !== "23100311") {
        return new Response("Unauthorized", { status: 401 });
      }
      const { identificacao } = await request.json();

      const array = new Uint8Array(32);
      crypto.getRandomValues(array);
      const token = Array.from(array).map(b => b.toString(16).padStart(2, '0')).join('');

      await env.DB.put(
        `TOKEN_ACESSO_${token}`,
        JSON.stringify({
          identificacao,
          fingerprint: null,
          criadoEm: Date.now(),
        }),
        { expirationTtl: 6000 }
      );

      return json({ success: true, token });
    }

    if (request.method === "POST" && url.pathname === "/api/usar-token") {
      const ip = request.headers.get("CF-Connecting-IP") || "unknown";
      const rlKey = `RATELIMIT_TOKEN_${ip}`;
      const rlRaw = await env.DB.get(rlKey);
      const rl = rlRaw ? JSON.parse(rlRaw) : { count: 0, inicio: Date.now() };
      if (Date.now() - rl.inicio > 3600000) { rl.count = 0; rl.inicio = Date.now(); }
      rl.count++;
      await env.DB.put(rlKey, JSON.stringify(rl), { expirationTtl: 3600 });
      if (rl.count > 5) {
        return json({ success: false, error: "Muitas tentativas. Tente em 1 hora." }, 429);
      }

      const { token, fingerprint } = await request.json();
      if (!token || !fingerprint) {
        return json({ success: false, error: "Dados inválidos." }, 400);
      }

      const raw = await env.DB.get(`TOKEN_ACESSO_${token}`);
      if (!raw) {
        return json({ success: false, error: "Link inválido ou expirado (100 min)." }, 403);
      }

      const dados = JSON.parse(raw);

      if (!dados.fingerprint) {
        dados.fingerprint = fingerprint;
        await env.DB.put(
          `TOKEN_ACESSO_${token}`,
          JSON.stringify(dados),
          { expirationTtl: 6000 }
        );
        return json({ success: true, mensagem: "Acesso liberado!" });
      }

      if (dados.fingerprint !== fingerprint) {
        return json({ success: false, error: "Este link só funciona no dispositivo que o ativou pela primeira vez." }, 403);
      }

      return json({ success: true, mensagem: "Acesso confirmado!" });
    }

    if (request.method === "POST" && url.pathname === "/api/criar-pix") {
      try {
        const { valor, nome } = await request.json();

        if (!valor || !nome) {
          return json({ success: false, error: "Valor e nome são obrigatórios." }, 400);
        }

        if (parseFloat(valor) < VALOR_MINIMO) {
          return json({ success: false, error: `O lance mínimo é R$ ${VALOR_MINIMO.toFixed(2)}.` }, 400);
        }

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

        const qrRes = await fetch(
          `${ASAAS_BASE}/payments/${cobData.id}/pixQrCode`,
          { headers: ASAAS_HEADERS }
        );
        const qrData = await qrRes.json();

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

    if (request.method === "POST" && url.pathname === "/api/webhook-asaas") {
      try {
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

    if (request.method === "POST" && url.pathname === "/api/zerar-leilao") {
      const senhaHeader = request.headers.get("x-admin-senha");
      if (senhaHeader !== "23100311") {
        return new Response("Unauthorized", { status: 401 });
      }
      const novoEpoch = Date.now();
      await env.DB.put("LEILAO_STATUS", JSON.stringify({
        acumulado: 0,
        lider: "Ninguém ainda",
        maiorLance: 0,
        epoch: novoEpoch
      }));
      return json({ success: true, epoch: novoEpoch });
    }

    if (request.method === "POST" && url.pathname === "/api/contato-assistir") {
      try {
        const { contato } = await request.json();
        if (!contato) return json({ success: false }, 400);
        const raw = await env.DB.get("CONTATOS_ASSISTIR");
        const lista = raw ? JSON.parse(raw) : [];
        const jaExiste = lista.some(c => c.contato === contato);
        if (!jaExiste) {
          lista.push({ contato, ts: Date.now() });
          await env.DB.put("CONTATOS_ASSISTIR", JSON.stringify(lista.slice(-50)));
        }
        return json({ success: true });
      } catch(e) { return json({ success: false, error: e.message }, 500); }
    }

    if (url.pathname === "/api/contatos-assistir") {
      const raw = await env.DB.get("CONTATOS_ASSISTIR");
      const contatos = raw ? JSON.parse(raw) : [];
      return json({ contatos });
    }

    if (request.method === "POST" && url.pathname === "/api/limpar-contatos") {
      const senhaH = request.headers.get("x-admin-senha");
      if (senhaH !== "23100311") return new Response("Unauthorized", { status: 401 });
      await env.DB.put("CONTATOS_ASSISTIR", JSON.stringify([]));
      return json({ success: true });
    }

    return env.ASSETS.fetch(request);
  },
};

async function atualizarLeilao(env, paymentId) {
  const lanceRaw = await env.DB.get(`PAGAMENTO_${paymentId}`);
  if (!lanceRaw) return;

  const lance = JSON.parse(lanceRaw);
  if (lance.status === "PAGO") return;

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

  lance.status = "PAGO";
  await env.DB.put(`PAGAMENTO_${paymentId}`, JSON.stringify(lance), { expirationTtl: 300 });
}
