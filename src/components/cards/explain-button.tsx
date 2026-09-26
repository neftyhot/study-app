"use client";

import { useState } from "react";
import { Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import type { ExplainedCard } from "@/lib/generate/enrich";

/**
 * "Explain Answer" for a card whose explanation was never written.
 *
 * Bulk generation skips explanations to keep a deck cheap; this writes one
 * card's the first time a student asks, and the server stores it so the
 * next person to ask gets it from the database. The caller decides where the
 * result appears — this is only the button and its spinner.
 */
export function ExplainButton({
  cardId,
  onExplained,
  size = "sm",
  label = "Explain Answer",
}: {
  cardId: string;
  onExplained: (result: ExplainedCard) => void;
  size?: "sm" | "default";
  label?: string;
}) {
  const [busy, setBusy] = useState(false);

  async function explain() {
    setBusy(true);
    try {
      const response = await fetch(`/api/cards/${cardId}/explain`, {
        method: "POST",
      });
      const body = (await response.json().catch(() => ({}))) as
        | ExplainedCard
        | { error?: string };

      if (!response.ok || !("cardId" in body)) {
        toast.error(
          ("error" in body && body.error) || "Could not explain this card.",
        );
        return;
      }
      onExplained(body);
    } catch {
      toast.error("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button
      variant="outline"
      size={size}
      className={size === "sm" ? "h-7 px-2 text-xs" : undefined}
      disabled={busy}
      onClick={explain}
    >
      {busy ? (
        <Loader2 className="size-3.5 animate-spin" />
      ) : (
        <Sparkles className="size-3.5" />
      )}
      {busy ? "Explaining…" : label}
    </Button>
  );
}

/** The two misconceptions an explanation comes with, when there are any. */
export function MisconceptionList({ items }: { items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div>
      <p className="text-xs font-medium">Common misconceptions</p>
      <ul className="text-muted-foreground list-disc pl-5 text-xs">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}
