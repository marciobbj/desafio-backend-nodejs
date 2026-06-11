export function buildInboundMessageJobId(job: { tenantId: string; waMessageId: string }) {
  return `${job.tenantId}__${job.waMessageId}`;
}
