-- Add durable document extraction state while preserving original uploads.
CREATE TYPE "ExtractionStatus" AS ENUM ('UPLOADED', 'PROCESSING', 'READY', 'FAILED', 'UNSUPPORTED');

ALTER TABLE "ArtifactVersion"
  ADD COLUMN "originalObjectKey" TEXT,
  ADD COLUMN "extractionStatus" "ExtractionStatus" NOT NULL DEFAULT 'UPLOADED',
  ADD COLUMN "extractionError" TEXT,
  ADD COLUMN "extractionMetadata" JSONB,
  ADD COLUMN "extractedAt" TIMESTAMP(3);
