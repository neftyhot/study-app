/**
 * The launch animation's moves, as plain DOM and Web Animations calls.
 *
 * No React and no Electron here, so the same choreography runs in the desktop
 * app and in the iOS shell (which loads the same web bundle). Only transform
 * and opacity are animated, so every frame stays on the compositor.
 *
 * Timeline, from first paint:
 *   0–450 ms     the words rise into place (CSS, so it starts before hydration)
 *   450–750 ms   hold — longer only if the app is not ready yet
 *   750–1350 ms  the wordmark tucks into the header logo (FLIP)
 *   ~1050 ms on  header and page fade and rise in, a beat apart
 * With reduced motion it is one 200 ms crossfade.
 */

export const LAUNCH = {
  reveal: 450,
  hold: 300,
  tuck: 600,
  /** When, into the tuck, the app starts to come in under the wordmark. */
  appLead: 300,
  appRise: 300,
  stagger: 50,
  rise: 8,
  handoff: 120,
  reduced: 200,
  /** Past this, the splash gets out of the way whether or not the app is ready. */
  failsafe: 4000,
} as const;

export const LAUNCH_EASE = "cubic-bezier(0.65, 0, 0.35, 1)";
const SETTLE_EASE = "cubic-bezier(0.2, 0.7, 0.1, 1)";

/** Set on <html> before first paint when this window has not played it yet. */
export const SPLASH_ATTR = "data-splash";
export const LAUNCHED_KEY = "study-app:launched";

/**
 * Runs in <head>, before first paint: marks <html> so the splash covers the
 * page — but only on a cold launch. A reload in the same window skips it.
 */
export const SPLASH_BOOT_SCRIPT = `try{if(!sessionStorage.getItem(${JSON.stringify(LAUNCHED_KEY)}))document.documentElement.setAttribute(${JSON.stringify(SPLASH_ATTR)},"")}catch(e){}`;

export function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

/** A visible element's box, or null when it is hidden (e.g. below a breakpoint). */
export function visibleRect(element: Element | null): DOMRect | null {
  if (!element) return null;
  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0 ? rect : null;
}

/**
 * The transform that moves `from` onto `to`: left edges and vertical centers
 * line up. Scaled by height unless told otherwise (the font-size ratio is
 * better when the two boxes have different line heights). Assumes
 * `transform-origin: 0 0` on the moving element.
 */
export function flipTransform(from: DOMRect, to: DOMRect, scale = to.height / from.height): string {
  const dx = to.left - from.left;
  const dy = to.top + to.height / 2 - (from.top + (from.height * scale) / 2);
  return `translate(${dx}px, ${dy}px) scale(${scale})`;
}

function finished(animation: Animation): Promise<void> {
  return animation.finished.then(
    () => undefined,
    () => undefined, // cancelled by a skip
  );
}

/**
 * Header, banners, page: fade and rise in, a beat apart, after `lead` ms.
 * The fill holds them hidden through the lead, so they can be started early.
 */
export function revealApp(nodes: HTMLElement[], reduced: boolean, lead = 0): Animation[] {
  return nodes.map((node, index) =>
    node.animate(
      reduced
        ? [{ opacity: 0 }, { opacity: 1 }]
        : [
            { opacity: 0, transform: `translateY(${LAUNCH.rise}px)` },
            { opacity: 1, transform: "translateY(0)" },
          ],
      {
        duration: reduced ? LAUNCH.reduced : LAUNCH.appRise,
        delay: reduced ? 0 : lead + index * LAUNCH.stagger,
        easing: SETTLE_EASE,
        fill: "both",
      },
    ),
  );
}

function fontSize(element: Element): number {
  return parseFloat(getComputedStyle(element).fontSize) || 0;
}

export type SplashParts = {
  /** The overlay's background layer. */
  backdrop: HTMLElement;
  /** The wordmark. */
  word: HTMLElement;
  /** The real logo it lands on, or null when there is none (e.g. the privacy screen). */
  target: HTMLElement | null;
  /** What fades and rises in under it, in order. */
  reveal: HTMLElement[];
};

/**
 * Plays the exit: tuck, reveal, hand-off. Resolves when the overlay can go.
 * The returned `skip` jumps straight to the end.
 */
