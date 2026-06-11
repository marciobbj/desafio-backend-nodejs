import "dotenv/config";
import { createHmac } from "node:crypto";
import { config } from "../lib/config.js";

function base64Url(input: Buffer | string) {
  return Buffer.from(input).toString("base64url");
}

function sign(payload: Record<string, unknown>) {
  const header = {
    alg: "HS256",
    typ: "JWT",
  };

  const encodedHeader = base64Url(JSON.stringify(header));
  const encodedPayload = base64Url(JSON.stringify(payload));
  const signature = createHmac("sha256", config.JWT_SECRET)
    .update(`${encodedHeader}.${encodedPayload}`)
    .digest("base64url");

  return `${encodedHeader}.${encodedPayload}.${signature}`;
}

const now = Math.floor(Date.now() / 1000);
const tenantId = process.argv[2] ?? config.DEFAULT_TENANT_ID;

const token = sign({
  sub: "dev-user",
  tenantId,
  role: "admin",
  iat: now,
  exp: now + 60 * 60 * 24 * 7,
});

console.log(token);
