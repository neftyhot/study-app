"use client";

import Link from "next/link";
import { Check, Palette } from "lucide-react";
import { useTheme } from "next-themes";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { THEME_IDS, THEMES } from "@/lib/appearance";

/** Picks the app's style; the finer controls live in Settings → Appearance. */
export function ThemeToggle() {
  const { theme, setTheme } = useTheme();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Change style">
          <Palette className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuLabel>Style</DropdownMenuLabel>
        {THEME_IDS.map((id) => (
          <DropdownMenuItem key={id} onSelect={() => setTheme(id)}>
            <Swatch id={id} />
            {THEMES[id].label}
            {theme === id ? <Check className="ml-auto size-4" /> : null}
          </DropdownMenuItem>
        ))}
        <DropdownMenuItem onSelect={() => setTheme("system")}>
          <span className="flex size-4 overflow-hidden rounded-full border">
            <span className="w-1/2 bg-white" />
            <span className="w-1/2 bg-neutral-900" />
          </span>
          Match system
          {theme === "system" ? <Check className="ml-auto size-4" /> : null}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/settings#appearance">Colours, corners and text…</Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function Swatch({ id }: { id: (typeof THEME_IDS)[number] }) {
  const { background, primary } = THEMES[id].palette;
  return (
    <span
      aria-hidden
      className="size-4 rounded-full border"
      style={{ background: `linear-gradient(135deg, ${background} 50%, ${primary} 50%)` }}
    />
  );
}
