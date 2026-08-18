import { z } from "zod";

/**
 * Hermes staging configuration.
 *
 * Every secret is a required string with no default. Configuration that has a
 * documented staging default (retention windows) may default here, but secrets
 * never default. This module is the single source of truth for environment
 * parsing; application code consumes the typed {@link AppConfig}.
 */

const RawEnvSchema = z.object({
  NODE_ENV: z.string().min(1).default("staging"),
  APP_BASE_URL: z.string().url(),
  API_PORT: z.coerce.number().int().positive(),
  INTERNAL_SERVICE_TOKEN: z.string().min(1),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  OBJECT_STORAGE_ENDPOINT: z.string().min(1),
  OBJECT_STORAGE_BUCKET: z.string().min(1),
  OBJECT_STORAGE_ACCESS_KEY: z.string().min(1),
  OBJECT_STORAGE_SECRET_KEY: z.string().min(1),
  TOKEN_ENCRYPTION_KEY: z.string().min(1),
  DISCORD_BOT_TOKEN: z.string().min(1),
  DISCORD_APPLICATION_ID: z.string().min(1),
  DISCORD_GUILD_ID: z.string().min(1),
  DISCORD_ASK_CHANNEL_ID: z.string().min(1),
  DISCORD_UPLOAD_CHANNEL_ID: z.string().min(1),
  GOOGLE_CLIENT_ID: z.string().min(1),
  GOOGLE_CLIENT_SECRET: z.string().min(1),
  GOOGLE_REDIRECT_URI: z.string().url(),
  OPENAI_API_KEY: z.string().min(1),
  OPENAI_REASONING_MODEL: z.string().min(1),
  OPENAI_EMBEDDING_MODEL: z.string().min(1),
  // Optional. When set, both LLM and embedding calls target this
  // OpenAI-compatible base URL instead of OpenAI's servers. Shorthand for
  // setting both OPENAI_LLM_BASE_URL and OPENAI_EMBEDDING_BASE_URL.
  OPENAI_BASE_URL: z.string().url().optional(),
  // Optional. Base URL for chat completions only. Overrides OPENAI_BASE_URL.
  // Use this when the chat provider doesn't support embeddings (e.g. a
  // ChatGPT/Codex subscription endpoint).
  OPENAI_LLM_BASE_URL: z.string().url().optional(),
  // Optional. Base URL for embeddings only. Overrides OPENAI_BASE_URL.
  // Use this when the embedding provider differs from the chat provider.
  OPENAI_EMBEDDING_BASE_URL: z.string().url().optional(),
  // Optional. Separate API key for the LLM client. Falls back to OPENAI_API_KEY.
  OPENAI_LLM_API_KEY: z.string().min(1).optional(),
  // Optional. Separate API key for the embedding client. Falls back to OPENAI_API_KEY.
  OPENAI_EMBEDDING_API_KEY: z.string().min(1).optional(),
  UPLOAD_MAX_BYTES: z.coerce.number().int().positive(),
  SOURCE_ACCESS_CACHE_TTL_SECONDS: z.coerce.number().int().nonnegative(),
  STAGING_GOOGLE_HOSTED_DOMAIN: z.string().default(""),
  STAGING_EMAIL_RECIPIENT_ALLOWLIST: z.string().default(""),
  STAGING_RETENTION_CONVERSATION_DAYS: z.coerce.number().int().positive().default(30),
  STAGING_RETENTION_THREAD_ARTIFACT_DAYS: z.coerce.number().int().positive().default(7),
  STAGING_RETENTION_AUDIT_DAYS: z.coerce.number().int().positive().default(90),
  STAGING_RETENTION_ACTION_DAYS: z.coerce.number().int().positive().default(90),
});

type RawEnv = z.infer<typeof RawEnvSchema>;

