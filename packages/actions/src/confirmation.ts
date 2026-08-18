import { createHash } from "node:crypto";
import { db } from "@hermes/db";
import type { Action } from "@hermes/db";

/**
 * Compute a deterministic SHA-256 hash of an action's parameters.
 *
 * This hash is stored on ActionConfirmation when the user confirms an action.
 * At execution time, the executor verifies that the hash on the latest
 * confirmation matches the hash of the action's current parameters. If the
 * parameters changed after confirmation (e.g., the draft was edited), the
 * old confirmation is invalid and execution is blocked (Section 21.3).
 */
export function computeParametersHash(parameters: Record<string, unknown>): string {
  // Sort keys for determinism.
  const sorted = JSON.stringify(parameters, Object.keys(parameters).sort());
  return createHash("sha256").update(sorted).digest("hex");
}

export class ConfirmationError extends Error {
  constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message);
    this.name = "ConfirmationError";
  }
}

/**
 * Verify that an action has a valid confirmation whose parameters hash
 * matches the action's current parameters.
 *
 * Throws ConfirmationError if:
 *   - The action requires confirmation but has none
 *   - The confirmation hash does not match the current parameters
 *
 * Returns the matching confirmation if valid.
 */
export async function verifyConfirmation(action: Action): Promise<void> {
  if (!action.confirmationRequired) return;

  const confirmations = await db.actionConfirmation.findMany({
    where: { actionId: action.id },
    orderBy: { confirmedAt: "desc" },
  });

  if (confirmations.length === 0) {
    throw new ConfirmationError(
      "action requires confirmation but none was provided",
      "NO_CONFIRMATION",
    );
  }

  const currentHash = computeParametersHash(action.parametersJson as Record<string, unknown>);

  const latest = confirmations[0]!;
  if (latest.confirmedParametersHash !== currentHash) {
    throw new ConfirmationError(
      "confirmation hash does not match current action parameters — parameters changed after confirmation",
      "HASH_MISMATCH",
    );
  }
}

/**
 * Record a user confirmation for an action. The parameters hash is captured
 * at confirmation time so that later parameter changes invalidate the
 * confirmation.
 */
export async function recordConfirmation(
  actionId: string,
  employeeId: string,
  parameters: Record<string, unknown>,
  confirmationType: string = "DISCORD_BUTTON",
): Promise<void> {
  const hash = computeParametersHash(parameters);
  await db.actionConfirmation.create({
    data: {
      actionId,
      employeeId,
      confirmationType,
      confirmedParametersHash: hash,
    },
  });
}
