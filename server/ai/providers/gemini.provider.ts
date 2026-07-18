/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Gemini provider (DEPRECATED — kept only so the abstraction has more than
 * one implementation and so `AI_PROVIDER=gemini` still works for rollback).
 *
 * Never called unless AI_PROVIDER=gemini. New code should never import this
 * file directly — go through `getAIProvider()` in `server/ai/factory.ts`.
 */

import { GoogleGenAI } from "@google/genai";
import { config } from "../../config";
import {
  AIGenerateOptions,
  AIGenerateResult,
  AIProvider,
  AIProviderError,
  AIProviderNotConfiguredError,
} from "../provider";
import { withRetry, RetryHintedError } from "../retry";

interface GeminiResponse {
  text?: string;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
  };
}

export class GeminiProvider implements AIProvider {
  public readonly name = "gemini";
  public readonly model = "gemini-flash-lite-latest";
  private client: GoogleGenAI | null = null;

  public isConfigured(): boolean {
    return !!config.geminiApiKey;
  }

  private require(): GoogleGenAI {
    if (!config.geminiApiKey) {
      throw new AIProviderNotConfiguredError("Gemini", "GEMINI_API_KEY");
    }
    if (!this.client) {
      this.client = new GoogleGenAI({ apiKey: config.geminiApiKey });
    }
    return this.client;
  }

  public async generate(opts: AIGenerateOptions): Promise<AIGenerateResult> {
    const ai = this.require();
    const started = Date.now();

    // Compose prompt: system-then-user in a single "contents" string.
    const contents = opts.systemPrompt
      ? `System: ${opts.systemPrompt}\n\nUser: ${opts.prompt}`
      : opts.prompt;

    const generationConfig: Record<string, unknown> = {};
    if (opts.responseFormat === "json") generationConfig.responseMimeType = "application/json";
    if (opts.temperature != null) generationConfig.temperature = opts.temperature;
    if (opts.maxTokens) generationConfig.maxOutputTokens = opts.maxTokens;

    let response: GeminiResponse;
    let attempts = 0;
    try {
      const outcome = await withRetry<GeminiResponse>(
        async (attempt) => {
          attempts = attempt;
          try {
            const raw = await ai.models.generateContent({
              model: this.model,
              contents,
              config: generationConfig,
            });
            return raw as any as GeminiResponse;
          } catch (err: any) {
            // Try to surface an HTTP-like status so `withRetry` can classify.
            const status = err?.status || err?.$metadata?.httpStatusCode;
            const hint = new Error(err?.message || "Gemini call failed") as RetryHintedError;
            hint.status = typeof status === "number" ? status : undefined;
            throw hint;
          }
        },
        {
          maxAttempts: 3,
          onRetry: (attempt, err, waitMs) => {
            const anyErr = err as RetryHintedError;
            console.warn(
              `[ai] provider=gemini model=${this.model} attempt=${attempt}/3 status=${anyErr.status ?? "?"} waitMs=${waitMs} err="${err.message.slice(0, 160)}"`
            );
          },
        }
      );
      response = outcome.result;
      attempts = outcome.attempts;
    } catch (err) {
      const anyErr = err as RetryHintedError;
      const latencyMs = Date.now() - started;
      console.error(
        `[ai] provider=gemini model=${this.model} FAILED latency=${latencyMs}ms attempts=${attempts} status=${anyErr.status ?? "?"} err="${anyErr.message.slice(0, 200)}"`
      );
      throw new AIProviderError("gemini", anyErr.message || "Gemini call failed", {
        upstreamStatus: anyErr.status,
        httpStatus: anyErr.status === 429 ? 429 : 502,
      });
    }

    const latencyMs = Date.now() - started;
    const usage = {
      promptTokens: response.usageMetadata?.promptTokenCount,
      completionTokens: response.usageMetadata?.candidatesTokenCount,
      totalTokens: response.usageMetadata?.totalTokenCount,
    };
    const op = (opts.metadata && (opts.metadata.operation as string)) || "generate";
    console.log(
      `[ai] provider=gemini model=${this.model} operation=${op} latency=${latencyMs}ms attempts=${attempts} tokens=in/out/total=${usage.promptTokens ?? "?"}/${usage.completionTokens ?? "?"}/${usage.totalTokens ?? "?"}`
    );

    return {
      text: response.text || "",
      provider: this.name,
      model: this.model,
      latencyMs,
      usage,
      attempts,
    };
  }
}
