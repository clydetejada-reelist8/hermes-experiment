import { describe, expect, it } from "vitest";
import { ControlPlaneClient } from "./api-client.js";

describe("ControlPlaneClient", () => {
  it("sends the Discord identity and Ask payload to the control plane", async () => {
    let request: Request | undefined;
    const client = new ControlPlaneClient({
      baseUrl: "http://control-plane.test",
      token: "internal-token",
      fetchImpl: async (input, init) => {
        request = new Request(input, init);
        return new Response(
          JSON.stringify({
            status: "SUPPORTED",
            text: "Answer",
            citations: [],
            limitations: [],
            conflictChunkIds: [],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      },
    });

    const result = await client.ask({
      discordUserId: "discord-1",
      conversationId: "thread-1",
      messageId: "message-1",
      text: "What is the process?",
    });

    expect(result.status).toBe("SUPPORTED");
    expect(request?.url).toBe("http://control-plane.test/v1/ask");
    expect(request?.headers.get("authorization")).toBe("Bearer internal-token");
    expect(await request?.json()).toEqual({
      discordUserId: "discord-1",
      conversationId: "thread-1",
      messageId: "message-1",
      text: "What is the process?",
    });
  });

  it("surfaces control-plane failures without pretending to answer", async () => {
    const client = new ControlPlaneClient({
      baseUrl: "http://control-plane.test/",
      token: "internal-token",
      fetchImpl: async () => new Response(JSON.stringify({ error: "identity_denied" }), { status: 403 }),
    });

    await expect(
      client.ask({
        discordUserId: "discord-1",
        conversationId: "thread-1",
        messageId: "message-1",
        text: "Private question",
      }),
    ).rejects.toThrow("identity_denied");
  });
});
