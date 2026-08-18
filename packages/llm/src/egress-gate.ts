export interface EgressViolation {
  type: string;
  match: string;
}

export interface EgressResult {
  passed: boolean;
  violations: EgressViolation[];
}

/**
 * Model egress gate — validates that the LLM's output does not contain
 * restricted data patterns. This is a DETERMINISTIC check that runs after
 * the model generates a response and before it is shown to the user.
 *
 * If any violation is found, the response is blocked and a safe fallback
 * message is shown instead.
 */

const EGRESS_PATTERNS: { type: string; pattern: RegExp }[] = [
  { type: "SSN", pattern: /\b\d{3}-\d{2}-\d{4}\b/ },
  { type: "CREDIT_CARD", pattern: /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/ },
  { type: "API_KEY", pattern: /\bsk-[a-zA-Z0-9]{20,}\b/ },
  { type: "PASSWORD", pattern: /\bpassword\s*(?:[:=]|is)\s*\S+/i },
  { type: "PRIVATE_KEY", pattern: /\bBEGIN\s+(RSA|EC|OPENSSH|PGP)\s+PRIVATE\s+KEY\b/ },
  { type: "BANK_ACCOUNT", pattern: /\b\d{9,12}\b/ },
];

/**
 * Validate that the model's output does not contain restricted data.
 * Returns { passed: true, violations: [] } if clean, otherwise lists
 * all violations found.
 */
export function validateEgress(output: string): EgressResult {
  const violations: EgressViolation[] = [];

  for (const { type, pattern } of EGRESS_PATTERNS) {
    const match = pattern.exec(output);
    if (match) {
      violations.push({ type, match: match[0] });
    }
  }

  return {
    passed: violations.length === 0,
    violations,
  };
}
