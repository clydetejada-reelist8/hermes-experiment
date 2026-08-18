export interface AskClientInput {
  discordUserId: string;
  conversationId: string;
  messageId: string;
  text: string;
}

export interface AskClientResult {
  status: string;
  text: string;
  citations: unknown[];
  limitations: string[];
  conflictChunkIds: string[];
}

export interface ControlPlaneClientOptions {
  baseUrl: string;
  token: string;
  fetchImpl?: typeof fetch;
}

export class ControlPlaneClient {
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: ControlPlaneClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.token = options.token;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async ask(input: AskClientInput): Promise<AskClientResult> {
    const response = await this.fetchImpl(`${this.baseUrl}/v1/ask`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(input),
    });

    const payload = (await response.json()) as Record<string, unknown>;
    if (!response.ok) {
      const error =
        typeof payload.error === "string" ? payload.error : "control_plane_request_failed";
      throw new Error(error);
    }

    return payload as unknown as AskClientResult;
  }
}
