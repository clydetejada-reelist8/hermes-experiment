import {
  ChannelType,
  Client,
  GatewayIntentBits,
  type Channel,
  type Guild,
  type TextChannel,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type Message,
} from "discord.js";
import { loadConfig, type AppConfig } from "@hermes/config";
import { createOpenAIProviders, type LLMClient } from "@hermes/llm";
import type { EmbeddingFunction } from "@hermes/knowledge";
import { tryClaimInboundEvent } from "./dedup.js";
import {
  createPrivateThread,
  type DiscordParentChannel,
  type DiscordThreadChannel,
} from "./threads.js";
import { AskOrchestrator } from "./ask.js";
import { resolveDiscordEmployee, IdentityDeniedError } from "@hermes/identity";
import { db } from "@hermes/db";
import { addMemory, getMemories, deleteMemory } from "@hermes/memory";
import {
  createProposal,
  getProposalsByDomain,
  approveProposal,
  rejectProposal,
  requestChanges,
  deliverSSOTReview,
  type DiscordReviewClient,
} from "@hermes/ssot";
import { createOAuthState } from "@hermes/google";
import { ingestImportedFile, ArtifactValidationError } from "@hermes/artifacts";
import { ObjectStorage } from "@hermes/storage";
import {
  transitionAction,
  getAction,
  recordConfirmation,
  GmailActionExecutor,
  CalendarActionExecutor,
  type GmailProvider,
  type CalendarProvider,
} from "@hermes/actions";
import { isKillSwitchActive, isFeatureEnabled } from "@hermes/admin";
import { audit } from "@hermes/audit";
import { structuredLogger } from "@hermes/observability";
import { randomUUID } from "node:crypto";

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

/**
 * Adapter that wraps a discord.js Client + Guild to satisfy
 * {@link DiscordReviewClient} for SSOT review delivery.
 *
 * Creates a private thread in the guild and adds the specified participants.
 * The participantIds are *employee IDs* — the wrapper resolves them to Discord
 * user IDs via the ExternalIdentity table before adding them to the thread.
 */
class DiscordReviewClientWrapper implements DiscordReviewClient {
  constructor(
    private readonly client: Client,
    private readonly guild: Guild,
  ) {}

  async createPrivateThread(name: string, participantIds: string[]): Promise<{ threadId: string }> {
    // Use the system channel or the first available text channel as the
    // parent for the private thread. Private threads require a parent text
    // channel in guilds.
    const parent =
      this.guild.systemChannel ??
      (this.guild.channels.cache.find((c) => c.isTextBased()) as TextChannel | undefined);
    if (!parent) {
      throw new Error("no text channel available to create review thread");
    }

    const thread = await parent.threads.create({
      name,
      type: ChannelType.PrivateThread,
    });

    // Resolve employee IDs to Discord user IDs via ExternalIdentity.
    const identities = await db.externalIdentity.findMany({
      where: {
        employeeId: { in: participantIds },
        provider: "DISCORD",
      },
    });
    const discordUserIds = identities.map(
      (i: { providerSubjectId: string }) => i.providerSubjectId,
    );

    // Add each participant to the private thread.
    for (const discordUserId of discordUserIds) {
      try {
        await thread.members.add(discordUserId);
      } catch {
        // If a member cannot be added (e.g. not in the guild), skip silently.
      }
    }

    return { threadId: thread.id };
  }

  async sendMessage(threadId: string, content: string, components?: unknown[]): Promise<void> {
    const thread = await this.client.channels.fetch(threadId);
    if (!thread?.isTextBased()) {
      throw new Error(`thread ${threadId} not found or not text-based`);
    }
    await (thread as TextChannel).send({
      content,
      // discord.js accepts raw API component objects when passed as components.
      components: components as never,
    });
  }
}

// Custom button IDs (Section 24)
const BUTTON_IDS = {
  confirmAction: "confirm_action",
  cancelAction: "cancel_action",
  approveProposal: "approve_proposal",
  rejectProposal: "reject_proposal",
  requestChanges: "request_changes",
} as const;

// Custom modal IDs (reserved for future modal-based flows)
// const MODAL_IDS = { ... } as const;

/**
 * Commands that are allowed in either Hermes channel (ask or upload).
 * These are not restricted to a single channel.
 */
const EITHER_CHANNEL_COMMANDS = new Set(["memory", "connect-google", "help", "ssot"]);

