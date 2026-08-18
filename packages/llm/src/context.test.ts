import { describe, expect, it } from "vitest";
import { buildContext } from "./context.js";
import type { RetrievalResult } from "@hermes/knowledge";
import type { PersonalMemory } from "@hermes/db";

function makeChunk(overrides: Partial<RetrievalResult> = {}): RetrievalResult {
  return {
    chunkId: "chunk-1",
    text: "The Q3 revenue was $1.2M.",
    sourceType: "ARTIFACT_VERSION",
    artifactVersionId: "av-1",
    chunkIndex: 0,
    semanticScore: 0.9,
    keywordScore: 0.5,
    knowledgeStatus: "REFERENCE",
    dataSensitivity: "NORMAL",
    scope: "TEAM",
    ...overrides,
  };
}

function makeMemory(overrides: Partial<PersonalMemory> = {}): PersonalMemory {
  return {
    id: "mem-1",
    employeeId: "emp-1",
    type: "PREFERENCE",
    content: "Prefers concise answers.",
    normalizedKey: null,
    sourceConversationId: null,
    sourceMessageId: null,
    sourceArtifactId: null,
    confidence: 1n,
    sensitivity: "NORMAL",
    status: "ACTIVE",
    createdAt: new Date(),
    lastConfirmedAt: null,
    expiresAt: null,
    deletedAt: null,
    ...overrides,
  };
}

describe("buildContext", () => {
  it("assembles chunks and memories into a context string", () => {
    const chunks = [makeChunk()];
    const memories = [makeMemory()];
    const ctx = buildContext({
      chunks,
      memories,
      query: "What was Q3 revenue?",
      employeeName: "Alice",
    });
    expect(ctx).toContain("Q3 revenue");
    expect(ctx).toContain("Prefers concise answers");
    expect(ctx).toContain("Alice");
  });

  it("includes citation markers for each chunk", () => {
    const chunks = [
      makeChunk({ chunkId: "c1" }),
      makeChunk({ chunkId: "c2", text: "Q4 was $2M." }),
    ];
    const ctx = buildContext({
      chunks,
      memories: [],
      query: "revenue",
      employeeName: "Alice",
    });
    expect(ctx).toContain("[c1]");
    expect(ctx).toContain("[c2]");
  });

  it("excludes SENSITIVE memories by default", () => {
    const memories = [
      makeMemory({ id: "m1", content: "Public note.", sensitivity: "NORMAL" }),
      makeMemory({ id: "m2", content: "Salary is $90k.", sensitivity: "SENSITIVE" }),
    ];
    const ctx = buildContext({
      chunks: [],
      memories,
      query: "notes",
      employeeName: "Alice",
    });
    expect(ctx).toContain("Public note.");
    expect(ctx).not.toContain("Salary is $90k.");
  });

  it("includes SENSITIVE memories when authorized", () => {
    const memories = [
      makeMemory({ id: "m2", content: "Salary is $90k.", sensitivity: "SENSITIVE" }),
    ];
    const ctx = buildContext({
      chunks: [],
      memories,
      query: "salary",
      employeeName: "Alice",
      includeSensitiveMemories: true,
    });
    expect(ctx).toContain("Salary is $90k.");
  });

  it("never includes HIGHLY_SENSITIVE memories", () => {
    const memories = [
      makeMemory({ id: "m3", content: "SSN: 123-45-6789", sensitivity: "HIGHLY_SENSITIVE" }),
    ];
    const ctx = buildContext({
      chunks: [],
      memories,
      query: "ssn",
      employeeName: "Alice",
      includeSensitiveMemories: true,
    });
    expect(ctx).not.toContain("SSN");
  });
});
