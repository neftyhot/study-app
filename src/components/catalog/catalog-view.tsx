"use client";

/** The shared deck catalog: browse, preview, add, share and manage listings. */
import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  BookOpen,
  Building2,
  Download,
  EyeOff,
  Flag,
  GraduationCap,
  Layers,
  Pencil,
  Plus,
  School,
  Search,
  Trash2,
  Upload,
  User,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
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
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  addToMyDecksAction,
  getCatalogDeckAction,
  publishDeckAction,
  removeListingAction,
  reportListingAction,
  setCollegeAction,
  updateListingAction,
} from "@/lib/catalog/actions";
import {
  CATALOG_KINDS,
  kindLabel,
  type CatalogDeck,
  type CatalogDeckDetail,
  type CatalogKind,
  type OwnDeck,
} from "@/lib/catalog/types";
import { cn } from "@/lib/utils";

type GroupBy = "college" | "professor" | "course" | "none";

const KIND_TINT: Record<CatalogKind, string> = {
  exam: "bg-rose-500/10 text-rose-600 dark:text-rose-400",
  quiz: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  test: "bg-orange-500/10 text-orange-600 dark:text-orange-400",
  module: "bg-sky-500/10 text-sky-600 dark:text-sky-400",
  assignment: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  custom: "bg-violet-500/10 text-violet-600 dark:text-violet-400",
};

