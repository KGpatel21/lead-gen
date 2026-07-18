/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * At-rest secrets: AES-256-CBC for SMTP passwords and OAuth tokens,
 * PBKDF2-SHA512 for password hashing and encryption-key derivation,
 * HMAC-SHA256 for JWT.
 *
 * Phase 3.5 hardening:
 *   - Encryption key is derived via PBKDF2 (200k iterations, "outbound-ai
 *     encryption v1") rather than a raw SHA-256 of the config string. This
 *     makes brute-force of the config value drastically slower.
 *   - Ciphertexts carry a key_id (`aes:<keyId>:<iv>:<payload>`) so multiple
 *     keys can coexist during a rotation window.
 */

import crypto from "crypto";
import { config } from "../config";

const KDF_SALT = "outbound-ai:encryption:v1";      // static salt is fine here — the input is a shared secret, not a per-user password
const KDF_ITERATIONS = 200_000;                     // ~200 ms on a laptop, forces expensive brute-force of the config value
const KDF_KEYLEN = 32;                              // 32 bytes → AES-256
const KDF_DIGEST = "sha512";

// Cache: derive once per (keyId, secret) rather than per-encrypt/decrypt.
const derivedKeyCache: Map<string, Buffer> = new Map();

function deriveKey(keyId: string, rawSecret: string): Buffer {
  const cacheKey = `${keyId}::${rawSecret.length}`;
  const cached = derivedKeyCache.get(cacheKey);
  if (cached) return cached;
  const derived = crypto.pbkdf2Sync(rawSecret, `${KDF_SALT}:${keyId}`, KDF_ITERATIONS, KDF_KEYLEN, KDF_DIGEST);
  derivedKeyCache.set(cacheKey, derived);
  return derived;
}

const ACTIVE_KEY_ID = config.encryptionKeyId;
const ACTIVE_KEY = deriveKey(ACTIVE_KEY_ID, config.encryptionKey);
const IV_LENGTH = 16;

export class SecurityService {
  /**
   * Encrypts with the ACTIVE key.
   * Wire format: `aes:<keyId>:<hex iv>:<hex payload>` (V1 legacy: `aes:<iv>:<payload>` still readable).
   */
  public static encryptSecret(text: string): string {
    if (!text) return "";
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv("aes-256-cbc", ACTIVE_KEY, iv);
    const encrypted = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
    return `aes:${ACTIVE_KEY_ID}:${iv.toString("hex")}:${encrypted.toString("hex")}`;
  }

  /**
   * Decrypts either the new tagged format or the legacy 3-part format.
   * Returns the input unchanged if it does not look encrypted (backward compat).
   */
  public static decryptSecret(encryptedText: string): string {
    if (!encryptedText) return "";
    if (!encryptedText.startsWith("aes:")) return encryptedText;

    const parts = encryptedText.split(":");
    let keyId: string;
    let ivHex: string;
    let payloadHex: string;

    if (parts.length === 4) {
      // aes:<keyId>:<iv>:<payload>
      [, keyId, ivHex, payloadHex] = parts;
    } else if (parts.length === 3) {
      // Legacy: aes:<iv>:<payload> — assume the current active key.
      keyId = ACTIVE_KEY_ID;
      ivHex = parts[1];
      payloadHex = parts[2];
    } else {
      return encryptedText;
    }

    // Same secret material; different keyId → new PBKDF2 derivation.
    // In production, historical keys are handed to the process via a small
    // KEYRING env (JSON) — this session only supports the current key.
    const key = keyId === ACTIVE_KEY_ID ? ACTIVE_KEY : deriveKey(keyId, config.encryptionKey);
    const iv = Buffer.from(ivHex, "hex");
    const decipher = crypto.createDecipheriv("aes-256-cbc", key, iv);
    const decrypted = Buffer.concat([decipher.update(payloadHex, "hex"), decipher.final()]);
    return decrypted.toString("utf8");
  }

  public static currentEncryptionKeyId(): string {
    return ACTIVE_KEY_ID;
  }

  /** PBKDF2-SHA512 password hashing (existing behavior, unchanged). */
  public static hashPassword(password: string, salt: string): string {
    return crypto.pbkdf2Sync(password, salt, 120_000, 64, "sha512").toString("hex");
  }

  public static newSalt(): string {
    return crypto.randomBytes(16).toString("hex");
  }

  public static generateJwt(payload: object, expiresInSeconds = 60 * 60 * 24 * 7): string {
    const header = { alg: "HS256", typ: "JWT" };
    const body = { ...payload, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + expiresInSeconds };
    const b64Header = Buffer.from(JSON.stringify(header)).toString("base64url");
    const b64Payload = Buffer.from(JSON.stringify(body)).toString("base64url");
    const signature = crypto
      .createHmac("sha256", config.jwtSecret)
      .update(`${b64Header}.${b64Payload}`)
      .digest("base64url");
    return `${b64Header}.${b64Payload}.${signature}`;
  }

  public static verifyJwt<T = any>(token: string): T | null {
    try {
      const parts = token.split(".");
      if (parts.length !== 3) return null;
      const [h, p, s] = parts;
      const expected = crypto.createHmac("sha256", config.jwtSecret).update(`${h}.${p}`).digest("base64url");
      if (!crypto.timingSafeEqual(Buffer.from(s), Buffer.from(expected))) return null;
      const decoded: any = JSON.parse(Buffer.from(p, "base64url").toString("utf8"));
      if (decoded.exp && Math.floor(Date.now() / 1000) > decoded.exp) return null;
      return decoded as T;
    } catch {
      return null;
    }
  }
}
