/**
 * Settings: style and appearance, the AI key, reminders, access and what
 * waits on the desktop. Everything the student changes is saved as it changes.
 */
import { useEffect, useState } from "react";

import {
  CARD_STYLE_LABELS,
  CARD_STYLES,
  FONT_IDS,
  FONT_LABELS,
  TEXT_SCALE_RANGE,
  THEME_IDS,
  THEMES,
  type Appearance,
  type CardStyle,
  type FontId,
  type ThemePreference,
} from "@megan/core/appearance";
import { DESKTOP_ONLY_FEATURES, type LicenseAccess } from "@megan/core/platform/types";
import type { Reminders } from "@megan/core/reminders/reminders";

import { version as appVersion } from "../../package.json";
import { useApp } from "../context";
import { readReminders, rescheduleReminders, writeReminders } from "../data/reminders";
import { GEMINI_KEY, readApiKey } from "../platform/ai";
import { readAppearance, readTheme, writeAppearance, writeTheme } from "../theme";
import { Button, DesktopOnly, Notice, Screen } from "../components/ui";

import { errorText } from "./source";

const ACCESS_TEXT: Record<LicenseAccess["source"], string> = {
  license: "Licensed",
  trial: "Free trial",
  development: "Full access (test build)",
  "desktop-link": "Unlocked with your desktop license",
  none: "No access",
};

/** Tells main.tsx to restyle the app at once. */
function announce(theme: ThemePreference, appearance: Appearance) {
  window.dispatchEvent(new CustomEvent("megan:appearance", { detail: { theme, appearance } }));
}

