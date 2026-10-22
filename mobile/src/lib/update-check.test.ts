import { describe, expect, it } from "vitest";

import { decide, newer, parseManifest, pickRelease, type Release } from "./update-check";

const DL = "https://github.com/neftyhot/study-app/releases/download/";
const SHA = "a".repeat(64);

function release(tag: string, extra: Partial<Release> = {}): Release {
  return {
    tag_name: tag,
    draft: false,
    assets: [{ name: "latest-ios.json", browser_download_url: `${DL}${tag}/latest-ios.json` }],
    ...extra,
  };
}

describe("in-app updates", () => {
  it("compares versions by number", () => {
    expect(newer("0.1.10", "0.1.9")).toBe(true);
    expect(newer("0.1.0", "0.1.0")).toBe(false);
    expect(newer("1.0", "1.0.0")).toBe(false);
  });

  it("takes the newest iOS release and ignores desktop releases and drafts", () => {
    const picked = pickRelease([
      release("v1.9.0"),
      release("ios-v0.1.2"),
      release("ios-v0.1.10"),
      release("ios-v0.2.0", { draft: true }),
    ]);
    expect(picked).toEqual({ tag: "ios-v0.1.10", manifestUrl: `${DL}ios-v0.1.10/latest-ios.json` });
  });

  it("refuses a manifest hosted anywhere else", () => {
    const elsewhere = release("ios-v0.3.0", {
      assets: [{ name: "latest-ios.json", browser_download_url: "https://example.com/latest-ios.json" }],
    });
    expect(pickRelease([elsewhere])).toBeNull();
    expect(parseManifest({ version: "0.3.0", url: "https://example.com/a.zip", sha256: SHA, requiresNative: "1.0" })).toBeNull();
    expect(parseManifest({ version: "0.3.0", url: `${DL}x/../../a.zip`, sha256: SHA, requiresNative: "1.0" })).toBeNull();
  });

  it("installs a newer version, but not one that needs a newer app from Xcode", () => {
    const manifest = parseManifest({ version: "0.2.0", url: `${DL}ios-v0.2.0/app.zip`, sha256: SHA, requiresNative: "1.0" })!;
    expect(decide(manifest, "0.1.0", "1.0")).toEqual({ kind: "update", manifest });
    expect(decide(manifest, "0.2.0", "1.0")).toEqual({ kind: "none" });
    expect(decide({ ...manifest, requiresNative: "1.1" }, "0.1.0", "1.0")).toEqual({ kind: "needs-reinstall", version: "0.2.0" });
  });
});
