/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Embedding-provider factory + lightweight registry.
 *
 * A caller passes the string identifier (from the Knowledge Base's
 * `embedding_provider` column) and gets back a fully-formed provider
 * instance. Unknown identifiers throw synchronously so bad DB values
 * surface at index time, not embed time.
 *
 * Adding a new provider = create the class, register it here, done.
 * No downstream code needs to change.
 */

import { EmbeddingProvider } from "./provider";
import { OpenAIEmbeddingProvider } from "./openai.embedding";
import { VoyageEmbeddingProvider } from "./voyage.embedding";
import { GeminiEmbeddingProvider } from "./gemini.embedding";
import { OllamaEmbeddingProvider } from "./ollama.embedding";

export type EmbeddingProviderKind = "openai" | "voyage" | "gemini" | "ollama";

const SINGLETONS: Partial<Record<EmbeddingProviderKind, EmbeddingProvider>> = {};

export function getEmbeddingProvider(kind: string): EmbeddingProvider {
  const k = (kind || "openai").toLowerCase() as EmbeddingProviderKind;
  if (SINGLETONS[k]) return SINGLETONS[k]!;
  switch (k) {
    case "openai":  SINGLETONS[k] = new OpenAIEmbeddingProvider();  return SINGLETONS[k]!;
    case "voyage":  SINGLETONS[k] = new VoyageEmbeddingProvider();  return SINGLETONS[k]!;
    case "gemini":  SINGLETONS[k] = new GeminiEmbeddingProvider();  return SINGLETONS[k]!;
    case "ollama":  SINGLETONS[k] = new OllamaEmbeddingProvider();  return SINGLETONS[k]!;
    default:
      throw new Error(`[embedding.factory] Unknown embedding provider "${kind}"`);
  }
}

export function listEmbeddingProviders(): Array<{
  kind: EmbeddingProviderKind;
  defaultModel: string;
  configured: boolean;
}> {
  const kinds: EmbeddingProviderKind[] = ["openai", "voyage", "gemini", "ollama"];
  return kinds.map((k) => {
    const p = getEmbeddingProvider(k);
    return { kind: k, defaultModel: p.defaultModel, configured: p.isConfigured() };
  });
}

export * from "./provider";
