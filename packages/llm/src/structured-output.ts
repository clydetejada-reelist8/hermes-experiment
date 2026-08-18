import { z } from "zod";
import type { HermesAnswer } from "@hermes/contracts";

/**
 * Zod schema for the structured LLM answer output (Section 19.3).
 *
 * The LLM is instructed to return JSON matching this schema. The schema is
 * used to validate the raw model output before it is accepted. If the output
 * does not match, the answer is rejected.
 */
export const HermesAnswerSchema = z.object({
  status: z.enum([
    "SUPPORTED",
    "PARTIALLY_SUPPORTED",
    "CONFLICTING_SOURCES",
    "NO_AUTHORITATIVE_SOURCE",
    "INSUFFICIENT_ACCESS",
    "SOURCE_NOT_CONNECTED",
    "NOT_FOUND",
  ]),
  text: z.string().min(1),
  citations: z.array(
    z.object({
      chunkId: z.string().min(1),
      sourceType: z.enum(["ARTIFACT_VERSION", "SSOT_VERSION"]),
      artifactId: z.string().optional(),
      artifactVersionId: z.string().optional(),
      ssotVersionId: z.string().optional(),
      label: z.string(),
      locator: z.string().optional(),
    }),
  ),
  limitations: z.array(z.string()),
  conflictChunkIds: z.array(z.string()),
});

export interface StructuredOutputResult {
  valid: boolean;
  answer?: HermesAnswer;
  errors?: string[];
}

/**
 * Parse and validate a structured LLM answer against the Zod schema.
 *
 * The raw model output is expected to be a JSON string. If parsing or
 * validation fails, the result is { valid: false, errors } and the answer
 * is rejected — the model cannot bypass schema validation.
 */
export function parseStructuredAnswer(rawOutput: string): StructuredOutputResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawOutput);
  } catch {
    return {
      valid: false,
      errors: ["model output is not valid JSON"],
    };
  }

  const result = HermesAnswerSchema.safeParse(parsed);
  if (result.success) {
    return { valid: true, answer: result.data as HermesAnswer };
  }

  return {
    valid: false,
    errors: result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`),
  };
}
