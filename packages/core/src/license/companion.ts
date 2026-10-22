/**
 * Licensing on the iPhone and iPad (docs/MOBILE_ARCHITECTURE.md, "Licensing
 * on iOS"). The App Store app is free and sells nothing: it opens with the
 * same key the desktop uses, which arrives one of two ways —
 *
 *   - from the student's computer, inside the sync folder's device file
 *     (`license` in folder-sync.ts), so a desktop purchase covers the phone;
 *   - pasted in (or opened from a `meganstudy://license` link) after buying
 *     on the web, for someone who only wants the phone app.
 *
 * The checks mirror electron/license/verify.cjs and gate.cjs: the same token
 * format, signature, types, revocation list and 45-day confirmation, with
 * one difference — a key here is a companion key, so the machine a lifetime
 * key was bought for doesn't matter. Everything is pure; the signature check,
 * the clock and the network are passed in.
 */
import type { LicenseAccess } from "../platform/types";

export const TRIAL_DAYS = 7;
/** A bought key the licensing server hasn't vouched for in this long stops working. */
export const CONFIRM_DAYS = 45;
/** How often to ask the licensing server about a key that already works. */
export const RECHECK_MS = 24 * 60 * 60 * 1000;

const DAY_MS = 24 * 60 * 60 * 1000;

export const LICENSE_LINK_PREFIX = "meganstudy://license";

export type LicensePayload = {
  id?: string;
  type: string;
  issuedAt?: string | number;
  machineId?: string | null;
  name?: string | null;
  expiresAt?: number;
};

export type DecodedToken = {
  payload: LicensePayload;
  /** The base64 payload exactly as signed. */
  signedBytes: string;
  signature: string;
};

/** Checks an Ed25519 signature (both base64) against the publisher's key. */
export type SignatureVerifier = (signedBytes: string, signature: string) => Promise<boolean>;

export type TokenReason = "missing" | "malformed" | "bad_signature" | "expired" | "unknown_type";

export type TokenCheck = { ok: true; payload: LicensePayload } | { ok: false; reason: TokenReason };