/**
 * Check whether a slash command is allowed in the given channel.
 *
 * `/ask` is only allowed in the configured ask channel, `/upload` is only
 * allowed in the configured upload channel, and all other commands work in
 * either channel.
 */
function isAllowedChannel(channelId: string, command: string, cfg: AppConfig): boolean {
  if (command === "ask") {
    return channelId === cfg.discordAskChannelId;
  }
  if (command === "upload") {
    return channelId === cfg.discordUploadChannelId;
  }
  return EITHER_CHANNEL_COMMANDS.has(command);
}

export interface DiscordAppDeps {
  embeddingFn: EmbeddingFunction;
  llm: LLMClient;
  gmailProvider: GmailProvider;
  calendarProvider: CalendarProvider;
  storage: ObjectStorage;
  bucket: string;
}

/**
 * Handle the /ask slash command.
 * Creates a private thread and starts the Ask flow.
 */
async function handleAskCommand(
  interaction: ChatInputCommandInteraction,
  deps: DiscordAppDeps,
): Promise<void> {
  const query = interaction.options.getString("query", true);
  const audience = (interaction.options.getString("audience") ?? "PRIVATE") as
    "PRIVATE" | "TEAM" | "COMPANY";

  // Resolve the employee from the Discord user ID
  let employee;
  try {
    employee = await resolveDiscordEmployee(interaction.user.id);
  } catch (err) {
    if (err instanceof IdentityDeniedError) {
      await interaction.reply({
        content: `Access denied: ${err.message}`,
        ephemeral: true,
      });
      return;
    }
    throw err;
  }

  // Check the kill switch
  if (await isKillSwitchActive()) {
    await interaction.reply({
      content: "Hermes is currently disabled. Please try again later.",
      ephemeral: true,
    });
    return;
  }

  // Check the ask feature flag
  if (!(await isFeatureEnabled("ask_enabled"))) {
    await interaction.reply({
      content: "The Ask feature is currently disabled.",
      ephemeral: true,
    });
    return;
  }

  // Create a private thread for the conversation
  const channel = interaction.channel as Channel | null;
  if (!channel?.isTextBased()) {
    await interaction.reply({
      content: "This command can only be used in a text channel.",
      ephemeral: true,
    });
    return;
  }

  const parent = new DiscordJsParentAdapter(channel as TextChannel);
  const shortId = randomUUID().slice(0, 8);
  const threadName = `hermes-ask-${shortId}`;
  const thread = await createPrivateThread(parent, threadName);
  const conversationId = randomUUID();

  await interaction.reply({
    content: `Started a private thread: ${thread.name}`,
    ephemeral: true,
  });

  // Run the Ask orchestrator
  const orchestrator = new AskOrchestrator({
    embeddingFn: deps.embeddingFn,
    llm: deps.llm,
  });

  const result = await orchestrator.ask({
    employeeId: employee.id,
    employeeName: employee.displayName,
    query,
    conversationId,
    audience,
    discordThreadId: thread.id,
    discordGuildId: interaction.guildId ?? undefined,
    discordParentChannelId: interaction.channelId,
  });

  // Send the answer to the thread
  if (result.status === "ANSWERED" && result.answer) {
    const citationList =
      result.citations.length > 0 ? `\n\n**Citations:** ${result.citations.length} source(s)` : "";
    await thread.send(`${result.answer}${citationList}`);
  } else if (result.status === "NO_CONTEXT") {
    await thread.send("I don't have enough context to answer that question.");
  } else if (result.status === "EGRESS_BLOCKED") {
    await thread.send("I generated an answer but it was blocked by the security layer.");
  } else if (result.status === "CITATION_INVALID") {
    await thread.send("I generated an answer but the citations could not be verified.");
  } else if (result.status === "INJECTION_DETECTED") {
    await thread.send("Your query was blocked by the security layer.");
  } else if (result.status === "KILL_SWITCH_ACTIVE") {
    await thread.send("Hermes is currently disabled.");
  } else if (result.status === "FEATURE_DISABLED") {
    await thread.send("The Ask feature is currently disabled.");
  }
}

/**
 * Handle the /memory slash command.
 * Allows employees to add, list, or delete personal memories.
 */
