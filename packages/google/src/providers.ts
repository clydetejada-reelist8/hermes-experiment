import { decryptToken } from "./crypto.js";
import { getActiveConnection, revokeConnection } from "./connections.js";

export interface GoogleAccessTokenSource {
  getAccessToken(employeeId: string): Promise<string>;
}

export interface GmailDraftParameters {
  to: string;
  subject: string;
  body: string;
}

export interface GoogleFetchOptions {
  fetchImpl?: typeof fetch;
  gmailBaseUrl?: string;
  calendarBaseUrl?: string;
}

export class GoogleOAuthAccessTokenSource implements GoogleAccessTokenSource {
  constructor(
    private readonly clientId: string,
    private readonly clientSecret: string,
    private readonly encryptionKey: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async getAccessToken(employeeId: string): Promise<string> {
    const connection = await getActiveConnection(employeeId);
    if (!connection?.encryptedRefreshToken) throw new Error("google_connection_missing");

    const refreshToken = decryptToken(connection.encryptedRefreshToken, this.encryptionKey);
    const response = await this.fetchImpl("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: this.clientId,
        client_secret: this.clientSecret,
        refresh_token: refreshToken,
        grant_type: "refresh_token",
      }),
    });
    if (!response.ok) {
      await revokeConnection(employeeId);
      throw new Error("google_access_token_refresh_failed");
    }
    const payload = (await response.json()) as { access_token?: string };
    if (!payload.access_token) throw new Error("google_access_token_missing");
    return payload.access_token;
  }
}

export class GoogleGmailProvider {
  private readonly fetchImpl: typeof fetch;
  private readonly baseUrl: string;

  constructor(
    private readonly employeeId: string,
    private readonly tokenSource: GoogleAccessTokenSource,
    fetchImplOrOptions: typeof fetch | GoogleFetchOptions = fetch,
  ) {
    this.fetchImpl =
      typeof fetchImplOrOptions === "function"
        ? fetchImplOrOptions
        : (fetchImplOrOptions.fetchImpl ?? fetch);
    this.baseUrl =
      typeof fetchImplOrOptions === "function"
        ? "https://gmail.googleapis.com/gmail/v1/users/me"
        : (fetchImplOrOptions.gmailBaseUrl ?? "https://gmail.googleapis.com/gmail/v1/users/me");
  }

  async createDraft(params: GmailDraftParameters): Promise<{ draftId: string }> {
    const result = await this.request<{ id?: string }>("/drafts", "POST", {
      message: { raw: encodeRawMessage(params) },
    });
    if (!result.id) throw new Error("gmail_draft_id_missing");
    return { draftId: result.id };
  }

  async updateDraft(draftId: string, params: GmailDraftParameters): Promise<{ draftId: string }> {
    const result = await this.request<{ id?: string }>(
      `/drafts/${encodeURIComponent(draftId)}`,
      "PUT",
      {
        message: { raw: encodeRawMessage(params) },
      },
    );
    if (!result.id) throw new Error("gmail_draft_id_missing");
    return { draftId: result.id };
  }

  async sendDraft(draftId: string): Promise<{ messageId: string }> {
    const result = await this.request<{ id?: string }>("/messages/send", "POST", { draftId });
    if (!result.id) throw new Error("gmail_message_id_missing");
    return { messageId: result.id };
  }

  private async request<T>(
    path: string,
    method: string,
    body: Record<string, unknown>,
  ): Promise<T> {
    const token = await this.tokenSource.getAccessToken(this.employeeId);
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error(`google_gmail_request_failed_${response.status}`);
    return (await response.json()) as T;
  }
}

export interface CalendarEventParameters {
  summary: string;
  start: string;
  end: string;
  attendees?: string[];
}

export class GoogleCalendarProvider {
  private readonly fetchImpl: typeof fetch;
  private readonly baseUrl: string;

  constructor(
    private readonly employeeId: string,
    private readonly tokenSource: GoogleAccessTokenSource,
    fetchImplOrOptions: typeof fetch | GoogleFetchOptions = fetch,
  ) {
    this.fetchImpl =
      typeof fetchImplOrOptions === "function"
        ? fetchImplOrOptions
        : (fetchImplOrOptions.fetchImpl ?? fetch);
    this.baseUrl =
      typeof fetchImplOrOptions === "function"
        ? "https://www.googleapis.com/calendar/v3/calendars/primary"
        : (fetchImplOrOptions.calendarBaseUrl ??
          "https://www.googleapis.com/calendar/v3/calendars/primary");
  }

  async queryFreeBusy(
    start: string,
    end: string,
  ): Promise<{ busySlots: { start: string; end: string }[] }> {
    const token = await this.tokenSource.getAccessToken(this.employeeId);
    const response = await this.fetchImpl("https://www.googleapis.com/calendar/v3/freeBusy", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ timeMin: start, timeMax: end, items: [{ id: "primary" }] }),
    });
    if (!response.ok) throw new Error(`google_calendar_request_failed_${response.status}`);
    const payload = (await response.json()) as {
      calendars?: { primary?: { busy?: { start: string; end: string }[] } };
    };
    return { busySlots: payload.calendars?.primary?.busy ?? [] };
  }

  async createEvent(params: CalendarEventParameters): Promise<{ eventId: string }> {
    const result = await this.request<{ id?: string }>("/events", "POST", {
      summary: params.summary,
      start: { dateTime: params.start },
      end: { dateTime: params.end },
      attendees: params.attendees?.map((email) => ({ email })),
      sendUpdates: params.attendees?.length ? "all" : "none",
    });
    if (!result.id) throw new Error("google_calendar_event_id_missing");
    return { eventId: result.id };
  }

  async updateEvent(
    eventId: string,
    params: { summary?: string; start?: string; end?: string },
  ): Promise<{ eventId: string }> {
    const result = await this.request<{ id?: string }>(
      `/events/${encodeURIComponent(eventId)}`,
      "PATCH",
      {
        summary: params.summary,
        start: params.start ? { dateTime: params.start } : undefined,
        end: params.end ? { dateTime: params.end } : undefined,
      },
    );
    if (!result.id) throw new Error("google_calendar_event_id_missing");
    return { eventId: result.id };
  }

  async cancelEvent(eventId: string): Promise<{ cancelled: boolean }> {
    const token = await this.tokenSource.getAccessToken(this.employeeId);
    const response = await this.fetchImpl(`${this.baseUrl}/events/${encodeURIComponent(eventId)}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok && response.status !== 404)
      throw new Error(`google_calendar_request_failed_${response.status}`);
    return { cancelled: true };
  }

  private async request<T>(
    path: string,
    method: string,
    body: Record<string, unknown>,
  ): Promise<T> {
    const token = await this.tokenSource.getAccessToken(this.employeeId);
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error(`google_calendar_request_failed_${response.status}`);
    return (await response.json()) as T;
  }
}

function encodeRawMessage(params: GmailDraftParameters): string {
  const raw = `To: ${params.to}\r\nSubject: ${params.subject}\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n${params.body}`;
  return Buffer.from(raw, "utf8").toString("base64url");
}
