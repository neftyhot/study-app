"use client";

import { useEffect, useState } from "react";
import { Brain, Check, ExternalLink, Loader2, ShieldCheck, Zap } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { BILLING_GUIDES, PROVIDER_MODELS, type ModelLevel } from "@/lib/llm/tiers";
import { OPEN_UPGRADE_EVENT, toast } from "@/lib/notify";
import { getSetupSnapshot, setModelLevel, type SetupSnapshot } from "@/lib/settings-actions";
import { PROVIDER_LABELS, type ApiProviderId } from "@/lib/settings-shared";

/**
 * Step-by-step help paying the model provider directly for more quota or a
 * stronger model. The app takes no payment: the button opens the provider's
 * own billing page, and the steps say what the student will see there.
 */
export function UpgradeGuide({
  provider,
  open,
  onOpenChange,
  onSwitched,
}: {
  provider: ApiProviderId;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSwitched?: (snapshot: SetupSnapshot) => void;
}) {
  const guide = BILLING_GUIDES[provider];
  const thinking = PROVIDER_MODELS[provider].thinking;
  const [opened, setOpened] = useState(false);
  const [switching, setSwitching] = useState(false);

  async function switchToThinking() {
    setSwitching(true);
    try {
      const snapshot = await setModelLevel(provider, "thinking");
      onSwitched?.(snapshot);
      toast.success(`Now using ${thinking.label.replace(/^Thinking — /, "")}`);
      onOpenChange(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not switch models.");
    } finally {
      setSwitching(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setOpened(false);
        onOpenChange(next);
      }}
    >
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Get more from {PROVIDER_LABELS[provider]}</DialogTitle>
          <DialogDescription>
            Adding billing to your own {PROVIDER_LABELS[provider]} account raises your usage
            limits and unlocks the Thinking model. You pay {PROVIDER_LABELS[provider]} directly —
            Megan Study never sees your card and takes no cut.
          </DialogDescription>
        </DialogHeader>

        <ol className="space-y-3">
          <li className="flex gap-3">
            <StepNumber n={1} done={opened} />
            <div className="min-w-0 flex-1 space-y-2">
              <p className="text-sm">Open the billing page in your browser.</p>
              <Button asChild onClick={() => setOpened(true)}>
                <a href={guide.billingUrl} target="_blank" rel="noreferrer">
                  {guide.billingButton}
                  <ExternalLink className="size-4" />
                </a>
              </Button>
              <p className="text-muted-foreground break-all text-xs">
                It should be <span className="font-mono">{new URL(guide.billingUrl).host}</span> —
                if the address bar shows anything else, close it.
              </p>
            </div>
          </li>
          {guide.steps.map((step, index) => (
            <li key={step} className="flex gap-3">
              <StepNumber n={index + 2} />
              <p className="min-w-0 flex-1 text-sm leading-relaxed">{step}</p>
            </li>
          ))}
        </ol>

        <p className="bg-muted/60 flex gap-2 rounded-md p-3 text-xs leading-relaxed">
          <ShieldCheck className="text-primary mt-0.5 size-4 shrink-0" />
          <span>{guide.cost}</span>
        </p>

        <div className="space-y-2 border-t pt-4">
          <p className="text-sm font-medium">Finished?</p>
          <p className="text-muted-foreground text-xs">{guide.done}</p>
          <div className="flex flex-wrap gap-2">
            <Button disabled={switching} onClick={() => void switchToThinking()}>
              {switching ? <Loader2 className="size-4 animate-spin" /> : <Brain className="size-4" />}
              Switch to Thinking
            </Button>
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Keep Standard
            </Button>
          </div>
          <p className="text-muted-foreground text-xs">
            Just hit a limit and don&apos;t want to pay? Free limits reset on their own — usually
            within a minute, or by the next day for daily limits. You can also check what
            you&apos;ve used on the{" "}
            <a className="underline" href={guide.usageUrl} target="_blank" rel="noreferrer">
              usage page
            </a>
            .
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function StepNumber({ n, done }: { n: number; done?: boolean }) {
  return (
    <span className="bg-primary/10 text-primary flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold">
      {done ? <Check className="size-3.5" /> : n}
    </span>
  );
}

/** Standard or Thinking for the provider in use, with the way to upgrade. */
export function ModelLevelCard({
  snapshot,
  onChange,
}: {
  snapshot: SetupSnapshot;
  onChange: (snapshot: SetupSnapshot) => void;
}) {
  const provider = snapshot.provider as ApiProviderId;
  const models = PROVIDER_MODELS[provider];
  const level = snapshot.levels[provider];
  const [busy, setBusy] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);

  async function choose(next: ModelLevel) {
    if (next === level) return;
    setBusy(true);
    try {
      onChange(await setModelLevel(provider, next));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="grid gap-2 sm:grid-cols-2">
        {(["standard", "thinking"] as const).map((id) => {
          const option = models[id];
          const selected = level === id;
          return (
            <button
              key={id}
              type="button"
              disabled={busy}
              onClick={() => void choose(id)}
              className={`rounded-md border p-3 text-left transition-colors ${
                selected ? "border-primary bg-primary/5" : "hover:bg-muted/60"
              }`}
            >
              <span className="flex flex-wrap items-center gap-2 text-sm font-medium">
                {id === "thinking" ? <Brain className="size-4" /> : <Zap className="size-4" />}
                {option.label}
                {selected ? <Badge variant="secondary">In use</Badge> : null}
              </span>
              <span className="text-muted-foreground mt-1 block text-xs">{option.blurb}</span>
              <span className="text-muted-foreground mt-1 block text-[11px]">
                {option.price} per million tokens in / out
                {option.paid ? " · needs billing" : " · free tier"}
              </span>
            </button>
          );
        })}
      </div>
      <p className="text-muted-foreground text-xs">
        If the chosen model is unavailable, busy or out of quota, the app automatically answers
        with {models.fallbacks.slice(1).join(" or ")} instead, so studying never stops.
      </p>
      <Button variant="outline" size="sm" onClick={() => setGuideOpen(true)}>
        <Brain className="size-4" />
        Upgrade or raise limits
      </Button>
      <UpgradeGuide
        provider={provider}
        open={guideOpen}
        onOpenChange={setGuideOpen}
        onSwitched={onChange}
      />
    </div>
  );
}

/**
 * Mounted once in the layout: the "Fix this" button on a limit error opens
 * the guide for whichever provider is in use.
 */
export function UpgradeGuideHost() {
  const [provider, setProvider] = useState<ApiProviderId | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    async function show() {
      const snapshot = await getSetupSnapshot();
      if (snapshot.provider === "local") {
        toast("The offline model has no usage limits. If it failed, try a cloud model in Settings.");
        return;
      }
      setProvider(snapshot.provider);
      setOpen(true);
    }
    const listener = () => void show();
    window.addEventListener(OPEN_UPGRADE_EVENT, listener);
    return () => window.removeEventListener(OPEN_UPGRADE_EVENT, listener);
  }, []);

  if (!provider) return null;
  return <UpgradeGuide provider={provider} open={open} onOpenChange={setOpen} />;
}
