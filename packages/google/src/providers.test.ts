import { describe, expect, it } from "vitest";
import { GoogleGmailProvider, GoogleCalendarProvider, GoogleOAuthAccessTokenSource } from "./providers.js";
import { encryptToken } from "./crypto.js";
import { saveConnection } from "./connections.js";
import { createEmployee } from "../../../test/fixtures/db-helpers.js";

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("Google Workspace providers", () => {
  it("creates, updates, and sends Gmail drafts with a scoped access token", async () => {
    const requests: Request[] = [];
    const provider = new GoogleGmailProvider(
      "employee-1",
      { getAccessToken: async () => "access-token" },
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const request = new Request(input, init);
        requests.push(request);
        if (request.url.endsWith("/drafts") && request.method === "POST") return response({ id: "draft-1" });
        if (request.url.endsWith("/drafts/draft-1") && request.method === "PUT") return response({ id: "draft-1" });
        return response({ id: "message-1" });
      },
    );

    expect(await provider.createDraft({ to: "sarah@example.com", subject: "Hello", body: "Body" })).toEqual({ draftId: "draft-1" });
    expect(await provider.updateDraft("draft-1", { to: "sarah@example.com", subject: "Updated", body: "Body 2" })).toEqual({ draftId: "draft-1" });
    expect(await provider.sendDraft("draft-1")).toEqual({ messageId: "message-1" });
    expect(requests.every((request) => request.headers.get("authorization") === "Bearer access-token")).toBe(true);
    expect((await requests[0]?.clone().json())?.message.raw).toBeTruthy();
  });

  it("refreshes an employee access token without exposing the refresh token", async () => {
    const emp = await createEmployee();
    const key = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
    await saveConnection({
      employeeId: emp.id,
      providerAccountId: `provider-${emp.id}`,
      encryptedRefreshToken: encryptToken("refresh-token", key),
      grantedScopes: ["openid"],
      key,
    });
    let body = "";
    const source = new GoogleOAuthAccessTokenSource("client", "secret", key, async (_input, init) => {
      body = String(init?.body ?? "");
      return response({ access_token: "access-token" });
    });

    await expect(source.getAccessToken(emp.id)).resolves.toBe("access-token");
    expect(body).toContain("refresh_token=refresh-token");
    expect(body).not.toContain("access-token");
  });

  it("reads free/busy and creates a Calendar meeting", async () => {
    const requests: Request[] = [];
    const provider = new GoogleCalendarProvider(
      "employee-1",
      { getAccessToken: async () => "calendar-token" },
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const request = new Request(input, init);
        requests.push(request);
        if (request.url.endsWith("/freeBusy")) return response({ calendars: { primary: { busy: [{ start: "10:00", end: "11:00" }] } } });
        return response({ id: "event-1" });
      },
    );

    expect(await provider.queryFreeBusy("2026-08-19T09:00:00Z", "2026-08-19T17:00:00Z")).toEqual({
      busySlots: [{ start: "10:00", end: "11:00" }],
    });
    expect(await provider.createEvent({
      summary: "Planning",
      start: "2026-08-19T12:00:00Z",
      end: "2026-08-19T13:00:00Z",
      attendees: ["sarah@example.com"],
    })).toEqual({ eventId: "event-1" });
    expect(requests.every((request) => request.headers.get("authorization") === "Bearer calendar-token")).toBe(true);
  });
});
