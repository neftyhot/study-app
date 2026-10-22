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

import { useApp } from "../context";
import { readSyncStatus, runSync, setSyncFolder, type SyncStatus } from "../data/sync";
import { pluginSyncFolder, syncFolderPlugin } from "../platform/sync-folder";
import { readReminders, rescheduleReminders, writeReminders } from "../data/reminders";
import { GEMINI_KEY, readApiKey } from "../platform/ai";
import { readAppearance, readTheme, writeAppearance, writeTheme } from "../theme";
import { UPDATE_EVENT } from "../components/update-banner";
import { Button, DesktopOnly, Notice, Screen } from "../components/ui";
import { checkForUpdate, restartIntoUpdate, runningVersion, supported as updatesSupported, type UpdateState } from "../platform/updates";

import { errorText } from "./source";

function updateText(state: UpdateState): string {
  switch (state.kind) {
    case "current":
      return "You have the latest version.";
    case "ready":
      return `Version ${state.version} is downloaded. Restart to use it.`;
    case "needs-reinstall":
      return `Version ${state.version} needs a fresh install from Xcode, so it can't be added from here.`;
    case "error":
      return `Couldn't check: ${state.message}`;
    case "unsupported":
      return "Updates are checked in the iPhone and iPad app.";
  }
}

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

function syncedText(at: string | null): string {
  if (!at) return "Not synced yet.";
  const minutes = Math.round((Date.now() - Date.parse(at)) / 60_000);
  if (minutes < 1) return "Synced just now.";
  if (minutes < 60) return `Synced ${minutes} minute${minutes === 1 ? "" : "s"} ago.`;
  return `Synced ${new Date(at).toLocaleString()}.`;
}

/** Sync through a folder in iCloud Drive that the Mac app also uses. */
function SyncSection() {
  const { db, changed, version } = useApp();
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "info" | "error"; text: string } | null>(null);

  useEffect(() => {
    void readSyncStatus(db).then(setStatus);
  }, [db, version]);

  async function syncNow(quiet = false) {
    setBusy(true);
    try {
      const result = await runSync(db, pluginSyncFolder);
      if (result && result.received > 0) changed();
      if (!quiet && result) {
        setMessage({
          tone: "info",
          text: result.devices
            ? `Up to date with ${result.devices} other device${result.devices === 1 ? "" : "s"}.`
            : "Synced. Turn on sync on your Mac with the same folder to see your decks there.",
        });
      }
    } catch (error) {
      setMessage({ tone: "error", text: errorText(error) || "The sync folder can't be reached. Is iCloud Drive turned on?" });
    } finally {
      setStatus(await readSyncStatus(db));
      setBusy(false);
    }
  }

  async function choose() {
    setMessage(null);
    try {
      const { name } = await syncFolderPlugin.pick();
      if (!name) return;
      await setSyncFolder(db, name);
      await syncNow();
    } catch (error) {
      setMessage({ tone: "error", text: errorText(error) });
    }
  }

  async function stop() {
    await syncFolderPlugin.clear();
    await setSyncFolder(db, null);
    setStatus(await readSyncStatus(db));
    setMessage({ tone: "info", text: "Sync is off. Your decks stay on this iPhone." });
  }

  if (!status) return null;
  return (
    <div className="section">
      <h2 className="section-title">Sync between devices</h2>
      <div className="panel stack">
        {status.folder ? (
          <>
            <p>
              Syncing with <strong>{status.folder}</strong>
            </p>
            <p className="muted small">{syncedText(status.lastSyncedAt)}</p>
            <div className="inline">
              <Button onClick={() => void syncNow()} disabled={busy}>
                {busy ? "Syncing…" : "Sync now"}
              </Button>
              <Button variant="ghost" onClick={() => void stop()} disabled={busy}>
                Stop syncing
              </Button>
            </div>
          </>
        ) : (
          <>
            <p className="muted small">
              Keep your decks and progress the same on this iPhone and your Mac, free, through your own iCloud Drive.
            </p>
            <p className="muted small">
              First, on your Mac: Settings → Sync between devices → Sync with iCloud Drive. Then tap below and pick the
              &ldquo;Megan Study Sync&rdquo; folder in iCloud Drive.
            </p>
            <div className="inline">
              <Button onClick={() => void choose()}>Choose folder</Button>
            </div>
          </>
        )}
        {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
        <p className="muted small">Pictures and source files stay on the device that has them.</p>
      </div>
    </div>
  );
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
  const [appVersion, setAppVersion] = useState("");
  const [update, setUpdate] = useState<UpdateState | null>(null);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    void runningVersion().then(setAppVersion);
  }, []);

  // A key can also arrive from the desktop's QR code while this screen is open.
  useEffect(() => {
    let live = true;
    void readApiKey(platform.secrets).then((key) => live && setHasKey(Boolean(key)));
    return () => {
      live = false;
    };
  }, [platform, ai]);

  async function checkUpdates() {
    setChecking(true);
    const state = await checkForUpdate();
    setChecking(false);
    setUpdate(state);
    window.dispatchEvent(new CustomEvent(UPDATE_EVENT, { detail: state }));
  }

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
          {hasKey ? null : (
            <p className="muted small">
              Already have one on your computer? Open Settings in Megan Study there, press Send to my iPhone, and
              scan the code with your Camera.
            </p>
          )}
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

      <SyncSection />

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

      {updatesSupported() ? (
        <div className="section">
          <h2 className="section-title">Updates</h2>
          <div className="panel">
            <p className="muted small">New versions download in the app. Your cards stay as they are.</p>
            <div className="inline">
              <Button variant="ghost" onClick={() => void checkUpdates()} disabled={checking}>
                {checking ? "Checking…" : "Check for updates"}
              </Button>
              {update?.kind === "ready" ? (
                <Button onClick={() => void restartIntoUpdate(update.bundleId)}>Restart now</Button>
              ) : null}
            </div>
            {update ? <p className="small" role="status">{updateText(update)}</p> : null}
          </div>
        </div>
      ) : null}

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
