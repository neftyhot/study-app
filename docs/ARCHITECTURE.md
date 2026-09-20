# Technical Architecture & Constraints

## Stack Specification
- **Framework:** Next.js (App Router), TypeScript, Tailwind CSS, shadcn/ui. Fully responsive across desktop, tablet, and mobile.
- **Data Layer:** SQLite via Prisma or Drizzle ORM (embedded local-first storage or Turso).
- **Ingestion Tools:**
  - PDF: `pdf-parse` / `unpdf`
  - PPTX: Text, table, and speaker notes extraction (`node-pptx` or custom XML parsing)
  - Vision/OCR: Multimodal extraction for diagrams and image labels
- **LLM Pipeline:** Structured JSON generation using Anthropic Claude models with strict schemas for extraction, distractor generation, and semantic evaluation.

## Database Schema Model Guidelines
- `Course`: id, title, term
- `Exam`: id, course_id, title, date
- `SourceFile`: id, exam_id, filename, file_type, raw_path
- `SourceSlideOrPage`: id, source_file_id, index, raw_text, speaker_notes, image_path, has_diagram
- `StudyGuideObjective`: id, exam_id, prompt_text, professor_emphasis (bool)
- `Flashcard`: id, exam_id, topic, question, direct_answer, full_explanation, card_type (atomic, process, integration), source_slide_id, is_user_edited, professor_emphasis
- `CardRubric`: id, flashcard_id, essential_points (JSON array), optional_points (JSON array), common_misconceptions (JSON array)
- `CoverageMapping`: id, objective_id, flashcard_id, status (covered, partially_covered, missing)
- `StudyProgress`: id, flashcard_id, state (unstudied, recognition, immediate_recall, retained), interval_days, next_review_due, last_grade

## Engineering Principles
1. **Provenance Enforcement:** Every generated card must carry `source_slide_id` and exact excerpt text.
2. **Schema Uniformity:** LLM interactions must use strict JSON schema output; never accept unstructured prose from generation endpoints.
3. **Non-Destructive Regeneration:** Existing card IDs and progress records must never be wiped when ingesting additional files; new items are appended or merged with user approval.
