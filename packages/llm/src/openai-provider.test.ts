import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  OpenAILLMProvider,
  OpenAIEmbeddingProvider,
  createOpenAIProviders,
} from "./openai-provider.js";
import type { OpenAI } from "openai";

/**
 * Minimal mock that satisfies the subset of the OpenAI client surface used by
 * the providers. We cast it to `OpenAI` so the provider constructors accept it
 * without pulling in the full SDK shape.
 */
function mockOpenAIClient(overrides: {
  chatCreate?: ReturnType<typeof vi.fn>;
  embeddingsCreate?: ReturnType<typeof vi.fn>;
}): OpenAI {
  const chatCreate =
    overrides.chatCreate ??
    vi.fn().mockResolvedValue({
      choices: [{ message: { content: "mocked answer" } }],
    });
  const embeddingsCreate =
    overrides.embeddingsCreate ??
    vi.fn().mockResolvedValue({
      data: [{ embedding: [0.1, 0.2, 0.3] }],
    });

  return {
    chat: { completions: { create: chatCreate } },
    embeddings: { create: embeddingsCreate },
  } as unknown as OpenAI;
}

describe("OpenAILLMProvider", () => {
  it("calls chat.completions.create with the configured model and returns the response text", async () => {
    const chatCreate = vi.fn().mockResolvedValue({
      choices: [{ message: { content: "the answer" } }],
    });
    const client = mockOpenAIClient({ chatCreate });
    const provider = new OpenAILLMProvider(client, "gpt-5.6");

    const result = await provider.complete("What is the revenue?");

    expect(chatCreate).toHaveBeenCalledTimes(1);
    expect(chatCreate).toHaveBeenCalledWith({
      model: "gpt-5.6",
      messages: [{ role: "user", content: "What is the revenue?" }],
    });
    expect(result).toBe("the answer");
  });

  it("returns an empty string when no content is present", async () => {
    const chatCreate = vi.fn().mockResolvedValue({
      choices: [{ message: { content: null } }],
    });
    const client = mockOpenAIClient({ chatCreate });
    const provider = new OpenAILLMProvider(client, "gpt-5.6");

    const result = await provider.complete("anything");
    expect(result).toBe("");
  });
});

