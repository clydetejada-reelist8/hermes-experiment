import { db } from "@hermes/db";
import type { Artifact, ArtifactVersion } from "@hermes/db";
import { createHash, randomUUID } from "node:crypto";
import type { ObjectStorage } from "@hermes/storage";

export type { Artifact, ArtifactVersion };

export interface IngestImportedFileInput {
  storage: ObjectStorage;
  bucket: string;
  submittedByEmployeeId: string;
  originalFilename: string;
  mimeType: string;
  content: Buffer;
  sourceSystem: string;
  externalId?: string;
}

export interface IngestResult {
  artifact: Artifact;
  version: ArtifactVersion;
}

/**
 * Ingest an imported file (e.g., a PDF uploaded to Discord) into the Hermes
 * knowledge control plane.
 *
 * This creates:
 *   1. An `Artifact` (mode=IMPORTED) with a unique (sourceSystem, externalId).
 *   2. An `ArtifactVersion` with a content hash and a stored snapshot.
 *   3. Stores the raw content in object storage under a managed key.
 *
 * If the same (sourceSystem, externalId) already exists, a new version is
 * created with an incremented version number.
 */
export async function ingestImportedFile(input: IngestImportedFileInput): Promise<IngestResult> {
  const contentHash = createHash("sha256").update(input.content).digest("hex");
  const artifactType = detectArtifactType(input.mimeType, input.originalFilename);

  // Upsert the artifact by (sourceSystem, externalId).
  const externalId = input.externalId ?? randomUUID();
  const artifact = await db.artifact.upsert({
    where: {
      sourceSystem_externalId: {
        sourceSystem: input.sourceSystem,
        externalId,
      },
    },
    create: {
      type: artifactType,
      mode: "IMPORTED",
      sourceSystem: input.sourceSystem,
      externalId,
      originalFilename: input.originalFilename,
      mimeType: input.mimeType,
      syncState: "SYNCED",
    },
    update: {
      originalFilename: input.originalFilename,
      mimeType: input.mimeType,
      syncState: "SYNCED",
    },
  });

  // Determine the next version number.
  const latestVersion = await db.artifactVersion.findFirst({
    where: { artifactId: artifact.id },
    orderBy: { versionNumber: "desc" },
  });
  const versionNumber = (latestVersion?.versionNumber ?? 0) + 1;

  // Store content in object storage.
  const objectKey = `artifacts/${artifact.id}/v${versionNumber}/content`;
  await input.storage.putObject(input.bucket, objectKey, input.content, input.mimeType);

  // Create the version record.
  const version = await db.artifactVersion.create({
    data: {
      artifactId: artifact.id,
      versionNumber,
      contentHash,
      extractedTextObjectKey: objectKey,
    },
  });

  // Update the artifact's currentVersionId.
  await db.artifact.update({
    where: { id: artifact.id },
    data: { currentVersionId: version.id },
  });

  return { artifact, version };
}

function detectArtifactType(mimeType: string, filename: string): string {
  const ext = filename.split(".").pop()?.toUpperCase() ?? "";
  if (mimeType.includes("pdf") || ext === "PDF") return "PDF";
  if (mimeType.includes("spreadsheet") || ext === "XLSX" || ext === "CSV") return "SPREADSHEET";
  if (mimeType.includes("document") || ext === "DOCX") return "DOCUMENT";
  if (mimeType.includes("text") || ext === "TXT") return "TEXT";
  if (mimeType.includes("image")) return "IMAGE";
  return "OTHER";
}
