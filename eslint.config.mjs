import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Packaged desktop output: built artifacts, not source.
    "release/**",
    // Electron's main process is CommonJS by necessity; the web app's rules
    // (ESM imports, React hooks) do not apply to it.
    "electron/**",
  ]),
]);

export default eslintConfig;
