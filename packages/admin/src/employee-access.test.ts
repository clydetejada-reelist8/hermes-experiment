import { describe, expect, it } from "vitest";
import {
  assertAdminManagementAllowed,
  assertAdminPrivilegeConfirmation,
  assertStagingBootstrapEnvironment,
} from "./employee-access.js";
import {
  ADMIN_MANAGEABLE_ROLES,
  STAGING_ADMIN_ROLE,
  STAGING_APPROVER_ROLE,
  STAGING_REVIEW_ROLE,
  getStagingRoleCapabilities,
} from "./employee-access.js";

describe("employee access administration policy", () => {
  it("rejects a normal employee from granting roles", () => {
    expect(() => assertAdminManagementAllowed(new Set(["KNOWLEDGE_READ_COMPANY"]))).toThrow(
      "admin_capability_required",
    );
  });

  it("rejects an SSOT reviewer from making themselves an approver", () => {
    expect(() =>
      assertAdminManagementAllowed(new Set(["SSOT_REVIEW"]), {
        targetIsRequester: true,
        targetRoleKey: "staging-ssot-approver",
      }),
    ).toThrow("admin_capability_required");
  });

  it("allows an administrator to grant a permitted staging role", () => {
    expect(() =>
      assertAdminManagementAllowed(new Set(["HERMES_ADMIN"]), {
        targetIsRequester: false,
        targetRoleKey: "staging-company-reader",
      }),
    ).not.toThrow();
    expect(ADMIN_MANAGEABLE_ROLES.has(STAGING_ADMIN_ROLE)).toBe(true);
  });

  it("requires SSOT proposal capability for staging reviewers and approvers", () => {
    expect(getStagingRoleCapabilities(STAGING_REVIEW_ROLE)).toEqual(
      expect.arrayContaining(["SSOT_REVIEW", "SSOT_PROPOSE"]),
    );
    expect(getStagingRoleCapabilities(STAGING_APPROVER_ROLE)).toEqual(
      expect.arrayContaining(["SSOT_APPROVE", "SSOT_PROPOSE"]),
    );
  });

  it("requires explicit confirmation for administrator escalation", () => {
    expect(() => assertAdminPrivilegeConfirmation(false)).toThrow(
      "admin_escalation_confirmation_required",
    );
    expect(() => assertAdminPrivilegeConfirmation(true)).not.toThrow();
  });

  it("requires an explicit staging bootstrap flag and staging database", () => {
    expect(() =>
      assertStagingBootstrapEnvironment({
        allowFlag: "0",
        databaseUrl: "postgresql://localhost/hermes_staging",
      }),
    ).toThrow("staging_bootstrap_flag_required");
    expect(() =>
      assertStagingBootstrapEnvironment({
        allowFlag: "1",
        databaseUrl: "postgresql://localhost/hermes_production",
      }),
    ).toThrow("staging_database_required");
    expect(() =>
      assertStagingBootstrapEnvironment({
        allowFlag: "1",
        databaseUrl: "postgresql://localhost/hermes_staging",
      }),
    ).not.toThrow();
  });
});
