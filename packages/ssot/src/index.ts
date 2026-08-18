export {
  createProposal,
  getProposal,
  getProposalsByDomain,
  approveProposal,
  rejectProposal,
  requestChanges,
  getReviewQueueForEmployee,
  approveProposalAsReviewer,
  rejectProposalAsReviewer,
  requestChangesAsReviewer,
} from "./proposal.js";
export type {
  CreateProposalInput,
  ApproveProposalInput,
  ApproveProposalResult,
  RejectProposalInput,
  RequestChangesInput,
  ReviewQueueProposal,
  ReviewActionInput,
  ReviewActionResult,
} from "./proposal.js";
export { detectContradictions } from "./contradiction.js";
export type { Contradiction, ContradictionResult } from "./contradiction.js";
export { importSSOTContent, ssotSubjectKey } from "./import.js";
export type { ImportSSOTContentInput, ImportSSOTContentResult } from "./import.js";
export { getSSOTDocumentForEmployee } from "./document.js";
export type { SSOTDocument } from "./document.js";