function fromBase64(text: string): string {
  const binary = atob(text);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

/** Reads a token without trusting any of it, as verify.cjs's decode does. */
export function decodeLicenseToken(token: string): DecodedToken | null {
  try {
    const outer = JSON.parse(fromBase64(token.trim().replace(/\s+/g, ""))) as Record<string, unknown>;
    if (typeof outer?.payload !== "string" || typeof outer.signature !== "string") return null;
    const payload = JSON.parse(fromBase64(outer.payload)) as LicensePayload;
    if (!payload || typeof payload !== "object" || typeof payload.type !== "string") return null;
    return { payload, signedBytes: outer.payload, signature: outer.signature };
  } catch {
    return null;
  }
}

/** Whether a key opens the phone app right now, before any revocation. */
export async function checkCompanionToken(
  token: string | null | undefined,
  verify: SignatureVerifier,
  now = Date.now(),
): Promise<TokenCheck> {
  if (!token?.trim()) return { ok: false, reason: "missing" };
  const decoded = decodeLicenseToken(token);
  if (!decoded) return { ok: false, reason: "malformed" };

  let signed = false;
  try {
    signed = await verify(decoded.signedBytes, decoded.signature);
  } catch {
    signed = false;
  }
  if (!signed) return { ok: false, reason: "bad_signature" };

  const { payload } = decoded;
  if (payload.type === "admin") return { ok: true, payload };
  if (payload.type === "lifetime") {
    // Bought keys always name a machine; any machine will do on the phone.
    if (typeof payload.machineId !== "string" || payload.machineId === "") return { ok: false, reason: "malformed" };
    return { ok: true, payload };
  }
  if (payload.type !== "student") return { ok: false, reason: "unknown_type" };
  if (typeof payload.expiresAt !== "number" || now > payload.expiresAt) return { ok: false, reason: "expired" };
  return { ok: true, payload };
}

/** What the phone keeps (in the Keychain) about its license. */
export type PhoneLicenseState = {
  token: string | null;
  /** Where the key came from: the computer's sync file, or typed in. */
  from: "desktop" | "key" | null;
  trialStartedAt: number | null;
  /** The latest time seen, so moving the clock back can't stretch the trial. */
  lastSeenAt: number | null;
  revokedIds: string[];
  /** The last time the licensing server answered about this key. */
  checkedAt: number | null;
};

export const EMPTY_LICENSE_STATE: PhoneLicenseState = {
  token: null,
  from: null,
  trialStartedAt: null,
  lastSeenAt: null,
  revokedIds: [],
  checkedAt: null,
};

export function parseLicenseState(text: string | null | undefined): PhoneLicenseState {
  if (!text) return { ...EMPTY_LICENSE_STATE };
  try {
    const value = JSON.parse(text) as Partial<PhoneLicenseState>;
    const number = (n: unknown) => (typeof n === "number" && Number.isFinite(n) ? n : null);
    return {
      token: typeof value.token === "string" ? value.token : null,
      from: value.from === "desktop" || value.from === "key" ? value.from : null,
      trialStartedAt: number(value.trialStartedAt),
      lastSeenAt: number(value.lastSeenAt),
      revokedIds: Array.isArray(value.revokedIds) ? value.revokedIds.filter((id) => typeof id === "string") : [],
      checkedAt: number(value.checkedAt),
    };
  } catch {
    return { ...EMPTY_LICENSE_STATE };
  }
}

export type LockReason = NonNullable<LicenseAccess["reason"]>;

export type PhoneAccess = LicenseAccess;

/**
 * The answer for this moment. Returns the state to save too: the trial
 * starts on the first ask, and the latest time seen moves forward.
 */
export function decideAccess(
  state: PhoneLicenseState,
  check: TokenCheck,
  now = Date.now(),
): { access: PhoneAccess; state: PhoneLicenseState } {
  const clockMovedBack = state.lastSeenAt !== null && now < state.lastSeenAt - DAY_MS;
  const next: PhoneLicenseState = {
    ...state,
    lastSeenAt: Math.max(now, state.lastSeenAt ?? 0),
    trialStartedAt: state.trialStartedAt ?? now,
  };

  let reason: LockReason | undefined;
  if (check.ok) {
    const id = check.payload.id;
    const revoked = !!id && state.revokedIds.includes(id);
    const confirmed =
      check.payload.type === "admin" || state.checkedAt === null || now - state.checkedAt <= CONFIRM_DAYS * DAY_MS;
    if (revoked) reason = "revoked";
    else if (!confirmed) reason = "unconfirmed";
    else {
      return {
        access: { full: true, source: state.from === "desktop" ? "desktop-link" : "license" },
        state: next,
      };
    }
  } else if (check.reason === "expired") {
    reason = "expired";
  }

  // A bought key waiting on the server says so rather than falling back to the trial.
  if (reason !== "unconfirmed") {
    const endsAt = (next.trialStartedAt ?? now) + TRIAL_DAYS * DAY_MS;
    if (!clockMovedBack && now < endsAt) {
      return {
        access: { full: true, source: "trial", trialDaysLeft: Math.max(1, Math.ceil((endsAt - now) / DAY_MS)) },
        state: next,
      };
    }
  }

  return {
    access: { full: false, source: "none", reason: reason ?? (clockMovedBack ? "clock" : "trial_ended") },
    state: next,
  };
}

/** Whether it's time to ask the licensing server about this key again. */
export function needsRecheck(state: PhoneLicenseState, now = Date.now()): boolean {
  return state.checkedAt === null || now - state.checkedAt > RECHECK_MS || now < state.checkedAt;
}

/** Folds the server's answer about one key into the saved state. */
export function recordRevocation(state: PhoneLicenseState, id: string, revoked: boolean, now = Date.now()): PhoneLicenseState {
  const others = state.revokedIds.filter((each) => each !== id);
  return { ...state, revokedIds: revoked ? [...others, id] : others, checkedAt: now };
}

/** What to tell the student when the app is locked. */
export const LOCK_MESSAGES: Record<LockReason, string> = {
  trial_ended: "Your 7-day free trial has ended. Everything you made is still here.",
  revoked: "This license key has been revoked.",
  unconfirmed:
    "Megan Study needs to confirm your license online, which it hasn't managed to do for a while. Connect to the internet and open the app again.",
  expired: "That license key has expired.",
  clock: "This device's date looks wrong. Set the date and time correctly, then open the app again.",
};

export const TOKEN_MESSAGES: Record<TokenReason, string> = {
  missing: "Paste your license key first.",
  malformed: "That key isn't readable. Check it was copied in full.",
  bad_signature: "That key didn't come from Megan Study, or it has been altered.",
  expired: "That key has expired.",
  unknown_type: "That key is of a kind this version doesn't support.",
};

/** `meganstudy://license?token=…`, from the purchase page. */
export function isLicenseLink(url: string): boolean {
  return url.toLowerCase().startsWith(LICENSE_LINK_PREFIX);
}

export function tokenFromLicenseLink(url: string): string | null {
  const query = url.indexOf("?");
  if (!isLicenseLink(url) || query < 0) return null;
  // A "+" in base64 reads back as a space if the link wasn't encoded.
  const token = new URLSearchParams(url.slice(query + 1)).get("token")?.trim().replace(/ /g, "+");
  return token || null;
}
