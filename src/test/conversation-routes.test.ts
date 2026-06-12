import Fastify from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import { registerConversationRoutes } from "../app/routes/conversation-routes.js";
import { getAuthClaims } from "../modules/auth/jwt.js";
import {
  listConversationMessages,
  listConversations,
} from "../modules/conversations/conversation-service.js";

vi.mock("../db/client.js", () => ({
  db: {},
}));

vi.mock("../modules/auth/jwt.js", () => ({
  getAuthClaims: vi.fn(),
}));

vi.mock("../modules/conversations/conversation-service.js", () => ({
  listConversationMessages: vi.fn(),
  listConversations: vi.fn(),
}));

const getAuthClaimsMock = vi.mocked(getAuthClaims);
const listConversationsMock = vi.mocked(listConversations);
const listConversationMessagesMock = vi.mocked(listConversationMessages);

async function buildConversationRoutesApp() {
  const app = Fastify({ logger: false });
  await registerConversationRoutes(app);
  return app;
}

describe("conversation routes tenant isolation", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("lists only conversations for the authenticated tenant", async () => {
    const app = await buildConversationRoutesApp();
    const tenantId = "00000000-0000-4000-8000-000000000001";

    getAuthClaimsMock.mockResolvedValue({ sub: "user-1", tenantId });
    listConversationsMock.mockResolvedValue([]);

    const response = await app.inject({
      method: "GET",
      url: "/conversations",
    });

    await app.close();

    expect(response.statusCode).toBe(200);
    expect(listConversationsMock).toHaveBeenCalledOnce();
    expect(listConversationsMock).toHaveBeenCalledWith(expect.anything(), tenantId);
  });

  it("lists messages using both authenticated tenant and requested conversation", async () => {
    const app = await buildConversationRoutesApp();
    const tenantId = "00000000-0000-4000-8000-000000000002";

    getAuthClaimsMock.mockResolvedValue({ sub: "user-2", tenantId });
    listConversationMessagesMock.mockResolvedValue([]);

    const response = await app.inject({
      method: "GET",
      url: "/conversations/conversation-2/messages",
    });

    await app.close();

    expect(response.statusCode).toBe(200);
    expect(listConversationMessagesMock).toHaveBeenCalledOnce();
    expect(listConversationMessagesMock).toHaveBeenCalledWith(expect.anything(), {
      tenantId,
      conversationId: "conversation-2",
    });
  });
});
