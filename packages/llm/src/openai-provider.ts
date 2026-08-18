import { OpenAI } from "openai";
import type { EmbeddingFunction } from "@hermes/knowledge";

/**
 * Shared LLM client interface. Policy, retrieval, and action code depend on
 * this abstraction so the underlying model/provider can change without
 * modifying call sites.
 */
export interface LLMClient {
  complete(prompt: string): Promise<string>;
}

/**
 * OpenAI-backed {@link LLMClient} implementation.
 *
 * Uses the Chat Completions API to generate a text response for a prompt.
 * The model is configured at construction time so callers can swap models
 * (e.g. OPENAI_REASONING_MODEL) without changing this class.
 */
export class OpenAILLMProvider implements LLMClient {
  constructor(
    private readonly client: OpenAI,
    private readonly model: string,
  ) {}

  async complete(prompt: string): Promise<string> {
    const completion = await this.client.chat.completions.create({
      model: this.model,
      messages: [{ role: "user", content: prompt }],
    });
    const content = completion.choices[0]?.message?.content;
    return content ?? "";
  }
}

/**
 * OpenAI-backed {@link EmbeddingFunction} implementation.
 *
 * Generates a vector embedding for a piece of text using the configured
 * embedding model (e.g. OPENAI_EMBEDDING_MODEL).
 */
export class OpenAIEmbeddingProvider implements EmbeddingFunction {
  constructor(
    private readonly client: OpenAI,
    private readonly model: string,
  ) {}

  async embed(text: string): Promise<number[]> {
    const response = await this.client.embeddings.create({
      model: this.model,
      input: text,
    });
    const embedding = response.data[0]?.embedding;
    if (!embedding) {
      return [];
    }
    return embedding;
  }
}

/**
 * Configuration for {@link createOpenAIProviders}.
 *
 * Base URL options let Hermes target OpenAI-compatible endpoints instead of
 * OpenAI's servers. The LLM and embedding clients can use **different**
 * endpoints because some providers offer chat completions but not embeddings
 * (e.g. a ChatGPT/Codex subscription provides chat but not the embeddings
 * API). In that case, set `llmBaseUrl` to the Codex sub endpoint and leave
 * `embeddingBaseUrl` unset (or point it at OpenAI / a separate provider).
 *
 * - `baseURL`: shorthand that sets both `llmBaseUrl` and `embeddingBaseUrl`
 *   to the same value. Useful when a single provider offers both surfaces.
 * - `llmBaseUrl`: base URL for chat completions only.
 * - `embeddingBaseUrl`: base URL for embeddings only.
 * - `llmApiKey` / `embeddingApiKey`: separate API keys per surface. When
 *   omitted, the shared `apiKey` is used for both.
 *
 * Precedence: specific (`llmBaseUrl`/`embeddingBaseUrl`) overrides shared
 * (`baseURL`). If neither is set, the OpenAI SDK defaults to `api.openai.com`.
 */
export interface OpenAIProviderConfig {
  apiKey: string;
  reasoningModel: string;
  embeddingModel: string;
  /** Shared base URL applied to both LLM and embedding clients. */
  baseURL?: string;
  /** Base URL for the LLM (chat completions) client only. Overrides baseURL. */
  llmBaseUrl?: string;
  /** Base URL for the embedding client only. Overrides baseURL. */
  embeddingBaseUrl?: string;
  /** API key for the LLM client only. Overrides apiKey. */
  llmApiKey?: string;
  /** API key for the embedding client only. Overrides apiKey. */
  embeddingApiKey?: string;
}

/**
 * Factory that constructs OpenAI clients and wraps them in the
 * {@link LLMClient} and {@link EmbeddingFunction} abstractions.
 *
 * This is the single entry point application code uses to wire up real
 * OpenAI providers, keeping the OpenAI SDK dependency localized to this
 * package.
 *
 * By default both clients share the same API key and base URL. To use
 * different providers for chat vs embeddings (e.g. a Codex subscription
 * for chat and OpenAI direct for embeddings), pass `llmBaseUrl` and
 * `embeddingBaseUrl` separately.
 */
export function createOpenAIProviders(config: OpenAIProviderConfig): {
  llm: OpenAILLMProvider;
  embedding: OpenAIEmbeddingProvider;
} {
  const llmBase = config.llmBaseUrl ?? config.baseURL;
  const embeddingBase = config.embeddingBaseUrl ?? config.baseURL;
  const llmKey = config.llmApiKey ?? config.apiKey;
  const embeddingKey = config.embeddingApiKey ?? config.apiKey;

  const llmClient = new OpenAI({
    apiKey: llmKey,
    ...(llmBase ? { baseURL: llmBase } : {}),
  });
  const embeddingClient = new OpenAI({
    apiKey: embeddingKey,
    ...(embeddingBase ? { baseURL: embeddingBase } : {}),
  });
  return {
    llm: new OpenAILLMProvider(llmClient, config.reasoningModel),
    embedding: new OpenAIEmbeddingProvider(embeddingClient, config.embeddingModel),
  };
}
