"use client";

import { SlidersHorizontal } from "lucide-react";

import { Button } from "@/components/ui/button";

/**
 * Opens the deck's Customize section and brings it into view. The section is
 * a native <details>, which a plain #hash link would scroll to but not open.
 */
export function CustomizeButton({ target = "customize" }: { target?: string }) {
  return (
    <Button
      variant="outline"
      onClick={() => {
        const section = document.getElementById(target);
        if (!(section instanceof HTMLDetailsElement)) return;
        section.open = true;
        const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        section.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
      }}
    >
      <SlidersHorizontal className="size-4" />
      Customize
    </Button>
  );
}
