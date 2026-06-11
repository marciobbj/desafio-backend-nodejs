import { createServer } from "node:http";
import { createHmac, randomUUID } from "node:crypto";

/**
 * Mock da Meta WhatsApp Cloud API para o desafio de backend.
 *
 * Endpoints:
 *   GET  /health                         → status
 *   POST /simulate/inbound               → injeta uma mensagem "do cliente": monta o payload
 *                                          no formato da Meta, ASSINA (HMAC-SHA256) e entrega
 *                                          no webhook do candidato (CANDIDATE_WEBHOOK_URL).
 *                                          body: { from, text, name?, id? }
 *                                          (reenviar com o mesmo "id" simula a reentrega da Meta)
 *   POST /:phoneNumberId/messages        → recebe os envios de SAÍDA do candidato e os registra
 *                                          (mesma forma da API real da Meta).
 *   GET  /sent                           → lista os envios recebidos (debug).
 */

const PORT = Number(process.env.PORT ?? 8001);
const APP_SECRET = process.env.META_APP_SECRET ?? "super-secret-app-secret-trocar";
const WEBHOOK_URL = process.env.CANDIDATE_WEBHOOK_URL ?? "http://host.docker.internal:8000/webhook";

/** Memória dos envios recebidos, para inspeção via GET /sent. */
const sent = [];

function readBody(req) {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => resolve(data));
  });
}

function json(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { "content-type": "application/json" });
  res.end(body);
}

function sign(rawBody) {
  return "sha256=" + createHmac("sha256", APP_SECRET).update(rawBody).digest("hex");
}

async function deliverInbound({ from, text, name, id }) {
  const messageId = id ?? `wamid.${randomUUID()}`;
  const payload = {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "WABA_TESTE_0001",
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: {
                display_phone_number: "15550000000",
                phone_number_id: "123456789012345",
              },
              contacts: [{ profile: { name: name ?? "Cliente Teste" }, wa_id: from }],
              messages: [
                {
                  from,
                  id: messageId,
                  timestamp: String(Math.floor(Date.now() / 1000)),
                  type: "text",
                  text: { body: text },
                },
              ],
            },
          },
        ],
      },
    ],
  };

  // A assinatura é calculada sobre o CORPO CRU exatamente como enviado.
  const rawBody = JSON.stringify(payload);
  const signature = sign(rawBody);

  const resp = await fetch(WEBHOOK_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-hub-signature-256": signature,
    },
    body: rawBody,
  });

  return { messageId, status: resp.status, signature };
}

const server = createServer(async (req, res) => {
  const { method, url } = req;

  if (method === "GET" && url === "/health") {
    return json(res, 200, { ok: true, service: "mock-meta", webhook: WEBHOOK_URL });
  }

  if (method === "GET" && url === "/sent") {
    return json(res, 200, { count: sent.length, sent });
  }

  if (method === "POST" && url === "/simulate/inbound") {
    const raw = await readBody(req);
    let body;
    try {
      body = JSON.parse(raw || "{}");
    } catch {
      return json(res, 400, { error: "JSON inválido" });
    }
    if (!body.from || !body.text) {
      return json(res, 400, { error: "Campos obrigatórios: from, text" });
    }
    try {
      const result = await deliverInbound(body);
      console.log(`[inbound] entregue ${result.messageId} → ${WEBHOOK_URL} (HTTP ${result.status})`);
      return json(res, 200, { delivered: true, ...result });
    } catch (err) {
      console.error("[inbound] falha ao entregar webhook:", err.message);
      return json(res, 502, {
        delivered: false,
        error: "Não consegui entregar no seu webhook. Seu backend está rodando na porta 8000?",
        detail: err.message,
      });
    }
  }

  // POST /:phoneNumberId/messages  → recebe os envios de saída do candidato.
  if (method === "POST" && /^\/\d+\/messages\/?$/.test(url ?? "")) {
    const raw = await readBody(req);
    let body;
    try {
      body = JSON.parse(raw || "{}");
    } catch {
      return json(res, 400, { error: "JSON inválido" });
    }
    const record = {
      receivedAt: new Date().toISOString(),
      phoneNumberId: url.split("/")[1],
      to: body.to,
      type: body.type,
      text: body.text?.body,
      authorization: req.headers["authorization"] ? "present" : "missing",
    };
    sent.push(record);
    console.log(`[outbound] recebido envio para ${record.to}: "${record.text ?? ""}"`);
    // Mesma forma da resposta real da Meta.
    return json(res, 200, {
      messaging_product: "whatsapp",
      contacts: [{ input: body.to, wa_id: body.to }],
      messages: [{ id: `wamid.${randomUUID()}` }],
    });
  }

  json(res, 404, { error: "rota não encontrada", method, url });
});

server.listen(PORT, () => {
  console.log(`mock-meta ouvindo na porta ${PORT}`);
  console.log(`  → entregando webhooks em: ${WEBHOOK_URL}`);
});
