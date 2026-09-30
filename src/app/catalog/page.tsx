import { CloudOff } from "lucide-react";

import { CatalogView } from "@/components/catalog/catalog-view";
import { listCatalog, listOwnDecks, readCollege } from "@/lib/catalog/store";

/** A shared catalog of decks other students chose to list. */
export default async function CatalogPage() {
  const { decks, offline } = await listCatalog();

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Deck catalog</h1>
        <p className="text-muted-foreground text-sm">
          Decks and study guides other students shared, by college, professor and course. Add one
          to your own decks, or share yours.
        </p>
      </div>

      {offline ? (
        <div className="flex items-start gap-3 rounded-xl border border-dashed p-4 text-sm text-muted-foreground animate-in fade-in">
          <CloudOff className="mt-0.5 size-4 shrink-0" />
          <p>{offline} Your own decks are unaffected.</p>
        </div>
      ) : null}

      <CatalogView decks={decks} ownDecks={listOwnDecks()} college={readCollege()} />
    </div>
  );
}
