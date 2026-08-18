import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { db } from "@hermes/db";
import { linkDriveArtifact, createSubmission, getSubmissionsForEmployee } from "./submissions.js";
import { createEmployee, createTeam, createProject } from "../../../test/fixtures/db-helpers.js";

async function createBaseArtifact() {
  return db.artifact.create({
    data: {
      type: "PDF",
      mode: "LINKED",
      sourceSystem: "GOOGLE_DRIVE",
      externalId: `drive-${randomUUID()}`,
      canonicalUrl: "https://drive.google.com/file/d/example/view",
      syncState: "PENDING",
    },
  });
}

describe("linkDriveArtifact", () => {
  it("creates a LINKED artifact from a Google Drive file ID", async () => {
    const emp = await createEmployee();
    const result = await linkDriveArtifact({
      submittedByEmployeeId: emp.id,
      driveFileId: `drive-file-${randomUUID()}`,
      canonicalUrl: "https://drive.google.com/file/d/abc/view",
      mimeType: "application/vnd.google-apps.document",
      originalFilename: "proposal.docx",
    });
    expect(result.artifact.mode).toBe("LINKED");
    expect(result.artifact.sourceSystem).toBe("GOOGLE_DRIVE");
    expect(result.artifact.syncState).toBe("PENDING");
  });

  it("upserts by (sourceSystem, externalId) for the same Drive file", async () => {
    const emp = await createEmployee();
    const driveFileId = `drive-file-${randomUUID()}`;
    const r1 = await linkDriveArtifact({
      submittedByEmployeeId: emp.id,
      driveFileId,
      canonicalUrl: "https://drive.google.com/file/d/abc/view",
      mimeType: "application/pdf",
    });
    const r2 = await linkDriveArtifact({
      submittedByEmployeeId: emp.id,
      driveFileId,
      canonicalUrl: "https://drive.google.com/file/d/abc/view",
      mimeType: "application/pdf",
    });
    expect(r2.artifact.id).toBe(r1.artifact.id);
  });
});

describe("createSubmission", () => {
  it("creates a PERSONAL submission", async () => {
    const emp = await createEmployee();
    const artifact = await createBaseArtifact();
    const sub = await createSubmission({
      artifactId: artifact.id,
      submittedByEmployeeId: emp.id,
      scope: "PERSONAL",
      ownerEmployeeId: emp.id,
      knowledgeStatus: "PERSONAL_CONTEXT",
      dataSensitivity: "NORMAL",
    });
    expect(sub.scope).toBe("PERSONAL");
    expect(sub.ownerEmployeeId).toBe(emp.id);
    expect(sub.active).toBe(true);
  });

  it("creates a TEAM submission with teamId", async () => {
    const emp = await createEmployee();
    const team = await createTeam();
    const artifact = await createBaseArtifact();
    const sub = await createSubmission({
      artifactId: artifact.id,
      submittedByEmployeeId: emp.id,
      scope: "TEAM",
      teamId: team.id,
      knowledgeStatus: "REFERENCE",
      dataSensitivity: "NORMAL",
    });
    expect(sub.scope).toBe("TEAM");
    expect(sub.teamId).toBe(team.id);
  });

  it("creates a PROJECT submission with projectId", async () => {
    const emp = await createEmployee();
    const project = await createProject();
    const artifact = await createBaseArtifact();
    const sub = await createSubmission({
      artifactId: artifact.id,
      submittedByEmployeeId: emp.id,
      scope: "PROJECT",
      projectId: project.id,
      knowledgeStatus: "REFERENCE",
      dataSensitivity: "NORMAL",
    });
    expect(sub.scope).toBe("PROJECT");
    expect(sub.projectId).toBe(project.id);
  });

  it("rejects a PROJECT submission without projectId", async () => {
    const emp = await createEmployee();
    const artifact = await createBaseArtifact();
    await expect(
      createSubmission({
        artifactId: artifact.id,
        submittedByEmployeeId: emp.id,
        scope: "PROJECT",
        knowledgeStatus: "REFERENCE",
        dataSensitivity: "NORMAL",
      }),
    ).rejects.toThrow();
  });
});

describe("getSubmissionsForEmployee", () => {
  it("returns PERSONAL submissions for the employee", async () => {
    const emp = await createEmployee();
    const artifact = await createBaseArtifact();
    await createSubmission({
      artifactId: artifact.id,
      submittedByEmployeeId: emp.id,
      scope: "PERSONAL",
      ownerEmployeeId: emp.id,
      knowledgeStatus: "PERSONAL_CONTEXT",
      dataSensitivity: "NORMAL",
    });
    const subs = await getSubmissionsForEmployee(emp.id);
    expect(subs.length).toBeGreaterThanOrEqual(1);
    expect(subs.some((s) => s.scope === "PERSONAL")).toBe(true);
  });
});
