import type { Metadata } from "next";
import { Geist, Geist_Mono, Nunito } from "next/font/google";

import { SiteHeader } from "@/components/layout/site-header";
import { PrivacyGate } from "@/components/privacy/privacy-gate";
import { TimeTracker } from "@/components/layout/time-tracker";
import { WhatsNew } from "@/components/layout/whats-new";
import { ThemePersistence } from "@/components/theme-persistence";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { db } from "@/db";
import { APP_VERSION } from "@/lib/app-info";
import { appearanceCss, THEME_IDS, themeBootScript } from "@/lib/appearance";
import { CHANGELOG } from "@/lib/changelog";
import { hasAcceptedPrivacy, readAppearance, readTheme } from "@/lib/settings";

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
  const bootScript = themeBootScript(savedTheme);

  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} ${nunito.variable} h-full antialiased`}
    >
      <head>
        {/* The student's colours, corners and sizes, in place before first
            paint. Built only from checked values (see appearance.ts). */}
        <style
          id="appearance-css"
          dangerouslySetInnerHTML={{ __html: appearanceCss(readAppearance(db)) }}
        />
        {/* The saved style, on <html> before first paint; see themeBootScript. */}
        {bootScript ? (
          <script id="theme-boot" dangerouslySetInnerHTML={{ __html: bootScript }} />
        ) : null}
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
          {/* Nothing else — header, pages, time tracking — until the privacy
              policy is agreed to; see privacy-policy.ts. */}
          {hasAcceptedPrivacy(db) ? (
            <>
              <SiteHeader />
              <WhatsNew
                version={APP_VERSION}
                notes={CHANGELOG.find((entry) => entry.version === APP_VERSION)?.notes ?? []}
              />
              <TimeTracker />
              <main className="mx-auto w-full max-w-(--content-width) flex-1 px-4 py-8">
                {children}
              </main>
            </>
          ) : (
            <PrivacyGate />
          )}
          </TooltipProvider>
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
