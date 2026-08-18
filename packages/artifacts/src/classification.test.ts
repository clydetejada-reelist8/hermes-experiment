import { describe, expect, it } from "vitest";
import { classifySubmission } from "./classification.js";

describe("classifySubmission", () => {
  it("classifies a personal document as PERSONAL/NORMAL", () => {
    const result = classifySubmission({
      filename: "my-notes.txt",
      mimeType: "text/plain",
      content: "Personal meeting notes from today.",
      submittedByEmployeeId: "emp-1",
    });
    expect(result.scope).toBe("PERSONAL");
    expect(result.sensitivity).toBe("NORMAL");
    expect(result.knowledgeStatus).toBe("PERSONAL_CONTEXT");
  });

  it("classifies a financial document as SENSITIVE", () => {
    const result = classifySubmission({
      filename: "salary-review.pdf",
      mimeType: "application/pdf",
      content: "Salary compensation review for Q3.",
      submittedByEmployeeId: "emp-1",
    });
    expect(result.sensitivity).toBe("SENSITIVE");
  });

  it("classifies a document with SSN as HIGHLY_SENSITIVE", () => {
    const result = classifySubmission({
      filename: "tax-form.pdf",
      mimeType: "application/pdf",
      content: "SSN: 123-45-6789 for tax filing.",
      submittedByEmployeeId: "emp-1",
    });
    expect(result.sensitivity).toBe("HIGHLY_SENSITIVE");
  });

  it("defaults to PERSONAL scope when no team/project context", () => {
    const result = classifySubmission({
      filename: "report.pdf",
      mimeType: "application/pdf",
      content: "Quarterly business report.",
      submittedByEmployeeId: "emp-1",
    });
    expect(result.scope).toBe("PERSONAL");
  });

  it("assigns REFERENCE knowledge status for non-personal content", () => {
    const result = classifySubmission({
      filename: "company-handbook.pdf",
      mimeType: "application/pdf",
      content: "The company handbook outlines all policies.",
      submittedByEmployeeId: "emp-1",
    });
    expect(result.knowledgeStatus).toBe("REFERENCE");
  });
});
