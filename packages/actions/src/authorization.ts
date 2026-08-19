import type { ActionType, Capability } from "@hermes/contracts";
import { evaluateCapability } from "@hermes/policy";
import { getFeatureFlag, isKillSwitchActive } from "@hermes/admin";

const ACTION_CAPABILITIES: Record<ActionType, Capability> = {
  GMAIL_CREATE_DRAFT: "GMAIL_DRAFT",
  GMAIL_UPDATE_DRAFT: "GMAIL_DRAFT",
  GMAIL_SEND_DRAFT: "GMAIL_SEND",
  CALENDAR_FREEBUSY: "CALENDAR_FREEBUSY",
  CALENDAR_CREATE_PERSONAL_EVENT: "CALENDAR_CREATE_PERSONAL_EVENT",
  CALENDAR_CREATE_MEETING: "CALENDAR_INVITE_OTHERS",
  CALENDAR_UPDATE_EVENT: "CALENDAR_UPDATE_EVENT",
  CALENDAR_CANCEL_EVENT: "CALENDAR_CANCEL_EVENT",
  REMINDER_CREATE: "REMINDERS_WRITE",
  REMINDER_COMPLETE: "REMINDERS_WRITE",
  REMINDER_DELETE: "REMINDERS_WRITE",
};

const ACTION_FLAGS: Partial<Record<ActionType, string>> = {
  GMAIL_CREATE_DRAFT: "gmail_draft_enabled",
  GMAIL_UPDATE_DRAFT: "gmail_draft_enabled",
  GMAIL_SEND_DRAFT: "gmail_send_enabled",
  CALENDAR_FREEBUSY: "calendar_read_enabled",
  CALENDAR_CREATE_PERSONAL_EVENT: "calendar_write_enabled",
  CALENDAR_CREATE_MEETING: "calendar_write_enabled",
  CALENDAR_UPDATE_EVENT: "calendar_write_enabled",
  CALENDAR_CANCEL_EVENT: "calendar_write_enabled",
  REMINDER_CREATE: "reminders_enabled",
  REMINDER_COMPLETE: "reminders_enabled",
  REMINDER_DELETE: "reminders_enabled",
};

export function capabilityForActionType(actionType: string): Capability {
  const capability = ACTION_CAPABILITIES[actionType as ActionType];
  if (!capability) throw new Error(`action_type_not_supported: ${actionType}`);
  return capability;
}

/**
 * Deterministic authorization gate used before both action preparation and
 * execution. A missing feature flag is treated as legacy/unconfigured and does
 * not disable existing staging behavior; an explicitly disabled flag does.
 */
export async function authorizeActionType(
  employeeId: string,
  actionType: string,
): Promise<void> {
  const capability = capabilityForActionType(actionType);
  const decision = await evaluateCapability(employeeId, capability);
  if (!decision.allowed) throw new Error("action_capability_denied");

  if (await isKillSwitchActive()) throw new Error("action_kill_switch_active");

  const flagKey = ACTION_FLAGS[actionType as ActionType];
  if (flagKey) {
    const flag = await getFeatureFlag(flagKey);
    if (flag && !flag.enabled) throw new Error("action_feature_disabled");
  }
}
