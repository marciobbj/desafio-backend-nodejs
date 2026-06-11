import type { FastifyInstance } from "fastify";
import { db } from "../../db/client.js";
import { getAuthClaims } from "../../modules/auth/jwt.js";
import {
  listConversationMessages,
  listConversations,
} from "../../modules/conversations/conversation-service.js";

export async function registerConversationRoutes(app: FastifyInstance) {
  app.get("/conversations", async (request) => {
    const claims = await getAuthClaims(request);
    return listConversations(db, claims.tenantId);
  });

  app.get("/conversations/:id/messages", async (request) => {
    const claims = await getAuthClaims(request);
    const params = request.params as { id: string };

    return listConversationMessages(db, {
      tenantId: claims.tenantId,
      conversationId: params.id,
    });
  });
}
