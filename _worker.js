export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Rota para salvar os dados (POST)
    if (request.method === "POST" && url.pathname === "/api/update") {
      const data = await request.json();
      await env.DB.put("SESSAO_LIVE", JSON.stringify(data));
      return new Response("OK", { status: 200 });
    }

    // Rota para buscar os dados (GET)
    if (url.pathname === "/api/data") {
      const value = await env.DB.get("SESSAO_LIVE");
      return new Response(value || "{}", {
        headers: { "content-type": "application/json" }
      });
    }

    // Deixa o Cloudflare Pages servir os arquivos HTML normalmente
    return env.ASSETS.fetch(request);
  }
};
