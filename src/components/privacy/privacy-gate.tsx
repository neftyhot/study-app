"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { PrivacyPolicyText } from "@/components/privacy/privacy-policy";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { acceptPrivacyAction } from "@/lib/settings-actions";

/**
 * Stands in for the whole app until the privacy policy is agreed to — on
 * first launch, and again whenever the policy's version changes.
 */
export function PrivacyGate() {
  const router = useRouter();
  const [checked, setChecked] = useState(false);
  const [pending, startTransition] = useTransition();

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
          and that is required to use the app. Please read the policy below.
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

      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={agree} disabled={!checked || pending}>
          {pending ? "Saving…" : "Agree and continue"}
        </Button>
        <p className="text-muted-foreground text-xs">
          Don&apos;t agree? Close Megan Study and uninstall it; nothing has been sent.
        </p>
      </div>
    </main>
  );
}
