# Updating the iPhone app without reinstalling

The iPhone app checks GitHub for a newer version of its screens and logic
each time it opens. It downloads that version in the background, then shows
"An update is ready" with **Restart** and **Later**. If you tap Later, it
switches over the next time the app opens. The Xcode install only has to
happen once.

This covers everything in `mobile/src` and `packages/core`: screens, study
logic and styles. It doesn't cover native changes, like a new Capacitor
plugin, `Info.plist`, icons or the splash screen. Those still need a
reinstall from Xcode (see "Native changes" below).

## How it works

- An update is a GitHub **prerelease** on `neftyhot/study-app`, tagged
  `ios-v<version>`, with two files:
  - `megan-study-ios-<version>.zip`: the built app;
  - `latest-ios.json`: the version, the zip's SHA-256, and the oldest native
    app it runs on (`requiresNative`).
- The phone only trusts that repo. If the zip's hash doesn't match, the
  update is thrown away.
- Prereleases are never the desktop's "latest", so the Mac and Windows
  updaters ignore these.
- If an update crashes before the app finishes starting, the updater rolls
  back to the previous version by itself.
- No card content is sent anywhere. The check is a plain read of the public
  releases list.

## Shipping an update

1. Make your changes and check them in the simulator.
2. Open `mobile/package.json` and raise `"version"`, for example from
   `0.1.0` to `0.1.1`. The phone only takes a version higher than the one it
   has.
3. In Terminal, in the repo folder, run:

   ```
   npm run ios:update
   ```

   This builds the app and puts the zip and `latest-ios.json` in
   `mobile/release/`. That folder isn't committed.
4. The script prints a `gh release create ios-v… --prerelease …` command.
   Check it, then run it yourself. That's the step that publishes.
5. On the phone, open the app, or go to **Settings → Updates → Check for
   updates**. When "An update is ready" appears, tap **Restart**.

## Native changes

If you changed anything under `mobile/ios/`, added a plugin, or bumped
Capacitor:

1. Raise the app version in Xcode (target **App** → General → Version), for
   example to `1.1`.
2. Reinstall from Xcode on the phone (⌘R).
3. From then on, publish updates with
   `npm run ios:update -- --requires 1.1`. Phones still on the older install
   skip them instead of breaking.

## Checking what's running

**Settings → Updates** shows the version the phone is running. It also has
**Check for updates**, plus **Restart now** when an update is waiting.
