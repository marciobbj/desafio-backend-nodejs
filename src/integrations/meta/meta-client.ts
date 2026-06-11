import { config } from "../../lib/config.js";

export type SendWhatsAppTextInput = {
  to: string;
  text: string;
  phoneNumberId?: string;
};

export async function sendWhatsAppText(input: SendWhatsAppTextInput) {
  const phoneNumberId = input.phoneNumberId ?? config.META_PHONE_NUMBER_ID;
  const response = await fetch(`${config.META_API_BASE_URL}/${phoneNumberId}/messages`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${config.META_TOKEN}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: input.to,
      type: "text",
      text: {
        body: input.text,
      },
    }),
  });

  const payload = (await response.json().catch(() => null)) as unknown;

  if (!response.ok) {
    throw new Error(`Meta API request failed with status ${response.status}`);
  }

  return payload;
}
