import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { tryClaimInboundEvent } from "./dedup.js";

describe("tryClaimInboundEvent", () => {
  it("claims a new event and returns true", async () => {
    const eventId = randomUUID();
    const result = await tryClaimInboundEvent("DISCORD", eventId, "INTERACTION");
    expect(result.alreadyProcessed).toBe(false);
  });

  it("rejects a duplicate event and returns true for alreadyProcessed", async () => {
    const eventId = randomUUID();
    await tryClaimInboundEvent("DISCORD", eventId, "INTERACTION");
    const result = await tryClaimInboundEvent("DISCORD", eventId, "INTERACTION");
    expect(result.alreadyProcessed).toBe(true);
  });

  it("treats events with different IDs as distinct", async () => {
    const a = await tryClaimInboundEvent("DISCORD", randomUUID(), "MESSAGE");
    const b = await tryClaimInboundEvent("DISCORD", randomUUID(), "MESSAGE");
    expect(a.alreadyProcessed).toBe(false);
    expect(b.alreadyProcessed).toBe(false);
  });
});
