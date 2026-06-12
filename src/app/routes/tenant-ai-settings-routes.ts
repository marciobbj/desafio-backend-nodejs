import type { FastifyInstance } from "fastify";
import { db } from "../../db/client.js";
import { getAuthClaims } from "../../modules/auth/jwt.js";
import {
  getTenantAiSettings,
  InvalidSystemPromptTemplateError,
  updateTenantAiSettings,
  updateTenantAiSettingsSchema,
} from "../../modules/ai/tenant-ai-settings.js";

export async function registerTenantAiSettingsRoutes(app: FastifyInstance) {
  app.get("/tenant/ai-settings", async (request) => {
    const claims = await getAuthClaims(request);
    return getTenantAiSettings(db, claims.tenantId);
  });

  app.patch("/tenant/ai-settings", async (request, reply) => {
    const claims = await getAuthClaims(request);
    const parsedBody = updateTenantAiSettingsSchema.safeParse(request.body ?? {});

    if (!parsedBody.success) {
      return reply.code(400).send({
        error: "Invalid AI settings payload",
        issues: parsedBody.error.issues,
      });
    }

    try {
      return await updateTenantAiSettings(db, claims.tenantId, parsedBody.data);
    } catch (err) {
      if (err instanceof InvalidSystemPromptTemplateError) {
        return reply.code(400).send({
          error: "Invalid system prompt template",
          detail: "Use only supported LangChain variables: {tenantName} and {context}.",
        });
      }

      throw err;
    }
  });
}
