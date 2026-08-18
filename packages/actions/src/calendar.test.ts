import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { CalendarActionExecutor, type CalendarProvider } from "./calendar.js";
import { transitionAction } from "./state-machine.js";
import { createEmployee } from "../../../test/fixtures/db-helpers.js";

class MockCalendarProvider implements CalendarProvider {
  events: Map<
    string,
    {
      summary: string;
      start: string;
      end: string;
      attendees: string[];
    }
  > = new Map();
  busySlots: { start: string; end: string }[] = [];

  async queryFreeBusy(
    _start: string,
    _end: string,
  ): Promise<{ busySlots: { start: string; end: string }[] }> {
    return { busySlots: this.busySlots };
  }

  async createEvent(params: {
    summary: string;
    start: string;
    end: string;
    attendees?: string[];
  }): Promise<{ eventId: string }> {
    const eventId = `evt-${randomUUID()}`;
    this.events.set(eventId, {
      summary: params.summary,
      start: params.start,
      end: params.end,
      attendees: params.attendees ?? [],
    });
    return { eventId };
  }

  async updateEvent(
    eventId: string,
    params: { summary?: string; start?: string; end?: string },
  ): Promise<{ eventId: string }> {
    const existing = this.events.get(eventId);
    if (existing) {
      this.events.set(eventId, {
        ...existing,
        summary: params.summary ?? existing.summary,
        start: params.start ?? existing.start,
        end: params.end ?? existing.end,
      });
    }
    return { eventId };
  }

  async cancelEvent(eventId: string): Promise<{ cancelled: boolean }> {
    this.events.delete(eventId);
    return { cancelled: true };
  }
}

describe("CalendarActionExecutor", () => {
  it("queries free/busy and returns available slots", async () => {
    const emp = await createEmployee();
    const provider = new MockCalendarProvider();
    provider.busySlots = [{ start: "2024-01-01T10:00:00Z", end: "2024-01-01T11:00:00Z" }];
    const executor = new CalendarActionExecutor(provider);

    const result = await executor.queryFreeBusy({
      employeeId: emp.id,
      idempotencyKey: randomUUID(),
      start: "2024-01-01T09:00:00Z",
      end: "2024-01-01T17:00:00Z",
    });

    expect(result.status).toBe("SUCCEEDED");
    expect(result.busySlots).toEqual(provider.busySlots);
  });

  it("creates a personal event (MEDIUM risk, no confirmation)", async () => {
    const emp = await createEmployee();
    const executor = new CalendarActionExecutor(new MockCalendarProvider());

    const action = await executor.createPersonalEventAction({
      employeeId: emp.id,
      idempotencyKey: randomUUID(),
      summary: "Focus time",
      start: "2024-01-01T14:00:00Z",
      end: "2024-01-01T15:00:00Z",
    });

    expect(action.status).toBe("SUCCEEDED");
    expect(action.type).toBe("CALENDAR_CREATE_PERSONAL_EVENT");
    expect(action.externalResourceId).toBeTruthy();
  });

  it("creates a meeting (HIGH risk, requires confirmation)", async () => {
    const emp = await createEmployee();
    const executor = new CalendarActionExecutor(new MockCalendarProvider());

    const action = await executor.createMeetingAction({
      employeeId: emp.id,
      idempotencyKey: randomUUID(),
      summary: "Team sync",
      start: "2024-01-01T14:00:00Z",
      end: "2024-01-01T15:00:00Z",
      attendees: ["a@example.com", "b@example.com"],
    });

    expect(action.status).toBe("AWAITING_CONFIRMATION");
    expect(action.confirmationRequired).toBe(true);
    expect(action.type).toBe("CALENDAR_CREATE_MEETING");
  });

  it("executes meeting creation after confirmation", async () => {
    const emp = await createEmployee();
    const executor = new CalendarActionExecutor(new MockCalendarProvider());

    const action = await executor.createMeetingAction({
      employeeId: emp.id,
      idempotencyKey: randomUUID(),
      summary: "Team sync",
      start: "2024-01-01T14:00:00Z",
      end: "2024-01-01T15:00:00Z",
      attendees: ["a@example.com"],
    });

    await transitionAction(action.id, "EXECUTING");
    const result = await executor.executeCreateMeeting(action.id);

    expect(result.status).toBe("SUCCEEDED");
    expect(result.externalResourceId).toBeTruthy();
  });

  it("updates an event", async () => {
    const emp = await createEmployee();
    const executor = new CalendarActionExecutor(new MockCalendarProvider());

    const createAction = await executor.createPersonalEventAction({
      employeeId: emp.id,
      idempotencyKey: randomUUID(),
      summary: "Original",
      start: "2024-01-01T14:00:00Z",
      end: "2024-01-01T15:00:00Z",
    });

    const updateAction = await executor.updateEventAction({
      actionId: createAction.id,
      summary: "Updated summary",
    });

    expect(updateAction.type).toBe("CALENDAR_UPDATE_EVENT");
    expect(updateAction.status).toBe("SUCCEEDED");
  });

  it("cancels an event", async () => {
    const emp = await createEmployee();
    const executor = new CalendarActionExecutor(new MockCalendarProvider());

    const createAction = await executor.createPersonalEventAction({
      employeeId: emp.id,
      idempotencyKey: randomUUID(),
      summary: "To be cancelled",
      start: "2024-01-01T14:00:00Z",
      end: "2024-01-01T15:00:00Z",
    });

    const cancelAction = await executor.cancelEventAction({
      actionId: createAction.id,
    });

    expect(cancelAction.type).toBe("CALENDAR_CANCEL_EVENT");
    expect(cancelAction.status).toBe("SUCCEEDED");
  });
});
