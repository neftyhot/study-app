import JSZip from "jszip";
import { describe, expect, it } from "vitest";

import { loadZipWithinLimits, MAX_ZIP_ENTRIES, ZipTooLargeError } from "./zip-limits";

async function zipOf(files: Record<string, string>) {
  const zip = new JSZip();
  for (const [name, body] of Object.entries(files)) zip.file(name, body);
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

describe("loadZipWithinLimits", () => {
  it("opens an ordinary archive", async () => {
    const zip = await loadZipWithinLimits(await zipOf({ "a.xml": "<a/>" }));
    expect(await zip.file("a.xml")!.async("string")).toBe("<a/>");
  });

  it("turns away an archive with too many parts", async () => {
    const files: Record<string, string> = {};
    for (let i = 0; i <= MAX_ZIP_ENTRIES; i++) files[`f${i}`] = "";
    await expect(loadZipWithinLimits(await zipOf(files))).rejects.toBeInstanceOf(
      ZipTooLargeError,
    );
  });
});
