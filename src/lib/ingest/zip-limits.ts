/**
 * Office files are zip archives, and a zip can claim to hold far more than it
 * weighs: a few megabytes that inflate to tens of gigabytes. The sizes are
 * read from the archive's directory before anything is unpacked, so a file
 * like that is turned away instead of filling memory.
 */
import JSZip from "jszip";

/** More parts than any real deck or document has. */
export const MAX_ZIP_ENTRIES = 20_000;
/** Everything inside, unpacked. Decks full of video stay well under this. */
export const MAX_ZIP_UNPACKED_BYTES = 2 * 1024 ** 3;

export class ZipTooLargeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ZipTooLargeError";
  }
}

export async function loadZipWithinLimits(buffer: Buffer): Promise<JSZip> {
  const zip = await JSZip.loadAsync(buffer);
  checkZipLimits(zip);
  return zip;
}

export function checkZipLimits(zip: JSZip): void {
  const entries = Object.values(zip.files);
  if (entries.length > MAX_ZIP_ENTRIES) {
    throw new ZipTooLargeError(
      `This file holds ${entries.length.toLocaleString()} parts, more than a real document would.`,
    );
  }

  let total = 0;
  for (const entry of entries) {
    // JSZip keeps the directory's size claim here; it isn't in the typings.
    const size = (entry as unknown as { _data?: { uncompressedSize?: number } })
      ._data?.uncompressedSize;
    if (typeof size === "number" && size > 0) total += size;
    if (total > MAX_ZIP_UNPACKED_BYTES) {
      throw new ZipTooLargeError(
        "This file would unpack to more than 2 GB, so it wasn't opened.",
      );
    }
  }
}
