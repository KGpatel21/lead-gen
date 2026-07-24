/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Embedding provider contract.
 *
 * Every vendor that turns text → vector implements this interface. The
 * factory picks the right implementation per Knowledge Base or per
 * campaign. Downstream code (indexer, vector search, RAG orchestrator)
 * never imports a specific vendor package.
 *
 * The provider is expected to:
 *   • Support batch input (embed many strings in one round-trip).
 *   • Return one vector per input, in the same order.
 *   • Emit a consistent `dims` number that matches the stored embeddings
 *     — mixing models with different dimensionalities in the same
 *     knowledge_base is a bug caught by the KB service.
 */

export interface EmbedRequest {
  /** Non-empty array of chunk texts. */
  inputs: string[];
  /** Optional model override; defaults come from the provider config. */
  model?: string;
}

export interface EmbedResult {
  /** One vector per input, same order, same length. */
  vectors: number[][];
  /** Model actually used (may be the request override, may be provider default). */
  model: string;
  /** Dimensionality of each returned vector — same across the batch. */
  dims: number;
  /** Approx number of input tokens billed by the provider (0 if unknown). */
  usageTokens?: number;
  /** Wall-clock latency of the API call in ms. */
  latencyMs: number;
}

export interface EmbeddingProvider {
  /** Vendor identifier: "openai" | "voyage" | "gemini" | "ollama" | ... */
  readonly kind: string;
  /** Default model when the caller doesn't specify one. */
  readonly defaultModel: string;
  /** True if the environment is configured for this provider (API key present). */
  isConfigured(): boolean;
  /** Ask the provider to embed a batch of strings. Throws EmbeddingProviderError on failure. */
  embed(req: EmbedRequest): Promise<EmbedResult>;
}

export class EmbeddingProviderError extends Error {
  public readonly provider: string;
  public readonly httpStatus?: number;
  public readonly retriable: boolean;
  constructor(provider: string, message: string, opts: { httpStatus?: number; retriable?: boolean } = {}) {
    super(message);
    this.name = "EmbeddingProviderError";
    this.provider = provider;
    this.httpStatus = opts.httpStatus;
    this.retriable = opts.retriable ?? false;
  }
}

export class EmbeddingProviderNotConfiguredError extends EmbeddingProviderError {
  constructor(provider: string, missing: string) {
    super(provider, `${provider} embedding provider is not configured (missing ${missing}).`, { retriable: false });
    this.name = "EmbeddingProviderNotConfiguredError";
  }
}
