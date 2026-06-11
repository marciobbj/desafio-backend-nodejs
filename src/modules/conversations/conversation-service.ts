import { and, desc, eq, sql } from "drizzle-orm";
import type { DbClient } from "../../db/client.js";
import { contacts, conversations, messages } from "../../db/schema.js";

export type InboundMessageInput = {
  tenantId: string;
  waId: string;
  contactName?: string;
  waMessageId: string;
  body: string;
  timestamp: Date;
  providerPayload: unknown;
};

export async function persistInboundMessage(db: DbClient, input: InboundMessageInput) {
  return db.transaction(async (tx) => {
    const [contact] = await tx
      .insert(contacts)
      .values({
        tenantId: input.tenantId,
        waId: input.waId,
        name: input.contactName ?? null,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [contacts.tenantId, contacts.waId],
        set: {
          name: input.contactName ?? null,
          updatedAt: new Date(),
        },
      })
      .returning();

    if (!contact) {
      throw new Error("Failed to upsert contact");
    }

    const [conversation] = await tx
      .insert(conversations)
      .values({
        tenantId: input.tenantId,
        contactId: contact.id,
        lastMessageAt: input.timestamp,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [conversations.tenantId, conversations.contactId],
        set: {
          lastMessageAt: input.timestamp,
          updatedAt: new Date(),
        },
      })
      .returning();

    if (!conversation) {
      throw new Error("Failed to upsert conversation");
    }

    const [message] = await tx
      .insert(messages)
      .values({
        tenantId: input.tenantId,
        conversationId: conversation.id,
        contactId: contact.id,
        waMessageId: input.waMessageId,
        direction: "inbound",
        body: input.body,
        status: "received",
        providerPayload: input.providerPayload,
        createdAt: input.timestamp,
      })
      .onConflictDoNothing()
      .returning();

    const persistedMessage =
      message ??
      (await tx.query.messages.findFirst({
        where: and(eq(messages.tenantId, input.tenantId), eq(messages.waMessageId, input.waMessageId)),
      }));

    if (!persistedMessage) {
      throw new Error("Failed to persist inbound message");
    }

    return {
      inserted: Boolean(message),
      contact,
      conversation,
      message: persistedMessage,
    };
  });
}

export async function findOutboundReplyForInbound(
  db: DbClient,
  input: { tenantId: string; inboundMessageId: string },
) {
  return db.query.messages.findFirst({
    where: and(
      eq(messages.tenantId, input.tenantId),
      eq(messages.idempotencyKey, `reply__${input.inboundMessageId}`),
    ),
  });
}

export async function createOrGetOutboundReply(
  db: DbClient,
  input: {
    tenantId: string;
    conversationId: string;
    contactId: string;
    inboundMessageId: string;
    body: string;
    status?: string;
    providerPayload?: unknown;
  },
) {
  const idempotencyKey = `reply__${input.inboundMessageId}`;
  const [message] = await db
    .insert(messages)
    .values({
      tenantId: input.tenantId,
      conversationId: input.conversationId,
      contactId: input.contactId,
      idempotencyKey,
      direction: "outbound",
      body: input.body,
      status: input.status ?? "pending",
      providerPayload: input.providerPayload,
    })
    .onConflictDoNothing()
    .returning();

  const persistedMessage =
    message ??
    (await findOutboundReplyForInbound(db, {
      tenantId: input.tenantId,
      inboundMessageId: input.inboundMessageId,
    }));

  if (!persistedMessage) {
    throw new Error("Failed to create outbound message");
  }

  if (message) {
    await db
      .update(conversations)
      .set({
        lastMessageAt: message.createdAt,
        updatedAt: new Date(),
      })
      .where(and(eq(conversations.id, input.conversationId), eq(conversations.tenantId, input.tenantId)));
  }

  return persistedMessage;
}

export async function markMessageSent(db: DbClient, messageId: string, providerPayload: unknown) {
  await db
    .update(messages)
    .set({
      status: "sent",
      providerPayload,
    })
    .where(eq(messages.id, messageId));
}

export async function markMessageStatus(db: DbClient, messageId: string, status: string) {
  await db.update(messages).set({ status }).where(eq(messages.id, messageId));
}

export async function getConversationForJob(
  db: DbClient,
  input: { tenantId: string; conversationId: string; inboundMessageId: string },
) {
  const inboundMessage = await db.query.messages.findFirst({
    where: and(
      eq(messages.tenantId, input.tenantId),
      eq(messages.conversationId, input.conversationId),
      eq(messages.id, input.inboundMessageId),
    ),
  });

  if (!inboundMessage) {
    throw new Error("Inbound message not found");
  }

  const conversation = await db.query.conversations.findFirst({
    where: and(eq(conversations.tenantId, input.tenantId), eq(conversations.id, input.conversationId)),
    with: {
      contact: true,
    },
  });

  if (!conversation) {
    throw new Error("Conversation not found");
  }

  const history = await db.query.messages.findMany({
    where: and(eq(messages.tenantId, input.tenantId), eq(messages.conversationId, input.conversationId)),
    orderBy: [desc(messages.createdAt)],
    limit: 12,
  });

  return {
    conversation,
    inboundMessage,
    history: history.reverse(),
  };
}

export async function listConversations(db: DbClient, tenantId: string) {
  return db
    .select({
      id: conversations.id,
      status: conversations.status,
      lastMessageAt: conversations.lastMessageAt,
      createdAt: conversations.createdAt,
      contact: {
        id: contacts.id,
        waId: contacts.waId,
        name: contacts.name,
      },
    })
    .from(conversations)
    .innerJoin(contacts, eq(conversations.contactId, contacts.id))
    .where(eq(conversations.tenantId, tenantId))
    .orderBy(sql`${conversations.lastMessageAt} desc nulls last`)
    .limit(50);
}

export async function listConversationMessages(
  db: DbClient,
  input: { tenantId: string; conversationId: string },
) {
  return db.query.messages.findMany({
    where: and(eq(messages.tenantId, input.tenantId), eq(messages.conversationId, input.conversationId)),
    orderBy: [messages.createdAt],
  });
}
