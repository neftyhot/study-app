/**
 * The Features tab: everything Megan Study can do, in plain words, with the
 * file each feature lives in so it can be found again.
 *
 * Kept by hand. When a release adds or removes something a student would
 * notice, change it here in the same commit. `status` marks work that is in
 * the repository but not yet released.
 */
const FEATURES = [
  {
    area: "Decks & courses",
    features: [
      { name: "Home dashboard by course", what: "Shows all your decks grouped into course sections, so every class's material is in one place.", where: "src/app/page.tsx" },
      { name: "Create courses and decks", what: "Lets you make a course (subject and term) and the exam decks inside it.", where: "src/components/manage/create-dialogs.tsx" },
      { name: "Edit names and dates", what: "Lets you rename a subject or term, change a deck's name, exam date or subject, and rename uploaded files.", where: "src/components/manage/edit-dialogs.tsx" },
      { name: "Course actions", what: "Lets you manage a whole course section from the home page.", where: "src/components/manage/course-actions.tsx" },
      { name: "Deck switcher", what: "Lets you jump between your decks from the header.", where: "src/components/manage/deck-switcher.tsx" },
      { name: "Deck overview and study path", what: "Shows a deck's files, topics and card count, plus a guided path from Study Guide to Flashcards to Practice Exam.", where: "src/app/exams/[examId]/page.tsx" },
      { name: "Deck ••• menu", what: "Keeps less common deck actions in one menu: files, study-guide check, plan, export, remove repeats, reset and delete.", where: "src/components/manage/deck-actions-menu.tsx" },
      { name: "Delete with impact preview", what: "Before deleting, lists exactly what will be removed (files, cards, topics, sessions), and you can delete straight from home.", where: "src/components/manage/confirm-dialog.tsx" },
      { name: "Reset study progress", what: "Clears review history and due dates for a deck but keeps every card, edit and star.", where: "src/lib/manage/actions.ts" },
      { name: "Remove repeated cards", what: "Finds cards that ask the same thing and keeps the most complete one, moving stars and history over and never touching cards you edited. Also runs after every generation.", where: "src/lib/cards/repeats.ts" },
      { name: "Lecture order", what: "Puts cards and files in the order the lectures were given.", where: "src/lib/order.ts" },
      { name: "Topic grouping and combining", what: "Sorts cards into broad topics per file and lets similar topics be combined.", where: "src/lib/topics/index.ts" },
      { name: "Scope toggle", what: "Switches a deck between focusing on the study guide and covering everything.", where: "src/lib/actions.ts" },
      { name: "Cards you keep missing", what: "Lists the cards you miss most often and explains why, based on what you wrote.", where: "src/app/exams/[examId]/page.tsx" },
    ],
  },
  {
    area: "Importing sources",
    features: [
      { name: "Quick-start drop zone", what: "Drop your files on the home page and a deck is set up for you, with a study guide recognised from its file name.", where: "src/components/ingest/quick-start.tsx" },
      { name: "Upload files to a deck", what: "Adds lecture files to a deck one at a time, up to 500 MB each.", where: "src/components/ingest/upload-panel.tsx" },
      { name: "PDF import", what: "Reads PDF text page by page and flags scanned pages that have no text.", where: "src/lib/ingest/pdf.ts" },
      { name: "PowerPoint import", what: "Reads slides and speaker notes and draws the slides itself, falling back to LibreOffice if needed.", where: "src/lib/ingest/pptx.ts" },
      { name: "Word, RTF, CSV and text import", what: "Also accepts .docx, .rtf, .csv, .txt and Markdown files.", where: "src/lib/ingest/index.ts" },
      { name: "Paste text as a source", what: "Lets you paste text straight into a deck as source material.", where: "src/app/api/exams/[examId]/paste/route.ts" },
      { name: "Study guide parsing", what: "Turns an uploaded study guide into a list of learning objectives that cards and coverage are measured against.", where: "src/lib/ingest/study-guide.ts" },
      { name: "Transcript splitting and Re-split", what: "Splits long lecture transcripts into sections, and lets you re-split and relink them later.", where: "src/components/manage/resplit-button.tsx" },
      { name: "Your files page", what: "Lists a deck's uploaded files with options to rename or manage each one.", where: "src/app/exams/[examId]/sources/page.tsx" },
      { name: "Ignore announcements and syllabus", what: "An optional setting that skips logistics content such as announcements and syllabus info when making cards.", where: "src/lib/logistics.ts" },
      { name: "Safe file limits", what: "Guards against malformed or zip-bomb files during import.", where: "src/lib/ingest/zip-limits.ts" },
    ],
  },
  {
    area: "Card generation",
    features: [
      { name: "Generate cards from files", what: "Uses AI to make flashcards from the files and page ranges you pick.", where: "src/components/generate/generate-panel.tsx" },
      { name: "Pick files and page ranges", what: "Lets you choose exactly which files and pages cards should come from.", where: "src/components/generate/source-range-picker.tsx" },
      { name: "Card density and estimate", what: "Lets you choose how many cards to make and shows an estimate first.", where: "src/components/generate/ingestion-options.tsx" },
      { name: "Background generation with progress", what: "Makes cards in the background with a progress bar so you can keep using the app.", where: "src/lib/generate/jobs.ts" },
      { name: "Source-cited cards", what: "Each card cites its slide and a quote that has to actually appear in your material.", where: "src/lib/generate/validate.ts" },
      { name: "No repeats across runs", what: "New cards that repeat a card already in the deck are dropped, and the run says how many.", where: "src/lib/generate/index.ts" },
      { name: "Explained rejections", what: "Tells you in plain language why some material didn't become cards.", where: "src/lib/generate/rejections.ts" },
      { name: "Application questions", what: "Can add higher-order questions that apply concepts, not just recall them.", where: "src/lib/generate/prompts.ts" },
      { name: "Study-guide objective routing", what: "Links generated cards to the study-guide objectives they cover.", where: "src/lib/generate/routing.ts" },
      { name: "Rate-limit retry", what: "Waits and retries automatically when the AI provider is rate-limiting.", where: "src/lib/generate/retry.ts" },
      { name: "On-demand card detail", what: "Fills in a card's explanation, key points and misconceptions when you ask for them.", where: "src/lib/generate/enrich.ts" },
      { name: "Three card formats", what: "Lets you choose the default card format used for generated cards.", where: "src/components/study/card-formats.tsx" },
    ],
  },
  {
    area: "Writing & editing cards",
    features: [
      { name: "Type in cards yourself", what: "Lets you build a deck by hand, Quizlet-style, in a Simple or Detailed mode with images, stars and topics.", where: "src/components/cards/card-set-editor.tsx" },
      { name: "Add a single card", what: "Lets you write a card by hand, including fill-in-the-blank cloze cards using {{ }}.", where: "src/components/cards/card-builder.tsx" },
      { name: "Quizlet paste import", what: "Turns text copied from a Quizlet set into cards.", where: "src/lib/cards/import.ts" },
      { name: "Inline editing with undo", what: "Edit any card anywhere; changes save themselves and can be undone.", where: "src/components/cards/card-editor.tsx" },
      { name: "Bulk move, copy and delete", what: "Select several cards and move, copy or delete them, with moved cards keeping their history.", where: "src/components/cards/bulk-bar.tsx" },
      { name: "Card list view", what: "Shows every card in a deck as a numbered list in lecture order, grouped by topic.", where: "src/components/search/deck-card-list.tsx" },
      { name: "Star cards", what: "Lets you star cards so you can study just those later.", where: "src/components/study/study-deck.tsx" },
    ],
  },
  {
    area: "Flashcards",
    features: [
      { name: "Flashcard session setup", what: "Lets you study the whole deck, one topic, starred cards or missed cards, shuffled if you like.", where: "src/components/study/study-deck.tsx" },
      { name: "Resume where you left off", what: "Brings you back to the exact card you were on.", where: "src/lib/study/session.ts" },
      { name: "Self-grading with shortcuts", what: "Reveal the answer with Space and grade it Missed, Difficult or Easy with keys 1-3, or press 'I know it' (k).", where: "src/components/study/study-deck.tsx" },
      { name: "No clue requeue", what: "Shows the answer and brings the card back once, five cards later.", where: "src/lib/study/session.ts" },
      { name: "Card styles", what: "Switch between Classic, Flip card and a Swipe stack (right if you knew it, left if you missed).", where: "src/components/study/card-style-switch.tsx" },
      { name: "More detail panel", what: "Shows a card's explanation, must-include points and common misconceptions, and marks anything that came from AI rather than your files.", where: "src/components/cards/detail-toggle.tsx" },
      { name: "Explain this card", what: "Asks the AI to explain a card's answer.", where: "src/components/cards/explain-button.tsx" },
      { name: "Show original slide", what: "Opens the whole source file at the cited page with the passage highlighted.", where: "src/components/sources/source-viewer.tsx" },
      { name: "Spaced repetition schedule", what: "Schedules due reviews so cards come back just before you would forget them.", where: "src/lib/srs/schedule.ts" },
      { name: "Session progress readout", what: "Shows the card number plus counts of missed, difficult and easy cards; grading a card again moves it rather than counting it twice.", where: "src/components/study/study-deck.tsx" },
    ],
  },
  {
    area: "Learn",
    features: [
      { name: "Learn ladder", what: "Takes each concept from recognising it, to recalling it, to recalling it again after a gap.", where: "src/lib/learn/ladder.ts" },
      { name: "Long-term and Cram modes", what: "Lets you choose spaced learning for the long term or a fast cram before the exam.", where: "src/components/learn/learn-mode.tsx" },
      { name: "Round size and filters", what: "Lets you set 1-50 concepts per round and learn the whole deck, a topic, starred cards or missed cards.", where: "src/lib/learn/round-size.ts" },
      { name: "Start at a specific card", what: "Lets you begin Learn from any numbered card.", where: "src/app/exams/[examId]/learn/page.tsx" },
      { name: "Multiple-choice from misconceptions", what: "Builds the wrong answer options from common misconceptions and from other cards' answers.", where: "src/lib/learn/mcq.ts" },
      { name: "Typed answers graded by AI", what: "Checks what you type for meaning, not exact words, and always fails answers that get the direction or mechanism wrong.", where: "src/lib/grade/semantic.ts" },
      { name: "I'm guessing", what: "Lets you mark an answer as a guess so a lucky guess doesn't count as knowing it.", where: "src/components/learn/learn-mode.tsx" },
      { name: "Partial-credit retry", what: "When you're partly right, asks you for just the missing piece.", where: "src/lib/learn/typed.ts" },
      { name: "In-session help", what: "Offers a hint, a simpler explanation, an example, a comparison of concepts or an easier prerequisite.", where: "src/lib/assist/index.ts" },
      { name: "Mistake diagnosis", what: "Spots swapped terms or a missing prerequisite, and flags when the card itself may be the problem.", where: "src/components/learn/learn-mode.tsx" },
      { name: "Override a grade", what: "Lets you mark yourself correct when you disagree, and the ladder moves on.", where: "src/lib/learn/actions.ts" },
      { name: "Learn recycles the deck", what: "Starts the deck again once every concept has had a round.", where: "src/lib/learn/session.ts" },
    ],
  },
  {
    area: "Diagram quizzes",
    features: [
      { name: "Image-occlusion drills", what: "Hides labels on a slide diagram and quizzes you on them.", where: "src/components/diagrams/drill-runner.tsx" },
      { name: "Create diagram drill", what: "Lets you pick a slide and draw the boxes that hide the labels.", where: "src/components/diagrams/occlusion-editor.tsx" },
    ],
  },
  {
    area: "Study guide",
    features: [
      { name: "Write a study guide", what: "Writes a study guide from your material, with a contents list and citations.", where: "src/components/primer/write-primer-button.tsx" },
      { name: "Guide formats and depths", what: "Choose Explained, Key facts, Q&A self-test or Compare & contrast, at Summary, Balanced or First Principles depth, with a preview first.", where: "src/lib/primer/formats.ts" },
      { name: "Change format", what: "Rewrites an existing guide in another format and keeps the earlier versions.", where: "src/components/primer/change-format-dialog.tsx" },
      { name: "Clickable citations", what: "Each cited sentence opens the slide it came from.", where: "src/components/primer/cited-text.tsx" },
      { name: "Another example", what: "Gives up to five fresh worked examples or counter-examples for a section; examples can be turned on or off.", where: "src/components/primer/primer-sections.tsx" },
      { name: "Guide writing progress", what: "Shows progress while the guide is written.", where: "src/lib/primer/runs.ts" },
    ],
  },
  {
    area: "Study-guide check",
    features: [
      { name: "Coverage check", what: "Maps every study-guide objective to your material and cards and shows what isn't covered.", where: "src/components/coverage/coverage-panel.tsx" },
      { name: "Cross-file conflicts", what: "Flags places where two of your files contradict each other.", where: "src/components/coverage/conflict-card.tsx" },
      { name: "Background coverage job", what: "Runs the check in the background with progress.", where: "src/lib/coverage/jobs.ts" },
    ],
  },
  {
    area: "Practice exams",
    features: [
      { name: "Practice exam papers", what: "Builds a multiple-choice paper with reworded questions and mixed topics, and marks nothing until you submit.", where: "src/components/exam/practice-runner.tsx" },
      { name: "Choose sources and strictness", what: "Lets you pick files, page ranges and topics plus a strictness for each paper.", where: "src/app/exams/[examId]/practice/page.tsx" },
      { name: "AI-written distractors", what: "Writes believable wrong options without reworded duplicates and spreads correct answers evenly across A-D.", where: "src/lib/exam/options.ts" },
      { name: "Rewrite options", what: "Regenerates the answer choices for a question.", where: "src/lib/exam/rewrite.ts" },
      { name: "Exam keyboard and checks", what: "Answer with keys 1-4 or A-D, jump to unanswered questions and get a warning about blanks before submitting.", where: "src/components/exam/practice-runner.tsx" },
      { name: "Retake missed questions", what: "Retakes only the questions you missed, reworded with new options.", where: "src/components/exam/retake-button.tsx" },
      { name: "Past papers and review", what: "Lets you look back over earlier papers and your answers.", where: "src/lib/exam/session.ts" },
    ],
  },
  {
    area: "Study plan",
    features: [
      { name: "Exam date and study days", what: "Set an exam date and which days of the week you study.", where: "src/components/plan/schedule-form.tsx" },
      { name: "Daily paced plan", what: "Estimates today's minutes and the study days left until the exam.", where: "src/lib/plan/estimate.ts" },
      { name: "Overload warning", what: "Warns when there's more material than time and suggests what to skip.", where: "src/lib/plan/index.ts" },
      { name: "Start today's session", what: "Starts the study session planned for today in one click.", where: "src/components/plan/start-today.tsx" },
    ],
  },
  {
    area: "Tutor",
    features: [
      { name: "Ask a question tutor", what: "A side-panel AI tutor that answers using your deck's material.", where: "src/components/tutor/tutor-panel.tsx" },
      { name: "Past chats", what: "Saves tutor conversations on your computer so you can return to them.", where: "src/lib/tutor/chats.ts" },
      { name: "Context-aware questions", what: "Attaches the slide on screen and understands mentions like 'flashcard 32'.", where: "src/lib/tutor/context.ts" },
      { name: "Image attachments", what: "Lets you attach images to your question.", where: "src/components/tutor/tutor-panel.tsx" },
      { name: "Turn chat into cards", what: "Saves cards from a conversation and flags any that came from the AI rather than your files.", where: "src/components/tutor/card-confirm.tsx" },
      { name: "Rich answers", what: "Shows tutor answers with tables and maths notation.", where: "src/components/tutor/markdown.tsx" },
    ],
  },
  {
    area: "Calculator & numbers",
    features: [
      { name: "Calculator on every card", what: "A draggable calculator, also in exams, that remembers where you put it.", where: "src/components/cards/number-tools.tsx" },
      { name: "Numbers panel", what: "Lists the numbers a card mentions so you can use them quickly.", where: "src/lib/calc.ts" },
      { name: "Worked calculation steps", what: "Shows the working for calculation cards.", where: "src/components/cards/number-tools.tsx" },
    ],
  },
  {
    area: "Search",
    features: [
      { name: "Global search", what: "Instant search across every deck, with optional AI search by meaning.", where: "src/components/search/search-view.tsx" },
      { name: "In-deck search", what: "Instantly filters a deck's cards as you type.", where: "src/components/search/deck-search.tsx" },
    ],
  },
  {
    area: "Export & backup",
    features: [
      { name: "Export to Anki", what: "Exports a deck as an Anki .apkg file, images included.", where: "src/lib/export/anki.ts" },
      { name: "Export to Quizlet, RemNote and CSV", what: "Exports cards as text for Quizlet, Markdown for RemNote, or a CSV file, explaining what each format keeps.", where: "src/components/manage/export-dialog.tsx" },
      { name: "Full JSON backup", what: "Exports a complete backup of a deck.", where: "src/lib/manage/export.ts" },
    ],
  },
  {
    area: "Deck catalog & sharing",
    features: [
      { name: "Browse shared decks", what: "Find decks other students shared, filtered by college, professor, course and exam, with a preview.", where: "src/components/catalog/catalog-view.tsx" },
      { name: "Add a shared deck", what: "Copies a catalog deck into your own library.", where: "src/lib/catalog/actions.ts" },
      { name: "Share your deck", what: "Publishes only your cards and study guide, after a content check that runs on your own key.", where: "src/lib/catalog/store.ts" },
      { name: "Manage your listings", what: "Lets you update or remove decks you have shared.", where: "src/components/catalog/catalog-view.tsx" },
      { name: "Report a listing", what: "Lets students report bad listings; publishing is rate-limited.", where: "src/lib/catalog/store.ts" },
    ],
  },
  {
    area: "Lectures",
    features: [
      { name: "Record a lecture", what: "Records from a microphone you choose and saves as it goes, so a crash or flat battery loses only seconds.", where: "src/components/lectures/recorder.tsx", status: "in progress" },
      { name: "Import lecture audio or video", what: "Transcribes .mp3, .m4a, .wav and .aac files, or the sound from .mov and .mp4.", where: "electron/lectures.cjs", status: "in progress" },
      { name: "On-device Whisper transcription", what: "Transcribes on your computer with whisper.cpp and shows progress; no audio or text leaves the machine.", where: "electron/lectures.cjs", status: "in progress" },
      { name: "Transcription model download", what: "Downloads a Whisper model once and lets you set the default.", where: "src/components/lectures/use-lectures.ts", status: "in progress" },
      { name: "Transcribe later", what: "Keeps finished recordings as pending so you can transcribe them whenever you like.", where: "src/components/lectures/pending-transcript.tsx", status: "in progress" },
      { name: "Transcript with playback", what: "Shows a timestamped transcript beside a small playback copy of the audio.", where: "src/components/lectures/transcript-view.tsx", status: "in progress" },
      { name: "Add transcript to deck", what: "Sends a lecture transcript into a deck as notes.", where: "src/components/lectures/transcript-view.tsx", status: "in progress" },
      { name: "Export transcripts", what: "Exports transcripts, including as SRT subtitles.", where: "src/lib/lectures/format.ts", status: "in progress" },
      { name: "Delete lecture audio", what: "Removes a lecture's stored audio to free up space.", where: "src/lib/lectures/actions.ts", status: "in progress" },
    ],
  },
  {
    area: "Appearance & themes",
    features: [
      { name: "Themes", what: "Choose a theme such as Bubble, Midnight, Sepia, Blossom, Rosewood, Lavender or Plum.", where: "src/components/settings/appearance-settings.tsx" },
      { name: "Custom colors", what: "Customise each style's colors, with an automatic fix that keeps text readable.", where: "src/lib/appearance.ts" },
      { name: "Radius, text size, font and width", what: "Adjust corner rounding, text size, font and page width.", where: "src/components/settings/appearance-settings.tsx" },
      { name: "Light/dark toggle", what: "Switch theme from the header, and the choice is saved.", where: "src/components/layout/theme-toggle.tsx" },
      { name: "Default flashcard format", what: "Sets which card format and style flashcards use by default.", where: "src/components/settings/flashcard-format-settings.tsx" },
    ],
  },
  {
    area: "Settings & AI providers",
    features: [
      { name: "Setup wizard", what: "Walks you through first-time setup on the welcome page.", where: "src/components/settings/setup-wizard.tsx" },
      { name: "Gemini key walkthrough", what: "Shows step by step how to get a free Gemini key and checks that it works.", where: "src/components/settings/gemini-key-steps.tsx" },
      { name: "Choose AI provider", what: "Use Gemini, Anthropic or OpenAI with your own key, and pick a Standard or Thinking model.", where: "src/components/settings/provider-settings.tsx" },
      { name: "Fallback models", what: "Switches to a backup model automatically when the main one fails.", where: "src/lib/llm/fallback.ts" },
      { name: "Local offline models", what: "Experimental: download and run AI models on your own computer.", where: "src/components/settings/experimental-local.tsx" },
      { name: "Grading strictness", what: "Sets how strictly typed answers are marked, with an optional on-device Check Answer model.", where: "src/components/settings/grading-settings.tsx" },
      { name: "Speed up guide", what: "Explains how turning on billing for your key cuts waits, with an upgrade walkthrough.", where: "src/components/settings/upgrade-guide.tsx" },
      { name: "Quota error help", what: "Links quota and rate-limit errors to the upgrade guide.", where: "src/lib/notify.ts" },
      { name: "Add your key banner", what: "Reminds you on the home page to add a Gemini key.", where: "src/app/page.tsx" },
      { name: "Your stats", what: "Shows your study statistics and time in the app.", where: "src/components/settings/stats-card.tsx" },
      { name: "Delete statistics", what: "Clears your stored statistics.", where: "src/components/settings/delete-statistics.tsx" },
      { name: "Send a suggestion", what: "Lets you send feedback to the developer.", where: "src/components/settings/feedback-card.tsx" },
      { name: "What's new", what: "Shows release notes that matter to students in Settings and in a banner after an update; developer notes stay in this app.", where: "src/components/layout/whats-new.tsx" },
      { name: "AI usage log", what: "Records each AI call and its cost.", where: "src/lib/usage/index.ts" },
    ],
  },
  {
    area: "Licensing & trial",
    features: [
      { name: "Buy or trial on first launch", what: "Lets you start a free trial or buy the app on the welcome screen.", where: "src/components/privacy/privacy-gate.tsx" },
      { name: "In-app checkout", what: "Buy the app from inside it, and the purchase unlocks automatically.", where: "src/components/settings/purchase-license.tsx" },
      { name: "License status", what: "Shows your plan, the trial countdown and who the license was issued to.", where: "src/lib/license/status.ts" },
      { name: "Offline-friendly license check", what: "Confirms the license online every 45 days with a 'Check again' button and never locks you out offline.", where: "electron/license/gate.cjs" },
      { name: "License id in Advanced", what: "Shows a short license id in Settings > Advanced for support.", where: "src/app/settings/page.tsx" },
    ],
  },
  {
    area: "Updates, backups & reliability",
    features: [
      { name: "In-app updates", what: "Downloads and installs updates from inside the app, then restarts it.", where: "electron/updater.cjs" },
      { name: "Update notice", what: "Tells you when an update is ready.", where: "src/components/layout/update-notice.tsx" },
      { name: "Daily database backups", what: "Backs up your study database every day at launch and keeps the last 7, plus a copy before each update.", where: "electron/backup.cjs" },
      { name: "Local crash log", what: "Writes crash details to a file named in Settings > Advanced, which you can send yourself.", where: "electron/crash-log.cjs" },
      { name: "School Wi-Fi support", what: "Retries requests through the system proxy and certificates so the app works on school networks.", where: "electron/network.cjs" },
      { name: "Service status switch", what: "Shows maintenance or required-update screens and AI-paused banners without ever locking studying.", where: "src/lib/app-status.ts" },
      { name: "Continue without AI", what: "Lets you keep studying when AI features are paused.", where: "src/components/layout/app-status.tsx" },
      { name: "Safe data location and migrations", what: "Keeps your data in your user folder, upgrades its format before start-up and carries over data from older app names.", where: "electron/main.cjs" },
    ],
  },
  {
    area: "Privacy & telemetry",
    features: [
      { name: "Privacy agreement", what: "You agree to a versioned privacy policy first and are asked again when it changes.", where: "src/lib/privacy-policy.ts" },
      { name: "Usage counts only", what: "Sends anonymous counts, time in the app and AI usage (never content) about once an hour.", where: "src/lib/telemetry.ts" },
      { name: "Encrypted API keys", what: "Stores your AI keys encrypted on your computer without prompting for the Mac keychain.", where: "src/lib/secret-box.ts" },
      { name: "Local-first data", what: "Keeps your cards, files and answers on your computer.", where: "electron/main.cjs" },
    ],
  },
  {
    area: "Platform",
    features: [
      { name: "Desktop app for Mac and Windows", what: "Runs as a desktop app on Apple Silicon and Intel Macs and on Windows, including ARM.", where: "electron/main.cjs" },
      { name: "Offline studying", what: "Lets you study offline; only card generation and AI grading use the internet, and only when you ask.", where: "electron/main.cjs" },
      { name: "Built-in slide drawing", what: "Draws PowerPoint slides itself, so viewing them doesn't need Office installed.", where: "electron/slide-drawer.cjs" },
      { name: "Time in app tracking", what: "Records time spent studying for your stats.", where: "src/components/layout/time-tracker.tsx" },
    ],
  },
];

/** @param {import("electron").IpcMain} ipcMain */
function registerFeatures(ipcMain) {
  ipcMain.handle("features:get", () => ({ ok: true, data: FEATURES }));
}

module.exports = { registerFeatures, FEATURES };