describe("OpenAIEmbeddingProvider", () => {
  it("calls embeddings.create with the configured model and returns the embedding vector", async () => {
    const embeddingsCreate = vi.fn().mockResolvedValue({
      data: [{ embedding: [0.1, 0.2, 0.3] }],
    });
    const client = mockOpenAIClient({ embeddingsCreate });
    const provider = new OpenAIEmbeddingProvider(client, "text-embedding-3-small");

    const result = await provider.embed("some text");

    expect(embeddingsCreate).toHaveBeenCalledTimes(1);
    expect(embeddingsCreate).toHaveBeenCalledWith({
      model: "text-embedding-3-small",
      input: "some text",
    });
    expect(result).toEqual([0.1, 0.2, 0.3]);
  });

  it("returns an empty array when no embedding is present", async () => {
    const embeddingsCreate = vi.fn().mockResolvedValue({ data: [] });
    const client = mockOpenAIClient({ embeddingsCreate });
    const provider = new OpenAIEmbeddingProvider(client, "text-embedding-3-small");

    const result = await provider.embed("some text");
    expect(result).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// createOpenAIProviders — baseURL passthrough
//
// These tests verify that the optional baseURL config field is forwarded to
// the OpenAI SDK constructor so Hermes can target OpenAI-compatible endpoints
// (Nous Research, Codex subscription proxy, self-hosted vLLM/Ollama, etc.).
//
// vi.mock is hoisted to the top of the file by Vitest, so we use a single
// hoisted mock factory and clear calls between tests.
// ---------------------------------------------------------------------------
const { MockOpenAICtor } = vi.hoisted(() => {
  const MockOpenAICtor = vi.fn().mockImplementation(() => ({
    chat: { completions: { create: vi.fn() } },
    embeddings: { create: vi.fn() },
  }));
  return { MockOpenAICtor };
});

vi.mock("openai", () => ({
  OpenAI: MockOpenAICtor,
}));

describe("createOpenAIProviders", () => {
  beforeEach(() => {
    MockOpenAICtor.mockClear();
  });

  it("creates both an LLM and embedding provider wired to the same config", () => {
    const { llm, embedding } = createOpenAIProviders({
      apiKey: "sk-test-key",
      reasoningModel: "gpt-5.6",
      embeddingModel: "text-embedding-3-small",
    });

    expect(llm).toBeInstanceOf(OpenAILLMProvider);
    expect(embedding).toBeInstanceOf(OpenAIEmbeddingProvider);
    expect(llm.complete).toBeInstanceOf(Function);
    expect(embedding.embed).toBeInstanceOf(Function);
  });

  it("forwards shared baseURL to both OpenAI constructors when provided", () => {
    createOpenAIProviders({
      apiKey: "sk-test-key",
      reasoningModel: "gpt-5.6",
      embeddingModel: "text-embedding-3-small",
      baseURL: "https://api.nousresearch.com/v1",
    });

    expect(MockOpenAICtor).toHaveBeenCalledTimes(2);
    expect(MockOpenAICtor).toHaveBeenNthCalledWith(1, {
      apiKey: "sk-test-key",
      baseURL: "https://api.nousresearch.com/v1",
    });
    expect(MockOpenAICtor).toHaveBeenNthCalledWith(2, {
      apiKey: "sk-test-key",
      baseURL: "https://api.nousresearch.com/v1",
    });
  });

  it("creates separate clients with different base URLs for LLM and embeddings", () => {
    createOpenAIProviders({
      apiKey: "sk-test-key",
      reasoningModel: "gpt-5.6",
      embeddingModel: "text-embedding-3-small",
      llmBaseUrl: "https://api.codex.example.com/v1",
      embeddingBaseUrl: "https://api.openai.com/v1",
    });

    expect(MockOpenAICtor).toHaveBeenCalledTimes(2);
    expect(MockOpenAICtor).toHaveBeenNthCalledWith(1, {
      apiKey: "sk-test-key",
      baseURL: "https://api.codex.example.com/v1",
    });
    expect(MockOpenAICtor).toHaveBeenNthCalledWith(2, {
      apiKey: "sk-test-key",
      baseURL: "https://api.openai.com/v1",
    });
  });

  it("uses separate API keys for LLM and embeddings when provided", () => {
    createOpenAIProviders({
      apiKey: "sk-shared-key",
      reasoningModel: "gpt-5.6",
      embeddingModel: "text-embedding-3-small",
      llmApiKey: "sk-codex-sub-key",
      embeddingApiKey: "sk-openai-embed-key",
    });

    expect(MockOpenAICtor).toHaveBeenCalledTimes(2);
    expect(MockOpenAICtor).toHaveBeenNthCalledWith(1, {
      apiKey: "sk-codex-sub-key",
    });
    expect(MockOpenAICtor).toHaveBeenNthCalledWith(2, {
      apiKey: "sk-openai-embed-key",
    });
  });

  it("llmBaseUrl overrides shared baseURL for the LLM client only", () => {
    createOpenAIProviders({
      apiKey: "sk-test-key",
      reasoningModel: "gpt-5.6",
      embeddingModel: "text-embedding-3-small",
      baseURL: "https://shared.example.com/v1",
      llmBaseUrl: "https://codex.example.com/v1",
    });

    expect(MockOpenAICtor).toHaveBeenCalledTimes(2);
    expect(MockOpenAICtor).toHaveBeenNthCalledWith(1, {
      apiKey: "sk-test-key",
      baseURL: "https://codex.example.com/v1",
    });
    expect(MockOpenAICtor).toHaveBeenNthCalledWith(2, {
      apiKey: "sk-test-key",
      baseURL: "https://shared.example.com/v1",
    });
  });

  it("omits baseURL from both constructors when not provided", () => {
    createOpenAIProviders({
      apiKey: "sk-test-key",
      reasoningModel: "gpt-5.6",
      embeddingModel: "text-embedding-3-small",
    });

    expect(MockOpenAICtor).toHaveBeenCalledTimes(2);
    for (const call of MockOpenAICtor.mock.calls) {
      const arg = call[0] as Record<string, unknown>;
      expect(arg.apiKey).toBe("sk-test-key");
      expect("baseURL" in arg).toBe(false);
    }
  });
});
