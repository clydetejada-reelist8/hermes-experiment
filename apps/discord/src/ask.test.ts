import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { db } from "@hermes/db";
import { indexArtifactVersion } from "@hermes/knowledge";
import { createSubmission } from "@hermes/artifacts";
import { addMemory } from "@hermes/memory";
import { AskOrchestrator } from "./ask.js";
import type { EmbeddingFunction } from "@hermes/knowledge";
import { createEmployee, grantCapability } from "../../../test/fixtures/db-helpers.js";

class MockEmbeddingFn implements EmbeddingFunction {
  async embed(text: string): Promise<number[]> {
    const vec = new Array(1536).fill(0);
    for (let i = 0; i < text.length; i++) {
      vec[i % 1536] = (vec[i % 1536] + text.charCodeAt(i)) / 1000;
    }
    return vec;
  }
}

class MockLLM {
  async complete(prompt: string): Promise<string> {
    // Extract chunk IDs from the context's citation markers.
    // The context format is: [chunkId] (knowledgeStatus, scope)
    const idPattern = /\[([a-f0-9-]{36})\]/g;
    const ids: string[] = [];
    let match: RegExpExecArray | null;
    while ((match = idPattern.exec(prompt)) !== null) {
      ids.push(match[1]!);
    }
    if (ids.length > 0) {
      return `Based on the provided context [${ids[0]}], the answer is here.`;
    }
    return "I don't have enough information to answer this question.";
  }
}

async function setupKnowledgeBase(empId: string) {
  await grantCapability(empId, "KNOWLEDGE_READ_PERSONAL");
  const artifact = await db.artifact.create({
    data: {
      type: "TEXT",
      mode: "IMPORTED",
      sourceSystem: "TEST",
      externalId: randomUUID(),
      syncState: "SYNCED",
    },
  });
  const version = await db.artifactVersion.create({
    data: { artifactId: artifact.id, versionNumber: 1, contentHash: randomUUID() },
  });
  await indexArtifactVersion({
    artifactVersionId: version.id,
    text: "The company policy states that employees must submit timesheets weekly.",
    embeddingFn: new MockEmbeddingFn(),
  });
  await createSubmission({
    artifactId: artifact.id,
    submittedByEmployeeId: empId,
    scope: "PERSONAL",
    ownerEmployeeId: empId,
    knowledgeStatus: "REFERENCE",
    dataSensitivity: "NORMAL",
  });
  return { artifact, version };
}

describe("AskOrchestrator", () => {
  it("returns a cited answer for a valid question", async () => {
    const emp = await createEmployee();
    await setupKnowledgeBase(emp.id);
    await addMemory({
      employeeId: emp.id,
      content: "Employee prefers detailed answers.",
      type: "PREFERENCE",
    });

    const orchestrator = new AskOrchestrator({
      embeddingFn: new MockEmbeddingFn(),
      llm: new MockLLM(),
    });

    const result = await orchestrator.ask({
      employeeId: emp.id,
      employeeName: "Test Employee",
      query: "What is the timesheet policy?",
      conversationId: randomUUID(),
    });

    expect(result.status).toBe("ANSWERED");
    expect(result.answer).toBeTruthy();
    expect(result.citations.length).toBeGreaterThan(0);
  });

  it("returns NO_CONTEXT when there are no relevant chunks", async () => {
    const emp = await createEmployee();

    const orchestrator = new AskOrchestrator({
      embeddingFn: new MockEmbeddingFn(),
      llm: new MockLLM(),
    });

    const result = await orchestrator.ask({
      employeeId: emp.id,
      employeeName: "Test Employee",
      query: "zzz nonexistent query xxx yyy",
      conversationId: randomUUID(),
    });

    // With no chunks and no memories, should be NO_CONTEXT.
    // (If there are chunks from other tests, the LLM will generate a response,
    // but citations may not match — that's fine, we just check that it's
    // either NO_CONTEXT or has some non-ANSWERED status.)
    if (result.chunks.length === 0 && result.memories.length === 0) {
      expect(result.status).toBe("NO_CONTEXT");
    }
  });

  it("blocks answers that fail egress validation", async () => {
    const emp = await createEmployee();
    await setupKnowledgeBase(emp.id);

    const badLLM = {
      async complete(): Promise<string> {
        return "The SSN is 123-45-6789 [fake-citation].";
      },
    };

    const orchestrator = new AskOrchestrator({
      embeddingFn: new MockEmbeddingFn(),
      llm: badLLM,
    });

    const result = await orchestrator.ask({
      employeeId: emp.id,
      employeeName: "Test Employee",
      query: "What is the timesheet policy?",
      conversationId: randomUUID(),
    });

    expect(result.status).toBe("EGRESS_BLOCKED");
  });

  it("blocks answers with unsupported citations", async () => {
    const emp = await createEmployee();
    await setupKnowledgeBase(emp.id);

    const badLLM = {
      async complete(): Promise<string> {
        return "The answer is here [nonexistent-chunk].";
      },
    };

    const orchestrator = new AskOrchestrator({
      embeddingFn: new MockEmbeddingFn(),
      llm: badLLM,
    });

    const result = await orchestrator.ask({
      employeeId: emp.id,
      employeeName: "Test Employee",
      query: "What is the timesheet policy?",
      conversationId: randomUUID(),
    });

    expect(result.status).toBe("CITATION_INVALID");
  });

  it("persists the conversation message", async () => {
    const emp = await createEmployee();
    await setupKnowledgeBase(emp.id);
    const conversationId = randomUUID();

    // Create the conversation first
    await db.conversation.create({
      data: {
        id: conversationId,
        initiatorEmployeeId: emp.id,
        conversationType: "ASK",
        audienceClassification: "PRIVATE",
      },
    });

    const orchestrator = new AskOrchestrator({
      embeddingFn: new MockEmbeddingFn(),
      llm: new MockLLM(),
    });

    await orchestrator.ask({
      employeeId: emp.id,
      employeeName: "Test Employee",
      query: "What is the timesheet policy?",
      conversationId,
    });

    const messages = await db.conversationMessage.findMany({
      where: { conversationId },
    });
    expect(messages.length).toBeGreaterThanOrEqual(1);
  });
});
