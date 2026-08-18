import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { GmailActionExecutor, type GmailProvider } from "./gmail.js";
import { transitionAction } from "./state-machine.js";
import { createEmployee } from "../../../test/fixtures/db-helpers.js";

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
      throw new Error("TIMEOUT");
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

    // Confirm and execute
    await transitionAction(sendAction.id, "EXECUTING");
    const result = await executor.executeSend(sendAction.id);

    expect(result.status).toBe("SUCCEEDED");
    expect(result.externalResourceId).toBeTruthy();
  });

  it("marks send as OUTCOME_UNKNOWN on timeout", async () => {
    const emp = await createEmployee();
    const provider = new MockGmailProvider();
    provider.shouldTimeout = true;
    const executor = new GmailActionExecutor(provider);

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

    await transitionAction(sendAction.id, "EXECUTING");
    const result = await executor.executeSend(sendAction.id);

    expect(result.status).toBe("OUTCOME_UNKNOWN");
  });

  it("can reconcile OUTCOME_UNKNOWN to SUCCEEDED after timeout", async () => {
    const emp = await createEmployee();
    const provider = new MockGmailProvider();
    provider.shouldTimeout = true;
    const executor = new GmailActionExecutor(provider);

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

  it("does not allow sending without confirmation for HIGH risk", async () => {
    const emp = await createEmployee();
    const provider = new MockGmailProvider();
    const executor = new GmailActionExecutor(provider);

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

    // The send action should be AWAITING_CONFIRMATION, not EXECUTING
    expect(sendAction.status).toBe("AWAITING_CONFIRMATION");

    // Trying to execute without confirming should fail
    await expect(executor.executeSend(sendAction.id)).rejects.toThrow();
  });
});
