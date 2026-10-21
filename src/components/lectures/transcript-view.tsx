"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState, useTransition } from "react";
import {
  Check,
  Copy,
  Download,
  Layers,
  Loader2,
  Pencil,
  Search,
  Trash2,
  VolumeX,
} from "lucide-react";
import { toast } from "sonner";

import { PendingTranscript } from "@/components/lectures/pending-transcript";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { TranscriptSegment } from "@/db/schema";
import {
  addLectureToDeckAction,
  deleteLectureAction,
  discardLectureAudioAction,
  renameLectureAction,
} from "@/lib/lectures/actions";
import { formatDuration, formatTimestamp } from "@/lib/lectures/format";
import { cn } from "@/lib/utils";

type Lecture = {
  id: string;
  title: string;
  durationSeconds: number | null;
  createdAt: string;
  fullText: string;
  segments: TranscriptSegment[];
  hasAudio: boolean;
  /** Recorded in the app and saved to transcribe later. */
  untranscribed: boolean;
};

type Deck = { id: string; title: string; courseTitle: string };
type DeckLink = { deckId: string; title: string; syncedAt: string; inDeck: boolean };

/**
 * One transcript: the recording, what was said and when, and the way into a
 * deck. Clicking a line plays the lecture from that line.
 */
export function TranscriptView({
  lecture,
  decks,
  links,
}: {
  lecture: Lecture;
  decks: Deck[];
  links: DeckLink[];
}) {
  const router = useRouter();
  const audio = useRef<HTMLAudioElement>(null);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [query, setQuery] = useState("");
  const [pending, startTransition] = useTransition();

  const needle = query.trim().toLowerCase();
  const shown = useMemo(
    () =>
      needle
        ? lecture.segments.filter((segment) => segment.text.toLowerCase().includes(needle))
        : lecture.segments,
    [lecture.segments, needle],
  );

  const playFrom = (segment: TranscriptSegment) => {
    const player = audio.current;
    if (!player) return;
    player.currentTime = segment.start;
    void player.play().catch(() => {});
  };

  /** The line being spoken: the last one that has started. */
  const onTimeUpdate = () => {
    const time = audio.current?.currentTime ?? 0;
    let low = 0;
    let high = lecture.segments.length - 1;
    let found: number | null = null;
    while (low <= high) {
      const middle = (low + high) >> 1;
      if (lecture.segments[middle].start <= time + 0.05) {
        found = lecture.segments[middle].id;
        low = middle + 1;
      } else {
        high = middle - 1;
      }
    }
    setActiveId(found);
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(lecture.fullText);
      toast.success("Transcript copied.");
    } catch {
      toast.error("Could not copy the transcript.");
    }
  };

  const remove = () => {
    if (
      !window.confirm(
        `Delete "${lecture.title}" and its recording? Notes already added to a deck stay in that deck.`,
      )
    ) {
      return;
    }
    startTransition(async () => {
      const result = await deleteLectureAction(lecture.id);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      router.push("/lectures");
    });
  };

  const discardAudio = () => {
    if (!window.confirm("Remove the recording and keep the transcript? This frees disk space and cannot be undone.")) {
      return;
    }
    startTransition(async () => {
      const result = await discardLectureAudioAction(lecture.id);
      if (!result.ok) toast.error(result.error);
      else router.refresh();
    });
  };

  const words = lecture.fullText.trim() ? lecture.fullText.trim().split(/\s+/).length : 0;

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Title lecture={lecture} />
        <p className="text-muted-foreground text-sm">
          {[
            formatDuration(lecture.durationSeconds),
            lecture.untranscribed ? "Not transcribed yet" : `${words.toLocaleString()} words`,
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>

        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={copy} disabled={words === 0}>
            <Copy className="size-4" />
            Copy
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" disabled={words === 0}>
                <Download className="size-4" />
                Export
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuItem asChild>
                <a href={`/api/lectures/${lecture.id}/export?format=txt`}>Text (.txt)</a>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <a href={`/api/lectures/${lecture.id}/export?format=timestamps`}>
                  Text with timestamps (.txt)
                </a>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <a href={`/api/lectures/${lecture.id}/export?format=srt`}>Subtitles (.srt)</a>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          {lecture.hasAudio ? (
            <Button variant="ghost" size="sm" onClick={discardAudio} disabled={pending}>
              <VolumeX className="size-4" />
              Remove recording
            </Button>
          ) : null}
          <Button variant="destructive" size="sm" onClick={remove} disabled={pending}>
            <Trash2 className="size-4" />
            Delete
          </Button>
        </div>
      </div>

      {lecture.hasAudio ? (
        <audio
          ref={audio}
          controls
          preload="metadata"
          src={`/api/lectures/${lecture.id}/audio`}
          onTimeUpdate={onTimeUpdate}
          className="bg-background sticky top-16 z-10 w-full"
        />
      ) : null}

      <AddToDeck lectureId={lecture.id} decks={decks} links={links} disabled={words === 0} />

      <Card>
        <CardHeader>
          <CardTitle>Transcript</CardTitle>
          <CardDescription>
            {lecture.untranscribed
              ? "Made on this computer from the recording."
              : lecture.hasAudio
              ? "Click a line to hear the lecture from there."
              : "The recording was removed; the text is all here."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {lecture.untranscribed ? (
            <PendingTranscript lectureId={lecture.id} />
          ) : lecture.segments.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              {lecture.fullText || "No speech was found in this recording."}
            </p>
          ) : (
            <>
              <div className="relative">
                <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
                <Input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Find in this transcript"
                  aria-label="Find in this transcript"
                  className="pl-8"
                />
              </div>
              {shown.length === 0 ? (
                <p className="text-muted-foreground text-sm">Nothing here says that.</p>
              ) : (
                <ol className="space-y-0.5">
                  {shown.map((segment) => (
                    <li key={segment.id}>
                      <button
                        type="button"
                        disabled={!lecture.hasAudio}
                        onClick={() => playFrom(segment)}
                        className={cn(
                          "flex w-full gap-3 rounded-md px-2 py-1 text-left text-sm",
                          lecture.hasAudio && "hover:bg-muted",
                          segment.id === activeId && "bg-muted",
                        )}
                      >
                        <span className="text-muted-foreground w-14 shrink-0 text-xs leading-5 tabular-nums">
                          {formatTimestamp(segment.start)}
                        </span>
                        <span>{segment.text}</span>
                      </button>
                    </li>
                  ))}
                </ol>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Title({ lecture }: { lecture: Lecture }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(lecture.title);
  const [pending, startTransition] = useTransition();

  if (!editing) {
    return (
      <div className="flex items-center gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">{lecture.title}</h1>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Rename"
          onClick={() => {
            setTitle(lecture.title);
            setEditing(true);
          }}
        >
          <Pencil className="size-4" />
        </Button>
      </div>
    );
  }

  return (
    <form
      className="flex items-center gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        startTransition(async () => {
          const result = await renameLectureAction(lecture.id, title);
          if (!result.ok) {
            toast.error(result.error);
            return;
          }
          setEditing(false);
          router.refresh();
        });
      }}
    >
      <Input
        autoFocus
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") setEditing(false);
        }}
        aria-label="Lecture title"
        maxLength={200}
      />
      <Button type="submit" size="sm" disabled={pending || !title.trim()}>
        Save
      </Button>
      <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(false)}>
        Cancel
      </Button>
    </form>
  );
}

