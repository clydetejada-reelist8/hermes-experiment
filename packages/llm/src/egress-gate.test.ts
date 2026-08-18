import { describe, expect, it } from "vitest";
import { validateEgress } from "./egress-gate.js";

describe("validateEgress", () => {
  it("passes for clean output", () => {
    const result = validateEgress("The Q3 revenue was $1.2M based on the report.");
    expect(result.passed).toBe(true);
    expect(result.violations).toEqual([]);
  });

  it("blocks SSNs in model output", () => {
    const result = validateEgress("The employee's SSN is 123-45-6789.");
    expect(result.passed).toBe(false);
    expect(result.violations.length).toBeGreaterThan(0);
    expect(result.violations[0]?.type).toBe("SSN");
  });

  it("blocks credit card numbers in model output", () => {
    const result = validateEgress("Card: 4532-1234-5678-9012");
    expect(result.passed).toBe(false);
    expect(result.violations[0]?.type).toBe("CREDIT_CARD");
  });

  it("blocks API keys in model output", () => {
    const result = validateEgress("The key is sk-abc123def456ghi789jkl012");
    expect(result.passed).toBe(false);
    expect(result.violations[0]?.type).toBe("API_KEY");
  });

  it("blocks passwords in model output", () => {
    const result = validateEgress("password: hunter2");
    expect(result.passed).toBe(false);
    expect(result.violations[0]?.type).toBe("PASSWORD");
  });

  it("blocks private key blocks in model output", () => {
    const result = validateEgress("BEGIN RSA PRIVATE KEY-----");
    expect(result.passed).toBe(false);
    expect(result.violations[0]?.type).toBe("PRIVATE_KEY");
  });

  it("does not block normal business content", () => {
    const result = validateEgress("The meeting is scheduled for Tuesday at 3pm.");
    expect(result.passed).toBe(true);
  });
});
