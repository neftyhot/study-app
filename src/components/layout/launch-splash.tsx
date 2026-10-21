"use client";

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";

import {
  LAUNCH,
  LAUNCHED_KEY,
  playExit,
  playWelcomeExit,
  prefersReducedMotion,
  SPLASH_ATTR,
  WELCOME_HOLD,
  WELCOMED_KEY,
} from "@/lib/launch/choreography";

const WORDS = ["Megan", "Study"];

/** The wordmark: each word rises out of its own clipped line. */
function Wordmark({ tagline }: { tagline?: string }) {
  return (
    <div className="launch-mark">
      <p className="launch-words" aria-hidden>
        {WORDS.map((word, index) => (
          <span key={word} className="launch-line">
            <span className="launch-word" style={{ animationDelay: `${index * 60}ms` }}>
              {word}
            </span>
          </span>
        ))}
      </p>
      {tagline ? <p className="launch-tagline">{tagline}</p> : null}
    </div>
  );
}

function remember(key: string) {
  try {
    sessionStorage.setItem(key, "1");
  } catch {
    // Storage blocked: the splash just plays again next time.
  }
}

function seen(key: string): boolean {
  try {
    return sessionStorage.getItem(key) !== null;
  } catch {
    return true;
  }
}

/** Ready once the page has hydrated and its fonts are in, but never past the failsafe. */
function appReady(): Promise<void> {
  const fonts = document.fonts?.ready.then(() => undefined) ?? Promise.resolve();
  const cap = new Promise<void>((resolve) => setTimeout(resolve, LAUNCH.failsafe - LAUNCH.tuck - performance.now()));
  return Promise.race([fonts, cap]);
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}

/** Click or any key jumps to the end. */
function onSkip(skip: () => void) {
  window.addEventListener("pointerdown", skip, { capture: true, once: true });
  window.addEventListener("keydown", skip, { capture: true, once: true });
  return () => {
    window.removeEventListener("pointerdown", skip, { capture: true });
    window.removeEventListener("keydown", skip, { capture: true });
  };
}

/**
 * The cold-launch wordmark that tucks into the header logo.
 *
 * Rendered by the server so it covers the very first paint, but shown only
 * when SPLASH_BOOT_SCRIPT (in the layout's <head>) marked <html> — once per window, not on reloads. The
 * rise is CSS, so it plays before React loads; the exit waits for the app to
 * be ready (fonts in, hydrated) and then hands off to the real logo. CSS hides
 * it after 4 s on its own in case script never runs. See choreography.ts.
 */
export function LaunchSplash() {
  const [gone, setGone] = useState(false);
  const backdrop = useRef<HTMLDivElement>(null);
  const word = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const html = document.documentElement;
    if (!html.hasAttribute(SPLASH_ATTR)) {
      // Decided by the boot script before React, so only known after mount.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setGone(true);
      return;
    }
    remember(LAUNCHED_KEY);
    let cancelled = false;
    let skipNow = () => {};
    const unbind = onSkip(() => skipNow());

    void (async () => {
      const reduced = prefersReducedMotion();
      await Promise.all([appReady(), reduced ? null : wait(LAUNCH.reveal + LAUNCH.hold - performance.now())]);
      if (cancelled || !backdrop.current || !word.current) return;
      // From here script owns it: CSS's 4 s failsafe stands down.
      html.setAttribute(SPLASH_ATTR, "exit");
      const exit = playExit(
        {
          backdrop: backdrop.current,
          word: word.current,
          target: document.querySelector<HTMLElement>("[data-launch-target]"),
          reveal: Array.from(document.querySelectorAll<HTMLElement>("[data-reveal]")),
        },
        reduced,
      );
      skipNow = exit.skip;
      await exit.done;
      html.removeAttribute(SPLASH_ATTR);
      exit.release();
      if (!cancelled) setGone(true);
    })();

    // A skip before the exit starts: jump straight there, with no hold.
    skipNow = () => {
      html.removeAttribute(SPLASH_ATTR);
      setGone(true);
    };

    return () => {
      cancelled = true;
      unbind();
    };
  }, []);

  if (gone) return null;
  return (
    <div className="launch-splash" role="presentation">
      <div ref={backdrop} className="launch-backdrop" />
      <div ref={word} className="launch-flip">
        <Wordmark />
      </div>
    </div>
  );
}

/**
 * The welcome screen's longer version: the words, a line about the app, and
 * then they lift away as the setup wizard rises in. Once per window, and not
 * when the cold-launch splash is already playing. Decided before paint, so
 * the wizard never flashes first.
 */
export function WelcomeIntro({ children, tagline }: { children: ReactNode; tagline: string }) {
  const [playing, setPlaying] = useState(false);
  const backdrop = useRef<HTMLDivElement>(null);
  const word = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (seen(WELCOMED_KEY) || document.documentElement.hasAttribute(SPLASH_ATTR)) return;
    remember(WELCOMED_KEY);
    // Session storage is only readable after mount; before paint, so no flash.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPlaying(true);
  }, []);

  useEffect(() => {
    if (!playing || !backdrop.current || !word.current || !content.current) return;
    const reduced = prefersReducedMotion();
    let cancelled = false;
    let skipNow = () => {
      cancelled = true;
      setPlaying(false);
    };
    const unbind = onSkip(() => skipNow());
    const parts = { backdrop: backdrop.current, word: word.current, reveal: [content.current] };

    void (async () => {
      await wait(reduced ? 900 : WELCOME_HOLD);
      if (cancelled) return;
      const exit = playWelcomeExit(parts, reduced);
      skipNow = exit.skip;
      await exit.done;
      if (cancelled) return;
      setPlaying(false);
      // Let go of the end states once React has dropped the inline opacity.
      requestAnimationFrame(() => exit.release());
    })();

    return () => {
      cancelled = true;
      unbind();
    };
  }, [playing]);

  return (
    <>
      {playing ? (
        <div className="launch-splash launch-splash-welcome" role="presentation">
          <div ref={backdrop} className="launch-backdrop" />
          <div ref={word}>
            <Wordmark tagline={tagline} />
          </div>
        </div>
      ) : null}
      <div ref={content} style={playing ? { opacity: 0 } : undefined}>
        {children}
      </div>
    </>
  );
}
