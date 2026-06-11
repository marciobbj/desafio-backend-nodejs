/**
 * Schema do banco (sugestão com Drizzle ORM).
 *
 * Modele aqui suas tabelas. Uma estrutura mínima possível:
 *   - tenants    (id, nome, ...)
 *   - contacts   (id, tenant_id, wa_id/telefone, nome, ...)
 *   - conversations (id, tenant_id, contact_id, status, ...)
 *   - messages   (id, tenant_id, conversation_id, wa_message_id ÚNICO, direction, body, ...)
 *
 * Dica: a coluna do `message.id` da Meta (wa_message_id) com índice ÚNICO é uma forma simples
 * de garantir idempotência na reentrega de webhooks.
 *
 * Exemplo (descomente e ajuste ao adicionar `drizzle-orm` às dependências):
 *
 * import { pgTable, uuid, text, timestamp, unique } from "drizzle-orm/pg-core";
 *
 * export const messages = pgTable("messages", {
 *   id: uuid("id").defaultRandom().primaryKey(),
 *   tenantId: uuid("tenant_id").notNull(),
 *   waMessageId: text("wa_message_id").notNull(),
 *   // ...
 * }, (t) => ({ uniqWaId: unique().on(t.tenantId, t.waMessageId) }));
 */

export {};
