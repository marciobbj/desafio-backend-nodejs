import "dotenv/config";
import { buildServer, prepareRuntimeData } from "./app/server.js";
import { config } from "./lib/config.js";
import { logger } from "./lib/logger.js";

async function main() {
  await prepareRuntimeData();

  const app = await buildServer();
  await app.listen({ host: "0.0.0.0", port: config.PORT });

  logger.info({ port: config.PORT }, "HTTP server listening");
}

main().catch((err) => {
  logger.error({ err }, "Failed to start HTTP server");
  process.exit(1);
});
