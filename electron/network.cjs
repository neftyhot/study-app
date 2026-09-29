/**
 * Reaching the internet from a school or office network.
 *
 * Node's own fetch talks to the network directly: it ignores the proxy the
 * Mac is set to use and trusts only Node's bundled certificates, not the ones
 * in the Keychain. Many school networks need one or both — a proxy, or a
 * filter that re-signs HTTPS traffic with the school's certificate — so there
 * every request the app makes fails with a bare "fetch failed", while the
 * browser, which uses the system's settings, works fine.
 *
 * Electron's `net.fetch` goes through Chromium's network stack, the same one
 * the app window uses, which honours the system proxy and the Keychain. It is
 * used here as a second attempt: a request that Node cannot connect at all is
 * sent again through Chromium, and once Chromium has reached a host that Node
 * could not, later requests to that host go straight there.
 */
const { net } = require("electron");

/** Hosts Node could not reach but Chromium could, for this session. */
const viaChromium = new Set();

/** A connection-level failure, as opposed to an HTTP error or an abort. */
function isNetworkFailure(error) {
  if (!(error instanceof TypeError)) return false;
  return error.message === "fetch failed" || Boolean(error.cause && typeof error.cause === "object" && "code" in error.cause);
}

/** A body that can be sent a second time: not a one-shot stream. */
function replayable(input, init) {
  if (typeof Request !== "undefined" && input instanceof Request) return !input.body;
  const body = init?.body;
  return body == null || typeof body === "string" || body instanceof ArrayBuffer || ArrayBuffer.isView(body) ||
    body instanceof URLSearchParams || (typeof Blob !== "undefined" && body instanceof Blob);
}

function hostOf(input) {
  try {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    return url.protocol === "https:" || url.protocol === "http:" ? url.host : null;
  } catch {
    return null;
  }
}

function isLocal(host) {
  return /^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/.test(host);
}

/** Fetch that falls back to Chromium's network stack. Call after app is ready. */
function systemFetch(nodeFetch) {
  return async function fetchWithSystemNetwork(input, init) {
    const host = hostOf(input);
    if (!host || isLocal(host)) return nodeFetch(input, init);
    if (viaChromium.has(host)) return net.fetch(input, init);

    try {
      return await nodeFetch(input, init);
    } catch (error) {
      if (!isNetworkFailure(error) || init?.signal?.aborted || !replayable(input, init)) throw error;
      const response = await net.fetch(input, init);
      viaChromium.add(host);
      return response;
    }
  };
}

/** Routes the whole process's fetch (the Next server included) through systemFetch. */
function installSystemFetch() {
  if (globalThis.fetch.__systemNetwork) return;
  const wrapped = systemFetch(globalThis.fetch.bind(globalThis));
  wrapped.__systemNetwork = true;
  globalThis.fetch = wrapped;
}

module.exports = { installSystemFetch, systemFetch, isNetworkFailure };
