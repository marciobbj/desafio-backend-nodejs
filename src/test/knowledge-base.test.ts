import { describe, expect, it } from "vitest";
import { retrieveKnowledge } from "../modules/ai/knowledge-base.js";

describe("Knowledge base retrieval", () => {
  it("returns relevant chunks for plan and price questions", async () => {
    const chunks = await retrieveKnowledge("quais sao os planos e precos", 2);

    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks.join("\n")).toContain("Fibra");
  });
});
