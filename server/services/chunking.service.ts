/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Chunking service — splits extracted text into overlapping windows the
 * embedding model can digest. Character-count based (not token-based)
 * because it stays consistent across every embedding vendor without
 * pulling in a heavy tokenizer library. Callers can tune `size` /
 * `overlap` per Knowledge Base.
 *
 * Strategy:
 *   1. Split on paragraph boundaries first — respects natural structure.
 *   2. Greedily pack paragraphs into a window up to `size` chars.
 *   3. When a single paragraph is bigger than `size`, sentence-split it.
 *   4. When even a sentence is > `size`, hard-split at `size`.
 *   5. Between windows, prepend `overlap` chars from the previous window's
 *      tail — preserves context across chunk boundaries.
 *
 * The output is stable: repeated calls on the same text return the same
 * chunks (important for idempotent re-index).
 */

export interface ChunkOptions {
  /** Max characters per chunk. Sensible default 1200 ≈ 300-350 tokens. */
  size: number;
  /** Characters of overlap between consecutive chunks. */
  overlap: number;
}

export interface Chunk {
  index: number;
  content: string;
  tokenEstimate: number;
}

const SENTENCE_SPLIT = /(?<=[.!?])\s+(?=[A-Z0-9])/g;

function estimateTokens(text: string): number {
  // Rough estimate — 1 token ≈ 4 characters for English. Used only for
  // reporting + cost estimation, never for slicing.
  return Math.max(1, Math.round(text.length / 4));
}

function splitLongSegment(seg: string, size: number): string[] {
  if (seg.length <= size) return [seg];
  const sentences = seg.split(SENTENCE_SPLIT);
  const out: string[] = [];
  let current = "";
  for (const s of sentences) {
    if (s.length > size) {
      // Even a single sentence is oversized — hard-cut on character boundary.
      if (current) { out.push(current); current = ""; }
      for (let i = 0; i < s.length; i += size) {
        out.push(s.slice(i, i + size));
      }
      continue;
    }
    if ((current + " " + s).trim().length > size) {
      out.push(current.trim());
      current = s;
    } else {
      current = current ? `${current} ${s}` : s;
    }
  }
  if (current.trim()) out.push(current.trim());
  return out;
}

export const chunkingService = {
  chunk(text: string, opts: ChunkOptions): Chunk[] {
    const size = Math.max(200, opts.size || 1200);
    const overlap = Math.min(size - 100, Math.max(0, opts.overlap || 0));
    const cleaned = (text || "").replace(/\r\n/g, "\n").trim();
    if (!cleaned) return [];

    const paragraphs = cleaned.split(/\n{2,}/).flatMap((p) => splitLongSegment(p.trim(), size)).filter(Boolean);
    const chunks: Chunk[] = [];
    let current = "";

    for (const p of paragraphs) {
      if (current && (current.length + p.length + 2) > size) {
        chunks.push({ index: chunks.length, content: current, tokenEstimate: estimateTokens(current) });
        // Seed the next window with the tail of the last chunk for overlap.
        const tail = overlap > 0 ? current.slice(-overlap) : "";
        current = tail ? `${tail}\n\n${p}` : p;
      } else {
        current = current ? `${current}\n\n${p}` : p;
      }
    }
    if (current.trim()) {
      chunks.push({ index: chunks.length, content: current.trim(), tokenEstimate: estimateTokens(current) });
    }
    return chunks;
  },
};
