import "dotenv/config";

/**
 * Ponto de entrada do SEU backend (HTTP).
 *
 * Aqui é onde você sobe o servidor (Express/Fastify/Hono/etc.) e registra as rotas:
 *
 *   GET  /webhook                      → handshake de verificação da Meta (hub.challenge)
 *   POST /webhook                      → recebimento de mensagens (valide X-Hub-Signature-256!)
 *   GET  /conversations                → lista conversas do tenant autenticado
 *   GET  /conversations/:id/messages   → mensagens de uma conversa
 *
 * Dicas importantes:
 *  - Para validar a assinatura você precisa do CORPO CRU (raw body). Configure seu framework
 *    para preservar o buffer original antes de parsear o JSON.
 *  - O handler do POST /webhook deve responder 200 RÁPIDO e delegar o processamento pesado
 *    (chamada à OpenAI + envio) para um worker via fila. Veja src/worker.ts.
 *
 * Esta é uma estrutura sugerida — sinta-se livre para reorganizar.
 */

const port = Number(process.env.PORT ?? 8000);

async function main() {
  // TODO: inicialize banco, fila e servidor HTTP aqui.
  console.log(`[setup] implemente o servidor e escute na porta ${port}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
