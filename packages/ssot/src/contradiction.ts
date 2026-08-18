export interface Contradiction {
  type: "NEGATION" | "NUMERIC_CONFLICT" | "RULE_CONFLICT";
  ssotIndex: number;
  ssotSnippet: string;
  newSnippet: string;
  explanation: string;
}

export interface ContradictionResult {
  contradictions: Contradiction[];
  requiresReview: boolean;
}

/**
 * Deterministic contradiction detection between new content and existing SSOT
 * records.
 *
 * This is a RULE-BASED detector — no model authority. It uses pattern matching
 * to detect common contradiction patterns:
 *   - Direct negation ("X must" vs "X does not need to")
 *   - Conflicting numeric values for the same subject
 *   - Mandatory vs optional rule conflicts
 *
 * When contradictions are found, the content is flagged for human review.
 * The system NEVER silently allows contradictions — it always surfaces them.
 */
export function detectContradictions(
  newContent: string,
  ssotContents: string[],
): ContradictionResult {
  const contradictions: Contradiction[] = [];

  for (let i = 0; i < ssotContents.length; i++) {
    const ssot = ssotContents[i]!;

    const negationContradictions = detectNegationContradiction(ssot, newContent, i);
    contradictions.push(...negationContradictions);

    const numericContradictions = detectNumericConflict(ssot, newContent, i);
    contradictions.push(...numericContradictions);

    const ruleContradictions = detectRuleConflict(ssot, newContent, i);
    contradictions.push(...ruleContradictions);
  }

  return {
    contradictions,
    requiresReview: contradictions.length > 0,
  };
}

function detectNegationContradiction(
  ssot: string,
  newContent: string,
  index: number,
): Contradiction[] {
  const results: Contradiction[] = [];

  // Pattern: "X must/should" in SSOT vs "X do not/does not/don't" in new
  // Extract the key subject word from the SSOT mandatory statement
  const mandatoryPattern = /(\w+)\s+(?:must|should|is required|are required)\b/i;
  const ssotMatch = mandatoryPattern.exec(ssot);
  if (ssotMatch) {
    const subject = ssotMatch[1]!.toLowerCase();
    // Look for the same subject with negation in the new content
    const negationPattern = new RegExp(
      `\\b${escapeRegex(subject)}\\s+(?:do not|does not|don't|doesn't|not required|are not required|is not required)\\b`,
      "i",
    );
    const newMatch = negationPattern.exec(newContent);
    if (newMatch) {
      results.push({
        type: "NEGATION",
        ssotIndex: index,
        ssotSnippet: ssotMatch[0],
        newSnippet: newMatch[0],
        explanation: `SSOT requires "${subject}" but new content negates it`,
      });
    }
  }

  return results;
}

function detectNumericConflict(ssot: string, newContent: string, index: number): Contradiction[] {
  const results: Contradiction[] = [];

  // Extract "X is N" / "X minimum N" / "X maximum N" patterns
  const numericPattern = /(\w+(?:\s+\w+)?)\s+(?:is|are|equals?|minimum|maximum)\s+(\d+)/gi;
  const ssotNumbers = new Map<string, number>();
  let match: RegExpExecArray | null;
  while ((match = numericPattern.exec(ssot)) !== null) {
    ssotNumbers.set(match[1]!.toLowerCase(), parseInt(match[2]!, 10));
  }

  const newNumericPattern = /(\w+(?:\s+\w+)?)\s+(?:is|are|equals?|minimum|maximum)\s+(\d+)/gi;
  while ((match = newNumericPattern.exec(newContent)) !== null) {
    const subject = match[1]!.toLowerCase();
    const value = parseInt(match[2]!, 10);
    const ssotValue = ssotNumbers.get(subject);
    if (ssotValue !== undefined && ssotValue !== value) {
      results.push({
        type: "NUMERIC_CONFLICT",
        ssotIndex: index,
        ssotSnippet: `${subject} is ${ssotValue}`,
        newSnippet: `${subject} is ${value}`,
        explanation: `SSOT says "${subject}" is ${ssotValue}, new content says ${value}`,
      });
    }
  }

  return results;
}

function detectRuleConflict(ssot: string, newContent: string, index: number): Contradiction[] {
  const results: Contradiction[] = [];

  // Pattern: "X must be/required" in SSOT vs "X optional/can skip" in new
  const requiredPattern = /(\w+)\s+(?:must be|is required|are required)\b/i;
  const optionalPattern =
    /(\w+)\s+(?:is optional|are optional|optional|can be skipped|may be skipped)\b/i;

  const ssotMatch = requiredPattern.exec(ssot);
  const newMatch = optionalPattern.exec(newContent);

  if (ssotMatch && newMatch) {
    const ssotSubject = ssotMatch[1]!.toLowerCase();
    const newSubject = newMatch[1]!.toLowerCase();
    if (
      ssotSubject === newSubject ||
      ssotSubject.includes(newSubject) ||
      newSubject.includes(ssotSubject)
    ) {
      results.push({
        type: "RULE_CONFLICT",
        ssotIndex: index,
        ssotSnippet: ssotMatch[0],
        newSnippet: newMatch[0],
        explanation: `SSOT requires "${ssotSubject}" but new content makes it optional`,
      });
    }
  }

  return results;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
