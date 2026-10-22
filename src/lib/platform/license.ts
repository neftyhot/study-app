import type { LicenseProvider } from "@megan/core/platform/types";
import { readLicenseStatus } from "@/lib/license/status";

/**
 * The desktop's answer to "who may use this", read from what the Electron
 * main process already decided. Nothing is checked here: the trial, the
 * purchase, the 45-day check and offline grace all stay in electron/license,
 * and the server only ever starts once they pass.
 *
 * No status means a development server with no Electron in front of it.
 */
export const desktopLicense: LicenseProvider = {
  async access() {
    const status = readLicenseStatus();
    if (!status) return { full: true, source: "development" };
    if (status.type === "trial") {
      return {
        full: true,
        source: "trial",
        trialDaysLeft: status.daysRemaining ?? undefined,
      };
    }
    return { full: true, source: "license" };
  },
};
