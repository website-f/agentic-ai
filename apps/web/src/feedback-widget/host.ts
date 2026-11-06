/**
 * P80: the widget inside a page that has its own launcher (Prima: one round button for its
 * assistant Arisha, feedback and Rules & guide). The page sets, before it loads the widget,
 *   window.__agenticLauncher = "host"
 * and the widget then draws no floating button of its own. The page reaches it through
 *   window.AgenticFeedback = { open("feedback" | "guide"), close(), isOpen(), enabled }
 * and hears it through two window events:
 *   "agentic-feedback:ready"  once it knows whether feedback is on for this person ({enabled});
 *   "agentic-feedback:state"  a panel opened or closed, or feedback was turned on or off
 *                             ({open, panel, enabled}).
 * `enabled` is false when feedback is off for this person (not signed in, or the developer has
 * it off): then open() does nothing and returns false. Without the flag nothing here is used.
 */
import type { FeedbackControl, FeedbackPanel } from "@/components/feedback/core";

export const READY_EVENT = "agentic-feedback:ready";
export const STATE_EVENT = "agentic-feedback:state";

export interface AgenticFeedbackApi {
  open(panel: FeedbackPanel): boolean;
  close(): void;
  isOpen(): boolean;
  readonly enabled: boolean;
}

export interface FeedbackState {
  open: boolean;
  panel: FeedbackPanel | null;
  enabled: boolean;
}

declare global {
  interface Window {
    __agenticLauncher?: string;
    AgenticFeedback?: AgenticFeedbackApi;
  }
}

export function hostMode(win: Window = window): boolean {
  return win.__agenticLauncher === "host";
}

export interface Bridge {
  api: AgenticFeedbackApi;
  setControl(c: FeedbackControl | null): void;
  setEnabled(on: boolean): void;
  setPanel(panel: FeedbackPanel | null): void;
}

/** The page's handle on the widget, published as window.AgenticFeedback. */
export function createBridge(win: Window = window): Bridge {
  let control: FeedbackControl | null = null;
  let enabled = false;
  let decided = false;
  let panel: FeedbackPanel | null = null;
  const fire = (type: string, detail: unknown) => win.dispatchEvent(new CustomEvent(type, { detail }));
  const state = () => fire(STATE_EVENT, { open: panel !== null, panel, enabled } satisfies FeedbackState);
  const api: AgenticFeedbackApi = {
    open: (p) => {
      if (!enabled || !control || (p !== "feedback" && p !== "guide")) return false;
      control.open(p);
      return true;
    },
    close: () => control?.close(),
    isOpen: () => panel !== null,
    get enabled() {
      return enabled;
    },
  };
  win.AgenticFeedback = api;
  return {
    api,
    setControl(c) {
      control = c;
    },
    setEnabled(on) {
      const was = enabled;
      enabled = on;
      if (!on) panel = null;
      if (!decided) {
        decided = true;
        fire(READY_EVENT, { enabled });
      } else if (was !== on) state();
    },
    setPanel(p) {
      if (p === panel) return;
      panel = p;
      state();
    },
  };
}
