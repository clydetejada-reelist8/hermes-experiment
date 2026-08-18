import { describe, expect, it } from "vitest";
import { ControlPlaneClient } from "./api-client.js";
import { handleAskThreadMessage, type AskThreadMessage } from "./index.js";

function message(overrides: Partial<AskThreadMessage> = {}): AskThreadMessage {
  return {
    id: "message-1",
    content: "What is the process?",
    author: { bot: false, id: "discord-1" },
    channel: {
      id: "thread-1",
      parentId: "ask-channel",
      isThread: () => true,
      send: async () => undefined,
    },
    ...overrides,
  };
}

describe("Discord Ask thread handler", () => {
  it("calls the Control Plane and posts the cited answer", async () => {
    const sent: string[] = [];
    const input = message({ channel: { ...message().channel, send: async (content) => sent.push(content) } });
    const client = new ControlPlaneClient({
      baseUrl: "http://control-plane.test",
      token: "token",
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            status: "SUPPORTED",
            text: "The process is documented.",
            citations: [{ label: "Sales SOP v1" }],
            limitations: [],
            conflictChunkIds: [],
          }),
          { status: 200 },
        ),
    });

    await expect(handleAskThreadMessage(input, client, "ask-channel")).resolves.toBe(true);
    expect(sent).toEqual(["The process is documented.\n\nSources: Sales SOP v1"]);
  });

  it("does not process messages outside the approved Ask channel", async () => {
    const input = message({ channel: { ...message().channel, parentId: "other-channel" } });
    const client = new ControlPlaneClient({
      baseUrl: "http://control-plane.test",
      token: "token",
      fetchImpl: async () => {
        throw new Error("must not call Control Plane");
      },
    });

    await expect(handleAskThreadMessage(input, client, "ask-channel")).resolves.toBe(false);
  });
});
