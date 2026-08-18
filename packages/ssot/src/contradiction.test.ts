import { describe, expect, it } from "vitest";
import { detectContradictions } from "./contradiction.js";

describe("detectContradictions", () => {
  it("returns no contradictions when content aligns with SSOT", () => {
    const ssotContent = "Deployments must be approved by the team lead.";
    const newContent = "The team lead approves all deployments.";
    const result = detectContradictions(newContent, [ssotContent]);
    expect(result.contradictions).toEqual([]);
  });

  it("detects direct negation contradictions", () => {
    const ssotContent = "All PRs must be reviewed by at least one engineer.";
    const newContent = "PRs do not need to be reviewed by any engineer.";
    const result = detectContradictions(newContent, [ssotContent]);
    expect(result.contradictions.length).toBeGreaterThan(0);
    expect(result.contradictions[0]?.type).toBe("NEGATION");
  });

  it("detects conflicting numeric values", () => {
    const ssotContent = "The minimum vacation days is 15 per year.";
    const newContent = "The minimum vacation days is 10 per year.";
    const result = detectContradictions(newContent, [ssotContent]);
    expect(result.contradictions.length).toBeGreaterThan(0);
    expect(result.contradictions[0]?.type).toBe("NUMERIC_CONFLICT");
  });

  it("detects conflicting mandatory/optional rules", () => {
    const ssotContent = "Timesheets must be submitted weekly.";
    const newContent = "Timesheets are optional and can be skipped.";
    const result = detectContradictions(newContent, [ssotContent]);
    expect(result.contradictions.length).toBeGreaterThan(0);
  });

  it("returns no contradictions for unrelated content", () => {
    const ssotContent = "Deployments require approval.";
    const newContent = "The office is closed on holidays.";
    const result = detectContradictions(newContent, [ssotContent]);
    expect(result.contradictions).toEqual([]);
  });

  it("checks against multiple SSOT records", () => {
    const ssotContents = ["Standup minimum 1 per week.", "Deployments require approval."];
    const newContent = "Standup minimum 2 per week.";
    const result = detectContradictions(newContent, ssotContents);
    expect(result.contradictions.length).toBeGreaterThan(0);
    expect(result.contradictions[0]?.ssotIndex).toBe(0);
  });

  it("flags contradictions for review without blocking", () => {
    const ssotContent = "All code must be tested.";
    const newContent = "Code does not need to be tested.";
    const result = detectContradictions(newContent, [ssotContent]);
    expect(result.requiresReview).toBe(true);
  });
});
