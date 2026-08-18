import { describe, expect, it, beforeEach } from "vitest";
import { db } from "@hermes/db";
import {
  getFeatureFlag,
  setFeatureFlag,
  isFeatureEnabled,
  listFeatureFlags,
  activateKillSwitch,
  isKillSwitchActive,
  deactivateKillSwitch,
  getRetentionPolicy,
  setRetentionPolicy,
  applyRetentionPolicy,
} from "./flags.js";
import { createEmployee } from "../../../test/fixtures/db-helpers.js";

beforeEach(async () => {
  // Clean up only test-specific feature flags between tests.
  // Do NOT delete all flags — other test files depend on flags like
  // ask_enabled, ssot_enabled, kill_switch.global being set.
  await db.featureFlag.deleteMany({
    where: {
      key: {
        in: ["gmail_actions", "new_feature", "flag_a", "flag_b", "updatable", "kill_switch.global"],
      },
    },
  });
});

describe("feature flags", () => {
  it("sets and gets a feature flag", async () => {
    await setFeatureFlag("gmail_actions", true, "admin-1");
    const flag = await getFeatureFlag("gmail_actions");
    expect(flag?.enabled).toBe(true);
    expect(flag?.updatedBy).toBe("admin-1");
  });

  it("returns null for non-existent flag", async () => {
    const flag = await getFeatureFlag("nonexistent");
    expect(flag).toBeNull();
  });

  it("checks if feature is enabled (defaults to false)", async () => {
    expect(await isFeatureEnabled("new_feature")).toBe(false);
    await setFeatureFlag("new_feature", true, "admin-1");
    expect(await isFeatureEnabled("new_feature")).toBe(true);
  });

  it("lists all feature flags", async () => {
    await setFeatureFlag("flag_a", true, "admin-1");
    await setFeatureFlag("flag_b", false, "admin-1");
    const flags = await listFeatureFlags();
    expect(flags.length).toBeGreaterThanOrEqual(2);
    expect(flags.some((f) => f.key === "flag_a")).toBe(true);
    expect(flags.some((f) => f.key === "flag_b")).toBe(true);
  });

  it("updates an existing flag", async () => {
    await setFeatureFlag("updatable", false, "admin-1");
    await setFeatureFlag("updatable", true, "admin-2");
    const flag = await getFeatureFlag("updatable");
    expect(flag?.enabled).toBe(true);
    expect(flag?.updatedBy).toBe("admin-2");
  });
});

describe("kill switches", () => {
  it("activates a kill switch", async () => {
    await activateKillSwitch("admin-1");
    expect(await isKillSwitchActive()).toBe(true);
  });

  it("deactivates a kill switch", async () => {
    await activateKillSwitch("admin-1");
    expect(await isKillSwitchActive()).toBe(true);
    await deactivateKillSwitch("admin-1");
    expect(await isKillSwitchActive()).toBe(false);
  });

  it("isKillSwitchActive defaults to false", async () => {
    expect(await isKillSwitchActive()).toBe(false);
  });
});

describe("retention policies", () => {
  it("sets and gets a retention policy", async () => {
    await setRetentionPolicy("conversations", 90, "admin-1");
    const policy = await getRetentionPolicy("conversations");
    expect(policy?.retentionDays).toBe(90);
  });

  it("returns null for non-existent policy", async () => {
    const policy = await getRetentionPolicy("nonexistent");
    expect(policy).toBeNull();
  });

  it("applies retention policy by deleting old records", async () => {
    const emp = await createEmployee();
    // Create an old conversation
    const oldDate = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000); // 100 days ago
    const oldConv = await db.conversation.create({
      data: {
        initiatorEmployeeId: emp.id,
        conversationType: "ASK",
        discordThreadId: "old-thread-1",
        discordParentChannelId: "old-channel",
        createdAt: oldDate,
      },
    });

    await setRetentionPolicy("conversations", 90, "admin-1");
    const deleted = await applyRetentionPolicy("conversations");
    expect(deleted).toBeGreaterThanOrEqual(1);

    const stillExists = await db.conversation.findUnique({ where: { id: oldConv.id } });
    expect(stillExists).toBeNull();
  });

  it("does not delete recent records", async () => {
    const emp = await createEmployee();
    const recentConv = await db.conversation.create({
      data: {
        initiatorEmployeeId: emp.id,
        conversationType: "ASK",
        discordThreadId: "recent-thread-1",
        discordParentChannelId: "recent-channel",
      },
    });

    await setRetentionPolicy("conversations", 90, "admin-1");
    await applyRetentionPolicy("conversations");

    const stillExists = await db.conversation.findUnique({ where: { id: recentConv.id } });
    expect(stillExists).not.toBeNull();
  });
});
