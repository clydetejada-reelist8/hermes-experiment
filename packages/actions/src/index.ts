export {
  createAction,
  getAction,
  transitionAction,
  reconcileUnknownOutcome,
} from "./state-machine.js";
export type {
  CreateActionInput,
  TransitionExtras,
  ReconcileInput,
  Action,
  ActionStatus,
  ActionType,
  ActionRiskLevel,
} from "./state-machine.js";
export {
  GmailActionExecutor,
  AmbiguousOutcomeError,
  isAmbiguousOutcome,
  deterministicIdempotencyKey,
} from "./gmail.js";
export type {
  GmailProvider,
  CreateDraftActionInput,
  UpdateDraftActionInput,
  SendDraftActionInput,
} from "./gmail.js";
export { CalendarActionExecutor } from "./calendar.js";
export type {
  CalendarProvider,
  FreeBusyInput,
  FreeBusyResult,
  CreateEventInput,
  CreateMeetingInput,
  UpdateEventInput,
  CancelEventInput,
} from "./calendar.js";
export {
  createReminder,
  getReminder,
  completeReminder,
  cancelReminder,
  getDueReminders,
  getRemindersForEmployee,
} from "./reminders.js";
export type { CreateReminderInput, Reminder } from "./reminders.js";
export { parseActionProposal, validateProposal } from "./proposals.js";
export type { ParsedProposal, ProposalValidationResult, ParseProposalInput } from "./proposals.js";
export {
  computeParametersHash,
  verifyConfirmation,
  recordConfirmation,
  ConfirmationError,
} from "./confirmation.js";
