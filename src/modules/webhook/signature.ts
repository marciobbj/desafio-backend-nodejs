import { createHmac, timingSafeEqual } from "node:crypto";

export function buildMetaSignature(rawBody: string | Buffer, appSecret: string) {
  return `sha256=${createHmac("sha256", appSecret).update(rawBody).digest("hex")}`;
}

export function isValidMetaSignature(
  rawBody: string | Buffer,
  appSecret: string,
  receivedSignature: string | undefined,
) {
  if (!receivedSignature) {
    return false;
  }

  const expected = buildMetaSignature(rawBody, appSecret);
  const expectedBuffer = Buffer.from(expected);
  const receivedBuffer = Buffer.from(receivedSignature);

  if (expectedBuffer.length !== receivedBuffer.length) {
    return false;
  }

  return timingSafeEqual(expectedBuffer, receivedBuffer);
}
