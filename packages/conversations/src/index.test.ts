import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import {
  createConversation,
  appendMessage,
  getConversationMessages,
  closeConversation,
} from "./index.js";
import { createEmployee } from "../../../test/fixtures/db-helpers.js";

describe("createConversation", () => {
  it("creates an ASK conversation with PRIVATE audience", async () => {
    const emp = await createEmployee();
    const conv = await createConversation({
      initiatorEmployeeId: emp.id,
      type: "ASK",
      discordThreadId: randomUUID(),
      discordGuildId: randomUUID(),
    });
    expect(conv.conversationType).toBe("ASK");
    expect(conv.audienceClassification).toBe("PRIVATE");
    expect(conv.discordThreadId).toBeTruthy();
    expect(conv.initiatorEmployeeId).toBe(emp.id);
  });

  it("defaults memoryCaptureEnabled to true", async () => {
    const emp = await createEmployee();
    const conv = await createConversation({
      initiatorEmployeeId: emp.id,
      type: "ASK",
    });
    expect(conv.memoryCaptureEnabled).toBe(true);
  });
});

describe("appendMessage", () => {
  it("appends a user message and an assistant message", async () => {
    const emp = await createEmployee();
    const conv = await createConversation({
      initiatorEmployeeId: emp.id,
      type: "ASK",
    });
    const userMsg = await appendMessage({
      conversationId: conv.id,
      role: "user",
      content: "What is the sales process?",
      employeeId: emp.id,
    });
    const assistantMsg = await appendMessage({
      conversationId: conv.id,
      role: "assistant",
      content: "The sales process is...",
    });
    expect(userMsg.role).toBe("user");
    expect(userMsg.employeeId).toBe(emp.id);
    expect(assistantMsg.role).toBe("assistant");
    expect(assistantMsg.employeeId).toBeNull();
  });

  it("rejects a duplicate providerMessageId", async () => {
    const emp = await createEmployee();
    const conv = await createConversation({
      initiatorEmployeeId: emp.id,
      type: "ASK",
    });
    const providerMessageId = randomUUID();
    await appendMessage({
      conversationId: conv.id,
      role: "user",
      content: "first",
      providerMessageId,
    });
    await expect(
      appendMessage({
        conversationId: conv.id,
        role: "user",
        content: "dup",
        providerMessageId,
      }),
    ).rejects.toThrow();
  });
});

describe("getConversationMessages", () => {
  it("returns messages in chronological order", async () => {
    const emp = await createEmployee();
    const conv = await createConversation({
      initiatorEmployeeId: emp.id,
      type: "ASK",
    });
    await appendMessage({ conversationId: conv.id, role: "user", content: "a" });
    await appendMessage({ conversationId: conv.id, role: "assistant", content: "b" });
    await appendMessage({ conversationId: conv.id, role: "user", content: "c" });
    const messages = await getConversationMessages(conv.id);
    expect(messages.length).toBe(3);
    expect(messages[0]?.content).toBe("a");
    expect(messages[1]?.content).toBe("b");
    expect(messages[2]?.content).toBe("c");
  });
});

describe("closeConversation", () => {
  it("sets closedAt on an open conversation", async () => {
    const emp = await createEmployee();
    const conv = await createConversation({
      initiatorEmployeeId: emp.id,
      type: "ASK",
    });
    expect(conv.closedAt).toBeNull();
    const closed = await closeConversation(conv.id);
    expect(closed.closedAt).not.toBeNull();
  });
});
