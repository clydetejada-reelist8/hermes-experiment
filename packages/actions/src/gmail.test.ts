import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { db } from "@hermes/db";
import { GmailActionExecutor, type GmailProvider, AmbiguousOutcomeError } from "./gmail.js";
import { transitionAction } from "./state-machine.js";
import { recordConfirmation } from "./confirmation.js";
import { createEmployee } from "../../../test/fixtures/db-helpers.js";

async function enableGmailSendFlag(): Promise<void> {
  await db.featureFlag.upsert({
    where: { key: "gmail_send_enabled" },
    create: { key: "gmail_send_enabled", enabled: true, updatedBy: "test" },
    update: { enabled: true, updatedBy: "test" },
  });
}

class MockGmailProvider implements GmailProvider {
  drafts: Map<string, { to: string; subject: string; body: string }> = new Map();
  sentMessages: Map<string, { draftId: string; messageId: string }> = new Map();
  shouldTimeout = false;

  async createDraft(params: {
    to: string;
    subject: string;
    body: string;
  }): Promise<{ draftId: string }> {
    const draftId = `draft-${randomUUID()}`;
    this.drafts.set(draftId, params);
    return { draftId };
  }

  async updateDraft(
    draftId: string,
    params: { to: string; subject: string; body: string },
  ): Promise<{ draftId: string }> {
    this.drafts.set(draftId, params);
    return { draftId };
  }

  async sendDraft(draftId: string): Promise<{ messageId: string }> {
    if (this.shouldTimeout) {
      throw new AmbiguousOutcomeError("TIMEOUT", "ETIMEDOUT");
    }
    const messageId = `msg-${randomUUID()}`;
    this.sentMessages.set(messageId, { draftId, messageId });
    return { messageId };
  }
}

