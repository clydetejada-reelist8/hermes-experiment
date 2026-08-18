import { db } from "@hermes/db";
import type { Conversation, ConversationMessage } from "@hermes/db";
import type { ConversationType } from "@hermes/contracts";

export type { Conversation, ConversationMessage } from "@hermes/db";
export type { ConversationType } from "@hermes/contracts";

export interface CreateConversationInput {
  initiatorEmployeeId?: string;
  type: ConversationType;
  discordGuildId?: string;
  discordParentChannelId?: string;
  discordThreadId?: string;
  audienceClassification?: "PRIVATE" | "TEAM" | "COMPANY";
  memoryCaptureEnabled?: boolean;
}

/**
 * Create a new Hermes conversation. ASK conversations default to PRIVATE
 * audience; SSOT_REVIEW conversations default to TEAM.
 */
export async function createConversation(input: CreateConversationInput): Promise<Conversation> {
  const audience =
    input.audienceClassification ?? (input.type === "SSOT_REVIEW" ? "TEAM" : "PRIVATE");
  return db.conversation.create({
    data: {
      initiatorEmployeeId: input.initiatorEmployeeId,
      conversationType: input.type,
      audienceClassification: audience,
      memoryCaptureEnabled: input.memoryCaptureEnabled ?? true,
      discordGuildId: input.discordGuildId,
      discordParentChannelId: input.discordParentChannelId,
      discordThreadId: input.discordThreadId,
    },
  });
}

export interface AppendMessageInput {
  conversationId: string;
  role: string;
  content: string;
  employeeId?: string;
  providerMessageId?: string;
}

/**
 * Append a message to a conversation. The `providerMessageId` is unique per
 * provider event, preventing duplicate messages from Discord redeliveries.
 */
export async function appendMessage(input: AppendMessageInput): Promise<ConversationMessage> {
  return db.conversationMessage.create({
    data: {
      conversationId: input.conversationId,
      role: input.role,
      content: input.content,
      employeeId: input.employeeId,
      providerMessageId: input.providerMessageId,
    },
  });
}

/**
 * Get all messages for a conversation in chronological order.
 */
export async function getConversationMessages(
  conversationId: string,
): Promise<ConversationMessage[]> {
  return db.conversationMessage.findMany({
    where: { conversationId },
    orderBy: { createdAt: "asc" },
  });
}

/**
 * Close a conversation by setting `closedAt`.
 */
export async function closeConversation(conversationId: string): Promise<Conversation> {
  return db.conversation.update({
    where: { id: conversationId },
    data: { closedAt: new Date() },
  });
}
