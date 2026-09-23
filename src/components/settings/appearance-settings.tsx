"use client";

/**
 * Settings → Appearance.
 *
 * Everything previews as it changes, by rewriting the same stylesheet the
 * server renders into the page, and saves itself shortly after. Colours are
 * per style, so a student can have a pink Bubble and an untouched Dark; the
 * rest applies to every style.
 *
 * A colour that would leave text hard to read is not accepted as picked: it
 * comes back moved just far enough to read, with a note saying so.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useTheme } from "next-themes";
import { Check, RotateCcw, TriangleAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import {
  appearanceCss,
  CARD_STYLE_LABELS,
  CARD_STYLES,
  contrast,
  DEFAULT_APPEARANCE,
  FONT_IDS,
  FONT_LABELS,
  isHex,
  isThemeId,
  MIN_TEXT_CONTRAST,
  RADIUS_RANGE,
  resolvePalette,
  TEXT_SCALE_RANGE,
  THEME_IDS,
  THEMES,
  WIDTHS,
  type Appearance,
  type Palette,
  type ThemeId,
  type Width,
} from "@/lib/appearance";
import { saveAppearanceAction } from "@/lib/settings-actions";

const SAVE_DELAY_MS = 400;

const COLOR_FIELDS: { key: keyof Palette; label: string }[] = [
  { key: "background", label: "Background" },
  { key: "foreground", label: "Text" },
  { key: "card", label: "Cards" },
  { key: "primary", label: "Accent" },
];

const FIELD_NAMES: Record<keyof Palette, string> = {
  background: "background",
  foreground: "text colour",
  card: "card colour",
  primary: "accent colour",
};

export function AppearanceSettings({ initial }: { initial: Appearance }) {
  const { theme, resolvedTheme, setTheme } = useTheme();
  const [appearance, setAppearance] = useState(initial);
  const [notice, setNotice] = useState<string | null>(null);
  const [saved, setSaved] = useState(true);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // The style whose colours are being edited: the one showing.
  const active: ThemeId = isThemeId(resolvedTheme) ? resolvedTheme : "light";
  const palette = useMemo(
    () => resolvePalette(active, appearance.colors[active]),
    [active, appearance.colors],
  );

  function apply(next: Appearance) {
    setAppearance(next);
    setSaved(false);

    const style = document.getElementById("appearance-css");
    if (style) style.textContent = appearanceCss(next);

    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      await saveAppearanceAction(next);
      setSaved(true);
    }, SAVE_DELAY_MS);
  }

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  function setColor(key: keyof Palette, value: string | undefined) {
    const overrides = { ...appearance.colors[active] };
    if (value === undefined) delete overrides[key];
    else overrides[key] = value.toLowerCase();

    // Whatever the readability rule had to move is stored as moved, so the
    // picker shows the colour actually in use, not the one asked for.
    const resolved = resolvePalette(active, overrides);
    const moved = (Object.keys(resolved.adjusted) as (keyof Palette)[]).filter(
      (field) => overrides[field] !== undefined,
    );
    for (const field of moved) overrides[field] = resolved[field];

    setNotice(
      moved.length > 0
        ? `That ${FIELD_NAMES[moved[0]]} was too close to ${
            moved[0] === "card" ? "the text" : "what sits behind it"
          } to read comfortably, so it has been adjusted to ${resolved[moved[0]]}.`
        : resolved.foreground !== resolvePalette(active, {}).foreground &&
            overrides.foreground === undefined
          ? `Text switched to ${resolved.foreground} so it stays readable on this background.`
          : null,
    );

    const colors = { ...appearance.colors, [active]: overrides };
    if (Object.keys(overrides).length === 0) delete colors[active];
    apply({ ...appearance, colors });
  }

  const textRatio = Math.min(
    contrast(palette.foreground, palette.background),
    contrast(palette.foreground, palette.card),
  );

  return (
    <Card id="appearance" className="scroll-mt-20">
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-2 text-base">
          Appearance
          <span className="text-muted-foreground flex items-center gap-1 text-xs font-normal">
            {saved ? (
              <>
                <Check className="size-3" /> Saved
              </>
            ) : (
              "Saving…"
            )}
          </span>
        </CardTitle>
        <CardDescription>
          Pick a style, then make it yours. Colours are kept per style; the
          sliders below apply to all of them.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-8">
        <section className="space-y-3">
          <Label className="text-sm">Style</Label>
          <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {THEME_IDS.map((id) => (
              <StyleTile
                key={id}
                id={id}
                selected={theme === id}
                colors={resolvePalette(id, appearance.colors[id])}
                onSelect={() => setTheme(id)}
              />
            ))}
          </div>
          <Button
            variant={theme === "system" ? "secondary" : "ghost"}
            size="sm"
            onClick={() => setTheme("system")}
          >
            {theme === "system" ? <Check className="size-3.5" /> : null}
            Match system (Light or Dark)
          </Button>
        </section>

        <section className="space-y-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <Label className="text-sm">Colours for {THEMES[active].label}</Label>
            <span
              className="text-muted-foreground text-xs tabular-nums"
              title="WCAG contrast between text and the page or cards; 4.5 or more reads comfortably."
            >
              Text contrast {textRatio.toFixed(1)}:1
              {textRatio >= MIN_TEXT_CONTRAST ? " · readable" : ""}
            </span>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            {COLOR_FIELDS.map(({ key, label }) => (
              <ColorField
                key={key}
                id={`color-${key}`}
                label={label}
                value={palette[key]}
                changed={appearance.colors[active]?.[key] !== undefined}
                onChange={(value) => setColor(key, value)}
                onReset={() => setColor(key, undefined)}
              />
            ))}
          </div>

          {notice ? (
            <p
              role="status"
              className="bg-muted text-foreground flex items-start gap-2 rounded-md p-2.5 text-xs"
            >
              <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
              {notice}
            </p>
          ) : null}
        </section>

        <section className="grid gap-6 sm:grid-cols-2">
          <SliderField
            label="Rounded corners"
            value={appearance.radius ?? THEMES[active].radius}
            display={(value) =>
              appearance.radius === null ? "Style default" : `${Math.round(value * 16)}px`
            }
            range={RADIUS_RANGE}
            onChange={(radius) => apply({ ...appearance, radius })}
            onReset={
              appearance.radius === null
                ? undefined
                : () => apply({ ...appearance, radius: null })
            }
          />
          <SliderField
            label="Text size"
            value={appearance.textScale}
            display={(value) => `${Math.round(value * 100)}%`}
            range={TEXT_SCALE_RANGE}
            onChange={(textScale) => apply({ ...appearance, textScale })}
            onReset={
              appearance.textScale === 1
                ? undefined
                : () => apply({ ...appearance, textScale: 1 })
            }
          />

          <div className="space-y-1.5">
            <Label htmlFor="appearance-font" className="text-sm">
              Font
            </Label>
            <Select
              value={appearance.font}
              onValueChange={(font) =>
                apply({ ...appearance, font: font as Appearance["font"] })
              }
            >
              <SelectTrigger id="appearance-font" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {FONT_IDS.map((font) => (
                  <SelectItem key={font} value={font}>
                    {font === "style"
                      ? `Style default (${FONT_LABELS[THEMES[active].font]})`
                      : FONT_LABELS[font]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label className="text-sm">Cards</Label>
            <Segmented
              value={appearance.cardStyle}
              options={CARD_STYLES.map((style) => ({
                value: style,
                label: style === "style" ? "Default" : CARD_STYLE_LABELS[style],
              }))}
              onChange={(cardStyle) => apply({ ...appearance, cardStyle })}
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-sm">Page width</Label>
            <Segmented
              value={appearance.width}
              options={(Object.keys(WIDTHS) as Width[]).map((width) => ({
                value: width,
                label: width[0].toUpperCase() + width.slice(1),
              }))}
              onChange={(width) => apply({ ...appearance, width })}
            />
          </div>
        </section>

        <section className="space-y-2">
          <Label className="text-sm">Preview</Label>
          <Preview />
        </section>

        <Button
          variant="outline"
          onClick={() => {
            setNotice(null);
            apply(DEFAULT_APPEARANCE);
          }}
        >
          <RotateCcw className="size-4" />
          Reset appearance
        </Button>
      </CardContent>
    </Card>
  );
}

function StyleTile({
  id,
  selected,
  colors,
  onSelect,
}: {
  id: ThemeId;
  selected: boolean;
  colors: Palette;
  onSelect: () => void;
}) {
  const definition = THEMES[id];

  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
      className={`overflow-hidden rounded-lg border-2 text-left transition-colors ${
        selected ? "border-primary" : "hover:border-muted-foreground/40 border-transparent"
      }`}
    >
      <div
        className="space-y-1.5 p-3"
        style={{
          background: colors.background,
          color: colors.foreground,
          fontFamily:
            definition.font === "serif"
              ? "ui-serif, Georgia, serif"
              : definition.font === "rounded"
                ? "var(--font-nunito), ui-rounded, sans-serif"
                : "var(--font-geist-sans), sans-serif",
        }}
      >
        <div
          className="space-y-1 p-2"
          style={{
            background: colors.card,
            borderRadius: `${definition.radius * 0.75}rem`,
            boxShadow:
              definition.cardStyle === "shadow"
                ? "0 3px 10px rgb(0 0 0 / 0.12)"
                : `0 0 0 1px color-mix(in oklab, ${colors.foreground} 12%, transparent)`,
          }}
        >
          <div className="text-xs font-semibold">Aa</div>
          <div
            className="h-2 w-10"
            style={{ background: colors.primary, borderRadius: 999 }}
          />
        </div>
      </div>
      <div className="bg-card space-y-0.5 px-3 py-2">
        <p className="flex items-center gap-1 text-sm font-medium">
          {definition.label}
          {selected ? <Check className="size-3.5" /> : null}
        </p>
        <p className="text-muted-foreground text-xs">{definition.blurb}</p>
      </div>
    </button>
  );
}

function ColorField({
  id,
  label,
  value,
  changed,
  onChange,
  onReset,
}: {
  id: string;
  label: string;
  value: string;
  changed: boolean;
  onChange: (value: string) => void;
  onReset: () => void;
}) {
  const [draft, setDraft] = useState(value);
  // Follow the colour when it changes from outside — a reset, or the
  // readability rule moving it — without fighting the student's typing.
  const [shown, setShown] = useState(value);
  if (shown !== value) {
    setShown(value);
    setDraft(value);
  }

  return (
    <div className="flex items-center gap-2 rounded-md border p-2">
      <input
        id={id}
        type="color"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="size-9 shrink-0 cursor-pointer rounded border-0 bg-transparent p-0"
        aria-label={`${label} colour`}
      />
      <div className="min-w-0 flex-1">
        <Label htmlFor={`${id}-hex`} className="text-xs">
          {label}
        </Label>
        <Input
          id={`${id}-hex`}
          value={draft}
          spellCheck={false}
          className="h-7 font-mono text-xs"
          onChange={(event) => {
            const next = event.target.value.trim();
            setDraft(next);
            const hex = next.startsWith("#") ? next : `#${next}`;
            if (isHex(hex)) onChange(hex);
          }}
          onBlur={() => setDraft(value)}
        />
      </div>
      {changed ? (
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`Reset ${label.toLowerCase()}`}
          onClick={onReset}
        >
          <RotateCcw />
        </Button>
      ) : null}
    </div>
  );
}

function SliderField({
  label,
  value,
  display,
  range,
  onChange,
  onReset,
}: {
  label: string;
  value: number;
  display: (value: number) => string;
  range: { min: number; max: number; step: number };
  onChange: (value: number) => void;
  onReset?: () => void;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <Label className="text-sm">{label}</Label>
        <span className="text-muted-foreground flex items-center gap-1 text-xs tabular-nums">
          {display(value)}
          {onReset ? (
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label={`Reset ${label.toLowerCase()}`}
              onClick={onReset}
            >
              <RotateCcw />
            </Button>
          ) : null}
        </span>
      </div>
      <Slider
        value={[value]}
        min={range.min}
        max={range.max}
        step={range.step}
        aria-label={label}
        onValueChange={([next]) => onChange(Math.round(next * 1000) / 1000)}
      />
    </div>
  );
}

function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <div role="radiogroup" className="bg-muted flex gap-0.5 rounded-lg p-0.5 text-xs">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          onClick={() => onChange(option.value)}
          className={`flex-1 rounded-md px-2 py-1.5 font-medium transition-colors ${
            value === option.value
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/** The app's own components, so the preview is the real thing. */
function Preview() {
  return (
    <div className="bg-background space-y-3 rounded-xl border p-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">What triggers ADH release?</CardTitle>
          <CardDescription>Posterior pituitary · 3 cards due</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-2">
          <Button size="sm">Show answer</Button>
          <Button size="sm" variant="outline">
            Skip
          </Button>
          <Input className="h-8 max-w-48" placeholder="Type your answer…" />
        </CardContent>
      </Card>
    </div>
  );
}
