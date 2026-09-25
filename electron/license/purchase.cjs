/**
 * Buying a license, from the app's side.
 *
 * Checkout is a Stripe Payment Link opened in the student's own browser, with
 * this machine's id as `client_reference_id`. When the payment completes,
 * Stripe tells the licensing Worker (workers/licensing), which mints a
 * `lifetime` key for exactly that machine and keeps it under the machine id.
 * This file asks the Worker for it, while unlicensed.
 *
 * It also asks whether a key has been revoked (checkRevoked). That is the one
 * other call, and it only ever takes access away; offline, nothing changes.
 *
 * Whatever comes back is verified here like any pasted key: the Worker is a
 * convenience for delivery, not a source of trust. Only the signature is.
 */

/** The Payment Link: $24.95, one-time, lifetime. */
const PURCHASE_URL = "https://buy.stripe.com/00w8wIeNXe89dCcfZraEE00";

/**
 * Where the licensing Worker lives. Compiled into packaged builds by
 * scripts/compile-main.mjs; read from .env.local in development. Unset means
 * no automatic delivery, and the key is pasted from the confirmation page.
 */
function licenseServerUrl() {
  const url = process.env.LICENSE_SERVER_URL?.trim();
  return url ? url.replace(/\/+$/, "") : null;
}

function purchaseUrl(machineId) {
  const url = new URL(PURCHASE_URL);
  url.searchParams.set("client_reference_id", machineId);
  return url.toString();
}

/**
 * The key bought for this machine, if the Worker has one yet.
 *
 * @returns {Promise<{ configured: boolean, token: string | null }>}
 */
async function fetchPurchasedLicense(machineId, fetchImpl = fetch) {
  const server = licenseServerUrl();
  if (!server) return { configured: false, token: null };

  try {
    const response = await fetchImpl(
      `${server}/license/${encodeURIComponent(machineId)}`,
      { signal: AbortSignal.timeout(8000) },
    );
    if (!response.ok) return { configured: true, token: null };

    const body = await response.json();
    return {
      configured: true,
      token: typeof body?.token === "string" ? body.token : null,
    };
  } catch {
    // Offline, or the Worker is down: nothing yet, ask again later.
    return { configured: true, token: null };
  }
}

/**
 * Whether the Worker lists this key as revoked.
 *
 * @returns {Promise<boolean | null>} null when it could not be asked: no
 *   server configured, offline, or an answer that did not make sense. A null
 *   never locks anyone out.
 */
async function checkRevoked(licenseId, fetchImpl = fetch) {
  const server = licenseServerUrl();
  if (!server || typeof licenseId !== "string" || licenseId === "") return null;

  try {
    const response = await fetchImpl(
      `${server}/revoked/${encodeURIComponent(licenseId)}`,
      { signal: AbortSignal.timeout(8000) },
    );
    if (!response.ok) return null;

    const body = await response.json();
    return typeof body?.revoked === "boolean" ? body.revoked : null;
  } catch {
    return null;
  }
}

module.exports = {
  PURCHASE_URL,
  checkRevoked,
  licenseServerUrl,
  purchaseUrl,
  fetchPurchasedLicense,
};
