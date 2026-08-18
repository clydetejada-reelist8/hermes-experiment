import { describe, expect, it } from "vitest";
import { encryptToken, decryptToken } from "./crypto.js";

const KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

describe("token encryption", () => {
  it("round-trips a refresh token", () => {
    const plaintext = "ya29.a0ARrdaM-secret-refresh-token";
    const encrypted = encryptToken(plaintext, KEY);
    expect(encrypted).not.toBe(plaintext);
    expect(encrypted).toContain(":");
    const decrypted = decryptToken(encrypted, KEY);
    expect(decrypted).toBe(plaintext);
  });

  it("produces different ciphertexts for the same plaintext (random IV)", () => {
    const plaintext = "ya29.same-token";
    const a = encryptToken(plaintext, KEY);
    const b = encryptToken(plaintext, KEY);
    expect(a).not.toBe(b);
    expect(decryptToken(a, KEY)).toBe(plaintext);
    expect(decryptToken(b, KEY)).toBe(plaintext);
  });

  it("throws on tampered ciphertext", () => {
    const encrypted = encryptToken("secret", KEY);
    const parts = encrypted.split(":");
    const tampered = `${parts[0]}:${parts[1]}:${parts[2].slice(0, -2)}xx`;
    expect(() => decryptToken(tampered, KEY)).toThrow();
  });

  it("throws on wrong key", () => {
    const encrypted = encryptToken("secret", KEY);
    const wrongKey = "fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210";
    expect(() => decryptToken(encrypted, wrongKey)).toThrow();
  });
});
