ALTER TYPE "Capability" ADD VALUE IF NOT EXISTS 'EMPLOYEE_PROFILE_CORRECT';

CREATE TABLE "EmployeeProfileCorrectionRequest" (
    "id" TEXT NOT NULL,
    "requesterEmployeeId" TEXT NOT NULL,
    "targetEmployeeId" TEXT NOT NULL,
    "oldDisplayName" TEXT NOT NULL,
    "newDisplayName" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'AWAITING_CONFIRMATION',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmedAt" TIMESTAMP(3),
    "executedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    CONSTRAINT "EmployeeProfileCorrectionRequest_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "EmployeeProfileCorrectionRequest_requesterEmployeeId_status_idx" ON "EmployeeProfileCorrectionRequest"("requesterEmployeeId", "status");
CREATE INDEX "EmployeeProfileCorrectionRequest_targetEmployeeId_status_idx" ON "EmployeeProfileCorrectionRequest"("targetEmployeeId", "status");

ALTER TABLE "EmployeeProfileCorrectionRequest"
  ADD CONSTRAINT "EmployeeProfileCorrectionRequest_requesterEmployeeId_fkey"
  FOREIGN KEY ("requesterEmployeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "EmployeeProfileCorrectionRequest"
  ADD CONSTRAINT "EmployeeProfileCorrectionRequest_targetEmployeeId_fkey"
  FOREIGN KEY ("targetEmployeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;
