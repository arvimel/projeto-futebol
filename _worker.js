export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Rota para o Admin salvar novos dados no KV
    if (request.method === "POST" && url.pathname === "/api/update") {
      try {
        const data = await request.json();
        // Aqui usamos o binding 'DB' que você configurou na Cloudflare
        await env.DB.put("SESSAO_LIVE", JSON.stringify(data));
        return new Response("OK", { status: 200 });
      } catch (e) {
        return new Response("Erro no Worker: " + e.message, { status: 500 });
      }
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
