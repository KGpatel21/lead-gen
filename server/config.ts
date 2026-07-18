/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Central configuration & fail-fast validation.
 * Loaded once at boot. Any code that reaches for `process.env.X` directly
 * is a bug — add it here so the boot-time validation catches it.
 *
 * Phase 3.5 hardening:
 *   - Separate secrets: AUTH_JWT_SECRET / TRACKING_HMAC_SECRET /
 *     OAUTH_STATE_SECRET / ENCRYPTION_KEY. Each falls back to JWT_SECRET
 *     if the specific variable is unset, so existing installs keep working.
 *     Set them individually in production.
 *   - ENCRYPTION_KEY_ID: schema tag for future key rotation. Every AES
 *     ciphertext embeds the key_id used so multiple keys can coexist.
 *   - SENDER_POSTAL_ADDRESS + SENDER_COMPANY_NAME: required in production
 *     to satisfy CAN-SPAM.
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

  // ---- separate secrets (Phase 3.5) ----
  jwtSecret: string;                    // used ONLY to sign session JWTs
  trackingHmacSecret: string;           // signs open/click/unsubscribe tokens
  oauthStateSecret: string;             // signs OAuth `state` parameter
  encryptionKey: string;                // AES-256 material (see securityService)
  encryptionKeyId: string;              // tag stored on every ciphertext

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
  publicBaseUrl: string;

  // ---- CAN-SPAM (Phase 3.5) ----
  senderCompanyName: string | null;
  senderPostalAddress: string | null;

  // ---- Logging ----
  logLevel: "trace" | "debug" | "info" | "warn" | "error" | "fatal";
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

const legacyJwtSecret = required("JWT_SECRET");

export const config: AppConfig = {
  nodeEnv,
  isProduction: nodeEnv === "production",
  port: parseInt(process.env.PORT || "3000", 10),
  appUrl: process.env.APP_URL?.trim() || "http://localhost:3000",

  databaseUrl: required("DATABASE_URL"),
  redisUrl: required("REDIS_URL"),

  // Separate secrets — each falls back to JWT_SECRET so this migration is
  // non-breaking. In production, set all four to independent values.
  jwtSecret:            legacyJwtSecret,
  trackingHmacSecret:   optional("TRACKING_HMAC_SECRET") || `${legacyJwtSecret}::tracking`,
  oauthStateSecret:     optional("OAUTH_STATE_SECRET")   || `${legacyJwtSecret}::oauth`,
  encryptionKey:        required("ENCRYPTION_KEY"),
  encryptionKeyId:      optional("ENCRYPTION_KEY_ID")    || "v1",

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
  publicBaseUrl: process.env.PUBLIC_BASE_URL?.trim() || process.env.APP_URL?.trim() || "http://localhost:3000",

  senderCompanyName:   optional("SENDER_COMPANY_NAME"),
  senderPostalAddress: optional("SENDER_POSTAL_ADDRESS"),

  logLevel: (process.env.LOG_LEVEL?.trim().toLowerCase() as AppConfig["logLevel"]) || "info",
};

if (config.jwtSecret.length < 24) {
  throw new Error("[config] JWT_SECRET must be at least 24 characters of entropy.");
}
if (config.encryptionKey.length < 24) {
  throw new Error("[config] ENCRYPTION_KEY must be at least 24 characters of entropy.");
}
if (config.trackingHmacSecret.length < 24) {
  throw new Error("[config] TRACKING_HMAC_SECRET must be at least 24 characters of entropy.");
}
if (config.oauthStateSecret.length < 24) {
  throw new Error("[config] OAUTH_STATE_SECRET must be at least 24 characters of entropy.");
}

// CAN-SPAM: physical postal address is REQUIRED in production.
if (config.isProduction) {
  if (!config.senderCompanyName || !config.senderPostalAddress) {
    throw new Error(
      "[config] SENDER_COMPANY_NAME and SENDER_POSTAL_ADDRESS are required in production. " +
      "CAN-SPAM §7704(a)(5) requires a valid physical postal address in every commercial email."
    );
  }
}
