import { db } from "@hermes/db";
import type { IdentityProvider } from "@hermes/contracts";

export interface ClaimResult {
  alreadyProcessed: boolean;
}

/**
 * Idempotent inbound event claim. Inserts an `InboundEventReceipt` row; if the
 * (provider, providerEventId) pair already exists, the unique constraint fails
 * and the event is treated as already processed.
 *
 * This is the first line of defense against Discord redelivering the same
 * interaction or message event. Every inbound Discord event must be claimed
 * before any further processing.
 */
export async function tryClaimInboundEvent(
  provider: IdentityProvider,
  providerEventId: string,
  kind: string,
): Promise<ClaimResult> {
  try {
    await db.inboundEventReceipt.create({
      data: { provider, providerEventId, kind },
    });
    return { alreadyProcessed: false };
  } catch (err: unknown) {
    // Prisma P2002 = unique constraint violation.
    if (
      typeof err === "object" &&
      err !== null &&
      "code" in err &&
      (err as { code: string }).code === "P2002"
    ) {
      return { alreadyProcessed: true };
    }
    throw err;
  }
}
