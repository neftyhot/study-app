import { WelcomeIntro } from "@/components/layout/launch-splash";
import { SetupWizard } from "@/components/settings/setup-wizard";
import { db } from "@/db";
import { isSource, readSource, recordSource } from "@/lib/funnel";
import { LOCAL_MODELS } from "@/lib/llm/catalog";
import { getSetupSnapshot } from "@/lib/settings-actions";

export default async function WelcomePage({ searchParams }: PageProps<"/welcome">) {
  const snapshot = await getSetupSnapshot();
  // A download link can say where the student came from (?src=poster); only
  // the fixed list is kept, and the first answer stands.
  const src = (await searchParams).src;
  if (isSource(src)) recordSource(db, src);

  return (
    <WelcomeIntro tagline="Turn your notes into flashcards, practice exams, and study guides.">
      <SetupWizard snapshot={snapshot} models={LOCAL_MODELS} source={readSource(db)} />
    </WelcomeIntro>
  );
}
