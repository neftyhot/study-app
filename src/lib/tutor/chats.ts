"use server";

/**
 * Saved tutor conversations. They stay in the local database — nothing is
 * uploaded — and reopening one puts its transcript back in front of the
 * model, so the next question carries on where the last left off.
 */
import { and, desc, eq } from "drizzle-orm";

import { db } from "@/db";
import { tutorChats, type SavedTutorTurn } from "@/db/schema";

/** Plenty to scroll back through without the list becoming a chore. */
const KEEP_PER_DECK = 50;

export type TutorChatSummary = { id: string; title: string; updatedAt: string; turns: number };

export async function listTutorChats(examId: string): Promise<TutorChatSummary[]> {
  const rows = await db.query.tutorChats.findMany({
    where: eq(tutorChats.examId, examId),
    orderBy: desc(tutorChats.updatedAt),
    limit: KEEP_PER_DECK,
  });
  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    updatedAt: row.updatedAt,
    turns: row.messages.length,
  }));
}

export async function getTutorChat(examId: string, id: string) {
  const row = await db.query.tutorChats.findFirst({
    where: and(eq(tutorChats.id, id), eq(tutorChats.examId, examId)),
  });
  return row ? { id: row.id, title: row.title, messages: row.messages } : null;
}

function titleFor(messages: SavedTutorTurn[]) {
  const first = messages.find((message) => message.role === "user")?.text.trim() ?? "";
  const line = first.replace(/\s+/g, " ");
  return line.length > 70 ? `${line.slice(0, 67)}…` : line || "Untitled chat";
}

/** Creates the chat on its first answer, and replaces its transcript after. Returns its id. */
export async function saveTutorChat(input: {
  examId: string;
  id?: string | null;
  messages: SavedTutorTurn[];
}): Promise<string> {
  const messages = input.messages.map(({ role, text, imageCount, beyondMaterial }) => ({
    role,
    text,
    ...(imageCount ? { imageCount } : {}),
    ...(beyondMaterial ? { beyondMaterial } : {}),
  }));
  const now = new Date().toISOString();

  if (input.id) {
    const updated = await db
      .update(tutorChats)
      .set({ messages, updatedAt: now })
      .where(and(eq(tutorChats.id, input.id), eq(tutorChats.examId, input.examId)))
      .returning({ id: tutorChats.id });
    if (updated.length > 0) return input.id;
  }

  const [row] = await db
    .insert(tutorChats)
    .values({ examId: input.examId, title: titleFor(messages), messages, createdAt: now, updatedAt: now })
    .returning({ id: tutorChats.id });
  return row.id;
}

export async function deleteTutorChat(examId: string, id: string) {
  await db.delete(tutorChats).where(and(eq(tutorChats.id, id), eq(tutorChats.examId, examId)));
}
