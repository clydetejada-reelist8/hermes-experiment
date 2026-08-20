export { encryptToken, decryptToken } from "./crypto.js";
export { buildGoogleAuthorizationUrl } from "./oauth.js";
export type { GoogleAuthorizationUrlInput } from "./oauth.js";
export {
  GoogleGmailProvider,
  GoogleCalendarProvider,
  GoogleOAuthAccessTokenSource,
} from "./providers.js";
export type {
  GoogleAccessTokenSource,
  GmailDraftParameters,
  CalendarEventParameters,
  GoogleFetchOptions,
} from "./providers.js";
export {
  createOAuthState,
  consumeOAuthState,
  saveConnection,
  getActiveConnection,
  revokeConnection,
} from "./connections.js";
export type { OAuthConnection, OAuthAuthorizationState } from "./connections.js";
export {
  revalidateConnection,
  getStaleConnections,
  revokeExpiredConnections,
  getActiveConnectionsForEmployee,
} from "./sync.js";
export type { TokenValidator, RevalidationResult } from "./sync.js";
