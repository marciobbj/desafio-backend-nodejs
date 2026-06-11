import type { FastifyInstance } from "fastify";
import { db } from "../../db/client.js";
import { config } from "../../lib/config.js";
import { logger } from "../../lib/logger.js";
import {
  markMessageStatus,
  persistInboundMessage,
} from "../../modules/conversations/conversation-service.js";
import { enqueueInboundMessage } from "../../modules/queue/queue.js";
import { resolveTenantByPhoneNumberId } from "../../modules/tenants/tenant-service.js";
import { parseInboundMessage } from "../../modules/webhook/meta-payload.js";
import { shouldEnqueueInboundMessage } from "../../modules/webhook/inbound-status.js";
import { isValidMetaSignature } from "../../modules/webhook/signature.js";

export async function registerWebhookRoutes(app: FastifyInstance) {
  app.get("/webhook", async (request, reply) => {
    const query = request.query as {
      "hub.mode"?: string;
      "hub.verify_token"?: string;
      "hub.challenge"?: string;
    };

    if (query["hub.mode"] === "subscribe" && query["hub.verify_token"] === config.META_VERIFY_TOKEN) {
      return reply.type("text/plain").send(query["hub.challenge"] ?? "");
    }

    return reply.code(403).send({ error: "Invalid verify token" });
  });

  app.post("/webhook", async (request, reply) => {
    const rawBody = request.rawBody;
    if (!rawBody) {
      return reply.code(400).send({ error: "Missing raw body" });
    }

    const signature = request.headers["x-hub-signature-256"];
    const signatureValue = Array.isArray(signature) ? signature[0] : signature;

    if (!isValidMetaSignature(rawBody, config.META_APP_SECRET, signatureValue)) {
      logger.warn({ signature: signatureValue }, "Rejected webhook with invalid signature");
      return reply.code(401).send({ error: "Invalid signature" });
    }

    const inbound = parseInboundMessage(request.body);
    if (!inbound) {
      return reply.send({ received: true, ignored: true });
    }

    const channel = await resolveTenantByPhoneNumberId(db, inbound.phoneNumberId);
    if (!channel) {
      logger.warn({ phoneNumberId: inbound.phoneNumberId }, "Webhook received for unknown channel");
      return reply.code(404).send({ error: "Unknown WhatsApp channel" });
    }

    const result = await persistInboundMessage(db, {
      tenantId: channel.tenantId,
      waId: inbound.waId,
      contactName: inbound.contactName,
      waMessageId: inbound.waMessageId,
      body: inbound.body,
      timestamp: inbound.timestamp,
      providerPayload: request.body,
    });

    const shouldEnqueue = shouldEnqueueInboundMessage({
      inserted: result.inserted,
      status: result.message.status,
    });

    if (shouldEnqueue) {
      await enqueueInboundMessage({
        tenantId: channel.tenantId,
        conversationId: result.conversation.id,
        inboundMessageId: result.message.id,
        waMessageId: inbound.waMessageId,
      });
      await markMessageStatus(db, result.message.id, "enqueued");

      logger.info(
        {
          tenantId: channel.tenantId,
          conversationId: result.conversation.id,
          waMessageId: inbound.waMessageId,
        },
        "Inbound message persisted and enqueued",
      );
    } else {
      logger.info(
        { tenantId: channel.tenantId, waMessageId: inbound.waMessageId, status: result.message.status },
        "Duplicate inbound message ignored",
      );
    }

    return reply.send({ received: true, duplicate: !result.inserted, enqueued: shouldEnqueue });
  });
}
