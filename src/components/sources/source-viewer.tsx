"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Crosshair, Loader2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { SourceDocumentView, SourceUnitView } from "@/lib/ingest/document";
import { cn } from "@/lib/utils";

/**
 * The file a card came from, opened at the page it cites.
 *
 * Slideshows and PDFs show every page as a picture (text when there is none to
 * draw); transcripts and documents read as one continuous text. Either way the
 * cited unit is outlined and scrolled to, and the rest is a scroll away.
 */
export function SourceViewer({
  slideId,
  excerpt,
  open,
  onOpenChange,
}: {
  slideId: string | null;
  excerpt?: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  // Each answer is kept with the slide it answers, so opening another card
  // shows "Loading…" rather than the previous file.
  const [loaded, setLoaded] = useState<{
    slideId: string;
    document?: SourceDocumentView;
    error?: string;
  } | null>(null);
  const current = loaded && loaded.slideId === slideId ? loaded : null;
  const document = current?.document ?? null;
  const error = current?.error ?? null;
  const scrollRef = useRef<HTMLDivElement>(null);
  const targetRef = useRef<HTMLElement | null>(null);
  // Pictures above the cited page load after the jump and push it down; until
  // the student scrolls themselves, keep it in place.
  const userMoved = useRef(false);

  useEffect(() => {
    if (!open || !slideId) return;
    let cancelled = false;
    userMoved.current = false;
    fetch(`/api/slides/${slideId}/document`)
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error ?? "Could not open the source.");
        if (!cancelled) setLoaded({ slideId, document: payload as SourceDocumentView });
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          setLoaded({ slideId, error: cause instanceof Error ? cause.message : String(cause) });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [open, slideId]);

  const jumpToTarget = useCallback((smooth = false) => {
    targetRef.current?.scrollIntoView({
      block: "start",
      behavior: smooth ? "smooth" : "auto",
    });
  }, []);

  useEffect(() => {
    if (!document) return;
    const frame = requestAnimationFrame(() => jumpToTarget());
    return () => cancelAnimationFrame(frame);
  }, [document, jumpToTarget]);

  const settle = useCallback(() => {
    if (!userMoved.current) jumpToTarget();
  }, [jumpToTarget]);

  const target = document?.units.find((unit) => unit.id === document.targetId);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[88vh] flex-col gap-3 sm:max-w-4xl">
        <DialogHeader className="pr-8">
          <DialogTitle className="truncate">
            {document?.filename ?? "Original source"}
          </DialogTitle>
          <DialogDescription className="flex flex-wrap items-center gap-2">
            {document && target ? (
              <>
                <span>
                  This card comes from {document.unitLabel.toLowerCase()} {target.index} of{" "}
                  {document.units.length}.
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-6 px-2 text-xs"
                  onClick={() => jumpToTarget(true)}
                >
                  <Crosshair className="size-3" />
                  Back to {document.unitLabel.toLowerCase()} {target.index}
                </Button>
              </>
            ) : (
              "Opening the file this card was built from…"
            )}
          </DialogDescription>
        </DialogHeader>

        <div
          ref={scrollRef}
          className="bg-muted/40 -mx-4 -mb-4 min-h-0 flex-1 overflow-y-auto rounded-b-xl px-4 py-4"
          onWheel={() => (userMoved.current = true)}
          onTouchMove={() => (userMoved.current = true)}
          onKeyDown={() => (userMoved.current = true)}
          onPointerDown={() => (userMoved.current = true)}
          tabIndex={0}
        >
          {error ? (
            <p className="text-destructive text-sm">{error}</p>
          ) : !document ? (
            <div className="text-muted-foreground flex h-full items-center justify-center gap-2">
              <Loader2 className="size-4 animate-spin" />
              Loading…
            </div>
          ) : document.layout === "pages" ? (
            <div className="mx-auto max-w-3xl space-y-6">
              {document.units.map((unit) => (
                <PageUnit
                  key={unit.id}
                  unit={unit}
                  label={document.unitLabel}
                  wholePage={document.wholePages}
                  cited={unit.id === document.targetId}
                  excerpt={excerpt}
                  ref={unit.id === document.targetId ? (node) => void (targetRef.current = node) : undefined}
                  onImageLoad={unit.index < (target?.index ?? 0) ? settle : undefined}
                />
              ))}
            </div>
          ) : (
            <article className="bg-card mx-auto max-w-3xl space-y-1 rounded-lg border p-5 shadow-sm">
              {document.units.map((unit) => (
                <TextUnit
                  key={unit.id}
                  unit={unit}
                  label={document.unitLabel}
                  cited={unit.id === document.targetId}
                  excerpt={excerpt}
                  ref={unit.id === document.targetId ? (node) => void (targetRef.current = node) : undefined}
                />
              ))}
            </article>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function PageUnit({
  unit,
  label,
  wholePage,
  cited,
  excerpt,
  ref,
  onImageLoad,
}: {
  unit: SourceUnitView;
  label: string;
  /** The picture is the page itself, not one image off a slide. */
  wholePage: boolean;
  cited: boolean;
  excerpt?: string | null;
  ref?: (node: HTMLElement | null) => void;
  onImageLoad?: () => void;
}) {
  const [imageFailed, setImageFailed] = useState(false);
  const showImage = unit.hasImage && !imageFailed;
  // A PDF page's picture already shows its words; a slide's picture does not.
  const showText = !showImage || !wholePage;

  return (
    <section ref={ref} className="scroll-mt-2 space-y-1.5">
      <p className="text-muted-foreground flex items-center gap-2 text-xs font-medium">
        {label} {unit.index}
        {cited ? <Badge className="h-5">This card</Badge> : null}
      </p>
      <div
        className={cn(
          "bg-card overflow-hidden rounded-lg border shadow-sm",
          cited && "ring-primary ring-offset-background ring-2 ring-offset-2",
        )}
      >
        {showImage ? (
          // eslint-disable-next-line @next/next/no-img-element -- served from the local store, not optimisable
          <img
            src={`/api/slides/${unit.id}/image`}
            alt={`${label} ${unit.index}`}
            loading={cited ? "eager" : "lazy"}
            className="block min-h-40 w-full"
            onLoad={onImageLoad}
            onError={() => setImageFailed(true)}
          />
        ) : null}
        {showText ? (
          <div className={cn("space-y-2 p-4 text-sm", showImage && "border-t")}>
            {unit.title ? <p className="text-base font-semibold">{unit.title}</p> : null}
            {(
              <p className="whitespace-pre-wrap break-words">
                {cited ? <Highlighted text={unit.text} excerpt={excerpt} /> : unit.text || "(No text on this page.)"}
              </p>
            )}
          </div>
        ) : null}
        {unit.speakerNotes ? (
          <details className="border-t px-4 py-2 text-xs">
            <summary className="text-muted-foreground cursor-pointer">Speaker notes</summary>
            <p className="mt-1 whitespace-pre-wrap">{unit.speakerNotes}</p>
          </details>
        ) : null}
      </div>
    </section>
  );
}

function TextUnit({
  unit,
  label,
  cited,
  excerpt,
  ref,
}: {
  unit: SourceUnitView;
  label: string;
  cited: boolean;
  excerpt?: string | null;
  ref?: (node: HTMLElement | null) => void;
}) {
  return (
    <section
      ref={ref}
      className={cn(
        "scroll-mt-2 rounded-md px-3 py-2 text-sm leading-relaxed",
        cited && "bg-primary/10 ring-primary/40 ring-1",
      )}
    >
      <p className="text-muted-foreground mb-1 flex items-center gap-2 text-xs font-medium">
        {unit.title ?? `${label} ${unit.index}`}
        {cited ? <Badge className="h-5">This card</Badge> : null}
      </p>
      <p className="whitespace-pre-wrap break-words">
        {cited ? <Highlighted text={unit.text} excerpt={excerpt} /> : unit.text}
      </p>
    </section>
  );
}

/** The card's quoted excerpt, marked where it appears in the text. */
function Highlighted({ text, excerpt }: { text: string; excerpt?: string | null }) {
  const quote = excerpt?.trim();
  const at = quote ? text.toLowerCase().indexOf(quote.toLowerCase()) : -1;
  if (!quote || at < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, at)}
      <mark className="bg-primary/25 text-foreground rounded px-0.5">
        {text.slice(at, at + quote.length)}
      </mark>
      {text.slice(at + quote.length)}
    </>
  );
}
