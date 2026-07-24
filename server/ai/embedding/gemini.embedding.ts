/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Google Gemini embedding provider — text-embedding-004 (768 dims).
 * Uses the Google Generative Language REST API directly.
 */

import {
  EmbedRequest,
  EmbedResult,
  EmbeddingProvider,
  EmbeddingProviderError,
  EmbeddingProviderNotConfiguredError,
} from "./provider";

// Google's public Generative Language API currently exposes
// gemini-embedding-001 (recommended) and gemini-embedding-2*. The older
// text-embedding-004 alias was retired.
const DEFAULT_MODEL = "gemini-embedding-001";

export class GeminiEmbeddingProvider implements EmbeddingProvider {
  public readonly kind = "gemini";
  public readonly defaultModel = DEFAULT_MODEL;

  private get apiKey(): string | null {
    return process.env.GEMINI_API_KEY?.trim() || null;
  }
  public isConfigured(): boolean {
    return !!this.apiKey;
  }

  public async embed(req: EmbedRequest): Promise<EmbedResult> {
    if (!this.isConfigured()) {
      throw new EmbeddingProviderNotConfiguredError(this.kind, "GEMINI_API_KEY");
    }
    if (req.inputs.length === 0) {
      return { vectors: [], model: req.model || this.defaultModel, dims: 0, latencyMs: 0 };
    }
    const model = req.model || this.defaultModel;
    const start = Date.now();

    // Gemini's batchEmbedContents keeps the whole call in one round-trip.
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:batchEmbedContents?key=${this.apiKey}`;
    const body = {
      requests: req.inputs.map((text) => ({
        model: `models/${model}`,
        content: { parts: [{ text }] },
        taskType: "RETRIEVAL_DOCUMENT",
      })),
    };
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const text = await resp.text();
    let json: any;
    try { json = JSON.parse(text); } catch { json = null; }
    if (!resp.ok) {
      throw new EmbeddingProviderError(this.kind, json?.error?.message || text.slice(0, 300), {
        httpStatus: resp.status,
        retriable: resp.status === 429 || resp.status >= 500,
      });
    }
    const vectors: number[][] = (json?.embeddings || []).map((e: any) => e.values as number[]);
    if (vectors.length !== req.inputs.length) {
      throw new EmbeddingProviderError(this.kind, `expected ${req.inputs.length} vectors, got ${vectors.length}`);
    }
    return {
      vectors,
      model,
      dims: vectors[0]?.length ?? 0,
      latencyMs: Date.now() - start,
    };
  }
}
