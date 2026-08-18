import { ChannelType, Client, GatewayIntentBits, type Channel, type Message, type TextChannel } from "discord.js";
import { ControlPlaneClient } from "./api-client.js";
import { loadConfig } from "@hermes/config";
import { tryClaimInboundEvent } from "./dedup.js";
import {
  createPrivateThread,
  type DiscordParentChannel,
  type DiscordThreadChannel,
} from "./threads.js";

export { tryClaimInboundEvent } from "./dedup.js";
export { createPrivateThread } from "./threads.js";
export { classifyDiscordMessage } from "./routing.js";
export type { DiscordThreadChannel, DiscordParentChannel } from "./threads.js";
export type {
  DiscordChannelConfig,
  DiscordMessageKind,
  DiscordMessageRoute,
  DiscordMessageRouteInput,
} from "./routing.js";

export interface AskThreadMessage {
  id: string;
  content: string;
  author: { bot: boolean; id: string };
  channel: {
    id: string;
    isThread(): boolean;
    parentId: string | null;
    send(content: string): Promise<unknown>;
  };
}

export async function handleAskThreadMessage(
  message: AskThreadMessage,
  client: ControlPlaneClient,
  askChannelId?: string,
): Promise<boolean> {
  if (message.author.bot || !message.content.trim() || !message.channel.isThread()) return false;
  if (askChannelId && message.channel.parentId !== askChannelId) return false;

  try {
    const result = await client.ask({
      discordUserId: message.author.id,
      conversationId: message.channel.id,
      messageId: message.id,
      text: message.content,
    });
    const citations = result.citations.length > 0
      ? `\n\nSources: ${result.citations.map((citation) => formatCitation(citation)).join(", ")}`
      : "";
    await message.channel.send(`${result.text}${citations}`);
  } catch (error) {
    const reason = error instanceof Error ? error.message : "control_plane_request_failed";
    await message.channel.send(`I couldn't process that request: ${reason}`);
  }
  return true;
}

function formatCitation(citation: unknown): string {
  if (typeof citation === "object" && citation !== null && "label" in citation) {
    const label = (citation as { label?: unknown }).label;
    if (typeof label === "string") return label;
  }
  return "source unavailable";
}

/**
 * Adapter that wraps a discord.js TextChannel to satisfy
 * {@link DiscordParentChannel}.
 */
class DiscordJsParentAdapter implements DiscordParentChannel {
  constructor(private readonly channel: TextChannel) {}

  async createThread(opts: { name: string; private: boolean }): Promise<DiscordThreadChannel> {
    const thread = await this.channel.threads.create({
      name: opts.name,
      type: opts.private ? ChannelType.PrivateThread : ChannelType.PublicThread,
    });
    return {
      id: thread.id,
      name: thread.name,
      async send(content: string) {
        await thread.send(content);
      },
    };
  }
}

async function start(): Promise<void> {
  const cfg = loadConfig(process.env);
  const controlPlane = new ControlPlaneClient({
    baseUrl: process.env.REELIST8_CONTROL_PLANE_URL ?? "http://127.0.0.1:3000",
    token: cfg.internalServiceToken,
  });
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ],
  });

  client.on("messageCreate", async (message: Message) => {
    const claim = await tryClaimInboundEvent("DISCORD", message.id, "MESSAGE");
    if (claim.alreadyProcessed) return;
    await handleAskThreadMessage(
      message as unknown as AskThreadMessage,
      controlPlane,
      cfg.discordAskChannelId,
    );
  });

  client.on("interactionCreate", async (interaction) => {
    if (!interaction.isChatInputCommand()) return;
    const eventId = interaction.id;
    const claim = await tryClaimInboundEvent("DISCORD", eventId, "INTERACTION");
    if (claim.alreadyProcessed) return;

    if (interaction.commandName === "ask") {
      const channel = interaction.channel as Channel | null;
      if (channel?.isTextBased()) {
        const parent = new DiscordJsParentAdapter(channel as TextChannel);
        const thread = await createPrivateThread(parent, "Hermes Ask");
        await thread.send("Welcome! Ask me anything about REELIST8.");
      }
    }
    await interaction.reply({ content: "Started a private thread.", ephemeral: true });
  });

  await client.login(cfg.discordBotToken);
}

// Start when run directly.
if (import.meta.url === `file://${process.argv[1]}`) {
  start().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
