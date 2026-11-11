/** P99: the landing of someone whose access is Prima only. They sign in on the same page as
 * everyone; this page sends them on to Prima (/prima/) at once. When Prima cannot open yet it
 * says why in plain words (connect Microsoft, ask the office owner) and keeps the few things
 * they still do here: their password, their language, signing out. The office's pages, agents,
 * chat and desk are not part of their access: the API refuses them (core/access.py). */
import { ArrowClockwiseIcon, ArrowSquareOutIcon, KeyIcon, ShieldCheckIcon, SignOutIcon } from "@phosphor-icons/react";
import { useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";

import { LanguageSwitch } from "@/components/language-switch";
import { Wordmark } from "@/components/logo";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useLang, useT } from "@/i18n";
import { api, errorMessage } from "@/lib/api";
import { handPrimaLanguage, primaScreen } from "@/lib/prima-screen";
import { meQuery } from "@/lib/queries";
import { useSignOut } from "@/lib/use-sign-out";

import { ConnectMicrosoft } from "./prima";

const APP = "/prima/";

interface PrimaStatus {
  enabled: boolean;
  running: boolean;
  linked: boolean;
  problem: string;
  needs_microsoft: boolean;
}

/** Where Prima opens: the screen named in the address (/prima-only#clock), if any. */
export function primaAddress(hash: string): string {
  return APP + primaScreen(hash);
}

export function PrimaOnlyPage({ go = (url: string) => window.location.replace(url) }: { go?: (url: string) => void }) {
  const t = useT();
  const navigate = useNavigate();
  const signOut = useSignOut();
  const { data: me } = useSuspenseQuery(meQuery);
  const status = useQuery({ queryKey: ["prima", "status"], queryFn: () => api<PrimaStatus>("/api/prima/status"), staleTime: 0 });
  const linked = !!status.data?.linked;
  useEffect(() => {
    if (!linked) return;
    handPrimaLanguage(useLang.getState().lang);
    go(primaAddress(window.location.hash));
  }, [linked, go]);

  const s = status.data;
  return (
    <div className="grid min-h-dvh place-items-center bg-bg px-4 pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]">
      <main className="grid w-full max-w-md gap-5 py-8">
        <div className="flex items-center justify-between gap-3">
          <Wordmark />
          <LanguageSwitch />
        </div>
        <section className="grid gap-4 rounded-[var(--radius-lg)] border border-border bg-surface p-5 shadow-sm">
          <div className="flex items-start gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-[var(--radius-md)] bg-accent-soft text-accent">
              <ShieldCheckIcon size={20} weight="duotone" />
            </span>
            <div className="grid min-w-0 gap-1">
              <h1 className="text-[18px] font-semibold">{t("Your access is Prima")}</h1>
              <p className="text-[14px] text-muted sm:text-[13.5px]">
                {t("Hello {name}. Your company gave you Prima only, so Prima opens for you here. The office's other pages are not part of your access.", { name: me.user.name })}
              </p>
            </div>
          </div>
          {status.isLoading || linked ? (
            <div className="grid gap-2" aria-live="polite">
              <p className="text-[13.5px] text-muted">{t("Opening Prima...")}</p>
              <Skeleton className="h-11 rounded-sm" />
            </div>
          ) : status.error ? (
            <p role="alert" className="text-[13.5px] text-danger">{errorMessage(status.error)}</p>
          ) : s && !s.enabled ? (
            <p role="alert" className="text-[13.5px]">{t("Prima is not set up on this server yet. Ask the office owner.")}</p>
          ) : s?.needs_microsoft ? null : (
            <p role="alert" className="text-[13.5px]">{s?.problem || t("Prima did not open for this account.")}</p>
          )}
          {s?.needs_microsoft ? <ConnectMicrosoft email={me.user.email} /> : null}
          <div className="grid gap-2 sm:grid-cols-2">
            <Button asChild size="lg" className="min-h-11" variant={s?.needs_microsoft ? "outline" : undefined}>
              <a href={primaAddress(window.location.hash)} onClick={() => handPrimaLanguage(useLang.getState().lang)}>
                <ArrowSquareOutIcon size={16} /> {t("Open Prima")}
              </a>
            </Button>
            <Button size="lg" variant="outline" className="min-h-11" loading={status.isFetching} onClick={() => void status.refetch()}>
              <ArrowClockwiseIcon size={16} /> {t("Try again")}
            </Button>
          </div>
        </section>
        <div className="flex flex-wrap items-center justify-center gap-2">
          <Button variant="ghost" onClick={() => navigate({ to: "/change-password" })}>
            <KeyIcon size={16} /> {t("Change password")}
          </Button>
          <Button variant="ghost" onClick={signOut}>
            <SignOutIcon size={16} /> {t("Sign out")}
          </Button>
        </div>
      </main>
    </div>
  );
}
