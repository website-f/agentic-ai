/**
 * P80: the stand-alone widget in host mode (Prima's own launcher): no floating button of its
 * own, opened through window.AgenticFeedback, heard through its window events. Without the flag
 * it is the office's button as before.
 */
import { act, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { READY_EVENT, STATE_EVENT, createBridge, type FeedbackState } from "./host";

const ME = { user: { id: "u1", name: "Aina", email: "aina@example.com", must_change_password: false, two_factor_setup_required: false }, workspace: { id: "w1" }, role: "staff", permissions: [] };

function office(feedbackOn = true) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const path = typeof input === "string" ? input : input instanceof URL ? input.pathname : input.url;
    if (path.startsWith("/api/auth/me")) return new Response(JSON.stringify(ME), { status: 200, headers: { "content-type": "application/json" } });
    if (path.startsWith("/api/feedback/config"))
      return new Response(JSON.stringify({ enabled: feedbackOn, rules: [] }), { status: 200, headers: { "content-type": "application/json" } });
    return new Response(JSON.stringify([]), { status: 200, headers: { "content-type": "application/json" } });
  });
}

const shadow = () => document.getElementById("agentic-feedback")?.shadowRoot ?? null;
// The floating button is the only one that says whether it is expanded (its label is translated).
const ownButton = () => shadow()?.querySelector("button[aria-expanded]") ?? null;

async function load(flag: string | undefined, feedbackOn = true) {
  vi.resetModules();
  vi.stubGlobal("fetch", office(feedbackOn));
  if (flag === undefined) delete window.__agenticLauncher;
  else window.__agenticLauncher = flag;
  const events: { type: string; detail: FeedbackState | { enabled: boolean } }[] = [];
  const hear = (e: Event) => events.push({ type: e.type, detail: (e as CustomEvent).detail });
  window.addEventListener(READY_EVENT, hear);
  window.addEventListener(STATE_EVENT, hear);
  await act(async () => {
    await import("./main");
  });
  return events;
}

// The first import builds the whole widget (its styles too): slow on a cold cache.
describe("P80 feedback widget host mode", { timeout: 90_000 }, () => {
  beforeEach(() => {
    // jsdom has no matchMedia (the panels ask about reduced motion and dark mode).
    vi.stubGlobal("matchMedia", (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }));
    // jsdom has no modal dialogs: the panels fall back to the open attribute.
    HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
      this.removeAttribute("open");
    };
    document.body.innerHTML = "";
    document.head.querySelectorAll("#agentic-feedback-props").forEach((e) => e.remove());
    delete window.AgenticFeedback;
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    delete window.__agenticLauncher;
  });

  it("draws no button of its own, says when it is ready, and opens and closes on the page's word", async () => {
    const events = await load("host");
    await waitFor(() => expect(events.find((e) => e.type === READY_EVENT)).toBeTruthy(), { timeout: 30_000 });
    expect(events.find((e) => e.type === READY_EVENT)?.detail).toEqual({ enabled: true });
    const fb = window.AgenticFeedback!;
    expect(fb.enabled).toBe(true);
    expect(fb.isOpen()).toBe(false);
    expect(shadow()).not.toBeNull();
    expect(ownButton()).toBeNull();
    expect(shadow()!.querySelectorAll("button").length).toBe(0);

    act(() => {
      expect(fb.open("guide")).toBe(true);
    });
    await waitFor(() => expect(fb.isOpen()).toBe(true));
    expect(events.filter((e) => e.type === STATE_EVENT).at(-1)?.detail).toEqual({ open: true, panel: "guide", enabled: true });

    act(() => fb.close());
    await waitFor(() => expect(fb.isOpen()).toBe(false));
    expect(events.filter((e) => e.type === STATE_EVENT).at(-1)?.detail).toEqual({ open: false, panel: null, enabled: true });

    act(() => {
      expect(fb.open("feedback")).toBe(true);
    });
    await waitFor(() => expect(events.filter((e) => e.type === STATE_EVENT).at(-1)?.detail).toEqual({ open: true, panel: "feedback", enabled: true }));
    // Still no floating button while a panel is open.
    expect(ownButton()).toBeNull();
  });

  it("is not enabled when feedback is off for this person: open() does nothing", async () => {
    const events = await load("host", false);
    await waitFor(() => expect(events.find((e) => e.type === READY_EVENT)?.detail).toEqual({ enabled: false }), { timeout: 30_000 });
    const fb = window.AgenticFeedback!;
    expect(fb.enabled).toBe(false);
    expect(fb.open("feedback")).toBe(false);
    expect(fb.isOpen()).toBe(false);
  });

  it("without the flag it is the office's own button, as before", async () => {
    await load(undefined);
    await waitFor(() => expect(ownButton()).not.toBeNull(), { timeout: 30_000 });
    expect(window.AgenticFeedback).toBeUndefined();
  });

  it("the bridge ignores an unknown panel and reports each change once", () => {
    const heard: string[] = [];
    window.addEventListener(STATE_EVENT, (e) => heard.push(JSON.stringify((e as CustomEvent).detail)));
    const b = createBridge();
    const opened: string[] = [];
    b.setControl({ open: (p) => opened.push(p), close: () => b.setPanel(null), isOpen: () => false });
    expect(b.api.open("feedback")).toBe(false); // not decided yet: off
    b.setEnabled(true);
    expect(b.api.open("nonsense" as "guide")).toBe(false);
    expect(b.api.open("guide")).toBe(true);
    expect(opened).toEqual(["guide"]);
    b.setPanel("guide");
    b.setPanel("guide");
    b.api.close();
    expect(heard).toEqual([JSON.stringify({ open: true, panel: "guide", enabled: true }), JSON.stringify({ open: false, panel: null, enabled: true })]);
  });
});
