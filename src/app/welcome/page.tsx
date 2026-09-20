import { SetupWizard } from "@/components/settings/setup-wizard";
import { LOCAL_MODELS } from "@/lib/llm/catalog";
import { getSetupSnapshot } from "@/lib/settings-actions";

export default async function WelcomePage() {
  const snapshot = await getSetupSnapshot();

  return <SetupWizard snapshot={snapshot} models={LOCAL_MODELS} />;
}
