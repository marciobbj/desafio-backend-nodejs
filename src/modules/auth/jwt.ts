import type { FastifyRequest } from "fastify";

export type AuthClaims = {
  sub: string;
  tenantId: string;
  role?: string;
  exp?: number;
};

export async function getAuthClaims(request: FastifyRequest) {
  await request.jwtVerify<AuthClaims>();
  return request.user as AuthClaims;
}
