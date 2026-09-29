"use client";

import { ExternalLink } from "lucide-react";

import { Button } from "@/components/ui/button";
import { checkGeminiKey } from "@/lib/settings-actions";
import { toast } from "sonner";

export const AI_STUDIO_KEY_URL = "https://aistudio.google.com/apikey";

/**
 * How to get a Gemini key, for a student who has never made one.
 *
 * Every student uses their own key, so Gemini's free quota and any billing
 * are on their own Google account.
 */
export function GeminiKeySteps() {
  return (
    <div className="space-y-3 rounded-md border p-3">
      <p className="text-sm font-medium">Get your free Gemini key (about a minute)</p>
      <ol className="text-muted-foreground list-decimal space-y-1.5 pl-5 text-sm">
        <li>
          Open Google AI Studio and sign in with your Google account.
          <div className="pt-1.5">
            <Button asChild size="sm" variant="outline">
              <a href={AI_STUDIO_KEY_URL} target="_blank" rel="noreferrer">
                Open aistudio.google.com/apikey
                <ExternalLink className="size-3.5" />
              </a>
            </Button>
          </div>
        </li>
        <li>
          Click <span className="text-foreground font-medium">Create API key</span>. If it
          asks, accept the terms and let it create a project for you.
        </li>
        <li>
          Click <span className="text-foreground font-medium">Copy</span> next to the new key
          (it starts with <span className="font-mono">AIza</span>).
        </li>
        <li>Paste it below and save.</li>
      </ol>
      <p className="text-muted-foreground text-xs">
        The key is free and uses your own account&apos;s free quota. It is
        encrypted on this computer and sent only to Google.
      </p>
    </div>
  );
}

/**
 * Checks a Gemini key with Google before it is saved. False means don't
 * save: the key was rejected and the student has been told why.
 */
export async function confirmGeminiKey(key: string): Promise<boolean> {
  const result = await checkGeminiKey(key);
  if (result === "invalid") {
    toast.error(
      "Google didn't accept that key. Copy it again from aistudio.google.com/apikey and paste the whole thing.",
    );
    return false;
  }
  if (result === "unreachable") {
    toast("Couldn't reach Google to check the key, so it was saved unchecked.");
  }
  return true;
}
