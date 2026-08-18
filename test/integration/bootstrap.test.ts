import { describe, expect, it } from "vitest";
import { loadConfig } from "@hermes/config";

describe("loadConfig", () => {
  it("rejects missing DATABASE_URL", () => {
    expect(() => loadConfig({ NODE_ENV: "staging" } as NodeJS.ProcessEnv)).toThrow();
  });

  it("accepts a complete staging environment", () => {
    const env: NodeJS.ProcessEnv = {
      NODE_ENV: "staging",
      APP_BASE_URL: "http://localhost:3000",
      API_PORT: "3000",
      INTERNAL_SERVICE_TOKEN: "token",
      DATABASE_URL: "postgresql://u:p@localhost:5432/hermes",
      REDIS_URL: "redis://localhost:6379",
      OBJECT_STORAGE_ENDPOINT: "http://localhost:9000",
      OBJECT_STORAGE_BUCKET: "hermes-staging",
      OBJECT_STORAGE_ACCESS_KEY: "ak",
      OBJECT_STORAGE_SECRET_KEY: "sk",
      TOKEN_ENCRYPTION_KEY: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      DISCORD_BOT_TOKEN: "bot",
      DISCORD_APPLICATION_ID: "app",
      DISCORD_GUILD_ID: "guild",
      DISCORD_ASK_CHANNEL_ID: "ask",
      DISCORD_UPLOAD_CHANNEL_ID: "upload",
      GOOGLE_CLIENT_ID: "gcid",
      GOOGLE_CLIENT_SECRET: "gcs",
      GOOGLE_REDIRECT_URI: "http://localhost:3000/v1/google/oauth/callback",
      OPENAI_API_KEY: "oai",
      OPENAI_REASONING_MODEL: "gpt-5.6",
      OPENAI_EMBEDDING_MODEL: "text-embedding-3-small",
      UPLOAD_MAX_BYTES: "10485760",
      SOURCE_ACCESS_CACHE_TTL_SECONDS: "300",
    };
    const cfg = loadConfig(env);
    expect(cfg.databaseUrl).toBe(env.DATABASE_URL);
    expect(cfg.uploadMaxBytes).toBe(10485760);
    expect(cfg.openaiReasoningModel).toBe("gpt-5.6");
    expect(cfg.openaiBaseUrl).toBeUndefined();
  });

  it("accepts an optional OPENAI_BASE_URL for OpenAI-compatible endpoints", () => {
    const env: NodeJS.ProcessEnv = {
      NODE_ENV: "staging",
      APP_BASE_URL: "http://localhost:3000",
      API_PORT: "3000",
      INTERNAL_SERVICE_TOKEN: "token",
      DATABASE_URL: "postgresql://u:p@localhost:5432/hermes",
      REDIS_URL: "redis://localhost:6379",
      OBJECT_STORAGE_ENDPOINT: "http://localhost:9000",
      OBJECT_STORAGE_BUCKET: "hermes-staging",
      OBJECT_STORAGE_ACCESS_KEY: "ak",
      OBJECT_STORAGE_SECRET_KEY: "sk",
      TOKEN_ENCRYPTION_KEY: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      DISCORD_BOT_TOKEN: "bot",
      DISCORD_APPLICATION_ID: "app",
      DISCORD_GUILD_ID: "guild",
      DISCORD_ASK_CHANNEL_ID: "ask",
      DISCORD_UPLOAD_CHANNEL_ID: "upload",
      GOOGLE_CLIENT_ID: "gcid",
      GOOGLE_CLIENT_SECRET: "gcs",
      GOOGLE_REDIRECT_URI: "http://localhost:3000/v1/google/oauth/callback",
      OPENAI_API_KEY: "oai",
      OPENAI_REASONING_MODEL: "gpt-5.6",
      OPENAI_EMBEDDING_MODEL: "text-embedding-3-small",
      OPENAI_BASE_URL: "https://api.nousresearch.com/v1",
      UPLOAD_MAX_BYTES: "10485760",
      SOURCE_ACCESS_CACHE_TTL_SECONDS: "300",
    };
    const cfg = loadConfig(env);
    expect(cfg.openaiBaseUrl).toBe("https://api.nousresearch.com/v1");
  });

  it("never supplies fake defaults for secrets", () => {
    const env: NodeJS.ProcessEnv = {
      NODE_ENV: "staging",
      DATABASE_URL: "postgresql://u:p@localhost:5432/hermes",
      REDIS_URL: "redis://localhost:6379",
      OBJECT_STORAGE_ENDPOINT: "http://localhost:9000",
      OBJECT_STORAGE_BUCKET: "hermes-staging",
      OBJECT_STORAGE_ACCESS_KEY: "ak",
      OBJECT_STORAGE_SECRET_KEY: "sk",
      TOKEN_ENCRYPTION_KEY: "k",
      DISCORD_BOT_TOKEN: "bot",
      DISCORD_APPLICATION_ID: "app",
      DISCORD_GUILD_ID: "guild",
      DISCORD_ASK_CHANNEL_ID: "ask",
      DISCORD_UPLOAD_CHANNEL_ID: "upload",
      GOOGLE_CLIENT_ID: "gcid",
      GOOGLE_CLIENT_SECRET: "gcs",
      GOOGLE_REDIRECT_URI: "http://localhost:3000/v1/google/oauth/callback",
      OPENAI_API_KEY: "oai",
      OPENAI_REASONING_MODEL: "gpt-5.6",
      OPENAI_EMBEDDING_MODEL: "text-embedding-3-small",
      UPLOAD_MAX_BYTES: "10485760",
      SOURCE_ACCESS_CACHE_TTL_SECONDS: "300",
    };
    // Missing INTERNAL_SERVICE_TOKEN must throw rather than default.
    expect(() => loadConfig(env)).toThrow();
  });
});
