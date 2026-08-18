import { describe, expect, it } from "vitest";
import { chunkText } from "./chunker.js";

describe("chunkText", () => {
  it("returns a single chunk for short text", () => {
    const chunks = chunkText("Hello world.", { maxTokens: 100, overlapTokens: 20 });
    expect(chunks.length).toBe(1);
    expect(chunks[0]?.text).toBe("Hello world.");
    expect(chunks[0]?.tokenEstimate).toBeGreaterThan(0);
  });

  it("splits long text into multiple chunks with overlap", () => {
    const words = Array.from({ length: 200 }, (_, i) => `word${i}`);
    const text = words.join(" ");
    const chunks = chunkText(text, { maxTokens: 50, overlapTokens: 10 });
    expect(chunks.length).toBeGreaterThan(1);
    // Each chunk should not exceed the max token estimate
    for (const chunk of chunks) {
      expect(chunk.tokenEstimate).toBeLessThanOrEqual(50);
    }
  });

  it("produces deterministic output for the same input", () => {
    const text = "This is a test sentence. ".repeat(20);
    const a = chunkText(text, { maxTokens: 30, overlapTokens: 5 });
    const b = chunkText(text, { maxTokens: 30, overlapTokens: 5 });
    expect(a.length).toBe(b.length);
    for (let i = 0; i < a.length; i++) {
      expect(a[i]?.text).toBe(b[i]?.text);
      expect(a[i]?.tokenEstimate).toBe(b[i]?.tokenEstimate);
    }
  });

  it("handles empty text", () => {
    const chunks = chunkText("", { maxTokens: 100, overlapTokens: 20 });
    expect(chunks).toEqual([]);
  });

  it("assigns sequential chunk indices", () => {
    const words = Array.from({ length: 100 }, (_, i) => `word${i}`);
    const chunks = chunkText(words.join(" "), { maxTokens: 30, overlapTokens: 5 });
    for (let i = 0; i < chunks.length; i++) {
      expect(chunks[i]?.chunkIndex).toBe(i);
    }
  });
});
