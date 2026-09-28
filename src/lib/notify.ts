"use client";

/**
 * Sonner's toast, with one change: an error that means the student has run
 * out of model quota or credit carries a button that opens the upgrade guide,
 * so "limit reached" is never a dead end.
 */
import { toast as sonner, type ExternalToast } from "sonner";

export const OPEN_UPGRADE_EVENT = "megan:open-upgrade";

/** Opens the upgrade guide from anywhere (mounted once in the layout). */
export function openUpgradeGuide() {
  window.dispatchEvent(new Event(OPEN_UPGRADE_EVENT));
}

const LIMIT =
  /usage limit|out of (quota|credit)|quota|rate.?limit|RESOURCE_EXHAUSTED|credit balance|insufficient_quota|billing|\b429\b|Upgrade/i;

export function isLimitMessage(message: unknown): boolean {
  return typeof message === "string" && LIMIT.test(message);
}

function error(message: Parameters<typeof sonner.error>[0], options?: ExternalToast) {
  if (!isLimitMessage(message)) return sonner.error(message, options);
  return sonner.error(message, {
    duration: 12_000,
    ...options,
    action: { label: "Fix this", onClick: openUpgradeGuide },
  });
}

export const toast: typeof sonner = Object.assign(
  (...args: Parameters<typeof sonner>) => sonner(...args),
  sonner,
  { error },
);
