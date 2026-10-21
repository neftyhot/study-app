"use client";

/** A speaker button that reads `text()` aloud, and stops on a second press. */
import { useEffect, useState } from "react";
import { Volume2, VolumeX } from "lucide-react";

import { Button } from "@/components/ui/button";
import { canReadAloud, readAloud, stopReading } from "@/lib/speech/read-aloud";

export function ReadAloudButton({ text, label }: { text: () => string; label: string }) {
  const [available, setAvailable] = useState(false);
  const [speaking, setSpeaking] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setAvailable(canReadAloud());
  }, []);
  // Leaving the page stops this button's reading, not someone else's.
  useEffect(() => () => {
    if (speaking) stopReading();
  }, [speaking]);

  if (!available) return null;

  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-pressed={speaking}
      aria-label={speaking ? "Stop reading" : label}
      title={speaking ? "Stop reading" : label}
      onClick={() => {
        if (speaking) {
          stopReading();
          setSpeaking(false);
          return;
        }
        setSpeaking(true);
        readAloud(text(), () => setSpeaking(false));
      }}
    >
      {speaking ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />}
    </Button>
  );
}
