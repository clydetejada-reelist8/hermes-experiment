import { describe, expect, it } from "vitest";
import { db } from "@hermes/db";
import { randomUUID } from "node:crypto";
import {
  createDiscordIdentity,
  createEmployee,
  createProject,
  createRole,
  createTeam,
} from "../fixtures/db-helpers.js";

/**
 * Schema-level constraint tests for the Hermes Knowledge Control Plane.
 * These exercise DB-level guarantees (unique constraints, CHECK constraints)
 * that application code relies on for safety.
 */
describe("Hermes control-plane schema", () => {
  it("rejects a duplicate (provider, providerSubjectId) external identity", async () => {
    const emp = await createEmployee();
    const discordId = randomUUID();
    await createDiscordIdentity(emp.id, discordId);
    await expect(createDiscordIdentity(emp.id, discordId)).rejects.toThrow();
  });

  it("allows one employee to have multiple roles", async () => {
    const emp = await createEmployee();
    const roleA = await createRole(`role-a-${randomUUID().slice(0, 6)}`);
    const roleB = await createRole(`role-b-${randomUUID().slice(0, 6)}`);
    await db.employeeRole.create({ data: { employeeId: emp.id, roleId: roleA.id } });
    await db.employeeRole.create({ data: { employeeId: emp.id, roleId: roleB.id } });
    const roles = await db.employeeRole.findMany({ where: { employeeId: emp.id } });
    expect(roles.length).toBe(2);
  });

  it("allows one project to have multiple members", async () => {
    const project = await createProject();
    const a = await createEmployee();
    const b = await createEmployee();
    await db.projectMember.create({ data: { employeeId: a.id, projectId: project.id } });
    await db.projectMember.create({ data: { employeeId: b.id, projectId: project.id } });
    const members = await db.projectMember.findMany({ where: { projectId: project.id } });
    expect(members.length).toBe(2);
  });

  it("allows one Artifact with two ArtifactSubmissions of different scope", async () => {
    const a = await createEmployee();
    const team = await createTeam();
    const artifact = await db.artifact.create({
      data: {
        type: "PDF",
        mode: "IMPORTED",
        sourceSystem: "DISCORD_UPLOAD",
        syncState: "SYNCED",
      },
    });
    const s1 = await db.artifactSubmission.create({
      data: {
        artifactId: artifact.id,
        submittedByEmployeeId: a.id,
        scope: "PERSONAL",
        knowledgeStatus: "REFERENCE",
        dataSensitivity: "NORMAL",
        sourceAccessMode: "HERMES_MANAGED",
        active: true,
      },
    });
    const s2 = await db.artifactSubmission.create({
      data: {
        artifactId: artifact.id,
        submittedByEmployeeId: a.id,
        scope: "TEAM",
        teamId: team.id,
        knowledgeStatus: "REFERENCE",
        dataSensitivity: "NORMAL",
        sourceAccessMode: "HERMES_MANAGED",
        active: true,
      },
    });
    expect(s1.scope).toBe("PERSONAL");
    expect(s2.scope).toBe("TEAM");
  });

  it("rejects a PROJECT submission without projectId at the DB level", async () => {
    const a = await createEmployee();
    const artifact = await db.artifact.create({
      data: {
        type: "PDF",
        mode: "IMPORTED",
        sourceSystem: "DISCORD_UPLOAD",
        syncState: "SYNCED",
      },
    });
    await expect(
      db.artifactSubmission.create({
        data: {
          artifactId: artifact.id,
          submittedByEmployeeId: a.id,
          scope: "PROJECT",
          knowledgeStatus: "REFERENCE",
          dataSensitivity: "NORMAL",
          sourceAccessMode: "HERMES_MANAGED",
          active: true,
        },
      }),
    ).rejects.toThrow();
  });

  it("rejects a KnowledgeChunk referencing neither or both source versions", async () => {
    const emp = await createEmployee();
    const artifact = await db.artifact.create({
      data: {
        type: "PDF",
        mode: "IMPORTED",
        sourceSystem: "DISCORD_UPLOAD",
        syncState: "SYNCED",
      },
    });
    const version = await db.artifactVersion.create({
      data: {
        artifactId: artifact.id,
        versionNumber: 1,
        contentHash: randomUUID(),
      },
    });
    // neither source -> reject
    await expect(
      db.knowledgeChunk.create({
        data: { sourceType: "ARTIFACT_VERSION", chunkIndex: 0, text: "x", tokenEstimate: 1 },
      }),
    ).rejects.toThrow();
    // both sources -> reject (need an ssot version for the second fk)
    const domain = await db.authorityDomain.create({
      data: { domain: `domain-${randomUUID().slice(0, 8)}` },
    });
    const ssotRecord = await db.sSOTRecord.create({
      data: { authorityDomain: domain.domain, subjectKey: randomUUID(), title: "t" },
    });
    const ssotVersion = await db.sSOTVersion.create({
      data: {
        ssotRecordId: ssotRecord.id,
        versionNumber: 1,
        content: "c",
        effectiveFrom: new Date(),
        approvedByEmployeeId: emp.id,
      },
    });
    await expect(
      db.knowledgeChunk.create({
        data: {
          sourceType: "ARTIFACT_VERSION",
          chunkIndex: 1,
          text: "x",
          tokenEstimate: 1,
          artifactVersionId: version.id,
          ssotVersionId: ssotVersion.id,
        },
      }),
    ).rejects.toThrow();
    // exactly one -> ok
    const ok = await db.knowledgeChunk.create({
      data: {
        sourceType: "ARTIFACT_VERSION",
        chunkIndex: 2,
        text: "x",
        tokenEstimate: 1,
        artifactVersionId: version.id,
      },
    });
    expect(ok.artifactVersionId).toBe(version.id);
  });

  it("rejects a duplicate provider inbound event id", async () => {
    const eventId = randomUUID();
    await db.inboundEventReceipt.create({
      data: { provider: "DISCORD", providerEventId: eventId, kind: "INTERACTION" },
    });
    await expect(
      db.inboundEventReceipt.create({
        data: { provider: "DISCORD", providerEventId: eventId, kind: "INTERACTION" },
      }),
    ).rejects.toThrow();
  });
});
