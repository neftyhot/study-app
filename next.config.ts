import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * better-sqlite3 is a native module — it must stay external to the server
   * bundle rather than being compiled by Turbopack.
   */
  serverExternalPackages: [
    "better-sqlite3",
    // llama.cpp bindings: native code plus runtime-resolved binaries, which a
    // bundler can only get wrong. Left external so it loads from node_modules.
    "node-llama-cpp",
  ],

  /**
   * Standalone output is what makes the desktop bundle viable: it emits the
   * server plus only the modules actually traced, instead of the whole of
   * node_modules. Harmless for normal `next start` deployments.
   */
  output: "standalone",
};

export default nextConfig;
