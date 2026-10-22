/**
 * Compile-time proof that the shared core's copies of the database shapes
 * still match the schema. If a column is added or renamed, this file stops
 * compiling until `packages/core/src/types.ts` is updated too.
 */
import type * as core from "@megan/core/types";
import type * as schema from "@/db/schema";

type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
type Assert<T extends true> = T;

export type CoreSchemaChecks = [
  Assert<Same<core.StudyProgress, schema.StudyProgress>>,
  Assert<Same<typeof core.progressStates, typeof schema.progressStates>>,
  Assert<Same<typeof core.grades, typeof schema.grades>>,
  Assert<Same<typeof core.cardTypes, typeof schema.cardTypes>>,
];
