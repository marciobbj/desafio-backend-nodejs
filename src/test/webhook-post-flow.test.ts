import { afterEach, describe, expect, it, vi } from "vitest";
import { buildServer } from "../app/server.js";
import { config } from "../lib/config.js";
import { buildMetaSignature } from "../modules/webhook/signature.js";
import { enqueueInboundMessage } from "../modules/queue/queue.js";
import { markMessageStatus, persistInboundMessage } from "../modules/conversations/conversation-service.js";
import { resolveTenantByPhoneNumberId } from "../modules/tenants/tenant-service.js";

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

vi.mock("../modules/tenants/tenant-service.js", () => ({
  resolveTenantByPhoneNumberId: vi.fn(),
}));

vi.mock("../modules/conversations/conversation-service.js", () => ({
  markMessageStatus: vi.fn(),
  persistInboundMessage: vi.fn(),
}));

vi.mock("../modules/queue/queue.js", () => ({
  enqueueInboundMessage: vi.fn(),
}));

const resolveTenantByPhoneNumberIdMock = vi.mocked(resolveTenantByPhoneNumberId);
const persistInboundMessageMock = vi.mocked(persistInboundMessage);
const enqueueInboundMessageMock = vi.mocked(enqueueInboundMessage);
const markMessageStatusMock = vi.mocked(markMessageStatus);

function inboundPayload(input: {
  phoneNumberId?: string;
  waId?: string;
  waMessageId?: string;
  text?: string;
}) {
  return {
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
                phone_number_id: input.phoneNumberId ?? "123456789012345",
              },
              contacts: [{ profile: { name: "Cliente Teste" }, wa_id: input.waId ?? "5511999990000" }],
              messages: [
                {
                  from: input.waId ?? "5511999990000",
                  id: input.waMessageId ?? "wamid.test",
                  timestamp: "1700000000",
                  type: "text",
                  text: { body: input.text ?? "Quais sao os planos?" },
                },
              ],
            },
          },
        ],
      },
    ],
  };
}

function signedRequestBody(payload: unknown) {
  const body = JSON.stringify(payload);
  return {
    body,
    signature: buildMetaSignature(body, config.META_APP_SECRET),
  };
}

describe("POST /webhook flow", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("does not enqueue the same delivered webhook twice", async () => {
    const app = await buildServer();
    const { body, signature } = signedRequestBody(inboundPayload({ waMessageId: "wamid.duplicate" }));

    resolveTenantByPhoneNumberIdMock.mockResolvedValue({
      id: "channel-1",
      tenantId: "00000000-0000-4000-8000-000000000001",
      provider: "whatsapp",
      phoneNumberId: "123456789012345",
      wabaId: "WABA_TESTE_0001",
      verifyToken: config.META_VERIFY_TOKEN,
      createdAt: new Date(),
      tenant: {
        id: "00000000-0000-4000-8000-000000000001",
        name: "NeoFibra",
        createdAt: new Date(),
      },
    });
    persistInboundMessageMock
      .mockResolvedValueOnce({
        inserted: true,
        contact: { id: "contact-1", tenantId: "00000000-0000-4000-8000-000000000001" },
        conversation: { id: "conversation-1" },
        message: { id: "message-1", status: "received" },
      } as never)
      .mockResolvedValueOnce({
        inserted: false,
        contact: { id: "contact-1", tenantId: "00000000-0000-4000-8000-000000000001" },
        conversation: { id: "conversation-1" },
        message: { id: "message-1", status: "enqueued" },
      } as never);

    const firstResponse = await app.inject({
      method: "POST",
      url: "/webhook",
      headers: {
        "content-type": "application/json",
        "x-hub-signature-256": signature,
      },
      payload: body,
    });
    const secondResponse = await app.inject({
      method: "POST",
      url: "/webhook",
      headers: {
        "content-type": "application/json",
        "x-hub-signature-256": signature,
      },
      payload: body,
    });

    await app.close();

    expect(firstResponse.json()).toMatchObject({ received: true, duplicate: false, enqueued: true });
    expect(secondResponse.json()).toMatchObject({ received: true, duplicate: true, enqueued: false });
    expect(enqueueInboundMessageMock).toHaveBeenCalledTimes(1);
    expect(enqueueInboundMessageMock).toHaveBeenCalledWith({
      tenantId: "00000000-0000-4000-8000-000000000001",
      conversationId: "conversation-1",
      inboundMessageId: "message-1",
      waMessageId: "wamid.duplicate",
    });
    expect(markMessageStatusMock).toHaveBeenCalledOnce();
    expect(markMessageStatusMock).toHaveBeenCalledWith(expect.anything(), "message-1", "enqueued");
  });

  it("persists and enqueues each inbound message under the tenant resolved from its WhatsApp channel", async () => {
    const app = await buildServer();
    const tenantA = "00000000-0000-4000-8000-000000000001";
    const tenantB = "00000000-0000-4000-8000-000000000002";
    const requestA = signedRequestBody(
      inboundPayload({ phoneNumberId: "phone-a", waId: "5511999990001", waMessageId: "wamid.a" }),
    );
    const requestB = signedRequestBody(
      inboundPayload({ phoneNumberId: "phone-b", waId: "5511999990002", waMessageId: "wamid.b" }),
    );

    resolveTenantByPhoneNumberIdMock.mockImplementation(async (_db, phoneNumberId) => ({
      id: `channel-${phoneNumberId}`,
      tenantId: phoneNumberId === "phone-a" ? tenantA : tenantB,
      provider: "whatsapp",
      phoneNumberId,
      wabaId: "WABA_TESTE_0001",
      verifyToken: config.META_VERIFY_TOKEN,
      createdAt: new Date(),
      tenant: {
        id: phoneNumberId === "phone-a" ? tenantA : tenantB,
        name: phoneNumberId === "phone-a" ? "Tenant A" : "Tenant B",
        createdAt: new Date(),
      },
    }));
    persistInboundMessageMock.mockImplementation(async (_db, input) => ({
      inserted: true,
      contact: { id: `contact-${input.tenantId}`, tenantId: input.tenantId },
      conversation: { id: `conversation-${input.tenantId}` },
      message: { id: `message-${input.waMessageId}`, status: "received" },
    }) as never);

    await app.inject({
      method: "POST",
      url: "/webhook",
      headers: {
        "content-type": "application/json",
        "x-hub-signature-256": requestA.signature,
      },
      payload: requestA.body,
    });
    await app.inject({
      method: "POST",
      url: "/webhook",
      headers: {
        "content-type": "application/json",
        "x-hub-signature-256": requestB.signature,
      },
      payload: requestB.body,
    });

    await app.close();

    expect(persistInboundMessageMock).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      expect.objectContaining({ tenantId: tenantA, waMessageId: "wamid.a", waId: "5511999990001" }),
    );
    expect(persistInboundMessageMock).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      expect.objectContaining({ tenantId: tenantB, waMessageId: "wamid.b", waId: "5511999990002" }),
    );
    expect(enqueueInboundMessageMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ tenantId: tenantA, waMessageId: "wamid.a" }),
    );
    expect(enqueueInboundMessageMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ tenantId: tenantB, waMessageId: "wamid.b" }),
    );
  });
});
