"use client";

import { useEffect, useState } from "react";
import { Loader2, Smartphone } from "lucide-react";
import QRCode from "qrcode";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { phoneKeyLinkAction } from "@/lib/settings-actions";

const PROBLEMS = {
  missing: "Add a Gemini key above first — that's the one the iPhone app uses.",
  environment:
    "This key comes from a developer .env file, so it isn't sent anywhere. Paste a key above instead.",
} as const;

/**
 * "Send to my iPhone": a QR code of the student's Gemini key that the
 * iPhone's Camera opens straight into Megan Study. Made on this computer,
 * shown for two minutes, then gone.
 */
export function PhoneKeyCard() {
  const [code, setCode] = useState<{ svg: string; until: number } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!code) return;
    const timer = window.setInterval(() => {
      const time = Date.now();
      setNow(time);
      if (time >= code.until) setCode(null);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [code]);

  async function show() {
    setBusy(true);
    setProblem(null);
    try {
      const result = await phoneKeyLinkAction();
      if (!result.ok) {
        setProblem(PROBLEMS[result.reason]);
        return;
      }
      const svg = await QRCode.toString(result.link, {
        type: "svg",
        margin: 1,
        errorCorrectionLevel: "M",
        color: { dark: "#000000", light: "#ffffff" },
      });
      setNow(Date.now());
      setCode({ svg, until: result.until });
    } catch {
      setProblem("The code couldn't be made. Try again.");
    } finally {
      setBusy(false);
    }
  }

  const secondsLeft = code ? Math.max(0, Math.ceil((code.until - now) / 1000)) : 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Smartphone className="size-4" aria-hidden />
          Use your AI key on your iPhone
        </CardTitle>
        <CardDescription>
          Point your iPhone&apos;s Camera at the code and tap the link. Megan Study opens and
          asks to save the key. It goes straight from this screen to your phone — nothing is
          uploaded.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {code ? (
          <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center">
            {/* eslint-disable-next-line @next/next/no-img-element -- a local data URL */}
            <img
              src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(code.svg)}`}
              alt="QR code that sends your AI key to the iPhone app"
              width={200}
              height={200}
              className="rounded-md border bg-white p-2"
            />
            <div className="space-y-2 text-sm">
              <p>
                Hides in {secondsLeft} second{secondsLeft === 1 ? "" : "s"}. Keep it to
                yourself — anyone who scans it gets your key.
              </p>
              <Button variant="outline" size="sm" onClick={() => setCode(null)}>
                Hide code
              </Button>
            </div>
          </div>
        ) : (
          <Button onClick={() => void show()} disabled={busy}>
            {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
            Send to my iPhone
          </Button>
        )}
        {problem ? <p className="text-muted-foreground text-sm">{problem}</p> : null}
      </CardContent>
    </Card>
  );
}
