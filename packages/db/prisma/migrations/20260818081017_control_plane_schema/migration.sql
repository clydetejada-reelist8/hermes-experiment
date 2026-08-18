-- CreateEnum
CREATE TYPE "EmploymentStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'TERMINATED');

-- CreateEnum
CREATE TYPE "IdentityProvider" AS ENUM ('DISCORD', 'GOOGLE', 'GITHUB');

-- CreateEnum
CREATE TYPE "OAuthStatus" AS ENUM ('ACTIVE', 'REVOKED', 'ERROR');

-- CreateEnum
CREATE TYPE "ConversationType" AS ENUM ('ASK', 'UPLOAD', 'ACTION', 'SSOT_REVIEW');

-- CreateEnum
CREATE TYPE "AudienceClassification" AS ENUM ('PRIVATE', 'TEAM', 'COMPANY');

-- CreateEnum
CREATE TYPE "ArtifactMode" AS ENUM ('IMPORTED', 'LINKED');

-- CreateEnum
CREATE TYPE "ArtifactScope" AS ENUM ('THREAD_ONLY', 'PERSONAL', 'PROJECT', 'TEAM', 'COMPANY');

-- CreateEnum
CREATE TYPE "KnowledgeStatus" AS ENUM ('PERSONAL_CONTEXT', 'REFERENCE', 'PROPOSAL', 'PENDING_REVIEW', 'OFFICIAL', 'HISTORICAL', 'DISCUSSION', 'INFERENCE');

-- CreateEnum
CREATE TYPE "DataSensitivity" AS ENUM ('NORMAL', 'SENSITIVE', 'HIGHLY_SENSITIVE');

