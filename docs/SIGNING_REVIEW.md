# Signing and notarization review

Reviewed for the campus launch (Phase 4). Nothing here was changed in the
build config: no signing team, certificate, or notarization credentials were
added. This is what exists, what students will see because of it, and what a
person with the accounts needs to do.

## What the build does today

**macOS** (`package.json` → `build.mac`, `.github/workflows/release.yml`)

- Targets: `dmg`, arm64 on `macos-14`, x64 on `macos-15-intel`.
- No `identity`, `hardenedRuntime`, `entitlements`, or `notarize` keys, and the
  workflow sets no `CSC_LINK` / `APPLE_*` secrets. electron-builder finds no
  Developer ID certificate on the runner, so the app is **ad-hoc signed** (the
  minimum arm64 needs to launch) and **not notarized**.
- `electronFuses.resetAdHocDarwinSignature: true` re-signs ad-hoc after the
  fuses are flipped, which is right for this setup.
- `NSMicrophoneUsageDescription` is set (Lectures recording).
- Fuses: `runAsNode`, `NODE_OPTIONS` and inspector flags are off;
  `enableEmbeddedAsarIntegrityValidation` and `onlyLoadAppFromAsar` are on.
  `.next/standalone/**` and `node_modules/**` are unpacked (see
  `electron/README.md`), so the integrity check does not cover the server
  code. Signing the app is what protects those files.

**Windows**

- `nsis` and `portable` on x64 (`windows-latest`), plus an arm64 build on
  `windows-11-arm` via `npm run build:win-arm64`.
- No certificate (`win.certificateFile`, `azureSignOptions`, `CSC_LINK`), so
  the installer and the exe are **unsigned**.

**Linux**: AppImage, unsigned (normal for AppImage).

**Auto-update**: none (`electron-updater` is not used), so the lack of
signing doesn't break an updater. Students download new versions from the
site.

## What students see

- **Mac:** the first open of a downloaded, quarantined, unnotarized app is
  blocked ("Apple could not verify…"). On macOS 15 and later, Control-click →
  Open no longer bypasses this; the student has to go to System Settings →
  Privacy & Security → Open Anyway. The download page FAQ already walks
  through this. Expect some students to give up at this step. It is the
  single biggest install-friction item for a campus launch.
- **Windows:** SmartScreen shows "Windows protected your PC" with the
  publisher "Unknown". The student clicks More info → Run anyway. Some
  campus-managed machines block unsigned installers outright.

## What a human needs to do (not done here, on purpose)

### macOS: Developer ID and notarization

1. Join the Apple Developer Program (individual or organization, US$99/yr).
2. Create a **Developer ID Application** certificate and export it as `.p12`.
3. Create an App Store Connect API key (Users and Access → Integrations) for
   `notarytool`.
4. Add the GitHub Actions secrets: `CSC_LINK` (base64 `.p12`),
   `CSC_KEY_PASSWORD`, `APPLE_API_KEY` (the `.p8` contents or path),
   `APPLE_API_KEY_ID`, `APPLE_API_ISSUER`. Pass them as `env` on both
   `Build and Publish DMG` steps.
5. In `build.mac`, add `"hardenedRuntime": true`, `"notarize": true`, and
   `"entitlements"` / `"entitlementsInherit"` pointing at a plist with at
   least:

   ```xml
   <key>com.apple.security.cs.allow-jit</key><true/>
   <key>com.apple.security.cs.allow-unsigned-executable-memory</key><true/>
   <key>com.apple.security.device.audio-input</key><true/>
   ```

   `audio-input` is required under the hardened runtime or Lectures
   recording silently gets no microphone. If whisper-cli, ffmpeg (shipped in
   `extraResources/audio-tools`) or node-llama-cpp's binaries fail to load
   after signing, add `com.apple.security.cs.disable-library-validation`.
6. Check: `codesign --verify --deep --strict --verbose=2 "Megan Study.app"`,
   `spctl -a -vvv -t install "Megan Study.app"` (should say
   "Notarized Developer ID"), and `xcrun stapler validate` on the dmg. Then
   test recording a lecture, generating cards with a local model, and opening
   a `.meganstudy` file from Finder on a clean Mac.
7. The local machine has no Xcode, so none of this can be checked from here
   today.

### Windows: code signing

- The cheapest route is **Azure Trusted Signing** (monthly fee, needs an
  identity-validated organization or an eligible individual). electron-builder
  supports it through `win.azureSignOptions` with `AZURE_*` secrets.
- The alternative is an OV or EV certificate from a CA. EV gets SmartScreen
  reputation immediately; OV builds it up over downloads.
- Sign both the x64 and the arm64 jobs, and the portable exe as well as the
  installer.

### Release order once signing exists

Ship one signed and notarized build to a few testers on a fresh Mac and a
fresh Windows machine before the campus push. Then update the download-page
FAQ so it no longer tells everyone to use Open Anyway.
