import "server-only";

import { createClient, type Db } from "./client";
import * as schema from "./schema";

export { schema };
export type { Db };

/**
 * Next dev-server hot reloads re-evaluate modules, so the connection is cached
 * on globalThis to avoid piling up SQLite handles.
 */
const globalForDb = globalThis as unknown as { __studyAppDb?: Db };

export const db = globalForDb.__studyAppDb ?? createClient();

if (process.env.NODE_ENV !== "production") {
  globalForDb.__studyAppDb = db;
}