-- CreateEnum
CREATE TYPE "SourceAccessState" AS ENUM ('ALLOWED', 'DENIED', 'ERROR', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "SyncState" AS ENUM ('NOT_REQUIRED', 'PENDING', 'SYNCED', 'AUTH_REQUIRED', 'DELETED', 'ERROR');

-- CreateEnum
CREATE TYPE "MemoryType" AS ENUM ('PREFERENCE', 'RESPONSIBILITY', 'ACTIVE_PROJECT', 'COLLABORATOR', 'COMMITMENT', 'PERSONAL_NOTE');

-- CreateEnum
CREATE TYPE "MemorySensitivity" AS ENUM ('NORMAL', 'SENSITIVE', 'HIGHLY_SENSITIVE');

-- CreateEnum
CREATE TYPE "MemoryStatus" AS ENUM ('ACTIVE', 'EXPIRED', 'DELETED');

-- CreateEnum
CREATE TYPE "ProjectStatus" AS ENUM ('ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "AuthorityPermission" AS ENUM ('REVIEW', 'APPROVE');

-- CreateEnum
CREATE TYPE "Capability" AS ENUM ('KNOWLEDGE_READ_PERSONAL', 'KNOWLEDGE_READ_TEAM', 'KNOWLEDGE_READ_COMPANY', 'ARTIFACT_UPLOAD', 'ARTIFACT_SHARE_TEAM', 'ARTIFACT_SHARE_COMPANY', 'SSOT_PROPOSE', 'SSOT_REVIEW', 'SSOT_APPROVE', 'MEMORY_READ_OWN', 'MEMORY_WRITE_OWN', 'GMAIL_DRAFT', 'GMAIL_SEND', 'CALENDAR_FREEBUSY', 'CALENDAR_CREATE_PERSONAL_EVENT', 'CALENDAR_INVITE_OTHERS', 'CALENDAR_UPDATE_EVENT', 'CALENDAR_CANCEL_EVENT', 'HERMES_ADMIN');

-- CreateEnum
CREATE TYPE "SSOTProposalStatus" AS ENUM ('AWAITING_REVIEW', 'CHANGES_REQUESTED', 'REJECTED', 'APPROVED');

-- CreateEnum
CREATE TYPE "EvidenceSourceType" AS ENUM ('ARTIFACT_VERSION', 'SSOT_VERSION');

-- CreateEnum
CREATE TYPE "ActionType" AS ENUM ('GMAIL_CREATE_DRAFT', 'GMAIL_UPDATE_DRAFT', 'GMAIL_SEND_DRAFT', 'CALENDAR_FREEBUSY', 'CALENDAR_CREATE_PERSONAL_EVENT', 'CALENDAR_CREATE_MEETING', 'CALENDAR_UPDATE_EVENT', 'CALENDAR_CANCEL_EVENT', 'REMINDER_CREATE', 'REMINDER_COMPLETE', 'REMINDER_DELETE');

-- CreateEnum
CREATE TYPE "ActionRiskLevel" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'PRIVILEGED');

-- CreateEnum
CREATE TYPE "ActionStatus" AS ENUM ('PROPOSED', 'PREPARED', 'AWAITING_CONFIRMATION', 'EXECUTING', 'SUCCEEDED', 'FAILED', 'PARTIALLY_SUCCEEDED', 'OUTCOME_UNKNOWN', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ReminderStatus" AS ENUM ('OPEN', 'COMPLETED', 'CANCELLED');

-- CreateTable
CREATE TABLE "Employee" (
    "id" TEXT NOT NULL,
    "employeeCode" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "companyEmail" TEXT NOT NULL,
    "timezone" TEXT NOT NULL,
    "managerEmployeeId" TEXT,
    "employmentStatus" "EmploymentStatus" NOT NULL DEFAULT 'ACTIVE',
    "stagingAllowlisted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Employee_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExternalIdentity" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "provider" "IdentityProvider" NOT NULL,
    "providerSubjectId" TEXT NOT NULL,
    "providerEmail" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExternalIdentity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Team" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Team_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmployeeTeam" (
    "employeeId" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmployeeTeam_pkey" PRIMARY KEY ("employeeId","teamId")
);

-- CreateTable
CREATE TABLE "Project" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "ProjectStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectMember" (
    "employeeId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectMember_pkey" PRIMARY KEY ("employeeId","projectId")
);

-- CreateTable
CREATE TABLE "Role" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Role_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RoleCapability" (
    "roleId" TEXT NOT NULL,
    "capability" "Capability" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RoleCapability_pkey" PRIMARY KEY ("roleId","capability")
);

-- CreateTable
CREATE TABLE "EmployeeRole" (
    "employeeId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "activeFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "activeUntil" TIMESTAMP(3),

    CONSTRAINT "EmployeeRole_pkey" PRIMARY KEY ("employeeId","roleId")
);

-- CreateTable
CREATE TABLE "OAuthConnection" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "provider" "IdentityProvider" NOT NULL DEFAULT 'GOOGLE',
    "providerAccountId" TEXT NOT NULL,
    "providerEmail" TEXT,
    "hostedDomain" TEXT,
    "encryptedRefreshToken" TEXT,
    "accessTokenExpiresAt" TIMESTAMP(3),
    "grantedScopes" TEXT[],
    "status" "OAuthStatus" NOT NULL DEFAULT 'ACTIVE',
    "lastVerifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OAuthConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OAuthAuthorizationState" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "provider" "IdentityProvider" NOT NULL DEFAULT 'GOOGLE',
    "state" TEXT NOT NULL,
    "requestedScopes" TEXT[],
    "redirectTarget" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "connectionId" TEXT,

    CONSTRAINT "OAuthAuthorizationState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Conversation" (
    "id" TEXT NOT NULL,
    "discordGuildId" TEXT,
    "discordParentChannelId" TEXT,
    "discordThreadId" TEXT,
    "initiatorEmployeeId" TEXT,
    "conversationType" "ConversationType" NOT NULL,
    "audienceClassification" "AudienceClassification" NOT NULL DEFAULT 'PRIVATE',
    "memoryCaptureEnabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),

    CONSTRAINT "Conversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConversationMessage" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "employeeId" TEXT,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "providerMessageId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConversationMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InboundEventReceipt" (
    "id" TEXT NOT NULL,
    "provider" "IdentityProvider" NOT NULL,
    "providerEventId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InboundEventReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Artifact" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "mode" "ArtifactMode" NOT NULL,
    "sourceSystem" TEXT NOT NULL,
    "externalId" TEXT,
    "canonicalUrl" TEXT,
    "originalFilename" TEXT,
    "mimeType" TEXT,
    "syncState" "SyncState" NOT NULL DEFAULT 'NOT_REQUIRED',
    "currentVersionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Artifact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ArtifactVersion" (
    "id" TEXT NOT NULL,
    "artifactId" TEXT NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "sourceVersionId" TEXT,
    "contentHash" TEXT NOT NULL,
    "extractedTextObjectKey" TEXT,
    "sourceModifiedAt" TIMESTAMP(3),
    "effectiveFrom" TIMESTAMP(3),
    "effectiveUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ArtifactVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ArtifactSubmission" (
    "id" TEXT NOT NULL,
    "artifactId" TEXT NOT NULL,
    "submittedByEmployeeId" TEXT NOT NULL,
    "ownerEmployeeId" TEXT,
    "scope" "ArtifactScope" NOT NULL,
    "projectId" TEXT,
    "teamId" TEXT,
    "knowledgeStatus" "KnowledgeStatus" NOT NULL,
    "authorityDomain" TEXT,
    "dataSensitivity" "DataSensitivity" NOT NULL DEFAULT 'NORMAL',
    "sourceAccessMode" TEXT NOT NULL DEFAULT 'HERMES_MANAGED',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ArtifactSubmission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SourceAccessGrant" (
    "id" TEXT NOT NULL,
    "artifactId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "state" "SourceAccessState" NOT NULL DEFAULT 'UNKNOWN',
    "verifiedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SourceAccessGrant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KnowledgeChunk" (
    "id" TEXT NOT NULL,
    "sourceType" "EvidenceSourceType" NOT NULL,
    "artifactVersionId" TEXT,
    "ssotVersionId" TEXT,
    "chunkIndex" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "textSearchDocument" TEXT,
    "embedding" vector(1536),
    "tokenEstimate" INTEGER NOT NULL,
    "pageNumber" INTEGER,
    "sheetName" TEXT,
    "sourceLocator" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KnowledgeChunk_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PersonalMemory" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "type" "MemoryType" NOT NULL,
    "content" TEXT NOT NULL,
    "normalizedKey" TEXT,
    "sourceConversationId" TEXT,
    "sourceMessageId" TEXT,
    "sourceArtifactId" TEXT,
    "confidence" DECIMAL(4,3) NOT NULL,
    "sensitivity" "MemorySensitivity" NOT NULL DEFAULT 'NORMAL',
    "status" "MemoryStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastConfirmedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "PersonalMemory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuthorityDomain" (
    "domain" TEXT NOT NULL,
    "name" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuthorityDomain_pkey" PRIMARY KEY ("domain")
);

-- CreateTable
CREATE TABLE "DomainAuthority" (
    "id" TEXT NOT NULL,
    "authorityDomain" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "permission" "AuthorityPermission" NOT NULL,
    "activeFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "activeUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DomainAuthority_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SSOTRecord" (
    "id" TEXT NOT NULL,
    "authorityDomain" TEXT NOT NULL,
    "subjectKey" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "ownerEmployeeId" TEXT,
    "currentVersionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SSOTRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SSOTVersion" (
    "id" TEXT NOT NULL,
    "ssotRecordId" TEXT NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "sourceArtifactId" TEXT,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "effectiveUntil" TIMESTAMP(3),
    "approvedByEmployeeId" TEXT NOT NULL,
    "approvedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "supersedesVersionId" TEXT,
    "indexedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SSOTVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SSOTProposal" (
    "id" TEXT NOT NULL,
    "ssotRecordId" TEXT,
    "proposedByEmployeeId" TEXT NOT NULL,
    "authorityDomain" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "proposedContent" TEXT NOT NULL,
    "reviewConversationId" TEXT,
    "status" "SSOTProposalStatus" NOT NULL DEFAULT 'AWAITING_REVIEW',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "SSOTProposal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SSOTProposalSource" (
    "id" TEXT NOT NULL,
    "proposalId" TEXT NOT NULL,
    "artifactId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SSOTProposalSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Action" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "conversationId" TEXT,
    "type" "ActionType" NOT NULL,
    "provider" TEXT,
    "riskLevel" "ActionRiskLevel" NOT NULL DEFAULT 'LOW',
    "parametersJson" JSONB NOT NULL,
    "status" "ActionStatus" NOT NULL DEFAULT 'PROPOSED',
    "confirmationRequired" BOOLEAN NOT NULL DEFAULT false,
    "idempotencyKey" TEXT NOT NULL,
    "externalResourceId" TEXT,
    "externalResultJson" JSONB,
    "errorCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "executedAt" TIMESTAMP(3),
    "reconciledAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Action_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ActionConfirmation" (
    "id" TEXT NOT NULL,
    "actionId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "confirmationType" TEXT NOT NULL DEFAULT 'DISCORD_BUTTON',
    "confirmedParametersHash" TEXT NOT NULL,
    "confirmedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ActionConfirmation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Reminder" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "conversationId" TEXT,
    "text" TEXT NOT NULL,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "timezone" TEXT NOT NULL,
    "status" "ReminderStatus" NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "Reminder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "employeeId" TEXT,
    "conversationId" TEXT,
    "resourceType" TEXT,
    "resourceId" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeatureFlag" (
    "key" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,

    CONSTRAINT "FeatureFlag_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "Employee_employeeCode_key" ON "Employee"("employeeCode");

-- CreateIndex
CREATE UNIQUE INDEX "Employee_companyEmail_key" ON "Employee"("companyEmail");

-- CreateIndex
CREATE INDEX "Employee_employmentStatus_stagingAllowlisted_idx" ON "Employee"("employmentStatus", "stagingAllowlisted");

-- CreateIndex
CREATE INDEX "ExternalIdentity_provider_providerSubjectId_idx" ON "ExternalIdentity"("provider", "providerSubjectId");

-- CreateIndex
CREATE INDEX "ExternalIdentity_employeeId_idx" ON "ExternalIdentity"("employeeId");

-- CreateIndex
CREATE UNIQUE INDEX "ExternalIdentity_provider_providerSubjectId_key" ON "ExternalIdentity"("provider", "providerSubjectId");

-- CreateIndex
CREATE INDEX "EmployeeTeam_teamId_idx" ON "EmployeeTeam"("teamId");

-- CreateIndex
CREATE UNIQUE INDEX "Project_key_key" ON "Project"("key");

-- CreateIndex
CREATE INDEX "ProjectMember_projectId_idx" ON "ProjectMember"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "Role_key_key" ON "Role"("key");

-- CreateIndex
CREATE INDEX "RoleCapability_capability_idx" ON "RoleCapability"("capability");

-- CreateIndex
CREATE INDEX "EmployeeRole_roleId_idx" ON "EmployeeRole"("roleId");

-- CreateIndex
CREATE INDEX "OAuthConnection_employeeId_provider_idx" ON "OAuthConnection"("employeeId", "provider");

-- CreateIndex
CREATE UNIQUE INDEX "OAuthConnection_provider_providerAccountId_key" ON "OAuthConnection"("provider", "providerAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "OAuthAuthorizationState_state_key" ON "OAuthAuthorizationState"("state");

-- CreateIndex
CREATE INDEX "OAuthAuthorizationState_employeeId_provider_idx" ON "OAuthAuthorizationState"("employeeId", "provider");

-- CreateIndex
CREATE INDEX "Conversation_initiatorEmployeeId_idx" ON "Conversation"("initiatorEmployeeId");

-- CreateIndex
CREATE INDEX "Conversation_discordThreadId_idx" ON "Conversation"("discordThreadId");

-- CreateIndex
CREATE UNIQUE INDEX "ConversationMessage_providerMessageId_key" ON "ConversationMessage"("providerMessageId");

-- CreateIndex
CREATE INDEX "ConversationMessage_conversationId_createdAt_idx" ON "ConversationMessage"("conversationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "InboundEventReceipt_provider_providerEventId_key" ON "InboundEventReceipt"("provider", "providerEventId");

-- CreateIndex
CREATE INDEX "Artifact_sourceSystem_externalId_idx" ON "Artifact"("sourceSystem", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "Artifact_sourceSystem_externalId_key" ON "Artifact"("sourceSystem", "externalId");

-- CreateIndex
CREATE INDEX "ArtifactVersion_artifactId_idx" ON "ArtifactVersion"("artifactId");

-- CreateIndex
CREATE UNIQUE INDEX "ArtifactVersion_artifactId_versionNumber_key" ON "ArtifactVersion"("artifactId", "versionNumber");

-- CreateIndex
CREATE INDEX "ArtifactSubmission_submittedByEmployeeId_scope_active_idx" ON "ArtifactSubmission"("submittedByEmployeeId", "scope", "active");

-- CreateIndex
CREATE INDEX "ArtifactSubmission_scope_active_idx" ON "ArtifactSubmission"("scope", "active");

-- CreateIndex
CREATE INDEX "ArtifactSubmission_projectId_idx" ON "ArtifactSubmission"("projectId");

-- CreateIndex
CREATE INDEX "ArtifactSubmission_teamId_idx" ON "ArtifactSubmission"("teamId");

-- CreateIndex
CREATE INDEX "SourceAccessGrant_employeeId_state_idx" ON "SourceAccessGrant"("employeeId", "state");

-- CreateIndex
CREATE UNIQUE INDEX "SourceAccessGrant_artifactId_employeeId_key" ON "SourceAccessGrant"("artifactId", "employeeId");

-- CreateIndex
CREATE INDEX "KnowledgeChunk_sourceType_idx" ON "KnowledgeChunk"("sourceType");

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeChunk_artifactVersionId_chunkIndex_key" ON "KnowledgeChunk"("artifactVersionId", "chunkIndex");

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeChunk_ssotVersionId_chunkIndex_key" ON "KnowledgeChunk"("ssotVersionId", "chunkIndex");

-- CreateIndex
CREATE INDEX "PersonalMemory_employeeId_status_type_idx" ON "PersonalMemory"("employeeId", "status", "type");

-- CreateIndex
CREATE INDEX "DomainAuthority_employeeId_idx" ON "DomainAuthority"("employeeId");

-- CreateIndex
CREATE UNIQUE INDEX "DomainAuthority_authorityDomain_employeeId_permission_key" ON "DomainAuthority"("authorityDomain", "employeeId", "permission");

-- CreateIndex
CREATE INDEX "SSOTRecord_authorityDomain_idx" ON "SSOTRecord"("authorityDomain");

-- CreateIndex
CREATE UNIQUE INDEX "SSOTRecord_authorityDomain_subjectKey_key" ON "SSOTRecord"("authorityDomain", "subjectKey");

-- CreateIndex
CREATE INDEX "SSOTVersion_ssotRecordId_idx" ON "SSOTVersion"("ssotRecordId");

-- CreateIndex
CREATE UNIQUE INDEX "SSOTVersion_ssotRecordId_versionNumber_key" ON "SSOTVersion"("ssotRecordId", "versionNumber");

-- CreateIndex
CREATE INDEX "SSOTProposal_authorityDomain_status_idx" ON "SSOTProposal"("authorityDomain", "status");

-- CreateIndex
CREATE INDEX "SSOTProposal_proposedByEmployeeId_idx" ON "SSOTProposal"("proposedByEmployeeId");

-- CreateIndex
CREATE UNIQUE INDEX "SSOTProposalSource_proposalId_artifactId_key" ON "SSOTProposalSource"("proposalId", "artifactId");

-- CreateIndex
CREATE UNIQUE INDEX "Action_idempotencyKey_key" ON "Action"("idempotencyKey");

-- CreateIndex
CREATE INDEX "Action_employeeId_status_idx" ON "Action"("employeeId", "status");

-- CreateIndex
CREATE INDEX "Action_status_idx" ON "Action"("status");

-- CreateIndex
CREATE INDEX "ActionConfirmation_actionId_idx" ON "ActionConfirmation"("actionId");

-- CreateIndex
CREATE INDEX "Reminder_employeeId_status_idx" ON "Reminder"("employeeId", "status");

-- CreateIndex
CREATE INDEX "Reminder_status_dueAt_idx" ON "Reminder"("status", "dueAt");

-- CreateIndex
CREATE INDEX "AuditEvent_createdAt_type_idx" ON "AuditEvent"("createdAt", "type");

-- CreateIndex
CREATE INDEX "AuditEvent_employeeId_idx" ON "AuditEvent"("employeeId");

-- CreateIndex
CREATE INDEX "AuditEvent_conversationId_idx" ON "AuditEvent"("conversationId");

-- AddForeignKey
ALTER TABLE "Employee" ADD CONSTRAINT "Employee_managerEmployeeId_fkey" FOREIGN KEY ("managerEmployeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExternalIdentity" ADD CONSTRAINT "ExternalIdentity_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeTeam" ADD CONSTRAINT "EmployeeTeam_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeTeam" ADD CONSTRAINT "EmployeeTeam_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectMember" ADD CONSTRAINT "ProjectMember_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectMember" ADD CONSTRAINT "ProjectMember_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoleCapability" ADD CONSTRAINT "RoleCapability_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeRole" ADD CONSTRAINT "EmployeeRole_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeRole" ADD CONSTRAINT "EmployeeRole_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OAuthConnection" ADD CONSTRAINT "OAuthConnection_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OAuthAuthorizationState" ADD CONSTRAINT "OAuthAuthorizationState_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "OAuthConnection"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_initiatorEmployeeId_fkey" FOREIGN KEY ("initiatorEmployeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConversationMessage" ADD CONSTRAINT "ConversationMessage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArtifactVersion" ADD CONSTRAINT "ArtifactVersion_artifactId_fkey" FOREIGN KEY ("artifactId") REFERENCES "Artifact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArtifactSubmission" ADD CONSTRAINT "ArtifactSubmission_artifactId_fkey" FOREIGN KEY ("artifactId") REFERENCES "Artifact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArtifactSubmission" ADD CONSTRAINT "ArtifactSubmission_submittedByEmployeeId_fkey" FOREIGN KEY ("submittedByEmployeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArtifactSubmission" ADD CONSTRAINT "ArtifactSubmission_ownerEmployeeId_fkey" FOREIGN KEY ("ownerEmployeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArtifactSubmission" ADD CONSTRAINT "ArtifactSubmission_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArtifactSubmission" ADD CONSTRAINT "ArtifactSubmission_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SourceAccessGrant" ADD CONSTRAINT "SourceAccessGrant_artifactId_fkey" FOREIGN KEY ("artifactId") REFERENCES "Artifact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SourceAccessGrant" ADD CONSTRAINT "SourceAccessGrant_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeChunk" ADD CONSTRAINT "KnowledgeChunk_artifactVersionId_fkey" FOREIGN KEY ("artifactVersionId") REFERENCES "ArtifactVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeChunk" ADD CONSTRAINT "KnowledgeChunk_ssotVersionId_fkey" FOREIGN KEY ("ssotVersionId") REFERENCES "SSOTVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PersonalMemory" ADD CONSTRAINT "PersonalMemory_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DomainAuthority" ADD CONSTRAINT "DomainAuthority_authorityDomain_fkey" FOREIGN KEY ("authorityDomain") REFERENCES "AuthorityDomain"("domain") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DomainAuthority" ADD CONSTRAINT "DomainAuthority_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SSOTRecord" ADD CONSTRAINT "SSOTRecord_authorityDomain_fkey" FOREIGN KEY ("authorityDomain") REFERENCES "AuthorityDomain"("domain") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SSOTVersion" ADD CONSTRAINT "SSOTVersion_ssotRecordId_fkey" FOREIGN KEY ("ssotRecordId") REFERENCES "SSOTRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SSOTVersion" ADD CONSTRAINT "SSOTVersion_approvedByEmployeeId_fkey" FOREIGN KEY ("approvedByEmployeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SSOTVersion" ADD CONSTRAINT "SSOTVersion_supersedesVersionId_fkey" FOREIGN KEY ("supersedesVersionId") REFERENCES "SSOTVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SSOTProposal" ADD CONSTRAINT "SSOTProposal_ssotRecordId_fkey" FOREIGN KEY ("ssotRecordId") REFERENCES "SSOTRecord"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SSOTProposal" ADD CONSTRAINT "SSOTProposal_authorityDomain_fkey" FOREIGN KEY ("authorityDomain") REFERENCES "AuthorityDomain"("domain") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SSOTProposal" ADD CONSTRAINT "SSOTProposal_proposedByEmployeeId_fkey" FOREIGN KEY ("proposedByEmployeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SSOTProposal" ADD CONSTRAINT "SSOTProposal_reviewConversationId_fkey" FOREIGN KEY ("reviewConversationId") REFERENCES "Conversation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SSOTProposalSource" ADD CONSTRAINT "SSOTProposalSource_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "SSOTProposal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Action" ADD CONSTRAINT "Action_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Action" ADD CONSTRAINT "Action_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActionConfirmation" ADD CONSTRAINT "ActionConfirmation_actionId_fkey" FOREIGN KEY ("actionId") REFERENCES "Action"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActionConfirmation" ADD CONSTRAINT "ActionConfirmation_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reminder" ADD CONSTRAINT "Reminder_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reminder" ADD CONSTRAINT "Reminder_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- App-level safety CHECK constraints (Prisma cannot express these).
-- KnowledgeChunk: exactly one source version foreign key is non-null.
ALTER TABLE "KnowledgeChunk" ADD CONSTRAINT knowledgechunk_exactly_one_source CHECK (
  ("artifactVersionId" IS NULL) <> ("ssotVersionId" IS NULL)
);
-- ArtifactSubmission: PROJECT requires projectId; TEAM requires teamId.
ALTER TABLE "ArtifactSubmission" ADD CONSTRAINT artifactsubmission_scope_requires_membership CHECK (
  ("scope" <> 'PROJECT' OR "projectId" IS NOT NULL)
  AND ("scope" <> 'TEAM' OR "teamId" IS NOT NULL)
);

