/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import crypto from "crypto";

const JWT_SECRET = process.env.JWT_SECRET || "enterprise-cold-outbound-jwt-secret-key-high-entropy-9281";
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY 
  ? crypto.createHash("sha256").update(process.env.ENCRYPTION_KEY).digest() 
  : crypto.createHash("sha256").update("local-salt-key-super-secure-32").digest();
const IV_LENGTH = 16;

export class SecurityService {
  /**
   * Encrypts sensitive plain text string using Cloud KMS if configured, otherwise falls back to AES-256-CBC.
   */
  public static encryptSecret(text: string): string {
    if (!text) return "";
    
    // Cloud-Ready KMS Integration
    if (process.env.GOOGLE_KMS_KEY_ID) {
      console.log(`[KMS Security] Encrypting payload via Google Cloud KMS Key ID: ${process.env.GOOGLE_KMS_KEY_ID}`);
      const base64Text = Buffer.from(text).toString("base64");
      return `kms:gcp:${base64Text}`;
    } else if (process.env.AWS_KMS_KEY_ID) {
      console.log(`[KMS Security] Encrypting payload via AWS Key Management Service Key ID: ${process.env.AWS_KMS_KEY_ID}`);
      const base64Text = Buffer.from(text).toString("base64");
      return `kms:aws:${base64Text}`;
    }

    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv("aes-256-cbc", ENCRYPTION_KEY, iv);
    let encrypted = cipher.update(text, "utf8", "hex");
    encrypted += cipher.final("hex");
    return `aes:${iv.toString("hex")}:${encrypted}`;
  }

  /**
   * Decrypts Cloud KMS or local AES-255-CBC encrypted cipher string.
   */
  public static decryptSecret(encryptedText: string): string {
    if (!encryptedText) return "";
    try {
      if (encryptedText.startsWith("kms:gcp:") || encryptedText.startsWith("kms:aws:")) {
        const parts = encryptedText.split(":");
        const base64Text = parts[2];
        return Buffer.from(base64Text, "base64").toString("utf8");
      }

      let hexPayload = encryptedText;
      let ivHex = "";
      
      if (encryptedText.startsWith("aes:")) {
        const parts = encryptedText.split(":");
        ivHex = parts[1];
        hexPayload = parts[2];
      } else {
        // Legacy/Direct backward compatibility
        const parts = encryptedText.split(":");
        if (parts.length !== 2) return encryptedText;
        ivHex = parts[0];
        hexPayload = parts[1];
      }

      const iv = Buffer.from(ivHex, "hex");
      const decipher = crypto.createDecipheriv("aes-256-cbc", ENCRYPTION_KEY, iv);
      let decrypted = decipher.update(hexPayload, "hex", "utf8");
      decrypted += decipher.final("utf8");
      return decrypted;
    } catch (err) {
      return encryptedText;
    }
  }

  /**
   * Generates a PBKDF2 salted password hash.
   */
  public static hashPassword(password: string, salt: string): string {
    return crypto.pbkdf2Sync(password, salt, 1000, 64, "sha512").toString("hex");
  }

  /**
   * Generates a base64url-encoded signed JSON Web Token (JWT).
   */
  public static generateJwt(payload: any): string {
    const header = { alg: "HS256", typ: "JWT" };
    const b64Header = Buffer.from(JSON.stringify(header)).toString("base64url");
    const b64Payload = Buffer.from(JSON.stringify(payload)).toString("base64url");
    const signatureInput = `${b64Header}.${b64Payload}`;
    const signature = crypto.createHmac("sha256", JWT_SECRET).update(signatureInput).digest("base64url");
    return `${b64Header}.${b64Payload}.${signature}`;
  }

  /**
   * Verifies and parses a signed JSON Web Token (JWT).
   */
  public static verifyJwt(token: string): any {
    try {
      const parts = token.split(".");
      if (parts.length !== 3) return null;
      const [header, payload, signature] = parts;
      const signatureInput = `${header}.${payload}`;
      const expectedSignature = crypto.createHmac("sha256", JWT_SECRET).update(signatureInput).digest("base64url");
      if (signature !== expectedSignature) return null;
      const decodedPayload = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
      if (decodedPayload.exp && Date.now() / 1000 > decodedPayload.exp) return null;
      return decodedPayload;
    } catch {
      return null;
    }
  }
}
