import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { isSafeStoredPath, resolveUnder, UnsafePathError } from "./safe-path";

const root = resolve("/tmp/uploads-root");

describe("isSafeStoredPath", () => {
  it("accepts the paths the app stores", () => {
    expect(isSafeStoredPath("cards/exam-1/abc.png")).toBe(true);
    expect(isSafeStoredPath("exam-1\\file.pdf")).toBe(true);
    expect(isSafeStoredPath("exam-1/..notes.txt")).toBe(true);
  });

  it.each([
    "../secret",
    "cards/../../secret",
    "cards\\..\\..\\secret",
    "/etc/passwd",
    "\\\\server\\share\\x",
    "C:\\Windows\\win.ini",
    "C:/Windows/win.ini",
    "",
    "a\0b",
  ])("refuses %j", (path) => {
    expect(isSafeStoredPath(path)).toBe(false);
  });
});

describe("resolveUnder", () => {
  it("resolves inside the root", () => {
    expect(resolveUnder(root, "cards/e/x.png")).toBe(join(root, "cards", "e", "x.png"));
  });

  it("throws rather than leaving the root", () => {
    expect(() => resolveUnder(root, "../uploads-root-evil/x")).toThrow(UnsafePathError);
    expect(() => resolveUnder(root, "cards/../..")).toThrow(UnsafePathError);
    expect(() => resolveUnder(root, ".")).toThrow(UnsafePathError);
  });
});
