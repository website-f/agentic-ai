/**
 * P104: the phone app's bridge. scripts/build-web.mjs puts it first in the <head> of the office's
 * and Prima's index.html inside the app (never on the website), so it runs before their code.
 *
 * The app's screens are stored in the phone; its page runs at https://localhost (Android) or
 * capacitor://localhost (iOS), so the web's same-site calls (/api/..., /api/prima/...) would reach
 * the phone, and cookies cannot carry the sign-in to the server (iOS blocks them). Here:
 *  - every call to /api/... goes to the server (app.json "server") with the app's session token
 *    ("Authorization: Bearer", X-Agentic-Client: app) and no cookies. Sign-in answers carry the
 *    token (X-Agentic-Session); it is kept in the phone's secure storage (Keychain / Keystore) and
 *    dropped on sign-out or when the server says the session ended (apps/api/agentic/api/deps.py);
 *  - fetch, XMLHttpRequest and EventSource (the live events) are covered; images, sound, video and
 *    frames that point at /api/... are fetched with the token and shown from memory;
 *  - files the app does not carry (guide videos and screenshots, Prima's receipt reader and face
 *    models) load from the server the first time they are needed;
 *  - Prima's folder (/prima/) opens its own index.html (the phone answers every folder with the
 *    office's), and service workers stay off (the app's files are already on the phone).
 * The web's code is unchanged; in a browser none of this runs.
 */
import { SecureStorage } from "@aparajita/capacitor-secure-storage";
import { Browser } from "@capacitor/browser";
import { Capacitor } from "@capacitor/core";
// Registered here so the office's lib/native.ts finds them in Capacitor.Plugins (downloads, share).
import "@capacitor/filesystem";
import "@capacitor/share";

declare const __SERVER__: string;

