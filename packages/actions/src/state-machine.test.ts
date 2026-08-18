import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { createAction, transitionAction, reconcileUnknownOutcome } from "./state-machine.js";
import { createEmployee } from "../../../test/fixtures/db-helpers.js";

describe("action state machine", () => {
  it("creates an action in PROPOSED status", async () => {
    const emp = await createEmployee();
    const action = await createAction({
      employeeId: emp.id,
      type: "GMAIL_SEND_DRAFT",
      parametersJson: { to: "test@example.com", subject: "Test" },
      idempotencyKey: randomUUID(),
    });
    expect(action.status).toBe("PROPOSED");
    expect(action.confirmationRequired).toBe(false);
  });

  it("transitions PROPOSED → PREPARED", async () => {
    const emp = await createEmployee();
    const action = await createAction({
      employeeId: emp.id,
      type: "GMAIL_SEND_DRAFT",
      parametersJson: {},
      idempotencyKey: randomUUID(),
    });
    const updated = await transitionAction(action.id, "PREPARED");
    expect(updated.status).toBe("PREPARED");
  });

  it("transitions PREPARED → AWAITING_CONFIRMATION for high-risk actions", async () => {
    const emp = await createEmployee();
    const action = await createAction({
      employeeId: emp.id,
      type: "GMAIL_SEND_DRAFT",
      parametersJson: {},
      idempotencyKey: randomUUID(),
      riskLevel: "HIGH",
      confirmationRequired: true,
    });
    const prepared = await transitionAction(action.id, "PREPARED");
    const awaiting = await transitionAction(prepared.id, "AWAITING_CONFIRMATION");
    expect(awaiting.status).toBe("AWAITING_CONFIRMATION");
  });

  it("transitions AWAITING_CONFIRMATION → EXECUTING after confirmation", async () => {
    const emp = await createEmployee();
    const action = await createAction({
      employeeId: emp.id,
      type: "GMAIL_SEND_DRAFT",
      parametersJson: {},
      idempotencyKey: randomUUID(),
      riskLevel: "HIGH",
      confirmationRequired: true,
    });
    await transitionAction(action.id, "PREPARED");
    await transitionAction(action.id, "AWAITING_CONFIRMATION");
    const executing = await transitionAction(action.id, "EXECUTING");
    expect(executing.status).toBe("EXECUTING");
  });

  it("transitions EXECUTING → SUCCEEDED", async () => {
    const emp = await createEmployee();
    const action = await createAction({
      employeeId: emp.id,
      type: "GMAIL_SEND_DRAFT",
      parametersJson: {},
      idempotencyKey: randomUUID(),
    });
    await transitionAction(action.id, "PREPARED");
    await transitionAction(action.id, "EXECUTING");
    const succeeded = await transitionAction(action.id, "SUCCEEDED", {
      externalResourceId: "msg-123",
      externalResultJson: { sent: true },
    });
    expect(succeeded.status).toBe("SUCCEEDED");
    expect(succeeded.externalResourceId).toBe("msg-123");
    expect(succeeded.executedAt).toBeTruthy();
  });

  it("transitions EXECUTING → FAILED with error code", async () => {
    const emp = await createEmployee();
    const action = await createAction({
      employeeId: emp.id,
      type: "GMAIL_SEND_DRAFT",
      parametersJson: {},
      idempotencyKey: randomUUID(),
    });
    await transitionAction(action.id, "PREPARED");
    await transitionAction(action.id, "EXECUTING");
    const failed = await transitionAction(action.id, "FAILED", {
      errorCode: "GMAIL_API_ERROR",
    });
    expect(failed.status).toBe("FAILED");
    expect(failed.errorCode).toBe("GMAIL_API_ERROR");
  });

  it("transitions EXECUTING → OUTCOME_UNKNOWN", async () => {
    const emp = await createEmployee();
    const action = await createAction({
      employeeId: emp.id,
      type: "GMAIL_SEND_DRAFT",
      parametersJson: {},
      idempotencyKey: randomUUID(),
    });
    await transitionAction(action.id, "PREPARED");
    await transitionAction(action.id, "EXECUTING");
    const unknown = await transitionAction(action.id, "OUTCOME_UNKNOWN");
    expect(unknown.status).toBe("OUTCOME_UNKNOWN");
  });

  it("rejects invalid transitions", async () => {
    const emp = await createEmployee();
    const action = await createAction({
      employeeId: emp.id,
      type: "GMAIL_SEND_DRAFT",
      parametersJson: {},
      idempotencyKey: randomUUID(),
    });
    // PROPOSED → SUCCEEDED is invalid (must go through PREPARED → EXECUTING)
    await expect(transitionAction(action.id, "SUCCEEDED")).rejects.toThrow();
  });

  it("rejects PROPOSED → EXECUTING without PREPARED", async () => {
    const emp = await createEmployee();
    const action = await createAction({
      employeeId: emp.id,
      type: "GMAIL_SEND_DRAFT",
      parametersJson: {},
      idempotencyKey: randomUUID(),
    });
    await expect(transitionAction(action.id, "EXECUTING")).rejects.toThrow();
  });

  it("allows cancelling from PROPOSED or AWAITING_CONFIRMATION", async () => {
    const emp = await createEmployee();
    const action = await createAction({
      employeeId: emp.id,
      type: "GMAIL_SEND_DRAFT",
      parametersJson: {},
      idempotencyKey: randomUUID(),
      riskLevel: "HIGH",
      confirmationRequired: true,
    });
    await transitionAction(action.id, "PREPARED");
    await transitionAction(action.id, "AWAITING_CONFIRMATION");
    const cancelled = await transitionAction(action.id, "CANCELLED");
    expect(cancelled.status).toBe("CANCELLED");
  });

  it("reconciles OUTCOME_UNKNOWN → SUCCEEDED", async () => {
    const emp = await createEmployee();
    const action = await createAction({
      employeeId: emp.id,
      type: "GMAIL_SEND_DRAFT",
      parametersJson: {},
      idempotencyKey: randomUUID(),
    });
    await transitionAction(action.id, "PREPARED");
    await transitionAction(action.id, "EXECUTING");
    await transitionAction(action.id, "OUTCOME_UNKNOWN");

    const reconciled = await reconcileUnknownOutcome(action.id, {
      finalStatus: "SUCCEEDED",
      externalResourceId: "msg-456",
    });
    expect(reconciled.status).toBe("SUCCEEDED");
    expect(reconciled.reconciledAt).toBeTruthy();
  });

  it("reconciles OUTCOME_UNKNOWN → FAILED", async () => {
    const emp = await createEmployee();
    const action = await createAction({
      employeeId: emp.id,
      type: "GMAIL_SEND_DRAFT",
      parametersJson: {},
      idempotencyKey: randomUUID(),
    });
    await transitionAction(action.id, "PREPARED");
    await transitionAction(action.id, "EXECUTING");
    await transitionAction(action.id, "OUTCOME_UNKNOWN");

    const reconciled = await reconcileUnknownOutcome(action.id, {
      finalStatus: "FAILED",
      errorCode: "TIMEOUT",
    });
    expect(reconciled.status).toBe("FAILED");
    expect(reconciled.reconciledAt).toBeTruthy();
  });

  it("cannot reconcile from non-OUTCOME_UNKNOWN status", async () => {
    const emp = await createEmployee();
    const action = await createAction({
      employeeId: emp.id,
      type: "GMAIL_SEND_DRAFT",
      parametersJson: {},
      idempotencyKey: randomUUID(),
    });
    await transitionAction(action.id, "PREPARED");
    await transitionAction(action.id, "EXECUTING");
    await transitionAction(action.id, "SUCCEEDED");

    await expect(reconcileUnknownOutcome(action.id, { finalStatus: "FAILED" })).rejects.toThrow();
  });
});
