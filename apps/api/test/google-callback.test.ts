import { describe, expect, it } from "vitest";
import { buildServer } from "../src/server.js";

describe("Google OAuth callback", () => {
  it("passes the one-time state and authorization code to the exchange handler", async () => {
    let received: unknown;
    const app = await buildServer({
      internalServiceToken: "test-token",
      completeGoogleOAuth: async (input) => {
        received = input;
        return { connected: true, providerEmail: "employee@example.com" };
      },
    });

    const response = await app.inject({
      method: "GET",
      url: "/v1/google/oauth/callback?code=code-1&state=state-1",
      headers: { authorization: "Bearer test-token" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ connected: true, providerEmail: "employee@example.com" });
    expect(received).toEqual({ code: "code-1", state: "state-1" });
    await app.close();
  });

  it("rejects callback requests without both code and state", async () => {
    const app = await buildServer({ internalServiceToken: "test-token" });
    const response = await app.inject({
      method: "GET",
      url: "/v1/google/oauth/callback?code=code-1",
      headers: { authorization: "Bearer test-token" },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe("invalid_google_callback_request");
    await app.close();
  });
});
