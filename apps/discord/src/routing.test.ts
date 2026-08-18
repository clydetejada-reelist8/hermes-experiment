import { describe, expect, it } from "vitest";
import { classifyDiscordMessage, type DiscordChannelConfig } from "./routing.js";

const channels: DiscordChannelConfig = {
  askChannelId: "ask-channel",
  uploadChannelId: "upload-channel",
};

describe("classifyDiscordMessage", () => {
  it("routes the ask channel to Ask handling", () => {
    expect(
      classifyDiscordMessage({ channelId: "ask-channel", attachmentCount: 0 }, channels),
    ).toEqual({
      kind: "ASK",
      accepted: true,
    });
  });

  it("routes the upload channel to Upload handling", () => {
    expect(
      classifyDiscordMessage({ channelId: "upload-channel", attachmentCount: 1 }, channels),
    ).toEqual({
      kind: "UPLOAD",
      accepted: true,
    });
  });

  it("rejects attachments in the ask channel", () => {
    expect(
      classifyDiscordMessage({ channelId: "ask-channel", attachmentCount: 1 }, channels),
    ).toEqual({
      kind: "ASK",
      accepted: false,
      reason: "UPLOADS_BELONG_IN_UPLOAD_CHANNEL",
    });
  });

  it("rejects messages from unapproved channels", () => {
    expect(
      classifyDiscordMessage({ channelId: "other-channel", attachmentCount: 0 }, channels),
    ).toEqual({
      kind: "IGNORED",
      accepted: false,
      reason: "CHANNEL_NOT_APPROVED",
    });
  });
});
