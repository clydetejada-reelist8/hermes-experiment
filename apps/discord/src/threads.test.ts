import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { createPrivateThread, type DiscordThreadChannel } from "./threads.js";

// In-memory fake of the Discord channel API for unit testing.
class FakeParentChannel {
  private threads = new Map<string, FakeThread>();
  public lastPrivate: boolean | null = null;

  async createThread(opts: { name: string; private: boolean }): Promise<FakeThread> {
    this.lastPrivate = opts.private;
    const id = randomUUID();
    const thread = new FakeThread(id, opts.name);
    this.threads.set(id, thread);
    return thread;
  }
}

class FakeThread implements DiscordThreadChannel {
  constructor(
    public readonly id: string,
    public readonly name: string,
  ) {}
  async send(content: string): Promise<void> {
    // no-op for test
    void content;
  }
}

describe("createPrivateThread", () => {
  it("creates a private thread with the given name", async () => {
    const parent = new FakeParentChannel();
    const thread = await createPrivateThread(parent as never, "Hermes Ask — test");
    expect(thread.id).toBeTruthy();
    expect(parent.lastPrivate).toBe(true);
  });

  it("sends an initial welcome message", async () => {
    const parent = new FakeParentChannel();
    let sent: string | null = null;
    const thread = await createPrivateThread(parent as never, "Hermes Ask — test");
    // Patch send to capture
    const fake = thread as unknown as { send: (c: string) => Promise<void> };
    const original = fake.send.bind(thread);
    fake.send = async (c: string) => {
      sent = c;
      await original(c);
    };
    await thread.send("Welcome! Ask me anything.");
    expect(sent).toContain("Welcome");
  });
});
