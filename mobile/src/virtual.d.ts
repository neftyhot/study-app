/// <reference types="vite/client" />

/** The app's server, baked in at build time (vite.config.ts). Empty when the build has none. */
declare const __SERVER_URL__: string;

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

/** mammoth's prebuilt browser bundle: the package's main entry needs Node. */
declare module "mammoth/mammoth.browser.min.js" {
  type Message = { type: "warning" | "error"; message: string };
  const mammoth: {
    convertToHtml(
      input: { arrayBuffer: ArrayBuffer },
      options?: { styleMap?: string[] },
    ): Promise<{ value: string; messages: Message[] }>;
  };
  export default mammoth;
}
