import type { ActionType, ActionRiskLevel } from "@hermes/contracts";

export interface ParsedProposal {
  actionType: ActionType;
  parameters: Record<string, unknown>;
  riskLevel: ActionRiskLevel;
  confirmationRequired: boolean;
}

export interface ProposalValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Risk level and confirmation requirements for each action type.
 * This is DETERMINISTIC — the model cannot change these.
 */
const ACTION_RISK: Record<ActionType, { risk: ActionRiskLevel; confirmation: boolean }> = {
  GMAIL_CREATE_DRAFT: { risk: "LOW", confirmation: false },
  GMAIL_UPDATE_DRAFT: { risk: "LOW", confirmation: false },
  GMAIL_SEND_DRAFT: { risk: "HIGH", confirmation: true },
  CALENDAR_FREEBUSY: { risk: "LOW", confirmation: false },
  CALENDAR_CREATE_PERSONAL_EVENT: { risk: "MEDIUM", confirmation: false },
  CALENDAR_CREATE_MEETING: { risk: "HIGH", confirmation: true },
  CALENDAR_UPDATE_EVENT: { risk: "LOW", confirmation: false },
  CALENDAR_CANCEL_EVENT: { risk: "MEDIUM", confirmation: true },
  REMINDER_CREATE: { risk: "LOW", confirmation: false },
  REMINDER_COMPLETE: { risk: "LOW", confirmation: false },
  REMINDER_DELETE: { risk: "LOW", confirmation: false },
};

const VALID_ACTION_TYPES = new Set<string>(Object.keys(ACTION_RISK));

export interface ParseProposalInput {
  actionType: string;
  parameters: Record<string, unknown>;
}

/**
 * Parse a model-generated action proposal into a structured proposal.
 *
 * The model can only SUGGEST actions — it cannot set the risk level or
 * bypass confirmation requirements. Those are determined deterministically
 * by the action type.
 */
export function parseActionProposal(input: ParseProposalInput): ParsedProposal {
  if (!VALID_ACTION_TYPES.has(input.actionType)) {
    throw new Error(`unknown action type: ${input.actionType}`);
  }

  const actionType = input.actionType as ActionType;
  const config = ACTION_RISK[actionType];

  return {
    actionType,
    parameters: input.parameters,
    riskLevel: config.risk,
    confirmationRequired: config.confirmation,
  };
}

/**
 * Validate a parsed proposal. This checks that all required fields are
 * present and valid. It also checks for injection attempts.
 */
export function validateProposal(proposal: ParsedProposal): ProposalValidationResult {
  const errors: string[] = [];

  switch (proposal.actionType) {
    case "GMAIL_CREATE_DRAFT":
    case "GMAIL_UPDATE_DRAFT":
      validateGmailDraft(proposal.parameters, errors);
      break;
    case "GMAIL_SEND_DRAFT":
      validateGmailSend(proposal.parameters, errors);
      break;
    case "CALENDAR_CREATE_PERSONAL_EVENT":
    case "CALENDAR_CREATE_MEETING":
      validateCalendarEvent(
        proposal.parameters,
        errors,
        proposal.actionType === "CALENDAR_CREATE_MEETING",
      );
      break;
    case "CALENDAR_FREEBUSY":
      validateFreeBusy(proposal.parameters, errors);
      break;
    case "CALENDAR_UPDATE_EVENT":
    case "CALENDAR_CANCEL_EVENT":
      validateCalendarEventRef(proposal.parameters, errors);
      break;
    case "REMINDER_CREATE":
      validateReminder(proposal.parameters, errors);
      break;
    case "REMINDER_COMPLETE":
    case "REMINDER_DELETE":
      validateReminderRef(proposal.parameters, errors);
      break;
    default:
      errors.push(`unknown action type: ${proposal.actionType}`);
  }

  return { valid: errors.length === 0, errors };
}

function validateGmailDraft(params: Record<string, unknown>, errors: string[]): void {
  if (!params.to) {
    errors.push("missing required field: to");
  } else if (typeof params.to !== "string" || !isValidEmail(params.to)) {
    errors.push("invalid email address in 'to' field");
  }
  if (checkHeaderInjection(params.to)) {
    errors.push("header injection attempt detected in 'to' field");
  }
  if (!params.subject) {
    errors.push("missing required field: subject");
  }
  if (!params.body) {
    errors.push("missing required field: body");
  }
}

function validateGmailSend(params: Record<string, unknown>, errors: string[]): void {
  if (!params.draftId) {
    errors.push("missing required field: draftId");
  }
}

function validateCalendarEvent(
  params: Record<string, unknown>,
  errors: string[],
  isMeeting: boolean,
): void {
  if (!params.summary) {
    errors.push("missing required field: summary");
  }
  if (!params.start) {
    errors.push("missing required field: start");
  }
  if (!params.end) {
    errors.push("missing required field: end");
  }
  if (params.start && params.end) {
    const start = new Date(params.start as string);
    const end = new Date(params.end as string);
    if (end < start) {
      errors.push("calendar event end before start");
    }
  }
  if (isMeeting) {
    const attendees = params.attendees;
    if (!attendees || !Array.isArray(attendees) || attendees.length === 0) {
      errors.push("meetings require at least one attendee in the attendees list");
    } else {
      for (const attendee of attendees) {
        if (typeof attendee !== "string" || !isValidEmail(attendee)) {
          errors.push(`invalid attendee email: ${attendee}`);
          break;
        }
      }
    }
  }
}

function validateFreeBusy(params: Record<string, unknown>, errors: string[]): void {
  if (!params.start) {
    errors.push("missing required field: start");
  }
  if (!params.end) {
    errors.push("missing required field: end");
  }
}

function validateCalendarEventRef(params: Record<string, unknown>, errors: string[]): void {
  if (!params.eventId) {
    errors.push("missing required field: eventId");
  }
}

function validateReminder(params: Record<string, unknown>, errors: string[]): void {
  if (!params.text) {
    errors.push("missing required field: text");
  }
  if (!params.dueAt) {
    errors.push("missing required field: dueAt");
  }
  if (!params.timezone) {
    errors.push("missing required field: timezone");
  }
}

function validateReminderRef(params: Record<string, unknown>, errors: string[]): void {
  if (!params.reminderId) {
    errors.push("missing required field: reminderId");
  }
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function checkHeaderInjection(value: unknown): boolean {
  if (typeof value !== "string") return false;
  return /[\r\n]/.test(value);
}
