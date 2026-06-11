import "dotenv/config";
import type { Config } from "drizzle-kit";

// Sugestão de configuração caso você opte por Drizzle + Postgres.
// Ajuste o caminho do schema conforme organizar seu código.
export default {
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/atendimento",
  },
} satisfies Config;
