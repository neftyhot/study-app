/**
 * Start-up: open the database and bring it up to the desktop's schema, apply
 * the student's theme before the first paint, then hand over to the app.
 */
import { SplashScreen } from "@capacitor/splash-screen";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import migrations from "virtual:migrations";

import { App } from "./app";
import { prepareDatabase } from "./data/db";
import { rescheduleReminders } from "./data/reminders";
import { ensureSampleDeck } from "./data/sample";
import { createAiClient } from "./platform/ai";
import { createPlatform } from "./platform";
import { markStarted } from "./platform/updates";
import { launchUrl } from "./share-intake";
import { applyTheme, followSystem, readAppearance, readTheme } from "./theme";

import "virtual:theme.css";
import "./styles.css";

async function start() {
  const root = createRoot(document.getElementById("root")!);
  try {
    const platform = await createPlatform();
    const db = platform.storage;
    await prepareDatabase(db, migrations);
    await ensureSampleDeck(db);

    let look = { theme: await readTheme(db), appearance: await readAppearance(db) };
    applyTheme(look.theme, look.appearance);
    followSystem(() => look);
    window.addEventListener("megan:appearance", (event) => {
      look = (event as CustomEvent<typeof look>).detail;
      applyTheme(look.theme, look.appearance);
    });

    const [ai, pending] = await Promise.all([createAiClient(platform.secrets), launchUrl()]);
    // Reminders are planned ahead from what is due; a failure here must not stop the app.
    void rescheduleReminders(db, platform.notifications).catch(() => undefined);

    root.render(
      <StrictMode>
        <App platform={platform} initialAi={ai} pendingImport={pending} />
      </StrictMode>,
    );
    // This version started: an in-app update that never gets here is rolled back.
    void markStarted();
  } catch (error) {
    root.render(
      <div className="fatal" role="alert">
        <h1>Megan Study could not start</h1>
        <p>{error instanceof Error ? error.message : String(error)}</p>
        <p>Your cards are safe. Close the app fully and open it again.</p>
      </div>,
    );
    document.documentElement.removeAttribute("data-splash");
  } finally {
    void SplashScreen.hide().catch(() => undefined);
  }
}

void start();
