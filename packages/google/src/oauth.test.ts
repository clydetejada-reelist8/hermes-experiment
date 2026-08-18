import { describe, expect, it } from "vitest";
import { buildGoogleAuthorizationUrl } from "./oauth.js";

describe("Google authorization URL", () => {
  it("encodes only the requested capability scopes and OAuth state", () => {
    const url = new URL(
      buildGoogleAuthorizationUrl({
        clientId: "client-1",
        redirectUri: "https://hermes.test/v1/google/oauth/callback",
        state: "state-1",
        scopes: ["gmail.compose", "calendar.freebusy"],
        hostedDomain: "reelist8.com",
      }),
    );

    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(url.searchParams.get("client_id")).toBe("client-1");
    expect(url.searchParams.get("state")).toBe("state-1");
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("prompt")).toBe("consent");
    expect(url.searchParams.get("hd")).toBe("reelist8.com");
    expect(url.searchParams.get("scope")).toContain("gmail.compose");
    expect(url.searchParams.get("scope")).toContain("calendar.freebusy");
  });
});
