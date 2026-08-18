import { db } from "@hermes/db";
import { evaluateCapability } from "@hermes/policy";

export interface SSOTDocument {
  recordId: string;
  versionId: string;
  title: string;
  authorityDomain: string;
  content: string;
  sourceLocators: string[];
  effectiveFrom: Date;
  effectiveUntil: Date | null;
}

/** Return a complete official SSOT document after employee authorization. */
export async function getSSOTDocumentForEmployee(
  employeeId: string,
  versionId: string,
): Promise<SSOTDocument> {
  const decision = await evaluateCapability(employeeId, "KNOWLEDGE_READ_COMPANY");
  if (!decision.allowed) throw new Error("ssot_document_access_denied");

  const version = await db.sSOTVersion.findUnique({
    where: { id: versionId },
    include: { ssotRecord: true, chunks: { select: { sourceLocator: true } } },
  });
  if (!version) throw new Error("ssot_document_not_found");

  return {
    recordId: version.ssotRecord.id,
    versionId: version.id,
    title: version.ssotRecord.title,
    authorityDomain: version.ssotRecord.authorityDomain,
    content: version.content,
    sourceLocators: Array.from(
      new Set<string>(
        version.chunks
          .map((chunk: { sourceLocator: string | null }) => chunk.sourceLocator)
          .filter((locator: string | null): locator is string => Boolean(locator)),
      ),
    ),
    effectiveFrom: version.effectiveFrom,
    effectiveUntil: version.effectiveUntil,
  };
}
