/** P118 (Fitri, 19 Nov 2026: personal and work email tabs; a shared work email many people use):
 * which of the person's own Microsoft accounts the Microsoft 365 page shows. The main account
 * (their sign-in, their AI, Teams and Prima) first, then extra ones: personal, or a shared work
 * mailbox, marked "Shared with N" when others here connected it too. "Add another Microsoft
 * account" connects one more. The pick is remembered on this device and only applies on this
 * page; everywhere else uses the main account. */
import { CaretDownIcon, CheckIcon, PlusIcon, TrashIcon, UserIcon, UsersThreeIcon } from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/ui/confirm";
import { Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger } from "@/components/ui/menu";
import { useT } from "@/i18n";
import { errorMessage, setM365Account } from "@/lib/api";
import { m365Keys } from "@/lib/m365";
import { msAccountsQuery, nameMsAccount, removeMsAccount, startAnotherConnect, type MsAccount } from "@/lib/microsoft";
import { meQuery } from "@/lib/queries";
import { cn } from "@/lib/utils";

const key = (userId: string) => `agentic.m365.account:${userId}`;

function readPick(userId: string): string | null {
  try {
    return localStorage.getItem(key(userId));
  } catch {
    return null;
  }
}

function savePick(userId: string, id: string | null) {
  try {
    if (id) localStorage.setItem(key(userId), id);
    else localStorage.removeItem(key(userId));
  } catch {
    /* private mode: kept until the page reloads */
  }
}

/** "Work", "Personal", "Shared" or the person's own word. */
export function useKindOf() {
  const t = useT();
  return (a: MsAccount) => a.label || (a.primary ? t("Work") : a.shared_with > 0 ? t("Shared") : t("Personal"));
}

export function AccountSwitcher() {
  const t = useT();
  const qc = useQueryClient();
  const kindOf = useKindOf();
  const { data: me } = useSuspenseQuery(meQuery);
  const accounts = useQuery(msAccountsQuery);
  const [picked, setPicked] = useState<string | null>(() => readPick(me.user.id));
  const [removing, setRemoving] = useState<MsAccount | null>(null);
  const list = (accounts.data ?? []).filter((a) => a.connected);
  const current = list.find((a) => a.id === picked && !a.primary) ?? list.find((a) => a.primary) ?? null;
  const extraId = current && !current.primary ? current.id : null;
  // The page's calls go to the account picked; leaving the page goes back to the main one.
  const shown = useRef<string | null>(null);
  useEffect(() => {
    setM365Account(extraId);
    if (shown.current === extraId) return; // the main account at first: nothing to reload
    shown.current = extraId;
    void qc.resetQueries({ queryKey: m365Keys.all });
  }, [extraId, qc]);
  useEffect(() => () => {
    setM365Account(null);
    void qc.resetQueries({ queryKey: m365Keys.all });
  }, [qc]);
  const pick = (a: MsAccount) => {
    const id = a.primary ? null : a.id;
    savePick(me.user.id, id);
    setPicked(id);
  };
  const add = useMutation({
    mutationFn: startAnotherConnect,
    onSuccess: (r) => window.location.assign(r.url),
    onError: (e) => toast.error(errorMessage(e)),
  });
  const rename = useMutation({
    mutationFn: ({ id, label }: { id: string; label: string }) => nameMsAccount(id, label),
    onSuccess: () => qc.invalidateQueries({ queryKey: msAccountsQuery.queryKey }),
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
          {list.map((a) => {
            const on = a.id === current.id;
            return (
              <MenuItem key={a.id} onSelect={() => pick(a)} className={cn(on && "bg-accent-soft/50")}>
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
          savePick(me.user.id, null);
          setPicked(null);
          setRemoving(null);
          await qc.invalidateQueries({ queryKey: msAccountsQuery.queryKey });
        }}
      />
    </>
  );
}
