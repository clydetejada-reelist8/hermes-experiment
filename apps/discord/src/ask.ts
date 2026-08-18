import { db } from "@hermes/db";
import {
  hybridRetrieve,
  type EmbeddingFunction,
  type RetrievalResult,
  type AudienceClassification,
} from "@hermes/knowledge";
import { getMemoriesAtSensitivity } from "@hermes/memory";
import {
  buildContext,
  validateEgress,
  validateCitations,
  detectPromptInjection,
  type LLMClient,
} from "@hermes/llm";
import { isKillSwitchActive, isFeatureEnabled } from "@hermes/admin";
import { audit } from "@hermes/audit";
import type { PersonalMemory } from "@hermes/db";

// Re-export LLMClient for backward compatibility with consumers that import
// it from this module. The canonical definition now lives in @hermes/llm.
export type { LLMClient };

export interface AskOrchestratorDeps {
  embeddingFn: EmbeddingFunction;
  llm: LLMClient;
}

export interface AskInput {
  employeeId: string;
  employeeName: string;
  query: string;
  conversationId: string;
  /**
   * The audience classification for this conversation. Defaults to PRIVATE.
   * For TEAM/COMPANY audiences, personal memories and PERSONAL/THREAD_ONLY
   * chunks are excluded from the context window.
   */
  audience?: AudienceClassification;
  /**
   * Discord thread metadata to persist on the Conversation record. These
   * link the conversation to its Discord thread so follow-up messages can
   * be routed back to the correct conversation.
   */
  discordThreadId?: string;
  discordGuildId?: string;
  discordParentChannelId?: string;
}

export type AskStatus =
  | "ANSWERED"
  | "NO_CONTEXT"
  | "EGRESS_BLOCKED"
  | "CITATION_INVALID"
  | "INJECTION_DETECTED"
  | "KILL_SWITCH_ACTIVE"
  | "FEATURE_DISABLED";

export interface AskResult {
  status: AskStatus;
  answer: string;
  citations: string[];
  chunks: RetrievalResult[];
  memories: PersonalMemory[];
  violations?: string[];
}

/**
 * AskOrchestrator — the core conversation loop for Discord Ask.
 *
 * Flow:
 *   1. Check the kill switch and ask feature flag
 *   2. Detect prompt injection in the user query
 *   3. Embed the query and retrieve relevant chunks (with permission + audience filtering)
 *   4. Fetch visible personal memories (audience-aware)
 *   5. Build the LLM context window with citation markers
 *   6. Call the LLM to generate an answer
 *   7. Validate egress (no SSNs, credit cards, etc. in output)
 *   8. Validate citations (every citation references a real chunk)
 *   9. Persist the user message and assistant response
 *  10. Record audit events
 *  11. Return the result
 *
 * If any validation fails, the answer is blocked and a safe status is returned.
 */
export class AskOrchestrator {
  constructor(private readonly deps: AskOrchestratorDeps) {}

