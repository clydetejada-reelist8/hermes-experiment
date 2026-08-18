/**
 * Admin CLI for Hermes.
 *
 * Usage:
 *   npx @hermes/admin flag:get <key>
 *   npx @hermes/admin flag:set <key> <true|false> <updatedBy>
 *   npx @hermes/admin flag:list
 *   npx @hermes/admin killswitch:activate <updatedBy>
 *   npx @hermes/admin killswitch:deactivate <updatedBy>
 *   npx @hermes/admin killswitch:status
 *   npx @hermes/admin retention:get <key>
 *   npx @hermes/admin retention:set <key> <days> <updatedBy>
 *   npx @hermes/admin retention:apply <key>
 */
import {
  getFeatureFlag,
  setFeatureFlag,
  listFeatureFlags,
  activateKillSwitch,
  deactivateKillSwitch,
  isKillSwitchActive,
  getRetentionPolicy,
  setRetentionPolicy,
  applyRetentionPolicy,
} from "./flags.js";

async function main(): Promise<void> {
  const [, , command, ...args] = process.argv;

  if (!command) {
    console.error("Usage: npx @hermes/admin <command> [args...]");
    console.error(
      "Commands: flag:get, flag:set, flag:list, killswitch:activate, killswitch:deactivate, killswitch:status, retention:get, retention:set, retention:apply",
    );
    process.exit(1);
  }

  try {
    switch (command) {
      case "flag:get": {
        const [key] = args;
        if (!key) throw new Error("missing key");
        const flag = await getFeatureFlag(key);
        console.log(JSON.stringify(flag, null, 2));
        break;
      }
      case "flag:set": {
        const [key, enabled, updatedBy] = args;
        if (!key || !enabled || !updatedBy)
          throw new Error("usage: flag:set <key> <true|false> <updatedBy>");
        const flag = await setFeatureFlag(key, enabled === "true", updatedBy);
        console.log(JSON.stringify(flag, null, 2));
        break;
      }
      case "flag:list": {
        const flags = await listFeatureFlags();
        console.log(JSON.stringify(flags, null, 2));
        break;
      }
      case "killswitch:activate": {
        const [updatedBy] = args;
        if (!updatedBy) throw new Error("missing updatedBy");
        await activateKillSwitch(updatedBy);
        console.log("Kill switch ACTIVATED");
        break;
      }
      case "killswitch:deactivate": {
        const [updatedBy] = args;
        if (!updatedBy) throw new Error("missing updatedBy");
        await deactivateKillSwitch(updatedBy);
        console.log("Kill switch DEACTIVATED");
        break;
      }
      case "killswitch:status": {
        const active = await isKillSwitchActive();
        console.log(`Kill switch: ${active ? "ACTIVE" : "INACTIVE"}`);
        break;
      }
      case "retention:get": {
        const [key] = args;
        if (!key) throw new Error("missing key");
        const policy = await getRetentionPolicy(key);
        console.log(JSON.stringify(policy, null, 2));
        break;
      }
      case "retention:set": {
        const [key, days, updatedBy] = args;
        if (!key || !days || !updatedBy)
          throw new Error("usage: retention:set <key> <days> <updatedBy>");
        const policy = await setRetentionPolicy(key, parseInt(days, 10), updatedBy);
        console.log(JSON.stringify(policy, null, 2));
        break;
      }
      case "retention:apply": {
        const [key] = args;
        if (!key) throw new Error("missing key");
        const count = await applyRetentionPolicy(key);
        console.log(`Deleted ${count} records`);
        break;
      }
      default:
        console.error(`unknown command: ${command}`);
        process.exit(1);
    }
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

main();
