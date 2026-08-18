import { createHash } from "node:crypto";
import { createAction, transitionAction, getAction } from "./state-machine.js";
import type { Action } from "./state-machine.js";
import { verifyConfirmation, ConfirmationError } from "./confirmation.js";
import { isKillSwitchActive, isFeatureEnabled } from "@hermes/admin";
import { audit } from "@hermes/audit";
import { isAmbiguousOutcome } from "./gmail.js";

export interface CalendarProvider {
  queryFreeBusy(
    start: string,
    end: string,
  ): Promise<{ busySlots: { start: string; end: string }[] }>;
  createEvent(params: {
    summary: string;
    start: string;
    end: string;
    attendees?: string[];
    requestId: string;
  }): Promise<{ eventId: string }>;
  updateEvent(
    eventId: string,
    params: { summary?: string; start?: string; end?: string; requestId: string },
  ): Promise<{ eventId: string }>;
  cancelEvent(eventId: string, requestId: string): Promise<{ cancelled: boolean }>;
}

export interface FreeBusyInput {
  employeeId: string;
  idempotencyKey: string;
  start: string;
  end: string;
}

export interface FreeBusyResult {
  status: string;
  busySlots: { start: string; end: string }[];
}

export interface CreateEventInput {
  employeeId: string;
  conversationId?: string;
  idempotencyKey: string;
  summary: string;
  start: string;
  end: string;
}

export interface CreateMeetingInput extends CreateEventInput {
  attendees: string[];
}

export interface UpdateEventInput {
  actionId: string;
  idempotencyKey: string;
  summary?: string;
  start?: string;
  end?: string;
}

export interface CancelEventInput {
  actionId: string;
  idempotencyKey: string;
}

/**
 * Derive a deterministic provider event ID from the Hermes Action ID
 * (Section 20.3/22.2). This ensures that retries of the same action produce
 * the same provider request ID, enabling idempotent provider calls.
 */
function deterministicRequestId(actionId: string): string {
  return `hermes-${createHash("sha256").update(actionId).digest("hex").slice(0, 16)}`;
}

/**
 * CalendarActionExecutor — handles Calendar actions through the action state machine.
 *
 * Safety properties:
 *   1. Personal events are MEDIUM risk (no confirmation needed)
 *   2. Meetings (with attendees) are HIGH risk (require confirmation)
 *   3. Free/busy queries are read-only (LOW risk, immediate execution)
 *   4. Cancel event requires confirmation (the event exists and others may be affected)
 *   5. Update event with attendee changes requires confirmation
 *   6. The model can only PROPOSE actions, never execute them directly
 *   7. The kill switch and calendar_write feature flag are checked at execution time
 *   8. Provider calls use a deterministic request ID derived from the Action ID
 */
export class CalendarActionExecutor {
  constructor(private readonly provider: CalendarProvider) {}

  async queryFreeBusy(input: FreeBusyInput): Promise<FreeBusyResult> {
    const action = await createAction({
      employeeId: input.employeeId,
      type: "CALENDAR_FREEBUSY",
      provider: "calendar",
      riskLevel: "LOW",
      parametersJson: { start: input.start, end: input.end },
      idempotencyKey: input.idempotencyKey,
    });

    await transitionAction(action.id, "PREPARED");
    await transitionAction(action.id, "EXECUTING");

    try {
      const result = await this.provider.queryFreeBusy(input.start, input.end);
      await transitionAction(action.id, "SUCCEEDED", {
        externalResultJson: { busySlots: result.busySlots },
      });
      return { status: "SUCCEEDED", busySlots: result.busySlots };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      await transitionAction(action.id, "FAILED", { errorCode: "CALENDAR_FREEBUSY_ERROR" });
      throw new Error(`free/busy query failed: ${errorMsg}`);
    }
  }

  async createPersonalEventAction(input: CreateEventInput): Promise<Action> {
    const action = await createAction({
      employeeId: input.employeeId,
      conversationId: input.conversationId,
      type: "CALENDAR_CREATE_PERSONAL_EVENT",
      provider: "calendar",
      riskLevel: "MEDIUM",
      parametersJson: { summary: input.summary, start: input.start, end: input.end },
      idempotencyKey: input.idempotencyKey,
    });

    await transitionAction(action.id, "PREPARED");
    await transitionAction(action.id, "EXECUTING");

    try {
      const result = await this.provider.createEvent({
        summary: input.summary,
        start: input.start,
        end: input.end,
        requestId: deterministicRequestId(action.id),
      });

      return transitionAction(action.id, "SUCCEEDED", {
        externalResourceId: result.eventId,
      });
    } catch (err) {
      if (isAmbiguousOutcome(err)) {
        return transitionAction(action.id, "OUTCOME_UNKNOWN", { errorCode: "AMBIGUOUS" });
      }
      return transitionAction(action.id, "FAILED", {
        errorCode: "CALENDAR_CREATE_ERROR",
      });
    }
  }

