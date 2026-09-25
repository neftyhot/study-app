# Megan Study Product Requirements Document (PRD)

## Core Intent
The primary goal is to allow uploading study guides, lecture slides, and notes to automatically generate accurate, thorough, and atomic study materials without spending hours manually creating flashcards.

## 1. Uploading and Organizing Materials
- Support multi-file batch uploads per exam: PPTX, PDF, DOCX, and note images.
- Hierarchy: Class -> Exam -> Topic.
- Use the study guide as the primary outline; extract answers from slides, notes, and auxiliary files.
- Ingestion engine must extract tables, diagrams, image labels, and PowerPoint speaker notes in addition to standard slide text.
- Mode toggle: Cover everything in files vs. constrain focus strictly to study-guide objectives.
- Non-destructive updates: Ingesting subsequent files must preserve user card edits and study progress.
- Annotation flags: Mark content as professor-emphasized or explicitly excluded from testing.

## 2. Thorough Flashcard Generation
- Fact atomization: Break broad topics into discrete, manageable sub-questions instead of massive compound cards.
  - Example (Hormone): Origin/production, release location, release triggers, target tissue/receptors, physiological actions, and regulatory feedback.
  - Follow-up with integration cards testing interconnections across facets.
- Process cards: Break complex pathways into discrete step cards, sequence order cards, mechanism/rationale cards, and full-process summary cards.
- Strict completeness: Preserve exceptions, comparisons, specific examples, and nuances without artificial card caps. Deduplicate identical content while preserving distinct details.

## 3. Verification & Accuracy Auditing
- Provenance tracking: Every card must link directly to the specific slide number, page, or excerpt that supports its answer.
- Objective mapping: Correlate cards to corresponding study-guide questions.
- Gap detection: Flag study-guide objectives that the uploaded files fail to answer.
- Legibility flags: Alert on unreadable slides, clipped text, or low-resolution diagrams.
- Conflict detection: Explicitly flag contradicting statements across files rather than silently picking one.
- AI transparency: Distinguish between direct source facts and supplemental AI-generated explanations. Never hallucinate answers when source material is silent.
- Coverage matrix: Display status per objective (e.g., "Question 7: Covered by 6 cards via Slides 15–19"). Include a secondary AI review pass to catch omissions.

## 4. Normal Flashcard Mode
- Standard flip/reveal interface with concise core answers and expandable detailed context.
- Navigation: Shuffle or structured topic order.
- Filtering: Study by topic, starred cards, missed cards, or whole exam deck.
- Grading inputs: Mark as Missed, Difficult, or Easy.
- Reversible cards for term/definition pairs.
- Exact session resumption state.

## 5. Adaptive Learn Mode (Micro-Rounds)
- Micro-batches: Work in rounds of 5–8 concepts (user-configurable).
- Scaffolding ladder:
  1. Multiple-choice recognition to introduce novel concepts.
  2. Immediate typed active recall.
  3. Interleaved recall delay: Re-prompt after 3–5 intervening questions.
  4. Same-session delayed check.
  5. Multi-day spaced scheduling.
- Mastery safeguards: Typing immediately after seeing an answer does not register mastery. Skipping to typed recall is permitted for known concepts. Persistent errors trigger simplified explanations or sub-concept breakdown.

## 6. Multi-Day Spaced Repetition (SRS)
- Adaptive intervals based on retention difficulty.
- Discard invalid signals: Guessed answers, hints, or immediate post-reveal typing do not count toward independent recall intervals.
- Granular error accounting: Missing one part of a multi-point concept must not reset retention credit for mastered sub-points.
- Tracking axes: Maintain separate metrics for Recognition, Immediate Recall, and Multi-Day Retention. Gracefully handle missed study days without resetting decks.

## 7. Semantic Grading of Typed Answers
- Evaluate meaning over strict string matching (e.g., "kidneys retain more water" == "increases water reabsorption by the kidneys").
- Accept valid synonyms, common abbreviations, and minor spelling errors.
- Strict semantic gates: Penalize directionality errors (e.g., increase vs. decrease) or mechanism mix-ups (e.g., synthesis vs. secretion).
- Multi-point rubrics: Detail which required criteria were met vs. missed. Distinguish mandatory points from peripheral context.
- Student overrides: Include "My answer was correct" override and immediate question/answer inline editing. Practice missed sub-points specifically.

## 8. High-Fidelity Multiple Choice Questions
- Plausible distractors: Generated from related concepts within the deck to prevent obvious elimination.
- Randomized correct answer placement; consistent length and phrasing to eliminate test-taking artifacts.
- Post-answer debrief: Clarify why an incorrect option fails and how it diverges from the correct concept.
- Explicit "I guessed" button to avoid inflating mastery metrics. Dynamic generation of contrast questions for frequently confused concept pairs.

## 9. Conceptual Integration & Higher-Order Questions
- Generate higher-order application cards: Compare-and-contrast, causal mechanisms ("Why?"), perturbation effects ("What happens if step X is inhibited?"), directionality predictions, and novel application scenarios.
- Strictly derive from source material; clearly badge any auxiliary background context. Vary question phrasing across sessions.

## 10. Diagram & Pathway Practice
- Interactive slide diagram mode: Mask structural labels for active identification.
- Follow-up functional checks on identified structures.
- Step-ordering drills and missing-step completion for pathways.
- Unlabeled canvas mode for active redrawing/labeling with one-tap source reveal. Flag unreadable diagrams.

## 11. Practice Exam Mode
- Mock exam simulator: Configurable topics, duration, question types, and optional timer.
- Interleaved topics with alternate phrasing distinct from flashcards.
- Summative scoring: No immediate answer reveals during the exam; comprehensive post-exam diagnostic linking errors directly back to source slides.

## 12. Exam Date Planning & Load Management
- Inputs: Target exam date and daily available study minutes.
- Dynamic study queue balancing due SRS reviews, fresh concepts, high-difficulty items, and integration questions.
- Workload triage: Identify when remaining material exceeds available time and provide intelligent prioritization options based on professor emphasis.

## 13. Granular Progress Analytics
- State separation: Distinguish "Extracted by System" from "Mastered by Student".
- Detailed breakdowns: Unstudied, Recognition-tier, Immediate Recall-tier, Multi-Day Retained, and Application-capable.
- Pinpoint persistent confusions and uncovered study-guide items. Explicit session completion markers.

## 14. In-Session Scaffolding & Remediation
- On-demand assistance buttons: "Explain more simply", "Give an example", "Compare concepts", "Hint", "Show original slide", and "Ask easier prerequisite".
- Logging: Using aids categorizes the response as assisted practice.
- Persistent error diagnosis: Categorize repeated failures (missing prerequisite, term confusion, or defective question wording).

## 15. Persistence, Backups & Editing
- In-place split, merge, delete, and flag operations while studying.
- Automatic continuous persistence.
- Non-destructive sync: File re-ingestion presents merge proposals without clobbering manual edits.
- Full undo history, export/backup capabilities, responsive design (Desktop, Tablet, Mobile), and secure local/private file handling.

---

## MVP Target Scope (Phase 1 Deliverables)
1. Import study guide and PPTX/PDF slides (including speaker notes and slide indexing).
2. Generate atomic, sourced flashcards linking to slide numbers.
3. Coverage checklist cross-referencing study-guide objectives against cards and slides.
4. Normal flashcard mode (flip/reveal, in-place edits).
5. Adaptive Learn micro-rounds (5–8 concepts, MCQ to typed recall progression).
6. Semantic typed-answer grading with synonym acceptance and error detection.
7. Multi-day spaced review tracking.
