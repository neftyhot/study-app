/** The shape of a finished deck as it travels between apps: the catalog, the sample deck and `.meganstudy` files. */
import type { CounterExample } from "../primer/types";

export type DeckCard = {
  topic: string | null;
  question: string;
  directAnswer: string;
  fullExplanation: string | null;
  cardType: string;
  sourceExcerpt: string | null;
  essentialPoints: string[];
  /** Wrong answers students give; a paper's multiple-choice options without a model. */
  misconceptions?: string[];
};

export type DeckSection = {
  conceptName: string;
  definition: string[];
  breakdown: string[];
  example: string[];
  /** A common mistake about the concept, shown in the guide. */
  misconception?: CounterExample | null;
};

export type DeckGuide = {
  overview: string | null;
  topics: { title: string; intro: string; sections: DeckSection[] }[];
};

export type DeckSnapshot = {
  title: string;
  course: string;
  term: string | null;
  cards: DeckCard[];
  guide: DeckGuide | null;
  /** Recorded as the guide's model, so it is clear where the guide came from. */
  origin: string;
};