  async createMeetingAction(input: CreateMeetingInput): Promise<Action> {
    const action = await createAction({
      employeeId: input.employeeId,
      conversationId: input.conversationId,
      type: "CALENDAR_CREATE_MEETING",
      provider: "calendar",
      riskLevel: "HIGH",
      parametersJson: {
        summary: input.summary,
        start: input.start,
        end: input.end,
        attendees: input.attendees,
      },
      idempotencyKey: input.idempotencyKey,
      confirmationRequired: true,
    });

    // Meetings are HIGH risk — require confirmation
    await transitionAction(action.id, "PREPARED");
    return transitionAction(action.id, "AWAITING_CONFIRMATION");
  }

  async executeCreateMeeting(actionId: string): Promise<Action> {
    const action = await getAction(actionId);
    if (!action) throw new Error("action not found");
    if (action.status !== "EXECUTING") {
      throw new Error(`cannot execute meeting creation in status ${action.status}`);
    }

    // Verify confirmation hash matches current parameters (Section 21.3).
    await verifyConfirmation(action);

    // Check the kill switch at execution time (Section 31).
    if (await isKillSwitchActive()) {
      await transitionAction(actionId, "FAILED", { errorCode: "KILL_SWITCH_ACTIVE" });
      throw new ConfirmationError("kill switch is active — action blocked", "KILL_SWITCH_ACTIVE");
    }

    // Check the calendar_write feature flag at execution time (Section 31).
    if (!(await isFeatureEnabled("calendar_write_enabled"))) {
      await transitionAction(actionId, "FAILED", { errorCode: "FEATURE_DISABLED" });
      throw new ConfirmationError("calendar_write feature is disabled", "FEATURE_DISABLED");
    }

    const params = action.parametersJson as {
      summary: string;
      start: string;
      end: string;
      attendees: string[];
    };

    try {
      const result = await this.provider.createEvent({
        summary: params.summary,
        start: params.start,
        end: params.end,
        attendees: params.attendees,
        requestId: deterministicRequestId(actionId),
      });
      const succeeded = await transitionAction(actionId, "SUCCEEDED", {
        externalResourceId: result.eventId,
      });

      await audit({
        type: "ACTION_EXECUTED",
        employeeId: action.employeeId,
        resourceType: "Action",
        resourceId: actionId,
        metadata: { actionType: "CALENDAR_CREATE_MEETING", eventId: result.eventId },
      });

      return succeeded;
    } catch (err) {
      if (isAmbiguousOutcome(err)) {
        return transitionAction(actionId, "OUTCOME_UNKNOWN", { errorCode: "AMBIGUOUS" });
      }
      return transitionAction(actionId, "FAILED", {
        errorCode: "CALENDAR_CREATE_ERROR",
      });
    }
  }

  async updateEventAction(input: UpdateEventInput): Promise<Action> {
    const originalAction = await getAction(input.actionId);
    if (!originalAction) throw new Error("original action not found");
    if (!originalAction.externalResourceId) throw new Error("no event ID on action");

    const eventId = originalAction.externalResourceId;
    const params = {
      eventId,
      summary: input.summary,
      start: input.start,
      end: input.end,
    };

    // Determine if this update affects attendees (Section 22.4).
    // If the original action was a meeting (has attendees), updates require
    // confirmation because other attendees are affected.
    const originalParams = originalAction.parametersJson as { attendees?: string[] };
    const affectsAttendees =
      Array.isArray(originalParams.attendees) && originalParams.attendees.length > 0;
    const confirmationRequired = affectsAttendees;

    const action = await createAction({
      employeeId: originalAction.employeeId,
      conversationId: originalAction.conversationId ?? undefined,
      type: "CALENDAR_UPDATE_EVENT",
      provider: "calendar",
      riskLevel: affectsAttendees ? "MEDIUM" : "LOW",
      parametersJson: params,
      idempotencyKey: input.idempotencyKey,
      confirmationRequired,
    });

    if (confirmationRequired) {
      await transitionAction(action.id, "PREPARED");
      return transitionAction(action.id, "AWAITING_CONFIRMATION");
    }

    await transitionAction(action.id, "PREPARED");
    await transitionAction(action.id, "EXECUTING");

    try {
      const result = await this.provider.updateEvent(eventId, {
        summary: params.summary,
        start: params.start,
        end: params.end,
        requestId: deterministicRequestId(action.id),
      });
      return transitionAction(action.id, "SUCCEEDED", {
        externalResourceId: result.eventId,
      });
    } catch (err) {
      if (isAmbiguousOutcome(err)) {
        return transitionAction(action.id, "OUTCOME_UNKNOWN", { errorCode: "AMBIGUOUS" });
      }
      return transitionAction(action.id, "FAILED", {
        errorCode: "CALENDAR_UPDATE_ERROR",
      });
    }
  }

