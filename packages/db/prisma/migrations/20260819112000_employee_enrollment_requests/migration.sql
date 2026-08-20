CREATE TABLE "EmployeeEnrollmentRequest" (
    "id" TEXT NOT NULL,
    "requesterEmployeeId" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "companyEmail" TEXT NOT NULL,
    "timezone" TEXT NOT NULL,
    "discordUserId" TEXT NOT NULL,
    "employeeCode" TEXT NOT NULL,
    "initialRoleKeys" TEXT[] NOT NULL,
    "stagingAllowlisted" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'AWAITING_CONFIRMATION',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmedAt" TIMESTAMP(3),
    "executedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    CONSTRAINT "EmployeeEnrollmentRequest_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "EmployeeEnrollmentRequest_requesterEmployeeId_status_idx" ON "EmployeeEnrollmentRequest"("requesterEmployeeId", "status");
CREATE INDEX "EmployeeEnrollmentRequest_discordUserId_idx" ON "EmployeeEnrollmentRequest"("discordUserId");
CREATE INDEX "EmployeeEnrollmentRequest_employeeCode_idx" ON "EmployeeEnrollmentRequest"("employeeCode");
CREATE INDEX "EmployeeEnrollmentRequest_companyEmail_idx" ON "EmployeeEnrollmentRequest"("companyEmail");

ALTER TABLE "EmployeeEnrollmentRequest"
  ADD CONSTRAINT "EmployeeEnrollmentRequest_requesterEmployeeId_fkey"
  FOREIGN KEY ("requesterEmployeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;
