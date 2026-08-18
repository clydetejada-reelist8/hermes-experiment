import { db } from "@hermes/db";
import type { Action } from "@hermes/db";
import type { ActionStatus, ActionType, ActionRiskLevel } from "@hermes/contracts";

export type { Action, ActionStatus, ActionType, ActionRiskLevel };

/**
 * Valid state transitions for the action state machine.
 *
 * The state machine is DETERMINISTIC — the model cannot bypass these
 * transitions. Every action must go through the full lifecycle:
 *   PROPOSED → PREPARED → [AWAITING_CONFIRMATION] → EXECUTING → terminal
 *
 * Terminal states: SUCCEEDED, FAILED, PARTIALLY_SUCCEEDED, OUTCOME_UNKNOWN, CANCELLED
 *
 * The OUTCOME_UNKNOWN state is for actions where the external API returned
 * an ambiguous result (e.g., timeout after the request was sent). These
 * must be reconciled to a final state through investigation.
 */
const VALID_TRANSITIONS: Record<ActionStatus, ActionStatus[]> = {
  PROPOSED: ["PREPARED", "CANCELLED"],
  PREPARED: ["AWAITING_CONFIRMATION", "EXECUTING", "CANCELLED"],
  AWAITING_CONFIRMATION: ["EXECUTING", "CANCELLED"],
  EXECUTING: ["SUCCEEDED", "FAILED", "PARTIALLY_SUCCEEDED", "OUTCOME_UNKNOWN"],
  SUCCEEDED: [],
  FAILED: [],
  PARTIALLY_SUCCEEDED: [],
  OUTCOME_UNKNOWN: ["SUCCEEDED", "FAILED", "PARTIALLY_SUCCEEDED"],
  CANCELLED: [],
};

export interface CreateActionInput {
  employeeId: string;
  conversationId?: string;
  type: ActionType;
  provider?: string;
  riskLevel?: ActionRiskLevel;
  parametersJson: Record<string, unknown>;
  idempotencyKey: string;
  confirmationRequired?: boolean;
}

export async function createAction(input: CreateActionInput): Promise<Action> {
  return db.action.create({
    data: {
      employeeId: input.employeeId,
      conversationId: input.conversationId,
      type: input.type,
      provider: input.provider,
      riskLevel: input.riskLevel ?? "LOW",
      parametersJson: input.parametersJson,
      idempotencyKey: input.idempotencyKey,
      confirmationRequired: input.confirmationRequired ?? false,
      status: "PROPOSED",
    },
  });
}

export async function getAction(id: string): Promise<Action | null> {
  return db.action.findUnique({ where: { id } });
}

export interface TransitionExtras {
  externalResourceId?: string;
  externalResultJson?: Record<string, unknown>;
  errorCode?: string;
}

/**
 * Transition an action to a new status.
 * Throws if the transition is invalid per the state machine.
 */
export async function transitionAction(
  id: string,
  newStatus: ActionStatus,
  extras?: TransitionExtras,
): Promise<Action> {
  const action = await db.action.findUnique({ where: { id } });
  if (!action) throw new Error("action not found");

  const allowed = VALID_TRANSITIONS[action.status as ActionStatus];
  if (!allowed || !allowed.includes(newStatus)) {
    throw new Error(`invalid transition: ${action.status} → ${newStatus}`);
  }

  const updateData: Record<string, unknown> = { status: newStatus };

  if (newStatus === "EXECUTING") {
    // Don't set executedAt yet — it's set when the action completes
  }

  if (newStatus === "SUCCEEDED" || newStatus === "FAILED" || newStatus === "PARTIALLY_SUCCEEDED") {
    updateData.executedAt = new Date();
  }

  if (extras?.externalResourceId !== undefined) {
    updateData.externalResourceId = extras.externalResourceId;
  }
  if (extras?.externalResultJson !== undefined) {
    updateData.externalResultJson = extras.externalResultJson;
  }
  if (extras?.errorCode !== undefined) {
    updateData.errorCode = extras.errorCode;
  }

  return db.action.update({ where: { id }, data: updateData });
}

export interface ReconcileInput {
  finalStatus: "SUCCEEDED" | "FAILED" | "PARTIALLY_SUCCEEDED";
  externalResourceId?: string;
  externalResultJson?: Record<string, unknown>;
  errorCode?: string;
}

/**
 * Reconcile an OUTCOME_UNKNOWN action to a final status.
 *
 * This is used when an action's outcome was ambiguous (e.g., API timeout
 * after the request was sent). A human or background process investigates
 * and determines the actual outcome, then reconciles the action.
 *
 * Only OUTCOME_UNKNOWN actions can be reconciled.
 */
export async function reconcileUnknownOutcome(id: string, input: ReconcileInput): Promise<Action> {
  const action = await db.action.findUnique({ where: { id } });
  if (!action) throw new Error("action not found");
  if (action.status !== "OUTCOME_UNKNOWN") {
    throw new Error(`cannot reconcile action with status ${action.status}`);
  }

  const updateData: Record<string, unknown> = {
    status: input.finalStatus,
    reconciledAt: new Date(),
  };

  if (input.externalResourceId !== undefined) {
    updateData.externalResourceId = input.externalResourceId;
  }
  if (input.externalResultJson !== undefined) {
    updateData.externalResultJson = input.externalResultJson;
  }
  if (input.errorCode !== undefined) {
    updateData.errorCode = input.errorCode;
  }

  return db.action.update({ where: { id }, data: updateData });
}
