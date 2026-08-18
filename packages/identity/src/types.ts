import type { Employee } from "@hermes/db";

export type { Employee };

/** Reason codes for identity resolution failures. */
export type IdentityDenialReason = "IDENTITY_NOT_FOUND" | "EMPLOYEE_INACTIVE" | "NOT_ALLOWLISTED";

export class IdentityDeniedError extends Error {
  constructor(
    public readonly reason: IdentityDenialReason,
    message?: string,
  ) {
    super(message ?? reason);
    this.name = "IdentityDeniedError";
  }
}
