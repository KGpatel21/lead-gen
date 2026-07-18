/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Central configuration & fail-fast validation.
 *
 * Loaded once at boot. Any code that reaches for `process.env.X` directly
 * is a bug — add it here so the boot-time validation catches it.
 */

import dotenv from "dotenv";
dotenv.config();

type NodeEnv = "development" | "test" | "production";

interface AppConfig {
  nodeEnv: NodeEnv;
  isProduction: boolean;
  port: number;
  appUrl: string;

  databaseUrl: string;
  redisUrl: string;

  jwtSecret: string;
  encryptionKey: string;

  aiProvider: "groq" | "gemini";
  groqApiKey: string | null;
  groqModel: string;
  geminiApiKey: string | null;

  stripeSecretKey: string | null;
  stripeWebhookSecret: string | null;
  stripePriceFreeId: string | null;
  stripePriceGrowthId: string | null;
  stripePriceEnterpriseId: string | null;

  googleClientId: string | null;
  googleClientSecret: string | null;
  microsoftClientId: string | null;
  microsoftClientSecret: string | null;

  googlePlacesApiKey: string | null;
  firecrawlApiKey: string | null;

  awsAccessKeyId: string | null;
  awsSecretAccessKey: string | null;
  awsRegion: string;
  sesFromEmail: string | null;
  sesConfigurationSet: string | null;
}

function required(name: string): string {
  const v = process.env[name];
  if (!v || v.trim() === "") {
    throw new Error(
      `[config] Required environment variable "${name}" is missing or empty. ` +
      `Copy .env.example to .env and fill it in before starting the server.`
    );
  }
  return v.trim();
}

function optional(name: string): string | null {
  const v = process.env[name];
  return v && v.trim() !== "" ? v.trim() : null;
}

const rawNodeEnv = (process.env.NODE_ENV || "development").toLowerCase();
const nodeEnv: NodeEnv =
  rawNodeEnv === "production" || rawNodeEnv === "test" ? rawNodeEnv : "development";

export const config: AppConfig = {
  nodeEnv,
  isProduction: nodeEnv === "production",
  port: parseInt(process.env.PORT || "3000", 10),
  appUrl: process.env.APP_URL?.trim() || "http://localhost:3000",

  databaseUrl: required("DATABASE_URL"),
  redisUrl: required("REDIS_URL"),

  jwtSecret: required("JWT_SECRET"),
  encryptionKey: required("ENCRYPTION_KEY"),

  aiProvider: (() => {
    const raw = (process.env.AI_PROVIDER || "groq").toLowerCase().trim();
    if (raw !== "groq" && raw !== "gemini") {
      throw new Error(`[config] AI_PROVIDER must be one of: groq, gemini. Got "${raw}".`);
    }
    return raw as "groq" | "gemini";
  })(),
  groqApiKey: optional("GROQ_API_KEY"),
  groqModel: process.env.GROQ_MODEL?.trim() || "llama-3.3-70b-versatile",
  geminiApiKey: optional("GEMINI_API_KEY"),

  stripeSecretKey: optional("STRIPE_SECRET_KEY"),
  stripeWebhookSecret: optional("STRIPE_WEBHOOK_SECRET"),
  stripePriceFreeId: optional("STRIPE_PRICE_FREE_ID"),
  stripePriceGrowthId: optional("STRIPE_PRICE_GROWTH_ID"),
  stripePriceEnterpriseId: optional("STRIPE_PRICE_ENTERPRISE_ID"),

  googleClientId: optional("GOOGLE_CLIENT_ID"),
  googleClientSecret: optional("GOOGLE_CLIENT_SECRET"),
  microsoftClientId: optional("MICROSOFT_CLIENT_ID"),
  microsoftClientSecret: optional("MICROSOFT_CLIENT_SECRET"),

  googlePlacesApiKey: optional("GOOGLE_PLACES_API_KEY"),
  firecrawlApiKey: optional("FIRECRAWL_API_KEY"),

  awsAccessKeyId: optional("AWS_ACCESS_KEY_ID"),
  awsSecretAccessKey: optional("AWS_SECRET_ACCESS_KEY"),
  awsRegion: process.env.AWS_REGION?.trim() || "us-east-1",
  sesFromEmail: optional("SES_FROM_EMAIL"),
  sesConfigurationSet: optional("SES_CONFIGURATION_SET"),
};

if (config.jwtSecret.length < 24) {
  throw new Error("[config] JWT_SECRET must be at least 24 characters of entropy.");
}
if (config.encryptionKey.length < 24) {
  throw new Error("[config] ENCRYPTION_KEY must be at least 24 characters of entropy.");
}
