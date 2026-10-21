"use client";

/**
 * Settings → Reminders. A daily notification with how many cards are due,
 * and "open at login" so the app is running to send it. Both start off.
 */
import { useEffect, useState } from "react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { LoginItemState } from "@/main/auth/ipc";
import { toast } from "@/lib/notify";
import type { Reminders } from "@/lib/reminders/reminders";
import { saveRemindersAction } from "@/lib/settings-actions";

export function ReminderSettings({ initial }: { initial: Reminders }) {
  const [reminders, setReminders] = useState(initial);
  const [login, setLogin] = useState<LoginItemState | null>(null);

  useEffect(() => {
    window.studyApp?.reminders?.loginItem().then(setLogin, () => setLogin(null));
  }, []);

  async function save(next: Reminders) {
    const previous = reminders;
    setReminders(next);
    try {
      setReminders(await saveRemindersAction(next));
    } catch {
      setReminders(previous);
      toast.error("Could not save that.");
    }
  }

  async function setOpenAtLogin(open: boolean) {
    const result = await window.studyApp?.reminders?.setLoginItem(open);
    if (result) setLogin(result);
    else toast.error("Could not change that.");
  }

  return (
    <Card id="reminders" className="scroll-mt-20">
      <CardHeader>
        <CardTitle className="text-base">Reminders</CardTitle>
        <CardDescription>
          One notification a day saying how many cards are due. It shows a
          number only, never what&apos;s on your cards. Megan Study has to be
          open to send it.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <Checkbox
            id="settings-reminders"
            checked={reminders.enabled}
            onCheckedChange={(checked) => save({ ...reminders, enabled: checked === true })}
          />
          <Label htmlFor="settings-reminders" className="text-sm font-normal">
            Remind me when cards are due
          </Label>
          <Input
            type="time"
            aria-label="Reminder time"
            className="w-32"
            value={reminders.time}
            disabled={!reminders.enabled}
            onChange={(event) => {
              if (event.target.value) save({ ...reminders, time: event.target.value });
            }}
          />
        </div>
        {login?.supported ? (
          <div className="flex items-center gap-3">
            <Checkbox
              id="settings-open-at-login"
              checked={login.openAtLogin}
              onCheckedChange={(checked) => setOpenAtLogin(checked === true)}
            />
            <Label htmlFor="settings-open-at-login" className="text-sm font-normal">
              Open Megan Study when I log in
            </Label>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
