/**
 * A bare page that lays out one slide at a time, for the desktop app's hidden
 * window to photograph (electron/slide-drawer.cjs). Not meant to be opened.
 *
 * It sets `window.__deck` to `{ count, width, height }` (or `{ error }`) once
 * the deck is read, and `window.__showSlide(i)` draws slide i at the top left
 * and resolves to its size in pixels once fonts and layout have settled.
 */
export async function GET(
  _request: Request,
  ctx: RouteContext<"/api/decks/[fileId]/draw">,
) {
  const { fileId } = await ctx.params;
  const deckUrl = `/api/decks/${encodeURIComponent(fileId)}/pptx`;

  const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
  html, body { margin: 0; padding: 0; background: #fff; overflow: hidden; }
  #slide { position: absolute; left: 0; top: 0; }
</style>
</head>
<body>
<div id="slide"></div>
<script type="module">
import { PptxViewer, parseZip, buildPresentation, RECOMMENDED_ZIP_LIMITS } from "/api/decks/renderer";

const frame = () => new Promise((resolve) => requestAnimationFrame(() => resolve()));

try {
  const response = await fetch(${JSON.stringify(deckUrl)});
  if (!response.ok) throw new Error("Could not read the slideshow.");
  const files = await parseZip(await response.arrayBuffer(), RECOMMENDED_ZIP_LIMITS);
  const deck = await buildPresentation(files);
  const container = document.getElementById("slide");
  const viewer = new PptxViewer(container, { fitMode: "none", pdfjs: false });
  await viewer.load(deck);
  // Big enough to read small print, never bigger than a 1080p screen needs.
  const scale = Math.min(2, 1920 / deck.width);
  let shown = null;

  window.__showSlide = async (index) => {
    shown?.dispose?.();
    container.replaceChildren();
    shown = await viewer.renderSlideToContainer(index, container, scale);
    await document.fonts.ready;
    await frame();
    await frame();
    const box = container.firstElementChild?.getBoundingClientRect();
    return {
      width: box?.width || deck.width * scale,
      height: box?.height || deck.height * scale,
    };
  };
  window.__deck = { count: deck.slides.length, width: deck.width, height: deck.height };
} catch (error) {
  window.__deck = { error: error instanceof Error ? error.message : String(error) };
}
</script>
</body>
</html>`;

  return new Response(html, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}
