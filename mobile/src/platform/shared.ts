/** Small pieces both the iOS and the browser adapters use. */
import type { PickedFile } from "@megan/core/platform/types";

/**
 * A hidden file input. On iOS it opens the Files app picker; in a browser,
 * the usual file dialog. Resolves an empty list when the student cancels.
 */
export function pickWithInput(accept: string, multiple = false): Promise<PickedFile[]> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.multiple = multiple;
    input.addEventListener("change", async () => {
      const files = Array.from(input.files ?? []);
      resolve(
        await Promise.all(
          files.map(async (file) => ({
            name: file.name,
            type: file.type || null,
            bytes: new Uint8Array(await file.arrayBuffer()),
          })),
        ),
      );
    });
    input.addEventListener("cancel", () => resolve([]));
    input.click();
  });
}

export function toBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}
