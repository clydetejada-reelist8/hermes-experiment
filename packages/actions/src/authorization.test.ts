import { describe, expect, it } from "vitest";
import { createEmployee, grantCapability } from "../../../test/fixtures/db-helpers.js";
import { authorizeActionType, capabilityForActionType } from "./authorization.js";

describe("action authorization", () => {
  it("maps every supported external action to a deterministic capability", () => {
    expect(capabilityForActionType("GMAIL_CREATE_DRAFT")).toBe("GMAIL_DRAFT");
    expect(capabilityForActionType("GMAIL_SEND_DRAFT")).toBe("GMAIL_SEND");
    expect(capabilityForActionType("CALENDAR_FREEBUSY")).toBe("CALENDAR_FREEBUSY");
    expect(capabilityForActionType("CALENDAR_CREATE_PERSONAL_EVENT")).toBe(
      "CALENDAR_CREATE_PERSONAL_EVENT",
    );
    expect(capabilityForActionType("CALENDAR_CREATE_MEETING")).toBe("CALENDAR_INVITE_OTHERS");
    expect(capabilityForActionType("CALENDAR_UPDATE_EVENT")).toBe("CALENDAR_UPDATE_EVENT");
    expect(capabilityForActionType("CALENDAR_CANCEL_EVENT")).toBe("CALENDAR_CANCEL_EVENT");
    expect(capabilityForActionType("REMINDER_CREATE")).toBe("REMINDERS_WRITE");
  });

  it("denies action preparation without the mapped capability", async () => {
    const employee = await createEmployee();
    await expect(authorizeActionType(employee.id, "GMAIL_SEND_DRAFT")).rejects.toThrow(
      "action_capability_denied",
    );
  });

  it("allows action preparation with the mapped capability", async () => {
    const employee = await createEmployee();
    await grantCapability(employee.id, "GMAIL_DRAFT");
    await expect(authorizeActionType(employee.id, "GMAIL_CREATE_DRAFT")).resolves.toBeUndefined();
  });

  it("denies an employee with only draft capability from preparing or executing a send", async () => {
    const employee = await createEmployee();
    await grantCapability(employee.id, "GMAIL_DRAFT");
    await expect(authorizeActionType(employee.id, "GMAIL_SEND_DRAFT")).rejects.toThrow(
      "action_capability_denied",
    );
    await expect(authorizeActionType(employee.id, "GMAIL_SEND_DRAFT")).rejects.toThrow(
      "action_capability_denied",
    );
  });
});
