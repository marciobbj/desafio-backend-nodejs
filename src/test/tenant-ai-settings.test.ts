import { describe, expect, it } from "vitest";
import {
  InvalidSystemPromptTemplateError,
  updateTenantAiSettingsSchema,
  validateSystemPromptTemplate,
} from "../modules/ai/tenant-ai-settings.js";

describe("tenant AI settings", () => {
  it("accepts LangChain system prompt templates with supported variables", async () => {
    await expect(
      validateSystemPromptTemplate("Atenda {tenantName} usando este contexto:\n{context}"),
    ).resolves.toBeUndefined();
  });

  it("rejects LangChain system prompt templates with unknown variables", async () => {
    await expect(validateSystemPromptTemplate("Use {unknownVariable}")).rejects.toBeInstanceOf(
      InvalidSystemPromptTemplateError,
    );
  });

  it("validates nullable tenant-level LLM overrides", () => {
    const result = updateTenantAiSettingsSchema.safeParse({
      model: null,
      temperature: 0.2,
      toolCallingEnabled: false,
    });

    expect(result.success).toBe(true);
  });
});