  async executeUpdateEvent(actionId: string): Promise<Action> {
    const action = await getAction(actionId);
    if (!action) throw new Error("action not found");
    if (action.status !== "EXECUTING") {
      throw new Error(`cannot execute event update in status ${action.status}`);
    }

    await verifyConfirmation(action);

    if (await isKillSwitchActive()) {
      await transitionAction(actionId, "FAILED", { errorCode: "KILL_SWITCH_ACTIVE" });
      throw new ConfirmationError("kill switch is active — action blocked", "KILL_SWITCH_ACTIVE");
    }

    if (!(await isFeatureEnabled("calendar_write_enabled"))) {
      await transitionAction(actionId, "FAILED", { errorCode: "FEATURE_DISABLED" });
      throw new ConfirmationError("calendar_write feature is disabled", "FEATURE_DISABLED");
    }

    const params = action.parametersJson as {
      eventId: string;
      summary?: string;
      start?: string;
      end?: string;
    };

    try {
      const result = await this.provider.updateEvent(params.eventId, {
        summary: params.summary,
        start: params.start,
        end: params.end,
        requestId: deterministicRequestId(actionId),
      });
      return transitionAction(actionId, "SUCCEEDED", {
        externalResourceId: result.eventId,
      });
    } catch (err) {
      if (isAmbiguousOutcome(err)) {
        return transitionAction(actionId, "OUTCOME_UNKNOWN", { errorCode: "AMBIGUOUS" });
      }
      return transitionAction(actionId, "FAILED", {
        errorCode: "CALENDAR_UPDATE_ERROR",
      });
    }
  }

  async cancelEventAction(input: CancelEventInput): Promise<Action> {
    const originalAction = await getAction(input.actionId);
    if (!originalAction) throw new Error("original action not found");
    if (!originalAction.externalResourceId) throw new Error("no event ID on action");

    const eventId = originalAction.externalResourceId;

    // Cancel event always requires confirmation when the event exists
    // (Section 22.5) — other attendees may be affected.
    const action = await createAction({
      employeeId: originalAction.employeeId,
      conversationId: originalAction.conversationId ?? undefined,
      type: "CALENDAR_CANCEL_EVENT",
      provider: "calendar",
      riskLevel: "MEDIUM",
      parametersJson: { eventId },
      idempotencyKey: input.idempotencyKey,
      confirmationRequired: true,
    });

    await transitionAction(action.id, "PREPARED");
    return transitionAction(action.id, "AWAITING_CONFIRMATION");
  }

  async executeCancelEvent(actionId: string): Promise<Action> {
    const action = await getAction(actionId);
    if (!action) throw new Error("action not found");
    if (action.status !== "EXECUTING") {
      throw new Error(`cannot execute event cancel in status ${action.status}`);
    }

    await verifyConfirmation(action);

    if (await isKillSwitchActive()) {
      await transitionAction(actionId, "FAILED", { errorCode: "KILL_SWITCH_ACTIVE" });
      throw new ConfirmationError("kill switch is active — action blocked", "KILL_SWITCH_ACTIVE");
    }

    if (!(await isFeatureEnabled("calendar_write_enabled"))) {
      await transitionAction(actionId, "FAILED", { errorCode: "FEATURE_DISABLED" });
      throw new ConfirmationError("calendar_write feature is disabled", "FEATURE_DISABLED");
    }

    const params = action.parametersJson as { eventId: string };

    try {
      await this.provider.cancelEvent(params.eventId, deterministicRequestId(actionId));
      const succeeded = await transitionAction(actionId, "SUCCEEDED");

      await audit({
        type: "ACTION_EXECUTED",
        employeeId: action.employeeId,
        resourceType: "Action",
        resourceId: actionId,
        metadata: { actionType: "CALENDAR_CANCEL_EVENT", eventId: params.eventId },
      });

      return succeeded;
    } catch (err) {
      if (isAmbiguousOutcome(err)) {
        return transitionAction(actionId, "OUTCOME_UNKNOWN", { errorCode: "AMBIGUOUS" });
      }
      return transitionAction(actionId, "FAILED", {
        errorCode: "CALENDAR_CANCEL_ERROR",
      });
    }
  }
}

// Re-export for consumers that need the ambiguous outcome utilities.
export { AmbiguousOutcomeError, isAmbiguousOutcome } from "./gmail.js";
export { deterministicIdempotencyKey } from "./gmail.js";
