import Link from "next/link";

import { AppearanceSettings } from "@/components/settings/appearance-settings";
import { GradingSettings } from "@/components/settings/grading-settings";
import { ProviderSettings } from "@/components/settings/provider-settings";
import { PurchaseLicense } from "@/components/settings/purchase-license";
import { UsageLoggingToggle } from "@/components/settings/usage-logging";
import { resolveDbPath } from "@/db/client";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { uploadsRoot } from "@/lib/ingest/storage";
import { LOCAL_MODELS } from "@/lib/llm/catalog";
import { modelsRoot } from "@/lib/llm/download";
import { expiryLabel, readLicenseStatus, TIER_LABELS } from "@/lib/license/status";
import { readAppearance, readGradingStrictness } from "@/lib/settings";
import { db } from "@/db";
import { getSetupSnapshot } from "@/lib/settings-actions";

export default async function SettingsPage() {
  const snapshot = await getSetupSnapshot();
  const license = readLicenseStatus();

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

      {license ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex flex-wrap items-center gap-2 text-base">
              Licence
              <Badge variant="secondary">{TIER_LABELS[license.type]}</Badge>
              <Badge variant="outline">{expiryLabel(license)}</Badge>
            </CardTitle>
            <CardDescription>
              {license.type === "trial" && license.expiresAt
                ? `Everything works until ${new Date(license.expiresAt).toLocaleDateString()}. After that, a one-time purchase keeps it going — nothing you made is lost either way.`
                : null}
              {license.type !== "trial" && license.name
                ? `Issued to ${license.name}. `
                : ""}
              {license.type === "trial"
                ? null
                : license.expiresAt
                  ? `Valid until ${new Date(license.expiresAt).toLocaleDateString()}.`
                  : "This licence has no end date."}
            </CardDescription>
            {license.type === "trial" ? <PurchaseLicense /> : null}
          </CardHeader>
        </Card>
      ) : null}

      <AppearanceSettings initial={readAppearance(db)} />

      <ProviderSettings snapshot={snapshot} models={LOCAL_MODELS} />

      <GradingSettings initial={readGradingStrictness()} />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Usage statistics</CardTitle>
        </CardHeader>
        <CardContent>
          <UsageLoggingToggle initial={snapshot.usageLogging} />
        </CardContent>
      </Card>

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
