/**
 * The PowerPoint renderer's browser build, for the slide drawer's page
 * (see ../[fileId]/draw). Served locally so drawing works offline.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";

export async function GET() {
  const script = await readFile(
    join(
      process.cwd(),
      "node_modules/@aiden0z/pptx-renderer/dist/aiden0z-pptx-renderer.browser.es.js",
    ),
  );
  return new Response(script as BodyInit, {
    headers: {
      "content-type": "text/javascript; charset=utf-8",
      "cache-control": "private, max-age=86400",
    },
  });
}
