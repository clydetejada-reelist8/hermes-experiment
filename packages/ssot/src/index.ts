export {
  createProposal,
  getProposal,
  getProposalsByDomain,
  approveProposal,
  rejectProposal,
  requestChanges,
} from "./proposal.js";
export type {
  CreateProposalInput,
  ApproveProposalInput,
  ApproveProposalResult,
  RejectProposalInput,
  RequestChangesInput,
} from "./proposal.js";
export { detectContradictions } from "./contradiction.js";
export type { Contradiction, ContradictionResult } from "./contradiction.js";
