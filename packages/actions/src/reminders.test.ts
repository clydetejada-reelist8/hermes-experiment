import { describe, expect, it } from "vitest";
import {
  createReminder,
  getReminder,
  completeReminder,
  cancelReminder,
  getDueReminders,
  getRemindersForEmployee,
} from "./reminders.js";
import { createEmployee } from "../../../test/fixtures/db-helpers.js";

describe("reminders", () => {
  it("creates a reminder", async () => {
    const emp = await createEmployee();
    const reminder = await createReminder({
      employeeId: emp.id,
      text: "Submit timesheet",
      dueAt: new Date(Date.now() + 3600_000),
      timezone: "America/Los_Angeles",
    });
    expect(reminder.id).toBeTruthy();
    expect(reminder.status).toBe("OPEN");
    expect(reminder.text).toBe("Submit timesheet");
  });

  it("completes a reminder", async () => {
    const emp = await createEmployee();
    const reminder = await createReminder({
      employeeId: emp.id,
      text: "Call client",
      dueAt: new Date(Date.now() + 3600_000),
      timezone: "UTC",
    });
    const completed = await completeReminder(reminder.id);
    expect(completed.status).toBe("COMPLETED");
    expect(completed.completedAt).toBeTruthy();
  });

  it("cancels a reminder", async () => {
    const emp = await createEmployee();
    const reminder = await createReminder({
      employeeId: emp.id,
      text: "Cancel me",
      dueAt: new Date(Date.now() + 3600_000),
      timezone: "UTC",
    });
    const cancelled = await cancelReminder(reminder.id);
    expect(cancelled.status).toBe("CANCELLED");
  });

  it("gets due reminders", async () => {
    const emp = await createEmployee();
    const pastDate = new Date(Date.now() - 3600_000);
    await createReminder({
      employeeId: emp.id,
      text: "Overdue reminder",
      dueAt: pastDate,
      timezone: "UTC",
    });
    const due = await getDueReminders();
    expect(due.some((r) => r.text === "Overdue reminder")).toBe(true);
  });

  it("does not return completed reminders as due", async () => {
    const emp = await createEmployee();
    const pastDate = new Date(Date.now() - 3600_000);
    const reminder = await createReminder({
      employeeId: emp.id,
      text: "Completed overdue",
      dueAt: pastDate,
      timezone: "UTC",
    });
    await completeReminder(reminder.id);
    const due = await getDueReminders();
    expect(due.some((r) => r.id === reminder.id)).toBe(false);
  });

  it("lists reminders for an employee", async () => {
    const emp = await createEmployee();
    await createReminder({
      employeeId: emp.id,
      text: "My reminder",
      dueAt: new Date(Date.now() + 3600_000),
      timezone: "UTC",
    });
    const reminders = await getRemindersForEmployee(emp.id);
    expect(reminders.some((r) => r.text === "My reminder")).toBe(true);
  });

  it("gets a reminder by ID", async () => {
    const emp = await createEmployee();
    const reminder = await createReminder({
      employeeId: emp.id,
      text: "Find me",
      dueAt: new Date(Date.now() + 3600_000),
      timezone: "UTC",
    });
    const found = await getReminder(reminder.id);
    expect(found?.text).toBe("Find me");
  });
});