export function playExit(parts: SplashParts, reduced = prefersReducedMotion()) {
  const running: Animation[] = [];
  const track = (animation: Animation) => {
    running.push(animation);
    return animation;
  };

  const done = (async () => {
    if (reduced) {
      await Promise.all([
        finished(track(parts.backdrop.animate([{ opacity: 1 }, { opacity: 0 }], { duration: LAUNCH.reduced, fill: "forwards" }))),
        finished(track(parts.word.animate([{ opacity: 1 }, { opacity: 0 }], { duration: LAUNCH.reduced, fill: "forwards" }))),
        ...revealApp(parts.reveal, true).map((a) => finished(track(a))),
      ]);
      return;
    }

    const from = parts.word.getBoundingClientRect();
    const to = visibleRect(parts.target);

    const fromSize = fontSize(parts.word);
    const scale = to && parts.target && fromSize ? fontSize(parts.target) / fromSize : undefined;

    const tuck = track(
      parts.word.animate(
        to
          ? [{ transform: "none" }, { transform: flipTransform(from, to, scale) }]
          : [
              { transform: "none", opacity: 1 },
              { transform: "scale(0.96)", opacity: 0 },
            ],
        { duration: LAUNCH.tuck, easing: LAUNCH_EASE, fill: "forwards" },
      ),
    );
    const backdrop = track(
      parts.backdrop.animate([{ opacity: 1 }, { opacity: 0 }], {
        duration: LAUNCH.tuck - LAUNCH.appLead,
        delay: LAUNCH.appLead,
        easing: LAUNCH_EASE,
        fill: "both",
      }),
    );
    const app = revealApp(parts.reveal, false, LAUNCH.appLead).map(track);

    await finished(tuck);
    if (to && parts.target) {
      // The real logo takes over where the wordmark landed.
      await Promise.all([
        finished(track(parts.target.animate([{ opacity: 0 }, { opacity: 1 }], { duration: LAUNCH.handoff, fill: "forwards" }))),
        finished(track(parts.word.animate([{ opacity: 1 }, { opacity: 0 }], { duration: LAUNCH.handoff, fill: "forwards" }))),
      ]);
    }
    await Promise.all([finished(backdrop), ...app.map(finished)]);
  })();

  return {
    done,
    /** Every moving part to its end state, now. */
    skip() {
      for (const animation of running) {
        try {
          animation.finish();
        } catch {
          animation.cancel();
        }
      }
    },
    /** Lets go of the end states once the overlay is gone. */
    release() {
      for (const animation of running) animation.cancel();
    },
  };
}

/** The welcome screen's longer version holds the words this long before moving on. */
export const WELCOME_HOLD = 2200;
export const WELCOMED_KEY = "study-app:welcomed";

/**
 * The welcome version's exit: the words lift up and away and the setup wizard
 * rises in beneath them. Same contract as `playExit`.
 */
export function playWelcomeExit(parts: Omit<SplashParts, "target">, reduced = prefersReducedMotion()) {
  const running: Animation[] = [];
  const track = (animation: Animation) => {
    running.push(animation);
    return animation;
  };
  const duration = reduced ? LAUNCH.reduced : LAUNCH.tuck;

  const done = Promise.all([
    finished(
      track(
        parts.word.animate(
          reduced
            ? [{ opacity: 1 }, { opacity: 0 }]
            : [
                { opacity: 1, transform: "none" },
                { opacity: 0, transform: "translateY(-12vh) scale(0.9)" },
              ],
          { duration, easing: LAUNCH_EASE, fill: "forwards" },
        ),
      ),
    ),
    finished(
      track(
        parts.backdrop.animate([{ opacity: 1 }, { opacity: 0 }], {
          duration: reduced ? duration : duration - LAUNCH.appLead,
          delay: reduced ? 0 : LAUNCH.appLead,
          easing: LAUNCH_EASE,
          fill: "both",
        }),
      ),
    ),
    ...revealApp(parts.reveal, reduced, LAUNCH.appLead).map((a) => finished(track(a))),
  ]).then(() => undefined);

  return {
    done,
    skip() {
      for (const animation of running) {
        try {
          animation.finish();
        } catch {
          animation.cancel();
        }
      }
    },
    release() {
      for (const animation of running) animation.cancel();
    },
  };
}
