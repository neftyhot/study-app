import {
  BookOpen,
  Brain,
  CalendarCheck,
  Clock,
  EyeOff,
  FileText,
  Flame,
  Layers,
  Library,
  PenLine,
  Sun,
  Target,
  Trophy,
} from "lucide-react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { AppStats } from "@/lib/stats";

function duration(seconds: number): string {
  if (seconds < 60) return seconds > 0 ? "< 1 min" : "0 min";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

function hourLabel(hour: number): string {
  const suffix = hour < 12 ? "am" : "pm";
  const twelve = hour % 12 === 0 ? 12 : hour % 12;
  const mood =
    hour < 5 ? "night owl" : hour < 12 ? "early bird" : hour < 17 ? "afternoon" : hour < 21 ? "evening" : "night owl";
  return `${twelve}${suffix} · ${mood}`;
}

export function StatsCard({ stats }: { stats: AppStats }) {
  const tiles: { icon: React.ReactNode; label: string; value: string; hint?: string }[] = [
    { icon: <Library />, label: "Subjects", value: String(stats.subjects) },
    { icon: <Layers />, label: "Decks", value: String(stats.decks) },
    { icon: <BookOpen />, label: "Flashcards", value: stats.cards.toLocaleString() },
    {
      icon: <Clock />,
      label: "Time studying",
      value: duration(stats.focusedSeconds),
      hint: "With the app in front",
    },
    {
      icon: <EyeOff />,
      label: "Open in the background",
      value: duration(stats.backgroundSeconds),
      hint: "Open, but another window was in front",
    },
    {
      icon: <Brain />,
      label: "Cards reviewed",
      value: stats.reviewed.toLocaleString(),
      hint: stats.accuracy === null ? undefined : `${stats.accuracy}% known`,
    },
    {
      icon: <Flame />,
      label: "Study streak",
      value: `${stats.streak.current} day${stats.streak.current === 1 ? "" : "s"}`,
      hint: `Best: ${stats.streak.longest} day${stats.streak.longest === 1 ? "" : "s"}`,
    },
    {
      icon: <Target />,
      label: "Cards mastered",
      value: stats.retained.toLocaleString(),
      hint:
        stats.cards > 0 ? `${Math.round((stats.retained / stats.cards) * 100)}% of all cards` : undefined,
    },
    {
      icon: <FileText />,
      label: "Pages turned into cards",
      value: stats.pages.toLocaleString(),
      hint: "Slides and pages read from your files",
    },
    {
      icon: <Sun />,
      label: "Favourite study time",
      value: stats.peakHour === null ? "—" : hourLabel(stats.peakHour),
    },
    {
      icon: <Trophy />,
      label: "Practice exams",
      value: String(stats.papers),
      hint: stats.bestPaper === null ? undefined : `Best score ${stats.bestPaper}%`,
    },
    {
      icon: <CalendarCheck />,
      label: "Most studied deck",
      value: stats.topDeck?.title ?? "—",
      hint: stats.topDeck ? `${stats.topDeck.reviews} cards flipped` : undefined,
    },
    {
      icon: <PenLine />,
      label: "Cards you wrote",
      value: stats.handwritten.toLocaleString(),
    },
  ];

  return (
    <Card id="stats" className="scroll-mt-20">
      <CardHeader>
        <CardTitle className="text-base">Your stats</CardTitle>
        <CardDescription>
          {stats.trackedSince
            ? `Time counted since ${new Date(stats.trackedSince).toLocaleDateString()}.`
            : "Time in the app starts counting now."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {tiles.map((tile) => (
            <div key={tile.label} className="bg-muted/50 space-y-1 rounded-lg p-3">
              <dt className="text-muted-foreground flex items-center gap-1.5 text-xs [&_svg]:size-3.5">
                {tile.icon}
                {tile.label}
              </dt>
              <dd className="truncate text-lg font-semibold tabular-nums" title={tile.value}>
                {tile.value}
              </dd>
              {tile.hint ? <dd className="text-muted-foreground text-xs">{tile.hint}</dd> : null}
            </div>
          ))}
        </dl>
      </CardContent>
    </Card>
  );
}
