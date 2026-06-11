import "dotenv/config";
import { Worker } from "bullmq";
import { config } from "./lib/config.js";
import { logger } from "./lib/logger.js";
import {
  queueConnection,
  type ProcessInboundMessageJob,
} from "./modules/queue/queue.js";
import { processInboundMessage } from "./worker/processors/process-inbound-message.js";

async function main() {
  const worker = new Worker<ProcessInboundMessageJob, void, "process-inbound-message">(
    config.QUEUE_NAME,
    processInboundMessage,
    {
      connection: queueConnection,
      concurrency: 4,
    },
  );

  worker.on("completed", (job) => {
    logger.info({ jobId: job.id, tenantId: job.data.tenantId }, "Job completed");
  });

  worker.on("failed", (job, err) => {
    logger.error(
      {
        err,
        jobId: job?.id,
        tenantId: job?.data.tenantId,
        attemptsMade: job?.attemptsMade,
      },
      "Job failed",
    );
  });

  const shutdown = async () => {
    logger.info("Closing worker");
    await worker.close();
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());

  logger.info({ queueName: config.QUEUE_NAME }, "Worker listening");
}

main().catch((err) => {
  logger.error({ err }, "Failed to start worker");
  process.exit(1);
});
