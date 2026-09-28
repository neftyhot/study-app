/**
 * Draws a PowerPoint deck's slides as pictures, with nothing but Electron.
 *
 * The app's own server serves a page that lays each slide out in HTML and SVG
 * (@aiden0z/pptx-renderer); a hidden, offscreen window loads it and takes a
 * screenshot of one slide at a time. No presentation program, no permission
 * prompt, no folder picker, and the same result on every computer.
 *
 * The Next server runs in this process, so it calls in through a global
 * (see src/lib/ingest/slide-render.ts), as it does for the keychain.
 */
const { BrowserWindow } = require("electron");

/** A generous ceiling: a 300-slide deck draws in well under a minute. */
const DECK_TIMEOUT_MS = 180_000;

/** One deck at a time; each draw is quick, and they would only fight. */
let queue = Promise.resolve();

function drawSlides(pageUrl) {
  const run = queue.then(() => draw(pageUrl));
  queue = run.catch(() => {});
  return run;
}

async function draw(pageUrl) {
  const window = new BrowserWindow({
    show: false,
    width: 1600,
    height: 900,
    webPreferences: {
      offscreen: true,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      javascript: true,
    },
  });
  // Nothing on the page may navigate or open anything.
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event) => event.preventDefault());

  const deadline = Date.now() + DECK_TIMEOUT_MS;
  const call = (code) => window.webContents.executeJavaScript(code, true);

  try {
    await window.loadURL(pageUrl);
    let info = null;
    while (!info) {
      if (Date.now() > deadline) throw new Error("The slides took too long to draw.");
      info = await call("window.__deck ?? null");
      if (!info) await new Promise((resolve) => setTimeout(resolve, 50));
    }
    if (info.error) throw new Error(info.error);

    const pictures = [];
    for (let index = 0; index < info.count; index += 1) {
      if (Date.now() > deadline) throw new Error("The slides took too long to draw.");
      const size = await call(`window.__showSlide(${index})`);
      const width = Math.max(1, Math.ceil(size.width));
      const height = Math.max(1, Math.ceil(size.height));
      const [current] = window.getContentSize();
      if (current !== width) window.setContentSize(width, height);
      // Let the resized frame paint before it is captured.
      await call("new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))");
      const image = await window.webContents.capturePage({ x: 0, y: 0, width, height });
      pictures.push(image.toPNG());
    }
    return pictures;
  } finally {
    window.destroy();
  }
}

module.exports = { drawSlides };
