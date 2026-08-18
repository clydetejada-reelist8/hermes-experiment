#!/usr/bin/env tsx
/**
 * Register all Hermes slash commands with the Discord REST API.
 *
 * Usage:
 *   pnpm tsx scripts/register-discord-commands.ts
 *
 * This registers guild-scoped commands for the configured guild. Guild
 * commands are available immediately (no 1-hour propagation delay) which is
 * ideal for staging.
 */
import { REST, Routes, SlashCommandBuilder, SlashCommandSubcommandBuilder } from "discord.js";
import { loadConfig } from "@hermes/config";

/**
 * Build the full set of Hermes slash commands as raw JSON bodies.
 *
 * Commands:
 *   /ask             — Ask Hermes a question (required query, optional audience)
 *   /upload          — Upload a file as an artifact (required file attachment)
 *   /memory          — Manage personal memories (list / add / delete)
 *   /connect-google  — Initiate the Google OAuth flow
 *   /help            — Show help for all commands
 *   /ssot            — SSOT proposal management (propose / list / approve / reject / request-changes)
 */
function buildCommands() {
  const ask = new SlashCommandBuilder()
    .setName("ask")
    .setDescription("Ask Hermes a question")
    .addStringOption((opt) =>
      opt.setName("query").setDescription("Your question for Hermes").setRequired(true),
    )
    .addStringOption((opt) =>
      opt
        .setName("audience")
        .setDescription("Who can see this conversation (default: PRIVATE)")
        .setRequired(false)
        .addChoices(
          { name: "PRIVATE", value: "PRIVATE" },
          { name: "TEAM", value: "TEAM" },
          { name: "COMPANY", value: "COMPANY" },
        ),
    );

  const upload = new SlashCommandBuilder()
    .setName("upload")
    .setDescription("Upload a file as an artifact")
    .addAttachmentOption((opt) =>
      opt.setName("file").setDescription("The file to upload").setRequired(true),
    );

  const memoryList = new SlashCommandSubcommandBuilder()
    .setName("list")
    .setDescription("List your personal memories");

  const memoryAdd = new SlashCommandSubcommandBuilder()
    .setName("add")
    .setDescription("Add a personal memory")
    .addStringOption((opt) =>
      opt.setName("content").setDescription("The memory content").setRequired(true),
    )
    .addStringOption((opt) =>
      opt
        .setName("type")
        .setDescription("The memory type")
        .setRequired(true)
        .addChoices(
          { name: "PREFERENCE", value: "PREFERENCE" },
          { name: "RESPONSIBILITY", value: "RESPONSIBILITY" },
          { name: "ACTIVE_PROJECT", value: "ACTIVE_PROJECT" },
          { name: "COLLABORATOR", value: "COLLABORATOR" },
          { name: "COMMITMENT", value: "COMMITMENT" },
          { name: "PERSONAL_NOTE", value: "PERSONAL_NOTE" },
        ),
    );

  const memoryDelete = new SlashCommandSubcommandBuilder()
    .setName("delete")
    .setDescription("Delete a personal memory")
    .addStringOption((opt) =>
      opt.setName("id").setDescription("The memory ID to delete").setRequired(true),
    );

  const memory = new SlashCommandBuilder()
    .setName("memory")
    .setDescription("Manage your personal memories")
    .addSubcommand(memoryList)
    .addSubcommand(memoryAdd)
    .addSubcommand(memoryDelete);

  const connectGoogle = new SlashCommandBuilder()
    .setName("connect-google")
    .setDescription("Connect your Google account to Hermes");

  const help = new SlashCommandBuilder()
    .setName("help")
    .setDescription("Show help for all Hermes commands");

  const ssotPropose = new SlashCommandSubcommandBuilder()
    .setName("propose")
    .setDescription("Propose a new SSOT entry")
    .addStringOption((opt) =>
      opt.setName("domain").setDescription("The authority domain").setRequired(true),
    )
    .addStringOption((opt) =>
      opt.setName("title").setDescription("The proposal title").setRequired(true),
    )
    .addStringOption((opt) =>
      opt.setName("content").setDescription("The proposed content").setRequired(true),
    );

  const ssotList = new SlashCommandSubcommandBuilder()
    .setName("list")
    .setDescription("List SSOT proposals for a domain")
    .addStringOption((opt) =>
      opt.setName("domain").setDescription("The authority domain").setRequired(true),
    );

  const ssotApprove = new SlashCommandSubcommandBuilder()
    .setName("approve")
    .setDescription("Approve an SSOT proposal")
    .addStringOption((opt) =>
      opt.setName("id").setDescription("The proposal ID to approve").setRequired(true),
    );

  const ssotReject = new SlashCommandSubcommandBuilder()
    .setName("reject")
    .setDescription("Reject an SSOT proposal")
    .addStringOption((opt) =>
      opt.setName("id").setDescription("The proposal ID to reject").setRequired(true),
    );

  const ssotRequestChanges = new SlashCommandSubcommandBuilder()
    .setName("request-changes")
    .setDescription("Request changes on an SSOT proposal")
    .addStringOption((opt) =>
      opt.setName("id").setDescription("The proposal ID to request changes on").setRequired(true),
    );

  const ssot = new SlashCommandBuilder()
    .setName("ssot")
    .setDescription("Manage SSOT proposals")
    .addSubcommand(ssotPropose)
    .addSubcommand(ssotList)
    .addSubcommand(ssotApprove)
    .addSubcommand(ssotReject)
    .addSubcommand(ssotRequestChanges);

  return [ask, upload, memory, connectGoogle, help, ssot].map((cmd) => cmd.toJSON());
}

async function main(): Promise<void> {
  const cfg = loadConfig(process.env);

  const rest = new REST({ version: "10" }).setToken(cfg.discordBotToken);

  const commands = buildCommands();

  console.log(`Registering ${commands.length} commands for guild ${cfg.discordGuildId}...`);

  await rest.put(Routes.applicationGuildCommands(cfg.discordApplicationId, cfg.discordGuildId), {
    body: commands,
  });

  console.log("Successfully registered application commands.");
}

main().catch((err) => {
  console.error("Failed to register commands:", err);
  process.exit(1);
});
