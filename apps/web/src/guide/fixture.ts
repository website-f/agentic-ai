/** A tiny manifest in the capture's shape, for tests. The real one is fetched at runtime from
 * MANIFEST_URL; when it is absent the guide shows placeholders, so the app never needs this. */
import type { GuideManifest } from "./manifest";

const svg = (w: number, h: number) =>
  `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="100%" height="100%" fill="#eef2f0"/></svg>`)}`;

export const FIXTURE_MANIFEST: GuideManifest = {
  generated_at: "2026-10-04T00:00:00Z",
  source: "Fixture (tests only)",
  shots: {
    agents: {
      desktop: {
        src: svg(1440, 900),
        w: 1440,
        h: 900,
        boxes: [
          { id: "agents.new", x: 0.86, y: 0.08, w: 0.1, h: 0.05 },
          { id: "agents.card", x: 0.2, y: 0.3, w: 0.25, h: 0.2 },
          { id: "not.mentioned", x: 0.5, y: 0.5, w: 0.1, h: 0.1 },
        ],
      },
    },
  },
  videos: {
    "create-agent": {
      src: "/guide-media/videos/create-agent.mp4",
      poster: svg(1440, 900),
      w: 1440,
      h: 900,
      duration: 42,
      device: "desktop",
      chapters: [
        { t: 0, label: "Open Agents" },
        { t: 6, label: "Click New agent" },
      ],
    },
  },
};
