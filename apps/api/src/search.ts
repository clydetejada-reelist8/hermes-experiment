import { db, Prisma } from "@hermes/db";
import { getKnowledgeAccessContext, hasKnowledgeCapability } from "@hermes/policy";

export interface SearchInput {
  employeeId: string;
  query: string;
  limit: number;
}

export interface SearchEvidence {
  chunkId: string;
  text: string;
  knowledgeStatus: string;
  scope: string;
  sourceType: string;
  citation: string;
  sourceTitle?: string;
  artifactId?: string;
  artifactVersionId?: string;
  ssotVersionId?: string;
  version?: number;
  effectiveFrom?: string;
  effectiveUntil?: string;
  provenance?: string;
}

interface SearchRow {
  chunkId: string;
  text: string;
  knowledgeStatus: string;
  scope: string;
  sourceType: string;
  artifactId: string | null;
  artifactVersionId: string | null;
  ssotVersionId: string | null;
  sourceLocator: string | null;
  sourceTitle: string | null;
  versionNumber: number | null;
  effectiveFrom: Date | null;
  effectiveUntil: Date | null;
  artifactMode: string | null;
}

/**
 * Search only evidence visible to the resolved employee.
 *
 * The authorization context is loaded before SQL retrieval. The SQL predicate
 * then applies capability, audience, membership, source-grant, and expiry
 * checks so unauthorized rows never become search results or model context.
 */
