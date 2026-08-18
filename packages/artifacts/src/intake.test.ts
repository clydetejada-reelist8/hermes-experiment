import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { ingestImportedFile } from "./intake.js";
import { ObjectStorage } from "@hermes/storage";
import { createEmployee } from "../../../test/fixtures/db-helpers.js";

const storageConfig = {
  endpoint: process.env.OBJECT_STORAGE_ENDPOINT ?? "http://localhost:9000",
  bucket: process.env.OBJECT_STORAGE_BUCKET ?? "hermes-staging",
  accessKey: process.env.OBJECT_STORAGE_ACCESS_KEY ?? "hermes",
  secretKey: process.env.OBJECT_STORAGE_SECRET_KEY ?? "hermes-staging",
};

describe("ingestImportedFile", () => {
  it("creates an Artifact, ArtifactVersion, and stores content", async () => {
    const emp = await createEmployee();
    const storage = new ObjectStorage(storageConfig);
    await storage.createBucketIfNotExists(storageConfig.bucket);

    const content = Buffer.from("This is a test PDF content for ingestion.");
    const result = await ingestImportedFile({
      storage,
      bucket: storageConfig.bucket,
      submittedByEmployeeId: emp.id,
      originalFilename: "test-report.pdf",
      mimeType: "application/pdf",
      content,
      sourceSystem: "DISCORD_UPLOAD",
    });

    expect(result.artifact.id).toBeTruthy();
    expect(result.artifact.type).toBe("PDF");
    expect(result.artifact.mode).toBe("IMPORTED");
    expect(result.artifact.syncState).toBe("SYNCED");
    expect(result.version.versionNumber).toBe(1);
    expect(result.version.contentHash).toBeTruthy();

    // Verify content was stored
    const retrieved = await storage.getObject(
      storageConfig.bucket,
      result.version.extractedTextObjectKey!,
    );
    expect(retrieved).not.toBeNull();
    expect(retrieved!.toString()).toBe(content.toString());
  });

  it("creates a second version for the same source artifact", async () => {
    const emp = await createEmployee();
    const storage = new ObjectStorage(storageConfig);
    await storage.createBucketIfNotExists(storageConfig.bucket);

    const externalId = `ext-${randomUUID()}`;
    const content1 = Buffer.from("version 1 content");
    const r1 = await ingestImportedFile({
      storage,
      bucket: storageConfig.bucket,
      submittedByEmployeeId: emp.id,
      originalFilename: "doc.txt",
      mimeType: "text/plain",
      content: content1,
      sourceSystem: "DISCORD_UPLOAD",
      externalId,
    });

    const content2 = Buffer.from("version 2 content - updated");
    const r2 = await ingestImportedFile({
      storage,
      bucket: storageConfig.bucket,
      submittedByEmployeeId: emp.id,
      originalFilename: "doc.txt",
      mimeType: "text/plain",
      content: content2,
      sourceSystem: "DISCORD_UPLOAD",
      externalId,
    });

    expect(r2.artifact.id).toBe(r1.artifact.id);
    expect(r2.version.versionNumber).toBe(2);
    expect(r2.version.contentHash).not.toBe(r1.version.contentHash);
  });
});
