import { eq } from "drizzle-orm";
import { ChatPromptTemplate, MessagesPlaceholder } from "@langchain/core/prompts";
import { z } from "zod";
import type { DbClient } from "../../db/client.js";
import { tenantAiSettings, tenants } from "../../db/schema.js";

export const DEFAULT_SYSTEM_PROMPT = [
  "Voce e um atendente da {tenantName} no WhatsApp.",
  "Responda em portugues brasileiro, de forma objetiva e cordial.",
  "Use apenas as informacoes da base de conhecimento e das ferramentas disponiveis.",
  "Se a informacao nao estiver disponivel, diga que nao sabe e indique atendimento humano.",
  "Nao invente precos, prazos, cobertura, SLA ou status.",
  "",
  "Base de conhecimento relevante:",
  "{context}",
].join("\n");

export async function ensureDefaultTenantAiSettings(db: DbClient, tenantId: string) {
  await db
    .insert(tenantAiSettings)
    .values({
      tenantId,
      systemPrompt: DEFAULT_SYSTEM_PROMPT,
    })
    .onConflictDoNothing();
}

export async function getTenantAiSettings(db: DbClient, tenantId: string) {
  const tenant = await db.query.tenants.findFirst({
    where: eq(tenants.id, tenantId),
    with: {
      aiSettings: true,
    },
  });

  if (!tenant) {
    throw new Error("Tenant not found");
  }

  return {
    tenantName: tenant.name,
    systemPrompt: tenant.aiSettings?.systemPrompt ?? DEFAULT_SYSTEM_PROMPT,
    model: tenant.aiSettings?.model ?? undefined,
    temperature: tenant.aiSettings?.temperature ?? undefined,
    toolCallingEnabled: tenant.aiSettings?.toolCallingEnabled ?? undefined,
    monthlyBudgetUsd: tenant.aiSettings?.monthlyBudgetUsd ?? undefined,
    currentMonthSpendUsd: tenant.aiSettings?.currentMonthSpendUsd ?? undefined,
  };
}

export const updateTenantAiSettingsSchema = z
  .object({
    systemPrompt: z.string().trim().min(1).optional(),
    model: z.string().trim().min(1).nullable().optional(),
    temperature: z.number().min(0).max(2).nullable().optional(),
    toolCallingEnabled: z.boolean().nullable().optional(),
    monthlyBudgetUsd: z.number().min(0).nullable().optional(),
    currentMonthSpendUsd: z.number().min(0).nullable().optional(),
  })
  .strict();

export type UpdateTenantAiSettingsInput = z.infer<typeof updateTenantAiSettingsSchema>;

export class InvalidSystemPromptTemplateError extends Error {
  constructor(cause: unknown) {
    super("Invalid system prompt template");
    this.cause = cause;
  }
}

export async function validateSystemPromptTemplate(systemPrompt: string) {
  const prompt = ChatPromptTemplate.fromMessages([
    ["system", systemPrompt],
    new MessagesPlaceholder("history"),
  ]);

  try {
    await prompt.formatMessages({
      tenantName: "Tenant",
      context: "Contexto",
      history: [],
    });
  } catch (err) {
    throw new InvalidSystemPromptTemplateError(err);
  }
}

export async function updateTenantAiSettings(
  db: DbClient,
  tenantId: string,
  input: UpdateTenantAiSettingsInput,
) {
  if (input.systemPrompt !== undefined) {
    await validateSystemPromptTemplate(input.systemPrompt);
  }

  await db
    .insert(tenantAiSettings)
    .values({
      tenantId,
      systemPrompt: input.systemPrompt ?? DEFAULT_SYSTEM_PROMPT,
      model: input.model,
      temperature: input.temperature,
      toolCallingEnabled: input.toolCallingEnabled,
      monthlyBudgetUsd: input.monthlyBudgetUsd,
      currentMonthSpendUsd: input.currentMonthSpendUsd,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: tenantAiSettings.tenantId,
      set: {
        ...(input.systemPrompt !== undefined ? { systemPrompt: input.systemPrompt } : {}),
        ...(input.model !== undefined ? { model: input.model } : {}),
        ...(input.temperature !== undefined ? { temperature: input.temperature } : {}),
        ...(input.toolCallingEnabled !== undefined
          ? { toolCallingEnabled: input.toolCallingEnabled }
          : {}),
        ...(input.monthlyBudgetUsd !== undefined ? { monthlyBudgetUsd: input.monthlyBudgetUsd } : {}),
        ...(input.currentMonthSpendUsd !== undefined
          ? { currentMonthSpendUsd: input.currentMonthSpendUsd }
          : {}),
        updatedAt: new Date(),
      },
    });

  return getTenantAiSettings(db, tenantId);
}
