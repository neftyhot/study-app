import Link from "next/link";

import { ApiKeyForm } from "@/components/settings/api-key-form";
import { db } from "@/db";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { geminiKeyStatus } from "@/lib/settings";
import { resolveDbPath } from "@/db/client";
import { uploadsRoot } from "@/lib/ingest/storage";

export default async function SettingsPage() {
  const status = geminiKeyStatus(db);

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <Link
          href="/"
          className="text-muted-foreground hover:text-foreground text-sm"
        >
          ← Subjects
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
      </div>

      <ApiKeyForm initial={status} />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Where your data lives</CardTitle>
          <CardDescription className="space-y-1">
            <span className="block break-all font-mono text-xs">
              {resolveDbPath()}
            </span>
            <span className="block break-all font-mono text-xs">
              {uploadsRoot()}
            </span>
            <span className="block pt-2">
              Everything stays on this machine. Export a deck from its settings
              card to take a copy elsewhere.
            </span>
          </CardDescription>
        </CardHeader>
      </Card>
    </div>
  );
}
