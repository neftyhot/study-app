/**
 * Prepares Next.js standalone output for packaging.
 *
 * `output: "standalone"` emits a server plus only the modules it traced, which
 * is what keeps the desktop bundle to a sane size. It does NOT copy the static
 * assets or `public/`, because a normal deployment serves those from a CDN —
 * a desktop app has no CDN, so they are copied in here.
 */
import { cp, mkdir, access } from "node:fs/promises";
import { join } from "node:path";

const root = process.cwd();
const standalone = join(root, ".next", "standalone");

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  if (!(await exists(standalone))) {
    throw new Error(
      'No standalone output. Run `next build` with output: "standalone" first.',
    );
  }

  await mkdir(join(standalone, ".next"), { recursive: true });
  await cp(join(root, ".next", "static"), join(standalone, ".next", "static"), {
    recursive: true,
  });

  if (await exists(join(root, "public"))) {
    await cp(join(root, "public"), join(standalone, "public"), {
      recursive: true,
    });
  }

  // Migrations are read at startup by the main process, from the app root.
  await cp(join(root, "drizzle"), join(standalone, "drizzle"), {
    recursive: true,
  });

  console.log("Standalone output prepared for packaging.");
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