  async ask(input: AskInput): Promise<AskResult> {
    const audience = input.audience ?? "PRIVATE";

    // Ensure the conversation exists before any audit events are recorded.
    // AuditEvent has a foreign key on conversationId, so the conversation
    // must exist before we can audit anything.
    await db.conversation.upsert({
      where: { id: input.conversationId },
      create: {
        id: input.conversationId,
        initiatorEmployeeId: input.employeeId,
        conversationType: "ASK",
        audienceClassification: audience,
        discordThreadId: input.discordThreadId,
        discordGuildId: input.discordGuildId,
        discordParentChannelId: input.discordParentChannelId,
      },
      update: {
        discordThreadId: input.discordThreadId ?? undefined,
        discordGuildId: input.discordGuildId ?? undefined,
        discordParentChannelId: input.discordParentChannelId ?? undefined,
      },
    });

    // 1. Check the kill switch (Section 31).
    if (await isKillSwitchActive()) {
      await audit({
        type: "AUTHORIZATION_DENIED",
        employeeId: input.employeeId,
        conversationId: input.conversationId,
        metadata: { reason: "KILL_SWITCH_ACTIVE" },
      });
      return {
        status: "KILL_SWITCH_ACTIVE",
        answer: "Hermes is currently disabled. Please try again later.",
        citations: [],
        chunks: [],
        memories: [],
      };
    }

    // Check the ask feature flag.
    if (!(await isFeatureEnabled("ask_enabled"))) {
      return {
        status: "FEATURE_DISABLED",
        answer: "The Ask feature is currently disabled.",
        citations: [],
        chunks: [],
        memories: [],
      };
    }

    // 2. Detect prompt injection
    const injectionResult = detectPromptInjection(input.query);
    if (injectionResult.detected) {
      await audit({
        type: "AUTHORIZATION_DENIED",
        employeeId: input.employeeId,
        conversationId: input.conversationId,
        metadata: {
          reason: "PROMPT_INJECTION",
          patterns: injectionResult.patterns,
        },
      });
      return {
        status: "INJECTION_DETECTED",
        answer: "Your query was blocked by the security layer.",
        citations: [],
        chunks: [],
        memories: [],
        violations: injectionResult.patterns,
      };
    }

    // 3. Embed the query
    const queryEmbedding = await this.deps.embeddingFn.embed(input.query);

    // 4. Retrieve relevant chunks with permission + audience filtering
    const chunks = await hybridRetrieve({
      employeeId: input.employeeId,
      query: input.query,
      queryEmbedding,
      limit: 20,
      embeddingFn: this.deps.embeddingFn,
      audience,
    });

    // 5. Fetch personal memories (audience-aware).
    // For PRIVATE audiences, include NORMAL and SENSITIVE memories.
    // For TEAM/COMPANY audiences, personal memories are NEVER used as
    // factual support (Section 11.6).
    let memories: PersonalMemory[] = [];
    if (audience === "PRIVATE") {
      memories = await getMemoriesAtSensitivity(input.employeeId, "SENSITIVE");
    }

    // 6. If no context, return early
    if (chunks.length === 0 && memories.length === 0) {
      await this.persistMessages(input, "I don't have enough context to answer that question.");
      await audit({
        type: "ANSWER_GENERATED",
        employeeId: input.employeeId,
        conversationId: input.conversationId,
        metadata: { status: "NO_CONTEXT" },
      });
      return {
        status: "NO_CONTEXT",
        answer: "",
        citations: [],
        chunks: [],
        memories: [],
      };
    }

    // 7. Build the context window
    const context = buildContext({
      chunks,
      memories,
      query: input.query,
      employeeName: input.employeeName,
      includeSensitiveMemories: audience === "PRIVATE",
    });

    // 8. Call the LLM
    const rawAnswer = await this.deps.llm.complete(context);

    // 9. Validate egress
    const egressResult = validateEgress(rawAnswer);
    if (!egressResult.passed) {
      await audit({
        type: "ANSWER_GENERATED",
        employeeId: input.employeeId,
        conversationId: input.conversationId,
        metadata: {
          status: "EGRESS_BLOCKED",
          violations: egressResult.violations.map((v) => v.type),
        },
      });
      return {
        status: "EGRESS_BLOCKED",
        answer: "",
        citations: [],
        chunks,
        memories,
        violations: egressResult.violations.map((v) => v.type),
      };
    }

    // 10. Validate citations
    const citationResult = validateCitations(rawAnswer, chunks);
    if (!citationResult.valid) {
      await audit({
        type: "ANSWER_GENERATED",
        employeeId: input.employeeId,
        conversationId: input.conversationId,
        metadata: {
          status: "CITATION_INVALID",
          unsupported: citationResult.unsupportedCitations,
        },
      });
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

    // 11. Persist messages
    await this.persistMessages(input, rawAnswer);

    // 12. Record audit event
    await audit({
      type: "ANSWER_GENERATED",
      employeeId: input.employeeId,
      conversationId: input.conversationId,
      metadata: {
        status: "ANSWERED",
        chunkCount: chunks.length,
        citationCount: citationResult.citedIds.length,
      },
    });

    return {
      status: "ANSWERED",
      answer: rawAnswer,
      citations: citationResult.citedIds,
      chunks,
      memories,
    };
  }

  private async persistMessages(input: AskInput, assistantResponse: string): Promise<void> {
    // The conversation was already upserted at the start of ask().
    // Just persist the user and assistant messages.
    await db.conversationMessage.create({
      data: {
        conversationId: input.conversationId,
        employeeId: input.employeeId,
        role: "USER",
        content: input.query,
      },
    });

    await db.conversationMessage.create({
      data: {
        conversationId: input.conversationId,
        role: "ASSISTANT",
        content: assistantResponse,
      },
    });
  }
}
