"use client";

import { useEffect, useState } from "react";
import { Download } from "lucide-react";

import { Button } from "@/components/ui/button";
import { checkForUpdateAction, type UpdateInfo } from "@/lib/app-actions";

/** A header chip when GitHub has a newer release than this build. */
export function UpdateNotice() {
  const [update, setUpdate] = useState<UpdateInfo | null>(null);

  useEffect(() => {
    void checkForUpdateAction().then(setUpdate).catch(() => undefined);
  }, []);

  if (!update) return null;

  return (
    <Button asChild size="sm" variant="secondary" className="gap-1">
      {/* Opens in the system browser (electron/main.cjs); the download is a
          new DMG — drag it over the old app, and your decks stay. */}
      <a href={update.download ?? update.url} target="_blank" rel="noreferrer">
        <Download className="size-3.5" />
        <span className="hidden sm:inline">Update to</span> v{update.version}
      </a>
    </Button>
  );
}
