/** The few building blocks every screen shares. Styles live in styles.css. */
import { ChevronLeft, Monitor } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

import { AVAILABLE_ON_DESKTOP } from "@megan/core/platform/types";

import { useApp } from "../context";

export function Screen({
  title,
  back = true,
  actions,
  children,
}: {
  title: string;
  back?: boolean;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const { back: goBack } = useApp();
  return (
    <section className="screen" data-reveal>
      <header className="screen-header">
        {back ? (
          <button type="button" className="icon-button" onClick={goBack} aria-label="Back">
            <ChevronLeft aria-hidden />
          </button>
        ) : null}
        <h1>{title}</h1>
        <div className="screen-actions">{actions}</div>
      </header>
      <div className="screen-body">{children}</div>
    </section>
  );
}

export function Button({
  children,
  onClick,
  variant = "primary",
  disabled,
  label,
  type = "button",
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: "primary" | "secondary" | "ghost" | "danger";
  disabled?: boolean;
  label?: string;
  type?: "button" | "submit";
}) {
  return (
    <button type={type} className={`button button-${variant}`} onClick={onClick} disabled={disabled} aria-label={label}>
      {children}
    </button>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <p className="empty-title">{title}</p>
      {children ? <div className="empty-body">{children}</div> : null}
    </div>
  );
}

export function Notice({ tone = "info", children }: { tone?: "info" | "error"; children: ReactNode }) {
  return (
    <p className={`notice notice-${tone}`} role={tone === "error" ? "alert" : "status"}>
      {children}
    </p>
  );
}

/** A deferred feature, said plainly instead of hidden. */
export function DesktopOnly({ label }: { label: string }) {
  const { navigate } = useApp();
  return (
    <button type="button" className="row row-muted" onClick={() => navigate({ name: "desktop", feature: label })}>
      <Monitor aria-hidden />
      <span className="row-main">{label}</span>
      <span className="pill">{AVAILABLE_ON_DESKTOP}</span>
    </button>
  );
}

/** A bottom sheet (iPhone) or centred panel (iPad); Escape and the scrim close it. */
export function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, { capture: true });
    return () => window.removeEventListener("keydown", onKey, { capture: true });
  }, [onClose]);
  return (
    <div className="sheet-scrim" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <h2>{title}</h2>
          <button type="button" className="button button-ghost" onClick={onClose}>
            Done
          </button>
        </div>
        <div className="sheet-body">{children}</div>
      </div>
    </div>
  );
}

/** Loads once per dependency change; re-runs when the app says data changed. */
export function useLoad<T>(load: () => Promise<T>, deps: unknown[]): { data: T | undefined; error: string | null } {
  const { version } = useApp();
  const [data, setData] = useState<T>();
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    load().then(
      (value) => live && (setData(value), setError(null)),
      (cause) => live && setError(cause instanceof Error ? cause.message : String(cause)),
    );
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, version]);
  return { data, error };
}

export function plural(count: number, word: string, many = `${word}s`) {
  return `${count} ${count === 1 ? word : many}`;
}
