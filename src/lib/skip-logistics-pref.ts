"use client";

import { useSyncExternalStore } from "react";

/**
 * The "ignore announcements" choice, shared by card and study-guide
 * generation and remembered on this device. On unless turned off.
 */
const KEY = "megan.skipLogistics";
const EVENT = "megan:skip-logistics";

function read(): boolean {
  try {
    return window.localStorage.getItem(KEY) !== "off";
  } catch {
    return true;
  }
}

function subscribe(onChange: () => void) {
  window.addEventListener(EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

export function useSkipLogistics(): [boolean, (next: boolean) => void] {
  const value = useSyncExternalStore(subscribe, read, () => true);
  const set = (next: boolean) => {
    try {
      window.localStorage.setItem(KEY, next ? "on" : "off");
    } catch {
      // Not remembered; this run still uses it.
    }
    window.dispatchEvent(new Event(EVENT));
  };
  return [value, set];
}
