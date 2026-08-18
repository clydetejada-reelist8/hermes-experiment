import { db } from "@hermes/db";
import type { FeatureFlag, RetentionPolicy } from "@hermes/db";

export type { FeatureFlag, RetentionPolicy };

const KILL_SWITCH_KEY = "kill_switch.global";

// ---------------------------------------------------------------------------
// Feature flags
// ---------------------------------------------------------------------------

export async function getFeatureFlag(key: string): Promise<FeatureFlag | null> {
  return db.featureFlag.findUnique({ where: { key } });
}

export async function setFeatureFlag(
  key: string,
  enabled: boolean,
  updatedBy: string,
): Promise<FeatureFlag> {
  return db.featureFlag.upsert({
    where: { key },
    create: { key, enabled, updatedBy },
    update: { enabled, updatedBy },
  });
}

export async function isFeatureEnabled(key: string): Promise<boolean> {
  const flag = await getFeatureFlag(key);
  return flag?.enabled ?? false;
}

export async function listFeatureFlags(): Promise<FeatureFlag[]> {
  return db.featureFlag.findMany({ orderBy: { key: "asc" } });
}

// ---------------------------------------------------------------------------
// Kill switches
// ---------------------------------------------------------------------------

export async function activateKillSwitch(updatedBy: string): Promise<void> {
  await db.featureFlag.upsert({
    where: { key: KILL_SWITCH_KEY },
    create: { key: KILL_SWITCH_KEY, enabled: true, updatedBy },
    update: { enabled: true, updatedBy },
  });
}

export async function deactivateKillSwitch(updatedBy: string): Promise<void> {
  await db.featureFlag.upsert({
    where: { key: KILL_SWITCH_KEY },
    create: { key: KILL_SWITCH_KEY, enabled: false, updatedBy },
    update: { enabled: false, updatedBy },
  });
}

export async function isKillSwitchActive(): Promise<boolean> {
  const flag = await getFeatureFlag(KILL_SWITCH_KEY);
  return flag?.enabled ?? false;
}

// ---------------------------------------------------------------------------
// Retention policies
// ---------------------------------------------------------------------------

export async function getRetentionPolicy(key: string): Promise<RetentionPolicy | null> {
  return db.retentionPolicy.findUnique({ where: { key } });
}

export async function setRetentionPolicy(
  key: string,
  retentionDays: number,
  updatedBy: string,
): Promise<RetentionPolicy> {
  return db.retentionPolicy.upsert({
    where: { key },
    create: { key, retentionDays, updatedBy },
    update: { retentionDays, updatedBy },
  });
}

export async function listRetentionPolicies(): Promise<RetentionPolicy[]> {
  return db.retentionPolicy.findMany({ orderBy: { key: "asc" } });
}

/**
 * Apply a retention policy by deleting records older than the retention period.
 * Returns the number of records deleted.
 */
export async function applyRetentionPolicy(key: string): Promise<number> {
  const policy = await getRetentionPolicy(key);
  if (!policy) throw new Error(`retention policy not found: ${key}`);

  const cutoff = new Date(Date.now() - policy.retentionDays * 24 * 60 * 60 * 1000);

  switch (key) {
    case "conversations": {
      const result = await db.conversation.deleteMany({
        where: { createdAt: { lt: cutoff } },
      });
      return result.count;
    }
    case "audit_events": {
      const result = await db.auditEvent.deleteMany({
        where: { createdAt: { lt: cutoff } },
      });
      return result.count;
    }
    case "messages": {
      const result = await db.conversationMessage.deleteMany({
        where: { createdAt: { lt: cutoff } },
      });
      return result.count;
    }
    default:
      throw new Error(`unknown retention policy key: ${key}`);
  }
}
