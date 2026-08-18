import { extractText } from "@hermes/artifacts";
import { indexArtifactVersion, type EmbeddingFunction } from "@hermes/knowledge";
import type { KnowledgeChunk } from "@hermes/db";

export interface ProcessArtifactInput {
  artifactVersionId: string;
  content: Buffer;
  mimeType: string;
  filename: string;
  embeddingFn: EmbeddingFunction;
}

export async function processTextArtifact(input: ProcessArtifactInput): Promise<KnowledgeChunk[]> {
  const text = extractText(input.content, input.mimeType, input.filename);
  return indexArtifactVersion({
    artifactVersionId: input.artifactVersionId,
    text,
    embeddingFn: input.embeddingFn,
  });
}
