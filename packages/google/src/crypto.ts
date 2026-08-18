import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * AES-256-GCM token encryption for OAuth refresh tokens.
 *
 * The encryption key is a 64-character hex string (32 bytes). Each encryption
 * uses a random 12-byte IV. The ciphertext format is:
 *   base64(iv):base64(authTag):base64(ciphertext)
 *
 * Refresh tokens are NEVER stored in plaintext. They are encrypted at rest
 * using TOKEN_ENCRYPTION_KEY and only decrypted when making Google API calls.
 */

const ALGO = "aes-256-gcm";
const IV_LENGTH = 12;

function parseKey(key: string): Buffer {
  const buf = Buffer.from(key, "hex");
  if (buf.length !== 32) {
    throw new Error("TOKEN_ENCRYPTION_KEY must be 32 bytes (64 hex chars)");
  }
  return buf;
}

export function encryptToken(plaintext: string, key: string): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGO, parseKey(key), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [iv.toString("base64"), authTag.toString("base64"), ciphertext.toString("base64")].join(
    ":",
  );
}

export function decryptToken(encrypted: string, key: string): string {
  const [ivB64, authTagB64, ciphertextB64] = encrypted.split(":");
  if (!ivB64 || !authTagB64 || !ciphertextB64) {
    throw new Error("invalid ciphertext format");
  }
  const iv = Buffer.from(ivB64, "base64");
  const authTag = Buffer.from(authTagB64, "base64");
  const ciphertext = Buffer.from(ciphertextB64, "base64");
  const decipher = createDecipheriv(ALGO, parseKey(key), iv);
  decipher.setAuthTag(authTag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plaintext.toString("utf8");
}
