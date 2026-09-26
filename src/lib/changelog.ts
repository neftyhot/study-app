/**
 * Update notes, newest first. Add an entry with every version bump: the top
 * one is what the "What's new" banner shows after an update.
 */
export type ChangelogEntry = { version: string; date: string; notes: string[] };

export const CHANGELOG: ChangelogEntry[] = [
  {
    version: "1.0.0",
    date: "2026-09-26",
    notes: [
      "Megan Study 1.0, for Mac and Windows.",
      "A simpler home screen: drag in your lecture slides (and study guide, if you have one) and press “Generate Study Set”.",
      "Every deck now follows one path: read the Study Guide, practise with Flashcards, then take a Practice Exam.",
      "Flashcards follow the order your course taught them, slide by slide.",
      "Export, reset and other deck tools moved into the ••• menu, and licence details into Settings › Advanced.",
      "Clearer wording throughout, like “Explain Answer” and “Show Counter-Example”, with hints on hover.",
    ],
  },
  {
    version: "0.2.4",
    date: "2026-09-24",
    notes: [
      "Revoked licence keys now stop working: the app checks at launch and every few hours, and shows the activation screen if a key has been revoked. Your decks and cards are kept.",
      "Checking for revocation never locks you out when you're offline.",
    ],
  },
  {
    version: "0.2.3",
    date: "2026-09-24",
    notes: [
      "Study plans pace themselves: pick your exam date and the days you'll study, and the plan works out how long each study day needs. Days off are respected, and if the deck won't fit it suggests what to skip.",
      "Buying a licence opens checkout right from the app.",
      "An updated privacy policy: sharing usage statistics is now required, and you'll be asked to agree once before continuing. Your study material still never leaves this computer.",
    ],
  },
  {
    version: "0.2.2",
    date: "2026-09-23",
    notes: [
      "Lecture transcripts and long notes now get plenty of cards: long stretches of text are split into slide-sized sections instead of counting as one.",
      "Already added a transcript? Press “Re-split” next to it on the Sources page, then generate again.",
      "Signing in with Google now checks that Gemini permission was granted, and tells you how to fix it if not (tick every box on Google's screen).",
    ],
  },
  {
    version: "0.2.1",
    date: "2026-09-23",
    notes: [
      "Updates now install from inside the app: click “Update” in the header and it restarts on the new version — no download to open, and no “damaged app” warning.",
      "Clearer wording on what “Share usage statistics” sends, if you turn it on.",
    ],
  },
  {
    version: "0.2.0",
    date: "2026-09-23",
    notes: [
      "New styles: Bubble, Midnight and Sepia, plus your own colours, rounded corners, text size, font and page width (Settings → Appearance). Text always stays readable.",
      "Practice exams are picked by source file and page range, with a few broad topics under each file instead of dozens of one-card ones.",
      "Multiple-choice answers are now spread evenly across A–D.",
      "Type in a whole deck, Quizlet-style — or add a batch of cards to one. Simple mode is just front and back.",
      "Edit subjects, decks, file names and cards from wherever you see them.",
      "Your stats, feature suggestions and these update notes in Settings.",
    ],
  },
  {
    version: "0.1.1",
    date: "2026-09-21",
    notes: ["Purchases unlock the app automatically.", "Fixes for first launch on a new Mac."],
  },
];
