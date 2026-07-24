/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Ollama local-model embedding provider — nomic-embed-text, mxbai-embed-large, etc.
 * Requires a running Ollama daemon reachable at OLLAMA_BASE_URL
 * (default: http://localhost:11434).
 */

import {
  EmbedRequest,
  EmbedResult,
  EmbeddingProvider,
  EmbeddingProviderError,
} from "./provider";

const DEFAULT_MODEL = "nomic-embed-text";
const DEFAULT_BASE_URL = "http://localhost:11434";

export class OllamaEmbeddingProvider implements EmbeddingProvider {
  public readonly kind = "ollama";
  public readonly defaultModel = DEFAULT_MODEL;

  private get baseUrl(): string {
    return (process.env.OLLAMA_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, "");
  }
  public isConfigured(): boolean {
    // Ollama needs no API key; we treat it as "configured" whenever the
    // OLLAMA_BASE_URL is reachable at runtime. isConfigured returns true
    // here so operators can pick it in the UI; embed() surfaces a clear
    // network error if the daemon isn't up.
    return true;
  }

  public async embed(req: EmbedRequest): Promise<EmbedResult> {
    if (req.inputs.length === 0) {
      return { vectors: [], model: req.model || this.defaultModel, dims: 0, latencyMs: 0 };
    }
    const model = req.model || this.defaultModel;
    const start = Date.now();
    const vectors: number[][] = [];
    // Ollama's /api/embeddings is one-input-per-call. Loop; small batches
    // (a few hundred chunks) are the norm.
    for (const input of req.inputs) {
      const resp = await fetch(`${this.baseUrl}/api/embeddings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model, prompt: input }),
      });
      const text = await resp.text();
      let json: any;
      try { json = JSON.parse(text); } catch { json = null; }
      if (!resp.ok) {
        throw new EmbeddingProviderError(this.kind, json?.error || text.slice(0, 300), {
          httpStatus: resp.status,
          retriable: resp.status >= 500,
        });
      }
      const vec = json?.embedding as number[] | undefined;
      if (!Array.isArray(vec)) {
        throw new EmbeddingProviderError(this.kind, "Ollama returned no embedding");
      }
      vectors.push(vec);
    }
    return {
      vectors,
      model,
      dims: vectors[0]?.length ?? 0,
      latencyMs: Date.now() - start,
    };
  }
}
