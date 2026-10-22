/**
 * "Update ready — Restart": checks once per launch, quietly, and again when
 * Settings asks. A downloaded update is used on the next launch anyway, so
 * Later just hides this.
 */
import { useEffect, useState } from "react";

import { checkForUpdate, restartIntoUpdate, supported, type UpdateState } from "../platform/updates";
import { Button } from "./ui";

/** Settings fires this with the result of its own check. */
export const UPDATE_EVENT = "megan:update";

export function UpdateBanner() {
  const [ready, setReady] = useState<Extract<UpdateState, { kind: "ready" }> | null>(null);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    if (!supported()) return;
    let live = true;
    const show = (state: UpdateState) => {
      if (live && state.kind === "ready") {
        setReady(state);
        setHidden(false);
      }
    };
    // After the first screen is up, so start-up isn't slowed.
    const timer = window.setTimeout(() => void checkForUpdate().then(show), 4000);
    const onEvent = (event: Event) => show((event as CustomEvent<UpdateState>).detail);
    window.addEventListener(UPDATE_EVENT, onEvent);
    return () => {
      live = false;
      window.clearTimeout(timer);
      window.removeEventListener(UPDATE_EVENT, onEvent);
    };
  }, []);

  if (!ready || hidden) return null;
  return (
    <div className="toast" role="status">
      <span>Update {ready.version} is ready</span>
      <Button variant="ghost" onClick={() => setHidden(true)}>
        Later
      </Button>
      <Button variant="ghost" onClick={() => void restartIntoUpdate(ready.bundleId)}>
        Restart
      </Button>
    </div>
  );
}
