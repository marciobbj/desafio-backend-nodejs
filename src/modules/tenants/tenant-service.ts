import { eq } from "drizzle-orm";
import type { DbClient } from "../../db/client.js";
import { tenantChannels, tenants } from "../../db/schema.js";
import { config } from "../../lib/config.js";

export async function ensureDefaultTenant(db: DbClient) {
  const existing = await db.query.tenantChannels.findFirst({
    where: eq(tenantChannels.phoneNumberId, config.META_PHONE_NUMBER_ID),
    with: {
      tenant: true,
    },
  });

  if (existing) {
    return existing.tenant;
  }

  const [tenant] = await db
    .insert(tenants)
    .values({ id: config.DEFAULT_TENANT_ID, name: "NeoFibra" })
    .onConflictDoUpdate({
      target: tenants.id,
      set: {
        name: "NeoFibra",
      },
    })
    .returning();

  if (!tenant) {
    throw new Error("Failed to create default tenant");
  }

  await db.insert(tenantChannels).values({
    tenantId: tenant.id,
    provider: "whatsapp",
    phoneNumberId: config.META_PHONE_NUMBER_ID,
    wabaId: "WABA_TESTE_0001",
    verifyToken: config.META_VERIFY_TOKEN,
  });

  return tenant;
}

export async function resolveTenantByPhoneNumberId(db: DbClient, phoneNumberId: string) {
  return db.query.tenantChannels.findFirst({
    where: eq(tenantChannels.phoneNumberId, phoneNumberId),
    with: {
      tenant: true,
    },
  });
}
