import { db } from "@hermes/db";
import { hybridRetrieve, type EmbeddingFunction, type RetrievalResult } from "@hermes/knowledge";
import { getVisibleMemories } from "@hermes/memory";
import { buildContext, validateEgress, validateCitations } from "@hermes/llm";
import type { PersonalMemory } from "@hermes/db";

export interface LLMClient {
  complete(prompt: string): Promise<string>;
}

export interface AskOrchestratorDeps {
  embeddingFn: EmbeddingFunction;
  llm: LLMClient;
}

export interface AskInput {
  employeeId: string;
  employeeName: string;
  query: string;
  conversationId: string;
}

export type AskStatus = "ANSWERED" | "NO_CONTEXT" | "EGRESS_BLOCKED" | "CITATION_INVALID";

export interface AskResult {
  status: AskStatus;
  answer: string;
  citations: string[];
  chunks: RetrievalResult[];
  memories: PersonalMemory[];
  violations?: string[];
}

/**
 * AskOrchestrator — development/test-only legacy conversation loop.
 *
 * @deprecated Production Hermes requests use the Hermes Agent gateway and
 * REELIST8 MCP tools, not this orchestrator.
 *
 * Flow:
 *   1. Embed the query and retrieve relevant chunks (with permission filtering)
 *   2. Fetch visible personal memories (HIGHLY_SENSITIVE excluded)
 *   3. Build the LLM context window with citation markers
 *   4. Call the LLM to generate an answer
 *   5. Validate egress (no SSNs, credit cards, etc. in output)
 *   6. Validate citations (every citation references a real chunk)
 *   7. Persist the user message and assistant response
 *   8. Return the result
 *
 * If any validation fails, the answer is blocked and a safe status is returned.
 */
export class AskOrchestrator {
  constructor(private readonly deps: AskOrchestratorDeps) {}

  async ask(input: AskInput): Promise<AskResult> {
    // 1. Embed the query
    const queryEmbedding = await this.deps.embeddingFn.embed(input.query);

    // 2. Retrieve relevant chunks with permission filtering
    const chunks = await hybridRetrieve({
      employeeId: input.employeeId,
      query: input.query,
      queryEmbedding,
      limit: 20,
      embeddingFn: this.deps.embeddingFn,
    });

    // 3. Fetch visible personal memories
    const memories = await getVisibleMemories(input.employeeId);

    // 4. If no context, return early
    if (chunks.length === 0 && memories.length === 0) {
      await this.persistMessages(input, "I don't have enough context to answer that question.");
      return {
        status: "NO_CONTEXT",
        answer: "",
        citations: [],
        chunks: [],
        memories: [],
      };
    }

    // 5. Build the context window
    const context = buildContext({
      chunks,
      memories,
      query: input.query,
      employeeName: input.employeeName,
    });

    // 6. Call the LLM
    const rawAnswer = await this.deps.llm.complete(context);

    // 7. Validate egress
    const egressResult = validateEgress(rawAnswer);
    if (!egressResult.passed) {
      return {
        status: "EGRESS_BLOCKED",
        answer: "",
        citations: [],
        chunks,
        memories,
        violations: egressResult.violations.map((v) => v.type),
      };
    }

    // 8. Validate citations
    const citationResult = validateCitations(rawAnswer, chunks);
    if (!citationResult.valid) {
      return {
        status: "CITATION_INVALID",
        answer: "",
        citations: citationResult.citedIds,
        chunks,
        memories,
        violations:
          citationResult.unsupportedCitations.length > 0
            ? [`unsupported: ${citationResult.unsupportedCitations.join(", ")}`]
            : ["missing citations"],
      };
    }

    // 9. Persist messages
    await this.persistMessages(input, rawAnswer);

    return {
      status: "ANSWERED",
      answer: rawAnswer,
      citations: citationResult.citedIds,
      chunks,
      memories,
    };
  }

  private async persistMessages(input: AskInput, assistantResponse: string): Promise<void> {
    // Ensure the conversation exists (upsert in case it was created elsewhere)
    await db.conversation.upsert({
      where: { id: input.conversationId },
      create: {
        id: input.conversationId,
        initiatorEmployeeId: input.employeeId,
        conversationType: "ASK",
        audienceClassification: "PRIVATE",
      },
      update: {},
    });

    // Persist user message
    await db.conversationMessage.create({
      data: {
        conversationId: input.conversationId,
        employeeId: input.employeeId,
        role: "USER",
        content: input.query,
      },
    });

    // Persist assistant message
    await db.conversationMessage.create({
      data: {
        conversationId: input.conversationId,
        role: "ASSISTANT",
        content: assistantResponse,
      },
    });
  }
}
