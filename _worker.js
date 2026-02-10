export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "POST" && url.pathname === "/api/update") {
      const data = await request.json();
      // Salva tudo o que vier do Admin no banco KV
      await env.DB.put("SESSAO_LIVE", JSON.stringify(data));
      return new Response("OK", { status: 200 });
    }

    if (url.pathname === "/api/data") {
      const value = await env.DB.get("SESSAO_LIVE");
      return new Response(value || "{}", {
        headers: { "content-type": "application/json" }
      });
    }

    return env.ASSETS.fetch(request);
  }
};
