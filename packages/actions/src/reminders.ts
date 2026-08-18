import { db } from "@hermes/db";
import type { Reminder } from "@hermes/db";

export type { Reminder };

export interface CreateReminderInput {
  employeeId: string;
  conversationId?: string;
  text: string;
  dueAt: Date;
  timezone: string;
}

/**
 * Create a new reminder. Reminders start in OPEN status.
 */
export async function createReminder(input: CreateReminderInput): Promise<Reminder> {
  return db.reminder.create({
    data: {
      employeeId: input.employeeId,
      conversationId: input.conversationId,
      text: input.text,
      dueAt: input.dueAt,
      timezone: input.timezone,
      status: "OPEN",
    },
  });
}

/**
 * Get a reminder by ID.
 */
export async function getReminder(id: string): Promise<Reminder | null> {
  return db.reminder.findUnique({ where: { id } });
}

/**
 * Complete a reminder. Only OPEN reminders can be completed.
 */
export async function completeReminder(id: string): Promise<Reminder> {
  const reminder = await db.reminder.findUnique({ where: { id } });
  if (!reminder) throw new Error("reminder not found");
  if (reminder.status !== "OPEN") {
    throw new Error(`cannot complete reminder with status ${reminder.status}`);
  }
  return db.reminder.update({
    where: { id },
    data: { status: "COMPLETED", completedAt: new Date() },
  });
}

/**
 * Cancel a reminder. Only OPEN reminders can be cancelled.
 */
export async function cancelReminder(id: string): Promise<Reminder> {
  const reminder = await db.reminder.findUnique({ where: { id } });
  if (!reminder) throw new Error("reminder not found");
  if (reminder.status !== "OPEN") {
    throw new Error(`cannot cancel reminder with status ${reminder.status}`);
  }
  return db.reminder.update({
    where: { id },
    data: { status: "CANCELLED" },
  });
}

/**
 * Get all reminders that are due (dueAt <= now) and still OPEN.
 * This is used by the worker to trigger due reminders.
 */
export async function getDueReminders(): Promise<Reminder[]> {
  return db.reminder.findMany({
    where: {
      status: "OPEN",
      dueAt: { lte: new Date() },
    },
    orderBy: { dueAt: "asc" },
  });
}

/**
 * List all reminders for an employee (optionally filtered by status).
 */
export async function getRemindersForEmployee(
  employeeId: string,
  status?: "OPEN" | "COMPLETED" | "CANCELLED",
): Promise<Reminder[]> {
  return db.reminder.findMany({
    where: { employeeId, ...(status ? { status } : {}) },
    orderBy: { dueAt: "asc" },
  });
}
