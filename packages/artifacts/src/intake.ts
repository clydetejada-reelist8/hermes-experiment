import { db } from "@hermes/db";
import type { Artifact, ArtifactVersion, ArtifactSubmission } from "@hermes/db";
import { createHash, randomUUID } from "node:crypto";
import type { ObjectStorage } from "@hermes/storage";
import { classifySubmission } from "./classification.js";
import { createSubmission } from "./submissions.js";

export type { Artifact, ArtifactVersion, ArtifactSubmission };

export interface IngestImportedFileInput {
  storage: ObjectStorage;
  bucket: string;
  submittedByEmployeeId: string;
  originalFilename: string;
  mimeType: string;
  content: Buffer;
  sourceSystem: string;
  externalId?: string;
  teamId?: string;
  projectId?: string;
  /** Maximum allowed file size in bytes. Defaults to 10MB. */
  maxBytes?: number;
}

export interface IngestResult {
  artifact: Artifact;
  version: ArtifactVersion;
  submission: ArtifactSubmission;
}

/**
 * MIME type allowlist for uploaded artifacts (Section 29.1).
 * The extension must not override the MIME type — both must be consistent.
 */
const ALLOWED_MIME_TYPES = new Set([
  "text/plain",
  "text/csv",
  "text/markdown",
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.ms-excel",
  "application/msword",
  "application/vnd.ms-powerpoint",
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
]);

const MIME_TO_EXTENSION: Record<string, string[]> = {
  "text/plain": ["txt"],
  "text/csv": ["csv"],
  "text/markdown": ["md", "markdown"],
  "application/pdf": ["pdf"],
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ["docx"],
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ["xlsx"],
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": ["pptx"],
  "application/vnd.ms-excel": ["xls"],
  "application/msword": ["doc"],
  "application/vnd.ms-powerpoint": ["ppt"],
  "image/png": ["png"],
  "image/jpeg": ["jpg", "jpeg"],
  "image/gif": ["gif"],
  "image/webp": ["webp"],
};

export class ArtifactValidationError extends Error {
  constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message);
    this.name = "ArtifactValidationError";
  }
}

/**
 * Validate the uploaded file's size and MIME type (Section 29.1).
 * - File size must not exceed maxBytes.
 * - MIME type must be in the allowlist.
 * - The file extension must be consistent with the MIME type (extension
 *   does not override MIME).
 */
function validateUpload(input: IngestImportedFileInput): void {
  const maxBytes = input.maxBytes ?? 10 * 1024 * 1024; // 10MB default

  if (input.content.length > maxBytes) {
    throw new ArtifactValidationError(
      `file size ${input.content.length} exceeds maximum ${maxBytes} bytes`,
      "FILE_TOO_LARGE",
    );
  }

  if (!ALLOWED_MIME_TYPES.has(input.mimeType)) {
    throw new ArtifactValidationError(
      `MIME type ${input.mimeType} is not allowed`,
      "MIME_NOT_ALLOWED",
    );
  }

  // Check extension/MIME consistency.
  const ext = input.originalFilename.split(".").pop()?.toLowerCase() ?? "";
  const allowedExts = MIME_TO_EXTENSION[input.mimeType] ?? [];
  if (ext && allowedExts.length > 0 && !allowedExts.includes(ext)) {
    throw new ArtifactValidationError(
      `file extension .${ext} does not match MIME type ${input.mimeType}`,
      "EXTENSION_MIME_MISMATCH",
    );
  }
}

/**
 * Ingest an imported file (e.g., a PDF uploaded to Discord) into the Hermes
 * knowledge control plane.
 *
 * This creates:
 *   1. An `Artifact` (mode=IMPORTED) with a unique (sourceSystem, externalId).
 *   2. An `ArtifactVersion` with a content hash and a stored snapshot.
 *   3. Stores the raw content in object storage under a managed key.
 *   4. An `ArtifactSubmission` — the classification record that determines
 *      who can see the artifact and at what knowledge status. Without a
 *      submission, the artifact is invisible to retrieval.
 *
 * If the same (sourceSystem, externalId) already exists, a new version is
 * created with an incremented version number.
 */
export async function ingestImportedFile(input: IngestImportedFileInput): Promise<IngestResult> {
  // Validate size and MIME type before any storage operations.
  validateUpload(input);

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

  // Classify and create the submission — without this, the artifact is
  // invisible to retrieval (which filters by active submissions).
  const classification = classifySubmission({
    filename: input.originalFilename,
    mimeType: input.mimeType,
    content: input.content.toString("utf8"),
    submittedByEmployeeId: input.submittedByEmployeeId,
    teamId: input.teamId,
    projectId: input.projectId,
  });

  const submission = await createSubmission({
    artifactId: artifact.id,
    submittedByEmployeeId: input.submittedByEmployeeId,
    scope: classification.scope,
    ownerEmployeeId: input.submittedByEmployeeId,
    teamId: input.teamId,
    projectId: input.projectId,
    knowledgeStatus: classification.knowledgeStatus,
    dataSensitivity: classification.sensitivity,
  });

  return { artifact, version, submission };
}

function detectArtifactType(mimeType: string, filename: string): string {
  const ext = filename.split(".").pop()?.toUpperCase() ?? "";
  if (mimeType.includes("pdf") || ext === "PDF") return "PDF";
  if (mimeType.includes("spreadsheet") || ext === "XLSX" || ext === "CSV") return "SPREADSHEET";
  if (mimeType.includes("document") || ext === "DOCX") return "DOCUMENT";
  if (mimeType.includes("presentation") || ext === "PPTX") return "PRESENTATION";
  if (mimeType.includes("text") || ext === "TXT") return "TEXT";
  if (mimeType.includes("image")) return "IMAGE";
  return "OTHER";
}
