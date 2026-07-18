/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Public barrel for the AI abstraction.
 * Import from `server/ai` — never from `server/ai/providers/*`.
 */

export { getAIProvider } from "./factory";
export { AIProviderNotConfiguredError, AIProviderError } from "./provider";
export type { AIProvider, AIGenerateOptions, AIGenerateResult } from "./provider";
