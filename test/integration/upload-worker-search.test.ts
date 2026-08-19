import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { db } from "@hermes/db";
import { ingestImportedFile, createSubmission } from "@hermes/artifacts";
import { hybridRetrieve } from "@hermes/knowledge";
import {
  DeterministicEmbeddingFunction,
  processTextArtifact,
} from "../../apps/worker/src/processing.js";
import { createEmployee, grantCapability } from "../fixtures/db-helpers.js";

class MemoryObjectStorage {
  private readonly objects = new Map<string, Buffer>();

  async putObject(_bucket: string, key: string, body: Buffer): Promise<void> {
    this.objects.set(key, body);
  }

  async getObject(_bucket: string, key: string): Promise<Buffer | null> {
    return this.objects.get(key) ?? null;
  }
}

describe("upload to worker to permissioned search", () => {
  it("indexes a text upload and excludes it from an unauthorized employee", async () => {
    const owner = await createEmployee();
    await grantCapability(owner.id, "KNOWLEDGE_READ_PERSONAL");
    const unauthorized = await createEmployee();
    const storage = new MemoryObjectStorage();
    const content = Buffer.from("The restricted launch checklist is stored in Project Atlas.");

    const imported = await ingestImportedFile({
      storage: storage as never,
      bucket: "test",
      submittedByEmployeeId: owner.id,
      originalFilename: "launch-checklist.txt",
      mimeType: "text/plain",
      content,
      sourceSystem: "TEST_UPLOAD",
      externalId: randomUUID(),
    });
    await createSubmission({
      artifactId: imported.artifact.id,
      submittedByEmployeeId: owner.id,
      ownerEmployeeId: owner.id,
      scope: "PERSONAL",
      knowledgeStatus: "PERSONAL_CONTEXT",
    });

    const chunks = await processTextArtifact({
      artifactVersionId: imported.version.id,
      content,
      mimeType: "text/plain",
      filename: "launch-checklist.txt",
      embeddingFn: new DeterministicEmbeddingFunction(),
    });
    expect(chunks.length).toBeGreaterThan(0);
    expect(
      await db.knowledgeChunk.count({ where: { artifactVersionId: imported.version.id } }),
    ).toBeGreaterThan(0);

    const queryEmbedding = await new DeterministicEmbeddingFunction().embed("launch checklist");
    const ownerResults = await hybridRetrieve({
      employeeId: owner.id,
      query: "launch checklist",
      queryEmbedding,
      limit: 10,
      embeddingFn: new DeterministicEmbeddingFunction(),
    });
    expect(ownerResults.some((result) => result.text.includes("restricted launch checklist"))).toBe(
      true,
    );

    const unauthorizedResults = await hybridRetrieve({
      employeeId: unauthorized.id,
      query: "launch checklist",
      queryEmbedding,
      limit: 10,
      embeddingFn: new DeterministicEmbeddingFunction(),
    });
    expect(
      unauthorizedResults.every((result) => !result.text.includes("restricted launch checklist")),
    ).toBe(true);
  });
});
