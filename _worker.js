export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Rota para o Admin salvar novos dados no KV
    if (request.method === "POST" && url.pathname === "/api/update") {
      const data = await request.json();
      await env.DB.put("SESSAO_LIVE", JSON.stringify(data));
      return new Response("OK", { status: 200 });
    }

    // Rota para o site buscar os dados do KV
    if (url.pathname === "/api/data") {
      const value = await env.DB.get("SESSAO_LIVE");
      return new Response(value || "{}", {
        headers: { "content-type": "application/json" }
      });
    }

    // Mantém o funcionamento normal das páginas HTML
    return env.ASSETS.fetch(request);
  }
};
