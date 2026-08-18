export interface ChunkOptions {
  maxTokens: number;
  overlapTokens: number;
}

export interface Chunk {
  chunkIndex: number;
  text: string;
  tokenEstimate: number;
}

/**
 * Estimate token count using the ~4 chars/token heuristic. This is a
 * deterministic approximation that doesn't require a tokenizer dependency.
 * The actual embedding API will handle exact tokenization; this estimate is
 * only used for chunk sizing.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Deterministically chunk text into overlapping segments for embedding.
 *
 * The chunker splits on sentence boundaries when possible, then on word
 * boundaries, to stay within `maxTokens`. Each chunk overlaps the previous
 * one by `overlapTokens` to preserve context across chunk boundaries.
 *
 * The output is deterministic: the same input + options always produces the
 * same chunks in the same order.
 */
export function chunkText(text: string, opts: ChunkOptions): Chunk[] {
  const trimmed = text.trim();
  if (!trimmed) return [];

  // Split into sentences (rough heuristic).
  const sentences = trimmed.match(/[^.!?]+[.!?]*\s*/g) ?? [trimmed];

  // Further split long sentences into words.
  const words: string[] = [];
  for (const sentence of sentences) {
    const sentenceTokens = estimateTokens(sentence);
    if (sentenceTokens <= opts.maxTokens) {
      words.push(sentence.trim());
    } else {
      // Split long sentence into word groups.
      const sentenceWords = sentence.trim().split(/\s+/);
      let current = "";
      for (const w of sentenceWords) {
        const candidate = current ? `${current} ${w}` : w;
        if (estimateTokens(candidate) > opts.maxTokens && current) {
          words.push(current);
          current = w;
        } else {
          current = candidate;
        }
      }
      if (current) words.push(current);
    }
  }

  // Build chunks with overlap.
  const chunks: Chunk[] = [];
  let currentWords: string[] = [];
  let currentTokens = 0;
  let chunkIndex = 0;

  for (const wordGroup of words) {
    const groupTokens = estimateTokens(wordGroup);
    if (currentTokens + groupTokens > opts.maxTokens && currentWords.length > 0) {
      // Flush current chunk.
      chunks.push({
        chunkIndex,
        text: currentWords.join(" "),
        tokenEstimate: currentTokens,
      });
      chunkIndex++;

      // Compute overlap: keep trailing words that fit within overlapTokens.
      const overlapWords: string[] = [];
      let overlapTokens = 0;
      for (let i = currentWords.length - 1; i >= 0; i--) {
        const w = currentWords[i]!;
        const wt = estimateTokens(w);
        if (overlapTokens + wt > opts.overlapTokens) break;
        overlapWords.unshift(w);
        overlapTokens += wt;
      }
      currentWords = overlapWords;
      currentTokens = overlapTokens;
    }
    currentWords.push(wordGroup);
    currentTokens += groupTokens;
  }

  if (currentWords.length > 0) {
    chunks.push({
      chunkIndex,
      text: currentWords.join(" "),
      tokenEstimate: currentTokens,
    });
  }

  return chunks;
}
