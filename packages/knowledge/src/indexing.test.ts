import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { db } from "@hermes/db";
import { indexArtifactVersion } from "./indexing.js";
import type { EmbeddingFunction } from "./indexing.js";

// Mock embedding function that returns a deterministic 1536-dim vector.
class MockEmbeddingFn implements EmbeddingFunction {
  async embed(text: string): Promise<number[]> {
    // Simple hash-based deterministic embedding.
    const vec = new Array(1536).fill(0);
    for (let i = 0; i < text.length; i++) {
      vec[i % 1536] = (vec[i % 1536] + text.charCodeAt(i)) / 1000;
    }
    return vec;
  }
}

async function createArtifactWithVersion() {
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
    data: {
      artifactId: artifact.id,
      versionNumber: 1,
      contentHash: randomUUID(),
    },
  });
  return { artifact, version };
}

describe("indexArtifactVersion", () => {
  it("chunks, embeds, and persists KnowledgeChunk records", async () => {
    const { version } = await createArtifactWithVersion();
    const chunks = await indexArtifactVersion({
      artifactVersionId: version.id,
      text: "This is sentence one. This is sentence two. This is sentence three.",
      embeddingFn: new MockEmbeddingFn(),
      chunkOptions: { maxTokens: 10, overlapTokens: 3 },
    });

    expect(chunks.length).toBeGreaterThan(0);
    for (const chunk of chunks) {
      expect(chunk.artifactVersionId).toBe(version.id);
      expect(chunk.sourceType).toBe("ARTIFACT_VERSION");
      expect(chunk.embedding).not.toBeNull();
    }

    // Verify chunks are in the DB.
    const dbChunks = await db.knowledgeChunk.findMany({
      where: { artifactVersionId: version.id },
      orderBy: { chunkIndex: "asc" },
    });
    expect(dbChunks.length).toBe(chunks.length);
  });
});
