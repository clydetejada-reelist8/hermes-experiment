export {
  assertAdminManagementAllowed,
  assertAdminPrivilegeConfirmation,
  assertStagingBootstrapEnvironment,
  bootstrapStagingOwner,
  getEmployeeCapabilities,
} from "./employee-access.js";
export { confirmAdminChange, executeAdminChange, prepareAdminChange } from "./management.js";

export {
  cancelEmployeeEnrollment,
  confirmEmployeeEnrollment,
  executeEmployeeEnrollment,
  getEmployeeEnrollment,
  prepareEmployeeEnrollment,
  prepareEmployeeIdentityLink,
} from "./enrollment.js";

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
