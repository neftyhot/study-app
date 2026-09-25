/**
 * The privacy policy, shown on first launch (it must be accepted before the
 * app can be used) and kept readable in Settings.
 *
 * Plain data so the client can render it. Bump the version whenever what the
 * app collects changes: everyone is asked to agree again.
 */
export const PRIVACY_POLICY_VERSION = "2026-09-24";

export const PRIVACY_POLICY_UPDATED = "September 24, 2026";

export type PolicySection = { heading: string; body: string[] };

export const PRIVACY_POLICY: PolicySection[] = [
  {
    heading: "Your study material stays on this computer",
    body: [
      "Your files, slides, notes, flashcards, questions, answers, grades and API keys are stored in a database on this computer. They are never sent to the developer.",
    ],
  },
  {
    heading: "Usage statistics are required",
    body: [
      "To use Megan Study you agree that it sends usage statistics to the developer. This cannot be turned off. The statistics are what keep the app working and paid for.",
      "What is sent: how many subjects, decks and cards you have; how many cards you have reviewed; how long the app has been open (focused and in the background); which features called an AI model, with the provider, model name, number of calls, token counts and estimated cost; the app version; and your operating system and processor type.",
      "It is sent under a random install id created on this computer. It does not include your name, email, licence key or machine id.",
      "It never includes the content of your files, cards, questions, answers or notes, or your API keys.",
      "When it is sent: every 15 minutes while the app is open, and about a minute after your number of subjects, decks or cards changes. Each report replaces the previous one, so the developer keeps only your latest totals.",
    ],
  },
  {
    heading: "AI providers you choose",
    body: [
      "Generating cards and grading typed answers sends the relevant material to the AI provider you pick in Settings (Google Gemini, Anthropic or OpenAI), using your own key or account and under that provider's terms. If you use a local model, nothing leaves this computer for that.",
    ],
  },
  {
    heading: "Licence, updates and feedback",
    body: [
      "Checking or buying a licence sends your licence key and this computer's machine id to the licensing server.",
      "The app checks GitHub for new versions.",
      "A suggestion you send from Settings goes to the developer with the app version, plus any contact details you choose to add.",
    ],
  },
  {
    heading: "Your choices",
    body: [
      "To have your statistics deleted, send a suggestion from Settings that includes your install id (shown under Privacy in Settings). If you don't agree to this policy, don't use Megan Study: close it and uninstall it.",
      "If this policy changes, the app will ask you to agree again before you can keep using it.",
    ],
  },
];
