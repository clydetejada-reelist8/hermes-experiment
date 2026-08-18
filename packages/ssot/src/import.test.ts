import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { db } from "@hermes/db";
import { createEmployee } from "../../../test/fixtures/db-helpers.js";
import { importSSOTContent } from "./import.js";

describe("importSSOTContent", () => {
  it("creates searchable SSOT chunks and is idempotent", async () => {
    const employee = await createEmployee();
    const domain = `values-${randomUUID()}`;
    const sourceLocator = `/tmp/${domain}/company-values.md`;
    const content = [
      "# The Values Team8s Live By",
      "Mastering Talents with Gratitude & Mindful Growth",
      "The Spirit: We build with humble excellence.",
      "The Actions: Always Refining; Holistic Thinking; Genteel Pride.",
    ].join("\n");

    const first = await importSSOTContent({
      authorityDomain: domain,
      subjectKey: "company-values",
      title: "REELIST8 Company Values",
      content,
      sourceLocator,
      approvedByEmployeeId: employee.id,
    });
    const second = await importSSOTContent({
      authorityDomain: domain,
      subjectKey: "company-values",
      title: "REELIST8 Company Values",
      content,
      sourceLocator,
      approvedByEmployeeId: employee.id,
    });

    expect(first.unchanged).toBe(false);
    expect(first.chunkCount).toBeGreaterThan(0);
    expect(second).toMatchObject({
      recordId: first.recordId,
      versionId: first.versionId,
      versionNumber: first.versionNumber,
      chunkCount: first.chunkCount,
      unchanged: true,
    });
    const chunks = await db.knowledgeChunk.findMany({ where: { ssotVersionId: first.versionId } });
    expect(chunks.some((chunk) => chunk.text.includes("Genteel Pride"))).toBe(true);
  });
});