export function CatalogView({
  decks,
  ownDecks,
  college: myCollege,
}: {
  decks: CatalogDeck[];
  ownDecks: OwnDeck[];
  college: string | null;
}) {
  const [changingCollege, setChangingCollege] = useState(false);
  const colleges = useMemo(
    () => [...new Set(decks.map((d) => d.college))].sort(),
    [decks],
  );

  // The first visit asks for the student's college before showing anything.
  if (!myCollege) {
    return (
      <div className="mx-auto max-w-md rounded-xl border bg-card p-6 shadow-xs animate-in fade-in zoom-in-95">
        <div className="mb-4 flex items-center gap-3">
          <span className="flex size-10 items-center justify-center rounded-full bg-primary/10 text-primary">
            <School className="size-5" />
          </span>
          <div>
            <h2 className="font-semibold">Which college are you at?</h2>
            <p className="text-sm text-muted-foreground">
              The catalog starts with decks from there. You can change it any
              time.
            </p>
          </div>
        </div>
        <CollegeForm initial="" suggestions={colleges} submitLabel="Continue" />
      </div>
    );
  }

  return (
    <>
      <Browser
        decks={decks}
        ownDecks={ownDecks}
        myCollege={myCollege}
        onChangeCollege={() => setChangingCollege(true)}
      />
      <Dialog open={changingCollege} onOpenChange={setChangingCollege}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Your college</DialogTitle>
            <DialogDescription>
              The catalog starts with decks from here, and new shares default to
              it.
            </DialogDescription>
          </DialogHeader>
          <CollegeForm
            initial={myCollege}
            suggestions={colleges}
            submitLabel="Save"
            onDone={() => setChangingCollege(false)}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}

function CollegeForm({
  initial,
  suggestions,
  submitLabel,
  onDone,
}: {
  initial: string;
  suggestions: string[];
  submitLabel: string;
  onDone?: () => void;
}) {
  const [value, setValue] = useState(initial);
  const [pending, start] = useTransition();
  const submit = () =>
    start(async () => {
      const r = await setCollegeAction(value);
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      onDone?.();
    });
  return (
    <form
      className="flex gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <Input
        autoFocus
        list="catalog-college-choices"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="e.g. Georgia State University"
        aria-label="College"
      />
      <datalist id="catalog-college-choices">
        {suggestions.map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>
      <Button type="submit" disabled={pending || !value.trim()}>
        {pending ? "Saving…" : submitLabel}
      </Button>
    </form>
  );
}

function Browser({
  decks,
  ownDecks,
  myCollege,
  onChangeCollege,
}: {
  decks: CatalogDeck[];
  ownDecks: OwnDeck[];
  myCollege: string;
  onChangeCollege: () => void;
}) {
  const [query, setQuery] = useState("");
  // Start on the student's own college when anything is listed there.
  const [college, setCollege] = useState<string | null>(() =>
    decks.some((d) => d.college === myCollege) ? myCollege : null,
  );
  const [onlyMine, setOnlyMine] = useState(false);
  const [professor, setProfessor] = useState<string | null>(null);
  const [course, setCourse] = useState<string | null>(null);
  const [kind, setKind] = useState<CatalogKind | null>(null);
  const [groupBy, setGroupBy] = useState<GroupBy>("course");
  const [publishing, setPublishing] = useState(false);
  const [editing, setEditing] = useState<CatalogDeck | null>(null);
  const [previewId, setPreviewId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    return decks.filter((d) => {
      if (college && d.college !== college) return false;
      if (professor && d.professor !== professor) return false;
      if (course && d.course !== course) return false;
      if (kind && d.kind !== kind) return false;
      if (onlyMine && !d.mine) return false;
      const hay = [
        d.title,
        d.college,
        d.professor,
        d.course,
        d.term,
        d.description,
        kindLabel(d),
      ]
        .join(" ")
        .toLowerCase();
      return words.every((w) => hay.includes(w));
    });
  }, [decks, query, college, professor, course, kind, onlyMine]);

  // Each facet counts within the other filters, so the chips show what is reachable.
  const facet = (key: "college" | "professor" | "course") => {
    const counts = new Map<string, number>();
    for (const d of decks) {
      if (key !== "college" && college && d.college !== college) continue;
      if (key !== "professor" && professor && d.professor !== professor)
        continue;
      if (key !== "course" && course && d.course !== course) continue;
      counts.set(d[key], (counts.get(d[key]) ?? 0) + 1);
    }
    return [...counts.entries()].sort(
      (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
    );
  };

  const groups = useMemo(() => {
    if (groupBy === "none") return [["All decks", filtered] as const];
    const map = new Map<string, CatalogDeck[]>();
    for (const d of filtered) {
      const key = d[groupBy];
      map.set(key, [...(map.get(key) ?? []), d]);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [filtered, groupBy]);

  const active = [college, professor, course, kind, onlyMine || null].filter(
    Boolean,
  ).length;
  const mineCount = decks.filter((d) => d.mine).length;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <GraduationCap className="size-4 text-muted-foreground" />
        <span className="text-muted-foreground">Your college:</span>
        <span className="font-medium">{myCollege}</span>
        <button
          onClick={onChangeCollege}
          className="text-xs text-primary underline-offset-4 hover:underline"
        >
          Change
        </button>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by course, professor, college, exam…"
            className="pl-9"
          />
        </div>
        <Select value={groupBy} onValueChange={(v) => setGroupBy(v as GroupBy)}>
          <SelectTrigger className="sm:w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="course">Group by course</SelectItem>
            <SelectItem value="professor">Group by professor</SelectItem>
            <SelectItem value="college">Group by college</SelectItem>
            <SelectItem value="none">No grouping</SelectItem>
          </SelectContent>
        </Select>
        <Button onClick={() => setPublishing(true)} className="gap-2">
          <Upload className="size-4" /> Share a deck
        </Button>
      </div>

      <div className="space-y-2">
        <FacetRow
          icon={Building2}
          label="College"
          items={facet("college")}
          value={college}
          onChange={setCollege}
        />
        <FacetRow
          icon={User}
          label="Professor"
          items={facet("professor")}
          value={professor}
          onChange={setProfessor}
        />
        <FacetRow
          icon={BookOpen}
          label="Course"
          items={facet("course")}
          value={course}
          onChange={setCourse}
        />
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 flex w-24 items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <Layers className="size-3.5" /> Type
          </span>
          {CATALOG_KINDS.map((k) => (
            <Chip
              key={k}
              selected={kind === k}
              onClick={() => setKind(kind === k ? null : k)}
            >
              {kindLabel({ kind: k, customKind: null })}
            </Chip>
          ))}
          {mineCount > 0 ? (
            <Chip selected={onlyMine} onClick={() => setOnlyMine(!onlyMine)}>
              Shared by me <span className="ml-1 opacity-60">{mineCount}</span>
            </Chip>
          ) : null}
          {active > 0 ? (
            <button
              onClick={() => {
                setCollege(null);
                setProfessor(null);
                setCourse(null);
                setKind(null);
                setOnlyMine(false);
              }}
              className="ml-1 flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              <X className="size-3" /> Clear {active}
            </button>
          ) : null}
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        {filtered.length} of {decks.length} decks
      </p>

      {filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground animate-in fade-in">
          {decks.length === 0
            ? "Nothing shared yet. Sharing is optional — use Share a deck if you want to list one of yours."
            : "No decks match. Try fewer filters, or share one of yours."}
        </div>
      ) : (
        <div className="space-y-8">
          {groups.map(([name, items]) => (
            <section
              key={name}
              className="space-y-3 animate-in fade-in slide-in-from-bottom-2 duration-300"
            >
              {groupBy !== "none" ? (
                <h2 className="flex items-baseline gap-2 text-sm font-semibold">
                  {name}
                  <span className="text-xs font-normal text-muted-foreground">
                    {items.length}
                  </span>
                </h2>
              ) : null}
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {items.map((deck, i) => (
                  <DeckCard
                    key={deck.id}
                    deck={deck}
                    delay={i * 40}
                    onOpen={() => setPreviewId(deck.id)}
                    onEdit={deck.mine ? () => setEditing(deck) : undefined}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      <PublishDialog
        open={publishing}
        onOpenChange={setPublishing}
        ownDecks={ownDecks}
        defaultCollege={myCollege}
        suggestions={{
          colleges: [...new Set(decks.map((d) => d.college))],
          professors: [...new Set(decks.map((d) => d.professor))],
        }}
      />
      <EditDialog deck={editing} onClose={() => setEditing(null)} />
      <PreviewDialog id={previewId} onClose={() => setPreviewId(null)} />
    </div>
  );
}

function FacetRow({
  icon: Icon,
  label,
  items,
  value,
  onChange,
}: {
  icon: typeof User;
  label: string;
  items: [string, number][];
  value: string | null;
  onChange: (v: string | null) => void;
}) {
  if (items.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="mr-1 flex w-24 items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <Icon className="size-3.5" /> {label}
      </span>
      {items.map(([name, count]) => (
        <Chip
          key={name}
          selected={value === name}
          onClick={() => onChange(value === name ? null : name)}
        >
          {name}
          <span className="ml-1 opacity-60">{count}</span>
        </Chip>
      ))}
    </div>
  );
}

function Chip({
  selected,
  onClick,
  children,
}: {
  selected: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "rounded-full border px-2.5 py-1 text-xs transition-all duration-200 active:scale-95",
        selected
          ? "border-primary bg-primary text-primary-foreground shadow-sm"
          : "bg-background hover:border-foreground/30 hover:bg-muted",
      )}
    >
      {children}
    </button>
  );
}

function DeckCard({
  deck,
  delay,
  onOpen,
  onEdit,
}: {
  deck: CatalogDeck;
  delay: number;
  onOpen: () => void;
  onEdit?: () => void;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && onOpen()}
      style={{ animationDelay: `${delay}ms` }}
      className="group relative flex cursor-pointer flex-col gap-3 rounded-xl border bg-card p-4 text-left shadow-xs transition-all duration-200 animate-in fade-in zoom-in-95 fill-mode-both hover:-translate-y-0.5 hover:border-foreground/20 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div className="flex items-start justify-between gap-2">
        <span
          className={cn(
            "rounded-md px-2 py-0.5 text-[11px] font-medium",
            KIND_TINT[deck.kind],
          )}
        >
          {kindLabel(deck)}
        </span>
        {deck.status === "hidden" ? (
          <span
            title="Hidden from the catalog after reports. Only you can see it."
            className="mr-auto flex items-center gap-1 rounded-md bg-muted px-2 py-0.5 text-[11px] text-muted-foreground"
          >
            <EyeOff className="size-3" /> Hidden
          </span>
        ) : null}
        {onEdit ? (
          <button
            aria-label="Edit or remove your listing"
            onClick={(e) => {
              e.stopPropagation();
              onEdit();
            }}
            className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            Yours <Pencil className="size-3" />
          </button>
        ) : null}
      </div>
      <div className="space-y-1">
        <h3 className="line-clamp-2 font-semibold leading-snug">
          {deck.title}
        </h3>
        <p className="text-sm text-muted-foreground">
          {deck.course}
          {deck.term ? ` · ${deck.term}` : ""}
        </p>
      </div>
      {deck.description ? (
        <p className="line-clamp-2 text-xs text-muted-foreground">
          {deck.description}
        </p>
      ) : null}
      <div className="mt-auto space-y-2 pt-1">
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <User className="size-3" /> {deck.professor}
          </span>
          <span className="flex items-center gap-1">
            <GraduationCap className="size-3" /> {deck.college}
          </span>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <Badge variant="secondary">{deck.cardCount} cards</Badge>
          {deck.sectionCount > 0 ? (
            <Badge variant="secondary">Study guide · {deck.sectionCount}</Badge>
          ) : null}
          <span className="ml-auto flex items-center gap-1 text-muted-foreground">
            <Download className="size-3" /> {deck.adds}
          </span>
        </div>
      </div>
    </div>
  );
}

function PreviewDialog({
  id,
  onClose,
}: {
  id: string | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const [loaded, setLoaded] = useState<CatalogDeckDetail | null>(null);
  const [adding, startAdding] = useTransition();
  const [reporting, startReporting] = useTransition();
  const [flipped, setFlipped] = useState<number | null>(null);
  // Only the deck asked for: a slower answer for one closed earlier is ignored.
  const detail = loaded && loaded.id === id ? loaded : null;

  // A server action updates the router, so it must not start during render.
  useEffect(() => {
    if (!id) return;
    let live = true;
    void getCatalogDeckAction(id).then((r) => {
      if (!live) return;
      if (r.ok) setLoaded(r.value);
      else {
        toast.error(r.error);
        onClose();
      }
    });
    return () => {
      live = false;
    };
  }, [id, onClose]);

  return (
    <Dialog
      open={id !== null}
      onOpenChange={(open) => {
        if (!open) {
          setFlipped(null);
          onClose();
        }
      }}
    >
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        {!detail ? (
          <div className="space-y-3 py-6">
            <DialogTitle className="sr-only">Loading deck</DialogTitle>
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-12 animate-pulse rounded-lg bg-muted" />
            ))}
          </div>
        ) : (
          <>
            <DialogHeader>
              <div className="flex items-center gap-2">
                <span
                  className={cn(
                    "rounded-md px-2 py-0.5 text-[11px] font-medium",
                    KIND_TINT[detail.kind],
                  )}
                >
                  {kindLabel(detail)}
                </span>
                <span className="text-xs text-muted-foreground">
                  shared by {detail.uploader}
                </span>
              </div>
              <DialogTitle>{detail.title}</DialogTitle>
              <DialogDescription>
                {detail.course} · {detail.professor} · {detail.college}
                {detail.term ? ` · ${detail.term}` : ""}
              </DialogDescription>
            </DialogHeader>

            {detail.description ? (
              <p className="text-sm">{detail.description}</p>
            ) : null}

            <div className="space-y-2">
              <h4 className="text-sm font-semibold">
                Sample cards{" "}
                <span className="font-normal text-muted-foreground">
                  of {detail.cardCount} · tap to flip
                </span>
              </h4>
              <div className="grid gap-2 sm:grid-cols-2">
                {detail.sampleCards.map((card, i) => (
                  <button
                    key={i}
                    onClick={() => setFlipped(flipped === i ? null : i)}
                    className="min-h-20 rounded-lg border bg-muted/30 p-3 text-left text-sm transition-colors hover:bg-muted/60"
                  >
                    {flipped === i ? (
                      <span
                        key="a"
                        className="block animate-in fade-in duration-200"
                      >
                        {card.answer}
                      </span>
                    ) : (
                      <span
                        key="q"
                        className="block animate-in fade-in duration-200"
                      >
                        {card.topic ? (
                          <span className="mb-1 block text-[11px] text-muted-foreground">
                            {card.topic}
                          </span>
                        ) : null}
                        {card.question}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            </div>

            {detail.topics.length > 0 ? (
              <div className="space-y-2">
                <h4 className="text-sm font-semibold">
                  Study guide{" "}
                  <span className="font-normal text-muted-foreground">
                    {detail.sectionCount} concepts
                  </span>
                </h4>
                {detail.overview ? (
                  <p className="text-xs text-muted-foreground">
                    {detail.overview}
                  </p>
                ) : null}
                <ol className="space-y-1.5">
                  {detail.topics.map((topic, i) => (
                    <li key={i} className="rounded-lg border p-2.5">
                      <p className="text-sm font-medium">{topic.title}</p>
                      <p className="line-clamp-2 text-xs text-muted-foreground">
                        {topic.concepts.join(" · ")}
                      </p>
                    </li>
                  ))}
                </ol>
              </div>
            ) : null}

            <DialogFooter>
              {!detail.mine ? (
                <Button
                  variant="ghost"
                  disabled={reporting}
                  className="mr-auto gap-2 text-muted-foreground"
                  onClick={() =>
                    startReporting(async () => {
                      const r = await reportListingAction(detail.id, null);
                      if (!r.ok) {
                        toast.error(r.error);
                        return;
                      }
                      toast.success("Thanks. The deck will be reviewed.");
                    })
                  }
                >
                  <Flag className="size-4" /> Report
                </Button>
              ) : null}
              <Button
                disabled={adding}
                className="gap-2"
                onClick={() =>
                  startAdding(async () => {
                    const r = await addToMyDecksAction(detail.id);
                    if (!r.ok) {
                      toast.error(r.error);
                      return;
                    }
                    toast.success(`Added "${detail.title}" to your decks.`);
                    onClose();
                    router.push(`/exams/${r.value}`);
                  })
                }
              >
                <Plus className="size-4" />{" "}
                {adding ? "Adding…" : "Add to my decks"}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

type ListingFields = {
  title: string;
  college: string;
  professor: string;
  course: string;
  kind: CatalogKind;
  customKind: string;
  term: string;
  description: string;
};

function ListingForm({
  value,
  onChange,
  suggestions,
}: {
  value: ListingFields;
  onChange: (v: ListingFields) => void;
  suggestions?: { colleges: string[]; professors: string[] };
}) {
  const set = (patch: Partial<ListingFields>) =>
    onChange({ ...value, ...patch });
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label="College" required className="sm:col-span-2">
        <Input
          list="catalog-colleges"
          value={value.college}
          onChange={(e) => set({ college: e.target.value })}
          placeholder="e.g. Georgia State University"
        />
        <datalist id="catalog-colleges">
          {suggestions?.colleges.map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
      </Field>
      <Field label="Professor" required>
        <Input
          list="catalog-professors"
          value={value.professor}
          onChange={(e) => set({ professor: e.target.value })}
          placeholder="e.g. Dr. Smith"
        />
        <datalist id="catalog-professors">
          {suggestions?.professors.map((p) => (
            <option key={p} value={p} />
          ))}
        </datalist>
      </Field>
      <Field label="Course" required>
        <Input
          value={value.course}
          onChange={(e) => set({ course: e.target.value })}
          placeholder="e.g. ACCT 2102"
        />
      </Field>
      <Field label="For" required>
        <div className="flex flex-wrap gap-1.5">
          {CATALOG_KINDS.map((k) => (
            <Chip
              key={k}
              selected={value.kind === k}
              onClick={() => set({ kind: k })}
            >
              {kindLabel({ kind: k, customKind: null })}
            </Chip>
          ))}
        </div>
      </Field>
      <Field label="Title" required>
        <Input
          value={value.title}
          onChange={(e) => set({ title: e.target.value })}
          placeholder="e.g. Midterm 1"
        />
      </Field>
      {value.kind === "custom" ? (
        <Field
          label="Custom type"
          required
          className="animate-in fade-in slide-in-from-top-1"
        >
          <Input
            value={value.customKind}
            onChange={(e) => set({ customKind: e.target.value })}
            placeholder="e.g. Lab practical, Final project"
          />
        </Field>
      ) : null}
      <Field label="Term">
        <Input
          value={value.term}
          onChange={(e) => set({ term: e.target.value })}
          placeholder="e.g. Fall 2026"
        />
      </Field>
      <Field label="Description" className="sm:col-span-2">
        <Textarea
          value={value.description}
          onChange={(e) => set({ description: e.target.value })}
          placeholder="What it covers, which chapters, anything useful to know."
          rows={2}
        />
      </Field>
    </div>
  );
}

function Field({
  label,
  required,
  className,
  children,
}: {
  label: string;
  required?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <Label className="text-xs">
        {label}
        {required ? <span className="text-destructive">*</span> : null}
      </Label>
      {children}
    </div>
  );
}

const EMPTY: ListingFields = {
  title: "",
  college: "",
  professor: "",
  course: "",
  kind: "exam",
  customKind: "",
  term: "",
  description: "",
};

function PublishDialog({
  open,
  onOpenChange,
  ownDecks,
  defaultCollege,
  suggestions,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  ownDecks: OwnDeck[];
  defaultCollege: string;
  suggestions: { colleges: string[]; professors: string[] };
}) {
  const blank = { ...EMPTY, college: defaultCollege };
  const [examId, setExamId] = useState("");
  const [fields, setFields] = useState<ListingFields>(blank);
  const [includeGuide, setIncludeGuide] = useState(true);
  const [pending, start] = useTransition();

  const pick = (id: string) => {
    setExamId(id);
    const deck = ownDecks.find((d) => d.examId === id);
    if (!deck) return;
    setFields((f) => ({
      ...f,
      title: f.title || deck.examTitle,
      course: f.course || deck.courseTitle,
      term: f.term || deck.term || "",
    }));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Share a deck</DialogTitle>
          <DialogDescription>
            Optional. Its cards and study guide text go into the catalog for
            anyone to add; slides and uploaded files are never shared. Your
            progress stays yours. Every share gets an automatic content check
            first, and sharing is limited to a few decks an hour.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <Field label="Deck" required>
            <Select value={examId} onValueChange={pick}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Pick one of your decks" />
              </SelectTrigger>
              <SelectContent>
                {ownDecks.map((d) => (
                  <SelectItem key={d.examId} value={d.examId}>
                    {d.courseTitle} — {d.examTitle}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <ListingForm
            value={fields}
            onChange={setFields}
            suggestions={suggestions}
          />
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={includeGuide}
              onCheckedChange={(v) => setIncludeGuide(v === true)}
            />
            Include the study guide
          </label>
        </div>
        <DialogFooter>
          <Button
            disabled={pending || !examId}
            onClick={() =>
              start(async () => {
                const r = await publishDeckAction({
                  examId,
                  ...fields,
                  customKind: fields.customKind || null,
                  term: fields.term || null,
                  description: fields.description || null,
                  uploader: null,
                  includeGuide,
                });
                if (!r.ok) {
                  toast.error(r.error);
                  return;
                }
                toast.success("Shared to the catalog.");
                setExamId("");
                setFields(blank);
                onOpenChange(false);
              })
            }
          >
            {pending ? "Checking and sharing…" : "Share"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EditDialog({
  deck,
  onClose,
}: {
  deck: CatalogDeck | null;
  onClose: () => void;
}) {
  return (
    <Dialog open={deck !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
        {deck ? <EditForm key={deck.id} deck={deck} close={onClose} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function EditForm({ deck, close }: { deck: CatalogDeck; close: () => void }) {
  const [fields, setFields] = useState<ListingFields>({
    title: deck.title,
    college: deck.college,
    professor: deck.professor,
    course: deck.course,
    kind: deck.kind,
    customKind: deck.customKind ?? "",
    term: deck.term ?? "",
    description: deck.description ?? "",
  });
  const [pending, start] = useTransition();
  const [confirming, setConfirming] = useState(false);

  return (
    <>
      <DialogHeader>
        <DialogTitle>Your listing</DialogTitle>
        <DialogDescription>
          Changes what the catalog shows; the cards stay as shared. Removing it
          takes it out of the catalog; copies others already added stay theirs.
        </DialogDescription>
      </DialogHeader>
      <ListingForm value={fields} onChange={setFields} />
      <DialogFooter className="sm:justify-between">
        <Button
          variant="ghost"
          className="gap-2 text-destructive hover:text-destructive"
          disabled={pending}
          onClick={() => {
            if (!confirming) {
              setConfirming(true);
              return;
            }
            start(async () => {
              const r = await removeListingAction(deck.id);
              if (!r.ok) {
                toast.error(r.error);
                return;
              }
              toast.success("Removed from the catalog.");
              close();
            });
          }}
        >
          <Trash2 className="size-4" />{" "}
          {confirming ? "Click again to delete" : "Delete from catalog"}
        </Button>
        <Button
          disabled={pending}
          onClick={() =>
            start(async () => {
              const r = await updateListingAction(deck.id, {
                ...fields,
                customKind: fields.customKind || null,
                term: fields.term || null,
                description: fields.description || null,
              });
              if (!r.ok) {
                toast.error(r.error);
                return;
              }
              close();
            })
          }
        >
          Save
        </Button>
      </DialogFooter>
    </>
  );
}
