"use client";

/**
 * What to do with a selection.
 *
 * The destructive action is separated from the rest and confirmed, and the
 * two that involve another deck say which one they mean before they run.
 * Moving keeps a card's review history, because the history belongs to the
 * card; copying does not, because the copy is a card the student has never
 * seen and a schedule that claims otherwise is a lie.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Copy, FolderInput, Loader2, Star, Tag, Trash2, X } from "lucide-react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/manage/confirm-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { bulkCardAction } from "@/lib/cards/actions";

export type DeckTarget = { id: string; title: string; courseTitle: string };

export function BulkBar({
  examId,
  selected,
  decks,
  onDone,
}: {
  examId: string;
  selected: string[];
  /** Every other deck, for move and copy. */
  decks: DeckTarget[];
  onDone: () => void;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [moving, setMoving] = useState<"move" | "duplicate" | null>(null);
  const [target, setTarget] = useState(decks[0]?.id ?? "");
  const [retagging, setRetagging] = useState(false);
  const [topic, setTopic] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);

  const count = selected.length;

  async function run(
    action: Parameters<typeof bulkCardAction>[2],
    describe: (affected: number) => string,
  ) {
    setBusy(true);
    try {
      const result = await bulkCardAction(examId, selected, action);
      toast.success(describe(result.affected));
      onDone();
      router.refresh();
    } finally {
      setBusy(false);
      setMoving(null);
      setRetagging(false);
    }
  }

  return (
    <>
      <div className="bg-background sticky top-14 z-30 flex flex-wrap items-center gap-2 rounded-md border p-2 shadow-sm">
        <span className="text-sm font-medium">
          {count} selected
        </span>

        <Button
          variant="outline"
          size="sm"
          disabled={busy || decks.length === 0}
          onClick={() => setMoving("move")}
        >
          <FolderInput className="size-4" />
          Move
        </Button>

        <Button
          variant="outline"
          size="sm"
          disabled={busy || decks.length === 0}
          onClick={() => setMoving("duplicate")}
        >
          <Copy className="size-4" />
          Copy to…
        </Button>

        <Button
          variant="outline"
          size="sm"
          disabled={busy}
          onClick={() => setRetagging(true)}
        >
          <Tag className="size-4" />
          Re-tag
        </Button>

        <Button
          variant="outline"
          size="sm"
          disabled={busy}
          onClick={() =>
            void run({ kind: "star", starred: true }, (n) => `Starred ${n} card(s)`)
          }
        >
          <Star className="size-4" />
          Star
        </Button>

        <Button
          variant="outline"
          size="sm"
          disabled={busy}
          onClick={() => setConfirmDelete(true)}
        >
          <Trash2 className="size-4" />
          Delete
        </Button>

        <Button variant="ghost" size="sm" onClick={onDone} className="ml-auto">
          <X className="size-4" />
          Clear
        </Button>

        {busy ? <Loader2 className="size-4 animate-spin" /> : null}
      </div>

      <Dialog open={moving !== null} onOpenChange={(open) => !open && setMoving(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {moving === "move" ? "Move" : "Copy"} {count} card
              {count === 1 ? "" : "s"}
            </DialogTitle>
            <DialogDescription>
              {moving === "move"
                ? "Review history goes with them — it belongs to the card, not to the deck."
                : "The copies start unstudied, since they are cards you have not seen in that deck."}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-1">
            <Label htmlFor="target-deck">Deck</Label>
            <Select value={target} onValueChange={setTarget}>
              <SelectTrigger id="target-deck">
                <SelectValue placeholder="Choose a deck" />
              </SelectTrigger>
              <SelectContent>
                {decks.map((deck) => (
                  <SelectItem key={deck.id} value={deck.id}>
                    {deck.courseTitle} · {deck.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <Button
            disabled={busy || !target}
            onClick={() =>
              void run(
                moving === "move"
                  ? { kind: "move", targetExamId: target }
                  : { kind: "duplicate", targetExamId: target },
                (n) =>
                  moving === "move" ? `Moved ${n} card(s)` : `Copied ${n} card(s)`,
              )
            }
          >
            {moving === "move" ? "Move them" : "Copy them"}
          </Button>
        </DialogContent>
      </Dialog>

      <Dialog open={retagging} onOpenChange={setRetagging}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Re-tag {count} card{count === 1 ? "" : "s"}
            </DialogTitle>
            <DialogDescription>
              The topic is what groups cards in the browser and what a study
              session can be narrowed to.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-1">
            <Label htmlFor="new-topic">New topic</Label>
            <Input
              id="new-topic"
              value={topic}
              placeholder="e.g. Adrenal cortex"
              onChange={(event) => setTopic(event.target.value)}
            />
          </div>

          <Button
            disabled={busy || !topic.trim()}
            onClick={() =>
              void run({ kind: "retag", topic }, (n) => `Re-tagged ${n} card(s)`)
            }
          >
            Re-tag them
          </Button>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={`Delete ${count} card${count === 1 ? "" : "s"}?`}
        description="This cannot be undone."
        impact={[
          "The cards go, along with their rubrics",
          "Their review history and mastery go with them",
          "Your source material is untouched",
        ]}
        confirmLabel="Delete them"
        onConfirm={async () => {
          await run({ kind: "delete" }, (n) => `Deleted ${n} card(s)`);
        }}
      />
    </>
  );
}
