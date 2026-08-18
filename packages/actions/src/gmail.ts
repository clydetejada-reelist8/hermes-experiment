import {
  createAction,
  transitionAction,
  reconcileUnknownOutcome,
  getAction,
} from "./state-machine.js";
import type { Action } from "./state-machine.js";

export interface GmailProvider {
  createDraft(params: { to: string; subject: string; body: string }): Promise<{ draftId: string }>;
  updateDraft(
    draftId: string,
    params: { to: string; subject: string; body: string },
  ): Promise<{ draftId: string }>;
  sendDraft(draftId: string): Promise<{ messageId: string }>;
}

export interface CreateDraftActionInput {
  employeeId: string;
  conversationId?: string;
  idempotencyKey: string;
  to: string;
  subject: string;
  body: string;
}

export interface UpdateDraftActionInput {
  actionId: string;
  to: string;
  subject: string;
  body: string;
}

export interface SendDraftActionInput {
  employeeId: string;
  draftActionId: string;
  conversationId?: string;
  idempotencyKey: string;
}

/**
 * GmailActionExecutor — handles Gmail actions through the action state machine.
 *
 * Safety properties:
 *   1. Emails always start as DRAFTS — never sent directly
 *   2. Sending requires EXPLICIT CONFIRMATION (HIGH risk action)
 *   3. Ambiguous outcomes (timeout) → OUTCOME_UNKNOWN for reconciliation
 *   4. The model can only PROPOSE actions, never execute them directly
 */
export class GmailActionExecutor {
  constructor(private readonly provider: GmailProvider) {}

  async createDraftAction(input: CreateDraftActionInput): Promise<Action> {
    // Create the action in PROPOSED status
    const action = await createAction({
      employeeId: input.employeeId,
      conversationId: input.conversationId,
      type: "GMAIL_CREATE_DRAFT",
      provider: "gmail",
      riskLevel: "LOW",
      parametersJson: { to: input.to, subject: input.subject, body: input.body },
      idempotencyKey: input.idempotencyKey,
    });

    // Execute: create the draft via the provider
    const draft = await this.provider.createDraft({
      to: input.to,
      subject: input.subject,
      body: input.body,
    });

    // Transition to PREPARED with the draft ID
    return transitionAction(action.id, "PREPARED", {
      externalResourceId: draft.draftId,
    });
  }

  async updateDraftAction(input: UpdateDraftActionInput): Promise<Action> {
    const originalAction = await getAction(input.actionId);
    if (!originalAction) throw new Error("original action not found");
    if (!originalAction.externalResourceId) throw new Error("no draft ID on action");

    const action = await createAction({
      employeeId: originalAction.employeeId,
      conversationId: originalAction.conversationId ?? undefined,
      type: "GMAIL_UPDATE_DRAFT",
      provider: "gmail",
      riskLevel: "LOW",
      parametersJson: { to: input.to, subject: input.subject, body: input.body },
      idempotencyKey: `update-${input.actionId}-${Date.now()}`,
    });

    const draft = await this.provider.updateDraft(originalAction.externalResourceId, {
      to: input.to,
      subject: input.subject,
      body: input.body,
    });

    return transitionAction(action.id, "PREPARED", {
      externalResourceId: draft.draftId,
    });
  }

  async sendDraftAction(input: SendDraftActionInput): Promise<Action> {
    const draftAction = await getAction(input.draftActionId);
    if (!draftAction) throw new Error("draft action not found");
    if (!draftAction.externalResourceId) throw new Error("no draft ID on action");

    // Sending email is HIGH risk — requires confirmation
    const action = await createAction({
      employeeId: input.employeeId,
      conversationId: input.conversationId,
      type: "GMAIL_SEND_DRAFT",
      provider: "gmail",
      riskLevel: "HIGH",
      parametersJson: { draftId: draftAction.externalResourceId },
      idempotencyKey: input.idempotencyKey,
      confirmationRequired: true,
    });

    // Transition to PREPARED, then AWAITING_CONFIRMATION
    await transitionAction(action.id, "PREPARED");
    return transitionAction(action.id, "AWAITING_CONFIRMATION");
  }

  async executeSend(actionId: string): Promise<Action> {
    const action = await getAction(actionId);
    if (!action) throw new Error("action not found");
    if (action.status !== "EXECUTING") {
      throw new Error(`cannot execute send in status ${action.status}`);
    }

    const params = action.parametersJson as { draftId: string };

    try {
      const result = await this.provider.sendDraft(params.draftId);
      return transitionAction(actionId, "SUCCEEDED", {
        externalResourceId: result.messageId,
        externalResultJson: { sent: true },
      });
    } catch (err) {
      // Check if this is a timeout (ambiguous outcome)
      const errorMsg = err instanceof Error ? err.message : String(err);
      if (errorMsg.includes("TIMEOUT") || errorMsg.includes("timeout")) {
        return transitionAction(actionId, "OUTCOME_UNKNOWN");
      }
      // Non-timeout error → FAILED
      return transitionAction(actionId, "FAILED", {
        errorCode: "GMAIL_SEND_ERROR",
      });
    }
  }

  async reconcileSend(
    actionId: string,
    input: {
      finalStatus: "SUCCEEDED" | "FAILED" | "PARTIALLY_SUCCEEDED";
      externalResourceId?: string;
    },
  ): Promise<Action> {
    return reconcileUnknownOutcome(actionId, input);
  }
}
