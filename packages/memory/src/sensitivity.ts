import type { MemorySensitivity } from "@hermes/contracts";

/**
 * Deterministic sensitivity classification rules.
 *
 * This is a RULE-BASED classifier — no model authority. The same input always
 * produces the same output. This is critical for the security model: the
 * sensitivity level determines whether content is included in context windows
 * sent to the LLM.
 *
 * Order matters: HIGHLY_SENSITIVE patterns are checked first (most sensitive),
 * then SENSITIVE, then default to NORMAL.
 */

// HIGHLY_SENSITIVE patterns — never included in LLM context.
const HIGHLY_SENSITIVE_PATTERNS: RegExp[] = [
  /\b\d{3}-\d{2}-\d{4}\b/, // SSN
  /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/, // Credit card (16 digits)
  /\b\d{3}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/, // Amex-style (15 digits with 3-4-4-4)
  /\b\d{9}\b/, // Bank account (9 digits)
  /\b0\d{8}\b/, // Routing number (9 digits starting with 0)
  /\bpassword\s*(?:[:=]|is)\s*\S+/i, // Password assignments or mentions
  /\bapi[\s-]?key\s*[:=]\s*\S+/i, // API keys
  /\bsk-[a-zA-Z0-9]{20,}\b/, // OpenAI-style API key
  /\bsecret\s*[:=]\s*\S+/i, // Secret assignments
  /\bprivate[\s-]?key\b/i, // Private key references
  /\bBEGIN\s+(RSA|EC|OPENSSH|PGP)\s+PRIVATE\s+KEY\b/, // PEM private key blocks
];

// SENSITIVE patterns — included in LLM context only with explicit employee
// authorization and never cross-employee.
const SENSITIVE_PATTERNS: RegExp[] = [
  /\bsalary\b/i,
  /\bcompensation\b/i,
  /\bbonus\b/i,
  /\bcommission\b/i,
  /\bpay\s*rate\b/i,
  /\bhourly\s*rate\b/i,
  /\bmedical\b/i,
  /\bhealth\s*condition\b/i,
  /\bdiagnosis\b/i,
  /\bmedication\b/i,
  /\bperformance\s*review\b/i,
  /\bpip\b/i,
  /\bperformance\s*improvement\s*plan\b/i,
  /\btermination\b/i,
  /\bfired\b/i,
  /\blayoff\b/i,
  /\brestructuring\b/i,
  /\bconfidential\b/i,
  /\bnda\b/i,
  /\bnon-?disclosure\b/i,
  /\bgross\s*pay\b/i,
  /\bnet\s*pay\b/i,
];

/**
 * Classify the sensitivity of a text string using deterministic rules.
 *
 * @returns One of "NORMAL", "SENSITIVE", or "HIGHLY_SENSITIVE"
 */
export function classifySensitivity(text: string): MemorySensitivity {
  for (const pattern of HIGHLY_SENSITIVE_PATTERNS) {
    if (pattern.test(text)) return "HIGHLY_SENSITIVE";
  }
  for (const pattern of SENSITIVE_PATTERNS) {
    if (pattern.test(text)) return "SENSITIVE";
  }
  return "NORMAL";
}

/**
 * Whether content at a given sensitivity level should be suppressed from
 * retrieval (i.e., never sent to the LLM context window).
 *
 * HIGHLY_SENSITIVE content is always suppressed.
 * SENSITIVE content is only included when the employee explicitly authorizes
 * it (handled at the retrieval layer).
 * NORMAL content is always included.
 */
export function shouldSuppressFromRetrieval(sensitivity: MemorySensitivity): boolean {
  return sensitivity === "HIGHLY_SENSITIVE";
}
