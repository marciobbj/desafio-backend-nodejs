import { describe, expect, it } from "vitest";
import { parseInboundMessage } from "../modules/webhook/meta-payload.js";

function basePayload(type = "text") {
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "WABA_TESTE_0001",
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: {
                display_phone_number: "15550000000",
                phone_number_id: "123456789012345",
              },
              contacts: [{ profile: { name: "Cliente Teste" }, wa_id: "5511999990000" }],
              messages: [
                {
                  from: "5511999990000",
                  id: "wamid.test",
                  timestamp: "1700000000",
                  type,
                  text: type === "text" ? { body: "Quais sao os planos?" } : undefined,
                },
              ],
            },
          },
        ],
      },
    ],
  };
}

describe("Meta payload parser", () => {
  it("extracts the inbound text message fields", () => {
    const parsed = parseInboundMessage(basePayload());

    expect(parsed).toMatchObject({
      phoneNumberId: "123456789012345",
      wabaId: "WABA_TESTE_0001",
      waId: "5511999990000",
      contactName: "Cliente Teste",
      waMessageId: "wamid.test",
      body: "Quais sao os planos?",
    });
  });

  it("ignores non-text messages", () => {
    expect(parseInboundMessage(basePayload("image"))).toBeNull();
  });
});
