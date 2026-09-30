"use client";

/**
 * An inline script that runs from the server's HTML, before first paint.
 *
 * React never runs a script it creates in the browser, and warns when it
 * makes one — which happens whenever the root layout is rendered again on the
 * client (after an error, say). Typed as plain text there, it is an inert data
 * block React leaves alone; the server copy, which has already run, keeps the
 * JavaScript type. The type differs only between those two, so the mismatch
 * is suppressed.
 */
export function BootScript({ id, code }: { id: string; code: string }) {
  return (
    <script
      id={id}
      type={typeof window === "undefined" ? undefined : "text/plain"}
      suppressHydrationWarning
      dangerouslySetInnerHTML={{ __html: code }}
    />
  );
}
