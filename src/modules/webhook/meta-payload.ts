import { z } from "zod";

const metaPayloadSchema = z.object({
  entry: z.array(
    z.object({
      id: z.string().optional(),
      changes: z.array(
        z.object({
          value: z.object({
            metadata: z.object({
              phone_number_id: z.string(),
            }),
            contacts: z
              .array(
                z.object({
                  wa_id: z.string(),
                  profile: z
                    .object({
                      name: z.string().optional(),
                    })
                    .optional(),
                }),
              )
              .optional(),
            messages: z.array(
              z.object({
                from: z.string(),
                id: z.string(),
                timestamp: z.string(),
                type: z.string(),
                text: z
                  .object({
                    body: z.string(),
                  })
                  .optional(),
              }),
            ),
          }),
        }),
      ),
    }),
  ),
});

export type ParsedInboundMessage = {
  phoneNumberId: string;
  wabaId?: string;
  waId: string;
  contactName?: string;
  waMessageId: string;
  body: string;
  timestamp: Date;
};

export function parseInboundMessage(payload: unknown): ParsedInboundMessage | null {
  const parsed = metaPayloadSchema.safeParse(payload);
  if (!parsed.success) {
    throw new Error("Invalid Meta payload");
  }

  const entry = parsed.data.entry[0];
  const change = entry?.changes[0];
  const value = change?.value;
  const message = value?.messages[0];

  if (!value || !message || message.type !== "text" || !message.text?.body) {
    return null;
  }

  const contact = value.contacts?.find((candidate) => candidate.wa_id === message.from);

  return {
    phoneNumberId: value.metadata.phone_number_id,
    wabaId: entry?.id,
    waId: message.from,
    contactName: contact?.profile?.name,
    waMessageId: message.id,
    body: message.text.body,
    timestamp: new Date(Number(message.timestamp) * 1000),
  };
}
