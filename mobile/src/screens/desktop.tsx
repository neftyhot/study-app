/** What the iPhone and iPad leave to the desktop app, said plainly. */
import { Monitor } from "lucide-react";

import { AVAILABLE_ON_DESKTOP, DESKTOP_ONLY_FEATURES } from "@megan/core/platform/types";

import { Screen } from "../components/ui";

export function DesktopScreen({ feature }: { feature?: string }) {
  return (
    <Screen title={AVAILABLE_ON_DESKTOP}>
      <p className="muted">
        {feature ? `${feature} needs the desktop app. ` : ""}
        These features need a computer — the processing power, the files, or the room to work. Everything they make
        comes to your phone in a .meganstudy file.
      </p>
      <div className="list">
        {DESKTOP_ONLY_FEATURES.map((item) => (
          <div className="row row-muted" key={item.id} aria-current={item.label === feature ? "true" : undefined}>
            <Monitor aria-hidden />
            <span className="row-main">
              <span className="row-title">{item.label}</span>
            </span>
          </div>
        ))}
      </div>
    </Screen>
  );
}
