import type { RetrievalResult } from "@hermes/knowledge";

export interface CitationValidationResult {
  valid: boolean;
  citedIds: string[];
  unsupportedCitations: string[];
  missingCitations: boolean;
}

/**
 * Validate that every citation in the model's answer references a chunk
 * that was actually present in the context window.
 *
 * This prevents hallucinated citations — the model cannot reference sources
 * it was not given. It also enforces that the answer contains at least one
 * citation (no uncited claims).
 */
export function validateCitations(
  answer: string,
  chunks: RetrievalResult[],
): CitationValidationResult {
  // Extract all citation markers [xxx] from the answer.
  const citationPattern = /\[([^\]]+)\]/g;
  const citedIds: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = citationPattern.exec(answer)) !== null) {
    citedIds.push(match[1]!);
  }

  const contextIds = new Set(chunks.map((c) => c.chunkId));
  const unsupportedCitations = citedIds.filter((id) => !contextIds.has(id));
  const missingCitations = citedIds.length === 0;

  return {
    valid: unsupportedCitations.length === 0 && !missingCitations,
    citedIds,
    unsupportedCitations,
    missingCitations,
  };
}
