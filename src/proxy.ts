/**
 * Only this app's own windows may use its server.
 *
 * The desktop app runs the server on a local port, and anything else on the
 * computer can reach that port too: another program, or a web page in a
 * browser aimed at 127.0.0.1. So each launch the Electron main process makes
 * a fresh secret, hands it to the server through a global, and adds it to
 * every request its own windows send (electron/main.cjs). A request without
 * it is refused before it reaches a page or a route.
 *
 * Only in production, which is what the packaged app runs as. `next dev` has
 * no main process in front of it to hand out a secret.
 */
import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";

const LAUNCH_SECRET_HEADER = "x-study-app-launch";

function launchSecret(): string | null {
  const secret = (globalThis as { __studyAppLaunchSecret?: unknown }).__studyAppLaunchSecret;
  return typeof secret === "string" && secret.length > 0 ? secret : null;
}

function matches(given: string, expected: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function proxy(request: NextRequest) {
  if (process.env.NODE_ENV !== "production") return NextResponse.next();

  // No secret means nothing handed one out: the server was started some way
  // other than by the app, so nobody is let in.
  const expected = launchSecret();
  const given = request.headers.get(LAUNCH_SECRET_HEADER);
  if (!expected || !given || !matches(given, expected)) {
    return new NextResponse("Forbidden", { status: 403 });
  }
  return NextResponse.next();
}
