import { db } from "@hermes/db";
import type { KnowledgeChunk } from "@hermes/db";
import type { EvidenceSourceType } from "@hermes/contracts";
import { randomUUID } from "node:crypto";
import { chunkText } from "./chunker.js";

export type { KnowledgeChunk };
export { chunkText, estimateTokens } from "./chunker.js";
export type { Chunk, ChunkOptions } from "./chunker.js";

/**
 * Embedding function interface. The implementation calls the OpenAI
 * embeddings API. This interface allows mocking in tests.
 */
export interface EmbeddingFunction {
  embed(text: string): Promise<number[]>;
}

export interface IndexArtifactVersionInput {
  artifactVersionId: string;
  text: string;
  embeddingFn: EmbeddingFunction;
  chunkOptions?: { maxTokens: number; overlapTokens: number };
}

/**
 * Parse, chunk, embed, and index an artifact version's text content.
 *
 * Creates KnowledgeChunk records with:
 *   - sourceType = ARTIFACT_VERSION
 *   - artifactVersionId = the version ID
 *   - embedding = the vector from the embedding function
 *   - chunkIndex = sequential index
 *
 * The embedding is stored via raw SQL because pgvector's `vector` type is
 * `Unsupported` in Prisma and cannot be written through the standard client.
 */
export async function indexArtifactVersion(
  input: IndexArtifactVersionInput,
): Promise<KnowledgeChunk[]> {
  const chunks = chunkText(input.text, input.chunkOptions ?? { maxTokens: 500, overlapTokens: 50 });
  const results: KnowledgeChunk[] = [];

  for (const chunk of chunks) {
    const embedding = await input.embeddingFn.embed(chunk.text);
    const id = randomUUID();
    await db.$executeRaw`
      INSERT INTO "KnowledgeChunk" (
        id, "sourceType", "artifactVersionId", "chunkIndex",
        text, "tokenEstimate", embedding
      )
      VALUES (
        ${id}, ${"ARTIFACT_VERSION" as EvidenceSourceType}::"EvidenceSourceType",
        ${input.artifactVersionId}, ${chunk.chunkIndex},
        ${chunk.text}, ${chunk.tokenEstimate},
        ${vectorToPgVector(embedding)}::vector
      )
    `;
    const record = await db.knowledgeChunk.findUnique({ where: { id } });
    if (record) results.push(record);
  }

  return results;
}

export interface IndexSSOTVersionInput {
  ssotVersionId: string;
  text: string;
  embeddingFn: EmbeddingFunction;
  chunkOptions?: { maxTokens: number; overlapTokens: number };
}

/**
 * Index an SSOT version's content for retrieval.
 */
export async function indexSSOTVersion(input: IndexSSOTVersionInput): Promise<KnowledgeChunk[]> {
  const chunks = chunkText(input.text, input.chunkOptions ?? { maxTokens: 500, overlapTokens: 50 });
  const results: KnowledgeChunk[] = [];

  for (const chunk of chunks) {
    const embedding = await input.embeddingFn.embed(chunk.text);
    const id = randomUUID();
    await db.$executeRaw`
      INSERT INTO "KnowledgeChunk" (
        id, "sourceType", "ssotVersionId", "chunkIndex",
        text, "tokenEstimate", embedding
      )
      VALUES (
        ${id}, ${"SSOT_VERSION" as EvidenceSourceType}::"EvidenceSourceType",
        ${input.ssotVersionId}, ${chunk.chunkIndex},
        ${chunk.text}, ${chunk.tokenEstimate},
        ${vectorToPgVector(embedding)}::vector
      )
    `;
    const record = await db.knowledgeChunk.findUnique({ where: { id } });
    if (record) results.push(record);
  }

  return results;
}

/**
 * Convert a number array to the PostgreSQL vector string format.
 * pgvector expects "[1,2,3]" format.
 */
function vectorToPgVector(vec: number[]): string {
  return `[${vec.join(",")}]`;
}
