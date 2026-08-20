import type { Employee } from "@hermes/db";

export type { Employee };

export interface EmployeeProfile {
  company: "REELIST8";
  roles: string[];
  teams: string[];
  projects: string[];
  manager: string | null;
  capabilities: string[];
  linkedIdentities: Array<{ provider: string; subjectId: string }>;
}

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