export async function searchVisibleKnowledge(input: SearchInput): Promise<SearchEvidence[]> {
  const query = input.query.trim();
  if (!query) return [];

  const access = await getKnowledgeAccessContext(input.employeeId);
  const teamIds = access.teamIds.length > 0 ? access.teamIds : ["__none__"];
  const projectIds = access.projectIds.length > 0 ? access.projectIds : ["__none__"];
  const visibleTeams = Prisma.join(teamIds);
  const visibleProjects = Prisma.join(projectIds);
  const canReadPersonal = hasKnowledgeCapability(access, "KNOWLEDGE_READ_PERSONAL");
  const canReadTeam = hasKnowledgeCapability(access, "KNOWLEDGE_READ_TEAM");
  const canReadCompany = hasKnowledgeCapability(access, "KNOWLEDGE_READ_COMPANY");
  const limit = Math.max(1, Math.min(input.limit, 20));

  const rows = await db.$queryRaw<SearchRow[]>`
    WITH visible_artifacts AS (
      SELECT DISTINCT s."artifactId"
      FROM "ArtifactSubmission" s
      JOIN "Artifact" a ON a.id = s."artifactId"
      WHERE s.active = true
        AND (
          (${canReadPersonal} = true AND s.scope IN ('PERSONAL', 'THREAD_ONLY') AND s."ownerEmployeeId" = ${input.employeeId})
          OR (${canReadTeam} = true AND s.scope = 'TEAM' AND s."teamId" IN (${visibleTeams}))
          OR (${canReadTeam} = true AND s.scope = 'PROJECT' AND s."projectId" IN (${visibleProjects}))
          OR (${canReadCompany} = true AND s.scope = 'COMPANY')
        )
        AND (
          (a.mode = 'IMPORTED' AND (
            NOT EXISTS (
              SELECT 1 FROM "SourceAccessGrant" denied_grant
              WHERE denied_grant."artifactId" = a.id
                AND denied_grant."employeeId" = ${input.employeeId}
            )
            OR EXISTS (
              SELECT 1 FROM "SourceAccessGrant" allowed_grant
              WHERE allowed_grant."artifactId" = a.id
                AND allowed_grant."employeeId" = ${input.employeeId}
                AND allowed_grant.state = 'ALLOWED'
                AND (allowed_grant."expiresAt" IS NULL OR allowed_grant."expiresAt" > CURRENT_TIMESTAMP)
            )
          ))
          OR (a.mode = 'LINKED' AND EXISTS (
            SELECT 1 FROM "SourceAccessGrant" linked_grant
            WHERE linked_grant."artifactId" = a.id
              AND linked_grant."employeeId" = ${input.employeeId}
              AND linked_grant.state = 'ALLOWED'
              AND (linked_grant."expiresAt" IS NULL OR linked_grant."expiresAt" > CURRENT_TIMESTAMP)
          ))
        )
    ),
    visible_submission_info AS (
      SELECT DISTINCT ON (s."artifactId")
        s."artifactId",
        s."knowledgeStatus"::text AS "knowledgeStatus",
        s.scope::text AS scope
      FROM "ArtifactSubmission" s
      WHERE s."artifactId" IN (SELECT "artifactId" FROM visible_artifacts)
        AND s.active = true
      ORDER BY s."artifactId", s."createdAt" DESC
    )
    SELECT
      kc.id AS "chunkId",
      kc.text,
      COALESCE(vsi."knowledgeStatus", CASE WHEN kc."ssotVersionId" IS NOT NULL THEN 'OFFICIAL' ELSE 'REFERENCE' END) AS "knowledgeStatus",
      COALESCE(vsi.scope, CASE WHEN kc."ssotVersionId" IS NOT NULL THEN 'COMPANY' ELSE 'UNKNOWN' END) AS scope,
      kc."sourceType"::text AS "sourceType",
      a.id AS "artifactId",
      kc."artifactVersionId",
      kc."ssotVersionId",
      kc."sourceLocator",
      COALESCE(sr.title, a."originalFilename") AS "sourceTitle",
      COALESCE(sv."versionNumber", av."versionNumber") AS "versionNumber",
      COALESCE(sv."effectiveFrom", av."effectiveFrom") AS "effectiveFrom",
      COALESCE(sv."effectiveUntil", av."effectiveUntil") AS "effectiveUntil",
      a.mode::text AS "artifactMode"
    FROM "KnowledgeChunk" kc
    LEFT JOIN "ArtifactVersion" av ON av.id = kc."artifactVersionId"
    LEFT JOIN "Artifact" a ON a.id = av."artifactId"
    LEFT JOIN "SSOTVersion" sv ON sv.id = kc."ssotVersionId"
    LEFT JOIN "SSOTRecord" sr ON sr.id = sv."ssotRecordId"
    LEFT JOIN visible_submission_info vsi ON vsi."artifactId" = a.id
    WHERE (
      (kc."artifactVersionId" IS NOT NULL AND a.id IN (SELECT "artifactId" FROM visible_artifacts))
      OR (kc."ssotVersionId" IS NOT NULL AND ${canReadCompany} = true)
    )
    AND (
      kc.text ILIKE ${`%${query}%`}
      OR to_tsvector('simple', COALESCE(kc."textSearchDocument", kc.text))
          @@ plainto_tsquery('simple', ${query})
      OR to_tsvector('english', COALESCE(kc."textSearchDocument", kc.text))
          @@ plainto_tsquery('english', ${query})
    )
    ORDER BY ts_rank_cd(
      to_tsvector('english', COALESCE(kc."textSearchDocument", kc.text)),
      plainto_tsquery('english', ${query})
    ) DESC, (CASE WHEN kc.text ILIKE ${`%${query}%`} THEN 0 ELSE 1 END), kc."createdAt" DESC
    LIMIT ${limit}
  `;

  const typedRows = rows as unknown as SearchRow[];
  return typedRows.map((row) => ({
    chunkId: row.chunkId,
    text: row.text,
    knowledgeStatus: row.knowledgeStatus,
    scope: row.scope,
    sourceType: row.sourceType,
    citation:
      row.sourceLocator ??
      row.artifactVersionId ??
      row.ssotVersionId ??
      row.artifactId ??
      row.chunkId,
    sourceTitle: row.sourceTitle ?? undefined,
    artifactId: row.artifactId ?? undefined,
    artifactVersionId: row.artifactVersionId ?? undefined,
    ssotVersionId: row.ssotVersionId ?? undefined,
    version: row.versionNumber ?? undefined,
    effectiveFrom: row.effectiveFrom?.toISOString(),
    effectiveUntil: row.effectiveUntil?.toISOString(),
    provenance: row.sourceLocator ?? undefined,
  }));
}