const SERVER = __SERVER__.replace(/\/+$/, "");
const ORIGIN = location.origin;
const TOKEN_KEY = "agentic.session";
/** Files served by the server only (not in the app): no sign-in needed, just the address. */
const REMOTE_FILES = [/^\/guide-media\/(?!manifest\.json$)/, /^\/prima\/ocr\//, /^\/prima\/face-models\//];
/** The server's answers that mean "this session is over" (deps._load_principal). */
const SESSION_OVER = new Set(["not_authenticated", "session_expired", "access_removed"]);

interface Shared {
  ready: Promise<void>;
  token: () => string;
  set: (token: string) => void;
  clear: (ifToken?: string) => void;
}

declare global {
  interface Window {
    __agenticApp?: Shared;
  }
}

// ---------------------------------------------------------------- Prima's folder

/** The phone answers any address without a file name with the office's index.html. Prima's
 * screens live at /prima/ (its screen in the #hash): open its own page instead. */
function openPrimaFolder(): boolean {
  const path = location.pathname;
  if (!path.startsWith("/prima/") || /\.[a-z0-9]+$/i.test(path)) return false;
  window.stop(); // the office's page must not start underneath
  if (path.startsWith("/prima/demo")) {
    // The no-sign-in preview is not in the app: the phone's browser shows it.
    void Browser.open({ url: `${SERVER}/prima/demo/` });
    if (history.length > 1) history.back();
    else location.replace("/");
    return true;
  }
  location.replace(`/prima/index.html${location.search}${location.hash}`);
  return true;
}

// ---------------------------------------------------------------- the session token

function makeShared(): Shared {
  let token = "";
  const native = Capacitor.isNativePlatform();
  const save = (value: string) => {
    const done = native
      ? value
        ? SecureStorage.setItem(TOKEN_KEY, value)
        : SecureStorage.removeItem(TOKEN_KEY)
      : Promise.resolve(value ? sessionStorage.setItem(TOKEN_KEY, value) : sessionStorage.removeItem(TOKEN_KEY));
    void done.catch(() => undefined);
  };
  const ready = (async () => {
    try {
      token = (native ? await SecureStorage.getItem(TOKEN_KEY) : sessionStorage.getItem(TOKEN_KEY)) ?? "";
    } catch {
      token = "";
    }
  })();
  return {
    ready,
    token: () => token,
    set(value) {
      if (!value || value === token) return;
      token = value;
      save(value);
    },
    clear(ifToken) {
      if (!token || (ifToken !== undefined && ifToken !== token)) return; // a newer sign-in stays
      token = "";
      save("");
    },
  };
}

function sharedState(): Shared {
  try {
    // A frame of the app (same origin) uses the page's own token.
    const top = window.top !== window ? window.top?.__agenticApp : undefined;
    if (top) return top;
  } catch {
    /* another origin: our own */
  }
  return makeShared();
}

// ---------------------------------------------------------------- addresses

interface Target {
  url: string;
  path: string;
  api: boolean;
}

/** Where a same-site address really lives: the server's API or a server-only file. */
function target(raw: string | URL): Target | null {
  let u: URL;
  try {
    u = new URL(String(raw), location.href);
  } catch {
    return null;
  }
  if (u.origin !== ORIGIN) return null;
  if (u.pathname.startsWith("/api/")) return { url: SERVER + u.pathname + u.search, path: u.pathname, api: true };
  if (REMOTE_FILES.some((r) => r.test(u.pathname))) return { url: SERVER + u.pathname + u.search, path: u.pathname, api: false };
  return null;
}

function install(shared: Shared): void {
  const realFetch = window.fetch.bind(window);

  const sign = (headers: Headers, token: string) => {
    headers.set("x-agentic-client", "app");
    if (token) headers.set("authorization", `Bearer ${token}`);
    else headers.delete("authorization");
  };

  const observe = (path: string, status: number, header: string | null, body: () => Promise<unknown>, used: string) => {
    if (header) shared.set(header);
    if (path === "/api/auth/logout" && (status < 300 || status === 401)) shared.clear(used);
    else if (status === 401 && used)
      void body()
        .then((b) => {
          const code = (b as { code?: string } | null)?.code;
          if (code && SESSION_OVER.has(code)) shared.clear(used);
        })
        .catch(() => undefined);
  };

  // ------------------------------------------------------------ fetch
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const raw = typeof input === "string" || input instanceof URL ? input : input.url;
    const t = target(raw);
    if (!t) return realFetch(input, init);
    const req = input instanceof Request ? new Request(t.url, input) : t.url;
    if (!t.api) return realFetch(req, { ...init, credentials: "omit" });
    await shared.ready;
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    const used = shared.token();
    sign(headers, used);
    const res = await realFetch(req, { ...init, headers, credentials: "omit", mode: "cors" });
    observe(t.path, res.status, res.headers.get("x-agentic-session"), () => res.clone().json(), used);
    return res;
  };

  // ------------------------------------------------------------ XMLHttpRequest (uploads with progress)
  const xhrs = new WeakMap<XMLHttpRequest, Target>();
  const open = XMLHttpRequest.prototype.open as (this: XMLHttpRequest, ...a: unknown[]) => void;
  const send = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (this: XMLHttpRequest, method: string, url: string | URL, ...rest: unknown[]) {
    const t = target(url);
    if (t) xhrs.set(this, t);
    else xhrs.delete(this);
    open.call(this, method, t ? t.url : url, ...(rest.length ? rest : [true]));
  } as typeof XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.send = function (this: XMLHttpRequest, body?: Document | XMLHttpRequestBodyInit | null) {
    const t = xhrs.get(this);
    if (t?.api) {
      this.withCredentials = false;
      const used = shared.token();
      this.setRequestHeader("x-agentic-client", "app");
      if (used) this.setRequestHeader("authorization", `Bearer ${used}`);
      this.addEventListener("loadend", () => {
        if (!this.status) return;
        const text = typeof this.response === "string" ? this.response : "";
        observe(t.path, this.status, this.getResponseHeader("x-agentic-session"), async () => JSON.parse(text || "null"), used);
      });
    }
    send.call(this, body);
  };

  // ------------------------------------------------------------ EventSource (live events)
  const RealEventSource = window.EventSource;
  class AppEventSource extends EventTarget {
    static readonly CONNECTING = 0;
    static readonly OPEN = 1;
    static readonly CLOSED = 2;
    readonly CONNECTING = 0;
    readonly OPEN = 1;
    readonly CLOSED = 2;
    readonly url: string;
    readonly withCredentials = false;
    readyState = 0;
    onopen: ((this: EventSource, ev: Event) => unknown) | null = null;
    onmessage: ((this: EventSource, ev: MessageEvent) => unknown) | null = null;
    onerror: ((this: EventSource, ev: Event) => unknown) | null = null;
    private ctl: AbortController | null = null;
    private lastId = "";
    private retry = 3000;
    private timer: ReturnType<typeof setTimeout> | undefined;

    constructor(url: string | URL) {
      super();
      this.url = new URL(String(url), location.href).href;
      void this.connect();
    }

    private fire(ev: Event) {
      const handler = (this as unknown as Record<string, unknown>)[`on${ev.type}`];
      if (typeof handler === "function") handler.call(this, ev);
      this.dispatchEvent(ev);
    }

    private again() {
      if (this.readyState === 2) return;
      this.readyState = 0;
      this.fire(new Event("error"));
      if (this.readyState === 2) return; // closed by the error handler
      clearTimeout(this.timer);
      this.timer = setTimeout(() => void this.connect(), this.retry);
    }

    private async connect() {
      if (this.readyState === 2) return;
      const ctl = (this.ctl = new AbortController());
      const headers: Record<string, string> = { accept: "text/event-stream" };
      if (this.lastId) headers["last-event-id"] = this.lastId;
      let res: Response;
      try {
        res = await window.fetch(this.url, { headers, signal: ctl.signal, cache: "no-store" });
      } catch {
        if (!ctl.signal.aborted) this.again();
        return;
      }
      if (!res.ok || !res.body || !(res.headers.get("content-type") ?? "").startsWith("text/event-stream")) {
        // As a browser does: a refused stream (signed out, gone) is closed, not retried.
        this.readyState = 2;
        void res.body?.cancel().catch(() => undefined);
        this.fire(new Event("error"));
        return;
      }
      this.readyState = 1;
      this.fire(new Event("open"));
      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
      let buf = "";
      let data: string[] = [];
      let type = "";
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += value;
          let i: number;
          while ((i = buf.search(/\r\n|\r|\n/)) >= 0) {
            const line = buf.slice(0, i);
            buf = buf.slice(i + (buf[i] === "\r" && buf[i + 1] === "\n" ? 2 : 1));
            if (line === "") {
              if (data.length) {
                const ev = new MessageEvent(type || "message", { data: data.join("\n"), lastEventId: this.lastId, origin: new URL(this.url).origin });
                if (ev.type === "message") this.fire(ev);
                else this.dispatchEvent(ev);
              }
              data = [];
              type = "";
              continue;
            }
            if (line.startsWith(":")) continue;
            const c = line.indexOf(":");
            const field = c < 0 ? line : line.slice(0, c);
            let val = c < 0 ? "" : line.slice(c + 1);
            if (val.startsWith(" ")) val = val.slice(1);
            if (field === "data") data.push(val);
            else if (field === "event") type = val;
            else if (field === "id" && !val.includes("\0")) this.lastId = val;
            else if (field === "retry" && /^\d+$/.test(val)) this.retry = Number(val);
          }
        }
      } catch {
        /* dropped or closed */
      }
      if (!ctl.signal.aborted) this.again();
    }

    close() {
      this.readyState = 2;
      clearTimeout(this.timer);
      this.ctl?.abort();
    }
  }
  window.EventSource = AppEventSource as unknown as typeof EventSource;
  void RealEventSource;

  // ------------------------------------------------------------ images, sound, video, frames
  const TAGS = new Set(["IMG", "AUDIO", "VIDEO", "SOURCE", "IFRAME", "EMBED", "TRACK"]);
  const realSetAttribute = Element.prototype.setAttribute;
  const shown = new WeakMap<Element, string>(); // the blob: address in use, revoked when replaced
  const wanted = new WeakMap<Element, string>(); // the last /api/... address asked for

  /** A private file (/api/...): fetched with the token, then shown from memory. */
  async function showPrivate(el: Element, attr: string, url: string) {
    wanted.set(el, url);
    if (el.tagName === "IFRAME" && !el.hasAttribute("sandbox")) {
      // The server's own sandbox header does not travel with a copy in memory: the frame gets one.
      realSetAttribute.call(el, "sandbox", "");
    }
    try {
      const res = await window.fetch(url);
      if (!res.ok) throw new Error(String(res.status));
      const href = URL.createObjectURL(await res.blob());
      if (wanted.get(el) !== url) return URL.revokeObjectURL(href);
      const old = shown.get(el);
      if (old) URL.revokeObjectURL(old);
      shown.set(el, href);
      realSetAttribute.call(el, attr, href);
    } catch {
      if (wanted.get(el) === url) el.dispatchEvent(new Event("error"));
    }
  }

  /** What to really set for src/poster on a media element; null: set nothing now. */
  function mediaValue(el: Element, attr: string, value: string): string | null {
    if (!TAGS.has(el.tagName) || (attr !== "src" && attr !== "poster")) return value;
    const t = target(value);
    if (!t) {
      wanted.delete(el);
      return value;
    }
    if (!t.api) return t.url;
    void showPrivate(el, attr, value);
    return null;
  }

  Element.prototype.setAttribute = function (this: Element, name: string, value: string) {
    const lower = name.toLowerCase();
    if (lower === "src" || lower === "poster") {
      const v = mediaValue(this, lower, String(value));
      if (v !== null) realSetAttribute.call(this, name, v);
      return;
    }
    realSetAttribute.call(this, name, value);
  };

  const props: [{ prototype: object } | undefined, string][] = [
    [window.HTMLImageElement, "src"],
    [window.HTMLMediaElement, "src"],
    [window.HTMLSourceElement, "src"],
    [window.HTMLIFrameElement, "src"],
    [window.HTMLEmbedElement, "src"],
    [window.HTMLTrackElement, "src"],
    [window.HTMLVideoElement, "poster"],
  ];
  for (const [cls, prop] of props) {
    const d = cls && Object.getOwnPropertyDescriptor(cls.prototype, prop);
    if (!cls || !d?.set || !d.get) continue;
    const set = d.set;
    Object.defineProperty(cls.prototype, prop, {
      ...d,
      set(this: Element, value: string) {
        const v = mediaValue(this, prop, String(value));
        if (v !== null) set.call(this, v);
      },
    });
  }

  // Markup added as HTML text (not through setAttribute): fix it as it arrives.
  const fix = (el: Element) => {
    for (const attr of ["src", "poster"]) {
      const v = el.getAttribute(attr);
      if (v && !v.startsWith("blob:") && target(v)) {
        const real = mediaValue(el, attr, v);
        if (real !== null && real !== v) realSetAttribute.call(el, attr, real);
        else if (real === null) el.removeAttribute(attr);
      }
    }
  };
  new MutationObserver((records) => {
    for (const r of records)
      for (const n of r.addedNodes) {
        if (!(n instanceof Element)) continue;
        if (TAGS.has(n.tagName)) fix(n);
        for (const el of n.querySelectorAll("img,audio,video,source,iframe,embed,track")) fix(el);
      }
  }).observe(document, { childList: true, subtree: true });

  // ------------------------------------------------------------ workers from the server (receipt reader)
  // A worker's script must come from the page's own origin. For one the app does not carry
  // (Prima's /prima/ocr/worker.min.js), start a small worker here that loads the server's script
  // and sends its own downloads (importScripts, fetch) to the server too.
  const RealWorker = window.Worker;
  const remoteSources = JSON.stringify(REMOTE_FILES.map((r) => r.source));
  function AppWorker(this: unknown, url: string | URL, options?: WorkerOptions): Worker {
    const t = target(url);
    if (!t || t.api || options?.type === "module") return new RealWorker(url, options);
    const prelude = `(() => {
  const origin = ${JSON.stringify(ORIGIN)}, server = ${JSON.stringify(SERVER)};
  const remote = ${remoteSources}.map((s) => new RegExp(s));
  const map = (u) => {
    try {
      const x = new URL(String(u), origin + "/");
      return x.origin === origin && remote.some((r) => r.test(x.pathname)) ? server + x.pathname + x.search : String(u);
    } catch { return u; }
  };
  const load = self.importScripts.bind(self);
  self.importScripts = (...urls) => load(...urls.map(map));
  const get = self.fetch.bind(self);
  self.fetch = (input, init) => get(typeof input === "string" || input instanceof URL ? map(input) : input, init);
  load(${JSON.stringify(t.url)});
})();`;
    const href = URL.createObjectURL(new Blob([prelude], { type: "text/javascript" }));
    return new RealWorker(href, options);
  }
  AppWorker.prototype = RealWorker.prototype;
  window.Worker = AppWorker as unknown as typeof Worker;

  // ------------------------------------------------------------ no service workers in the app
  const sw = navigator.serviceWorker as ServiceWorkerContainer | undefined;
  if (sw) {
    try {
      sw.register = () => Promise.reject(new Error("The phone app keeps its files itself."));
      void sw.getRegistrations().then((all) => all.forEach((r) => void r.unregister())).catch(() => undefined);
    } catch {
      /* not available here */
    }
  }
}

if (!openPrimaFolder()) {
  const shared = sharedState();
  window.__agenticApp = shared;
  install(shared);
  document.documentElement.dataset.app = Capacitor.getPlatform();
}
