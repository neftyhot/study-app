"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { db } from "@/db";
import { exams } from "@/db/schema";

/** Toggles an exam between full coverage and study-guide focus (PRD §1). */
export async function setScopeMode(examId: string, mode: "files" | "objectives") {
  db.update(exams)
    .set({ scopeMode: mode })
    .where(eq(exams.id, examId))
    .run();

  revalidatePath(`/exams/${examId}`);
}
