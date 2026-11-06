/**
 * P75: the office's feedback button as a stand-alone widget, for pages outside the office app
 * (Prima at /prima/). Built by vite.widget.config.ts into /feedback-widget.js; a page adds
 *   <script type="module" src="/feedback-widget.js"></script>
 * and gets the same button, screenshots, notes, Rules & guide and My feedback as the office.
 *
 * Same site, so the office's session cookie and CSRF echo carry the calls to /api/feedback.
 * It shows only for someone signed in to the office while the developer has feedback on. It
 * lives in a shadow root: the office's look comes with it and the page's own styles stay out
 * (and the other way round). Light or dark follows the page (<html data-theme>, which Prima sets
 * from the office's saved choice); the language follows Prima's (prima.lang).
 *
 * P80: a page with its own launcher (Prima) sets window.__agenticLauncher = "host" first: no
 * button here, and the page opens the panels through window.AgenticFeedback (host.ts).
 */
import { HOST_LANG } from "./keep-lang"; // first: before the office i18n touches <html lang>

import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { Toaster } from "sonner";
import sonnerCss from "sonner/dist/styles.css?inline";

import { IGNORE_ATTR } from "@/components/feedback/capture";
import { Feedback } from "@/components/feedback/core";
import { setFeedbackLayerParent } from "@/components/feedback/liquid-layer";
import { useLang } from "@/i18n";
import { api } from "@/lib/api";
import { feedbackConfigQuery } from "@/lib/feedback";
import type { Me } from "@/lib/types";

import { createBridge, hostMode, type Bridge } from "./host";
import { primaPath, readPrimaLang, readPrimaPage, widgetUnwelcome } from "./prima";
import { PrimaRulesPanel } from "./prima-rules";
import css from "./widget.css?inline";

type Theme = "light" | "dark";

function pageTheme(): Theme {
  const set = document.documentElement.dataset.theme;
  if (set === "dark" || set === "light") return set;
  let pref = "system";
  try {
    pref = localStorage.getItem("agentic.theme") || "system";
  } catch {
    /* storage blocked: follow the device */
  }
  return pref === "dark" || (pref === "system" && window.matchMedia?.("(prefers-color-scheme: dark)").matches) ? "dark" : "light";
}

/** The page's light or dark, kept up to date (Prima switches it live, and so can another tab). */
function useTheme(apply: (t: Theme) => void): Theme {
  const [theme, setTheme] = useState<Theme>(pageTheme);
  useEffect(() => {
    const sync = () => setTheme(pageTheme());
    const mo = new MutationObserver(sync);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    window.addEventListener("storage", sync);
    const mq = window.matchMedia?.("(prefers-color-scheme: dark)");
    mq?.addEventListener?.("change", sync);
    return () => {
      mo.disconnect();
      window.removeEventListener("storage", sync);
      mq?.removeEventListener?.("change", sync);
    };
  }, []);
  useEffect(() => {
    apply(theme);
  }, [apply, theme]);
  return theme;
}

const syncLang = () => {
  const lang = readPrimaLang();
  if (useLang.getState().lang !== lang) useLang.setState({ lang });
};

// The first screen has no hash yet: Prima's own word for it then.
const here = () => primaPath(window.location.pathname, window.location.hash || `#${readPrimaPage().view}`);

export function Widget({ applyTheme, bridge }: { applyTheme: (t: Theme) => void; bridge?: Bridge }) {
  const theme = useTheme(applyTheme);
  const me = useQuery({ queryKey: ["feedback-widget", "me"], queryFn: () => api<Me>("/api/auth/me"), staleTime: 60_000, retry: false });
  const signedIn = !!me.data && !me.data.user.must_change_password && !me.data.user.two_factor_setup_required;
  const cfg = useQuery({ ...feedbackConfigQuery, enabled: signedIn });
  const who = me.data;
  const on = !!(signedIn && who && cfg.data?.enabled);
  // P80: the host page hears once whether feedback is on for this person, then any change.
  const decided = !me.isPending && (!signedIn || !cfg.isPending);
  useEffect(() => {
    if (bridge && decided) bridge.setEnabled(on);
  }, [bridge, decided, on]);
  return (
    <>
      {on && who ? (
        <Feedback
          page={() => ({ path: here(), title: readPrimaPage().name })}
          rules={({ rules, onClose, onTour }) => <PrimaRulesPanel me={who} page={readPrimaPage()} path={here()} rules={rules} onClose={onClose} onTour={onTour} />}
          onOpen={syncLang}
          hosted={!!bridge}
          control={bridge?.setControl}
          onPanel={bridge?.setPanel}
        />
      ) : null}
      <Toaster
        theme={theme}
        position="top-center"
        toastOptions={{
          classNames: {
            toast: "!bg-surface !text-fg !border-border !rounded-[var(--radius-md)] !shadow-[var(--shadow-pop)] !font-sans",
            description: "!text-muted",
          },
        }}
      />
    </>
  );
}

export function mount(): void {
  if (widgetUnwelcome() || document.getElementById("agentic-feedback")) return;
  const bridge = hostMode() ? createBridge() : undefined;

  // Tailwind's @property rules do nothing inside a shadow root; registered on the page they
  // apply everywhere (shadows, rings and transforms need their starting values).
  const props = css.match(/@property\s+[^{]+\{[^}]*\}/g) ?? [];
  if (props.length) {
    const s = document.createElement("style");
    s.id = "agentic-feedback-props";
    s.setAttribute(IGNORE_ATTR, "");
    s.textContent = props.join("\n");
    document.head.appendChild(s);
  }

  const host = document.createElement("div");
  host.id = "agentic-feedback";
  host.setAttribute(IGNORE_ATTR, "");
  host.style.cssText = "position:fixed;top:0;left:0;width:0;height:0;z-index:2147483000;";
  document.body.appendChild(host);
  const shadow = host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  // The theme's :root is the shadow host here.
  style.textContent = `${css.replaceAll(":root", ":host")}\n${sonnerCss}`;
  shadow.appendChild(style);
  const root = document.createElement("div");
  root.className = "fb-root";
  root.dataset.theme = pageTheme();
  shadow.appendChild(root);
  setFeedbackLayerParent(root);

  syncLang();
  const app = document.createElement("div");
  root.appendChild(app);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  createRoot(app).render(
    <StrictMode>
      <QueryClientProvider client={client}>
        <Widget applyTheme={(t) => (root.dataset.theme = t)} bridge={bridge} />
      </QueryClientProvider>
    </StrictMode>,
  );
}

// The office's i18n set <html lang> as it loaded: the page's own comes back.
if (HOST_LANG === null) document.documentElement.removeAttribute("lang");
else document.documentElement.setAttribute("lang", HOST_LANG);

mount();
