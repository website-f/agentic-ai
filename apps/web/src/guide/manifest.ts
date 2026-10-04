/**
 * The contract between the screenshot capture (deploy/docs-capture) and the Guide and
 * Present pages. The capture writes public/guide-media/manifest.json in this shape.
 *
 * Shot keys: "<page>" for a page as it opens (e.g. "agents"), "<page>:<state>" for a state
 * reached by clicking (e.g. "agents:new", "tasks:sheet"). Every box is in FRACTIONS of the
 * image (0..1), so the overlay stays right at any display size.
 */
export interface GuideBox {
  /** A target id from targets.ts, e.g. "agents.new" */
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface GuideShot {
  /** Served path, e.g. "/guide-media/shots/agents-desktop.webp" */
  src: string;
  /** Pixel size of the image file */
  w: number;
  h: number;
  boxes: GuideBox[];
}

export interface GuideVideo {
  /** Served path of an H.264 MP4 (plays on every browser incl. iPhone Safari) */
  src: string;
  poster: string;
  w: number;
  h: number;
  /** Seconds */
  duration: number;
  /** Chapter marks: what happens at each moment, for captions and step lists */
  chapters: { t: number; label: string }[];
  /** "desktop" | "mobile" */
  device: "desktop" | "mobile";
}

export interface GuideManifest {
  generated_at: string;
  /** Which data the shots show, e.g. "Sample companies (demo data)" */
  source: string;
  shots: Record<string, { desktop?: GuideShot; mobile?: GuideShot }>;
  videos: Record<string, GuideVideo>;
}

// Media live in public/guide-media/, NOT public/guide/: a folder named like the /guide route
// would make the web server answer /guide with the folder instead of the app.
export const MANIFEST_URL = "/guide-media/manifest.json";
