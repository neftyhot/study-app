/**
 * Update notes, newest first. Add an entry with every version bump: the top
 * one is what the "What's new" banner shows after an update.
 *
 * `notes` is what a student reads, in the app: what they can now do, or what
 * no longer goes wrong for them. Anything only the developer cares about
 * (hardening, refactors, how a fix works) goes in `dev`, which the app never
 * shows; the License Manager's Changelog tab lists both.
 */
export type ChangelogEntry = {
  version: string;
  date: string;
  notes: string[];
  dev?: string[];
};

export const CHANGELOG: ChangelogEntry[] = [
  {
    version: "1.10.0",
    date: "2026-10-22",
    notes: [
      "Sync between devices, free: turn on Settings → Sync between devices → Sync with iCloud Drive, then pick the same \"Megan Study Sync\" folder in the iPhone app. Your decks, cards, stars and progress stay the same on both. Pictures and source files stay on the device that has them.",
      "Send your AI key to your iPhone in one step: Settings → Send to my iPhone shows a code; scan it with the iPhone camera and confirm. The code works for 2 minutes.",
      "iPhone: record lectures. Recording keeps going with the screen off, and the lecture is transcribed into notes you can turn into cards.",
      "iPhone: the course catalog is here too, with the same courses as on your computer.",
      "iPhone flashcards: Ask AI sits under the Missed, Hard and Easy buttons, with arrows below it to go back and forth between cards. The big Undo button is gone (use the back arrow), so it no longer covers your Missed/Hard/Easy tally at the end of a deck.",
      "iPhone practice exams: the answer you pick is now clearly highlighted.",
      "iPhone: delete a deck from the bottom of its page (Delete this deck, in red).",
      "iPhone: share a deck to the catalog from its page (Share to the catalog), or with Share one of your decks at the top of the catalog.",
      "iPhone tutor: answers show proper headings, bold text and lists instead of ** and ## symbols, and the Make cards from this button no longer covers the suggested questions.",
    ],
    dev: [
      "Folder sync (packages/core/src/sync/folder-sync.ts): each device writes only <deviceId>.json and merges the others; newest updated_at wins; deletes are tombstones kept by migration 0033 triggers (180-day lifetime); image/slide/source-file columns never leave the device. Mac uses ~/Library/Mobile Documents/com~apple~CloudDocs/Megan Study Sync (electron/sync-folder.cjs); iOS uses a user-picked folder held as a security-scoped bookmark (SyncFolderPlugin.swift). No server, no iCloud entitlements.",
      "Key hand-off (packages/core/src/share/key-link.ts): a megan-study:// link with an expiry, shown as a QR code; the iPhone app saves the key only after a confirm.",
      "iOS LectureRecorderPlugin uses the audio background mode so recording survives screen lock; plugins register in MeganBridgeViewController.",
    ],
  },
  {
    version: "1.9.0",
    date: "2026-10-22",
    notes: [
      "Try the sample deck: a ready-made deck to study straight away, with no API key needed.",
      "Share a deck with a friend: open a deck's ••• menu and choose Share deck (.meganstudy file). They double-click the file to open it in Megan Study.",
      "Read aloud: press R, or the Read aloud button, to hear a card.",
      "Scan notes: make cards from photos of your handwritten or printed notes.",
      "Daily reminders: turn them on in Settings to get one notification a day with how many cards are due.",
      "An easier-to-read font option in Settings → Appearance → Font.",
      "Math help on cards with numbers, combining the numbers panel and the calculator. Other cards keep a Calculator button.",
      "A tidier Settings page and deck page. Less-used options are under Advanced or the deck's Customize button. Nothing was removed.",
      "Your library is backed up automatically before every update.",
      "Flashcards count correctly: the card number, the total at the top and the Missed/Hard/Easy counts all agree, and going back to change a card's answer moves it to the new count instead of counting it twice.",
      "Pressing No clue again on the same card no longer makes it come back several times in a row. Sessions that already had a card piled up are tidied when you open them.",
      "Fewer repeated cards: new decks drop a card when another card already asks the same thing and says at least as much. To clean up a deck you already have, open its ••• menu and choose Remove repeated cards. Cards you edited yourself are never removed, and stars and progress move to the card that stays.",
      "On a Mac, the app no longer asks for your keychain password when it opens. Because of this, an API key saved before this update has to be entered again once in Settings.",
    ],
    dev: [
      "Sessions store each card's grade (study_sessions.card_grades, migration 0030); recordSessionGrade moves a regraded card between counters. The deck's \"Card X of Y\" counts unique cards, not queue slots.",
      "skipUnknownCard requeues a card REQUEUE_GAP (5) ahead at most once; collapseRequeues/repairSessionQueue collapse old back-to-back duplicates on load (getOpenStudySession).",
      "New src/lib/cards/repeats.ts: coverage-based repeat detection (answer containment ≥ 0.8, question containment ≥ 0.6, contrast-word guard for opposite cases). Generation runs removeRepeats on the cards it just wrote only; the ••• menu runs it on the whole deck. Prompt gained a completeness rule against restating a card.",
      "macOS: no Keychain access. Chromium uses the mock keychain, the cookie-encryption fuse is off, and API keys use a local AES-GCM cipher (enc:v2:, electron/local-cipher.cjs) with its key file beside the database. Windows keeps DPAPI via safeStorage. Old Keychain-encrypted values report needsReentry and Settings shows a notice.",
      "Retired Google sign-in no longer reads its refresh token from the Keychain on macOS at startup.",
    ],
  },
  {
    version: "1.8.0",
    date: "2026-10-04",
    notes: [
      "Decks you type in yourself can be studied: the deck page now shows Study, Learn and Practice Exam for them, with no file upload needed.",
      "Add a card anywhere in a deck: every card in the flashcard list has an \"Add a card here\" button under it, and Add cards lets you pick where a whole batch goes.",
      "Import from Quizlet: on Quizlet choose Export and Copy text, then paste it into Import from Quizlet when creating a deck or adding cards.",
      "The flashcard list has a Learn these button next to Study these.",
    ],
  },
  {
    version: "1.7.2",
    date: "2026-10-04",
    notes: [
      "Fixed: slideshows and other files over 10 MB failed to upload with a JSON error. Files of any size up to 500 MB upload now, and if one does fail you get a message saying why.",
      "Practice exams: retake just the questions you missed, look back at past papers, and review every question in full.",
      "Practice exams: answer with the 1-4 or A-D keys, move with the arrow keys, jump to the next unanswered question, and get a check before handing in blank answers.",
      "Practice exams have the calculator, better wrong options with no reworded duplicates, and a Rewrite options button.",
      "Switch flashcard style right on the study and card list pages.",
    ],
    dev: [
      "Security: navigation kept in-app, safe links and images, pinned updates, permission and IPC checks, zip and upload limits.",
      "next and eslint-config-next upgraded to 16.3.8 (GHSA-vcvr-r3jv-pc5j).",
      "Uploads: proxy body limit raised, one file per request.",
      "Release workflow can build chosen platforms.",
    ],
  },
  {
    version: "1.7.1",
    date: "2026-09-30",
    notes: [
      "The Calculator button is on every card now, in Flashcards, Learn and the study guide, not just on cards with numbers.",
      "Learn has the Numbers button too, listing the numbers a question gives (never the answer).",
      "Drag the calculator anywhere by its title bar. It remembers where you put it.",
      "The Numbers list keeps each number right next to what it is, instead of across the screen.",
    ],
    dev: [
      "Packaged app hardened: Electron fuses, asar, per-launch server secret.",
      "Worker: per-network rate limits on license lookup, telemetry, feedback, catalog reports and edits.",
      "Trials can't start in the future; license confirmations dated in the future aren't trusted.",
    ],
  },
  {
    version: "1.7.0",
    date: "2026-09-30",
    notes: [
      "Three flashcard formats: Classic (the one you had), Flip card (turns over in the middle of the page) and Swipe stack (swipe right if you knew it, left if you missed it). Choose one in Settings or when you start a deck, with a preview to try first.",
      "Cards with numbers get a Calculations box once you show the answer, with every step of the working, and a calculator you can use with your keyboard.",
      "A new Numbers button lists every number in a question with what it is, on flashcards and in the study guide, so you can work the problem forward. Press a number to put it in the calculator.",
      "New cards and study guides keep every number and every step of the working, so you no longer need to remember the example from class to solve them.",
      "Sharing a deck to the catalog now runs the content check on your own Gemini, Claude or OpenAI key. It uses one short request, and the key is never stored. The privacy policy is updated to explain this, so you'll be asked to agree to it again.",
    ],
    dev: ["Security improvements to the desktop app."],
  },
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
      "Your key is sent only to Google and is stored encrypted on your computer.",
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
      "Your API keys are now stored encrypted on your computer.",
      "The app keeps a daily copy of your database for the last week, and backs up before any update changes it.",
      "If the app crashes, the details go to a log file on your computer (Settings › Advanced) that you can send with a bug report. Nothing is sent automatically.",
      "Settings › Advanced can delete your usage statistics from the developer's server.",
      "A bought license now needs to go online once every 45 days to stay confirmed. Offline for longer, just connect and press “Check again”; nothing is lost.",
      "Downloads for Intel Macs and Windows on ARM.",
    ],
  },
  {
    version: "1.2.0",
    date: "2026-09-26",
    notes: [
      "Buy a license right from the welcome screen, or choose the free 7-day trial. The screen now says plainly which is which.",
      "Cleaner topics: the same topic spelled two ways is now merged into one, and tiny or repeated topics are folded into real sections. On an older deck, press “Combine topics” on the Practice Exam screen.",
      "Learn by Topic: choose how many concepts each round covers, from 1 to 50, instead of at most 8.",
      "Settings › Advanced shows your license key's short id, the same one the developer's records use.",
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
      "Export, reset and other deck tools moved into the ••• menu, and license details into Settings › Advanced.",
      "Clearer wording throughout, like “Explain Answer” and “Show Counter-Example”, with hints on hover.",
    ],
  },
  {
    version: "0.2.4",
    date: "2026-09-24",
    notes: [
      "Revoked license keys now stop working: the app checks at launch and every few hours, and shows the activation screen if a key has been revoked. Your decks and cards are kept.",
      "Checking for revocation never locks you out when you're offline.",
    ],
  },
  {
    version: "0.2.3",
    date: "2026-09-24",
    notes: [
      "Study plans pace themselves: pick your exam date and the days you'll study, and the plan works out how long each study day needs. Days off are respected, and if the deck won't fit it suggests what to skip.",
      "Buying a license opens checkout right from the app.",
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
      "New styles: Bubble, Midnight and Sepia, plus your own colors, rounded corners, text size, font and page width (Settings → Appearance). Text always stays readable.",
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
