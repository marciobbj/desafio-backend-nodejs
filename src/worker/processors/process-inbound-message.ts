import type { Job } from "bullmq";
import { db } from "../../db/client.js";
import { sendWhatsAppText } from "../../integrations/meta/meta-client.js";
import { logger } from "../../lib/logger.js";
import { generateReply } from "../../modules/ai/ai-service.js";
import {
  createOutboundMessage,
  getConversationForJob,
  markMessageSent,
} from "../../modules/conversations/conversation-service.js";
import type { ProcessInboundMessageJob } from "../../modules/queue/queue.js";

const conversationLocks = new Set<string>();

export async function processInboundMessage(job: Job<ProcessInboundMessageJob>) {
  const lockKey = `${job.data.tenantId}:${job.data.conversationId}`;

  if (conversationLocks.has(lockKey)) {
    throw new Error(`Conversation is already being processed: ${lockKey}`);
  }

  conversationLocks.add(lockKey);

  try {
    logger.info(
      {
        jobId: job.id,
        tenantId: job.data.tenantId,
        conversationId: job.data.conversationId,
        waMessageId: job.data.waMessageId,
      },
      "Started inbound message job",
    );

    const { conversation, inboundMessage, history } = await getConversationForJob(db, {
      tenantId: job.data.tenantId,
      conversationId: job.data.conversationId,
      inboundMessageId: job.data.inboundMessageId,
    });

    const answer = await generateReply({
      tenantId: job.data.tenantId,
      conversationId: job.data.conversationId,
      history,
      question: inboundMessage.body,
    });

    const outbound = await createOutboundMessage(db, {
      tenantId: job.data.tenantId,
      conversationId: conversation.id,
      contactId: conversation.contactId,
      body: answer,
      status: "pending",
    });

    const providerPayload = await sendWhatsAppText({
      to: conversation.contact.waId,
      text: answer,
    });

    await markMessageSent(db, outbound.id, providerPayload);

    logger.info(
      {
        jobId: job.id,
        tenantId: job.data.tenantId,
        conversationId: job.data.conversationId,
        outboundMessageId: outbound.id,
      },
      "Finished inbound message job",
    );
  } finally {
    conversationLocks.delete(lockKey);
  }
}
