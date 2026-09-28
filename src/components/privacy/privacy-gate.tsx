"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "@/lib/notify";

import { PrivacyPolicyText } from "@/components/privacy/privacy-policy";
import { usePurchase } from "@/components/settings/purchase-license";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { acceptPrivacyAction } from "@/lib/settings-actions";

/**
 * Stands in for the whole app until the privacy policy is agreed to — on
 * first launch, and again whenever the policy's version changes.
 *
 * On a trial (no key bought yet) it is also where the student chooses, up
 * front, between buying the licence now and starting the free trial.
 */
export function PrivacyGate({
  trial,
}: {
  /** Set while the app is running on its free trial. */
  trial: { days: number; daysRemaining: number | null } | null;
}) {
  const router = useRouter();
  const [checked, setChecked] = useState(false);
  const [pending, startTransition] = useTransition();
  // Bought and verified: the policy was agreed to before checkout opened.
  const { available, waiting, checking, purchase, check } = usePurchase(agree);
  const offerPurchase = trial !== null && available;

  function agree() {
    startTransition(async () => {
      const result = await acceptPrivacyAction();
      if (!result.ok) {
        toast.error("Could not save that. Try again.");
        return;
      }
      router.refresh();
    });
  }

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-4 py-10">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Before you start</h1>
        <p className="text-muted-foreground text-sm">
          Megan Study keeps your study material on this computer. It does send the
          developer usage statistics — numbers only, never your cards or files —
          and that is required to use the app. Please read the policy below
          {trial ? ", then choose whether to buy a licence now or start the free trial" : ""}.
        </p>
      </header>

      <div className="bg-card max-h-[55vh] overflow-y-auto rounded-lg border p-5">
        <PrivacyPolicyText />
      </div>

      <div className="flex items-start gap-2">
        <Checkbox
          id="privacy-agree"
          checked={checked}
          disabled={pending}
          onCheckedChange={(value) => setChecked(value === true)}
          className="mt-0.5"
        />
        <Label htmlFor="privacy-agree" className="text-sm font-normal leading-snug">
          I have read the privacy policy and agree to it, including sending usage
          statistics to the developer.
        </Label>
      </div>

      {offerPurchase ? (
        <section className="space-y-3" aria-labelledby="start-heading">
          <h2 id="start-heading" className="font-medium">
            Then choose how to start
          </h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="bg-card flex flex-col gap-3 rounded-lg border p-4">
              <div className="space-y-1">
                <p className="font-medium">Buy a licence now — $24.95</p>
                <p className="text-muted-foreground text-sm">
                  One-time payment, no subscription. Unlocks Megan Study on this
                  computer for good. Checkout opens securely in your browser
                  (Stripe), and this screen carries on by itself once it goes
                  through.
                </p>
              </div>
              {waiting ? (
                <div className="mt-auto space-y-2">
                  <p className="text-sm">Waiting for your payment…</p>
                  <Button
                    variant="outline"
                    className="w-full"
                    disabled={checking}
                    onClick={() => void check(false)}
                  >
                    {checking ? <Loader2 className="size-4 animate-spin" /> : null}
                    I&apos;ve paid — check now
                  </Button>
                </div>
              ) : (
                <Button
                  className="mt-auto w-full"
                  disabled={!checked || pending}
                  onClick={() => void purchase()}
                >
                  Agree and buy licence
                </Button>
              )}
            </div>
            <div className="bg-card flex flex-col gap-3 rounded-lg border p-4">
              <div className="space-y-1">
                <p className="font-medium">Try it free for {trial.days} days</p>
                <p className="text-muted-foreground text-sm">
                  Not buying now starts a {trial.days}-day free trial with
                  everything included
                  {trial.daysRemaining !== null
                    ? ` (${trial.daysRemaining === 1 ? "1 day" : `${trial.daysRemaining} days`} left)`
                    : ""}
                  . You can buy any time from Settings. When the trial ends the
                  app asks for a licence; nothing you made is lost.
                </p>
              </div>
              <Button
                variant="outline"
                className="mt-auto w-full"
                disabled={!checked || pending}
                onClick={agree}
              >
                {pending ? "Saving…" : `Agree and start ${trial.days}-day trial`}
              </Button>
            </div>
          </div>
          <p className="text-muted-foreground text-xs">
            Don&apos;t agree? Close Megan Study and uninstall it; nothing has been sent.
          </p>
        </section>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={agree} disabled={!checked || pending}>
            {pending ? "Saving…" : "Agree and continue"}
          </Button>
          <p className="text-muted-foreground text-xs">
            Don&apos;t agree? Close Megan Study and uninstall it; nothing has been sent.
          </p>
        </div>
      )}
    </main>
  );
}
