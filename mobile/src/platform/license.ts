import type { LicenseProvider } from "@megan/core/platform/types";

/**
 * No purchasing on iOS yet, by decision: every build has full access until
 * one of the options in docs/MOBILE_ARCHITECTURE.md ("Licensing on iOS") is
 * chosen. This is the one object that changes when it is; every screen asks
 * `platform.license.access()` and never decides for itself.
 */
export const developmentLicense: LicenseProvider = {
  async access() {
    return { full: true, source: "development" };
  },
};
