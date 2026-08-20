import { describe, expect, it } from "vitest";
import { assertDisplayNameChange, assertProfileCorrectionAllowed } from "./profile-corrections.js";

describe("employee profile correction policy", () => {
  it("requires the dedicated profile correction capability", () => {
    expect(() => assertProfileCorrectionAllowed(new Set(["HERMES_ADMIN"]))).toThrow(
      "employee_profile_correction_capability_required",
    );
    expect(() =>
      assertProfileCorrectionAllowed(new Set(["EMPLOYEE_PROFILE_CORRECT"])),
    ).not.toThrow();
  });

  it("requires a meaningful changed display name", () => {
    expect(() => assertDisplayNameChange("Borj de Borja", "Borj de Borja")).toThrow(
      "display_name_unchanged",
    );
    expect(() => assertDisplayNameChange("Borj de Borja", "")).toThrow("display_name_required");
    expect(() => assertDisplayNameChange("Borj de Borja", "Ryan de Borja")).not.toThrow();
  });
});
