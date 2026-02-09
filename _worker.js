<!DOCTYPE html>
<html lang="pt-br">
<head>
    <meta charset="UTF-8">
    <title>ADMIN | Canal Sport Pro</title>
    <script src="https://cdn.tailwindcss.com"></script>
</head>
<body class="bg-zinc-950 text-white p-8">
    <div class="max-w-md mx-auto bg-zinc-900 p-6 rounded-xl border border-zinc-800 shadow-2xl">
        <h1 class="text-xl font-bold mb-6 text-green-500 underline uppercase tracking-tighter text-center">Painel de Controle Oficial</h1>
        
        <div class="space-y-5">
            <div>
                <label class="block text-[10px] uppercase font-black text-gray-500 mb-1 tracking-widest">Título da Transmissão</label>
                <input id="titulo" type="text" placeholder="Ex: Final Libertadores" class="w-full bg-black border border-zinc-700 p-3 rounded text-sm focus:border-green-500 outline-none">
            </div>
            
            <div class="grid grid-cols-2 gap-4">
                <div>
                    <label class="block text-[10px] uppercase font-black text-gray-500 mb-1 tracking-widest">Prêmio Atual (R$)</label>
                    <input id="premio" type="text" placeholder="600,00" class="w-full bg-black border border-zinc-700 p-3 rounded text-sm focus:border-green-500 outline-none">
                </div>
                <div>
                    <label class="block text-[10px] uppercase font-black text-gray-500 mb-1 tracking-widest">% da Meta</label>
                    <input id="meta" type="number" placeholder="75" class="w-full bg-black border border-zinc-700 p-3 rounded text-sm focus:border-green-500 outline-none">
                </div>
            </div>

            <button id="btnSalvar" onclick="salvar()" class="w-full bg-green-600 hover:bg-green-700 py-4 rounded font-black uppercase transition-all shadow-lg shadow-green-900/20 active:scale-95">
                Atualizar Site Agora
            </button>
            <p id="status" class="text-center text-xs font-mono text-gray-600"></p>
        </div>
    </div>

    <script>
        async function salvar() {
            const btn = document.getElementById('btnSalvar');
            const status = document.getElementById('status');
            
            const dados = {
                titulo: document.getElementById('titulo').value,
                premio: document.getElementById('premio').value,
                meta: document.getElementById('meta').value
            };

            btn.disabled = true;
            btn.innerText = "ENVIANDO...";
            status.innerText = "Conectando ao banco de dados...";

            try {
                const res = await fetch('/api/update', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(dados)
                });

                if (res.ok) {
                    status.innerText = "SUCESSO! Site atualizado.";
                    status.classList.add('text-green-500');
                } else {
                    throw new Error();
                }
            } catch (err) {
                status.innerText = "ERRO ao salvar. Verifique o Binding.";
                status.classList.add('text-red-500');
            } finally {
                btn.disabled = false;
                btn.innerText = "Atualizar Site Agora";
            }
        }
    </script>
</body>
</html>
