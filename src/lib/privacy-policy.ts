/**
 * The privacy policy, shown on first launch (it must be accepted before the
 * app can be used) and kept readable in Settings.
 *
 * Plain data so the client can render it. Bump the version whenever what the
 * app collects changes: everyone is asked to agree again.
 */
export const PRIVACY_POLICY_VERSION = "2026-09-30";

export const PRIVACY_POLICY_UPDATED = "September 30, 2026";

/** One point in a list; `label` is shown in bold before the text. */
export type PolicyItem = { label?: string; text: string };

/** A numbered section: an opening paragraph, a list, then any closing paragraphs. */
export type PolicySection = {
  heading: string;
  intro?: string;
  items?: PolicyItem[];
  outro?: string[];
};

/** The short version, shown above the full policy. */
export const PRIVACY_POLICY_SUMMARY: string[] = [
  "Your study material and API keys stay on this computer.",
  "Usage statistics (counts, time and AI costs, never your content) are sent to the developer, and this can't be turned off.",
  "AI features send the material they need to the AI provider you choose.",
  "Sharing a deck to the catalog is optional; a shared deck's cards and study guide are public to other users.",
  "The app checks the developer's server for updates and service status; it can switch AI off during maintenance, but what you've already made always stays usable.",
];

export const PRIVACY_POLICY: PolicySection[] = [
  {
    heading: "Your study material stays on this computer",
    intro:
      "Everything you put into Megan Study, and everything it makes for you, is kept in a database on this computer:",
    items: [
      { text: "your files, slides and notes;" },
      { text: "flashcards, study guides, practice exams, questions, answers and grades;" },
      { text: "your API keys and settings." },
    ],
    outro: [
      "None of it is ever sent to the developer, unless you choose to share a deck to the deck catalog (see below).",
    ],
  },
  {
    heading: "Usage statistics (required)",
    intro:
      "To use Megan Study you agree that it sends usage statistics to the developer. This cannot be turned off: the statistics are what keep the app working and paid for.",
    items: [
      {
        label: "What is sent",
        text: "how many subjects, decks and cards you have; how many cards you have reviewed; how long the app has been open (focused and in the background); which features called an AI model, with the provider, model name, number of calls, token counts and estimated cost; the app version; and your operating system and processor type.",
      },
      {
        label: "Who it's linked to",
        text: "a random install id created on this computer. It does not include your name, email, licence key or machine id.",
      },
      {
        label: "What is never sent",
        text: "the content of your files, cards, questions, answers or notes, or your API keys.",
      },
      {
        label: "When",
        text: "about once an hour while the app is open, and about ten minutes after your number of subjects, decks or cards changes. Each report replaces the previous one, so the developer keeps only your latest totals.",
      },
    ],
  },
  {
    heading: "AI providers you choose",
    items: [
      {
        text: "Making cards and study guides, the tutor, and grading typed answers send the material they need to the AI provider you pick in Settings (Google Gemini, Anthropic or OpenAI), using your own key or account and under that provider's terms.",
      },
      { text: "If you use a local model, nothing leaves this computer for that." },
    ],
  },
  {
    heading: "Service status and maintenance",
    intro:
      "Every few minutes while it is open, the app asks the developer's server whether the service is running normally. The request sends nothing about you or your study material. The answer can:",
    items: [
      {
        label: "Pause AI",
        text: "for everyone, for example during a billing problem or an outage at a provider. A notice explains why.",
      },
      {
        label: "Show a maintenance screen",
        text: "in place of the app. You can choose “Continue to studying” to keep using everything you've already made, with AI features off.",
      },
      {
        label: "Require an update",
        text: "before AI features work again, when an older version has a problem that must be fixed.",
      },
      { label: "Switch off a single feature", text: "while it is being fixed." },
      { label: "Show a message", text: "from the developer, such as planned downtime." },
    ],
    outro: [
      "None of these ever delete or hide your courses, flashcards, study guides or exams. If the app can't reach the server, it carries on with the last answer it received.",
    ],
  },
  {
    heading: "Deck catalog (optional)",
    intro:
      "The catalog lets you browse decks other students have shared and, if you want, share your own. Browsing and adding decks sends only a random install id; your college choice stays on this computer.",
    items: [
      {
        label: "What sharing sends",
        text: "only when you press Share: the deck's title, cards and study guide, the college, professor, course, term and exam type you enter, and your random install id. Slides and files are never shared.",
      },
      {
        label: "Content check",
        text: "before a deck is listed, its text is checked automatically by Google Gemini, run by the developer, to keep inappropriate material out. Decks that fail the check are not listed.",
      },
      {
        label: "Who can see it",
        text: "a shared deck is public to every Megan Study user. You can edit or remove your listings at any time, and the developer can hide listings that are reported.",
      },
    ],
  },
  {
    heading: "Licence, updates and feedback",
    items: [
      {
        label: "Licence",
        text: "checking or buying a licence sends your licence key and this computer's machine id to the licensing server.",
      },
      {
        label: "Updates",
        text: "the app checks for new versions and for current AI model names through the developer's server (or GitHub). These checks send nothing about you.",
      },
      {
        label: "Feedback",
        text: "a suggestion you send from Settings goes to the developer with the app version, plus any contact details you choose to add.",
      },
    ],
  },
  {
    heading: "Your choices",
    items: [
      {
        label: "Delete your statistics",
        text: "press “Delete my statistics from the server” under Advanced in Settings. The app then starts a new install id, so later reports can't be linked to the deleted ones.",
      },
      {
        label: "Don't agree?",
        text: "then don't use Megan Study: close it and uninstall it.",
      },
      {
        label: "Changes",
        text: "if this policy changes, the app asks you to agree again before you can keep using it.",
      },
    ],
  },
];
