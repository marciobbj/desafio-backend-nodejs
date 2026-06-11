export function shouldEnqueueInboundMessage(input: { inserted: boolean; status: string }) {
  return input.inserted || input.status === "received" || input.status === "failed";
}
