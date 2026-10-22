/**
 * Packages the iPhone/iPad web app as an in-app update (see
 * docs/IOS_UPDATES.md): builds mobile/, zips mobile/dist and writes
 * latest-ios.json next to it in mobile/release/. Publishing is a separate,
 * deliberate step (the `gh release create` line it prints).
 *
 *   npm run ios:update                      # requiresNative = the Xcode app's version
 *   npm run ios:update -- --requires 1.1    # after changing native code
 */
import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import JSZip from "jszip";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const mobile = path.join(root, "mobile");
const dist = path.join(mobile, "dist");
const out = path.join(mobile, "release");

const { version } = JSON.parse(fs.readFileSync(path.join(mobile, "package.json"), "utf8"));
const pbxproj = fs.readFileSync(path.join(mobile, "ios/App/App.xcodeproj/project.pbxproj"), "utf8");
const marketing = /MARKETING_VERSION = ([^;]+);/.exec(pbxproj)?.[1]?.trim() ?? "1.0";
const flag = process.argv.indexOf("--requires");
const requiresNative = flag > -1 ? process.argv[flag + 1] : marketing;

const tag = `ios-v${version}`;
const zipName = `megan-study-ios-${version}.zip`;

execSync("npm --prefix mobile run build", { cwd: root, stdio: "inherit" });

const zip = new JSZip();
function add(dir, prefix = "") {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    const name = prefix + entry.name;
    if (entry.isDirectory()) add(full, `${name}/`);
    else zip.file(name, fs.readFileSync(full));
  }
}
add(dist);
if (!zip.file("index.html")) throw new Error("mobile/dist has no index.html");
const bytes = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });

fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, zipName), bytes);
const manifest = {
  version,
  url: `https://github.com/neftyhot/study-app/releases/download/${tag}/${zipName}`,
  sha256: createHash("sha256").update(bytes).digest("hex"),
  requiresNative,
};
fs.writeFileSync(path.join(out, "latest-ios.json"), `${JSON.stringify(manifest, null, 2)}\n`);

console.log(`\nPackaged ${tag} (${(bytes.length / 1e6).toFixed(1)} MB), needs the Xcode app at ${requiresNative} or later.`);
console.log("To publish it (phones pick it up on their next check):\n");
console.log(
  `  gh release create ${tag} --prerelease --title "iPhone ${version}" --notes "In-app update" ` +
    `mobile/release/${zipName} mobile/release/latest-ios.json\n`,
);