export function SettingsScreen() {
  const { db, platform, ai, reloadAi } = useApp();
  const [theme, setTheme] = useState<ThemePreference>("system");
  const [appearance, setAppearance] = useState<Appearance | null>(null);
  const [reminders, setReminders] = useState<Reminders | null>(null);
  const [access, setAccess] = useState<LicenseAccess | null>(null);
  const [hasKey, setHasKey] = useState(false);
  const [keyDraft, setKeyDraft] = useState("");
  const [message, setMessage] = useState<{ tone: "info" | "error"; text: string } | null>(null);

  useEffect(() => {
    let live = true;
    void Promise.all([readTheme(db), readAppearance(db), readReminders(db), platform.license.access(), readApiKey(platform.secrets)]).then(
      ([t, a, r, l, key]) => {
        if (!live) return;
        setTheme(t);
        setAppearance(a);
        setReminders(r);
        setAccess(l);
        setHasKey(!!key);
      },
      (cause) => live && setMessage({ tone: "error", text: errorText(cause) }),
    );
    return () => {
      live = false;
    };
  }, [db, platform]);

  async function changeTheme(next: ThemePreference) {
    setTheme(next);
    await writeTheme(db, next);
    if (appearance) announce(next, appearance);
  }

  async function changeAppearance(patch: Partial<Appearance>) {
    if (!appearance) return;
    const saved = await writeAppearance(db, { ...appearance, ...patch });
    setAppearance(saved);
    announce(theme, saved);
  }

  async function saveKey() {
    const key = keyDraft.trim();
    if (!key) return;
    setMessage(null);
    try {
      await platform.secrets.set(GEMINI_KEY, key);
      await reloadAi();
      setKeyDraft("");
      setHasKey(true);
      setMessage({ tone: "info", text: "Key saved to this device's Keychain." });
    } catch (cause) {
      setMessage({ tone: "error", text: errorText(cause) });
    }
  }

  async function removeKey() {
    setMessage(null);
    try {
      await platform.secrets.delete(GEMINI_KEY);
      await reloadAi();
      setHasKey(false);
      setMessage({ tone: "info", text: "Key removed. Studying still works; the tutor and Snap need a key." });
    } catch (cause) {
      setMessage({ tone: "error", text: errorText(cause) });
    }
  }

  async function changeReminders(next: Reminders) {
    setMessage(null);
    try {
      if (next.enabled && !reminders?.enabled && !(await platform.notifications.requestPermission())) {
        setMessage({ tone: "error", text: "Notifications are off for Megan Study. Turn them on in the Settings app, then try again." });
        return;
      }
      const saved = await writeReminders(db, next);
      setReminders(saved);
      await rescheduleReminders(db, platform.notifications);
    } catch (cause) {
      setMessage({ tone: "error", text: errorText(cause) });
    }
  }

  return (
    <Screen title="Settings" back={false}>
      {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}

      <div className="section">
        <h2 className="section-title">Look</h2>
        <div className="panel stack">
          <label className="field">
            <span className="field-label">Style</span>
            <select className="select" value={theme} onChange={(e) => void changeTheme(e.target.value as ThemePreference)}>
              <option value="system">Match the system (light or dark)</option>
              {THEME_IDS.map((id) => (
                <option key={id} value={id}>
                  {THEMES[id].label}
                </option>
              ))}
            </select>
          </label>
          {appearance ? (
            <>
              <label className="field">
                <span className="field-label">Font</span>
                <select
                  className="select"
                  value={appearance.font}
                  onChange={(e) => void changeAppearance({ font: e.target.value as FontId })}
                >
                  {FONT_IDS.map((id) => (
                    <option key={id} value={id}>
                      {FONT_LABELS[id]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span className="field-label">Cards</span>
                <select
                  className="select"
                  value={appearance.cardStyle}
                  onChange={(e) => void changeAppearance({ cardStyle: e.target.value as CardStyle })}
                >
                  {CARD_STYLES.map((id) => (
                    <option key={id} value={id}>
                      {CARD_STYLE_LABELS[id]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span className="field-label">Text size · {Math.round(appearance.textScale * 100)}%</span>
                <input
                  type="range"
                  min={TEXT_SCALE_RANGE.min}
                  max={TEXT_SCALE_RANGE.max}
                  step={TEXT_SCALE_RANGE.step}
                  value={appearance.textScale}
                  onChange={(e) => void changeAppearance({ textScale: Number(e.target.value) })}
                />
              </label>
              <p className="muted small">The text also follows the size set in the iOS Settings app.</p>
            </>
          ) : null}
        </div>
      </div>

      <div className="section">
        <h2 className="section-title">AI</h2>
        <div className="panel stack">
          <p className="muted small">
            {hasKey && ai
              ? "A Gemini key is saved. The tutor, Snap your notes and typed-answer marking use it."
              : "Add a Gemini API key to use the tutor and Snap your notes. Studying works without one."}
          </p>
          <label className="field">
            <span className="field-label">{hasKey ? "Replace the key" : "Gemini API key"}</span>
            <input
              className="input"
              type="password"
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              value={keyDraft}
              placeholder="Paste your key"
              onChange={(e) => setKeyDraft(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void saveKey()}
            />
          </label>
          <div className="inline">
            <Button onClick={() => void saveKey()} disabled={!keyDraft.trim()}>
              Save key
            </Button>
            {hasKey ? (
              <Button variant="ghost" onClick={() => void removeKey()}>
                Remove key
              </Button>
            ) : null}
          </div>
          <p className="muted small">The key stays in this device&apos;s Keychain. It is not synced or sent anywhere but Google.</p>
        </div>
      </div>

      <div className="section">
        <h2 className="section-title">Reminders</h2>
        {reminders ? (
          <div className="panel stack">
            <label className="switch">
              <span>Remind me when cards are due</span>
              <input
                type="checkbox"
                checked={reminders.enabled}
                onChange={(e) => void changeReminders({ ...reminders, enabled: e.target.checked })}
              />
            </label>
            {reminders.enabled ? (
              <label className="field">
                <span className="field-label">At</span>
                <input
                  className="input"
                  type="time"
                  value={reminders.time}
                  onChange={(e) => e.target.value && void changeReminders({ ...reminders, time: e.target.value })}
                />
              </label>
            ) : null}
            <p className="muted small">Only on days something is due, planned a week ahead.</p>
          </div>
        ) : null}
      </div>

      <div className="section">
        <h2 className="section-title">Access</h2>
        <div className="panel">
          <p>{access ? ACCESS_TEXT[access.source] : "…"}</p>
          {access?.trialDaysLeft != null ? <p className="muted small">{access.trialDaysLeft} days left in the trial.</p> : null}
        </div>
      </div>

      <details className="section">
        <summary className="section-title">On the desktop app</summary>
        <div className="list">
          {DESKTOP_ONLY_FEATURES.map((feature) => (
            <DesktopOnly key={feature.id} label={feature.label} />
          ))}
        </div>
      </details>

      <p className="muted small center">Megan Study for iPhone and iPad · {appVersion}</p>
    </Screen>
  );
}
