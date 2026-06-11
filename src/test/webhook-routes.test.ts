import { describe, expect, it } from "vitest";
import { buildServer } from "../app/server.js";
import { config } from "../lib/config.js";

describe("Webhook routes", () => {
  it("returns the Meta challenge when verify token matches", async () => {
    const app = await buildServer();

    const response = await app.inject({
      method: "GET",
      url: `/webhook?hub.mode=subscribe&hub.verify_token=${config.META_VERIFY_TOKEN}&hub.challenge=abc123`,
    });

    await app.close();

    expect(response.statusCode).toBe(200);
    expect(response.body).toBe("abc123");
  });

  it("rejects invalid verify token", async () => {
    const app = await buildServer();

    const response = await app.inject({
      method: "GET",
      url: "/webhook?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=abc123",
    });

    await app.close();

    expect(response.statusCode).toBe(403);
  });
});
