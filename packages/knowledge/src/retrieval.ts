import { db } from "@hermes/db";

/**
 * Embedding function interface (re-exported for retrieval consumers).
 */
export interface EmbeddingFunction {
  embed(text: string): Promise<number[]>;
}

export type AudienceClassification = "PRIVATE" | "TEAM" | "COMPANY";

export interface RetrievalResult {
  chunkId: string;
  text: string;
  sourceType: string;
  artifactId?: string;
  artifactVersionId?: string;
  ssotVersionId?: string;
  chunkIndex: number;
  semanticScore: number;
  keywordScore: number;
  knowledgeStatus: string;
  dataSensitivity: string;
  scope: string;
  artifactMode?: string;
  syncState?: string;
}

export interface HybridRetrieveInput {
  employeeId: string;
  query: string;
  queryEmbedding: number[];
  limit: number;
  embeddingFn: EmbeddingFunction;
  /**
   * The audience classification of the conversation that this retrieval is
   * serving. This determines which scopes are eligible:
   *   - PRIVATE: all visible scopes (PERSONAL, THREAD_ONLY, TEAM, PROJECT, COMPANY)
   *   - TEAM: only TEAM and COMPANY scopes (PERSONAL/THREAD_ONLY never leak)
   *   - COMPANY: only COMPANY scopes
   *
   * PERSONAL and THREAD_ONLY chunks are never included in TEAM or COMPANY
   * answers (Section 25).
   */
  audience?: AudienceClassification;
}

/**
 * Hybrid retrieval combining semantic (vector similarity) and keyword
 * (full-text search) matching, with deterministic permission filtering.
 *
 * Permission filtering is applied at the SQL level — chunks from artifacts
 * the employee cannot see are never fetched. This is the core safety
 * property: the model never sees unauthorized content.
 *
 * Additional safety filters:
 *   - HIGHLY_SENSITIVE chunks are never retrieved (Section 34).
 *   - PERSONAL/THREAD_ONLY chunks are excluded for TEAM/COMPANY audiences (Section 25).
 *   - LINKED-mode artifacts are only retrievable for PRIVATE audiences (Section 13.4).
 */
