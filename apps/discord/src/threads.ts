/**
 * Minimal interface for a Discord thread channel that Hermes needs.
 * This abstracts away discord.js so the thread-creation logic is unit-testable
 * without a real Discord connection.
 */
export interface DiscordThreadChannel {
  readonly id: string;
  readonly name: string;
  send(content: string): Promise<void>;
}

export interface DiscordParentChannel {
  createThread(opts: { name: string; private: boolean }): Promise<DiscordThreadChannel>;
}

/**
 * Create a private Discord thread for a Hermes Ask conversation.
 *
 * Private threads ensure that only the initiating employee and Hermes can see
 * the conversation — other employees in the guild cannot read the thread. This
 * is the privacy boundary for all Ask conversations.
 */
export async function createPrivateThread(
  parent: DiscordParentChannel,
  name: string,
): Promise<DiscordThreadChannel> {
  return parent.createThread({ name, private: true });
}
