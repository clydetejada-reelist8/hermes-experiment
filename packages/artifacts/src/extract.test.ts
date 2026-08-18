import { describe, expect, it } from "vitest";
import { extractText } from "./extract.js";

describe("artifact text extraction", () => {
  it("extracts supported text-like uploads without changing content", () => {
    expect(extractText(Buffer.from("# Notes\n\nRevenue is stable."), "text/markdown", "notes.md")).toBe(
      "# Notes\n\nRevenue is stable.",
    );
    expect(extractText(Buffer.from("name,value\nSales,10"), "text/csv", "data.csv")).toContain("Sales,10");
  });

  it("rejects unsupported binary formats instead of treating bytes as text", () => {
    expect(() => extractText(Buffer.from([0, 159, 255]), "application/pdf", "file.pdf")).toThrow(
      "text_extraction_not_implemented",
    );
  });
});
