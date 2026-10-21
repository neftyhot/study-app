/**
 * Nothing reaches the catalog server unless the sharer ticked the
 * attestation, whatever the form sent.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/db", () => ({ db: {} }));

import { CatalogError, publishDeck } from "@/lib/catalog/store";
import type { PublishInput } from "@/lib/catalog/types";

const input: PublishInput = {
  examId: "e1",
  title: "Midterm",
  college: "State",
  professor: "Lee",
  course: "BIO 101",
  kind: "exam",
  customKind: null,
  term: null,
  description: null,
  uploader: null,
  includeGuide: false,
  attested: false,
};

afterEach(() => vi.unstubAllGlobals());

describe("publishing to the catalog", () => {
  it("refuses without the attestation and never calls the server", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    await expect(publishDeck(input)).rejects.toThrow(CatalogError);
    await expect(publishDeck({ ...input, attested: "yes" as unknown as boolean })).rejects.toThrow(/made these cards yourself/);
    expect(fetch).not.toHaveBeenCalled();
  });
});
