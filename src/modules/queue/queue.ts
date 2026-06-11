import { Queue, type ConnectionOptions } from "bullmq";
import { config } from "../../lib/config.js";
import { buildInboundMessageJobId } from "./job-id.js";

export type ProcessInboundMessageJob = {
  tenantId: string;
  conversationId: string;
  inboundMessageId: string;
  waMessageId: string;
};

const redisUrl = new URL(config.REDIS_URL);

export const queueConnection: ConnectionOptions = {
  host: redisUrl.hostname,
  port: Number(redisUrl.port || 6379),
  password: redisUrl.password || undefined,
  username: redisUrl.username || undefined,
  maxRetriesPerRequest: null,
};

export const inboundMessagesQueue = new Queue<
  ProcessInboundMessageJob,
  void,
  "process-inbound-message"
>(config.QUEUE_NAME, {
  connection: queueConnection,
  defaultJobOptions: {
    attempts: 4,
    backoff: {
      type: "exponential",
      delay: 2_000,
    },
    removeOnComplete: {
      age: 60 * 60,
      count: 1_000,
    },
    removeOnFail: {
      age: 24 * 60 * 60,
    },
  },
});

export async function enqueueInboundMessage(job: ProcessInboundMessageJob) {
  return inboundMessagesQueue.add("process-inbound-message", job, {
    jobId: buildInboundMessageJobId(job),
  });
}
