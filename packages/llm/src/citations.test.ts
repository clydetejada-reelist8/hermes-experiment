import { describe, expect, it } from "vitest";
import { validateCitations } from "./citations.js";
import type { RetrievalResult } from "@hermes/knowledge";

function makeChunk(id: string, text: string): RetrievalResult {
  return {
    chunkId: id,
    text,
    sourceType: "ARTIFACT_VERSION",
    artifactVersionId: "av-1",
    chunkIndex: 0,
    semanticScore: 0.9,
    keywordScore: 0.5,
    knowledgeStatus: "REFERENCE",
    dataSensitivity: "NORMAL",
    scope: "TEAM",
  };
}

describe("validateCitations", () => {
  it("passes when all citations reference chunks in the context", () => {
    const chunks = [makeChunk("c1", "Q3 revenue was $1.2M.")];
    const answer = "The Q3 revenue was $1.2M [c1].";
    const result = validateCitations(answer, chunks);
    expect(result.valid).toBe(true);
    expect(result.unsupportedCitations).toEqual([]);
  });

  it("fails when a citation references a chunk not in the context", () => {
    const chunks = [makeChunk("c1", "Q3 revenue was $1.2M.")];
    const answer = "The revenue was $1.2M [c1] and Q4 was $2M [c2].";
    const result = validateCitations(answer, chunks);
    expect(result.valid).toBe(false);
    expect(result.unsupportedCitations).toContain("c2");
  });

  it("fails when the answer has no citations at all", () => {
    const chunks = [makeChunk("c1", "Q3 revenue was $1.2M.")];
    const answer = "The Q3 revenue was $1.2M.";
    const result = validateCitations(answer, chunks);
    expect(result.valid).toBe(false);
    expect(result.missingCitations).toBe(true);
  });

  it("passes when answer has citations and all are supported", () => {
    const chunks = [makeChunk("c1", "Revenue $1.2M."), makeChunk("c2", "Q4 was $2M.")];
    const answer = "Q3 was $1.2M [c1] and Q4 was $2M [c2].";
    const result = validateCitations(answer, chunks);
    expect(result.valid).toBe(true);
  });

  it("extracts all citation IDs from the answer", () => {
    const chunks = [makeChunk("c1", "a"), makeChunk("c2", "b"), makeChunk("c3", "c")];
    const answer = "Fact A [c1]. Fact B [c2]. Fact C [c3].";
    const result = validateCitations(answer, chunks);
    expect(result.citedIds).toEqual(["c1", "c2", "c3"]);
  });
});
