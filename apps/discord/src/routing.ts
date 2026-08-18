export interface DiscordChannelConfig {
  askChannelId: string;
  uploadChannelId: string;
}

export interface DiscordMessageRouteInput {
  channelId: string;
  attachmentCount: number;
}

export type DiscordMessageKind = "ASK" | "UPLOAD" | "IGNORED";

export type DiscordMessageRoute =
  | { kind: "ASK" | "UPLOAD"; accepted: true }
  | {
      kind: "ASK" | "IGNORED";
      accepted: false;
      reason: "UPLOADS_BELONG_IN_UPLOAD_CHANNEL" | "CHANNEL_NOT_APPROVED";
    };

/**
 * Apply the two-channel Discord boundary before any message is passed to
 * Hermes or the Control Plane. Upload channels may carry files or links;
 * Ask channels may not carry attachments.
 */
export function classifyDiscordMessage(
  input: DiscordMessageRouteInput,
  channels: DiscordChannelConfig,
): DiscordMessageRoute {
  if (input.channelId === channels.askChannelId) {
    if (input.attachmentCount > 0) {
      return {
        kind: "ASK",
        accepted: false,
        reason: "UPLOADS_BELONG_IN_UPLOAD_CHANNEL",
      };
    }
    return { kind: "ASK", accepted: true };
  }

  if (input.channelId === channels.uploadChannelId) {
    return { kind: "UPLOAD", accepted: true };
  }

  return {
    kind: "IGNORED",
    accepted: false,
    reason: "CHANNEL_NOT_APPROVED",
  };
}
