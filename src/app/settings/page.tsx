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
import { PrivacyPolicyText } from "@/components/privacy/privacy-policy";
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
import { installId } from "@/lib/telemetry";
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

      {license?.type === "trial" ? (
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

      <Card id="privacy" className="scroll-mt-20">
        <CardHeader>
          <CardTitle className="text-base">Privacy</CardTitle>
          <CardDescription>
            Your cards, files and answers stay on this computer. Usage
            statistics (counts, time in the app and AI usage — never content)
            are sent to the developer every 15 minutes; this is required to use
            Megan Study.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <details className="group rounded-lg border p-4">
            <summary className="cursor-pointer text-sm font-medium">
              Read the full privacy policy
            </summary>
            <div className="mt-4">
              <PrivacyPolicyText />
            </div>
          </details>
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
        <CardContent>
          <details className="group">
            <summary className="cursor-pointer text-sm font-medium">
              Advanced
            </summary>
            <dl className="mt-4 space-y-4 text-sm">
              {license ? (
                <div className="space-y-1">
                  <dt className="font-medium">Licence</dt>
                  <dd className="text-muted-foreground">
                    {TIER_LABELS[license.type]} · {expiryLabel(license)}
                    {license.name ? ` · Issued to ${license.name}` : ""}
                  </dd>
                </div>
              ) : null}
              <div className="space-y-1">
                <dt className="font-medium">Install id</dt>
                <dd>
                  <code className="bg-muted rounded px-1.5 py-0.5 font-mono text-xs select-all">
                    {installId(db)}
                  </code>
                </dd>
              </div>
              <div className="space-y-1">
                <dt className="font-medium">Where your data lives</dt>
                <dd className="text-muted-foreground space-y-1">
                  {[resolveDbPath(), uploadsRoot(), modelsRoot()].map((path) => (
                    <span key={path} className="block font-mono text-xs break-all">
                      {path}
                    </span>
                  ))}
                  <span className="block pt-1">
                    Everything stays on this computer. Use “Export” in a
                    deck&apos;s ••• menu to take a copy elsewhere.
                  </span>
                </dd>
              </div>
            </dl>
          </details>
        </CardContent>
      </Card>
    </div>
  );
}
