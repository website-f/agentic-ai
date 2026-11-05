/**
 * P75: the feedback widget (src/feedback-widget/main.tsx) as one stand-alone script,
 * dist/feedback-widget.js, for pages outside this app (Prima at /prima/ adds
 * <script type="module" src="/feedback-widget.js">). Its styles are inside the script (they go
 * into the widget's shadow root), so there is no CSS file. Run after the app's own build, which
 * empties dist: `vite build -c vite.widget.config.ts`.
 */
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";

import { widgetI18n } from "./widget-i18n-plugin";

const src = fileURLToPath(new URL("./src", import.meta.url));
const entry = fileURLToPath(new URL("./src/feedback-widget/main.tsx", import.meta.url));

export default defineConfig({
  plugins: [widgetI18n(src, entry), react(), tailwindcss()],
  resolve: {
    alias: { "@": src },
  },
  define: { "process.env.NODE_ENV": JSON.stringify("production") },
  publicDir: false,
  build: {
    target: "es2022",
    outDir: "dist",
    emptyOutDir: false,
    sourcemap: false,
    lib: {
      entry,
      name: "AgenticFeedback",
      formats: ["iife"],
      fileName: () => "feedback-widget.js",
    },
  },
});
