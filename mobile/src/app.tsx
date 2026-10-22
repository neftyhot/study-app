/**
 * The shell: one navigation stack per tab, bottom tabs on iPhone and a
 * sidebar with a split view on iPad (and in Split View once it is wide
 * enough). The tutor opens beside the content on iPad, as a screen on iPhone.
 */
import { App as CapacitorApp } from "@capacitor/app";
import { Capacitor, type PluginListenerHandle } from "@capacitor/core";
import { BookOpen, Home, Search, Settings as SettingsIcon, Sparkles, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { LicenseAccess, Platform, SqlDriver } from "@megan/core/platform/types";
import type { LlmProvider } from "@megan/core/llm/types";

import { LaunchSplash } from "./components/splash";
import { UpdateBanner } from "./components/update-banner";
import { AppContext, TABS, type AppContextValue, type Route, type Tab } from "./context";
import { createAiClient, GEMINI_KEY } from "./platform/ai";
import { CardsScreen } from "./screens/cards";
import { DeckScreen } from "./screens/deck";
import { DesktopScreen } from "./screens/desktop";
import { ExamScreen } from "./screens/exam";
import { GuideScreen } from "./screens/guide";
import { HomeScreen } from "./screens/home";
import { LearnScreen } from "./screens/learn";
import { LectureScreen, LecturesScreen } from "./screens/lectures";
import { LockedScreen } from "./screens/locked";
import { CatalogScreen } from "./screens/catalog";
import { MakeScreen } from "./screens/make";
import { SearchScreen } from "./screens/search";
import { SettingsScreen } from "./screens/settings";
import { SnapScreen } from "./screens/snap";
import { StudyScreen } from "./screens/study";
import { TutorPanel, TutorScreen } from "./screens/tutor";

const TAB_LABELS: Record<Tab, string> = { home: "Home", study: "Study", search: "Search", settings: "Settings" };
const TAB_ICONS = { home: Home, study: BookOpen, search: Search, settings: SettingsIcon } as const;

/** Wide enough for a sidebar: iPad full screen, and Split View at half or more. */
const WIDE = "(min-width: 768px)";

function useWide() {
  const [wide, setWide] = useState(() => window.matchMedia(WIDE).matches);
  useEffect(() => {
    const query = window.matchMedia(WIDE);
    const listener = () => setWide(query.matches);
    query.addEventListener("change", listener);
    return () => query.removeEventListener("change", listener);
  }, []);
  return wide;
}

function render(route: Route) {
  switch (route.name) {
    case "home":
      return <HomeScreen />;
    case "study":
      return <StudyScreen />;
    case "search":
      return <SearchScreen />;
    case "settings":
      return <SettingsScreen />;
    case "deck":
      return <DeckScreen examId={route.examId} />;
    case "cards":
      return <CardsScreen source={route.source} title={route.title} swipe={route.swipe} />;
    case "learn":
      return <LearnScreen source={route.source} title={route.title} />;
    case "exam":
      return <ExamScreen examId={route.examId} title={route.title} />;
    case "guide":
      return <GuideScreen examId={route.examId} title={route.title} />;
    case "tutor":
      return <TutorScreen examId={route.examId} ask={route.ask} />;
    case "snap":
      return <SnapScreen />;
    case "catalog":
      return <CatalogScreen share={route.share} />;
    case "make":
      return <MakeScreen notes={route.notes} />;
    case "lectures":
      return <LecturesScreen />;
    case "lecture":
      return <LectureScreen id={route.id} />;
    case "desktop":
      return <DesktopScreen feature={route.feature} />;
  }
}

/** A key event typed into a field belongs to the field. */
function typing(target: EventTarget | null) {
  const el = target as HTMLElement | null;
  return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
}

export function App({
  platform,
  initialAi,
  pendingImport,
}: {
  platform: Platform;
  initialAi: LlmProvider | null;
  /** A deck opened from Files, AirDrop or the share sheet before the app was up. */
  pendingImport?: string | null;
}) {
  const db: SqlDriver = platform.storage;
  const wide = useWide();
  const [tab, setTab] = useState<Tab>("home");
  const [stacks, setStacks] = useState<Record<Tab, Route[]>>({
    home: [{ name: "home" }],
    study: [{ name: "study" }],
    search: [{ name: "search" }],
    settings: [{ name: "settings" }],
  });
  const [ai, setAi] = useState(initialAi);
  const [version, setVersion] = useState(0);
  const [tutor, setTutor] = useState<{ examId?: string; ask?: string } | null>(null);

  const navigate = useCallback(
    (route: Route) => setStacks((all) => ({ ...all, [tab]: [...all[tab], route] })),
    [tab],
  );
  const back = useCallback(
    () => setStacks((all) => (all[tab].length > 1 ? { ...all, [tab]: all[tab].slice(0, -1) } : all)),
    [tab],
  );
  const selectTab = useCallback(
    (next: Tab) => {
      if (next === tab) setStacks((all) => ({ ...all, [next]: all[next].slice(0, 1) }));
      setTab(next);
    },
    [tab],
  );
  const openTutor = useCallback(
    (examId?: string, ask?: string) => {
      if (wide) setTutor({ examId, ask });
      else setStacks((all) => ({ ...all, [tab]: [...all[tab], { name: "tutor", examId, ask }] }));
    },
    [wide, tab],
  );
  const reloadAi = useCallback(async () => setAi(await createAiClient(platform.secrets)), [platform]);
  const changed = useCallback(() => setVersion((v) => v + 1), []);

  // Every screen but Settings waits on this: see platform/license.ts.
  const [access, setAccess] = useState<LicenseAccess | null>(null);
  const refreshAccess = useCallback(async () => {
    try {
      setAccess(await platform.license.access());
    } catch {
      // The Keychain is locked for a moment; the next read tries again.
    }
  }, [platform]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refreshAccess();
  }, [refreshAccess, version]);
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    const handle = CapacitorApp.addListener("appStateChange", ({ isActive }) => {
      if (isActive) void refreshAccess();
    });
    return () => void handle.then((h) => h.remove());
  }, [refreshAccess]);

  const value: AppContextValue = useMemo(
    () => ({ platform, db, ai, reloadAi, navigate, back, selectTab, version, changed, openTutor, wide, access, refreshAccess }),
    [platform, db, ai, reloadAi, navigate, back, selectTab, version, changed, openTutor, wide, access, refreshAccess],
  );

  // Hardware keyboards on iPad: ⌘1–4 for the tabs, / to search, Esc to go back.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && /^[1-4]$/.test(event.key)) {
        event.preventDefault();
        selectTab(TABS[Number(event.key) - 1]);
        return;
      }
      if (typing(event.target) || event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === "/") {
        event.preventDefault();
        setTab("search");
      } else if (event.key === "Escape") {
        if (tutor) setTutor(null);
        else back();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectTab, back, tutor]);

  // AI key links scanned from the desktop's "Send to my iPhone" code. Each
  // link is handled once, even when the launch URL and the listener both see it.
  const seenKeyLinks = useRef(new Set<string>());
  const saveKeyFromLink = useCallback(
    async (url: string) => {
      if (seenKeyLinks.current.has(url)) return;
      seenKeyLinks.current.add(url);
      const { parseKeyLink } = await import("@megan/core/share/key-link");
      const result = parseKeyLink(url);
      if (!result.ok) {
        window.alert(
          result.reason === "expired"
            ? "That code has expired. On your computer, open Settings and press Send to my iPhone again."
            : "That code isn't one this version of Megan Study understands.",
        );
        return;
      }
      if (!window.confirm("Save the AI key from your computer on this iPhone?")) return;
      await platform.secrets.set(GEMINI_KEY, result.key);
      await reloadAi();
      window.alert("Your AI key is saved. AI features are ready on this iPhone.");
    },
    [platform, reloadAi],
  );

  // License links from the web purchase page (meganstudy://license?token=…).
  const seenLicenseLinks = useRef(new Set<string>());
  const saveLicenseFromLink = useCallback(
    async (url: string) => {
      if (seenLicenseLinks.current.has(url) || !platform.license.activate) return;
      seenLicenseLinks.current.add(url);
      const { tokenFromLicenseLink } = await import("@megan/core/license/companion");
      const token = tokenFromLicenseLink(url);
      const result = token
        ? await platform.license.activate(token, "key")
        : { ok: false as const, message: "That link doesn't hold a license key." };
      await refreshAccess();
      window.alert(result.ok ? "Your license is active. Megan Study is unlocked on this device." : result.message);
    },
    [platform, refreshAccess],
  );

  // Shared decks: the file the app was opened with, then any opened later.
  useEffect(() => {
    let cleanup = () => {};
    void import("./share-intake").then(({ listenForSharedDecks, importFromUrl }) => {
      const open = async (url: string) => {
        const { isKeyLink } = await import("@megan/core/share/key-link");
        if (isKeyLink(url)) return saveKeyFromLink(url);
        const { isLicenseLink } = await import("@megan/core/license/companion");
        if (isLicenseLink(url)) return saveLicenseFromLink(url);
        const deck = await importFromUrl(db, url);
        if (!deck) return;
        changed();
        setTab("home");
        setStacks((all) => ({ ...all, home: [{ name: "home" }, { name: "deck", examId: deck.examId }] }));
      };
      if (pendingImport) void open(pendingImport);
      cleanup = listenForSharedDecks((url) => void open(url));
    });
    return () => cleanup();
  }, [db, changed, pendingImport, saveKeyFromLink, saveLicenseFromLink]);

  // The license the student's computer put in the sync folder. A key typed
  // in on this device is kept; otherwise the newest one that checks out wins.
  const takeDesktopLicense = useCallback(
    async (licenses: string[]) => {
      if (!platform.license.activate) return;
      const now = await platform.license.access();
      if (now.source === "license") return;
      for (const token of licenses) {
        if ((await platform.license.activate(token, "desktop")).ok) break;
      }
      await refreshAccess();
    },
    [platform, refreshAccess],
  );

  // Folder sync, when a folder is chosen in Settings: on opening, coming back
  // to the app, leaving it, every minute, and a few seconds after an edit.
  const syncRound = useCallback(async () => {
    if (!Capacitor.isNativePlatform()) return;
    const [{ runSync }, { pluginSyncFolder }] = await Promise.all([
      import("./data/sync"),
      import("./platform/sync-folder"),
    ]);
    try {
      const result = await runSync(db, pluginSyncFolder);
      if (result && result.received > 0) changed();
      if (result?.licenses.length) await takeDesktopLicense(result.licenses);
    } catch {
      // Offline or the folder is unavailable; the next round tries again.
    }
  }, [db, changed, takeDesktopLicense]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void syncRound();
    const timer = window.setInterval(() => void syncRound(), 60_000);
    let handle: Promise<PluginListenerHandle> | null = null;
    if (Capacitor.isNativePlatform()) {
      handle = CapacitorApp.addListener("appStateChange", () => void syncRound());
    }
    return () => {
      window.clearInterval(timer);
      void handle?.then((h) => h.remove());
    };
  }, [syncRound]);

  useEffect(() => {
    if (version === 0) return;
    const timer = window.setTimeout(() => void syncRound(), 5_000);
    return () => window.clearTimeout(timer);
  }, [version, syncRound]);

  const stack = stacks[tab];
  const current = stack[stack.length - 1];

  const tabs = TABS.map((id) => {
    const Icon = TAB_ICONS[id];
    return (
      <button
        key={id}
        type="button"
        className="tab"
        aria-current={tab === id ? "page" : undefined}
        onClick={() => selectTab(id)}
      >
        <Icon aria-hidden />
        <span>{TAB_LABELS[id]}</span>
      </button>
    );
  });

  return (
    <AppContext.Provider value={value}>
      <div className={wide ? "shell shell-wide" : "shell"}>
        {wide ? (
          <nav className="sidebar" aria-label="Sections">
            <p className="brand">
              <span data-launch-target>Megan Study</span>
            </p>
            {tabs}
            <button type="button" className="tab" onClick={() => openTutor()}>
              <Sparkles aria-hidden />
              <span>Tutor</span>
            </button>
          </nav>
        ) : (
          <p className="brand brand-top">
            <span data-launch-target>Megan Study</span>
          </p>
        )}
        <main className="content" key={`${tab}:${stack.length}`}>
          {access && !access.full && tab !== "settings" ? <LockedScreen /> : render(current)}
        </main>
        {wide && tutor && access?.full !== false ? (
          <aside className="tutor-panel" aria-label="Tutor">
            <div className="tutor-panel-head">
              <h2>Tutor</h2>
              <button type="button" className="icon-button" onClick={() => setTutor(null)} aria-label="Close the tutor">
                <X aria-hidden />
              </button>
            </div>
            <TutorPanel key={tutor.ask ?? tutor.examId ?? ""} examId={tutor.examId} ask={tutor.ask} />
          </aside>
        ) : null}
        {wide ? null : (
          <nav className="tabbar" aria-label="Sections">
            {tabs}
          </nav>
        )}
      </div>
      <UpdateBanner />
      <LaunchSplash />
    </AppContext.Provider>
  );
}
