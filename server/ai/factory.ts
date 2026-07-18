/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Provider registry / factory.
 *
 * Business logic imports `getAIProvider()` from here — it must NEVER import
 * a specific provider (that couples logic to a vendor). Adding a new provider
 * is a matter of writing one class under `providers/` and one line in the
 * switch below.
 */

import { config } from "../config";
import { AIProvider } from "./provider";
import { GroqProvider } from "./providers/groq.provider";
import { GeminiProvider } from "./providers/gemini.provider";

let cached: AIProvider | null = null;

export function getAIProvider(): AIProvider {
  if (cached) return cached;
  switch (config.aiProvider) {
    case "groq":
      cached = new GroqProvider();
      break;
    case "gemini":
      cached = new GeminiProvider();
      break;
    default: {
      const _exhaustive: never = config.aiProvider;
      throw new Error(`[ai] unknown provider: ${_exhaustive}`);
    }
  }
  console.log(
    `[ai] provider selected: ${cached.name} model=${cached.model} configured=${cached.isConfigured()}`
  );
  return cached;
}

/**
 * Reset the cached provider — only useful for tests that mutate `config`.
 */
export function resetAIProviderForTests(): void {
  cached = null;
}

export { AIProviderNotConfiguredError, AIProviderError } from "./provider";
export type { AIProvider, AIGenerateOptions, AIGenerateResult } from "./provider";
