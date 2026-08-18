import { describe, expect, it } from "vitest";
import { parseActionProposal, validateProposal, type ParsedProposal } from "./proposals.js";

describe("parseActionProposal", () => {
  it("parses a Gmail draft proposal", () => {
    const proposal = parseActionProposal({
      actionType: "GMAIL_CREATE_DRAFT",
      parameters: {
        to: "client@example.com",
        subject: "Project Update",
        body: "Here is the latest update on the project.",
      },
    });
    expect(proposal.actionType).toBe("GMAIL_CREATE_DRAFT");
    expect(proposal.parameters.to).toBe("client@example.com");
    expect(proposal.riskLevel).toBe("LOW");
  });

  it("parses a Gmail send proposal as HIGH risk", () => {
    const proposal = parseActionProposal({
      actionType: "GMAIL_SEND_DRAFT",
      parameters: { draftId: "draft-123" },
    });
    expect(proposal.riskLevel).toBe("HIGH");
    expect(proposal.confirmationRequired).toBe(true);
  });

  it("parses a calendar meeting proposal as HIGH risk", () => {
    const proposal = parseActionProposal({
      actionType: "CALENDAR_CREATE_MEETING",
      parameters: {
        summary: "Team Sync",
        start: "2024-01-01T14:00:00Z",
        end: "2024-01-01T15:00:00Z",
        attendees: ["a@example.com", "b@example.com"],
      },
    });
    expect(proposal.riskLevel).toBe("HIGH");
    expect(proposal.confirmationRequired).toBe(true);
  });

  it("parses a calendar personal event as MEDIUM risk", () => {
    const proposal = parseActionProposal({
      actionType: "CALENDAR_CREATE_PERSONAL_EVENT",
      parameters: {
        summary: "Focus Time",
        start: "2024-01-01T14:00:00Z",
        end: "2024-01-01T15:00:00Z",
      },
    });
    expect(proposal.riskLevel).toBe("MEDIUM");
    expect(proposal.confirmationRequired).toBe(false);
  });

  it("parses a reminder proposal as LOW risk", () => {
    const proposal = parseActionProposal({
      actionType: "REMINDER_CREATE",
      parameters: {
        text: "Submit timesheet",
        dueAt: "2024-01-01T17:00:00Z",
        timezone: "America/Los_Angeles",
      },
    });
    expect(proposal.riskLevel).toBe("LOW");
  });

  it("rejects unknown action types", () => {
    expect(() =>
      parseActionProposal({
        actionType: "UNKNOWN_ACTION",
        parameters: {},
      }),
    ).toThrow();
  });
});

describe("validateProposal", () => {
  it("validates a Gmail draft proposal with all required fields", () => {
    const proposal: ParsedProposal = {
      actionType: "GMAIL_CREATE_DRAFT",
      parameters: { to: "test@example.com", subject: "Test", body: "Body" },
      riskLevel: "LOW",
      confirmationRequired: false,
    };
    const result = validateProposal(proposal);
    expect(result.valid).toBe(true);
  });

  it("rejects a Gmail draft without a recipient", () => {
    const proposal: ParsedProposal = {
      actionType: "GMAIL_CREATE_DRAFT",
      parameters: { subject: "Test", body: "Body" },
      riskLevel: "LOW",
      confirmationRequired: false,
    };
    const result = validateProposal(proposal);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("missing required field: to");
  });

  it("rejects a Gmail draft with invalid email", () => {
    const proposal: ParsedProposal = {
      actionType: "GMAIL_CREATE_DRAFT",
      parameters: { to: "not-an-email", subject: "Test", body: "Body" },
      riskLevel: "LOW",
      confirmationRequired: false,
    };
    const result = validateProposal(proposal);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("invalid email"))).toBe(true);
  });

  it("validates a calendar event with valid date range", () => {
    const proposal: ParsedProposal = {
      actionType: "CALENDAR_CREATE_PERSONAL_EVENT",
      parameters: {
        summary: "Focus",
        start: "2024-01-01T14:00:00Z",
        end: "2024-01-01T15:00:00Z",
      },
      riskLevel: "MEDIUM",
      confirmationRequired: false,
    };
    const result = validateProposal(proposal);
    expect(result.valid).toBe(true);
  });

  it("rejects a calendar event where end is before start", () => {
    const proposal: ParsedProposal = {
      actionType: "CALENDAR_CREATE_PERSONAL_EVENT",
      parameters: {
        summary: "Bad times",
        start: "2024-01-01T15:00:00Z",
        end: "2024-01-01T14:00:00Z",
      },
      riskLevel: "MEDIUM",
      confirmationRequired: false,
    };
    const result = validateProposal(proposal);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("end before start"))).toBe(true);
  });

  it("rejects a meeting without attendees", () => {
    const proposal: ParsedProposal = {
      actionType: "CALENDAR_CREATE_MEETING",
      parameters: {
        summary: "Meeting",
        start: "2024-01-01T14:00:00Z",
        end: "2024-01-01T15:00:00Z",
        attendees: [],
      },
      riskLevel: "HIGH",
      confirmationRequired: true,
    };
    const result = validateProposal(proposal);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("attendees"))).toBe(true);
  });

  it("rejects proposals with injection attempts in email fields", () => {
    const proposal: ParsedProposal = {
      actionType: "GMAIL_CREATE_DRAFT",
      parameters: {
        to: "test@example.com\r\nBcc: attacker@evil.com",
        subject: "Test",
        body: "Body",
      },
      riskLevel: "LOW",
      confirmationRequired: false,
    };
    const result = validateProposal(proposal);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("injection"))).toBe(true);
  });
});
