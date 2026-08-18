import type { ArtifactScope, KnowledgeStatus, DataSensitivity } from "@hermes/contracts";
import { classifySensitivity } from "@hermes/memory";

export interface ClassifySubmissionInput {
  filename: string;
  mimeType: string;
  content: string;
  submittedByEmployeeId: string;
  teamId?: string;
  projectId?: string;
}

export interface ClassificationResult {
  scope: ArtifactScope;
  sensitivity: DataSensitivity;
  knowledgeStatus: KnowledgeStatus;
}

/**
 * Deterministic classification of an artifact submission.
 *
 * This is a RULE-BASED classifier — no model authority. The classification
 * determines the initial scope, sensitivity, and knowledge status of a
 * submission. The employee can override the scope (e.g., share a personal
 * document with their team) but cannot downgrade the sensitivity.
 *
 * Rules:
 *   - Sensitivity is determined by content patterns (SSN, salary, etc.)
 *   - Scope defaults to PERSONAL (most restrictive)
 *   - Knowledge status is PERSONAL_CONTEXT for personal docs, REFERENCE otherwise
 */
export function classifySubmission(input: ClassifySubmissionInput): ClassificationResult {
  // Sensitivity is determined by the memory package's deterministic rules.
  const sensitivity = classifySensitivity(input.content);

  // Scope defaults to PERSONAL — the most restrictive scope.
  // The employee can later upgrade to TEAM or PROJECT if they choose to share.
  const scope: ArtifactScope = "PERSONAL";

  // Knowledge status: personal notes get PERSONAL_CONTEXT, everything else
  // gets REFERENCE (can be cited in answers).
  const isPersonalNote =
    input.mimeType === "text/plain" && /note|personal|my/i.test(input.filename);

  const knowledgeStatus: KnowledgeStatus = isPersonalNote ? "PERSONAL_CONTEXT" : "REFERENCE";

  return {
    scope,
    sensitivity,
    knowledgeStatus,
  };
}
