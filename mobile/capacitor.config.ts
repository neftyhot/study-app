import type { CapacitorConfig } from "@capacitor/cli";

/**
 * The iOS bundle identifier. `com.example.meganstudy` is a placeholder:
 * before signing, replace it here, in the Xcode target (General → Bundle
 * Identifier) and in the deck file type in ios/App/App/Info.plist — see
 * docs/MOBILE_ARCHITECTURE.md, "Before the first TestFlight build".
 */
export const BUNDLE_ID = "com.example.meganstudy";

const config: CapacitorConfig = {
  appId: BUNDLE_ID,
  appName: "Megan Study",
  webDir: "dist",
  ios: {
    // Content runs edge to edge; the CSS pads with env(safe-area-inset-*).
    contentInset: "never",
    scheme: "Megan Study",
  },
  plugins: {
    SplashScreen: {
      // The native launch screen is the theme's plain background colour; the
      // web splash (the wordmark) takes over once the page has painted.
      launchAutoHide: false,
      backgroundColor: "#ffffff",
      showSpinner: false,
    },
    CapacitorSQLite: {
      iosDatabaseLocation: "Library/CapacitorDatabase",
      iosIsEncryption: false,
    },
    LocalNotifications: {
      iconColor: "#111111",
    },
    // In-app updates (src/platform/updates.ts). The app checks GitHub itself
    // and only when asked or at start; nothing goes to Capgo's servers:
    // statsUrl "" turns off its crash and error reports, which would break
    // the "counts and event names only" promise.
    CapacitorUpdater: {
      autoUpdate: false,
      updateUrl: "",
      statsUrl: "",
      channelUrl: "",
      // A new version that fails to start within this time rolls back.
      appReadyTimeout: 15000,
      // Installing a new build from Xcode drops downloaded versions.
      resetWhenUpdate: true,
    },
  },
};

export default config;
