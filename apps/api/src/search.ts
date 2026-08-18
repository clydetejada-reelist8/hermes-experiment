import { db, Prisma } from "@hermes/db";

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
}

/**
 * Search only evidence visible to the resolved employee.
 *
 * This first V1 path deliberately uses PostgreSQL full-text search only. It
 * does not call an LLM or a paid embedding API. Vector search can be added
 * later without changing the permission boundary.
 */
export async function searchVisibleKnowledge(input: SearchInput): Promise<SearchEvidence[]> {
  const query = input.query.trim();
  if (!query) return [];

  const [teamMemberships, projectMemberships] = await Promise.all([
    db.employeeTeam.findMany({
      where: { employeeId: input.employeeId },
      select: { teamId: true },
    }),
    db.projectMember.findMany({
      where: { employeeId: input.employeeId },
      select: { projectId: true },
    }),
  ]);

  const teamIds: string[] = teamMemberships.map(
    (membership: { teamId: string }) => membership.teamId,
  );
  const projectIds: string[] = projectMemberships.map(
    (membership: { projectId: string }) => membership.projectId,
  );
  const visibleTeams = teamIds.length > 0 ? Prisma.join(teamIds) : Prisma.sql`'__none__'`;
  const visibleProjects = projectIds.length > 0 ? Prisma.join(projectIds) : Prisma.sql`'__none__'`;
  const limit = Math.max(1, Math.min(input.limit, 20));

  const rows = await db.$queryRaw<SearchRow[]>`
    WITH visible_artifacts AS (
      SELECT DISTINCT s."artifactId"
      FROM "ArtifactSubmission" s
      WHERE s.active = true
        AND (
          (s.scope IN ('PERSONAL', 'THREAD_ONLY') AND s."ownerEmployeeId" = ${input.employeeId})
          OR (s.scope = 'TEAM' AND s."teamId" = ANY(ARRAY[${visibleTeams}]::text[]))
          OR (s.scope = 'PROJECT' AND s."projectId" = ANY(ARRAY[${visibleProjects}]::text[]))
          OR (s.scope = 'COMPANY')
        )
    ),
    visible_submission_info AS (
      SELECT DISTINCT ON (s."artifactId")
        s."artifactId",
        s."knowledgeStatus"::text AS "knowledgeStatus",
        s.scope::text AS scope
      FROM "ArtifactSubmission" s
      WHERE s.active = true
        AND (
          (s.scope IN ('PERSONAL', 'THREAD_ONLY') AND s."ownerEmployeeId" = ${input.employeeId})
          OR (s.scope = 'TEAM' AND s."teamId" = ANY(ARRAY[${visibleTeams}]::text[]))
          OR (s.scope = 'PROJECT' AND s."projectId" = ANY(ARRAY[${visibleProjects}]::text[]))
          OR (s.scope = 'COMPANY')
        )
      ORDER BY s."artifactId", s."createdAt" DESC
    )
    SELECT
      kc.id AS "chunkId",
      kc.text,
      COALESCE(vsi."knowledgeStatus", CASE WHEN kc."ssotVersionId" IS NOT NULL THEN 'OFFICIAL' ELSE 'REFERENCE' END) AS "knowledgeStatus",
      COALESCE(vsi.scope, CASE WHEN kc."ssotVersionId" IS NOT NULL THEN 'COMPANY' ELSE 'UNKNOWN' END) AS scope,
      kc."sourceType"::text AS "sourceType",
      av."artifactId",
      kc."artifactVersionId",
      kc."ssotVersionId",
      kc."sourceLocator"
    FROM "KnowledgeChunk" kc
    LEFT JOIN "ArtifactVersion" av ON av.id = kc."artifactVersionId"
    LEFT JOIN visible_artifacts va ON va."artifactId" = av."artifactId"
    LEFT JOIN visible_submission_info vsi ON vsi."artifactId" = av."artifactId"
    WHERE (
      (kc."artifactVersionId" IS NOT NULL AND va."artifactId" IS NOT NULL)
      OR kc."ssotVersionId" IS NOT NULL
    )
    AND to_tsvector('english', COALESCE(kc."textSearchDocument", kc.text))
        @@ plainto_tsquery('english', ${query})
    ORDER BY ts_rank_cd(
      to_tsvector('english', COALESCE(kc."textSearchDocument", kc.text)),
      plainto_tsquery('english', ${query})
    ) DESC, kc."createdAt" DESC
    LIMIT ${limit}
  `;

  return rows.map((row: SearchRow) => ({
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
  }));
}
