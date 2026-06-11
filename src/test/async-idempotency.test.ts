import { describe, expect, it } from "vitest";
import { buildInboundMessageJobId } from "../modules/queue/job-id.js";
import { shouldEnqueueInboundMessage } from "../modules/webhook/inbound-status.js";

describe("async idempotency rules", () => {
  it("reenqueues inserted, received or failed inbound messages", () => {
    expect(shouldEnqueueInboundMessage({ inserted: true, status: "received" })).toBe(true);
    expect(shouldEnqueueInboundMessage({ inserted: false, status: "received" })).toBe(true);
    expect(shouldEnqueueInboundMessage({ inserted: false, status: "failed" })).toBe(true);
  });

  it("does not reenqueues inbound messages already in progress or answered", () => {
    expect(shouldEnqueueInboundMessage({ inserted: false, status: "enqueued" })).toBe(false);
    expect(shouldEnqueueInboundMessage({ inserted: false, status: "processing" })).toBe(false);
    expect(shouldEnqueueInboundMessage({ inserted: false, status: "responded" })).toBe(false);
  });

  it("uses a BullMQ-compatible job id", () => {
    const jobId = buildInboundMessageJobId({
      tenantId: "00000000-0000-4000-8000-000000000001",
      waMessageId: "wamid.test",
    });

    expect(jobId).toBe("00000000-0000-4000-8000-000000000001__wamid.test");
    expect(jobId).not.toContain(":");
  });
});
