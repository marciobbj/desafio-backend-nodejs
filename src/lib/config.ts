import { z } from "zod";

const optionalUrl = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.string().url().optional(),
);

const envSchema = z.object({
  NODE_ENV: z.string().default("development"),
  PORT: z.coerce.number().int().positive().default(8000),
  LOG_LEVEL: z.string().default("info"),
  DATABASE_URL: z.string().url().default("postgres://postgres:postgres@localhost:5432/atendimento"),
  REDIS_URL: z.string().url().default("redis://localhost:6379"),
  QUEUE_NAME: z.string().default("inbound-messages"),
  META_VERIFY_TOKEN: z.string().default("meu-verify-token-secreto"),
  META_APP_SECRET: z.string().min(1).default("super-secret-app-secret-trocar"),
  META_TOKEN: z.string().default("mock-token"),
  META_API_BASE_URL: z.string().url().default("http://localhost:8001"),
  META_PHONE_NUMBER_ID: z.string().default("123456789012345"),
  JWT_SECRET: z.string().min(16).default("dev-secret-change-me-in-production"),
  DEFAULT_TENANT_ID: z.string().uuid().default("00000000-0000-4000-8000-000000000001"),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_MODEL: z.string().default("gpt-4o-mini"),
  OPENAI_BASE_URL: optionalUrl,
  LLM_TOOL_CALLING_ENABLED: z
    .enum(["true", "false"])
    .default("true")
    .transform((value) => value === "true"),
});

export const config = envSchema.parse(process.env);

export type AppConfig = typeof config;
