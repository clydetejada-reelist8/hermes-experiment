-- Persisted confirmation state for deterministic admin changes.
CREATE TABLE "AdminChangeRequest" (
    "id" TEXT NOT NULL,
    "requesterEmployeeId" TEXT NOT NULL,
    "targetEmployeeId" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "roleKey" TEXT,
    "authorityDomain" TEXT,
    "authorityPermission" "AuthorityPermission",
    "status" TEXT NOT NULL DEFAULT 'AWAITING_CONFIRMATION',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmedAt" TIMESTAMP(3),
    "executedAt" TIMESTAMP(3),
    CONSTRAINT "AdminChangeRequest_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AdminChangeRequest_requesterEmployeeId_status_idx" ON "AdminChangeRequest"("requesterEmployeeId", "status");
CREATE INDEX "AdminChangeRequest_targetEmployeeId_status_idx" ON "AdminChangeRequest"("targetEmployeeId", "status");

ALTER TABLE "AdminChangeRequest"
  ADD CONSTRAINT "AdminChangeRequest_requesterEmployeeId_fkey"
  FOREIGN KEY ("requesterEmployeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AdminChangeRequest"
  ADD CONSTRAINT "AdminChangeRequest_targetEmployeeId_fkey"
  FOREIGN KEY ("targetEmployeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;
