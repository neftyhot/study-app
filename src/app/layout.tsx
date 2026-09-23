import type { Metadata } from "next";
import { Geist, Geist_Mono, Nunito } from "next/font/google";

import { SiteHeader } from "@/components/layout/site-header";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import { db } from "@/db";
import { appearanceCss, THEME_IDS } from "@/lib/appearance";
import { readAppearance } from "@/lib/settings";

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
  title: "Study App",
  description:
    "Turn lecture slides and study guides into sourced, atomic flashcards.",
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
      </head>
      <body className="flex min-h-full flex-col">
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          themes={[...THEME_IDS]}
          enableSystem
          disableTransitionOnChange
        >
          <SiteHeader />
          <main className="mx-auto w-full max-w-(--content-width) flex-1 px-4 py-8">
            {children}
          </main>
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
