import { describe, expect, it } from "vitest";
import { buildMetaSignature, isValidMetaSignature } from "../modules/webhook/signature.js";

describe("Meta webhook signature", () => {
  it("accepts a valid HMAC SHA-256 signature", () => {
    const rawBody = JSON.stringify({ hello: "world" });
    const secret = "test-secret";
    const signature = buildMetaSignature(rawBody, secret);

    expect(isValidMetaSignature(rawBody, secret, signature)).toBe(true);
  });

  it("rejects an invalid signature", () => {
    const rawBody = JSON.stringify({ hello: "world" });

    expect(isValidMetaSignature(rawBody, "test-secret", "sha256=invalid")).toBe(false);
  });
});
