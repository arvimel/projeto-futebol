export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "POST" && url.pathname === "/api/update") {
      try {
        const data = await request.json();
        await env.DB.put("SESSAO_LIVE", JSON.stringify(data));
        return new Response("OK", { status: 200 });
      } catch (e) {
        return new Response("Erro: " + e.message, { status: 500 });
      }
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
