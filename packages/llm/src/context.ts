import type { RetrievalResult } from "@hermes/knowledge";
import type { PersonalMemory } from "@hermes/db";

export interface BuildContextInput {
  chunks: RetrievalResult[];
  memories: PersonalMemory[];
  query: string;
  employeeName: string;
  includeSensitiveMemories?: boolean;
}

/**
 * Build the LLM context window from retrieval chunks and personal memories.
 *
 * Safety properties:
 *   - HIGHLY_SENSITIVE memories are NEVER included, regardless of flags.
 *   - SENSITIVE memories are only included when includeSensitiveMemories is true.
 *   - Each chunk is labeled with a citation marker [chunkId] so the model
 *     can reference it in its answer.
 *   - The context explicitly instructs the model to cite sources.
 */
export function buildContext(input: BuildContextInput): string {
  const parts: string[] = [];

  parts.push(`You are Hermes, an AI assistant helping ${input.employeeName}.`);
  parts.push("Answer the user's question using ONLY the provided context.");
  parts.push("Every factual claim in your answer MUST be followed by a citation [chunkId].");
  parts.push("Do not include information that is not in the context or your personal memories.");
  parts.push("");

  // Add personal memories (with sensitivity filtering).
  const visibleMemories = input.memories.filter((m) => {
    if (m.sensitivity === "HIGHLY_SENSITIVE") return false;
    if (m.sensitivity === "SENSITIVE" && !input.includeSensitiveMemories) return false;
    return true;
  });

  if (visibleMemories.length > 0) {
    parts.push("## Personal Memories");
    for (const mem of visibleMemories) {
      parts.push(`- ${mem.content}`);
    }
    parts.push("");
  }

  // Add retrieval chunks with citation markers.
  if (input.chunks.length > 0) {
    parts.push("## Knowledge Sources");
    for (const chunk of input.chunks) {
      parts.push(`[${chunk.chunkId}] (${chunk.knowledgeStatus}, ${chunk.scope})`);
      parts.push(chunk.text);
      parts.push("");
    }
  }

  parts.push("## Question");
  parts.push(input.query);
  parts.push("");
  parts.push("## Answer (with citations)");

  return parts.join("\n");
}
