import jwt from "@fastify/jwt";
import Fastify from "fastify";
import fastifyRawBody from "fastify-raw-body";
import { db } from "../db/client.js";
import { config } from "../lib/config.js";
import { logger } from "../lib/logger.js";
import { ensureDefaultTenant } from "../modules/tenants/tenant-service.js";
import { registerConversationRoutes } from "./routes/conversation-routes.js";
import { registerTenantAiSettingsRoutes } from "./routes/tenant-ai-settings-routes.js";
import { registerWebhookRoutes } from "./routes/webhook-routes.js";

export async function buildServer() {
  const app = Fastify({ logger: false });

  app.setErrorHandler((error: unknown, request, reply) => {
    const normalizedError =
      error instanceof Error ? error : new Error(typeof error === "string" ? error : "Unknown error");
    const statusCode =
      typeof (error as { statusCode?: unknown }).statusCode === "number"
        ? (error as { statusCode: number }).statusCode
        : undefined;

    logger.error(
      {
        err: normalizedError,
        method: request.method,
        url: request.url,
      },
      "Unhandled request error",
    );

    return reply.code(statusCode ?? 500).send({
      error: statusCode && statusCode < 500 ? normalizedError.message : "Internal server error",
    });
  });

  await app.register(fastifyRawBody, {
    field: "rawBody",
    global: false,
    encoding: "utf8",
    runFirst: true,
    routes: ["/webhook"],
  });

  await app.register(jwt, {
    secret: config.JWT_SECRET,
  });

  app.get("/health", async () => ({ ok: true }));

  await registerWebhookRoutes(app);
  await registerConversationRoutes(app);
  await registerTenantAiSettingsRoutes(app);

  return app;
}

export async function prepareRuntimeData() {
  await ensureDefaultTenant(db);
}