function AddToDeck({
  lectureId,
  decks,
  links,
  disabled,
}: {
  lectureId: string;
  decks: Deck[];
  links: DeckLink[];
  disabled: boolean;
}) {
  const router = useRouter();
  const [deckId, setDeckId] = useState("");
  const [pending, startTransition] = useTransition();

  const live = links.filter((link) => link.inDeck);
  const already = live.some((link) => link.deckId === deckId);

  const add = () => {
    if (!deckId) return;
    startTransition(async () => {
      const result = await addLectureToDeckAction(lectureId, deckId);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(
        result.updated
          ? `Updated the notes in ${result.deckTitle}.`
          : `Added to ${result.deckTitle} as notes.`,
      );
      router.refresh();
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Layers className="size-4" />
          Use in a deck
        </CardTitle>
        <CardDescription>
          Adds this transcript to a deck&apos;s sources as notes, in five-minute sections,
          so flashcards can be made from it and say which part of the lecture they came from.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {decks.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            You have no decks yet. <Link href="/" className="underline">Create one</Link>, then
            come back to add this lecture to it.
          </p>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <Select value={deckId} onValueChange={setDeckId}>
              <SelectTrigger className="w-64 max-w-full" aria-label="Deck">
                <SelectValue placeholder="Choose a deck" />
              </SelectTrigger>
              <SelectContent>
                {decks.map((deck) => (
                  <SelectItem key={deck.id} value={deck.id}>
                    {deck.title}
                    <span className="text-muted-foreground"> · {deck.courseTitle}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button onClick={add} disabled={disabled || pending || !deckId}>
              {pending ? <Loader2 className="size-4 animate-spin" /> : null}
              {already ? "Update notes" : "Add to deck"}
            </Button>
          </div>
        )}

        {live.length > 0 ? (
          <div className="flex flex-wrap items-center gap-2">
            {live.map((link) => (
              <Badge key={link.deckId} variant="secondary" asChild>
                <Link href={`/exams/${link.deckId}/sources`}>
                  <Check className="size-3" />
                  {link.title}
                </Link>
              </Badge>
            ))}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
