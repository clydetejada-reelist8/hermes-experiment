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

export class DeterministicEmbeddingFunction implements EmbeddingFunction {
  async embed(text: string): Promise<number[]> {
    const vector = new Array<number>(1536).fill(0);
    for (let i = 0; i < text.length; i += 1) {
      vector[i % vector.length] = (vector[i % vector.length]! + text.charCodeAt(i)) / 1000;
    }
    return vector;
  }
}

export async function processTextArtifact(input: ProcessArtifactInput): Promise<KnowledgeChunk[]> {
  const text = extractText(input.content, input.mimeType, input.filename);
  return indexArtifactVersion({
    artifactVersionId: input.artifactVersionId,
    text,
    embeddingFn: input.embeddingFn,
  });
}
