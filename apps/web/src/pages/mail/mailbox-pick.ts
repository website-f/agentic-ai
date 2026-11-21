/** P122: which mailbox the Microsoft 365 page shows, in one place for the Work / Personal tabs
 * (./places.tsx) and the account menu beside the title (./account-switcher.tsx), so the two
 * always agree.
 *
 * - A Microsoft account of the person's own: the main one (none picked), or an extra one
 *   (P118: kept on this device per person; the page's /api/m365 calls carry its id as
 *   X-M365-Account, see lib/api.ts). Leaving the page goes back to the main one, so the pick
 *   never changes anything outside this page.
 * - A company shared mailbox: ?box=<id> in the address (what the server's notices link to).
 * - Another email account (Gmail, IMAP): its card, for this visit only. */
import { useMutation, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { create } from "zustand";

import { errorMessage, setM365Account } from "@/lib/api";
import { m365Keys } from "@/lib/m365";
import type { MailKind } from "@/lib/mail-kind";
import { msAccountsQuery, myMailboxesQuery, startAnotherConnect, startMicrosoftConnect } from "@/lib/microsoft";

const key = (userId: string) => `agentic.m365.account:${userId}`;

export function readPick(userId: string): string | null {
  try {
    return localStorage.getItem(key(userId));
  } catch {
    return null;
  }
}

export function savePick(userId: string, id: string | null) {
  try {
    if (id) localStorage.setItem(key(userId), id);
    else localStorage.removeItem(key(userId));
  } catch {
    /* private mode: kept until the page reloads */
  }
}

interface PickState {
  userId: string | null;
  /** An extra Microsoft account's id; null: the main account. */
  ms: string | null;
  /** Another email account shown (an IMAP account's id, or "google"); null: none. */
  other: string | null;
  /** The tab the person chose; null: the tab of what is shown. */
  tab: MailKind | null;
  load: (userId: string) => void;
  pickMs: (id: string | null) => void;
  pickOther: (id: string | null) => void;
  setTab: (tab: MailKind) => void;
}

export const useMailboxPick = create<PickState>((set, get) => ({
  userId: null,
  ms: null,
  other: null,
  tab: null,
  load: (userId) => {
    if (get().userId !== userId) set({ userId, ms: readPick(userId), other: null, tab: null });
  },
  pickMs: (id) => {
    const { userId } = get();
    if (userId) savePick(userId, id);
    set({ ms: id, other: null, tab: null });
  },
  pickOther: (id) => set({ other: id, tab: null }),
  setTab: (tab) => set({ tab }),
}));

/** After adding, naming or removing a Microsoft account: both lists that show them. */
export function refreshMsAccounts(qc: QueryClient) {
  void qc.invalidateQueries({ queryKey: msAccountsQuery.queryKey });
  void qc.invalidateQueries({ queryKey: myMailboxesQuery.queryKey });
}

/** Call once on the page: the /api/m365 calls go to the account picked (an extra one that is
 * still connected), and back to the main one when the page closes. */
export function useM365Routing(userId: string, extraIds: string[] | undefined) {
  const qc = useQueryClient();
  const load = useMailboxPick((s) => s.load);
  const ms = useMailboxPick((s) => s.ms);
  useEffect(() => load(userId), [load, userId]);
  // Until the accounts are known, the main account (an old pick may have been removed).
  const extraId = ms && extraIds?.includes(ms) ? ms : null;
  const shown = useRef<string | null>(null);
  useEffect(() => {
    setM365Account(extraId);
    if (shown.current === extraId) return; // the main account at first: nothing to reload
    shown.current = extraId;
    void qc.resetQueries({ queryKey: m365Keys.all });
  }, [extraId, qc]);
  // Speed: the main account's mail stays cached for the next visit; only an extra account's is
  // dropped (it must never show under the main account's keys elsewhere).
  useEffect(() => () => {
    setM365Account(null);
    if (shown.current) void qc.resetQueries({ queryKey: m365Keys.all });
  }, [qc]);
  return extraId;
}

/** "Add another Microsoft account" (work or personal, as many as needed): Microsoft's own
 * sign-in page, back on this page, where the new account shows on its tab. With no main
 * account connected yet, this connects the main one (an extra one needs a main one first). */
export function useMicrosoftAdd(hasMain = true) {
  return useMutation({
    mutationFn: hasMain ? startAnotherConnect : startMicrosoftConnect,
    onSuccess: (r) => window.location.assign(r.url),
    onError: (e) => toast.error(errorMessage(e)),
  });
}
