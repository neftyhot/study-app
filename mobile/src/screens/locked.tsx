/**
 * Shown instead of every screen but Settings once the trial is over with no
 * license. Nothing is sold here (App Store rules): the app opens with the
 * license from the student's computer, through sync, or a key they paste in.
 * Everything they made stays on the device either way.
 */
import { KeyRound, Laptop, Lock } from "lucide-react";

import { LOCK_MESSAGES } from "@megan/core/license/companion";

import { useApp } from "../context";
import { Screen } from "../components/ui";

export function LockedScreen() {
  const { access, selectTab } = useApp();
  const reason = access?.reason ?? "trial_ended";
  return (
    <Screen title="Megan Study" back={false}>
      <div className="panel stack locked">
        <Lock aria-hidden className="locked-icon" />
        <p>{LOCK_MESSAGES[reason]}</p>
        <p className="muted small">Megan Study opens with the license from your computer.</p>
      </div>
      <div className="section">
        <div className="list">
          <button type="button" className="row" onClick={() => selectTab("settings")}>
            <Laptop aria-hidden />
            <span className="row-main">
              <span className="row-title">Sync with your computer</span>
              <span className="row-sub">Settings → Sync between devices, the same folder your computer uses</span>
            </span>
          </button>
          <button type="button" className="row" onClick={() => selectTab("settings")}>
            <KeyRound aria-hidden />
            <span className="row-main">
              <span className="row-title">Enter a license key</span>
              <span className="row-sub">Settings → License</span>
            </span>
          </button>
        </div>
      </div>
    </Screen>
  );
}
