import { z } from "zod";
import {
  ConversationTypeEnum,
  AudienceClassificationEnum,
  ArtifactScopeEnum,
  KnowledgeStatusEnum,
  DataSensitivityEnum,
  MemoryTypeEnum,
  MemorySensitivityEnum,
  MemoryStatusEnum,
  ActionStatusEnum,
} from "@hermes/contracts";

// ---------------------------------------------------------------------------
// Query-param schemas
// ---------------------------------------------------------------------------

export const IdentityResolveQuery = z.object({
  discordUserId: z.string().min(1),
});

export const ArtifactsListQuery = z.object({
  employeeId: z.string().min(1).optional(),
});

export const MemoryListQuery = z.object({
  employeeId: z.string().min(1).optional(),
});

export const SsotProposalsListQuery = z.object({
  domain: z.string().min(1).optional(),
});

export const GoogleCallbackQuery = z.object({
  code: z.string().min(1),
  state: z.string().min(1),
});

export const GoogleConnectionQuery = z.object({
  employeeId: z.string().min(1),
});

export const MeQuery = z.object({
  employeeId: z.string().min(1),
});

export const AdminFlagsGetQuery = z.object({
  updatedBy: z.string().min(1),
});

export const AdminAuditEventsQuery = z.object({
  employeeId: z.string().min(1),
  limit: z.coerce.number().int().positive().max(1000).optional(),
  offset: z.coerce.number().int().nonnegative().optional(),
});

// ---------------------------------------------------------------------------
// Body schemas
// ---------------------------------------------------------------------------

export const CreateConversationBody = z.object({
  initiatorEmployeeId: z.string().min(1).optional(),
  type: z.enum(ConversationTypeEnum),
  discordThreadId: z.string().min(1).optional(),
  audienceClassification: z.enum(AudienceClassificationEnum).optional(),
});

export const AppendMessageBody = z.object({
  role: z.string().min(1),
  content: z.string().min(1),
  employeeId: z.string().min(1).optional(),
});

export const AskBody = z.object({
  employeeId: z.string().min(1),
  employeeName: z.string().min(1).optional(),
  query: z.string().min(1),
  conversationId: z.string().min(1),
  audience: z.string().min(1).optional(),
});

export const ArtifactUploadBody = z.object({
  submittedByEmployeeId: z.string().min(1),
  originalFilename: z.string().min(1),
  mimeType: z.string().min(1),
  content: z.string().min(1),
  sourceSystem: z.string().min(1),
  externalId: z.string().min(1).optional(),
  teamId: z.string().min(1).optional(),
  projectId: z.string().min(1).optional(),
});

export const AddMemoryBody = z.object({
  employeeId: z.string().min(1),
  content: z.string().min(1),
  type: z.enum(MemoryTypeEnum),
  sensitivity: z.enum(MemorySensitivityEnum).optional(),
});

export const UpdateMemoryBody = z.object({
  content: z.string().min(1).optional(),
  sensitivity: z.enum(MemorySensitivityEnum).optional(),
  status: z.enum(MemoryStatusEnum).optional(),
});

export const CreateSsotProposalBody = z.object({
  proposedByEmployeeId: z.string().min(1),
  authorityDomain: z.string().min(1),
  title: z.string().min(1),
  proposedContent: z.string().min(1),
  ssotRecordId: z.string().min(1).optional(),
  sourceArtifactIds: z.array(z.string().min(1)).optional(),
});

export const CreateActionBody = z.object({
  employeeId: z.string().min(1),
  actionType: z.string().min(1),
  parameters: z.record(z.string(), z.unknown()),
  conversationId: z.string().min(1).optional(),
});

export const ConfirmActionBody = z.object({
  employeeId: z.string().min(1),
});

export const TransitionActionBody = z.object({
  newStatus: z.enum(ActionStatusEnum),
});

export const SetFlagBody = z.object({
  enabled: z.boolean(),
  updatedBy: z.string().min(1),
});

export const KillSwitchBody = z.object({
  updatedBy: z.string().min(1),
});

export const SetRetentionBody = z.object({
  retentionDays: z.number().int().positive(),
  updatedBy: z.string().min(1),
});

export const ApplyRetentionBody = z.object({
  updatedBy: z.string().min(1),
});

// ---------------------------------------------------------------------------
// New route body schemas
// ---------------------------------------------------------------------------

export const GoogleConnectUrlBody = z.object({
  employeeId: z.string().min(1),
});

export const GoogleConnectionDeleteBody = z.object({
  employeeId: z.string().min(1),
});

export const ArtifactLinkDriveBody = z.object({
  submittedByEmployeeId: z.string().min(1),
  driveFileId: z.string().min(1),
  canonicalUrl: z.string().min(1),
  mimeType: z.string().min(1),
  originalFilename: z.string().min(1).optional(),
  scope: z.enum(ArtifactScopeEnum).optional(),
  teamId: z.string().min(1).optional(),
  projectId: z.string().min(1).optional(),
});

export const ClassifySubmissionBody = z.object({
  scope: z.enum(ArtifactScopeEnum),
  dataSensitivity: z.enum(DataSensitivityEnum),
  knowledgeStatus: z.enum(KnowledgeStatusEnum),
  employeeId: z.string().min(1),
});

export const ImportManagedSnapshotBody = z.object({
  employeeId: z.string().min(1),
  scope: z.enum(ArtifactScopeEnum),
  teamId: z.string().min(1).optional(),
  projectId: z.string().min(1).optional(),
  knowledgeStatus: z.enum(KnowledgeStatusEnum),
  dataSensitivity: z.enum(DataSensitivityEnum).optional(),
});

export const ApproveProposalBody = z.object({
  approvedByEmployeeId: z.string().min(1),
});

export const RejectProposalBody = z.object({
  rejectedByEmployeeId: z.string().min(1),
});

export const RequestChangesBody = z.object({
  requestedByEmployeeId: z.string().min(1),
});

export const ExecuteActionBody = z.object({
  employeeId: z.string().min(1),
});

export const CancelActionBody = z.object({
  employeeId: z.string().min(1),
});

export const MemoryCaptureBody = z.object({
  enabled: z.boolean(),
});
