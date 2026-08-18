export {
  getFeatureFlag,
  setFeatureFlag,
  isFeatureEnabled,
  listFeatureFlags,
  activateKillSwitch,
  deactivateKillSwitch,
  isKillSwitchActive,
  getRetentionPolicy,
  setRetentionPolicy,
  listRetentionPolicies,
  applyRetentionPolicy,
} from "./flags.js";
export type { FeatureFlag, RetentionPolicy } from "./flags.js";
