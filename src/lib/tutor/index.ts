/**
 * The tutor (PRD §10).
 *
 * Plain functions over an `LlmProvider`, like every other model-facing part of
 * this app: the panel, a script and a test all reach the same code, and none
 * of them knows which provider is behind it. The code itself lives in the
 * shared core so the iOS tutor asks exactly the same way.
 */
export * from "./schemas";
export * from "./prompts";
export * from "@megan/core/tutor/ask";
