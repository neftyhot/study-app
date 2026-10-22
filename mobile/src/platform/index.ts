/**
 * Picks the platform once, at start-up: Capacitor's native bridge on an
 * iPhone or iPad, the browser stand-ins under `npm run dev`.
 */
import { Capacitor } from "@capacitor/core";

import type { Platform } from "@megan/core/platform/types";

export async function createPlatform(): Promise<Platform> {
  if (Capacitor.isNativePlatform()) {
    const { createIosPlatform } = await import("./ios");
    return createIosPlatform();
  }
  const { createWebPlatform } = await import("./web");
  return createWebPlatform();
}
