import { describe, expect, it } from "vitest";
import { classifySensitivity } from "./sensitivity.js";

describe("classifySensitivity", () => {
  it("classifies public company info as NORMAL", () => {
    const result = classifySensitivity("The company was founded in 2015.");
    expect(result).toBe("NORMAL");
  });

  it("classifies salary information as SENSITIVE", () => {
    const result = classifySensitivity("The employee's salary is $120,000 per year.");
    expect(result).toBe("SENSITIVE");
  });

  it("classifies SSN as HIGHLY_SENSITIVE", () => {
    const result = classifySensitivity("My SSN is 123-45-6789.");
    expect(result).toBe("HIGHLY_SENSITIVE");
  });

  it("classifies credit card numbers as HIGHLY_SENSITIVE", () => {
    const result = classifySensitivity("Card number: 4532-1234-5678-9012");
    expect(result).toBe("HIGHLY_SENSITIVE");
  });

  it("classifies health/medical info as SENSITIVE", () => {
    const result = classifySensitivity("The employee is on medical leave for surgery.");
    expect(result).toBe("SENSITIVE");
  });

  it("classifies performance reviews as SENSITIVE", () => {
    const result = classifySensitivity(
      "The performance review rated them as exceeds expectations.",
    );
    expect(result).toBe("SENSITIVE");
  });

  it("classifies bank account info as HIGHLY_SENSITIVE", () => {
    const result = classifySensitivity("Bank account: 123456789, routing: 021000021");
    expect(result).toBe("HIGHLY_SENSITIVE");
  });

  it("classifies passwords as HIGHLY_SENSITIVE", () => {
    const result = classifySensitivity("The password is hunter2");
    expect(result).toBe("HIGHLY_SENSITIVE");
  });

  it("classifies API keys as HIGHLY_SENSITIVE", () => {
    const result = classifySensitivity("API key: sk-abc123def456ghi789");
    expect(result).toBe("HIGHLY_SENSITIVE");
  });

  it("defaults to NORMAL for non-matching content", () => {
    const result = classifySensitivity("The meeting is at 3pm on Tuesday.");
    expect(result).toBe("NORMAL");
  });
});
