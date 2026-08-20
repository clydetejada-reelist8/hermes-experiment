import type { DocumentProcessingLimits, ExtractedDocument } from "@hermes/artifacts";
import type { KnowledgeChunk } from "@hermes/db";

export interface ArtifactIngestionJob {
  artifactVersionId: string;
  objectKey: string;
  originalObjectKey?: string;
  bucket: string;
  mimeType: string;
  filename: string;
  retryCount?: number;
  maxRetries?: number;
  limits?: DocumentProcessingLimits;
}

export interface IngestionStorage {
  getObject(bucket: string, key: string): Promise<Buffer | null>;
  putObject(bucket: string, key: string, body: Buffer, contentType: string): Promise<void>;
}

export interface IngestionVersionUpdater {
  update(input: {
    id: string;
    data: {
      extractionStatus: "PROCESSING" | "READY" | "FAILED" | "UNSUPPORTED";
      extractionError?: string | null;
      extractedTextObjectKey?: string;
      extractionMetadata?: unknown;
      extractedAt?: Date;
    };
  }): Promise<void>;
}

export interface ProcessedArtifact {
  chunks: KnowledgeChunk[];
  extracted: ExtractedDocument;
}

export async function processArtifactJob(
  job: ArtifactIngestionJob,
  deps: {
    storage: IngestionStorage;
    versions: IngestionVersionUpdater;
    process: (input: {
      artifactVersionId: string;
      content: Buffer;
      mimeType: string;
      filename: string;
    }) => Promise<ProcessedArtifact>;
  },
): Promise<void> {
  await deps.versions.update({
    id: job.artifactVersionId,
    data: { extractionStatus: "PROCESSING", extractionError: null },
  });
  try {
    const objectKey = job.originalObjectKey ?? job.objectKey;
    const content = await deps.storage.getObject(job.bucket, objectKey);
    if (!content) throw new Error(`artifact_object_not_found: ${objectKey}`);
    const processed = await withTimeout(
      deps.process({
        artifactVersionId: job.artifactVersionId,
        content,
        mimeType: job.mimeType,
        filename: job.filename,
      }),
      job.limits?.extractionTimeoutMs ?? 120_000,
      "document_extraction_timeout",
    );
    const extractedTextObjectKey = `artifacts/${job.artifactVersionId}/extracted.txt`;
    const extractedText = processed.extracted.segments
      .map((segment) => `${segment.sourceLocator}\n${segment.text}`)
      .join("\n\n");
    await deps.storage.putObject(
      job.bucket,
      extractedTextObjectKey,
      Buffer.from(extractedText),
      "text/plain; charset=utf-8",
    );
    await deps.versions.update({
      id: job.artifactVersionId,
      data: {
        extractedTextObjectKey,
        extractionStatus: "READY",
        extractionMetadata: JSON.parse(JSON.stringify(processed.extracted.metadata)),
        extractedAt: new Date(),
        extractionError: null,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "document_extraction_failed";
    await deps.versions.update({
      id: job.artifactVersionId,
      data: {
        extractionStatus: message === "unsupported_document_format" ? "UNSUPPORTED" : "FAILED",
        extractionError: message,
      },
    });
    throw error;
  }
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  errorCode: string,
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(errorCode)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
