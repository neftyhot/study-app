"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Loader2, Search, Sparkles, X } from "lucide-react";

import { Highlighted } from "@/components/search/highlighted";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { searchEverything, searchWithModel } from "@/lib/search/actions";
import { shouldOfferSemantic } from "@/lib/search/match";
import type { ResultKind, SearchFilters, SearchResult } from "@/lib/search/docs";

export type Scope = {
  id: string;
  title: string;
  exams: { id: string; title: string }[];
};

const KIND_LABELS: Record<ResultKind, string> = {
  card: "Card",
  objective: "Objective",
  source: "Source",
};

/**
 * Search across everything.
 *
 * Typing searches instantly and locally. The model is a separate, deliberate
 * button — it costs seconds and, with a local model, real work — and it is
 * only suggested when the instant search came up short.
 */
export function SearchView({
  scopes,
  initialQuery,
}: {
  scopes: Scope[];
  initialQuery: string;
}) {
  const [query, setQuery] = useState(initialQuery);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [semantic, setSemantic] = useState<SearchResult[] | null>(null);
  const [thinking, setThinking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [courseId, setCourseId] = useState("all");
  const [examId, setExamId] = useState("all");
  const [kind, setKind] = useState<"all" | ResultKind>("all");
  const [progress, setProgress] = useState("all");

  const filters: SearchFilters = useMemo(
    () => ({
      courseId: courseId === "all" ? null : courseId,
      examId: examId === "all" ? null : examId,
      kinds: kind === "all" ? undefined : [kind],
      progress: progress === "all" ? null : progress,
    }),
    [courseId, examId, kind, progress],
  );

  // Debounced so a fast typist does not queue a request per keystroke; short,
  // because the point of this layer is that it feels instant.
  useEffect(() => {
    const trimmed = query.trim();
    let cancelled = false;

    // Every state change happens in the timer, never synchronously in the
    // effect, so a keystroke cannot cascade into another render pass.
    const timer = setTimeout(async () => {
      const found = trimmed ? await searchEverything(trimmed, filters) : [];
      if (cancelled) return;

      setResults(found);
      setSemantic(null);
      setError(null);
    }, 120);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, filters]);

  const decks = scopes.find((scope) => scope.id === courseId)?.exams ?? scopes.flatMap((s) => s.exams);
  const offerModel = shouldOfferSemantic(query, results.length);
  const shown = semantic ?? results;

  async function askModel() {
    setThinking(true);
    setError(null);

    const result = await searchWithModel(query.trim(), filters);
    setThinking(false);

    if (!result.ok) {
      setError(result.error);
      return;
    }

    setSemantic(result.results);
  }

  return (
    <div className="space-y-5">
      <div className="relative">
        <Search className="text-muted-foreground absolute top-1/2 left-3 size-4 -translate-y-1/2" />
        <Input
          autoFocus
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search everything — exact words, or describe it loosely"
          className="h-11 pr-10 pl-9"
        />
        {query ? (
          <button
            type="button"
            onClick={() => setQuery("")}
            className="text-muted-foreground hover:text-foreground absolute top-1/2 right-3 -translate-y-1/2"
            aria-label="Clear search"
          >
            <X className="size-4" />
          </button>
        ) : null}
      </div>

      <div className="flex flex-wrap gap-2">
        <Select
          value={courseId}
          onValueChange={(value) => {
            setCourseId(value);
            setExamId("all");
          }}
        >
          <SelectTrigger className="w-auto min-w-36"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All subjects</SelectItem>
            {scopes.map((scope) => (
              <SelectItem key={scope.id} value={scope.id}>{scope.title}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={examId} onValueChange={setExamId}>
          <SelectTrigger className="w-auto min-w-32"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All decks</SelectItem>
            {decks.map((exam) => (
              <SelectItem key={exam.id} value={exam.id}>{exam.title}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={kind} onValueChange={(value) => setKind(value as typeof kind)}>
          <SelectTrigger className="w-auto min-w-32"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Everything</SelectItem>
            <SelectItem value="card">Cards</SelectItem>
            <SelectItem value="objective">Objectives</SelectItem>
            <SelectItem value="source">Source material</SelectItem>
          </SelectContent>
        </Select>

        <Select value={progress} onValueChange={setProgress}>
          <SelectTrigger className="w-auto min-w-32"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Any progress</SelectItem>
            <SelectItem value="unstudied">Not yet studied</SelectItem>
            <SelectItem value="learning">Being learned</SelectItem>
            <SelectItem value="retained">Retained</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {query.trim() ? (
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-muted-foreground text-sm">
            {semantic
              ? `${shown.length} found by the model`
              : `${results.length} match${results.length === 1 ? "" : "es"}`}
          </p>

          {semantic ? (
            <Button variant="ghost" size="sm" onClick={() => setSemantic(null)}>
              Back to exact matches
            </Button>
          ) : (
            <Button
              variant={offerModel ? "default" : "outline"}
              size="sm"
              disabled={thinking}
              onClick={() => void askModel()}
            >
              {thinking ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Sparkles className="size-3.5" />
              )}
              {thinking ? "Thinking…" : "Search by meaning"}
            </Button>
          )}

          {offerModel && !semantic ? (
            <span className="text-muted-foreground text-xs">
              Little found — the model can look for what you described.
            </span>
          ) : null}
        </div>
      ) : null}

      {error ? <p className="text-destructive text-sm">{error}</p> : null}

      <div className="space-y-2">
        {shown.map((result) => (
          <Link
            key={`${result.doc.kind}-${result.doc.id}`}
            href={result.doc.href}
            className="hover:bg-muted/50 block rounded-md border p-3 transition-colors"
          >
            <p className="flex flex-wrap items-center gap-2 text-xs">
              <Badge variant="outline">{KIND_LABELS[result.doc.kind]}</Badge>
              <span className="text-muted-foreground">
                {result.doc.courseTitle} · {result.doc.examTitle}
              </span>
              {result.doc.topic ? (
                <Badge variant="secondary">{result.doc.topic}</Badge>
              ) : null}
              {result.kind === "exact" ? <Badge variant="outline">exact</Badge> : null}
              {result.kind === "semantic" ? (
                <Badge variant="outline" className="gap-1">
                  <Sparkles className="size-3" />
                  by meaning
                </Badge>
              ) : null}
            </p>

            <p className="mt-1.5 text-sm leading-snug font-medium break-words">
              <Highlighted text={result.doc.title} query={query} />
            </p>
            <p className="text-muted-foreground mt-1 text-xs break-words">
              <Highlighted text={result.snippet} query={query} />
            </p>
            {result.reason ? (
              <p className="text-muted-foreground mt-1 text-xs italic">
                {result.reason}
              </p>
            ) : null}
          </Link>
        ))}
      </div>

      {query.trim() && shown.length === 0 && !thinking ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Nothing matched</CardTitle>
            <CardDescription>
              {semantic
                ? "The model found nothing that answers this. That is worth knowing: your material may simply not cover it."
                : "Try fewer words, or ask the model to search by meaning."}
            </CardDescription>
          </CardHeader>
          {!semantic ? (
            <CardContent>
              <Button size="sm" disabled={thinking} onClick={() => void askModel()}>
                <Sparkles className="size-3.5" />
                Search by meaning
              </Button>
            </CardContent>
          ) : null}
        </Card>
      ) : null}
    </div>
  );
}
