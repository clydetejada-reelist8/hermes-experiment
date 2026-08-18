import { ChannelType, Client, GatewayIntentBits, type Channel, type TextChannel } from "discord.js";
import { loadConfig } from "@hermes/config";
import { tryClaimInboundEvent } from "./dedup.js";
import {
  createPrivateThread,
  type DiscordParentChannel,
  type DiscordThreadChannel,
} from "./threads.js";

export { tryClaimInboundEvent } from "./dedup.js";
export { createPrivateThread } from "./threads.js";
export type { DiscordThreadChannel, DiscordParentChannel } from "./threads.js";

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
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ],
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
