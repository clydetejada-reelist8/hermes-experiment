import { db } from "@hermes/db";
import { getKnowledgeAccessContext, hasKnowledgeCapability } from "@hermes/policy";

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
  const access = await getKnowledgeAccessContext(input.employeeId);
  const teamArray = access.teamIds.length > 0 ? access.teamIds : ["__none__"];
  const projectArray = access.projectIds.length > 0 ? access.projectIds : ["__none__"];
  const canReadPersonal = hasKnowledgeCapability(access, "KNOWLEDGE_READ_PERSONAL");
  const canReadTeam = hasKnowledgeCapability(access, "KNOWLEDGE_READ_TEAM");
  const canReadCompany = hasKnowledgeCapability(access, "KNOWLEDGE_READ_COMPANY");
  const queryVector = `[${input.queryEmbedding.join(",")}]`;

  // Use a subquery to get visible artifact IDs, then join with KnowledgeChunk
  // through ArtifactVersion. This avoids CROSS JOIN duplicates.
  // Every visibility branch includes the relevant capability and membership.
  const rows = await db.$queryRaw<RetrievalResult[]>`
    WITH visible_artifacts AS (
      SELECT DISTINCT s."artifactId"
      FROM "ArtifactSubmission" s
      WHERE s.active = true
        AND (
          (${canReadPersonal} = true AND s.scope = 'PERSONAL' AND s."ownerEmployeeId" = ${input.employeeId})
          OR (${canReadPersonal} = true AND s.scope = 'THREAD_ONLY' AND s."ownerEmployeeId" = ${input.employeeId})
          OR (${canReadTeam} = true AND s.scope = 'TEAM' AND s."teamId" = ANY(${teamArray}::text[]))
          OR (s.scope = 'PROJECT' AND ${canReadTeam} = true AND s."projectId" = ANY(${projectArray}::text[]))
          OR (${canReadCompany} = true AND s.scope = 'COMPANY')
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
          (${canReadPersonal} = true AND s.scope = 'PERSONAL' AND s."ownerEmployeeId" = ${input.employeeId})
          OR (${canReadPersonal} = true AND s.scope = 'THREAD_ONLY' AND s."ownerEmployeeId" = ${input.employeeId})
          OR (${canReadTeam} = true AND s.scope = 'TEAM' AND s."teamId" = ANY(${teamArray}::text[]))
          OR (s.scope = 'PROJECT' AND ${canReadTeam} = true AND s."projectId" = ANY(${projectArray}::text[]))
          OR (${canReadCompany} = true AND s.scope = 'COMPANY')
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
    LEFT JOIN "Artifact" a ON av."artifactId" = a.id
    LEFT JOIN visible_artifacts va ON av."artifactId" = va."artifactId"
    LEFT JOIN visible_submission_info vsi ON vsi."artifactId" = va."artifactId"
    WHERE (
      (
        kc."artifactVersionId" IS NOT NULL
        AND va."artifactId" IS NOT NULL
      )
      OR (kc."ssotVersionId" IS NOT NULL AND ${canReadCompany} = true)
    )
    AND (
      kc."ssotVersionId" IS NOT NULL
      OR (
        a.mode = 'IMPORTED'
        AND (
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
        )
      )
      OR (
        a.mode = 'LINKED'
        AND EXISTS (
          SELECT 1 FROM "SourceAccessGrant" linked_grant
          WHERE linked_grant."artifactId" = a.id
            AND linked_grant."employeeId" = ${input.employeeId}
            AND linked_grant.state = 'ALLOWED'
            AND (linked_grant."expiresAt" IS NULL OR linked_grant."expiresAt" > CURRENT_TIMESTAMP)
        )
      )
    )    ORDER BY
      (COALESCE(kc.embedding <=> ${queryVector}::vector, 2) * 0.7
       + (1 - ts_rank_cd(to_tsvector('english', kc.text), plainto_tsquery('english', ${input.query}))) * 0.3) ASC
    LIMIT ${input.limit}
  `;

  return rows;
}
