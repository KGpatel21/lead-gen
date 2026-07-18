/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Vendor-agnostic AI provider contract. Every business-logic call sites
 * uses this interface — no code outside of `server/ai/providers/*` may
 * reference a vendor SDK directly.
 */

export type ResponseFormat = "text" | "json";

export interface AIGenerateOptions {
  /** User prompt (fully rendered — do not template inside providers). */
  prompt: string;
  /** Optional system prompt sent as a separate role in chat-style APIs. */
  systemPrompt?: string;
  /** "json" asks the provider to return valid JSON; caller is still responsible for parsing. */
  responseFormat?: ResponseFormat;
  /** Sampling temperature. Defaults to a moderate value in each provider. */
  temperature?: number;
  /** Max output tokens. Provider clamps as needed. */
  maxTokens?: number;
  /** Free-form metadata included in `[ai]` logs — never sent to the vendor. */
  metadata?: Record<string, unknown>;
}

export interface AIUsage {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
}

export interface AIGenerateResult {
  text: string;
  provider: string;
  model: string;
  latencyMs: number;
  usage?: AIUsage;
  attempts: number;
}

export interface AIProvider {
  /** Human-readable name: "groq" | "gemini" | ... */
  readonly name: string;
  /** Model id used for every request through this provider. */
  readonly model: string;
  /** True when credentials for this provider are present. */
  isConfigured(): boolean;
  /** Run one prompt. Retries and rate-limit handling are inside this call. */
  generate(options: AIGenerateOptions): Promise<AIGenerateResult>;
}

export class AIProviderNotConfiguredError extends Error {
  public readonly httpStatus = 503;
  constructor(providerName: string, missingEnvVar: string) {
    super(
      `${providerName} provider is not configured. Set ${missingEnvVar} in .env to enable AI features.`
    );
    this.name = "AIProviderNotConfiguredError";
  }
}

/**
 * Thrown when a provider exhausts retries against a persistent rate-limit
 * or upstream 5xx. Carries the last-seen status for the controller layer
 * to surface a friendly message.
 */
export class AIProviderError extends Error {
  public readonly httpStatus: number;
  public readonly provider: string;
  public readonly upstreamStatus?: number;
  constructor(provider: string, message: string, opts: { httpStatus?: number; upstreamStatus?: number } = {}) {
    super(message);
    this.name = "AIProviderError";
    this.provider = provider;
    this.httpStatus = opts.httpStatus ?? 502;
    this.upstreamStatus = opts.upstreamStatus;
  }
}
