import Link from "next/link";

import { ProviderSettings } from "@/components/settings/provider-settings";
import { resolveDbPath } from "@/db/client";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { uploadsRoot } from "@/lib/ingest/storage";
import { LOCAL_MODELS } from "@/lib/llm/catalog";
import { modelsRoot } from "@/lib/llm/download";
import { getSetupSnapshot } from "@/lib/settings-actions";

export default async function SettingsPage() {
  const snapshot = await getSetupSnapshot();

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

      <ProviderSettings snapshot={snapshot} models={LOCAL_MODELS} />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Where your data lives</CardTitle>
          <CardDescription className="space-y-1">
            {[resolveDbPath(), uploadsRoot(), modelsRoot()].map((path) => (
              <span key={path} className="block break-all font-mono text-xs">
                {path}
              </span>
            ))}
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
