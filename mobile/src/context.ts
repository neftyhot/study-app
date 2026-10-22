/** What every screen reaches: the platform, the database, the AI client and navigation. */
import { createContext, useContext } from "react";

import type { LlmProvider } from "@megan/core/llm/types";
import type { Platform, SqlDriver } from "@megan/core/platform/types";

export type CardSource = { kind: "deck"; examId: string } | { kind: "due" } | { kind: "starred" };

export type Route =
  | { name: "home" }
  | { name: "study" }
  | { name: "search" }
  | { name: "settings" }
  | { name: "deck"; examId: string }
  | { name: "cards"; source: CardSource; title: string; swipe?: boolean }
  | { name: "learn"; source: CardSource; title: string }
  | { name: "exam"; examId: string; title: string }
  | { name: "guide"; examId: string; title: string }
  | { name: "tutor"; examId?: string; ask?: string }
  | { name: "snap" }
  | { name: "make"; notes?: { title: string; text: string } }
  | { name: "lectures" }
  | { name: "lecture"; id: string }
  | { name: "catalog" }
  | { name: "desktop"; feature?: string };

export const TABS = ["home", "study", "search", "settings"] as const;
export type Tab = (typeof TABS)[number];

export type AppContextValue = {
  platform: Platform;
  db: SqlDriver;
  /** Null without a saved key: the AI features ask for one first. */
  ai: LlmProvider | null;
  reloadAi(): Promise<void>;
  navigate(route: Route): void;
  back(): void;
  /** Switches tab (and resets it to its first screen when already on it). */
  selectTab(tab: Tab): void;
  /** Bumped after any write a list elsewhere should reflect. */
  version: number;
  changed(): void;
  /** Opens the tutor beside the content on iPad, or as a screen on iPhone. */
  openTutor(examId?: string, ask?: string): void;
  wide: boolean;
};

export const AppContext = createContext<AppContextValue | null>(null);

export function useApp(): AppContextValue {
  const value = useContext(AppContext);
  if (!value) throw new Error("useApp outside <App>");
  return value;
}
