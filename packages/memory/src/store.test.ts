import { describe, expect, it } from "vitest";
import { addMemory, getMemories, getVisibleMemories, updateMemory, deleteMemory } from "./store.js";
import { createEmployee } from "../../../test/fixtures/db-helpers.js";

describe("personal memory store", () => {
  it("adds and retrieves a memory", async () => {
    const emp = await createEmployee();
    const memory = await addMemory({
      employeeId: emp.id,
      content: "Prefers morning meetings.",
      type: "PREFERENCE",
    });
    expect(memory.id).toBeTruthy();
    expect(memory.content).toBe("Prefers morning meetings.");
    expect(memory.sensitivity).toBe("NORMAL");
    expect(memory.type).toBe("PREFERENCE");

    const memories = await getMemories(emp.id);
    expect(memories.length).toBeGreaterThanOrEqual(1);
    expect(memories.some((m) => m.content === "Prefers morning meetings.")).toBe(true);
  });

  it("auto-classifies sensitivity on add", async () => {
    const emp = await createEmployee();
    const memory = await addMemory({
      employeeId: emp.id,
      content: "Salary is $95,000 per year.",
      type: "PERSONAL_NOTE",
    });
    expect(memory.sensitivity).toBe("SENSITIVE");
  });

  it("hides HIGHLY_SENSITIVE memories from visible retrieval", async () => {
    const emp = await createEmployee();
    const memory = await addMemory({
      employeeId: emp.id,
      content: "SSN: 123-45-6789",
      type: "PERSONAL_NOTE",
    });
    expect(memory.sensitivity).toBe("HIGHLY_SENSITIVE");

    const visible = await getVisibleMemories(emp.id);
    expect(visible.every((m) => m.id !== memory.id)).toBe(true);

    // But it should still appear in getMemories (which includes all)
    const all = await getMemories(emp.id);
    expect(all.some((m) => m.id === memory.id)).toBe(true);
  });

  it("updates a memory", async () => {
    const emp = await createEmployee();
    const memory = await addMemory({
      employeeId: emp.id,
      content: "Likes coffee.",
      type: "PREFERENCE",
    });
    const updated = await updateMemory(memory.id, {
      content: "Likes tea.",
    });
    expect(updated.content).toBe("Likes tea.");
  });

  it("soft-deletes a memory", async () => {
    const emp = await createEmployee();
    const memory = await addMemory({
      employeeId: emp.id,
      content: "Temporary note.",
      type: "PERSONAL_NOTE",
    });
    await deleteMemory(memory.id);
    const memories = await getMemories(emp.id);
    expect(memories.every((m) => m.id !== memory.id)).toBe(true);
  });

  it("does not return memories for a different employee", async () => {
    const emp1 = await createEmployee();
    const emp2 = await createEmployee();
    await addMemory({
      employeeId: emp1.id,
      content: "Emp1 private note.",
      type: "PERSONAL_NOTE",
    });
    const emp2Memories = await getMemories(emp2.id);
    expect(emp2Memories.every((m) => m.content !== "Emp1 private note.")).toBe(true);
  });
});