async function handleMemoryCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  const subcommand = interaction.options.getSubcommand();

  let employee;
  try {
    employee = await resolveDiscordEmployee(interaction.user.id);
  } catch (err) {
    if (err instanceof IdentityDeniedError) {
      await interaction.reply({
        content: `Access denied: ${err.message}`,
        ephemeral: true,
      });
      return;
    }
    throw err;
  }

  if (subcommand === "list") {
    const memories = await getMemories(employee.id);
    if (memories.length === 0) {
      await interaction.reply({
        content: "You have no personal memories.",
        ephemeral: true,
      });
      return;
    }
    const memoryList = memories.map((m) => `• [${m.type}] ${m.content.slice(0, 80)}...`).join("\n");
    await interaction.reply({
      content: `Your memories:\n${memoryList}`,
      ephemeral: true,
    });
  } else if (subcommand === "add") {
    const content = interaction.options.getString("content", true);
    const type = interaction.options.getString("type", true) as
      | "PREFERENCE"
      | "RESPONSIBILITY"
      | "ACTIVE_PROJECT"
      | "COLLABORATOR"
      | "COMMITMENT"
      | "PERSONAL_NOTE";

    if (!(await isFeatureEnabled("memory_enabled"))) {
      await interaction.reply({
        content: "Memory is currently disabled.",
        ephemeral: true,
      });
      return;
    }

    const memory = await addMemory({
      employeeId: employee.id,
      content,
      type,
    });

    if (!memory) {
      await interaction.reply({
        content: "Memory was rejected by the policy layer (sensitive content).",
        ephemeral: true,
      });
      return;
    }

    await audit({
      type: "MEMORY_CREATED",
      employeeId: employee.id,
      resourceType: "PersonalMemory",
      resourceId: memory.id,
    });

    await interaction.reply({
      content: "Memory added successfully.",
      ephemeral: true,
    });
  } else if (subcommand === "delete") {
    const memoryId = interaction.options.getString("id", true);
    await deleteMemory(memoryId);
    await audit({
      type: "MEMORY_DELETED",
      employeeId: employee.id,
      resourceType: "PersonalMemory",
      resourceId: memoryId,
    });
    await interaction.reply({
      content: "Memory deleted.",
      ephemeral: true,
    });
  }
}

/**
 * Handle the /ssot slash command.
 * Allows employees to propose SSOT changes.
 */
