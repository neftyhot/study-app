import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    cpus: 1,
    workerThreads: false,
  },
  /**
   * better-sqlite3 is a native module — it must stay external to the server
   * bundle rather than being compiled by Turbopack.
   */
  serverExternalPackages: [
    "better-sqlite3",
    // llama.cpp bindings: native code plus runtime-resolved binaries, which a
    // bundler can only get wrong. Left external so it loads from node_modules.
    "node-llama-cpp",
    // Skia bindings used to rasterize a PDF page for diagram drills. Native,
    // and resolved per platform at runtime.
    "@napi-rs/canvas",
  ],

  /**
   * Standalone output is what makes the desktop bundle viable: it emits the
   * server plus only the modules actually traced, instead of the whole of
   * node_modules. Harmless for normal `next start` deployments.
   */
  output: "standalone",
};

export default nextConfig;
