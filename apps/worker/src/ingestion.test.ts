import { describe, expect, it } from "vitest";
import { processArtifactJob } from "./ingestion.js";

class MemoryStorage {
  objects = new Map<string, Buffer>();
  async getObject(_bucket: string, key: string) {
    return this.objects.get(key) ?? null;
  }
  async putObject(_bucket: string, key: string, body: Buffer) {
    this.objects.set(key, body);
  }
}

describe("document ingestion worker state", () => {
  it("retains the original, indexes extracted content, and marks READY", async () => {
    const storage = new MemoryStorage();
    storage.objects.set("original", Buffer.from("original bytes"));
    const updates: unknown[] = [];
    await processArtifactJob(
      {
        artifactVersionId: "version-1",
        objectKey: "original",
        bucket: "test",
        mimeType: "text/plain",
        filename: "memo.txt",
      },
      {
        storage,
        versions: {
          update: async (update) => {
            updates.push(update);
          },
        },
        process: async () => ({
          chunks: [] as never[],
          extracted: {
            segments: [{ sourceLocator: "memo.txt", text: "extracted text" }],
            metadata: { format: "text" },
          },
        }),
      },
    );
    expect(storage.objects.get("original")?.toString()).toBe("original bytes");
    expect(storage.objects.get("artifacts/version-1/extracted.txt")?.toString()).toContain(
      "extracted text",
    );
    expect(updates).toEqual([
      { id: "version-1", data: { extractionStatus: "PROCESSING", extractionError: null } },
      expect.objectContaining({ data: expect.objectContaining({ extractionStatus: "READY" }) }),
    ]);
  });

  it("records unsupported format without deleting the original", async () => {
    const storage = new MemoryStorage();
    storage.objects.set("original", Buffer.from("original bytes"));
    const updates: unknown[] = [];
    await expect(
      processArtifactJob(
        {
          artifactVersionId: "version-2",
          objectKey: "original",
          bucket: "test",
          mimeType: "application/octet-stream",
          filename: "file.bin",
        },
        {
          storage,
          versions: {
            update: async (update) => {
              updates.push(update);
            },
          },
          process: async () => {
            throw new Error("unsupported_document_format");
          },
        },
      ),
    ).rejects.toThrow("unsupported_document_format");
    expect(storage.objects.get("original")?.toString()).toBe("original bytes");
    expect(updates.at(-1)).toEqual({
      id: "version-2",
      data: { extractionStatus: "UNSUPPORTED", extractionError: "unsupported_document_format" },
    });
  });

  it("marks extraction timeout as failed and does not crash the caller", async () => {
    const storage = new MemoryStorage();
    storage.objects.set("original", Buffer.from("original bytes"));
    const updates: unknown[] = [];
    await expect(
      processArtifactJob(
        {
          artifactVersionId: "version-timeout",
          objectKey: "original",
          bucket: "test",
          mimeType: "text/plain",
          filename: "slow.txt",
          limits: { extractionTimeoutMs: 5 } as never,
        },
        {
          storage,
          versions: {
            update: async (update) => {
              updates.push(update);
            },
          },
          process: async () =>
            new Promise((resolve) =>
              setTimeout(
                () => resolve({ chunks: [], extracted: { segments: [], metadata: {} } } as never),
                50,
              ),
            ),
        },
      ),
    ).rejects.toThrow("document_extraction_timeout");
    expect(updates.at(-1)).toEqual({
      id: "version-timeout",
      data: { extractionStatus: "FAILED", extractionError: "document_extraction_timeout" },
    });
  });

  it("records a processing failure and preserves the original", async () => {
    const storage = new MemoryStorage();
    storage.objects.set("original", Buffer.from("original bytes"));
    const updates: unknown[] = [];
    await expect(
      processArtifactJob(
        {
          artifactVersionId: "version-3",
          objectKey: "original",
          bucket: "test",
          mimeType: "application/pdf",
          filename: "broken.pdf",
        },
        {
          storage,
          versions: {
            update: async (update) => {
              updates.push(update);
            },
          },
          process: async () => {
            throw new Error("document_malformed_pdf");
          },
        },
      ),
    ).rejects.toThrow("document_malformed_pdf");
    expect(storage.objects.get("original")?.toString()).toBe("original bytes");
    expect(updates.at(-1)).toEqual({
      id: "version-3",
      data: { extractionStatus: "FAILED", extractionError: "document_malformed_pdf" },
    });
  });
});
