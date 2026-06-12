import { relations, sql } from "drizzle-orm";
import {
  index,
  boolean,
  doublePrecision,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  vector,
} from "drizzle-orm/pg-core";

export const tenants = pgTable("tenants", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const tenantChannels = pgTable(
  "tenant_channels",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    provider: text("provider").notNull().default("whatsapp"),
    phoneNumberId: text("phone_number_id").notNull(),
    wabaId: text("waba_id"),
    verifyToken: text("verify_token").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    uniqProviderPhoneNumber: unique("tenant_channels_provider_phone_unique").on(
      table.provider,
      table.phoneNumberId,
    ),
  }),
);

export const tenantAiSettings = pgTable("tenant_ai_settings", {
  tenantId: uuid("tenant_id")
    .primaryKey()
    .references(() => tenants.id, { onDelete: "cascade" }),
  systemPrompt: text("system_prompt").notNull(),
  model: text("model"),
  temperature: doublePrecision("temperature"),
  toolCallingEnabled: boolean("tool_calling_enabled"),
  monthlyBudgetUsd: doublePrecision("monthly_budget_usd"),
  currentMonthSpendUsd: doublePrecision("current_month_spend_usd"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const contacts = pgTable(
  "contacts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    waId: text("wa_id").notNull(),
    name: text("name"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    uniqTenantWaId: unique("contacts_tenant_wa_unique").on(table.tenantId, table.waId),
    tenantIdx: index("contacts_tenant_idx").on(table.tenantId),
  }),
);

export const conversations = pgTable(
  "conversations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("open"),
    lastMessageAt: timestamp("last_message_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    uniqTenantContact: unique("conversations_tenant_contact_unique").on(table.tenantId, table.contactId),
    tenantContactIdx: index("conversations_tenant_contact_idx").on(table.tenantId, table.contactId),
    tenantLastMessageIdx: index("conversations_tenant_last_message_idx").on(
      table.tenantId,
      table.lastMessageAt,
    ),
  }),
);

export const messages = pgTable(
  "messages",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    waMessageId: text("wa_message_id"),
    idempotencyKey: text("idempotency_key"),
    direction: text("direction", { enum: ["inbound", "outbound"] }).notNull(),
    body: text("body").notNull(),
    status: text("status").notNull().default("received"),
    providerPayload: jsonb("provider_payload").$type<unknown>(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    uniqInboundWaMessage: uniqueIndex("messages_tenant_wa_message_unique")
      .on(table.tenantId, table.waMessageId)
      .where(sql`${table.waMessageId} is not null`),
    uniqIdempotencyKey: uniqueIndex("messages_tenant_idempotency_key_unique")
      .on(table.tenantId, table.idempotencyKey)
      .where(sql`${table.idempotencyKey} is not null`),
    conversationCreatedIdx: index("messages_conversation_created_idx").on(
      table.tenantId,
      table.conversationId,
      table.createdAt,
    ),
  }),
);

export const webhookEvents = pgTable(
  "webhook_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id").references(() => tenants.id, { onDelete: "set null" }),
    provider: text("provider").notNull().default("whatsapp"),
    eventType: text("event_type").notNull(),
    signature: text("signature"),
    rawBody: text("raw_body").notNull(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    tenantIdx: index("webhook_events_tenant_idx").on(table.tenantId),
  }),
);

export const knowledgeBaseEmbeddings = pgTable(
  "knowledge_base_embeddings",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    source: text("source").notNull(),
    content: text("content").notNull(),
    embedding: vector("embedding", { dimensions: 1536 }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    tenantIdx: index("kb_embeddings_tenant_idx").on(table.tenantId),
  }),
);

export const tenantsRelations = relations(tenants, ({ many, one }) => ({
  channels: many(tenantChannels),
  contacts: many(contacts),
  conversations: many(conversations),
  messages: many(messages),
  knowledgeBaseEmbeddings: many(knowledgeBaseEmbeddings),
  aiSettings: one(tenantAiSettings, {
    fields: [tenants.id],
    references: [tenantAiSettings.tenantId],
  }),
}));

export const knowledgeBaseEmbeddingsRelations = relations(knowledgeBaseEmbeddings, ({ one }) => ({
  tenant: one(tenants, {
    fields: [knowledgeBaseEmbeddings.tenantId],
    references: [tenants.id],
  }),
}));

export const tenantAiSettingsRelations = relations(tenantAiSettings, ({ one }) => ({
  tenant: one(tenants, {
    fields: [tenantAiSettings.tenantId],
    references: [tenants.id],
  }),
}));

export const tenantChannelsRelations = relations(tenantChannels, ({ one }) => ({
  tenant: one(tenants, {
    fields: [tenantChannels.tenantId],
    references: [tenants.id],
  }),
}));

export const contactsRelations = relations(contacts, ({ one, many }) => ({
  tenant: one(tenants, {
    fields: [contacts.tenantId],
    references: [tenants.id],
  }),
  conversations: many(conversations),
  messages: many(messages),
}));

export const conversationsRelations = relations(conversations, ({ one, many }) => ({
  tenant: one(tenants, {
    fields: [conversations.tenantId],
    references: [tenants.id],
  }),
  contact: one(contacts, {
    fields: [conversations.contactId],
    references: [contacts.id],
  }),
  messages: many(messages),
}));

export const messagesRelations = relations(messages, ({ one }) => ({
  tenant: one(tenants, {
    fields: [messages.tenantId],
    references: [tenants.id],
  }),
  conversation: one(conversations, {
    fields: [messages.conversationId],
    references: [conversations.id],
  }),
  contact: one(contacts, {
    fields: [messages.contactId],
    references: [contacts.id],
  }),
}));

export type Tenant = typeof tenants.$inferSelect;
export type Contact = typeof contacts.$inferSelect;
export type Conversation = typeof conversations.$inferSelect;
export type Message = typeof messages.$inferSelect;
