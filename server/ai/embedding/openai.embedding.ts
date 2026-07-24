/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * OpenAI embedding provider — text-embedding-3-small / -large / ada-002.
 * Uses the public REST API directly; no SDK dependency.
 */

import {
  EmbedRequest,
  EmbedResult,
  EmbeddingProvider,
  EmbeddingProviderError,
  EmbeddingProviderNotConfiguredError,
} from "./provider";

const DEFAULT_MODEL = "text-embedding-3-small";
const DEFAULT_DIMS: Record<string, number> = {
  "text-embedding-3-small": 1536,
  "text-embedding-3-large": 3072,
  "text-embedding-ada-002": 1536,
};

export class OpenAIEmbeddingProvider implements EmbeddingProvider {
  public readonly kind = "openai";
  public readonly defaultModel = DEFAULT_MODEL;

  private get apiKey(): string | null {
    return process.env.OPENAI_API_KEY?.trim() || null;
  }

  public isConfigured(): boolean {
    return !!this.apiKey;
  }

  public async embed(req: EmbedRequest): Promise<EmbedResult> {
    if (!this.isConfigured()) {
      throw new EmbeddingProviderNotConfiguredError(this.kind, "OPENAI_API_KEY");
    }
    if (req.inputs.length === 0) {
      return { vectors: [], model: req.model || this.defaultModel, dims: 0, latencyMs: 0 };
    }
    const model = req.model || this.defaultModel;
    const start = Date.now();
    const resp = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ model, input: req.inputs }),
    });
    const text = await resp.text();
    let json: any;
    try { json = JSON.parse(text); } catch { json = null; }
    if (!resp.ok) {
      const message = json?.error?.message || text.slice(0, 300) || `HTTP ${resp.status}`;
      throw new EmbeddingProviderError(this.kind, message, {
        httpStatus: resp.status,
        retriable: resp.status === 429 || resp.status >= 500,
      });
    }
    const vectors: number[][] = (json?.data || [])
      .sort((a: any, b: any) => (a.index ?? 0) - (b.index ?? 0))
      .map((d: any) => d.embedding as number[]);
    if (vectors.length !== req.inputs.length) {
      throw new EmbeddingProviderError(this.kind, `expected ${req.inputs.length} vectors, got ${vectors.length}`);
    }
    return {
      vectors,
      model,
      dims: vectors[0]?.length ?? DEFAULT_DIMS[model] ?? 0,
      usageTokens: json?.usage?.total_tokens || 0,
      latencyMs: Date.now() - start,
    };
  }
}
