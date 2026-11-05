/** P65/P66: Prisma, Prima Secure (apps/prima) inside the office. Prima opens with the office's
 * own sign-in: the office signs each call for the person (apps/api/agentic/prisma), and Prima
 * knows them by the Microsoft work account they signed in with. On a computer it fills this
 * page beside the office menu; on a phone (Prima has its own bottom tabs) it opens full screen.
 * Until the person is linked, the page says what is missing. Its SOPs, workflows, rules and
 * forms are in the Library, and the AI works in Prima for whoever asks it, as them. */
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
import { api } from "@/lib/api";
import { meQuery } from "@/lib/queries";

const APP = "/prisma/";
const PREVIEW = "/prisma/demo/";

interface PrimaStatus {
  enabled: boolean;
  running: boolean;
  linked: boolean;
  me: { name?: string; title?: string; role?: string } | null;
  problem: string;
}

const statusQuery = {
  queryKey: ["prisma", "status"],
  queryFn: () => api<PrimaStatus>("/api/prisma/status"),
  staleTime: 30_000,
};

export function PrismaPage() {
  const status = useQuery(statusQuery);
  if (status.data?.linked) return <PrismaFrame />;
  return <PrismaSetup status={status.data} loading={status.isLoading} />;
}

/** Prima itself, filling the page under the office header (computers); a button on phones. */
function PrismaFrame() {
  const t = useT();
  return (
    <>
      <iframe
        src={APP}
        title={t("Prima Secure")}
        className="hidden h-[calc(100dvh-3.5rem)] w-full border-0 bg-bg md:block"
        allow="camera; geolocation"
      />
      <div className="md:hidden">
        <Page>
          <PageHeader title={t("Prisma")} icon={ShieldCheckIcon}
            description={t("Prima Secure, the group's operations app: people and sites, rosters, attendance, cases, HR, claims, IT and more.")} />
          <Button asChild size="lg"><a href={APP}><ArrowSquareOutIcon size={18} /> {t("Open Prima Secure")}</a></Button>
        </Page>
      </div>
    </>
  );
}

function PrismaSetup({ status: s, loading }: { status?: PrimaStatus; loading: boolean }) {
  const t = useT();
  const { data: me } = useSuspenseQuery(meQuery);
  const owner = me.permissions.includes("org.manage");
  return (
    <Page>
      <PageHeader title={t("Prisma")} icon={ShieldCheckIcon}
        description={t("Prima Secure, the group's operations app: people and sites, rosters, attendance, cases, HR, claims, IT and more. Staff do the daily work there; your AI follows the same SOPs and workflows from the Library.")} />

      <Section title={t("Status")}>
        {loading ? <Skeleton className="h-16" /> : (
          <div className="grid gap-3">
            <div className="flex flex-wrap items-center gap-2">
              {!s?.enabled
                ? <Pill tone="warn"><WarningCircleIcon size={13} weight="fill" /> {t("Not set up on this server")}</Pill>
                : s.running
                  ? <Pill tone="ok"><CheckCircleIcon size={13} weight="fill" /> {t("Running on this server")}</Pill>
                  : <Pill tone="warn"><WarningCircleIcon size={13} weight="fill" /> {t("Not running right now")}</Pill>}
              {s?.running ? <Pill tone="warn">{t("Your account is not linked yet")}</Pill> : null}
            </div>
            {s?.problem ? <p className="text-[13px] text-muted">{s.problem}</p> : null}
          </div>
        )}
      </Section>

      <Section title={t("How you get in")}>
        <ol className="grid list-decimal gap-1.5 pl-5 text-[13px]">
          <li>{t("Sign in to the office with Microsoft (Sign in with Microsoft on the sign-in page), once. Prima knows people by their Microsoft work account.")}</li>
          <li>{t("IT links your Microsoft account to your Prima staff record. Then this page opens Prima, with no second sign-in.")}</li>
        </ol>
        <a href={PREVIEW} className="mt-3 grid gap-1.5 rounded-[var(--radius-md)] border border-border bg-surface p-4 hover:border-accent/40">
          <span className="flex items-center gap-2 text-[14.5px] font-semibold"><EyeIcon size={18} className="text-accent" /> {t("Preview with sample data")}</span>
          <span className="text-[12.5px] text-muted">{t("The same app on made-up data, in your browser only. No sign-in, nothing saved to the company.")}</span>
        </a>
      </Section>

      <Section title={t("Your AI and Prima")}>
        <div className="grid gap-2 text-[13px]">
          <p className="flex items-start gap-2">
            <BooksIcon size={16} className="mt-0.5 shrink-0 text-accent" />
            <span>{t("Prima's SOPs, the 34 end-to-end workflows, its business rules and record forms are in the Library. Agents look them up before related work and follow them.")} <Link to="/library" className="font-medium text-accent hover:underline">{t("Open Guidelines")}</Link></span>
          </p>
          <p className="text-muted">{t("Your AI works in Prima for you, as you: it reads what you may read, and records what you may record only after you approve each one. Prima's own rules still apply, and decisions on pay, discipline and contracts stay with people.")}</p>
        </div>
      </Section>

      {owner && s?.enabled ? (
        <Section title={t("Set-up for IT")}>
          <p className="text-[13px]">{t("Link each person's Microsoft account to their Prima user, one line per person on the server:")}</p>
          <code className="mt-2 block overflow-x-auto rounded bg-surface-2 px-2 py-1.5 font-mono text-[12px]">./deploy/scripts/prima-link-user.sh &lt;prima-user-id&gt; &lt;entra-object-id&gt; "&lt;your name&gt;"</code>
        </Section>
      ) : null}
    </Page>
  );
}
