import { createAction, transitionAction, getAction } from "./state-machine.js";
import type { Action } from "./state-machine.js";

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
  }): Promise<{ eventId: string }>;
  updateEvent(
    eventId: string,
    params: { summary?: string; start?: string; end?: string },
  ): Promise<{ eventId: string }>;
  cancelEvent(eventId: string): Promise<{ cancelled: boolean }>;
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
  summary?: string;
  start?: string;
  end?: string;
}

export interface CancelEventInput {
  actionId: string;
}

/**
 * CalendarActionExecutor — handles Calendar actions through the action state machine.
 *
 * Safety properties:
 *   1. Personal events are MEDIUM risk (no confirmation needed)
 *   2. Meetings (with attendees) are HIGH risk (require confirmation)
 *   3. Free/busy queries are read-only (LOW risk, immediate execution)
 *   4. The model can only PROPOSE actions, never execute them directly
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

    // Personal events are MEDIUM risk — execute immediately (no confirmation)
    await transitionAction(action.id, "EXECUTING");
    const result = await this.provider.createEvent({
      summary: input.summary,
      start: input.start,
      end: input.end,
    });

    return transitionAction(action.id, "SUCCEEDED", {
      externalResourceId: result.eventId,
    });
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
      });
      return transitionAction(actionId, "SUCCEEDED", {
        externalResourceId: result.eventId,
      });
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      if (errorMsg.includes("TIMEOUT") || errorMsg.includes("timeout")) {
        return transitionAction(actionId, "OUTCOME_UNKNOWN");
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

    const action = await createAction({
      employeeId: originalAction.employeeId,
      conversationId: originalAction.conversationId ?? undefined,
      type: "CALENDAR_UPDATE_EVENT",
      provider: "calendar",
      riskLevel: "LOW",
      parametersJson: {
        eventId: originalAction.externalResourceId,
        summary: input.summary,
        start: input.start,
        end: input.end,
      },
      idempotencyKey: `update-${input.actionId}-${Date.now()}`,
    });

    await transitionAction(action.id, "PREPARED");
    await transitionAction(action.id, "EXECUTING");

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
      });
      return transitionAction(action.id, "SUCCEEDED", {
        externalResourceId: result.eventId,
      });
    } catch {
      return transitionAction(action.id, "FAILED", {
        errorCode: "CALENDAR_UPDATE_ERROR",
      });
    }
  }

  async cancelEventAction(input: CancelEventInput): Promise<Action> {
    const originalAction = await getAction(input.actionId);
    if (!originalAction) throw new Error("original action not found");
    if (!originalAction.externalResourceId) throw new Error("no event ID on action");

    const action = await createAction({
      employeeId: originalAction.employeeId,
      conversationId: originalAction.conversationId ?? undefined,
      type: "CALENDAR_CANCEL_EVENT",
      provider: "calendar",
      riskLevel: "MEDIUM",
      parametersJson: { eventId: originalAction.externalResourceId },
      idempotencyKey: `cancel-${input.actionId}-${Date.now()}`,
    });

    await transitionAction(action.id, "PREPARED");
    await transitionAction(action.id, "EXECUTING");

    const params = action.parametersJson as { eventId: string };

    try {
      await this.provider.cancelEvent(params.eventId);
      return transitionAction(action.id, "SUCCEEDED");
    } catch {
      return transitionAction(action.id, "FAILED", {
        errorCode: "CALENDAR_CANCEL_ERROR",
      });
    }
  }
}
