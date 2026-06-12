import { describe, expect, it } from "vitest";
import { loadKnowledgeBaseContext } from "../modules/ai/knowledge-base.js";

describe("Knowledge base context", () => {
  it("loads the full markdown context for the LLM prompt", async () => {
    const context = await loadKnowledgeBaseContext();

    expect(context).toContain("[");
    expect(context).toContain("Fibra");
  });
});
