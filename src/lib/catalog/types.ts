/** The shared deck catalog. Types safe for client code. */

export const CATALOG_KINDS = ["exam", "quiz", "test", "module", "assignment", "custom"] as const;
export type CatalogKind = (typeof CATALOG_KINDS)[number];

export type CatalogDeck = {
  id: string;
  title: string;
  college: string;
  professor: string;
  course: string;
  kind: CatalogKind;
  customKind: string | null;
  term: string | null;
  description: string | null;
  uploader: string;
  cardCount: number;
  sectionCount: number;
  adds: number;
  /** "hidden" after enough reports or by the developer; only its owner still sees it. */
  status: "live" | "hidden";
  /** Only sent to whoever shared it. */
  sourceExamId: string | null;
  createdAt: string;
  /** Shared from this install, so it can be edited or removed here. */
  mine: boolean;
};

export type CatalogDeckDetail = CatalogDeck & {
  sampleCards: { question: string; answer: string; topic: string | null }[];
  topics: { title: string; concepts: string[] }[];
  overview: string | null;
};

export type PublishInput = {
  examId: string;
  title: string;
  college: string;
  professor: string;
  course: string;
  kind: CatalogKind;
  customKind: string | null;
  term: string | null;
  description: string | null;
  uploader: string | null;
  includeGuide: boolean;
};

export type OwnDeck = { examId: string; examTitle: string; courseTitle: string; term: string | null };

export const kindLabel = (deck: Pick<CatalogDeck, "kind" | "customKind">) =>
  deck.kind === "custom" ? deck.customKind || "Custom" : deck.kind[0].toUpperCase() + deck.kind.slice(1);
