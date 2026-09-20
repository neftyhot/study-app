/**
 * The adaptive Learn round engine (PRD §5).
 *
 * A round walks each concept up a scaffolding ladder — recognize it, recall it
 * immediately, recall it again after other items have intervened, then once
 * more later in the session. The engine is a pure state machine so the rules
 * that matter (what counts as mastery, when a concept comes back) are
 * testable without a browser or a model.
 *
 * The rule the whole design turns on: **typing an answer you were just shown
 * is not recall**. PRD §5 calls this out as a mastery safeguard, and it is the
 * difference between a tool that measures learning and one that measures
 * short-term memory.
 */
export const STAGES = [
  "mcq",
  "typed_immediate",
  "typed_interleaved",
  "typed_delayed",
] as const;

export type Stage = (typeof STAGES)[number];

export type MasteryTier = "none" | "recognition" | "immediate_recall";

const TIER_ORDER: MasteryTier[] = ["none", "recognition", "immediate_recall"];

/** Intervening items before an interleaved re-prompt (PRD §5: 3–5). */
const INTERLEAVE_GAPS = [3, 4, 5];

/** Same-session delayed check, far enough back to be a real second look. */
const DELAY_GAPS = [8, 10, 12];

/** Errors after which a concept is parked rather than drilled forever. */
const MAX_ERRORS = 4;

export type ConceptState = {
  cardId: string;
  stage: Stage;
  /** Step index at which this concept is due again. */
  dueAt: number;
  attempts: number;
  errors: number;
  /**
   * The answer has been on screen since the last attempt, so the next attempt
   * is practice, not evidence.
   */
  answerShown: boolean;
  tier: MasteryTier;
  done: boolean;
  /** Parked after repeated errors; surfaced to the student, not hidden. */
  struggled: boolean;
};

export type RoundState = {
  concepts: ConceptState[];
  step: number;
  gapCursor: number;
};

export type Step = {
  cardId: string;
  stage: Stage;
  /** False when the answer was just on screen: this attempt cannot prove recall. */
  countsTowardMastery: boolean;
  /** True once errors repeat: show the sub-concept breakdown (PRD §5). */
  remediate: boolean;
  index: number;
};

export type Outcome = {
  correct: boolean;
  /** "I guessed" (PRD §8) — never counts, however right it was. */
  guessed?: boolean;
};

export type StartOptions = {
  /**
   * Concepts the student already knows, which may skip straight to typed
   * recall (PRD §5). A skipped MCQ means no answer was shown, so that first
   * typed attempt is genuine recall and does count.
   */
  skipRecognitionFor?: Iterable<string>;
};

export function startRound(
  cardIds: readonly string[],
  options: StartOptions = {},
): RoundState {
  const skip = new Set(options.skipRecognitionFor ?? []);

  return {
    concepts: cardIds.map((cardId, index) => ({
      cardId,
      stage: skip.has(cardId) ? "typed_immediate" : "mcq",
      dueAt: index,
      attempts: 0,
      errors: 0,
      answerShown: false,
      tier: "none",
      done: false,
      struggled: false,
    })),
    step: 0,
    gapCursor: 0,
  };
}

export function isComplete(state: RoundState): boolean {
  return state.concepts.every((concept) => concept.done);
}

/**
 * The next thing to ask.
 *
 * Due concepts come first, oldest due first. When nothing is due yet, a
 * concept that has not started fills the gap — which is what produces the
 * interleaving: new material plays while an earlier concept waits out its
 * delay.
 */
export function nextStep(state: RoundState): Step | null {
  const pending = state.concepts.filter((concept) => !concept.done);
  if (pending.length === 0) return null;

  const due = pending.filter((concept) => concept.dueAt <= state.step);
  const pool = due.length > 0 ? due : pending;

  const concept = pool.reduce((best, candidate) =>
    candidate.dueAt < best.dueAt ? candidate : best,
  );

  return {
    cardId: concept.cardId,
    stage: concept.stage,
    countsTowardMastery: !concept.answerShown && concept.stage !== "mcq",
    remediate: concept.errors >= 2,
    index: state.step,
  };
}

