/**
 * The cold-launch wordmark, the same markup and choreography as the desktop's
 * LaunchSplash (src/components/layout/launch-splash.tsx): the words rise in
 * CSS before React loads, then tuck into the header's logo. The native launch
 * screen is this component's first frame, so the hand-over is invisible.
 */
import { useEffect, useRef, useState } from "react";

import { LAUNCH, LAUNCHED_KEY, playExit, prefersReducedMotion, SPLASH_ATTR } from "@megan/core/launch/choreography";

const WORDS = ["Megan", "Study"];

function remember(key: string) {
  try {
    sessionStorage.setItem(key, "1");
  } catch {
    // Storage blocked: the splash just plays again next time.
  }
}

function appReady(): Promise<void> {
  const fonts = document.fonts?.ready.then(() => undefined) ?? Promise.resolve();
  const cap = new Promise<void>((resolve) => setTimeout(resolve, LAUNCH.failsafe - LAUNCH.tuck - performance.now()));
  return Promise.race([fonts, cap]);
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}

function onSkip(skip: () => void) {
  window.addEventListener("pointerdown", skip, { capture: true, once: true });
  window.addEventListener("keydown", skip, { capture: true, once: true });
  return () => {
    window.removeEventListener("pointerdown", skip, { capture: true });
    window.removeEventListener("keydown", skip, { capture: true });
  };
}

export function LaunchSplash() {
  // Nothing to play when the boot script skipped the splash (a reload, or reduced motion before first launch).
  const [gone, setGone] = useState(() => !document.documentElement.hasAttribute(SPLASH_ATTR));
  const backdrop = useRef<HTMLDivElement>(null);
  const word = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const html = document.documentElement;
    if (!html.hasAttribute(SPLASH_ATTR)) return;
    remember(LAUNCHED_KEY);
    let cancelled = false;
    let skipNow = () => {};
    const unbind = onSkip(() => skipNow());

    void (async () => {
      const reduced = prefersReducedMotion();
      await Promise.all([appReady(), reduced ? null : wait(LAUNCH.reveal + LAUNCH.hold - performance.now())]);
      if (cancelled || !backdrop.current || !word.current) return;
      html.setAttribute(SPLASH_ATTR, "exit");
      const exit = playExit(
        {
          backdrop: backdrop.current,
          word: word.current,
          target: Array.from(document.querySelectorAll<HTMLElement>("[data-launch-target]")).find(
            (el) => el.getBoundingClientRect().width > 0,
          ) ?? null,
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
        <div className="launch-mark">
          <p className="launch-words" aria-hidden>
            {WORDS.map((text, index) => (
              <span key={text} className="launch-line">
                <span className="launch-word" style={{ animationDelay: `${index * 60}ms` }}>
                  {text}
                </span>
              </span>
            ))}
          </p>
        </div>
      </div>
    </div>
  );
}
