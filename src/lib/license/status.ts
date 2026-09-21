/**
 * What the web app knows about the license.
 *
 * Deliberately almost nothing: the Electron main process verifies the license
 * before this server is ever started, and then tells it the tier and the
 * countdown. The web app cannot read the license file, the machine id, or the
 * public key, and there is nothing here for it to bypass — the gate is not in
 * the thing being gated.
 *
 * Outside the desktop app (a development server, say) this returns null and
 * the settings row simply does not appear.
 */
const TYPES = ["admin", "student", "lifetime", "trial"] as const;

export type LicenseStatus = {
  type: (typeof TYPES)[number];
  name: string | null;
  expiresAt: number | null;
  daysRemaining: number | null;
};

export function readLicenseStatus(): LicenseStatus | null {
  const raw = process.env.STUDY_APP_LICENSE;
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as Partial<LicenseStatus>;
    if (!TYPES.includes(parsed.type as LicenseStatus["type"])) return null;

    return {
      type: parsed.type as LicenseStatus["type"],
      name: typeof parsed.name === "string" ? parsed.name : null,
      expiresAt:
        typeof parsed.expiresAt === "number" ? parsed.expiresAt : null,
      daysRemaining:
        typeof parsed.daysRemaining === "number" ? parsed.daysRemaining : null,
    };
  } catch {
    return null;
  }
}

export const TIER_LABELS: Record<LicenseStatus["type"], string> = {
  admin: "Full licence",
  student: "Student licence",
  lifetime: "Lifetime licence",
  trial: "Free trial",
};

/** How the countdown should read to someone with a deadline. */
export function expiryLabel(status: LicenseStatus): string {
  if (status.type === "admin" || status.type === "lifetime") {
    return "Does not expire";
  }
  if (status.daysRemaining === null) return "No expiry recorded";
  if (status.daysRemaining === 0) return "Expires today";
  if (status.daysRemaining === 1) return "1 day remaining";
  return `${status.daysRemaining} days remaining`;
}