export async function hybridRetrieve(input: HybridRetrieveInput): Promise<RetrievalResult[]> {
  const teamMemberships = await db.employeeTeam.findMany({
    where: { employeeId: input.employeeId },
    select: { teamId: true },
  });
  const projectMemberships = await db.projectMember.findMany({
    where: { employeeId: input.employeeId },
    select: { projectId: true },
  });
  const teamIds = teamMemberships.map((t: { teamId: string }) => t.teamId);
  const projectIds = projectMemberships.map((p: { projectId: string }) => p.projectId);
  const queryVector = `[${input.queryEmbedding.join(",")}]`;

  const teamArray = teamIds.length > 0 ? teamIds : ["__none__"];
  const projectArray = projectIds.length > 0 ? projectIds : ["__none__"];

  // Determine which scopes are eligible based on the audience classification.
  // PRIVATE answers can use any visible scope.
  // TEAM answers can only use TEAM and COMPANY scopes.
  // COMPANY answers can only use COMPANY scope.
  const audience = input.audience ?? "PRIVATE";
  const eligibleScopes: string[] =
    audience === "PRIVATE"
      ? ["PERSONAL", "THREAD_ONLY", "TEAM", "PROJECT", "COMPANY"]
      : audience === "TEAM"
        ? ["TEAM", "COMPANY"]
        : ["COMPANY"];

  // LINKED-mode artifacts are only retrievable for PRIVATE audiences (Section 13.4).
  // We pass this as a parameter and filter in SQL.
  const excludeLinked = audience !== "PRIVATE";

  // Use a subquery to get visible artifact IDs, then join with KnowledgeChunk
  // through ArtifactVersion. This avoids CROSS JOIN duplicates.
  // SSOT chunks (ssotVersionId IS NOT NULL) are always visible.
  const rows = await db.$queryRaw<RetrievalResult[]>`
    WITH visible_artifacts AS (
      SELECT DISTINCT s."artifactId",
             a.mode AS "artifactMode",
             a."syncState" AS "syncState"
      FROM "ArtifactSubmission" s
      JOIN "Artifact" a ON s."artifactId" = a.id
      WHERE s.active = true
        AND s."dataSensitivity"::text != 'HIGHLY_SENSITIVE'
        AND s.scope::text = ANY(${eligibleScopes}::text[])
        AND (
          (s.scope::text = 'PERSONAL' AND s."ownerEmployeeId" = ${input.employeeId})
          OR (s.scope::text = 'THREAD_ONLY' AND s."ownerEmployeeId" = ${input.employeeId})
          OR (s.scope::text = 'TEAM' AND s."teamId" = ANY(${teamArray}::text[]))
          OR (s.scope::text = 'PROJECT' AND s."projectId" = ANY(${projectArray}::text[]))
          OR (s.scope::text = 'COMPANY')
        )
    ),
    visible_submission_info AS (
      SELECT DISTINCT ON (s."artifactId")
        s."artifactId",
        s."knowledgeStatus",
        s."dataSensitivity",
        s.scope
      FROM "ArtifactSubmission" s
      WHERE s.active = true
        AND s."dataSensitivity"::text != 'HIGHLY_SENSITIVE'
        AND s.scope::text = ANY(${eligibleScopes}::text[])
        AND (
          (s.scope::text = 'PERSONAL' AND s."ownerEmployeeId" = ${input.employeeId})
          OR (s.scope::text = 'THREAD_ONLY' AND s."ownerEmployeeId" = ${input.employeeId})
          OR (s.scope::text = 'TEAM' AND s."teamId" = ANY(${teamArray}::text[]))
          OR (s.scope::text = 'PROJECT' AND s."projectId" = ANY(${projectArray}::text[]))
          OR (s.scope::text = 'COMPANY')
        )
      ORDER BY s."artifactId", s."createdAt" DESC
    )
    SELECT
      kc.id AS "chunkId",
      kc.text,
      kc."sourceType"::text AS "sourceType",
      av."artifactId",
      kc."artifactVersionId",
      kc."ssotVersionId",
      kc."chunkIndex",
      (1 - (kc.embedding <=> ${queryVector}::vector) / 2) AS "semanticScore",
      ts_rank_cd(to_tsvector('english', kc.text), plainto_tsquery('english', ${input.query})) AS "keywordScore",
      COALESCE(vsi."knowledgeStatus"::text, 'REFERENCE') AS "knowledgeStatus",
      COALESCE(vsi."dataSensitivity"::text, 'NORMAL') AS "dataSensitivity",
      COALESCE(vsi.scope::text, 'COMPANY') AS scope,
      va."artifactMode"::text AS "artifactMode",
      va."syncState"::text AS "syncState"
    FROM "KnowledgeChunk" kc
    LEFT JOIN "ArtifactVersion" av ON kc."artifactVersionId" = av.id
    LEFT JOIN visible_artifacts va ON av."artifactId" = va."artifactId"
    LEFT JOIN visible_submission_info vsi ON av."artifactId" = vsi."artifactId"
    WHERE
      -- Artifact-version chunks: must be in a visible artifact
      (kc."artifactVersionId" IS NOT NULL AND va."artifactId" IS NOT NULL)
      OR
      -- SSOT chunks: always visible (not subject to artifact scope filtering)
      (kc."ssotVersionId" IS NOT NULL)
    ORDER BY
      (COALESCE(kc.embedding <=> ${queryVector}::vector, 2) * 0.7
       + (1 - ts_rank_cd(to_tsvector('english', kc.text), plainto_tsquery('english', ${input.query}))) * 0.3) ASC
    LIMIT ${input.limit}
  `;

  // Post-filter: exclude LINKED-mode artifacts for non-PRIVATE audiences
  // (Section 13.4). This is a defense-in-depth check in addition to the
  // scope filtering above.
  const scopeFiltered = excludeLinked
    ? rows.filter((r: RetrievalResult) => r.artifactMode !== "LINKED")
    : rows;

  // For LINKED artifacts remaining (PRIVATE audience), revalidate that the
  // requesting employee still has current Google source access and that the
  // artifact is SYNCED (Section 13.4 / Section 24.2).
  const accessFiltered = await checkLinkedSourceAccess(input.employeeId, scopeFiltered);

  return accessFiltered;
}

/**
 * Revalidate source access for LINKED artifacts (Section 13.4 / Section 24.2).
 *
 * For each LINKED result, verify that a current (non-expired) ALLOWED
 * SourceAccessGrant exists for the requesting employee + artifact, and that
 * the artifact's syncState is SYNCED. LINKED artifacts that fail either check
 * are filtered out. Non-LINKED artifacts pass through unchanged.
 */
async function checkLinkedSourceAccess(
  employeeId: string,
  results: RetrievalResult[],
): Promise<RetrievalResult[]> {
  const linkedArtifacts = results.filter((r) => r.artifactMode === "LINKED" && r.artifactId);
  if (linkedArtifacts.length === 0) {
    return results;
  }

  const artifactIds = [...new Set(linkedArtifacts.map((r) => r.artifactId!))];

  const grants = await db.sourceAccessGrant.findMany({
    where: {
      employeeId,
      artifactId: { in: artifactIds },
    },
    orderBy: { createdAt: "desc" },
  });

  // Map artifactId -> latest grant (query is ordered by createdAt desc, so
  // the first occurrence per artifactId is the most recent).
  const latestGrantByArtifact = new Map<string, (typeof grants)[number]>();
  for (const g of grants) {
    if (!latestGrantByArtifact.has(g.artifactId)) {
      latestGrantByArtifact.set(g.artifactId, g);
    }
  }

  const now = new Date();
  return results.filter((r) => {
    if (r.artifactMode !== "LINKED") {
      return true;
    }
    // Section 13.4: LINKED artifacts require syncState == SYNCED.
    if (r.syncState !== "SYNCED") {
      return false;
    }
    const grant = r.artifactId ? latestGrantByArtifact.get(r.artifactId) : undefined;
    if (!grant || grant.state !== "ALLOWED") {
      return false;
    }
    // Non-expired: expiresAt is null or in the future.
    if (grant.expiresAt && grant.expiresAt <= now) {
      return false;
    }
    return true;
  });
}
