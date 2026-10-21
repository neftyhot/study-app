import type { Metadata } from "next";
import { Geist, Geist_Mono, Nunito } from "next/font/google";
import localFont from "next/font/local";

import { BootScript } from "@/components/boot-script";
import { StatusBanner, StatusScreen, StatusWatcher } from "@/components/layout/app-status";
import { LaunchSplash } from "@/components/layout/launch-splash";
import { SiteHeader } from "@/components/layout/site-header";
import { RecorderProvider } from "@/components/lectures/recorder";
import { PrivacyGate } from "@/components/privacy/privacy-gate";
import { ShareFileListener } from "@/components/share/share-import";
import { readLicenseStatus, TRIAL_DAYS } from "@/lib/license/status";
import { TimeTracker } from "@/components/layout/time-tracker";
import { WhatsNew } from "@/components/layout/whats-new";
import { KeyGateProvider } from "@/components/settings/key-gate";
import { UpgradeGuideHost } from "@/components/settings/upgrade-guide";
import { ThemePersistence } from "@/components/theme-persistence";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { db } from "@/db";
import { APP_VERSION } from "@/lib/app-info";
import {
  aiBlockReason,
  aiRestricted,
  blockingScreen,
  FEATURE_LABELS,
  readAppStatus,
  refreshAppStatus,
  statusSignature,
  type AppStatus,
} from "@/lib/app-status";
import { appearanceCss, THEME_IDS, themeBootScript } from "@/lib/appearance";
import { CHANGELOG } from "@/lib/changelog";
import { recordFunnel } from "@/lib/funnel";
import { SPLASH_BOOT_SCRIPT } from "@/lib/launch/choreography";
import { hasAcceptedPrivacy, isAnswerable, readAppearance, readProvider, readTheme } from "@/lib/settings";

import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

/** The Bubble styles' rounded face, and a choice in Appearance settings. */
const nunito = Nunito({
  variable: "--font-nunito",
  subsets: ["latin"],
});

/**
 * Atkinson Hyperlegible, the readable choice in Appearance. Shipped in the app
 * (OFL, see fonts/atkinson/OFL.txt) so it works offline and loads nothing.
 */
const atkinson = localFont({
  variable: "--font-atkinson",
  display: "swap",
  src: [
    { path: "./fonts/atkinson/atkinson-hyperlegible-latin-400-normal.woff2", weight: "400", style: "normal" },
    { path: "./fonts/atkinson/atkinson-hyperlegible-latin-400-italic.woff2", weight: "400", style: "italic" },
    { path: "./fonts/atkinson/atkinson-hyperlegible-latin-700-normal.woff2", weight: "700", style: "normal" },
    { path: "./fonts/atkinson/atkinson-hyperlegible-latin-700-italic.woff2", weight: "700", style: "italic" },
  ],
});

export const metadata: Metadata = {
  title: "Megan Study",
  description:
    "Turn your lecture slides and study guides into flashcards, a study guide and practice exams.",
};

/**
 * Nothing in this app may be prerendered.
 *
 * Every page reads the local database — the courses that exist, the cards due,
 * whether an API key is saved. Statically rendering any of them bakes the
 * build machine's state into the output, which in a packaged desktop app
 * means shipping one developer's data to every user. That is not theoretical:
 * the settings page was prerendered with a real key's last four characters in
 * it before this line existed.
 */
export const dynamic = "force-dynamic";

export default function RootLayout({ children }: LayoutProps<"/">) {
  const savedTheme = readTheme(db);
  const license = readLicenseStatus();
  // Kept on this machine until the student agrees to usage statistics.
  recordFunnel(db, "first_launch");
  if (license?.type === "student" || license?.type === "lifetime") recordFunnel(db, "purchased");
  const bootScript = themeBootScript(savedTheme);
  const status = readAppStatus(db);
  // Ask the server in the background; StatusWatcher refreshes if it changed.
  void refreshAppStatus(db);
  const screen = blockingScreen(status, db);
  const banner = statusBanner(status);

  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} ${nunito.variable} ${atkinson.variable} h-full antialiased`}
    >
      <head>
        {/* The student's colors, corners and sizes, in place before first
            paint. Built only from checked values (see appearance.ts). */}
        <style
          id="appearance-css"
          dangerouslySetInnerHTML={{ __html: appearanceCss(readAppearance(db)) }}
        />
        {/* The saved style, on <html> before first paint; see themeBootScript. */}
        {bootScript ? (
          <BootScript id="theme-boot" code={bootScript} />
        ) : null}
        {/* Cold launch only: lets the splash cover first paint. */}
        <BootScript id="splash-boot" code={SPLASH_BOOT_SCRIPT} />
      </head>
      <body className="flex min-h-full flex-col">
        <ThemeProvider
          attribute={["class", "data-theme"]}
          defaultTheme="system"
          themes={[...THEME_IDS]}
          enableSystem
          disableTransitionOnChange
        >
          <ThemePersistence saved={savedTheme} />
          <TooltipProvider>
          <LaunchSplash />
          {/* Nothing else — header, pages, time tracking — until the privacy
              policy is agreed to; see privacy-policy.ts. */}
          {hasAcceptedPrivacy(db) && screen ? (
            <>
              <StatusScreen
                screen={screen}
                message={status.message}
                minVersion={status.minVersion}
                until={status.until}
              />
              <StatusWatcher signature={statusSignature(status)} />
            </>
          ) : hasAcceptedPrivacy(db) ? (
            <KeyGateProvider ready={readProvider(db) === "local" || isAnswerable(db)}>
            <RecorderProvider>
              <SiteHeader />
              {banner ? <StatusBanner text={banner.text} tone={banner.tone} /> : null}
              <StatusWatcher signature={statusSignature(status)} />
              <WhatsNew
                version={APP_VERSION}
                notes={CHANGELOG.find((entry) => entry.version === APP_VERSION)?.notes ?? []}
              />
              <TimeTracker />
              <ShareFileListener />
              <UpgradeGuideHost />
              <main data-reveal className="mx-auto w-full max-w-(--content-width) flex-1 px-4 py-8">
                {children}
              </main>
            </RecorderProvider>
            </KeyGateProvider>
          ) : (
            <PrivacyGate
              trial={
                license?.type === "trial"
                  ? { days: TRIAL_DAYS, daysRemaining: license.daysRemaining }
                  : null
              }
            />
          )}
          </TooltipProvider>
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}

/** What the strip under the header says, if anything: AI being off comes first. */
function statusBanner(status: AppStatus): { text: string; tone: "off" | "note" } | null {
  if (aiRestricted(status)) {
    const reason = aiBlockReason(status);
    if (reason) return { text: reason, tone: "off" };
    const off = Object.keys(status.features).map((key) => FEATURE_LABELS[key as keyof typeof FEATURE_LABELS]);
    const note = status.message.trim();
    return {
      text: `${note ? `${note} ` : ""}Switched off for now: ${off.join(", ")}. Everything else still works.`,
      tone: "off",
    };
  }
  const note = status.message.trim();
  return note ? { text: note, tone: "note" } : null;
}
