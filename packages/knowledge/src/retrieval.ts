import { db } from "@hermes/db";

/**
 * Embedding function interface (re-exported for retrieval consumers).
 */
export interface EmbeddingFunction {
  embed(text: string): Promise<number[]>;
}

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
}

export interface HybridRetrieveInput {
  employeeId: string;
  query: string;
  queryEmbedding: number[];
  limit: number;
  embeddingFn: EmbeddingFunction;
}

/**
 * Hybrid retrieval combining semantic (vector similarity) and keyword
 * (full-text search) matching, with deterministic permission filtering.
 *
 * Permission filtering is applied at the SQL level — chunks from artifacts
 * the employee cannot see are never fetched. This is the core safety
 * property: the model never sees unauthorized content.
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

  // Use a subquery to get visible artifact IDs, then join with KnowledgeChunk
  // through ArtifactVersion. This avoids CROSS JOIN duplicates.
  // SSOT chunks (ssotVersionId IS NOT NULL) are always visible.
  const rows = await db.$queryRaw<RetrievalResult[]>`
    WITH visible_artifacts AS (
      SELECT DISTINCT s."artifactId"
      FROM "ArtifactSubmission" s
      WHERE s.active = true
        AND (
          (s.scope = 'PERSONAL' AND s."ownerEmployeeId" = ${input.employeeId})
          OR (s.scope = 'THREAD_ONLY' AND s."ownerEmployeeId" = ${input.employeeId})
          OR (s.scope = 'TEAM' AND s."teamId" = ANY(${teamArray}::text[]))
          OR (s.scope = 'PROJECT' AND s."projectId" = ANY(${projectArray}::text[]))
          OR (s.scope = 'COMPANY')
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
        AND (
          (s.scope = 'PERSONAL' AND s."ownerEmployeeId" = ${input.employeeId})
          OR (s.scope = 'THREAD_ONLY' AND s."ownerEmployeeId" = ${input.employeeId})
          OR (s.scope = 'TEAM' AND s."teamId" = ANY(${teamArray}::text[]))
          OR (s.scope = 'PROJECT' AND s."projectId" = ANY(${projectArray}::text[]))
          OR (s.scope = 'COMPANY')
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
      COALESCE(vsi.scope::text, 'COMPANY') AS scope
    FROM "KnowledgeChunk" kc
    LEFT JOIN "ArtifactVersion" av ON kc."artifactVersionId" = av.id
    LEFT JOIN visible_artifacts va ON av."artifactId" = va."artifactId"
    LEFT JOIN visible_submission_info vsi ON av."artifactId" = vsi."artifactId"
    WHERE
      (kc."artifactVersionId" IS NOT NULL AND va."artifactId" IS NOT NULL)
      OR (kc."ssotVersionId" IS NOT NULL)
    ORDER BY
      (COALESCE(kc.embedding <=> ${queryVector}::vector, 2) * 0.7
       + (1 - ts_rank_cd(to_tsvector('english', kc.text), plainto_tsquery('english', ${input.query}))) * 0.3) ASC
    LIMIT ${input.limit}
  `;

  return rows;
}
