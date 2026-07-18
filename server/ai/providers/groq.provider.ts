/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Groq provider. Uses the OpenAI-compatible chat/completions endpoint.
 * Model: llama-3.3-70b-versatile (fixed by user policy).
 */

import { config } from "../../config";
import {
  AIGenerateOptions,
  AIGenerateResult,
  AIProvider,
  AIProviderError,
  AIProviderNotConfiguredError,
} from "../provider";
import { withRetry, RetryHintedError } from "../retry";

const ENDPOINT = "https://api.groq.com/openai/v1/chat/completions";
const DEFAULT_TIMEOUT_MS = 60_000;

interface GroqChatResponse {
  id?: string;
  model?: string;
  choices?: Array<{ index?: number; message?: { role?: string; content?: string }; finish_reason?: string }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
  error?: { message?: string; type?: string };
}

export class GroqProvider implements AIProvider {
  public readonly name = "groq";
  public readonly model: string;

  constructor() {
    this.model = config.groqModel; // "llama-3.3-70b-versatile" unless overridden
  }

  public isConfigured(): boolean {
    return !!config.groqApiKey;
  }

  private buildMessages(opts: AIGenerateOptions): Array<{ role: string; content: string }> {
    const messages: Array<{ role: string; content: string }> = [];
    if (opts.systemPrompt) messages.push({ role: "system", content: opts.systemPrompt });
    messages.push({ role: "user", content: opts.prompt });
    return messages;
  }

  private async fetchOnce(apiKey: string, body: unknown): Promise<GroqChatResponse> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), DEFAULT_TIMEOUT_MS);
    try {
      const resp = await fetch(ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
      const json = (await resp.json().catch(() => ({}))) as GroqChatResponse;
      if (!resp.ok) {
        const retryAfterHeader = resp.headers.get("retry-after");
        const retryAfterMs = retryAfterHeader
          ? Math.round(parseFloat(retryAfterHeader) * 1000) || undefined
          : undefined;
        const err = new Error(
          (json?.error?.message || `Groq HTTP ${resp.status}`) as string
        ) as RetryHintedError;
        err.status = resp.status;
        err.retryAfterMs = retryAfterMs;
        throw err;
      }
      return json;
    } finally {
      clearTimeout(timer);
    }
  }

  public async generate(opts: AIGenerateOptions): Promise<AIGenerateResult> {
    if (!this.isConfigured()) {
      throw new AIProviderNotConfiguredError("Groq", "GROQ_API_KEY");
    }
    const apiKey = config.groqApiKey!;
    const started = Date.now();

    const body: Record<string, unknown> = {
      model: this.model,
      messages: this.buildMessages(opts),
      temperature: opts.temperature ?? 0.6,
    };
    if (opts.maxTokens) body.max_tokens = opts.maxTokens;
    if (opts.responseFormat === "json") body.response_format = { type: "json_object" };

    let json: GroqChatResponse;
    let attempts = 0;
    try {
      const outcome = await withRetry<GroqChatResponse>(
        async (attempt) => {
          attempts = attempt;
          return this.fetchOnce(apiKey, body);
        },
        {
          maxAttempts: 3,
          onRetry: (attempt, err, waitMs) => {
            const anyErr = err as RetryHintedError;
            console.warn(
              `[ai] provider=groq model=${this.model} attempt=${attempt}/3 status=${anyErr.status ?? "?"} waitMs=${waitMs} err="${err.message.slice(0, 160)}"`
            );
          },
        }
      );
      json = outcome.result;
      attempts = outcome.attempts;
    } catch (err) {
      const anyErr = err as RetryHintedError;
      const latencyMs = Date.now() - started;
      console.error(
        `[ai] provider=groq model=${this.model} FAILED latency=${latencyMs}ms attempts=${attempts} status=${anyErr.status ?? "?"} err="${anyErr.message.slice(0, 200)}"`
      );
      throw new AIProviderError("groq", anyErr.message || "Groq call failed", {
        upstreamStatus: anyErr.status,
        httpStatus: anyErr.status === 429 ? 429 : 502,
      });
    }

    const latencyMs = Date.now() - started;
    const text = json?.choices?.[0]?.message?.content || "";
    const usage = {
      promptTokens: json?.usage?.prompt_tokens,
      completionTokens: json?.usage?.completion_tokens,
      totalTokens: json?.usage?.total_tokens,
    };

    // Structured log — provider, model, latency, tokens, attempts, operation.
    const op =
      (opts.metadata && (opts.metadata.operation as string)) || "generate";
    console.log(
      `[ai] provider=groq model=${this.model} operation=${op} latency=${latencyMs}ms attempts=${attempts} tokens=in/out/total=${usage.promptTokens ?? "?"}/${usage.completionTokens ?? "?"}/${usage.totalTokens ?? "?"}`
    );

    return {
      text,
      provider: this.name,
      model: this.model,
      latencyMs,
      usage,
      attempts,
    };
  }
}
