/**
 * Update notes, newest first. Add an entry with every version bump: the top
 * one is what the "What's new" banner shows after an update.
 */
export type ChangelogEntry = { version: string; date: string; notes: string[] };

export const CHANGELOG: ChangelogEntry[] = [
  {
    version: "1.6.0",
    date: "2026-09-30",
    notes: [
      "New deck catalog (the library button in the header): browse decks other students have shared, filtered by college, professor, course and exam type, and add any of them to your own decks in one click. You pick your college the first time you open it and can change it any time.",
      "Sharing is optional: share one of your own decks and only its cards and study guide go up, never your slides or files. You can edit or remove your listings whenever you like.",
      "Shared decks are checked automatically for inappropriate content before they're listed, and you can report a deck that slipped through. Sharing is rate-limited to keep the catalog clean.",
      "The privacy policy has a new section on the catalog, so you'll be asked to agree to it again.",
    ],
  },
  {
    version: "1.5.1",
    date: "2026-09-29",
    notes: [
      "Delete a deck from the home page: press the bin next to its edit button. You're shown exactly what goes with it (files, cards, study guide and progress) before anything is removed.",
      "Learn keeps going after the last round: it starts again from the top of the deck, so you can keep practising for as long as you like.",
      "The tutor no longer spins for minutes when the AI service is slow. It gives up after 90 seconds and tells you to ask again, and New chat works even while an answer is on its way.",
      "Making cards on a free Gemini key is more reliable: when Google asks the app to slow down, it waits as long as Google says instead of giving up on part of the deck, so a big deck no longer comes out with far fewer cards than usual.",
    ],
  },
  {
    version: "1.5.0",
    date: "2026-09-29",
    notes: [
      "Change a study guide's format after it's written: press “Change format” at the top of the guide. The new version sits next to the old one, so you can switch between them.",
      "If something goes wrong with the service, Megan Study can now switch AI features off for a while and tell you why, instead of failing on every try. Your courses, flashcards, study guides and exams always stay open to study.",
      "The privacy policy is easier to read, with a short summary and numbered sections, and explains the new service status check. You'll be asked to agree to it again.",
    ],
  },
  {
    version: "1.4.0",
    date: "2026-09-29",
    notes: [
      "Study guides come in four formats: Explained (the one you had), Key facts (bullet points of what you need to know), Q&A self-test (questions with the answer hidden until you check) and Compare & contrast (each idea next to the ones it gets confused with).",
      "Study guides are shorter and easier to face. Summary keeps up to 5 points per topic, Balanced up to 10 and First Principles up to 25, keeping the most important ones instead of adding more topics.",
      "Before writing a guide you see a preview of each format and length, on a made-up example topic so you can tell what it will look like.",
      "Choose whether every concept gets an example up front. You can still add one to any concept afterwards with “Show an example”.",
      "Examples are more specific: real numbers and the working for subjects like accounting, and named cases for everything else.",
      "You can keep several versions of a guide, like a Summary in Key facts and a Balanced one explained, and switch between them at the top of the page.",
      "Fixed updates and AI features failing with “fetch failed” on some school and work Wi-Fi networks.",
    ],
  },
  {
    version: "1.3.2",
    date: "2026-09-29",
    notes: [
      "Learn now has two modes. Long-term spreads reviews out over days and weeks, like Anki, so it sticks for the final. Cram is for an exam in a day or two: cards come back sooner, anything you miss gets an extra check, and every card is due again tomorrow.",
      "Start Learn at any card: press “Start at a specific card”, scroll through the deck and pick where to begin.",
      "Learn stays on the deck page as long as there are cards you haven't learned, instead of disappearing once the day's new cards were done.",
      "Multiple-choice answers in Learn are shown in full (“DNA polymerase III”, not “III”), with similar options such as the other polymerases to choose between.",
      "The tutor answers much faster. It reads the parts of your deck that matter for the question rather than the whole deck every time, and if your key hits Google's rate limit it tells you straight away instead of waiting and retrying.",
    ],
  },
  {
    version: "1.3.1",
    date: "2026-09-28",
    notes: [
      "Gemini now runs on your own free Google AI Studio key. “Sign in with Google” has been removed, and any saved sign-in is deleted and revoked when the app starts. If you used it, the dashboard asks you to add a key: Settings walks you through getting one in about a minute and checks it with Google before saving.",
      "Your key is sent only to Google and stays encrypted with your computer's keychain.",
      "The upgrade guide now gives Gemini Pro prices per token, which is how Google bills.",
    ],
  },
  {
    version: "1.3.0",
    date: "2026-09-27",
    notes: [
      "PowerPoint slides now show as they really look. The app draws them itself, so you don't need PowerPoint, and it never asks for permission or for a folder.",
      "Dropping files on the dashboard now opens a setup page: choose how many cards you want and which files to build from before anything is generated. The deck page has a Sources button to add or remove files later.",
      "Ask a tutor opens in a roomier side panel. It reads your whole deck, and follow-up questions stay in the same conversation.",
      "Tutor chats are saved on your computer. Open one from “Past chats” and keep going; the tutor sees the earlier conversation.",
      "Ask the tutor about “flashcard 32” and it answers about that exact card. Card numbers are shown in the deck list.",
      "Fixed the tutor's first question sometimes failing.",
      "Settings has a model choice: Standard, or a stronger Thinking model. When you hit a usage limit, a guide walks you through adding billing on your AI provider's own site, step by step. If a model is busy or out of quota, the app switches to a backup model automatically.",
      "Study guide: each concept has an “Another example” button, and up to five extra examples are saved.",
      "Making flashcards or a study guide now skips announcements, due dates and syllabus details. Untick “Ignore announcements and syllabus info” to include them.",
      "Learn: press Enter to check your answer. Typing the multiple-choice answer word for word now counts as correct. After each answer you can open the original slide or ask a question about the card.",
      "Choose how strictly a practice test is marked just before it's written.",
      "AI features now use Gemini Flash instead of Flash-Lite, for better cards and answers.",
      "“Show original slide” opens the whole slideshow or PDF at the slide a card came from, and you can scroll through the rest. Lecture transcripts open at the right spot too, with the passage highlighted.",
      "New themes: Blossom and Rosewood in pink, Lavender and Plum in purple. A few look-alike themes were folded together; if you used one, you get the closest match.",
      "The Quizlet export's copy-and-paste box no longer runs off the screen.",
      "Your API keys are now encrypted with your computer's keychain.",
      "The app keeps a daily copy of your database for the last week, and backs up before any update changes it.",
      "If the app crashes, the details go to a log file on your computer (Settings › Advanced) that you can send with a bug report. Nothing is sent automatically.",
      "Settings › Advanced can delete your usage statistics from the developer's server.",
      "A bought licence now needs to go online once every 45 days to stay confirmed. Offline for longer, just connect and press “Check again”; nothing is lost.",
      "Downloads for Intel Macs and Windows on ARM.",
    ],
  },
  {
    version: "1.2.0",
    date: "2026-09-26",
    notes: [
      "Buy a licence right from the welcome screen, or choose the free 7-day trial. The screen now says plainly which is which.",
      "Cleaner topics: the same topic spelled two ways is now merged into one, and tiny or repeated topics are folded into real sections. On an older deck, press “Combine topics” on the Practice Exam screen.",
      "Learn by Topic: choose how many concepts each round covers, from 1 to 50, instead of at most 8.",
      "Settings › Advanced shows your licence key's short id, the same one the developer's records use.",
    ],
  },
  {
    version: "1.1.0",
    date: "2026-09-26",
    notes: [
      "The Study Guide is rewritten as a proper document: an overview, then numbered topics in the order to learn them, foundations first, with a contents list to jump around.",
      "It now covers your whole lecture. Slides are explained a few at a time, and any slide left out gets a second pass, so no topic is skipped, even on long decks.",
      "Each concept reads like a textbook entry: what it is, how it works, and an example, with every sentence linked back to its slide.",
      "Writing a guide shows its progress, and keeps going if you look around.",
      "Flashcards are one click away: flip through every card from the deck page or the Study Guide, or see them all as a list.",
    ],
  },
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
