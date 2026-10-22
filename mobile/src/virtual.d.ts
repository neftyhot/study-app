/// <reference types="vite/client" />

declare module "virtual:migrations" {
  import type { BundledMigration } from "@megan/core/platform/migrate";
  const migrations: BundledMigration[];
  export default migrations;
}

declare module "virtual:theme.css";

declare module "sql.js" {
  type Database = new (data?: Uint8Array) => unknown;
  const initSqlJs: (config?: { locateFile?: (file: string) => string }) => Promise<{ Database: Database }>;
  export default initSqlJs;
}
