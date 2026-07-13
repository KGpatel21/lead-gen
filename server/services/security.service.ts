/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Symmetric secrets: AES-256-CBC for at-rest encryption of SMTP passwords &
 * mailbox OAuth tokens, PBKDF2-SHA512 for password hashing, HMAC-SHA256 for JWT.
 *
 * All keys come from `config` (which fails boot if unset). No fallback defaults.
 */

import crypto from "crypto";
import { config } from "../config";

const ENCRYPTION_KEY = crypto.createHash("sha256").update(config.encryptionKey).digest();
const JWT_SECRET = config.jwtSecret;
const IV_LENGTH = 16;

export class SecurityService {
  /**
   * Encrypts sensitive plaintext with AES-256-CBC.
   * KMS integration is intentionally not present here — swap in AWS/GCP KMS
   * once you're deploying somewhere that provides it, not before.
   */
  public static encryptSecret(text: string): string {
    if (!text) return "";
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv("aes-256-cbc", ENCRYPTION_KEY, iv);
    let encrypted = cipher.update(text, "utf8", "hex");
    encrypted += cipher.final("hex");
    return `aes:${iv.toString("hex")}:${encrypted}`;
  }

  public static decryptSecret(encryptedText: string): string {
    if (!encryptedText) return "";
    if (!encryptedText.startsWith("aes:")) {
      // Assume already plaintext (legacy row). Do not attempt heuristic decryption.
      return encryptedText;
    }
    const parts = encryptedText.split(":");
    if (parts.length !== 3) return encryptedText;
    const [, ivHex, payload] = parts;
    const iv = Buffer.from(ivHex, "hex");
    const decipher = crypto.createDecipheriv("aes-256-cbc", ENCRYPTION_KEY, iv);
    let decrypted = decipher.update(payload, "hex", "utf8");
    decrypted += decipher.final("utf8");
    return decrypted;
  }

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
      .createHmac("sha256", JWT_SECRET)
      .update(`${b64Header}.${b64Payload}`)
      .digest("base64url");
    return `${b64Header}.${b64Payload}.${signature}`;
  }

  public static verifyJwt<T = any>(token: string): T | null {
    try {
      const parts = token.split(".");
      if (parts.length !== 3) return null;
      const [h, p, s] = parts;
      const expected = crypto.createHmac("sha256", JWT_SECRET).update(`${h}.${p}`).digest("base64url");
      if (!crypto.timingSafeEqual(Buffer.from(s), Buffer.from(expected))) return null;
      const decoded: any = JSON.parse(Buffer.from(p, "base64url").toString("utf8"));
      if (decoded.exp && Math.floor(Date.now() / 1000) > decoded.exp) return null;
      return decoded as T;
    } catch {
      return null;
    }
  }
}
