import { describe, expect, it, vi, afterEach } from "vitest";
import { generateReply } from "../modules/ai/ai-service.js";
import { getTenantAiSettings } from "../modules/ai/tenant-ai-settings.js";

vi.mock("../modules/ai/tenant-ai-settings.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../modules/ai/tenant-ai-settings.js")>();
  return {
    ...actual,
    getTenantAiSettings: vi.fn(),
  };
});

const getTenantAiSettingsMock = vi.mocked(getTenantAiSettings);

describe("cost control / budget check", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("returns fallback message if spend exceeds budget", async () => {
    getTenantAiSettingsMock.mockResolvedValue({
      tenantName: "Test Tenant",
      systemPrompt: "System Prompt",
      model: "gpt-4",
      temperature: 0.7,
      toolCallingEnabled: false,
      monthlyBudgetUsd: 10.0,
      currentMonthSpendUsd: 12.5,
    });

    const reply = await generateReply({
      tenantId: "tenant-1",
      conversationId: "conv-1",
      history: [],
      question: "Hello",
    });

    expect(reply).toBe("Desculpe, o limite de processamento de mensagens foi atingido. Por favor, tente novamente mais tarde.");
  });

  it("returns fallback message if spend equals budget", async () => {
    getTenantAiSettingsMock.mockResolvedValue({
      tenantName: "Test Tenant",
      systemPrompt: "System Prompt",
      model: "gpt-4",
      temperature: 0.7,
      toolCallingEnabled: false,
      monthlyBudgetUsd: 10.0,
      currentMonthSpendUsd: 10.0,
    });

    const reply = await generateReply({
      tenantId: "tenant-1",
      conversationId: "conv-1",
      history: [],
      question: "Hello",
    });

    expect(reply).toBe("Desculpe, o limite de processamento de mensagens foi atingido. Por favor, tente novamente mais tarde.");
  });
});