export interface AppConfig {
  nodeEnv: string;
  appBaseUrl: string;
  apiPort: number;
  internalServiceToken: string;
  databaseUrl: string;
  redisUrl: string;
  objectStorageEndpoint: string;
  objectStorageBucket: string;
  objectStorageAccessKey: string;
  objectStorageSecretKey: string;
  tokenEncryptionKey: string;
  discordBotToken: string;
  discordApplicationId: string;
  discordGuildId: string;
  discordAskChannelId: string;
  discordUploadChannelId: string;
  googleClientId: string;
  googleClientSecret: string;
  googleRedirectUri: string;
  openaiApiKey: string;
  openaiReasoningModel: string;
  openaiEmbeddingModel: string;
  openaiBaseUrl?: string;
  openaiLlmBaseUrl?: string;
  openaiEmbeddingBaseUrl?: string;
  openaiLlmApiKey?: string;
  openaiEmbeddingApiKey?: string;
  uploadMaxBytes: number;
  sourceAccessCacheTtlSeconds: number;
  stagingGoogleHostedDomain: string;
  stagingEmailRecipientAllowlist: string;
  stagingRetentionConversationDays: number;
  stagingRetentionThreadArtifactDays: number;
  stagingRetentionAuditDays: number;
  stagingRetentionActionDays: number;
}

function toAppConfig(raw: RawEnv): AppConfig {
  return {
    nodeEnv: raw.NODE_ENV,
    appBaseUrl: raw.APP_BASE_URL,
    apiPort: raw.API_PORT,
    internalServiceToken: raw.INTERNAL_SERVICE_TOKEN,
    databaseUrl: raw.DATABASE_URL,
    redisUrl: raw.REDIS_URL,
    objectStorageEndpoint: raw.OBJECT_STORAGE_ENDPOINT,
    objectStorageBucket: raw.OBJECT_STORAGE_BUCKET,
    objectStorageAccessKey: raw.OBJECT_STORAGE_ACCESS_KEY,
    objectStorageSecretKey: raw.OBJECT_STORAGE_SECRET_KEY,
    tokenEncryptionKey: raw.TOKEN_ENCRYPTION_KEY,
    discordBotToken: raw.DISCORD_BOT_TOKEN,
    discordApplicationId: raw.DISCORD_APPLICATION_ID,
    discordGuildId: raw.DISCORD_GUILD_ID,
    discordAskChannelId: raw.DISCORD_ASK_CHANNEL_ID,
    discordUploadChannelId: raw.DISCORD_UPLOAD_CHANNEL_ID,
    googleClientId: raw.GOOGLE_CLIENT_ID,
    googleClientSecret: raw.GOOGLE_CLIENT_SECRET,
    googleRedirectUri: raw.GOOGLE_REDIRECT_URI,
    openaiApiKey: raw.OPENAI_API_KEY,
    openaiReasoningModel: raw.OPENAI_REASONING_MODEL,
    openaiEmbeddingModel: raw.OPENAI_EMBEDDING_MODEL,
    openaiBaseUrl: raw.OPENAI_BASE_URL,
    openaiLlmBaseUrl: raw.OPENAI_LLM_BASE_URL,
    openaiEmbeddingBaseUrl: raw.OPENAI_EMBEDDING_BASE_URL,
    openaiLlmApiKey: raw.OPENAI_LLM_API_KEY,
    openaiEmbeddingApiKey: raw.OPENAI_EMBEDDING_API_KEY,
    uploadMaxBytes: raw.UPLOAD_MAX_BYTES,
    sourceAccessCacheTtlSeconds: raw.SOURCE_ACCESS_CACHE_TTL_SECONDS,
    stagingGoogleHostedDomain: raw.STAGING_GOOGLE_HOSTED_DOMAIN,
    stagingEmailRecipientAllowlist: raw.STAGING_EMAIL_RECIPIENT_ALLOWLIST,
    stagingRetentionConversationDays: raw.STAGING_RETENTION_CONVERSATION_DAYS,
    stagingRetentionThreadArtifactDays: raw.STAGING_RETENTION_THREAD_ARTIFACT_DAYS,
    stagingRetentionAuditDays: raw.STAGING_RETENTION_AUDIT_DAYS,
    stagingRetentionActionDays: raw.STAGING_RETENTION_ACTION_DAYS,
  };
}

/**
 * Parse and validate the staging environment.
 *
 * Throws a Zod error if any required value (including any secret) is missing or
 * malformed. Never invents fake defaults for secrets.
 */
export function loadConfig(env: NodeJS.ProcessEnv): AppConfig {
  return toAppConfig(RawEnvSchema.parse(env));
}
