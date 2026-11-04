/** P65: Prisma, the launch page for Prima Secure (apps/prima), PWVSB's operations app. It runs
 * beside the office on this server, at /prisma/ (its own API at /prisma-api/, its own
 * database), with its own Microsoft sign-in; it cannot be framed, so it opens as its own page.
 * Its SOPs, workflows, rules and forms are in the Library, where the AI looks them up. */
import {
  ArrowSquareOutIcon, BooksIcon, CheckCircleIcon, EyeIcon, ShieldCheckIcon, WarningCircleIcon,
} from "@phosphor-icons/react";
import { useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";

import { Page, PageHeader, Section } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Pill } from "@/components/ui/pill";
import { Skeleton } from "@/components/ui/skeleton";
import { useT } from "@/i18n";
import { meQuery } from "@/lib/queries";

const APP = "/prisma/";
const PREVIEW = "/prisma/demo/";

interface PrimaState { running: boolean; signIn: boolean }

/** Prima's public endpoints: is it up, and is its Microsoft sign-in set up. */
async function primaState(): Promise<PrimaState> {
  try {
    const h = await fetch("/prisma-api/api/health", { cache: "no-store" });
    if (!h.ok) return { running: false, signIn: false };
    const c = await fetch("/prisma-api/api/auth/config", { cache: "no-store" });
    const cfg = c.ok ? ((await c.json()) as { microsoft?: unknown }) : {};
    return { running: true, signIn: !!cfg.microsoft };
  } catch {
    return { running: false, signIn: false };
  }
}

export function PrismaPage() {
  const t = useT();
  const { data: me } = useSuspenseQuery(meQuery);
  const state = useQuery({ queryKey: ["prisma", "state"], queryFn: primaState, staleTime: 30_000 });
  const owner = me.permissions.includes("org.manage");
  const s = state.data;
  return (
    <Page>
      <PageHeader title={t("Prisma")} icon={ShieldCheckIcon}
        description={t("Prima Secure, the group's operations app: people and sites, rosters, attendance, cases, HR, claims, IT and more. Staff do the daily work there; your AI follows the same SOPs and workflows from the Library.")}
        actions={<Button asChild><a href={APP}><ArrowSquareOutIcon size={16} /> {t("Open Prima Secure")}</a></Button>} />

      <Section title={t("Status")}>
        {state.isLoading ? <Skeleton className="h-16" /> : (
          <div className="flex flex-wrap items-center gap-2">
            {s?.running
              ? <Pill tone="ok"><CheckCircleIcon size={13} weight="fill" /> {t("Running on this server")}</Pill>
              : <Pill tone="warn"><WarningCircleIcon size={13} weight="fill" /> {t("Not running right now")}</Pill>}
            {s?.running ? (s.signIn
              ? <Pill tone="ok">{t("Microsoft sign-in set up")}</Pill>
              : <Pill tone="warn">{t("Microsoft sign-in not set up yet")}</Pill>) : null}
          </div>
        )}
      </Section>

      <Section title={t("Ways in")}>
        <div className="grid gap-3 sm:grid-cols-2">
          <a href={APP} className="grid gap-1.5 rounded-[var(--radius-md)] border border-border bg-surface p-4 hover:border-accent/40">
            <span className="flex items-center gap-2 text-[14.5px] font-semibold"><ArrowSquareOutIcon size={18} className="text-accent" /> {t("Prima Secure")}</span>
            <span className="text-[12.5px] text-muted">{t("Sign in with your company Microsoft account. What you see follows your role and companies in Prima.")}</span>
          </a>
          <a href={PREVIEW} className="grid gap-1.5 rounded-[var(--radius-md)] border border-border bg-surface p-4 hover:border-accent/40">
            <span className="flex items-center gap-2 text-[14.5px] font-semibold"><EyeIcon size={18} className="text-accent" /> {t("Preview with sample data")}</span>
            <span className="text-[12.5px] text-muted">{t("The same app on made-up data, in your browser only. No sign-in, nothing saved to the company.")}</span>
          </a>
        </div>
      </Section>

      <Section title={t("Your AI and Prima")}>
        <div className="grid gap-2 text-[13px]">
          <p className="flex items-start gap-2">
            <BooksIcon size={16} className="mt-0.5 shrink-0 text-accent" />
            <span>{t("Prima's SOPs, the 34 end-to-end workflows, its business rules and record forms are in the Library. Agents look them up before related work and follow them.")} <Link to="/library" className="font-medium text-accent hover:underline">{t("Open Guidelines")}</Link></span>
          </p>
          <p className="text-muted">{t("Prima keeps its own rules: the AI prepares and drafts, people decide. No pay, deduction, discipline or contract decision is made by the AI, and staff send their own replies from Outlook.")}</p>
        </div>
      </Section>

      {owner && s?.running ? (
        <Section title={t("Set-up for the Microsoft admin")}>
          <ol className="grid list-decimal gap-1.5 pl-5 text-[13px]">
            <li>{t("In Microsoft Entra, open the app registration \"Prima Secure App\" > Authentication > Single-page application, and add this redirect URI:")} <code className="rounded bg-surface-2 px-1 font-mono text-[12px]">{`${window.location.origin}${APP}`}</code></li>
            <li>{t("Link each person's Microsoft account to their Prima user (one line per person on the server, docs/P65-PRIMA-SECURE.md).")}</li>
          </ol>
        </Section>
      ) : null}
    </Page>
  );
}