export function applyOutcome(
  state: RoundState,
  step: Step,
  outcome: Outcome,
): RoundState {
  const gap = INTERLEAVE_GAPS[state.gapCursor % INTERLEAVE_GAPS.length];
  const delay = DELAY_GAPS[state.gapCursor % DELAY_GAPS.length];
  const next = state.step + 1;

  const concepts: ConceptState[] = state.concepts.map((concept) => {
    if (concept.cardId !== step.cardId || concept.done) return concept;

    const attempts = concept.attempts + 1;
    const credited = outcome.correct && !outcome.guessed;

    // A wrong answer or an admitted guess means we show the answer, so
    // whatever comes next for this concept is practice until other items
    // have intervened.
    if (!credited) {
      const errors = outcome.guessed ? concept.errors : concept.errors + 1;

      if (errors >= MAX_ERRORS) {
        return { ...concept, attempts, errors, done: true, struggled: true };
      }

      return {
        ...concept,
        attempts,
        errors,
        answerShown: true,
        dueAt: next + gap,
        // Re-prompting at the same rung: the ladder is not climbed by guessing.
        stage: concept.stage,
      };
    }

    const tier = promote(concept.tier, step);

    switch (concept.stage) {
      case "mcq":
        // Recognition confirmed, and the correct option was on screen — so the
        // immediate typed attempt that follows is practice by construction.
        return {
          ...concept,
          attempts,
          tier,
          stage: "typed_immediate" as const,
          dueAt: next,
          answerShown: true,
        };
      case "typed_immediate":
        return {
          ...concept,
          attempts,
          tier,
          stage: "typed_interleaved" as const,
          dueAt: next + gap,
          answerShown: false,
        };
      case "typed_interleaved":
        return {
          ...concept,
          attempts,
          tier,
          stage: "typed_delayed" as const,
          dueAt: next + delay,
          answerShown: false,
        };
      case "typed_delayed":
      default:
        return { ...concept, attempts, tier, done: true, answerShown: false };
    }
  });

  return { concepts, step: next, gapCursor: state.gapCursor + 1 };
}

function promote(current: MasteryTier, step: Step): MasteryTier {
  if (step.stage === "mcq") return max(current, "recognition");
  // Typed recall only certifies when the answer was not just on screen.
  return step.countsTowardMastery ? max(current, "immediate_recall") : current;
}

function max(a: MasteryTier, b: MasteryTier): MasteryTier {
  return TIER_ORDER.indexOf(a) >= TIER_ORDER.indexOf(b) ? a : b;
}

/**
 * "I already know this" — jump a concept straight to typed recall (PRD §5).
 *
 * No answer has been shown, so the typed attempt that follows is genuine
 * recall and counts. The student can only skip the recognition rung, never
 * the recall ones, so skipping cannot manufacture mastery.
 */
export function skipRecognition(
  state: RoundState,
  cardId: string,
): RoundState {
  return {
    ...state,
    concepts: state.concepts.map((concept) =>
      concept.cardId === cardId && concept.stage === "mcq"
        ? {
            ...concept,
            stage: "typed_immediate" as const,
            answerShown: false,
            dueAt: state.step,
          }
        : concept,
    ),
  };
}

/**
 * Records that the student asked for help on a concept (PRD §14).
 *
 * Reuses `answerShown`, which already means "the next attempt on this concept
 * cannot prove recall". A hint is help in exactly that sense: the attempt that
 * follows it is assisted practice, and the concept gets a genuine chance again
 * once other items have intervened.
 */
export function markAssisted(state: RoundState, cardId: string): RoundState {
  return {
    ...state,
    concepts: state.concepts.map((concept) =>
      concept.cardId === cardId && !concept.done
        ? { ...concept, answerShown: true }
        : concept,
    ),
  };
}

/**
 * "I know it" — the student declares a concept known and drops it from the
 * round.
 *
 * Self-declared, so it is recorded as recall rather than retention: the
 * student is asserting they can produce the answer today, which is exactly
 * what the immediate-recall tier means. Multi-day retention still has to be
 * demonstrated across days, and no amount of clicking can assert it.
 */
export function skipAsKnown(state: RoundState, cardId: string): RoundState {
  return {
    ...state,
    step: state.step + 1,
    concepts: state.concepts.map((concept) =>
      concept.cardId === cardId && !concept.done
        ? {
            ...concept,
            done: true,
            tier: "immediate_recall" as const,
            answerShown: false,
          }
        : concept,
    ),
  };
}

/**
 * "No clue" — reveal it and come back to it.
 *
 * Counts as a miss and stays on the same rung: the ladder is not climbed by
 * admitting you cannot climb it. The concept is re-queued after the usual gap
 * so the reveal has time to stop being the reason they remember.
 */
export function skipAsUnknown(
  state: RoundState,
  cardId: string,
): RoundState {
  const gap = INTERLEAVE_GAPS[state.gapCursor % INTERLEAVE_GAPS.length];

  return {
    ...state,
    step: state.step + 1,
    gapCursor: state.gapCursor + 1,
    concepts: state.concepts.map((concept) => {
      if (concept.cardId !== cardId || concept.done) return concept;

      const errors = concept.errors + 1;

      // Still bounded, so repeatedly giving up parks the concept for review
      // instead of looping forever.
      if (errors >= MAX_ERRORS) {
        return { ...concept, errors, done: true, struggled: true };
      }

      return {
        ...concept,
        errors,
        answerShown: true,
        dueAt: state.step + 1 + gap,
      };
    }),
  };
}

export function roundSummary(state: RoundState) {
  return {
    total: state.concepts.length,
    mastered: state.concepts.filter(
      (concept) => concept.tier === "immediate_recall",
    ).length,
    recognized: state.concepts.filter((concept) => concept.tier === "recognition")
      .length,
    struggled: state.concepts.filter((concept) => concept.struggled).length,
    steps: state.step,
  };
}
