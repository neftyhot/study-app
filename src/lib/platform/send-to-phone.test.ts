/** The desktop's "Send to my iPhone/iPad": what the shared file is called. */
import { createRequire } from "node:module";

import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { outgoingName } = require("../../../electron/share-files.cjs") as {
  outgoingName: (name: unknown) => string;
};

describe("outgoingName", () => {
  it("keeps a deck name and its extension", () => {
    expect(outgoingName("cell-biology.meganstudy")).toBe("cell-biology.meganstudy");
  });

  it("adds the extension when it is missing", () => {
    expect(outgoingName("Midterm 2")).toBe("Midterm 2.meganstudy");
  });

  it("strips folders and characters a file name cannot hold", () => {
    expect(outgoingName("../../etc/pass:wd*.meganstudy")).toBe("passwd.meganstudy");
  });

  it("falls back to a plain name", () => {
    expect(outgoingName("")).toBe("deck.meganstudy");
    expect(outgoingName(undefined)).toBe("deck.meganstudy");
  });
});
