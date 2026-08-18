import { createHash } from "node:crypto";
import { db } from "@hermes/db";
import { chunkText } from "@hermes/knowledge";

export interface ImportSSOTContentInput {
  authorityDomain: string;
  subjectKey: string;
  title: string;
  content: string;
  sourceLocator: string;
  approvedByEmployeeId: string;
  effectiveFrom?: Date;
}

export interface ImportSSOTContentResult {
  recordId: string;
  versionId: string;
  versionNumber: number;
  chunkCount: number;
  unchanged: boolean;
}

/**
 * Idempotently import administrator-approved content as an SSOT version.
 * Existing content is not duplicated; changed content creates a new version.
 */
export async function importSSOTContent(
  input: ImportSSOTContentInput,
): Promise<ImportSSOTContentResult> {
  const content = input.content.trim();
  if (!content) throw new Error("ssot_content_empty");

  await db.authorityDomain.upsert({
    where: { domain: input.authorityDomain },
    create: { domain: input.authorityDomain },
    update: {},
  });

  const record = await db.sSOTRecord.upsert({
    where: {
      authorityDomain_subjectKey: {
        authorityDomain: input.authorityDomain,
        subjectKey: input.subjectKey,
      },
    },
    create: {
      authorityDomain: input.authorityDomain,
      subjectKey: input.subjectKey,
      title: input.title,
    },
    update: { title: input.title },
  });

  const current = await db.sSOTVersion.findFirst({
    where: { ssotRecordId: record.id },
    orderBy: { versionNumber: "desc" },
  });
  if (current?.content === content) {
    const chunkCount = await db.knowledgeChunk.count({ where: { ssotVersionId: current.id } });
    return {
      recordId: record.id,
      versionId: current.id,
      versionNumber: current.versionNumber,
      chunkCount,
      unchanged: true,
    };
  }

  const effectiveFrom = input.effectiveFrom ?? new Date();
  if (current) {
    await db.sSOTVersion.update({
      where: { id: current.id },
      data: { effectiveUntil: effectiveFrom },
    });
  }

  const version = await db.sSOTVersion.create({
    data: {
      ssotRecordId: record.id,
      versionNumber: (current?.versionNumber ?? 0) + 1,
      content,
      effectiveFrom,
      approvedByEmployeeId: input.approvedByEmployeeId,
    },
  });

  const chunks = chunkText(content, { maxTokens: 500, overlapTokens: 50 });
  for (const chunk of chunks) {
    await db.knowledgeChunk.create({
      data: {
        sourceType: "SSOT_VERSION",
        ssotVersionId: version.id,
        chunkIndex: chunk.chunkIndex,
        text: chunk.text,
        tokenEstimate: chunk.tokenEstimate,
        sourceLocator: input.sourceLocator,
      },
    });
  }

  await db.sSOTRecord.update({
    where: { id: record.id },
    data: { currentVersionId: version.id },
  });

  return {
    recordId: record.id,
    versionId: version.id,
    versionNumber: version.versionNumber,
    chunkCount: chunks.length,
    unchanged: false,
  };
}

export function ssotSubjectKey(sourceLocator: string): string {
  return createHash("sha256").update(sourceLocator).digest("hex");
}
