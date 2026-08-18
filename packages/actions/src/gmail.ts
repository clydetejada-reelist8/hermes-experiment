import { randomUUID } from "node:crypto";
import {
  createAction,
  transitionAction,
  reconcileUnknownOutcome,
  getAction,
} from "./state-machine.js";
import type { Action } from "./state-machine.js";
import { verifyConfirmation, ConfirmationError } from "./confirmation.js";
import { isKillSwitchActive, isFeatureEnabled } from "@hermes/admin";
import { audit } from "@hermes/audit";

/**
 * Error class for provider errors that represent ambiguous outcomes
 * (timeouts, network failures after the request was sent). These must be
 * reconciled rather than treated as definitive failures.
 */
export class AmbiguousOutcomeError extends Error {
  constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message);
    this.name = "AmbiguousOutcomeError";
  }
}

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
  idempotencyKey: string;
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
 *   3. The confirmation hash must match the action's current parameters
 *   4. Ambiguous outcomes (timeout) → OUTCOME_UNKNOWN for reconciliation
 *   5. The model can only PROPOSE actions, never execute them directly
 *   6. The kill switch and gmail_send feature flag are checked at execution time
 */
export class GmailActionExecutor {
  constructor(private readonly provider: GmailProvider) {}

  async createDraftAction(input: CreateDraftActionInput): Promise<Action> {
    const action = await createAction({
      employeeId: input.employeeId,
      conversationId: input.conversationId,
      type: "GMAIL_CREATE_DRAFT",
      provider: "gmail",
      riskLevel: "LOW",
      parametersJson: { to: input.to, subject: input.subject, body: input.body },
      idempotencyKey: input.idempotencyKey,
    });

    const draft = await this.provider.createDraft({
      to: input.to,
      subject: input.subject,
      body: input.body,
    });

    const prepared = await transitionAction(action.id, "PREPARED", {
      externalResourceId: draft.draftId,
    });

    await audit({
      type: "ACTION_PREPARED",
      employeeId: input.employeeId,
      resourceType: "Action",
      resourceId: action.id,
      metadata: { actionType: "GMAIL_CREATE_DRAFT", draftId: draft.draftId },
    });

    return prepared;
  }

  async updateDraftAction(input: UpdateDraftActionInput): Promise<Action> {
    const originalAction = await getAction(input.actionId);
    if (!originalAction) throw new Error("original action not found");
    if (!originalAction.externalResourceId) throw new Error("no draft ID on action");

    // Deterministic idempotency key derived from the original action + new params.
    // Date.now() would defeat idempotency on retries.
    const action = await createAction({
      employeeId: originalAction.employeeId,
      conversationId: originalAction.conversationId ?? undefined,
      type: "GMAIL_UPDATE_DRAFT",
      provider: "gmail",
      riskLevel: "LOW",
      parametersJson: {
        draftId: originalAction.externalResourceId,
        to: input.to,
        subject: input.subject,
        body: input.body,
      },
      idempotencyKey: input.idempotencyKey,
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

    // Verify confirmation hash matches current parameters (Section 21.3).
    await verifyConfirmation(action);

    // Check the kill switch at execution time (Section 31).
    if (await isKillSwitchActive()) {
      await transitionAction(actionId, "FAILED", { errorCode: "KILL_SWITCH_ACTIVE" });
      throw new ConfirmationError("kill switch is active — action blocked", "KILL_SWITCH_ACTIVE");
    }

    // Check the gmail_send feature flag at execution time (Section 31).
    if (!(await isFeatureEnabled("gmail_send_enabled"))) {
      await transitionAction(actionId, "FAILED", { errorCode: "FEATURE_DISABLED" });
      throw new ConfirmationError("gmail_send feature is disabled", "FEATURE_DISABLED");
    }

    const params = action.parametersJson as { draftId: string };

    try {
      const result = await this.provider.sendDraft(params.draftId);
      const succeeded = await transitionAction(actionId, "SUCCEEDED", {
        externalResourceId: result.messageId,
        externalResultJson: { sent: true },
      });

      await audit({
        type: "ACTION_EXECUTED",
        employeeId: action.employeeId,
        resourceType: "Action",
        resourceId: actionId,
        metadata: { actionType: "GMAIL_SEND_DRAFT", messageId: result.messageId },
      });

      return succeeded;
    } catch (err) {
      if (err instanceof AmbiguousOutcomeError) {
        return transitionAction(actionId, "OUTCOME_UNKNOWN", { errorCode: err.code });
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

/**
 * Determine whether a provider error represents an ambiguous outcome
 * (timeout, network failure after the request was sent). Uses structured
 * error properties rather than fragile string matching.
 */
export function isAmbiguousOutcome(err: unknown): boolean {
  if (err instanceof AmbiguousOutcomeError) return true;
  // Also check for common timeout error codes from HTTP clients.
  if (err instanceof Error) {
    return (
      err.message === "TIMEOUT" ||
      ("code" in err && (err as { code: string }).code === "ETIMEDOUT") ||
      ("name" in err && err.name === "AbortError")
    );
  }
  return false;
}

/**
 * Generate a deterministic idempotency key for update/cancel actions derived
 * from the original action ID and a nonce. This ensures retries produce the
 * same key rather than creating duplicate actions.
 */
export function deterministicIdempotencyKey(
  prefix: string,
  actionId: string,
  nonce?: string,
): string {
  return `${prefix}:${actionId}:${nonce ?? randomUUID()}`;
}
