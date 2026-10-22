/**
 * Moving the student's own AI key from the desktop to their phone in one
 * scan. The desktop draws a QR code of a `meganstudy://ai-key` link; the
 * iPhone's Camera opens it in the app, which asks before saving the key to
 * the Keychain. Nothing passes through a server, and the link stops working
 * a couple of minutes after it was made.
 */

export const KEY_LINK_SCHEME = "meganstudy";
export const KEY_LINK_HOST = "ai-key";

/** How long the desktop shows the code. */
export const KEY_LINK_LIFETIME_MS = 2 * 60 * 1000;

/** Grace for the phone's clock disagreeing with the computer's. */
const CLOCK_SKEW_MS = 5 * 60 * 1000;

export type KeyLinkProvider = "gemini";

export function buildKeyLink(key: string, now = Date.now(), provider: KeyLinkProvider = "gemini"): string {
  const params = new URLSearchParams({
    v: "1",
    provider,
    key: key.trim(),
    until: String(now + KEY_LINK_LIFETIME_MS),
  });
  return `${KEY_LINK_SCHEME}://${KEY_LINK_HOST}?${params.toString()}`;
}

export function isKeyLink(url: string): boolean {
  return url.toLowerCase().startsWith(`${KEY_LINK_SCHEME}://${KEY_LINK_HOST}`);
}

export type KeyLinkResult =
  | { ok: true; provider: KeyLinkProvider; key: string }
  | { ok: false; reason: "invalid" | "expired" | "unsupported" };

export function parseKeyLink(url: string, now = Date.now()): KeyLinkResult {
  if (!isKeyLink(url)) return { ok: false, reason: "invalid" };
  const query = url.indexOf("?");
  if (query < 0) return { ok: false, reason: "invalid" };
  const params = new URLSearchParams(url.slice(query + 1));
  if (params.get("v") !== "1") return { ok: false, reason: "unsupported" };
  const provider = params.get("provider");
  if (provider !== "gemini") return { ok: false, reason: "unsupported" };
  const key = params.get("key")?.trim() ?? "";
  if (!/^[\w-]{20,200}$/.test(key)) return { ok: false, reason: "invalid" };
  const until = Number(params.get("until"));
  if (!Number.isFinite(until) || now > until + CLOCK_SKEW_MS) return { ok: false, reason: "expired" };
  return { ok: true, provider, key };
}
