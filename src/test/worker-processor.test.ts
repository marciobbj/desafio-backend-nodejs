import type { Job } from "bullmq";
import { afterEach, describe, expect, it, vi } from "vitest";
import { sendWhatsAppText } from "../integrations/meta/meta-client.js";
import { generateReply } from "../modules/ai/ai-service.js";
import {
  createOrGetOutboundReply,
  findOutboundReplyForInbound,
  getConversationForJob,
  markMessageSent,
  markMessageStatus,
} from "../modules/conversations/conversation-service.js";
import type { ProcessInboundMessageJob } from "../modules/queue/queue.js";
import { processInboundMessage } from "../worker/processors/process-inbound-message.js";

vi.mock("../db/client.js", () => ({
  db: {},
}));

vi.mock("../lib/logger.js", () => ({
  logger: {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

vi.mock("../integrations/meta/meta-client.js", () => ({
  sendWhatsAppText: vi.fn(),
}));

vi.mock("../modules/ai/ai-service.js", () => ({
  generateReply: vi.fn(),
}));

vi.mock("../modules/conversations/conversation-service.js", () => ({
  createOrGetOutboundReply: vi.fn(),
  findOutboundReplyForInbound: vi.fn(),
  getConversationForJob: vi.fn(),
  markMessageSent: vi.fn(),
  markMessageStatus: vi.fn(),
}));

const sendWhatsAppTextMock = vi.mocked(sendWhatsAppText);
const generateReplyMock = vi.mocked(generateReply);
const createOrGetOutboundReplyMock = vi.mocked(createOrGetOutboundReply);
const findOutboundReplyForInboundMock = vi.mocked(findOutboundReplyForInbound);
const getConversationForJobMock = vi.mocked(getConversationForJob);
const markMessageSentMock = vi.mocked(markMessageSent);
const markMessageStatusMock = vi.mocked(markMessageStatus);

const tenantId = "00000000-0000-4000-8000-000000000001";
const conversationId = "conversation-1";
const inboundMessageId = "inbound-1";

function job(): Job<ProcessInboundMessageJob> {
  return {
    id: "job-1",
    data: {
      tenantId,
      conversationId,
      inboundMessageId,
      waMessageId: "wamid.test",
    },
  } as Job<ProcessInboundMessageJob>;
}

function conversationFixture() {
  return {
    conversation: {
      id: conversationId,
      tenantId,
      contactId: "contact-1",
      contact: {
        id: "contact-1",
        tenantId,
        waId: "5511999990000",
        name: "Cliente Teste",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      status: "open",
      lastMessageAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    inboundMessage: {
      id: inboundMessageId,
      tenantId,
      conversationId,
      contactId: "contact-1",
      waMessageId: "wamid.test",
      idempotencyKey: null,
      direction: "inbound",
      body: "Quais sao os planos?",
      status: "received",
      providerPayload: {},
      createdAt: new Date(),
    },
    history: [],
  } as never;
}

describe("processInboundMessage", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("throws when Meta send fails so BullMQ can retry the same job", async () => {
    getConversationForJobMock.mockResolvedValue(conversationFixture());
    findOutboundReplyForInboundMock.mockResolvedValue(undefined);
    generateReplyMock.mockResolvedValue("Resposta gerada pela LLM");
    createOrGetOutboundReplyMock.mockResolvedValue({
      id: "outbound-1",
      tenantId,
      conversationId,
      contactId: "contact-1",
      waMessageId: null,
      idempotencyKey: `reply__${inboundMessageId}`,
      direction: "outbound",
      body: "Resposta gerada pela LLM",
      status: "pending",
      providerPayload: null,
      createdAt: new Date(),
    } as never);
    sendWhatsAppTextMock.mockRejectedValue(new Error("Meta unavailable"));

    await expect(processInboundMessage(job())).rejects.toThrow("Meta unavailable");

    expect(markMessageStatusMock).toHaveBeenCalledWith(expect.anything(), inboundMessageId, "processing");
    expect(markMessageStatusMock).toHaveBeenCalledWith(expect.anything(), "outbound-1", "sending");
    expect(markMessageSentMock).not.toHaveBeenCalled();
    expect(markMessageStatusMock).not.toHaveBeenCalledWith(expect.anything(), inboundMessageId, "responded");
  });

  it("reuses an existing pending outbound reply instead of creating a duplicate", async () => {
    getConversationForJobMock.mockResolvedValue(conversationFixture());
    findOutboundReplyForInboundMock.mockResolvedValue({
      id: "outbound-existing",
      tenantId,
      conversationId,
      contactId: "contact-1",
      waMessageId: null,
      idempotencyKey: `reply__${inboundMessageId}`,
      direction: "outbound",
      body: "Resposta ja persistida",
      status: "pending",
      providerPayload: null,
      createdAt: new Date(),
    } as never);
    sendWhatsAppTextMock.mockResolvedValue({ messages: [{ id: "wamid.out" }] });

    await processInboundMessage(job());

    expect(generateReplyMock).not.toHaveBeenCalled();
    expect(createOrGetOutboundReplyMock).not.toHaveBeenCalled();
    expect(sendWhatsAppTextMock).toHaveBeenCalledOnce();
    expect(sendWhatsAppTextMock).toHaveBeenCalledWith({
      to: "5511999990000",
      text: "Resposta ja persistida",
    });
    expect(markMessageSentMock).toHaveBeenCalledWith(expect.anything(), "outbound-existing", {
      messages: [{ id: "wamid.out" }],
    });
    expect(markMessageStatusMock).toHaveBeenCalledWith(expect.anything(), inboundMessageId, "responded");
  });

  it("skips LLM and Meta send when the outbound reply was already sent", async () => {
    getConversationForJobMock.mockResolvedValue(conversationFixture());
    findOutboundReplyForInboundMock.mockResolvedValue({
      id: "outbound-sent",
      tenantId,
      conversationId,
      contactId: "contact-1",
      waMessageId: null,
      idempotencyKey: `reply__${inboundMessageId}`,
      direction: "outbound",
      body: "Resposta enviada",
      status: "sent",
      providerPayload: { messages: [{ id: "wamid.out" }] },
      createdAt: new Date(),
    } as never);

    await processInboundMessage(job());

    expect(generateReplyMock).not.toHaveBeenCalled();
    expect(createOrGetOutboundReplyMock).not.toHaveBeenCalled();
    expect(sendWhatsAppTextMock).not.toHaveBeenCalled();
    expect(markMessageSentMock).not.toHaveBeenCalled();
    expect(markMessageStatusMock).toHaveBeenCalledWith(expect.anything(), inboundMessageId, "responded");
  });
});
