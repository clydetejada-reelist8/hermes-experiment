export interface GoogleAuthorizationUrlInput {
  clientId: string;
  redirectUri: string;
  state: string;
  scopes: string[];
  hostedDomain?: string;
}

export function buildGoogleAuthorizationUrl(input: GoogleAuthorizationUrlInput): string {
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", input.clientId);
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("state", input.state);
  url.searchParams.set("scope", input.scopes.join(" "));
  if (input.hostedDomain?.trim()) url.searchParams.set("hd", input.hostedDomain.trim());
  return url.toString();
}
