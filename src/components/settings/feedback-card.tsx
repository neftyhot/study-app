"use client";

import { useState } from "react";
import { Loader2, Send } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { sendFeedbackAction } from "@/lib/app-actions";

export function FeedbackCard() {
  const [text, setText] = useState("");
  const [contact, setContact] = useState("");
  const [busy, setBusy] = useState(false);

  async function send() {
    setBusy(true);
    try {
      const result = await sendFeedbackAction(text, contact);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setText("");
      toast.success(
        result.queued > 0
          ? "Saved — it will send next time you're online."
          : "Thanks! Your suggestion was sent.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card id="feedback" className="scroll-mt-20">
      <CardHeader>
        <CardTitle className="text-base">Suggest a feature</CardTitle>
        <CardDescription>
          Something missing, annoying or wished for? It goes straight to the
          developer. Only what you type here is sent — none of your cards or
          files.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <Textarea
          value={text}
          rows={4}
          maxLength={5000}
          placeholder="It would be great if…"
          onChange={(event) => setText(event.target.value)}
          aria-label="Your suggestion"
        />
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-56 flex-1 space-y-1">
            <Label htmlFor="feedback-contact" className="text-xs">
              Email, if you&apos;d like a reply (optional)
            </Label>
            <Input
              id="feedback-contact"
              value={contact}
              onChange={(event) => setContact(event.target.value)}
            />
          </div>
          <Button onClick={() => void send()} disabled={busy || !text.trim()}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
            Send
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
