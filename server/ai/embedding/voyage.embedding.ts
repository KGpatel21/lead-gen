/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Voyage AI embedding provider — voyage-3, voyage-3-lite, voyage-code-3.
 */

import {
  EmbedRequest,
  EmbedResult,
  EmbeddingProvider,
  EmbeddingProviderError,
  EmbeddingProviderNotConfiguredError,
} from "./provider";

const DEFAULT_MODEL = "voyage-3";

export class VoyageEmbeddingProvider implements EmbeddingProvider {
  public readonly kind = "voyage";
  public readonly defaultModel = DEFAULT_MODEL;

  private get apiKey(): string | null {
    return process.env.VOYAGE_API_KEY?.trim() || null;
  }
  public isConfigured(): boolean {
    return !!this.apiKey;
  }

  public async embed(req: EmbedRequest): Promise<EmbedResult> {
    if (!this.isConfigured()) {
      throw new EmbeddingProviderNotConfiguredError(this.kind, "VOYAGE_API_KEY");
    }
    if (req.inputs.length === 0) {
      return { vectors: [], model: req.model || this.defaultModel, dims: 0, latencyMs: 0 };
    }
    const model = req.model || this.defaultModel;
    const start = Date.now();
    const resp = await fetch("https://api.voyageai.com/v1/embeddings", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ model, input: req.inputs, input_type: "document" }),
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
    const vectors: number[][] = (json?.data || [])
      .sort((a: any, b: any) => (a.index ?? 0) - (b.index ?? 0))
      .map((d: any) => d.embedding as number[]);
    return {
      vectors,
      model,
      dims: vectors[0]?.length ?? 0,
      usageTokens: json?.usage?.total_tokens || 0,
      latencyMs: Date.now() - start,
    };
  }
}
