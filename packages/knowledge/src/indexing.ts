import { db } from "@hermes/db";
import type { KnowledgeChunk } from "@hermes/db";
import type { EvidenceSourceType } from "@hermes/contracts";
import { randomUUID } from "node:crypto";
import { chunkText } from "./chunker.js";

export type { KnowledgeChunk };
export { chunkText, estimateTokens } from "./chunker.js";
export type { Chunk, ChunkOptions } from "./chunker.js";

export interface EmbeddingFunction {
  embed(text: string): Promise<number[]>;
}

export interface IndexSegment {
  text: string;
  pageNumber?: number;
  sheetName?: string;
  sourceLocator?: string;
}

export interface IndexArtifactVersionInput {
  artifactVersionId: string;
  text?: string;
  segments?: IndexSegment[];
  embeddingFn: EmbeddingFunction;
  chunkOptions?: { maxTokens: number; overlapTokens: number };
}

/** Parse, chunk, embed, and index an artifact version with source provenance. */
export async function indexArtifactVersion(
  input: IndexArtifactVersionInput,
): Promise<KnowledgeChunk[]> {
  const segments = input.segments ?? (input.text ? [{ text: input.text }] : []);
  await db.knowledgeChunk.deleteMany({ where: { artifactVersionId: input.artifactVersionId } });
  const results: KnowledgeChunk[] = [];
  let chunkIndex = 0;

  for (const segment of segments) {
    const chunks = chunkText(
      segment.text,
      input.chunkOptions ?? { maxTokens: 500, overlapTokens: 50 },
    );
    for (const chunk of chunks) {
      const embedding = await input.embeddingFn.embed(chunk.text);
      const id = randomUUID();
      await db.$executeRaw`
        INSERT INTO "KnowledgeChunk" (
          id, "sourceType", "artifactVersionId", "chunkIndex",
          text, "textSearchDocument", "tokenEstimate", embedding,
          "pageNumber", "sheetName", "sourceLocator"
        )
        VALUES (
          ${id}, ${"ARTIFACT_VERSION" as EvidenceSourceType}::"EvidenceSourceType",
          ${input.artifactVersionId}, ${chunkIndex},
          ${chunk.text}, ${chunk.text}, ${chunk.tokenEstimate},
          ${vectorToPgVector(embedding)}::vector,
          ${segment.pageNumber ?? null}, ${segment.sheetName ?? null}, ${segment.sourceLocator ?? null}
        )
      `;
      const record = await db.knowledgeChunk.findUnique({ where: { id } });
      if (record) results.push(record);
      chunkIndex += 1;
    }
  }
  return results;
}

export interface IndexSSOTVersionInput {
  ssotVersionId: string;
  text: string;
  embeddingFn: EmbeddingFunction;
  chunkOptions?: { maxTokens: number; overlapTokens: number };
}

export async function indexSSOTVersion(input: IndexSSOTVersionInput): Promise<KnowledgeChunk[]> {
  const chunks = chunkText(input.text, input.chunkOptions ?? { maxTokens: 500, overlapTokens: 50 });
  const results: KnowledgeChunk[] = [];
  for (const chunk of chunks) {
    const embedding = await input.embeddingFn.embed(chunk.text);
    const id = randomUUID();
    await db.$executeRaw`
      INSERT INTO "KnowledgeChunk" (
        id, "sourceType", "ssotVersionId", "chunkIndex",
        text, "textSearchDocument", "tokenEstimate", embedding
      )
      VALUES (
        ${id}, ${"SSOT_VERSION" as EvidenceSourceType}::"EvidenceSourceType",
        ${input.ssotVersionId}, ${chunk.chunkIndex},
        ${chunk.text}, ${chunk.text}, ${chunk.tokenEstimate},
        ${vectorToPgVector(embedding)}::vector
      )
    `;
    const record = await db.knowledgeChunk.findUnique({ where: { id } });
    if (record) results.push(record);
  }
  return results;
}

function vectorToPgVector(vec: number[]): string {
  return `[${vec.join(",")}]`;
}