async function handleSsotCommand(
  interaction: ChatInputCommandInteraction,
  client: Client,
): Promise<void> {
  const subcommand = interaction.options.getSubcommand();

  let employee;
  try {
    employee = await resolveDiscordEmployee(interaction.user.id);
  } catch (err) {
    if (err instanceof IdentityDeniedError) {
      await interaction.reply({
        content: `Access denied: ${err.message}`,
        ephemeral: true,
      });
      return;
    }
    throw err;
  }

  if (subcommand === "propose") {
    const domain = interaction.options.getString("domain", true);
    const title = interaction.options.getString("title", true);
    const content = interaction.options.getString("content", true);

    if (!(await isFeatureEnabled("ssot_enabled"))) {
      await interaction.reply({
        content: "SSOT is currently disabled.",
        ephemeral: true,
      });
      return;
    }

    try {
      const proposal = await createProposal({
        proposedByEmployeeId: employee.id,
        authorityDomain: domain,
        title,
        proposedContent: content,
      });

      // Deliver the proposal for review (Section 16.4). The Discord app has
      // access to the discord.js client, so it wraps it for the ssot package.
      const guild = interaction.guild;
      if (guild) {
        const reviewClient = new DiscordReviewClientWrapper(client, guild);
        try {
          await deliverSSOTReview({
            proposalId: proposal.id,
            domain,
            proposedContent: content,
            proposerEmployeeId: employee.id,
            discordGuildId: guild.id,
            discordClient: reviewClient,
          });
        } catch (reviewErr) {
          const reviewMessage = reviewErr instanceof Error ? reviewErr.message : "internal error";
          structuredLogger.error("ssot_review_delivery_failed", {
            proposalId: proposal.id,
            error: reviewMessage,
          });
          await interaction.reply({
            content: `SSOT proposal created: ${proposal.title} (ID: ${proposal.id}), but review delivery failed: ${reviewMessage}`,
            ephemeral: true,
          });
          return;
        }
      }

      await interaction.reply({
        content: `SSOT proposal created: ${proposal.title} (ID: ${proposal.id})`,
        ephemeral: true,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "internal error";
      await interaction.reply({
        content: `Proposal failed: ${message}`,
        ephemeral: true,
      });
    }
  } else if (subcommand === "list") {
    const domain = interaction.options.getString("domain", true);
    const proposals = await getProposalsByDomain(domain);
    if (proposals.length === 0) {
      await interaction.reply({
        content: `No proposals for domain ${domain}.`,
        ephemeral: true,
      });
      return;
    }
    const proposalList = proposals
      .map((p) => `• [${p.status}] ${p.title} (ID: ${p.id})`)
      .join("\n");
    await interaction.reply({
      content: `Proposals for ${domain}:\n${proposalList}`,
      ephemeral: true,
    });
  } else if (subcommand === "approve") {
    const proposalId = interaction.options.getString("id", true);

    if (!(await isFeatureEnabled("ssot_enabled"))) {
      await interaction.reply({
        content: "SSOT is currently disabled.",
        ephemeral: true,
      });
      return;
    }

    try {
      const result = await approveProposal({
        proposalId,
        approvedByEmployeeId: employee.id,
      });
      await interaction.reply({
        content: `Proposal approved: ${result.proposal.title}. New SSOT version created.`,
        ephemeral: true,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "internal error";
      await interaction.reply({
        content: `Approval failed: ${message}`,
        ephemeral: true,
      });
    }
  } else if (subcommand === "reject") {
    const proposalId = interaction.options.getString("id", true);

    if (!(await isFeatureEnabled("ssot_enabled"))) {
      await interaction.reply({
        content: "SSOT is currently disabled.",
        ephemeral: true,
      });
      return;
    }

    try {
      const proposal = await rejectProposal({
        proposalId,
        rejectedByEmployeeId: employee.id,
      });
      await interaction.reply({
        content: `Proposal rejected: ${proposal.title}.`,
        ephemeral: true,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "internal error";
      await interaction.reply({
        content: `Rejection failed: ${message}`,
        ephemeral: true,
      });
    }
  } else if (subcommand === "request-changes") {
    const proposalId = interaction.options.getString("id", true);

    if (!(await isFeatureEnabled("ssot_enabled"))) {
      await interaction.reply({
        content: "SSOT is currently disabled.",
        ephemeral: true,
      });
      return;
    }

    try {
      const proposal = await requestChanges({
        proposalId,
        reviewedByEmployeeId: employee.id,
      });
      await interaction.reply({
        content: `Changes requested on proposal: ${proposal.title}.`,
        ephemeral: true,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "internal error";
      await interaction.reply({
        content: `Request changes failed: ${message}`,
        ephemeral: true,
      });
    }
  }
}

/**
 * Handle the /upload slash command.
 *
 * Per Section 3.2, /upload creates a private thread and instructs the user
 * to post their file or Google Drive link there. The actual file processing
 * happens when a message with an attachment is posted in the upload thread
 * (see {@link handleUploadThreadMessage}).
 */
async function handleUploadCommand(
  interaction: ChatInputCommandInteraction,
  _deps: DiscordAppDeps,
): Promise<void> {
  let employee;
  try {
    employee = await resolveDiscordEmployee(interaction.user.id);
  } catch (err) {
    if (err instanceof IdentityDeniedError) {
      await interaction.reply({
        content: `Access denied: ${err.message}`,
        ephemeral: true,
      });
      return;
    }
    throw err;
  }

  if (!(await isFeatureEnabled("uploads_enabled"))) {
    await interaction.reply({
      content: "Uploads are currently disabled.",
      ephemeral: true,
    });
    return;
  }

  // Create a private thread for the upload conversation
  const channel = interaction.channel as Channel | null;
  if (!channel?.isTextBased()) {
    await interaction.reply({
      content: "This command can only be used in a text channel.",
      ephemeral: true,
    });
    return;
  }

  const parent = new DiscordJsParentAdapter(channel as TextChannel);
  const shortId = randomUUID().slice(0, 8);
  const threadName = `hermes-upload-${shortId}`;
  const thread = await createPrivateThread(parent, threadName);

  // Create the conversation record so follow-up messages can be routed
  const conversationId = randomUUID();
  await db.conversation.create({
    data: {
      id: conversationId,
      initiatorEmployeeId: employee.id,
      conversationType: "UPLOAD",
      audienceClassification: "PRIVATE",
      discordThreadId: thread.id,
      discordGuildId: interaction.guildId ?? undefined,
      discordParentChannelId: interaction.channelId,
    },
  });

  await interaction.reply({
    content: `Started a private upload thread: ${thread.name}. Post your file or Google Drive link there.`,
    ephemeral: true,
  });
}

/**
 * Handle messages posted in upload threads.
 *
 * When a user posts a message with an attachment in an UPLOAD conversation
 * thread, the attachment is ingested as an artifact. This mirrors how
 * {@link handleThreadMessage} processes Ask follow-ups.
 */
async function handleUploadThreadMessage(message: Message, deps: DiscordAppDeps): Promise<void> {
  // Ignore bot messages
  if (message.author.bot) return;

  // Only process messages in threads
  if (!message.channel.isThread()) return;

  // Check if this thread is an UPLOAD conversation
  const conversation = await db.conversation.findFirst({
    where: { discordThreadId: message.channel.id },
  });
  if (!conversation || conversation.conversationType !== "UPLOAD") return;

  // Resolve the employee
  let employee;
  try {
    employee = await resolveDiscordEmployee(message.author.id);
  } catch {
    return; // Ignore messages from non-employees
  }

  if (!(await isFeatureEnabled("uploads_enabled"))) {
    await message.reply("Uploads are currently disabled.");
    return;
  }

  // Process each attachment on the message
  const attachments = [...message.attachments.values()];
  if (attachments.length === 0) {
    await message.reply("Please attach a file or paste a Google Drive link to upload.");
    return;
  }

  for (const attachment of attachments) {
    const response = await fetch(attachment.url);
    const content = Buffer.from(await response.arrayBuffer());

    try {
      const result = await ingestImportedFile({
        storage: deps.storage,
        bucket: deps.bucket,
        submittedByEmployeeId: employee.id,
        originalFilename: attachment.name,
        mimeType: attachment.contentType ?? "application/octet-stream",
        content,
        sourceSystem: "DISCORD_UPLOAD",
        externalId: attachment.id,
      });

      await audit({
        type: "ARTIFACT_RECEIVED",
        employeeId: employee.id,
        resourceType: "Artifact",
        resourceId: result.artifact.id,
        metadata: { filename: attachment.name, size: attachment.size },
      });

      await message.reply(
        `File uploaded and indexed: ${attachment.name} (artifact ID: ${result.artifact.id})`,
      );
    } catch (err) {
      if (err instanceof ArtifactValidationError) {
        await message.reply(`Upload rejected: ${err.message}`);
        continue;
      }
      throw err;
    }
  }
}

/**
 * Handle the /connect-google slash command.
 * Initiates the Google OAuth flow by creating a one-time state and replying
 * with the authorization URL.
 */
async function handleConnectGoogleCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  const cfg = loadConfig(process.env);

  let employee;
  try {
    employee = await resolveDiscordEmployee(interaction.user.id);
  } catch (err) {
    if (err instanceof IdentityDeniedError) {
      await interaction.reply({
        content: `Access denied: ${err.message}`,
        ephemeral: true,
      });
      return;
    }
    throw err;
  }

  const requestedScopes = [
    "https://www.googleapis.com/auth/gmail.modify",
    "https://www.googleapis.com/auth/calendar",
    "https://www.googleapis.com/auth/drive.readonly",
  ];

  const { state } = await createOAuthState({
    employeeId: employee.id,
    requestedScopes,
    key: cfg.tokenEncryptionKey,
  });

  const params = new URLSearchParams({
    client_id: cfg.googleClientId,
    redirect_uri: cfg.googleRedirectUri,
    response_type: "code",
    scope: requestedScopes.join(" "),
    state,
    access_type: "offline",
    prompt: "consent",
  });

  const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;

  await interaction.reply({
    content: `Connect your Google account by visiting this URL:\n${authUrl}`,
    ephemeral: true,
  });
}

/**
 * Handle the /help slash command.
 * Replies with an ephemeral message listing all commands and what they do.
 */
async function handleHelpCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  const helpText = [
    "**Hermes Commands**",
    "",
    "**/ask** `query` `[audience]` — Ask Hermes a question. Audience can be PRIVATE (default), TEAM, or COMPANY.",
    "**/upload** `file` — Start a private upload thread. Post your file or Google Drive link in the thread to ingest it as an artifact.",
    "**/memory list** — List your personal memories.",
    "**/memory add** `content` `type` — Add a personal memory (type: PREFERENCE, RESPONSIBILITY, ACTIVE_PROJECT, COLLABORATOR, COMMITMENT, PERSONAL_NOTE).",
    "**/memory delete** `id` — Delete a personal memory by ID.",
    "**/connect-google** — Connect your Google account to Hermes (Gmail, Calendar, Drive).",
    "**/ssot propose** `domain` `title` `content` — Propose a new SSOT entry.",
    "**/ssot list** `domain` — List SSOT proposals for a domain.",
    "**/ssot approve** `id` — Approve an SSOT proposal.",
    "**/ssot reject** `id` — Reject an SSOT proposal.",
    "**/ssot request-changes** `id` — Request changes on an SSOT proposal.",
    "**/help** — Show this help message.",
  ].join("\n");

  await interaction.reply({
    content: helpText,
    ephemeral: true,
  });
}

/**
 * Handle button interactions (confirm/cancel actions, approve/reject proposals).
 */
async function handleButtonInteraction(
  interaction: ButtonInteraction,
  deps: DiscordAppDeps,
): Promise<void> {
  const customId = interaction.customId;

  // Parse the custom ID to determine the action
  // Format: "confirm_action:<actionId>" or "approve_proposal:<proposalId>"
  const [action, targetId] = customId.split(":");
  if (!targetId) {
    await interaction.reply({ content: "Invalid button ID.", ephemeral: true });
    return;
  }

  if (action === BUTTON_IDS.confirmAction) {
    await handleConfirmAction(interaction, targetId, deps);
  } else if (action === BUTTON_IDS.cancelAction) {
    await handleCancelAction(interaction, targetId);
  } else if (action === BUTTON_IDS.approveProposal) {
    await handleApproveProposal(interaction, targetId);
  } else if (action === BUTTON_IDS.rejectProposal) {
    await handleRejectProposal(interaction, targetId);
  }
}

/**
 * Handle action confirmation button.
 */
async function handleConfirmAction(
  interaction: ButtonInteraction,
  actionId: string,
  deps: DiscordAppDeps,
): Promise<void> {
  let employee;
  try {
    employee = await resolveDiscordEmployee(interaction.user.id);
  } catch (err) {
    if (err instanceof IdentityDeniedError) {
      await interaction.reply({
        content: `Access denied: ${err.message}`,
        ephemeral: true,
      });
      return;
    }
    throw err;
  }

  const action = await getAction(actionId);
  if (!action) {
    await interaction.reply({ content: "Action not found.", ephemeral: true });
    return;
  }

  // Record the confirmation
  await recordConfirmation(actionId, employee.id, action.parametersJson as Record<string, unknown>);

  await audit({
    type: "ACTION_CONFIRMED",
    employeeId: employee.id,
    resourceType: "Action",
    resourceId: actionId,
  });

  // Transition to EXECUTING
  await transitionAction(actionId, "EXECUTING");

  // Execute the action based on its type
  try {
    if (action.type === "GMAIL_SEND_DRAFT") {
      const executor = new GmailActionExecutor(deps.gmailProvider);
      const result = await executor.executeSend(actionId);
      await interaction.update({
        content: `Email sent successfully (message ID: ${result.externalResourceId}).`,
        components: [],
      });
    } else if (action.type === "CALENDAR_CREATE_MEETING") {
      const executor = new CalendarActionExecutor(deps.calendarProvider);
      const result = await executor.executeCreateMeeting(actionId);
      await interaction.update({
        content: `Meeting created successfully (event ID: ${result.externalResourceId}).`,
        components: [],
      });
    } else if (action.type === "CALENDAR_CANCEL_EVENT") {
      const executor = new CalendarActionExecutor(deps.calendarProvider);
      await executor.executeCancelEvent(actionId);
      await interaction.update({
        content: `Event cancelled successfully.`,
        components: [],
      });
    } else {
      await interaction.reply({
        content: "Action confirmed. Execution will proceed in the background.",
        ephemeral: true,
      });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "internal error";
    await interaction.reply({
      content: `Action execution failed: ${message}`,
      ephemeral: true,
    });
  }
}

/**
 * Handle action cancellation button.
 */
async function handleCancelAction(interaction: ButtonInteraction, actionId: string): Promise<void> {
  await transitionAction(actionId, "CANCELLED");
  await interaction.update({
    content: "Action cancelled.",
    components: [],
  });
}

/**
 * Handle SSOT proposal approval button.
 */
async function handleApproveProposal(
  interaction: ButtonInteraction,
  proposalId: string,
): Promise<void> {
  let employee;
  try {
    employee = await resolveDiscordEmployee(interaction.user.id);
  } catch (err) {
    if (err instanceof IdentityDeniedError) {
      await interaction.reply({
        content: `Access denied: ${err.message}`,
        ephemeral: true,
      });
      return;
    }
    throw err;
  }

  try {
    const result = await approveProposal({
      proposalId,
      approvedByEmployeeId: employee.id,
    });
    await interaction.update({
      content: `Proposal approved: ${result.proposal.title}. New SSOT version created.`,
      components: [],
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "internal error";
    await interaction.reply({
      content: `Approval failed: ${message}`,
      ephemeral: true,
    });
  }
}

/**
 * Handle SSOT proposal rejection button.
 */
async function handleRejectProposal(
  interaction: ButtonInteraction,
  proposalId: string,
): Promise<void> {
  let employee;
  try {
    employee = await resolveDiscordEmployee(interaction.user.id);
  } catch (err) {
    if (err instanceof IdentityDeniedError) {
      await interaction.reply({
        content: `Access denied: ${err.message}`,
        ephemeral: true,
      });
      return;
    }
    throw err;
  }

  try {
    const proposal = await rejectProposal({
      proposalId,
      rejectedByEmployeeId: employee.id,
    });
    await interaction.update({
      content: `Proposal rejected: ${proposal.title}.`,
      components: [],
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "internal error";
    await interaction.reply({
      content: `Rejection failed: ${message}`,
      ephemeral: true,
    });
  }
}

/**
 * Handle messages in Ask threads.
 * When a user sends a message in a private Ask thread, it's treated as a
 * follow-up question.
 */
async function handleThreadMessage(message: Message, deps: DiscordAppDeps): Promise<void> {
  // Ignore bot messages
  if (message.author.bot) return;

  // Only process messages in threads
  if (!message.channel.isThread()) return;

  // Check if this thread is an Ask conversation
  const conversation = await db.conversation.findFirst({
    where: { discordThreadId: message.channel.id },
  });
  if (!conversation) return;
  // Only handle ASK conversations here; UPLOAD threads are handled by
  // handleUploadThreadMessage.
  if (conversation.conversationType !== "ASK") return;

  // Resolve the employee
  let employee;
  try {
    employee = await resolveDiscordEmployee(message.author.id);
  } catch {
    return; // Ignore messages from non-employees
  }

  // Check the kill switch
  if (await isKillSwitchActive()) {
    await message.reply("Hermes is currently disabled.");
    return;
  }

  if (!(await isFeatureEnabled("ask_enabled"))) {
    await message.reply("The Ask feature is currently disabled.");
    return;
  }

  // Run the Ask orchestrator with the follow-up query
  const orchestrator = new AskOrchestrator({
    embeddingFn: deps.embeddingFn,
    llm: deps.llm,
  });

  const result = await orchestrator.ask({
    employeeId: employee.id,
    employeeName: employee.displayName,
    query: message.content,
    conversationId: conversation.id,
    audience: conversation.audienceClassification as "PRIVATE" | "TEAM" | "COMPANY",
  });

  if (result.status === "ANSWERED" && result.answer) {
    const citationList =
      result.citations.length > 0 ? `\n\n**Citations:** ${result.citations.length} source(s)` : "";
    await message.reply(`${result.answer}${citationList}`);
  } else if (result.status === "NO_CONTEXT") {
    await message.reply("I don't have enough context to answer that question.");
  } else if (result.status === "EGRESS_BLOCKED") {
    await message.reply("I generated an answer but it was blocked by the security layer.");
  } else if (result.status === "CITATION_INVALID") {
    await message.reply("I generated an answer but the citations could not be verified.");
  } else if (result.status === "INJECTION_DETECTED") {
    await message.reply("Your query was blocked by the security layer.");
  }
}

/**
 * Start the Discord bot.
 */
export async function startDiscordApp(deps: DiscordAppDeps): Promise<Client> {
  const cfg = loadConfig(process.env);
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ],
  });

  // Handle slash commands
  client.on("interactionCreate", async (interaction) => {
    if (interaction.isChatInputCommand()) {
      const eventId = interaction.id;
      const claim = await tryClaimInboundEvent("DISCORD", eventId, "INTERACTION");
      if (claim.alreadyProcessed) return;

      // Channel whitelist enforcement: only allow commands in configured channels
      if (!isAllowedChannel(interaction.channelId, interaction.commandName, cfg)) {
        await interaction.reply({
          content: "This command can only be used in Hermes channels.",
          ephemeral: true,
        });
        return;
      }

      try {
        switch (interaction.commandName) {
          case "ask":
            await handleAskCommand(interaction, deps);
            break;
          case "memory":
            await handleMemoryCommand(interaction);
            break;
          case "ssot":
            await handleSsotCommand(interaction, client);
            break;
          case "upload":
            await handleUploadCommand(interaction, deps);
            break;
          case "connect-google":
            await handleConnectGoogleCommand(interaction);
            break;
          case "help":
            await handleHelpCommand(interaction);
            break;
          default:
            await interaction.reply({
              content: "Unknown command.",
              ephemeral: true,
            });
        }
      } catch (err) {
        structuredLogger.error("command_error", {
          command: interaction.commandName,
          error: err instanceof Error ? err.message : String(err),
        });
        if (!interaction.replied) {
          await interaction.reply({
            content: "An error occurred while processing your command.",
            ephemeral: true,
          });
        }
      }
    } else if (interaction.isButton()) {
      try {
        await handleButtonInteraction(interaction, deps);
      } catch (err) {
        structuredLogger.error("button_error", {
          customId: interaction.customId,
          error: err instanceof Error ? err.message : String(err),
        });
        if (!interaction.replied) {
          await interaction.reply({
            content: "An error occurred.",
            ephemeral: true,
          });
        }
      }
    }
  });

  // Handle messages in threads (follow-up questions and upload attachments)
  client.on("messageCreate", async (message) => {
    try {
      await handleThreadMessage(message, deps);
      await handleUploadThreadMessage(message, deps);
    } catch (err) {
      structuredLogger.error("message_error", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  await client.login(cfg.discordBotToken);
  return client;
}

async function start(): Promise<void> {
  const cfg = loadConfig(process.env);
  const { ObjectStorage } = await import("@hermes/storage");
  const storage = new ObjectStorage({
    endpoint: cfg.objectStorageEndpoint,
    bucket: cfg.objectStorageBucket,
    accessKey: cfg.objectStorageAccessKey,
    secretKey: cfg.objectStorageSecretKey,
  });

  // In production, these would be real Google API clients.
  // For staging, they can be mock implementations.
  const gmailProvider: GmailProvider = {
    async createDraft(_params) {
      return { draftId: `draft-${randomUUID()}` };
    },
    async updateDraft(draftId: string) {
      return { draftId };
    },
    async sendDraft(_draftId: string) {
      return { messageId: `msg-${randomUUID()}` };
    },
  };

  const calendarProvider: CalendarProvider = {
    async queryFreeBusy() {
      return { busySlots: [] };
    },
    async createEvent(_params) {
      return { eventId: `evt-${randomUUID()}` };
    },
    async updateEvent(eventId) {
      return { eventId };
    },
    async cancelEvent(_eventId) {
      return { cancelled: true };
    },
  };

  // Wire up the LLM and embedding providers. Real OpenAI providers are used
  // when a valid API key is present; otherwise a deterministic mock is used so
  // the bot can still boot in local/CI environments without credentials.
  const useRealOpenAI = cfg.openaiApiKey.length > 0 && !cfg.openaiApiKey.startsWith("replace-with");

  let embeddingFn: EmbeddingFunction;
  let llm: LLMClient;

  if (useRealOpenAI) {
    const providers = createOpenAIProviders({
      apiKey: cfg.openaiApiKey,
      reasoningModel: cfg.openaiReasoningModel,
      embeddingModel: cfg.openaiEmbeddingModel,
      baseURL: cfg.openaiBaseUrl,
      llmBaseUrl: cfg.openaiLlmBaseUrl,
      embeddingBaseUrl: cfg.openaiEmbeddingBaseUrl,
      llmApiKey: cfg.openaiLlmApiKey,
      embeddingApiKey: cfg.openaiEmbeddingApiKey,
    });
    embeddingFn = providers.embedding;
    llm = providers.llm;
  } else {
    // Mock fallback for local development / CI without OpenAI credentials.
    embeddingFn = {
      async embed(text) {
        const vec = new Array(1536).fill(0);
        for (let i = 0; i < text.length; i++) {
          vec[i % 1536] = (vec[i % 1536] + text.charCodeAt(i)) / 1000;
        }
        return vec;
      },
    };
    llm = {
      async complete(_prompt) {
        return `Based on the provided context, here is the answer.`;
      },
    };
  }

  await startDiscordApp({
    embeddingFn,
    llm,
    gmailProvider,
    calendarProvider,
    storage,
    bucket: cfg.objectStorageBucket,
  });

  structuredLogger.info("discord_bot_started", {});
}

// Start when run directly.
if (import.meta.url === `file://${process.argv[1]}`) {
  start().catch((err) => {
    structuredLogger.error("discord_bot_startup_failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    process.exit(1);
  });
}
