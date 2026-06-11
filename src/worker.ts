import "dotenv/config";

/**
 * Worker que consome a fila e processa cada mensagem recebida.
 *
 * Fluxo sugerido por job:
 *   1. Carregar a conversa e o histórico de mensagens.
 *   2. Recuperar contexto relevante da knowledge-base/ (RAG simples ou contexto direto).
 *   3. Chamar a OpenAI (com system prompt + histórico + contexto).
 *   4. Persistir a resposta (mensagem outbound).
 *   5. Enviar a resposta via Meta API (mock):
 *        POST {META_API_BASE_URL}/{META_PHONE_NUMBER_ID}/messages
 *        Authorization: Bearer {META_TOKEN}
 *
 * Pense em: retry/backoff, idempotência, e o que acontece se a OpenAI ou o envio falharem.
 */

async function main() {
  // TODO: conecte-se à fila (BullMQ/Redis ou SQS) e processe os jobs.
  console.log("[setup] implemente o worker de processamento");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