describe("GmailActionExecutor", () => {
  it("creates a draft action", async () => {
    const emp = await createEmployee();
    const executor = new GmailActionExecutor(new MockGmailProvider());

    const action = await executor.createDraftAction({
      employeeId: emp.id,
      idempotencyKey: randomUUID(),
      to: "test@example.com",
      subject: "Test Subject",
      body: "Test Body",
    });

    expect(action.status).toBe("PREPARED");
    expect(action.type).toBe("GMAIL_CREATE_DRAFT");
    expect(action.externalResourceId).toBeTruthy();
  });

  it("updates a draft action", async () => {
    const emp = await createEmployee();
    const provider = new MockGmailProvider();
    const executor = new GmailActionExecutor(provider);

    const draftAction = await executor.createDraftAction({
      employeeId: emp.id,
      idempotencyKey: randomUUID(),
      to: "test@example.com",
      subject: "Original",
      body: "Original body",
    });

    const updatedAction = await executor.updateDraftAction({
      actionId: draftAction.id,
      idempotencyKey: randomUUID(),
      to: "test@example.com",
      subject: "Updated Subject",
      body: "Updated body",
    });

    expect(updatedAction.type).toBe("GMAIL_UPDATE_DRAFT");
    expect(updatedAction.status).toBe("PREPARED");
  });

  it("sends a draft with confirmation and succeeds", async () => {
    const emp = await createEmployee();
    const provider = new MockGmailProvider();
    const executor = new GmailActionExecutor(provider);
    await enableGmailSendFlag();

    const draftAction = await executor.createDraftAction({
      employeeId: emp.id,
      idempotencyKey: randomUUID(),
      to: "test@example.com",
      subject: "Send me",
      body: "Please send",
    });

    const sendAction = await executor.sendDraftAction({
      employeeId: emp.id,
      draftActionId: draftAction.id,
      idempotencyKey: randomUUID(),
    });

    // Send should require confirmation (HIGH risk)
    expect(sendAction.status).toBe("AWAITING_CONFIRMATION");
    expect(sendAction.confirmationRequired).toBe(true);

    // Record a valid confirmation and execute
    await recordConfirmation(
      sendAction.id,
      emp.id,
      sendAction.parametersJson as Record<string, unknown>,
    );
    await transitionAction(sendAction.id, "EXECUTING");
    const result = await executor.executeSend(sendAction.id);

    expect(result.status).toBe("SUCCEEDED");
    expect(result.externalResourceId).toBeTruthy();
  });

  it("blocks send without a confirmation", async () => {
    const emp = await createEmployee();
    const provider = new MockGmailProvider();
    const executor = new GmailActionExecutor(provider);
    await enableGmailSendFlag();

    const draftAction = await executor.createDraftAction({
      employeeId: emp.id,
      idempotencyKey: randomUUID(),
      to: "test@example.com",
      subject: "No confirm",
      body: "Should not send without confirm",
    });

    const sendAction = await executor.sendDraftAction({
      employeeId: emp.id,
      draftActionId: draftAction.id,
      idempotencyKey: randomUUID(),
    });

    expect(sendAction.status).toBe("AWAITING_CONFIRMATION");

    // Transition to EXECUTING without recording a confirmation
    await transitionAction(sendAction.id, "EXECUTING");
    await expect(executor.executeSend(sendAction.id)).rejects.toThrow();
  });

  it("blocks send when confirmation hash does not match parameters", async () => {
    const emp = await createEmployee();
    const provider = new MockGmailProvider();
    const executor = new GmailActionExecutor(provider);
    await enableGmailSendFlag();

    const draftAction = await executor.createDraftAction({
      employeeId: emp.id,
      idempotencyKey: randomUUID(),
      to: "test@example.com",
      subject: "Hash test",
      body: "Original body",
    });

    const sendAction = await executor.sendDraftAction({
      employeeId: emp.id,
      draftActionId: draftAction.id,
      idempotencyKey: randomUUID(),
    });

    // Record a confirmation with DIFFERENT parameters (simulating parameter change after confirmation)
    await recordConfirmation(sendAction.id, emp.id, { draftId: "different-draft-id" });
    await transitionAction(sendAction.id, "EXECUTING");
    await expect(executor.executeSend(sendAction.id)).rejects.toThrow();
  });

  it("marks send as OUTCOME_UNKNOWN on timeout", async () => {
    const emp = await createEmployee();
    const provider = new MockGmailProvider();
    provider.shouldTimeout = true;
    const executor = new GmailActionExecutor(provider);
    await enableGmailSendFlag();

    const draftAction = await executor.createDraftAction({
      employeeId: emp.id,
      idempotencyKey: randomUUID(),
      to: "test@example.com",
      subject: "Timeout test",
      body: "This will timeout",
    });

    const sendAction = await executor.sendDraftAction({
      employeeId: emp.id,
      draftActionId: draftAction.id,
      idempotencyKey: randomUUID(),
    });

    await recordConfirmation(
      sendAction.id,
      emp.id,
      sendAction.parametersJson as Record<string, unknown>,
    );
    await transitionAction(sendAction.id, "EXECUTING");
    const result = await executor.executeSend(sendAction.id);

    expect(result.status).toBe("OUTCOME_UNKNOWN");
  });

  it("can reconcile OUTCOME_UNKNOWN to SUCCEEDED after timeout", async () => {
    const emp = await createEmployee();
    const provider = new MockGmailProvider();
    provider.shouldTimeout = true;
    const executor = new GmailActionExecutor(provider);
    await enableGmailSendFlag();

    const draftAction = await executor.createDraftAction({
      employeeId: emp.id,
      idempotencyKey: randomUUID(),
      to: "test@example.com",
      subject: "Reconcile test",
      body: "Will be reconciled",
    });

    const sendAction = await executor.sendDraftAction({
      employeeId: emp.id,
      draftActionId: draftAction.id,
      idempotencyKey: randomUUID(),
    });

    await recordConfirmation(
      sendAction.id,
      emp.id,
      sendAction.parametersJson as Record<string, unknown>,
    );
    await transitionAction(sendAction.id, "EXECUTING");
    await executor.executeSend(sendAction.id);

    // Reconcile: the email was actually sent despite the timeout
    const reconciled = await executor.reconcileSend(sendAction.id, {
      finalStatus: "SUCCEEDED",
      externalResourceId: "msg-reconciled-123",
    });

    expect(reconciled.status).toBe("SUCCEEDED");
    expect(reconciled.reconciledAt).toBeTruthy();
  });
});
