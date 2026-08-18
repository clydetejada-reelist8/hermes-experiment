import { describe, expect, it, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { db } from "@hermes/db";
import type { Capability } from "@hermes/contracts";
import {
  canExecuteAction,
  canPrepareAction,
  evaluateCapability,
  evaluateHermesScope,
  requiresConfirmation,
} from "./index.js";

async function seedEmployeeWithCapabilities(
  capabilities: Capability[],
  opts: { allowlisted?: boolean; status?: "ACTIVE" | "SUSPENDED" | "TERMINATED" } = {},
) {
  const id = randomUUID();
  const suffix = id.slice(0, 8);
  const emp = await db.employee.create({
    data: {
      id,
      employeeCode: `EMP-${suffix}`,
      displayName: `Test ${suffix}`,
      companyEmail: `test-${suffix}@reelist8.example`,
      timezone: "Asia/Manila",
      employmentStatus: opts.status ?? "ACTIVE",
      stagingAllowlisted: opts.allowlisted ?? true,
    },
  });
  if (capabilities.length > 0) {
    const role = await db.role.create({
      data: { key: `role-${suffix}`, name: "Test role" },
    });
    await db.employeeRole.create({ data: { employeeId: id, roleId: role.id } });
    await db.roleCapability.createMany({
      data: capabilities.map((capability) => ({ roleId: role.id, capability })),
    });
  }
  return emp;
}

describe("evaluateCapability", () => {
  it("allows when the employee has the required capability", async () => {
    const emp = await seedEmployeeWithCapabilities(["KNOWLEDGE_READ_PERSONAL"]);
    const decision = await evaluateCapability(emp.id, "KNOWLEDGE_READ_PERSONAL");
    expect(decision.allowed).toBe(true);
    expect(decision.reasonCode).toBe("ALLOWED");
  });

  it("denies when the employee lacks the required capability", async () => {
    const emp = await seedEmployeeWithCapabilities(["KNOWLEDGE_READ_PERSONAL"]);
    const decision = await evaluateCapability(emp.id, "SSOT_APPROVE");
    expect(decision.allowed).toBe(false);
    expect(decision.reasonCode).toBe("MISSING_CAPABILITY");
  });

  it("denies when the employee is inactive even with the capability", async () => {
    const emp = await seedEmployeeWithCapabilities(["KNOWLEDGE_READ_PERSONAL"], {
      status: "SUSPENDED",
    });
    const decision = await evaluateCapability(emp.id, "KNOWLEDGE_READ_PERSONAL");
    expect(decision.allowed).toBe(false);
    expect(decision.reasonCode).toBe("EMPLOYEE_INACTIVE");
  });

  it("denies when the employee is not allowlisted even with the capability", async () => {
    const emp = await seedEmployeeWithCapabilities(["KNOWLEDGE_READ_PERSONAL"], {
      allowlisted: false,
    });
    const decision = await evaluateCapability(emp.id, "KNOWLEDGE_READ_PERSONAL");
    expect(decision.allowed).toBe(false);
    expect(decision.reasonCode).toBe("NOT_ALLOWLISTED");
  });

  it("denies when the employee does not exist", async () => {
    const decision = await evaluateCapability(randomUUID(), "KNOWLEDGE_READ_PERSONAL");
    expect(decision.allowed).toBe(false);
    expect(decision.reasonCode).toBe("EMPLOYEE_INACTIVE");
  });
});

describe("evaluateHermesScope", () => {
  it("allows a PERSONAL scope read for the owner", async () => {
    const emp = await seedEmployeeWithCapabilities(["KNOWLEDGE_READ_PERSONAL"]);
    const decision = await evaluateHermesScope({
      employeeId: emp.id,
      scope: "PERSONAL",
      ownerEmployeeId: emp.id,
      capability: "KNOWLEDGE_READ_PERSONAL",
    });
    expect(decision.allowed).toBe(true);
  });

  it("denies a PERSONAL scope read for a non-owner", async () => {
    const emp = await seedEmployeeWithCapabilities(["KNOWLEDGE_READ_PERSONAL"]);
    const other = await seedEmployeeWithCapabilities(["KNOWLEDGE_READ_PERSONAL"]);
    const decision = await evaluateHermesScope({
      employeeId: emp.id,
      scope: "PERSONAL",
      ownerEmployeeId: other.id,
      capability: "KNOWLEDGE_READ_PERSONAL",
    });
    expect(decision.allowed).toBe(false);
    expect(decision.reasonCode).toBe("AUDIENCE_DENIED");
  });

  it("allows a TEAM scope read for a team member with the capability", async () => {
    const emp = await seedEmployeeWithCapabilities(["KNOWLEDGE_READ_TEAM"]);
    const team = await db.team.create({ data: { name: `Team ${randomUUID().slice(0, 6)}` } });
    await db.employeeTeam.create({ data: { employeeId: emp.id, teamId: team.id } });
    const decision = await evaluateHermesScope({
      employeeId: emp.id,
      scope: "TEAM",
      teamId: team.id,
      capability: "KNOWLEDGE_READ_TEAM",
    });
    expect(decision.allowed).toBe(true);
  });

  it("denies a TEAM scope read for a non-team-member", async () => {
    const emp = await seedEmployeeWithCapabilities(["KNOWLEDGE_READ_TEAM"]);
    const team = await db.team.create({ data: { name: `Team ${randomUUID().slice(0, 6)}` } });
    const decision = await evaluateHermesScope({
      employeeId: emp.id,
      scope: "TEAM",
      teamId: team.id,
      capability: "KNOWLEDGE_READ_TEAM",
    });
    expect(decision.allowed).toBe(false);
    expect(decision.reasonCode).toBe("AUDIENCE_DENIED");
  });

  it("allows a COMPANY scope read with the company capability", async () => {
    const emp = await seedEmployeeWithCapabilities(["KNOWLEDGE_READ_COMPANY"]);
    const decision = await evaluateHermesScope({
      employeeId: emp.id,
      scope: "COMPANY",
      capability: "KNOWLEDGE_READ_COMPANY",
    });
    expect(decision.allowed).toBe(true);
  });

  it("denies when the underlying capability is missing even if scope matches", async () => {
    const emp = await seedEmployeeWithCapabilities([]);
    const decision = await evaluateHermesScope({
      employeeId: emp.id,
      scope: "COMPANY",
      capability: "KNOWLEDGE_READ_COMPANY",
    });
    expect(decision.allowed).toBe(false);
    expect(decision.reasonCode).toBe("MISSING_CAPABILITY");
  });
});

describe("canPrepareAction", () => {
  it("allows GMAIL_CREATE_DRAFT with the GMAIL_DRAFT capability", async () => {
    const emp = await seedEmployeeWithCapabilities(["GMAIL_DRAFT"]);
    const decision = await canPrepareAction(emp.id, "GMAIL_CREATE_DRAFT");
    expect(decision.allowed).toBe(true);
    expect(decision.reasonCode).toBe("ALLOWED");
  });

  it("denies GMAIL_CREATE_DRAFT without the GMAIL_DRAFT capability", async () => {
    const emp = await seedEmployeeWithCapabilities([]);
    const decision = await canPrepareAction(emp.id, "GMAIL_CREATE_DRAFT");
    expect(decision.allowed).toBe(false);
    expect(decision.reasonCode).toBe("MISSING_CAPABILITY");
  });

  it("allows GMAIL_SEND_DRAFT with the GMAIL_SEND capability", async () => {
    const emp = await seedEmployeeWithCapabilities(["GMAIL_SEND"]);
    const decision = await canPrepareAction(emp.id, "GMAIL_SEND_DRAFT");
    expect(decision.allowed).toBe(true);
    expect(decision.reasonCode).toBe("ALLOWED");
  });
});

describe("canExecuteAction", () => {
  const originalAllowlist = process.env.STAGING_EMAIL_RECIPIENT_ALLOWLIST;
  afterEach(() => {
    if (originalAllowlist === undefined) {
      delete process.env.STAGING_EMAIL_RECIPIENT_ALLOWLIST;
    } else {
      process.env.STAGING_EMAIL_RECIPIENT_ALLOWLIST = originalAllowlist;
    }
  });

  it("denies GMAIL_SEND_DRAFT with a non-allowlisted recipient", async () => {
    const emp = await seedEmployeeWithCapabilities(["GMAIL_SEND"]);
    process.env.STAGING_EMAIL_RECIPIENT_ALLOWLIST = "allowed@example.com";
    const decision = await canExecuteAction(emp.id, "GMAIL_SEND_DRAFT", {
      draftId: "draft-1",
      to: "blocked@example.com",
    });
    expect(decision.allowed).toBe(false);
    expect(decision.reasonCode).toBe("RECIPIENT_NOT_ALLOWLISTED");
  });

  it("allows GMAIL_SEND_DRAFT with an allowlisted recipient", async () => {
    const emp = await seedEmployeeWithCapabilities(["GMAIL_SEND"]);
    process.env.STAGING_EMAIL_RECIPIENT_ALLOWLIST = "allowed@example.com";
    const decision = await canExecuteAction(emp.id, "GMAIL_SEND_DRAFT", {
      draftId: "draft-1",
      to: "allowed@example.com",
    });
    expect(decision.allowed).toBe(true);
    expect(decision.reasonCode).toBe("ALLOWED");
  });
});

describe("requiresConfirmation", () => {
  it("returns true for GMAIL_SEND_DRAFT", () => {
    expect(requiresConfirmation("GMAIL_SEND_DRAFT")).toBe(true);
  });

  it("returns true for CALENDAR_CREATE_MEETING", () => {
    expect(requiresConfirmation("CALENDAR_CREATE_MEETING")).toBe(true);
  });

  it("returns false for GMAIL_CREATE_DRAFT", () => {
    expect(requiresConfirmation("GMAIL_CREATE_DRAFT")).toBe(false);
  });

  it("returns false for CALENDAR_FREEBUSY", () => {
    expect(requiresConfirmation("CALENDAR_FREEBUSY")).toBe(false);
  });
});
