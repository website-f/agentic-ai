/** P118 (Fitri, 19 Nov 2026: personal and work email tabs; a shared work email many people use):
 * which of the person's own Microsoft accounts the Microsoft 365 page shows. The main account
 * (their sign-in, their AI, Teams and Prima) first, then extra ones: personal, or a shared work
 * mailbox, marked "Shared with N" when others here connected it too. "Add another Microsoft
 * account" connects one more. The pick is remembered on this device and only applies on this
 * page; everywhere else uses the main account. */
import { BriefcaseIcon, CaretDownIcon, CheckIcon, PlusIcon, TrashIcon, UserIcon, UsersThreeIcon } from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { Fragment, useState } from "react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/ui/confirm";
import { Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger } from "@/components/ui/menu";
import { useT } from "@/i18n";
import { errorMessage } from "@/lib/api";
import { myMailboxesQuery, nameMsAccount, removeMsAccount, startAnotherConnect, type MsAccount } from "@/lib/microsoft";
import { meQuery } from "@/lib/queries";
import { cn } from "@/lib/utils";

import { refreshMsAccounts, useMailboxPick } from "./mailbox-pick";

/** "Work", "Personal", "Shared" or the person's own word. */
export function useKindOf() {
  const t = useT();
  // P143a: a personal Microsoft account (Outlook.com, Hotmail) is Personal, even as the main one.
  return (a: MsAccount) => a.label || (a.consumer ? t("Personal") : a.primary || a.kind === "work" ? t("Work") : a.shared_with > 0 ? t("Shared") : t("Personal"));
}

/** P143a (owner, 27 Nov 2026: "Outlook personal accounts can't be found in Microsoft 365 in their
 * Calendar tab"): the Calendar tab names whose calendar it shows and lists each of the person's own
 * connected Microsoft accounts, work and personal (Outlook.com, Hotmail), main or extra. Picking
 * one is the same pick as the account menu beside the title (./mailbox-pick.ts). */
export function CalendarAccountPicker({ accounts, shownId, onPick }: {
  accounts: MsAccount[];
  /** The account shown now; null: none yet (the main one is not connected). */
  shownId: string | null;
  onPick: (a: MsAccount) => void;
}) {
  const t = useT();
  const kindOf = useKindOf();
  return (
    <div role="radiogroup" aria-label={t("Which calendar")} className="flex min-w-0 flex-wrap gap-1.5">
      {accounts.map((a) => {
        const on = a.id === shownId;
        return (
          <button key={a.id} type="button" role="radio" aria-checked={on} onClick={() => onPick(a)}
            className={cn("flex max-w-full min-w-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-left text-[12.5px] transition-colors focus-visible:ring-3 focus-visible:ring-accent/25 focus-visible:outline-none",
              on ? "border-accent/50 bg-accent-soft text-accent" : "border-border bg-surface hover:border-accent/40")}>
            {a.consumer || (!a.primary && a.kind !== "work") ?<UserIcon size={14} className="shrink-0" /> : <BriefcaseIcon size={14} className="shrink-0" />}
            <span className="shrink-0 font-medium">{kindOf(a)}</span>
            <span className={cn("min-w-0 truncate", on ? "text-accent/80" : "text-muted")}>{a.email}</span>
          </button>
        );
      })}
    </div>
  );
}

/** P122: the pick itself lives in ./mailbox-pick.ts (shared with the Work / Personal tabs), and
 * the accounts come with the page's one list of mailboxes (no second request). */
