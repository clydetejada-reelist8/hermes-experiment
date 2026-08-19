ALTER TABLE "EmployeeEnrollmentRequest"
  ADD COLUMN "existingEmployeeId" TEXT,
  ADD COLUMN "mode" TEXT NOT NULL DEFAULT 'ENROLL';

CREATE INDEX "EmployeeEnrollmentRequest_existingEmployeeId_idx" ON "EmployeeEnrollmentRequest"("existingEmployeeId");
