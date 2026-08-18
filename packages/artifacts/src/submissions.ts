import { db } from "@hermes/db";
import type { Artifact, ArtifactSubmission } from "@hermes/db";
import type { ArtifactScope, KnowledgeStatus, DataSensitivity } from "@hermes/contracts";

export type { Artifact, ArtifactSubmission };

export interface LinkDriveArtifactInput {
  submittedByEmployeeId: string;
  driveFileId: string;
  canonicalUrl: string;
  mimeType: string;
  originalFilename?: string;
}

export interface LinkDriveArtifactResult {
  artifact: Artifact;
}

/**
 * Link a Google Drive file as a LINKED-mode artifact. The file content is not
 * copied into Hermes object storage; instead, Hermes accesses it via the
 * employee's Google OAuth connection at retrieval time. The syncState starts
 * as PENDING until the first successful content fetch.
 */
export async function linkDriveArtifact(
  input: LinkDriveArtifactInput,
): Promise<LinkDriveArtifactResult> {
  const artifact = await db.artifact.upsert({
    where: {
      sourceSystem_externalId: {
        sourceSystem: "GOOGLE_DRIVE",
        externalId: input.driveFileId,
      },
    },
    create: {
      type: detectArtifactType(input.mimeType, input.originalFilename),
      mode: "LINKED",
      sourceSystem: "GOOGLE_DRIVE",
      externalId: input.driveFileId,
      canonicalUrl: input.canonicalUrl,
      originalFilename: input.originalFilename,
      mimeType: input.mimeType,
      syncState: "PENDING",
    },
    update: {
      canonicalUrl: input.canonicalUrl,
      originalFilename: input.originalFilename,
      mimeType: input.mimeType,
    },
  });
  return { artifact };
}

export interface CreateSubmissionInput {
  artifactId: string;
  submittedByEmployeeId: string;
  scope: ArtifactScope;
  ownerEmployeeId?: string;
  teamId?: string;
  projectId?: string;
  knowledgeStatus: KnowledgeStatus;
  dataSensitivity?: DataSensitivity;
  authorityDomain?: string;
}

/**
 * Create an ArtifactSubmission — the classification record that determines
 * who can see an artifact and at what knowledge status. The DB-level CHECK
 * constraint enforces that PROJECT submissions have a projectId and TEAM
 * submissions have a teamId.
 */
export async function createSubmission(input: CreateSubmissionInput): Promise<ArtifactSubmission> {
  if (input.scope === "PROJECT" && !input.projectId) {
    throw new Error("PROJECT submissions require projectId");
  }
  if (input.scope === "TEAM" && !input.teamId) {
    throw new Error("TEAM submissions require teamId");
  }

  return db.artifactSubmission.create({
    data: {
      artifactId: input.artifactId,
      submittedByEmployeeId: input.submittedByEmployeeId,
      ownerEmployeeId: input.ownerEmployeeId,
      scope: input.scope,
      teamId: input.teamId,
      projectId: input.projectId,
      knowledgeStatus: input.knowledgeStatus,
      dataSensitivity: input.dataSensitivity ?? "NORMAL",
      authorityDomain: input.authorityDomain,
      sourceAccessMode: "HERMES_MANAGED",
      active: true,
    },
  });
}

/**
 * Get all active submissions visible to an employee. This includes:
 *   - PERSONAL submissions where they are the owner
 *   - TEAM submissions for teams they belong to
 *   - PROJECT submissions for projects they are a member of
 *   - COMPANY submissions
 */
export async function getSubmissionsForEmployee(employeeId: string): Promise<ArtifactSubmission[]> {
  const teamMemberships = await db.employeeTeam.findMany({
    where: { employeeId },
    select: { teamId: true },
  });
  const projectMemberships = await db.projectMember.findMany({
    where: { employeeId },
    select: { projectId: true },
  });
  const teamIds = teamMemberships.map((t: { teamId: string }) => t.teamId);
  const projectIds = projectMemberships.map((p: { projectId: string }) => p.projectId);

  return db.artifactSubmission.findMany({
    where: {
      active: true,
      OR: [
        { scope: "PERSONAL", ownerEmployeeId: employeeId },
        { scope: "THREAD_ONLY", ownerEmployeeId: employeeId },
        { scope: "TEAM", teamId: { in: teamIds } },
        { scope: "PROJECT", projectId: { in: projectIds } },
        { scope: "COMPANY" },
      ],
    },
  });
}

function detectArtifactType(mimeType: string, filename?: string): string {
  const ext = filename?.split(".").pop()?.toUpperCase() ?? "";
  if (mimeType.includes("pdf") || ext === "PDF") return "PDF";
  if (mimeType.includes("spreadsheet") || ext === "XLSX" || ext === "CSV") return "SPREADSHEET";
  if (mimeType.includes("document") || ext === "DOCX") return "DOCUMENT";
  if (mimeType.includes("presentation") || ext === "PPTX") return "PRESENTATION";
  if (mimeType.includes("text") || ext === "TXT") return "TEXT";
  return "OTHER";
}
