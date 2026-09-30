"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";
import type { ComponentProps } from "react";

export function ThemeProvider({
  children,
  ...props
}: ComponentProps<typeof NextThemesProvider>) {
  return (
    <NextThemesProvider
      // Its inline script, inert when React makes it in the browser; see BootScript.
      scriptProps={{ type: typeof window === "undefined" ? undefined : "text/plain" }}
      {...props}
    >
      {children}
    </NextThemesProvider>
  );
}
