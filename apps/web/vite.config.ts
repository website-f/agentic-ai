import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";
import type { Plugin } from "vite";
import { defineConfig } from "vitest/config";
import { VitePWA } from "vite-plugin-pwa";

const API = process.env.AGENTIC_API_URL ?? "http://127.0.0.1:8501";

/**
 * P104: modules that only define and re-export things. Marked free of side effects, so code
 * that takes a re-exported piece (the sign-in page's IconTile from components/page) links to
 * where it lives instead of loading the module's other imports (the navigation and every
 * page's icon). Add a module here only if importing it does nothing but define exports.
 */
const PURE_MODULES = /[\\/]src[\\/]components[\\/]page\.tsx$/;

/** P104 (see build.rolldownOptions): the app's own code the first screen needs goes to a "core"
 * file (with Vite's small preload helper, which every lazy import calls), except what stays in
 * the entry: the start-up and the route table (it names every page's file, so it changes with
 * any page), and styles. */
const CORE = /[\\/]src[\\/]|vite[\\/]preload-helper/;
const INITIAL_KEEP = /[\\/]src[\\/](main|router)\.tsx$|\.css(\?|$)/;

function pureModules(): Plugin {
  return {
    name: "agentic:pure-modules",
    transform(code, id) {
      return PURE_MODULES.test(id) ? { code, map: null, moduleSideEffects: false } : null;
    },
  };
}

export default defineConfig({
  plugins: [
    pureModules(),
    react(),
    tailwindcss(),
    VitePWA({
      strategies: "injectManifest",
      srcDir: "src",
      filename: "sw.ts",
      registerType: "autoUpdate",
      injectRegister: false,
      manifest: false, // public/manifest.webmanifest is the single source
      injectManifest: {
        globPatterns: ["**/*.{js,css,html,svg,png,woff2,webmanifest}"],
        // P104: the guide's screenshots and videos (~15 MB) load when the guide shows them,
        // never in the background install, whatever their format.
        globIgnores: ["guide-media/**"],
      },
      devOptions: { enabled: false },
    }),
  ],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": { target: API, changeOrigin: false },
      "/readyz": { target: API },
    },
  },
  build: {
    target: "es2022",
    sourcemap: false,
    chunkSizeWarningLimit: 600,
    rolldownOptions: {
      output: {
        codeSplitting: {
          // P104: after a deploy a returning visitor downloads only what changed. A chunk's name
          // carries a hash of its content, and its content names the chunks it imports, so a
          // change ripples up to every importer. Left alone, the bundler put the shared code
          // (React, the router, the API client) into the entry file, which also lists every page:
          // one changed page or Malay line renamed nearly every file. Here the entry keeps only
          // main.tsx and the route table, which nothing imports, and the code every page shares
          // sits in two steady files: libraries, and the app's own core.
          groups: [
            { name: "vendor", test: /node_modules[\\/]/, tags: ["$initial"], priority: 2 },
            { name: "core", test: (id) => CORE.test(id) && !INITIAL_KEEP.test(id), tags: ["$initial"], priority: 1 },
          ],
        },
      },
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test-setup.ts"],
  },
});
