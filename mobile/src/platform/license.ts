import { registerPlugin } from "@capacitor/core";

import {
  checkCompanionToken,
  decideAccess,
  decodeLicenseToken,
  needsRecheck,
  parseLicenseState,
  recordRevocation,
  TOKEN_MESSAGES,
  type PhoneLicenseState,
  type SignatureVerifier,
} from "@megan/core/license/companion";
import type { LicenseProvider, SecretStore } from "@megan/core/platform/types";

/**
 * The browser preview has no license to check: every build there has full
 * access, so screens can be tried out without a key.
 */
export const developmentLicense: LicenseProvider = {
  async access() {
    return { full: true, source: "development" };
  },
};

/** The Keychain entry holding PhoneLicenseState. */
export const LICENSE_STATE_KEY = "megan_license";

type LicensePlugin = { verify(options: { signedBytes: string; signature: string }): Promise<{ valid: boolean }> };

const licensePlugin = registerPlugin<LicensePlugin>("License");

/** Ed25519 checked natively (ios/App/App/LicensePlugin.swift); iOS 15 WebCrypto can't. */
export const nativeVerifier: SignatureVerifier = async (signedBytes, signature) => {
  try {
    return (await licensePlugin.verify({ signedBytes, signature })).valid === true;
  } catch {
    return false;
  }
};

/**
 * The App Store app is free and sells nothing (docs/MOBILE_ARCHITECTURE.md,
 * "Licensing on iOS"): it opens with a key from the student's computer, via
 * the sync folder, or one bought on the web and pasted in. A 7-day trial
 * covers the first week either way. The rules live in
 * packages/core/src/license/companion.ts; this keeps the state in the
 * Keychain and asks the licensing server about revocations once a day.
 */
export function phoneLicense(secrets: SecretStore, verify: SignatureVerifier, server: string): LicenseProvider {
  const load = async () => parseLicenseState(await secrets.get(LICENSE_STATE_KEY).catch(() => null));
  const save = (state: PhoneLicenseState) => secrets.set(LICENSE_STATE_KEY, JSON.stringify(state)).catch(() => {});

  let checking = false;
  async function recheck(state: PhoneLicenseState) {
    const id = state.token ? decodeLicenseToken(state.token)?.payload.id : null;
    if (checking || !id || !server || !needsRecheck(state)) return;
    checking = true;
    try {
      const response = await fetch(`${server.replace(/\/+$/, "")}/revoked/${encodeURIComponent(id)}`);
      if (!response.ok) return;
      const body = (await response.json()) as { revoked?: unknown };
      if (typeof body.revoked !== "boolean") return;
      const latest = await load();
      if (latest.token !== state.token) return;
      await save(recordRevocation(latest, id, body.revoked));
    } catch {
      // Offline: the key keeps working until CONFIRM_DAYS pass without an answer.
    } finally {
      checking = false;
    }
  }

  async function access() {
    const state = await load();
    const decided = decideAccess(state, await checkCompanionToken(state.token, verify));
    await save(decided.state);
    void recheck(decided.state);
    return decided.access;
  }

  return {
    access,
    async activate(token, from) {
      const check = await checkCompanionToken(token, verify);
      if (!check.ok) return { ok: false, message: TOKEN_MESSAGES[check.reason] };
      const state = await load();
      const clean = token.trim().replace(/\s+/g, "");
      if (state.token !== clean) {
        // A new key gets its own 45 days to be confirmed, starting now.
        await save({ ...state, token: clean, from, checkedAt: Date.now() });
      } else if (state.from !== from && from === "key") {
        await save({ ...state, from });
      }
      return { ok: true, access: await access() };
    },
    async deactivate() {
      const state = await load();
      await save({ ...state, token: null, from: null, checkedAt: null });
    },
  };
}
