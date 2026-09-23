import Link from "next/link";

import { AppearanceSettings } from "@/components/settings/appearance-settings";
import { FeedbackCard } from "@/components/settings/feedback-card";
import { StatsCard } from "@/components/settings/stats-card";
import { APP_VERSION } from "@/lib/app-info";
import { CHANGELOG } from "@/lib/changelog";
import { loadStats } from "@/lib/stats";
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
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          Settings
          <Badge variant="outline" className="font-normal">
            v{APP_VERSION}
          </Badge>
        </h1>
      </div>

      <StatsCard stats={loadStats(db)} />

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

      <FeedbackCard />

      <Card id="whats-new" className="scroll-mt-20">
        <CardHeader>
          <CardTitle className="text-base">What&apos;s new</CardTitle>
          <CardDescription>You&apos;re on version {APP_VERSION}.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {CHANGELOG.map((entry) => (
            <section key={entry.version} className="space-y-1">
              <h3 className="flex items-center gap-2 text-sm font-medium">
                v{entry.version}
                <span className="text-muted-foreground text-xs font-normal">
                  {entry.date}
                </span>
              </h3>
              <ul className="text-muted-foreground list-disc space-y-0.5 pl-5 text-sm">
                {entry.notes.map((note) => (
                  <li key={note}>{note}</li>
                ))}
              </ul>
            </section>
          ))}
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
