-- REELIST8 Control Plane integrity constraints.
-- Prisma db push does not apply migration-only SQL, so CI and fresh staging
-- deployments apply these same invariants explicitly.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'knowledgechunk_exactly_one_source'
  ) THEN
    ALTER TABLE "KnowledgeChunk"
      ADD CONSTRAINT knowledgechunk_exactly_one_source
      CHECK (("artifactVersionId" IS NULL) <> ("ssotVersionId" IS NULL));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'artifactsubmission_scope_requires_membership'
  ) THEN
    ALTER TABLE "ArtifactSubmission"
      ADD CONSTRAINT artifactsubmission_scope_requires_membership
      CHECK (
        ("scope" <> 'PROJECT' OR "projectId" IS NOT NULL)
        AND ("scope" <> 'TEAM' OR "teamId" IS NOT NULL)
      );
  END IF;
END $$;
