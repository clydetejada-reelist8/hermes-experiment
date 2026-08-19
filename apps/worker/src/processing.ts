import {
  extractDocument,
  type DocumentProcessingLimits,
  type ExtractedDocument,
} from "@hermes/artifacts";
import { indexArtifactVersion, type EmbeddingFunction, type IndexSegment } from "@hermes/knowledge";
import type { KnowledgeChunk } from "@hermes/db";

export interface ProcessArtifactInput {
  artifactVersionId: string;
  content: Buffer;
  mimeType: string;
  filename: string;
  embeddingFn: EmbeddingFunction;
  limits?: DocumentProcessingLimits;
}

export interface ProcessArtifactResult {
  chunks: KnowledgeChunk[];
  extracted: ExtractedDocument;
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

export async function processDocumentArtifact(
  input: ProcessArtifactInput,
): Promise<ProcessArtifactResult> {
  const extracted = await extractDocument(
    input.content,
    input.mimeType,
    input.filename,
    input.limits,
  );
  const segments: IndexSegment[] = extracted.segments.map((segment) => ({
    text: segment.text,
    pageNumber: segment.pageNumber,
    sheetName: segment.sheetName,
    sourceLocator: segment.sourceLocator,
  }));
  const chunks = await indexArtifactVersion({
    artifactVersionId: input.artifactVersionId,
    segments,
    embeddingFn: input.embeddingFn,
  });
  return { chunks, extracted };
}

export async function processTextArtifact(input: ProcessArtifactInput): Promise<KnowledgeChunk[]> {
  return (await processDocumentArtifact(input)).chunks;
}
