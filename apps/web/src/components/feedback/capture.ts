/**
 * P73: a picture of exactly what the person sees, made from the page itself: no browser
 * extension, no permission prompt, and it works on phones.
 *
 * How: the page is copied (its DOM, the values typed in its fields, the pictures on its
 * canvases), its own stylesheets, fonts and images are embedded, and the copy is drawn as an
 * SVG <foreignObject> onto a canvas at the screen's size. Where the page is scrolled (the
 * window or any scrolling box) and where something sticks while scrolling, the copy is shifted
 * the same way, so the picture matches the screen. Only same-origin files are embedded; nothing
 * is fetched from anywhere else. Anything marked data-feedback-ignore (the feedback button
 * itself) is left out.
 *
 * captureScreen() is the exact alternative on desktop browsers: the browser's own "share this
 * tab" picture, after the person allows it.
 */

export const IGNORE_ATTR = "data-feedback-ignore";

const XHTML = "http://www.w3.org/1999/xhtml";
const MAX_EMBED = 4_000_000; // one file; bigger ones are left out
const files = new Map<string, Promise<string | null>>(); // url -> data URL (kept for the visit)

function sameOrigin(url: string): boolean {
  try {
    const u = new URL(url, document.baseURI);
    return u.protocol === "blob:" || u.origin === location.origin;
  } catch {
    return false;
  }
}

function readAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((ok, bad) => {
    const r = new FileReader();
    r.onload = () => ok(String(r.result));
    r.onerror = () => bad(r.error);
    r.readAsDataURL(blob);
  });
}

/** A same-origin file as a data: URL (null when it cannot be read or is too big). */
function embed(url: string): Promise<string | null> {
  if (url.startsWith("data:")) return Promise.resolve(url);
  const abs = (() => {
    try {
      return new URL(url, document.baseURI).href;
    } catch {
      return null;
    }
  })();
  if (!abs || !sameOrigin(abs)) return Promise.resolve(null);
  let p = files.get(abs);
  if (!p) {
    p = (async () => {
      try {
        const res = await fetch(abs, { credentials: "same-origin" });
        if (!res.ok) return null;
        const blob = await res.blob();
        return blob.size > MAX_EMBED ? null : await readAsDataUrl(blob);
      } catch {
        return null;
      }
    })();
    files.set(abs, p);
  }
  return p;
}