export function AccountSwitcher() {
  const t = useT();
  const qc = useQueryClient();
  const kindOf = useKindOf();
  const { data: me } = useSuspenseQuery(meQuery);
  const accounts = useQuery(myMailboxesQuery);
  const picked = useMailboxPick((s) => s.ms);
  const pickMs = useMailboxPick((s) => s.pickMs);
  const [removing, setRemoving] = useState<MsAccount | null>(null);
  const list = (accounts.data?.accounts ?? []).filter((a) => a.connected);
  const current = list.find((a) => a.id === picked && !a.primary) ?? list.find((a) => a.primary) ?? null;
  const pick = (a: MsAccount) => pickMs(a.primary ? null : a.id);
  const add = useMutation({
    mutationFn: startAnotherConnect,
    onSuccess: (r) => window.location.assign(r.url),
    onError: (e) => toast.error(errorMessage(e)),
  });
  const rename = useMutation({
    mutationFn: ({ id, label }: { id: string; label: string }) => nameMsAccount(id, label),
    onSuccess: () => refreshMsAccounts(qc),
    onError: (e) => toast.error(errorMessage(e)),
  });
  if (!current) return null;
  const KindIcon = current.shared_with > 0 ? UsersThreeIcon : UserIcon;
  return (
    <>
      <Menu>
        <MenuTrigger asChild>
          <button type="button" aria-label={t("Which account")}
            className="flex min-w-0 max-w-[16rem] items-center gap-1.5 rounded-full border border-border bg-surface-2/60 py-1 pr-2 pl-2.5 text-left text-[12.5px] transition-colors hover:border-accent/40">
            <KindIcon size={14} className="shrink-0 text-accent" />
            <span className="shrink-0 font-medium">{kindOf(current)}</span>
            <span className="min-w-0 truncate text-muted max-sm:hidden">{current.email}</span>
            <CaretDownIcon size={12} weight="bold" className="shrink-0 text-muted" />
          </button>
        </MenuTrigger>
        <MenuContent align="start" className="w-80">
          <MenuLabel>{t("Your Microsoft accounts")}</MenuLabel>
          {(["work", "personal"] as const).map((kind) => {
            const group = list.filter((a) => (a.kind ?? (a.primary ? "work" : "personal")) === kind);
            if (!group.length) return null;
            return (
              <Fragment key={kind}>
                <p className="px-2.5 pt-1.5 text-[11px] font-semibold tracking-[0.06em] text-muted uppercase">{kind === "work" ? t("Work") : t("Personal")}</p>
                {group.map((a) => <AccountItem key={a.id} a={a} on={a.id === current.id} onPick={() => pick(a)} />)}
              </Fragment>
            );
          })}
          {!current.primary ? (
            <>
              <MenuSeparator />
              <MenuLabel>{t("Call this account")}</MenuLabel>
              {[t("Personal"), t("Shared"), t("Work")].map((w) => (
                <MenuItem key={w} onSelect={() => rename.mutate({ id: current.id, label: w })}>
                  <span className="flex-1">{w}</span>
                  {current.label === w ? <CheckIcon size={14} className="text-accent" /> : null}
                </MenuItem>
              ))}
              <MenuItem danger icon={<TrashIcon />} onSelect={() => setRemoving(current)}>{t("Remove this account")}</MenuItem>
            </>
          ) : null}
          <MenuSeparator />
          <MenuItem icon={<PlusIcon />} disabled={add.isPending} onSelect={() => add.mutate()}>{t("Add another Microsoft account")}</MenuItem>
          <p className="px-2.5 pt-1 pb-2 text-[11.5px] leading-snug text-muted">
            {t("You always sign in with {email}. Your AI, Teams and Prima use your main account.", { email: me.user.email })}
          </p>
        </MenuContent>
      </Menu>
      <ConfirmDialog
        open={!!removing}
        onOpenChange={(o) => !o && setRemoving(null)}
        title={t("Remove {email}?", { email: removing?.email ?? "" })}
        body={t("Its mail stops showing here and the office forgets its sign-in. Nothing is deleted in the mailbox itself.")}
        confirmLabel={t("Remove")}
        danger
        onConfirm={async () => {
          if (!removing) return;
          await removeMsAccount(removing.id);
          pickMs(null);
          setRemoving(null);
          refreshMsAccounts(qc);
        }}
      />
    </>
  );
}

function AccountItem({ a, on, onPick }: { a: MsAccount; on: boolean; onPick: () => void }) {
  const t = useT();
  const kindOf = useKindOf();
  return (
    <MenuItem onSelect={onPick} className={cn(on && "bg-accent-soft/50")}>
      <span className="grid min-w-0 flex-1">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="font-medium">{kindOf(a)}</span>
          {a.primary ? <span className="rounded-sm bg-surface-2 px-1 text-[11px] text-muted">{t("Main account")}</span> : null}
          {a.shared_with > 0 ? <span className="rounded-sm bg-warn/12 px-1 text-[11px] text-warn">{t("Shared with {n}", { n: a.shared_with })}</span> : null}
        </span>
        <span className="truncate text-[12px] text-muted">{a.email}</span>
      </span>
      {on ? <CheckIcon size={15} weight="bold" className="shrink-0 text-accent" /> : null}
    </MenuItem>
  );
}