const URL_RX = /url\(\s*(['"]?)([^'")]+?)\1\s*\)/g;

/** Every url(...) in some CSS replaced by the file itself (same-origin only). */
async function embedUrls(css: string, base: string): Promise<string> {
  const found = new Map<string, string>();
  for (const m of css.matchAll(URL_RX)) {
    const raw = m[2] ?? "";
    if (!raw || raw.startsWith("data:") || raw.startsWith("#")) continue;
    let abs: string;
    try {
      abs = new URL(raw, base).href;
    } catch {
      continue;
    }
    found.set(raw, abs);
  }
  if (!found.size) return css;
  const data = new Map<string, string | null>();
  await Promise.all([...found].map(async ([raw, abs]) => data.set(raw, await embed(abs))));
  return css.replace(URL_RX, (whole, _q: string, raw: string) => {
    const d = data.get(raw);
    return d ? `url("${d}")` : found.has(raw) ? "none" : whole;
  });
}

let cssCache: { key: string; css: Promise<string> } | null = null;

/** The page's own CSS as one text, with its fonts and images inside (cached while the same
 * stylesheets are loaded). Cross-origin sheets cannot be read and are skipped. */
function pageCss(doc: Document): Promise<string> {
  const sheets = Array.from(doc.styleSheets);
  const key = sheets.map((s) => `${s.href ?? "inline"}:${(() => { try { return s.cssRules.length; } catch { return -1; } })()}`).join("|");
  if (doc === document && cssCache?.key === key) return cssCache.css;
  const css = (async () => {
    const parts: string[] = [];
    for (const sheet of sheets) {
      let rules: CSSRuleList;
      try {
        rules = sheet.cssRules;
      } catch {
        continue;
      }
      let text = "";
      for (const r of Array.from(rules)) text += r.cssText + "\n";
      parts.push(await embedUrls(text, sheet.href ?? doc.baseURI));
    }
    return parts.join("\n");
  })();
  if (doc === document) cssCache = { key, css };
  return css;
}

// The copy is a still picture: animations and transitions would show their first frame.
const STILL_CSS = `*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}[${IGNORE_ATTR}]{display:none!important}`;

interface Work {
  doc: Document;
  win: Window;
  ignore: (el: Element) => boolean;
  later: Promise<void>[];
  sticky: Map<Element, { dx: number; dy: number }>;
  depth: number;
}

/** How far each sticky element is from where it would be without sticking. Read in one go
 * (all of them set static, measured, put back) so the page never paints the change. */
function measureSticky(doc: Document, win: Window): Map<Element, { dx: number; dy: number }> {
  const out = new Map<Element, { dx: number; dy: number }>();
  const els: HTMLElement[] = [];
  for (const el of Array.from(doc.body.querySelectorAll<HTMLElement>("*"))) {
    if (win.getComputedStyle(el).position === "sticky") els.push(el);
  }
  if (!els.length) return out;
  const now = els.map((el) => el.getBoundingClientRect());
  const saved = els.map((el) => [el.style.getPropertyValue("position"), el.style.getPropertyPriority("position")] as const);
  for (const el of els) el.style.setProperty("position", "static", "important");
  const plain = els.map((el) => el.getBoundingClientRect());
  els.forEach((el, i) => {
    const [v, p] = saved[i]!;
    if (v) el.style.setProperty("position", v, p);
    else el.style.removeProperty("position");
    const dx = now[i]!.left - plain[i]!.left;
    const dy = now[i]!.top - plain[i]!.top;
    if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) out.set(el, { dx, dy });
  });
  return out;
}

function placeholder(w: Work, el: Element, text: string): HTMLElement {
  const r = el.getBoundingClientRect();
  const cs = w.win.getComputedStyle(el);
  const box = w.doc.createElementNS(XHTML, "div") as HTMLElement;
  box.setAttribute(
    "style",
    `display:${cs.display === "inline" ? "inline-block" : cs.display};width:${r.width}px;height:${r.height}px;` +
      "box-sizing:border-box;border:1px dashed currentColor;opacity:.5;font:12px system-ui;" +
      "display:grid;place-items:center;color:inherit",
  );
  box.textContent = text;
  return box;
}

function copyField(src: Element, out: Element): void {
  if (src instanceof HTMLInputElement) {
    const type = src.type;
    if (type === "checkbox" || type === "radio") {
      if (src.checked) out.setAttribute("checked", "");
      else out.removeAttribute("checked");
    } else if (type === "password") {
      out.setAttribute("value", "•".repeat(Math.min(src.value.length, 24)));
    } else if (type !== "file") {
      out.setAttribute("value", src.value);
    }
  } else if (src instanceof HTMLTextAreaElement) {
    out.textContent = src.value;
  } else if (src instanceof HTMLSelectElement) {
    Array.from((out as HTMLSelectElement).options).forEach((o, i) => {
      if (i === src.selectedIndex) o.setAttribute("selected", "");
      else o.removeAttribute("selected");
    });
  }
}

/** Shift a scrolled box's children the way the box is scrolled (the copy is not scrolled). */
function shiftScrolled(w: Work, src: Element, out: Element): void {
  const sl = src.scrollLeft;
  const st = src.scrollTop;
  if (!sl && !st) return;
  const srcKids = Array.from(src.children);
  const outKids = Array.from(out.children);
  srcKids.forEach((kid, i) => {
    const copy = outKids[i] as HTMLElement | undefined;
    if (!copy || !(copy as HTMLElement).style) return;
    const cs = w.win.getComputedStyle(kid);
    if (cs.position === "fixed") return;
    const [x = "0px", y = "0px", z] = cs.translate && cs.translate !== "none" ? cs.translate.split(" ") : [];
    copy.style.setProperty("translate", `calc(${x} - ${sl}px) calc(${y} - ${st}px)${z ? ` ${z}` : ""}`);
  });
}

function cloneNode(w: Work, src: Node): Node | null {
  if (src.nodeType === Node.TEXT_NODE) return w.doc.createTextNode(src.nodeValue ?? "");
  if (src.nodeType !== Node.ELEMENT_NODE) return null;
  const el = src as Element;
  const tag = el.localName;
  if (tag === "script" || tag === "noscript" || tag === "template" || tag === "link" || tag === "style") return null;
  if (w.ignore(el) || el.hasAttribute(IGNORE_ATTR)) return null;

  if (tag === "canvas") {
    const c = el as HTMLCanvasElement;
    const img = w.doc.createElementNS(XHTML, "img") as HTMLImageElement;
    for (const a of Array.from(el.attributes)) img.setAttribute(a.name, a.value);
    const r = c.getBoundingClientRect();
    img.setAttribute("width", String(r.width));
    img.setAttribute("height", String(r.height));
    try {
      img.setAttribute("src", c.toDataURL());
    } catch {
      return placeholder(w, el, "");
    }
    return img;
  }
  if (tag === "iframe") {
    const frame = el as HTMLIFrameElement;
    let inner: Document | null;
    try {
      inner = frame.contentDocument;
    } catch {
      inner = null;
    }
    const r = frame.getBoundingClientRect();
    if (!inner?.body || !frame.contentWindow || w.depth > 1 || r.width < 2 || r.height < 2) return placeholder(w, el, "");
    const img = w.doc.createElementNS(XHTML, "img") as HTMLImageElement;
    for (const a of Array.from(el.attributes)) if (a.name !== "src" && a.name !== "srcdoc") img.setAttribute(a.name, a.value);
    img.setAttribute("width", String(r.width));
    img.setAttribute("height", String(r.height));
    const win = frame.contentWindow;
    w.later.push(
      renderDocument(inner, win, { ignore: w.ignore, depth: w.depth + 1, scale: 1 })
        .then((canvas) => img.setAttribute("src", canvas.toDataURL("image/png")))
        .catch(() => undefined),
    );
    return img;
  }
  if (tag === "video") {
    const v = el as HTMLVideoElement;
    const r = v.getBoundingClientRect();
    const img = w.doc.createElementNS(XHTML, "img") as HTMLImageElement;
    for (const a of Array.from(el.attributes)) if (!["src", "poster", "autoplay", "controls"].includes(a.name)) img.setAttribute(a.name, a.value);
    img.setAttribute("width", String(r.width));
    img.setAttribute("height", String(r.height));
    try {
      const c = document.createElement("canvas");
      c.width = Math.max(1, v.videoWidth);
      c.height = Math.max(1, v.videoHeight);
      c.getContext("2d")?.drawImage(v, 0, 0);
      img.setAttribute("src", c.toDataURL("image/jpeg", 0.8));
    } catch {
      return placeholder(w, el, "");
    }
    return img;
  }

  const out = el.cloneNode(false) as Element;
  if (tag === "img") {
    const img = el as HTMLImageElement;
    out.removeAttribute("srcset");
    out.removeAttribute("sizes");
    out.removeAttribute("loading");
    const url = img.currentSrc || img.src;
    if (url) {
      out.setAttribute("src", url);
      w.later.push(embed(url).then((d) => (d ? out.setAttribute("src", d) : out.removeAttribute("src"))));
    }
  } else if (tag === "image" || tag === "use") {
    // SVG pictures and sprites: embed a same-origin file the same way.
    for (const name of ["href", "xlink:href"]) {
      const v = out.getAttribute(name);
      if (v && !v.startsWith("#") && !v.startsWith("data:")) {
        w.later.push(embed(v).then((d) => (d ? out.setAttribute(name, d) : out.removeAttribute(name))));
      }
    }
  }
  const style = out.getAttribute("style");
  if (style && style.includes("url(")) {
    w.later.push(embedUrls(style, w.doc.baseURI).then((s) => out.setAttribute("style", s)));
  }
  copyField(el, out);

  const kids = el.localName === "textarea" ? [] : Array.from(el.childNodes);
  for (const kid of kids) {
    const c = cloneNode(w, kid);
    if (c) out.appendChild(c);
  }
  // A shadow root's contents are not reachable from outside; open ones are copied in place.
  const shadow = (el as HTMLElement).shadowRoot;
  if (shadow) for (const kid of Array.from(shadow.childNodes)) {
    const c = cloneNode(w, kid);
    if (c) out.appendChild(c);
  }
  shiftScrolled(w, el, out);
  const st = w.sticky.get(el);
  if (st && (out as HTMLElement).style) {
    const s = (out as HTMLElement).style;
    s.setProperty("position", "relative", "important");
    s.setProperty("top", `${st.dy}px`, "important");
    s.setProperty("left", `${st.dx}px`, "important");
    s.setProperty("bottom", "auto", "important");
    s.setProperty("right", "auto", "important");
  }
  return out;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
// Characters XML refuses (control characters) would break the whole picture.
// eslint-disable-next-line no-control-regex
const BAD_XML = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g;

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((ok, bad) => {
    const img = new Image();
    img.onload = () => ok(img);
    img.onerror = () => bad(new Error("The page could not be drawn."));
    img.src = src;
  });
}

async function renderDocument(
  doc: Document,
  win: Window,
  opts: { ignore: (el: Element) => boolean; depth: number; scale: number },
): Promise<HTMLCanvasElement> {
  const width = win.innerWidth;
  const height = win.innerHeight;
  const w: Work = { doc, win, ignore: opts.ignore, later: [], sticky: measureSticky(doc, win), depth: opts.depth };
  const css = pageCss(doc);

  const root = doc.documentElement.cloneNode(false) as HTMLElement;
  const body = cloneNode(w, doc.body) as HTMLElement | null;
  if (!body) throw new Error("The page could not be copied.");
  // The window's own scroll: the copy starts at the top, so move it up by as much.
  const sx = win.scrollX;
  const sy = win.scrollY;
  if (sx || sy) {
    body.style.setProperty("position", "relative", "important");
    body.style.setProperty("top", `${-sy}px`, "important");
    body.style.setProperty("left", `${-sx}px`, "important");
  }
  root.style.setProperty("width", `${width}px`, "important");
  root.style.setProperty("height", `${height}px`, "important");
  root.style.setProperty("overflow", "hidden", "important");
  const styleEl = doc.createElementNS(XHTML, "style");
  styleEl.textContent = `${await css}\n${STILL_CSS}`;
  root.appendChild(styleEl);
  root.appendChild(body);
  await Promise.all(w.later);

  const xhtml = new XMLSerializer().serializeToString(root).replace(BAD_XML, "");
  // :root in the picture is the <svg>: give it the page's theme too (data-theme, class).
  const rootAttrs = Array.from(doc.documentElement.attributes)
    .filter((a) => a.name === "class" || a.name === "style" || a.name.startsWith("data-") || a.name === "lang" || a.name === "dir")
    .map((a) => ` ${a.name}="${esc(a.value)}"`)
    .join("");
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"${rootAttrs}>` +
    `<foreignObject x="0" y="0" width="100%" height="100%">${xhtml}</foreignObject></svg>`;
  const img = await loadImage(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`);
  try {
    await img.decode();
  } catch {
    /* drawn below anyway */
  }

  const canvas = document.createElement("canvas");
  canvas.width = Math.round(width * opts.scale);
  canvas.height = Math.round(height * opts.scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("This browser cannot draw the picture.");
  // The page's background shows where nothing is drawn.
  ctx.fillStyle = win.getComputedStyle(doc.body).backgroundColor || "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.scale(opts.scale, opts.scale);
  // Safari draws an SVG's embedded fonts and pictures only from the second draw.
  if (/^((?!chrome|android).)*safari/i.test(navigator.userAgent)) {
    ctx.drawImage(img, 0, 0, width, height);
    await new Promise((r) => setTimeout(r, 80));
  }
  ctx.drawImage(img, 0, 0, width, height);
  return canvas;
}

/** What this person sees right now, as a canvas (CSS pixels x scale). */
export async function capturePage(opts: { ignore?: (el: Element) => boolean; scale?: number } = {}): Promise<HTMLCanvasElement> {
  const scale = opts.scale ?? Math.min(2, Math.max(1, window.devicePixelRatio || 1));
  return renderDocument(document, window, { ignore: opts.ignore ?? (() => false), depth: 0, scale });
}

/** The browser's own picture of this tab (desktop Chrome, Edge, Firefox), after the person
 * allows it. Exact to the pixel, for when the copy misses something. */
export function canCaptureScreen(): boolean {
  return typeof navigator !== "undefined" && !!navigator.mediaDevices?.getDisplayMedia && !/Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
}

export async function captureScreen(): Promise<HTMLCanvasElement> {
  const stream = await navigator.mediaDevices.getDisplayMedia({
    video: { displaySurface: "browser" },
    audio: false,
    // Chrome and Edge offer this tab first.
    preferCurrentTab: true,
    selfBrowserSurface: "include",
  } as DisplayMediaStreamOptions);
  try {
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.srcObject = stream;
    await video.play();
    // The first frames can be blank while the picture starts.
    await new Promise((r) => setTimeout(r, 300));
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext("2d")?.drawImage(video, 0, 0);
    video.pause();
    return canvas;
  } finally {
    for (const track of stream.getTracks()) track.stop();
  }
}
