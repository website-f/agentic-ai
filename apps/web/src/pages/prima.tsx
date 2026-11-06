/** P65-P67: Prima, Prima Secure (apps/prima) inside the office. Prima opens with the office's
 * own sign-in: the office signs each call for the person (apps/api/agentic/prima) and names
 * their Prima staff record. People are linked to their record automatically when they signed in
 * with Microsoft and IT recorded that account in Prima; the owner links everyone else here, with
 * the likely record already picked, in one click. Prima opens as its own full page (P71), a
 * module of the office with "Back to the office" in its menu. Its SOPs and
 * workflows are in the Library, and the AI works in Prima for whoever asks it, as them.
 * P75: anyone with no Prima record of their own gets their own account the first time they open
 * Prima, in the Prima company the owner set for their branch here ("Prima companies").
 * P82: every owner (the developer is one) opens Prima as its top record (the CEO) at once. */
import {
  ArrowSquareOutIcon, BooksIcon, CheckCircleIcon, EyeIcon, LinkIcon, MicrosoftOutlookLogoIcon, ShieldCheckIcon, UsersThreeIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";

import { Page, PageHeader, Section } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Pill } from "@/components/ui/pill";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useT } from "@/i18n";
import { api, errorMessage } from "@/lib/api";
import { meQuery } from "@/lib/queries";

const APP = "/prima/";
const PREVIEW = "/prima/demo/";

interface PrimaStatus {
  enabled: boolean;
  running: boolean;
  linked: boolean;
  me: { name?: string; title?: string; role?: string } | null;
  problem: string;
  /** P70: Prima and the office are one; Prima opens once the person's Microsoft account is connected. */
  needs_microsoft: boolean;
  /** Why Prima did not open: "microsoft_needed", "company_needed" (P75: the owner sets the branch's company). */
  code?: string;
}

const statusQuery = {
  queryKey: ["prima", "status"],
  queryFn: () => api<PrimaStatus>("/api/prima/status"),
  staleTime: 30_000,
};

export function PrimaPage() {
  const status = useQuery(statusQuery);
  const search = useSearch({ strict: false }) as { people?: number };
  if (status.data?.linked && !search.people) return <PrimaFrame />;
  return <PrimaSetup status={status.data} loading={status.isLoading} />;
}

/** Prima itself, filling the page under the office header (computers); a button on phones.
 * Owners get a slim bar above it to link people. */
function PrimaFrame() {
  const t = useT();
  const { data: me } = useSuspenseQuery(meQuery);
  const owner = me.permissions.includes("org.manage");
  // P71: Prima opens as its own full page, a module of the office (its menu has "Back to the
  // office"), not framed inside this one: one menu at a time, on every screen size. Owners
  // stop here once a day only if they come to link people (?people=1 shows that instead).
  useEffect(() => {
    window.location.assign(APP);
  }, []);
  return (
    <Page>
      <PageHeader title={t("Prima")} icon={ShieldCheckIcon}
        description={t("Opening Prima…")} />
      <div className="flex flex-wrap gap-2">
        <Button asChild size="lg"><a href={APP}><ArrowSquareOutIcon size={18} /> {t("Open Prima Secure")}</a></Button>
        {owner ? (
          <Button asChild size="lg" variant="secondary"><Link to="/prima" search={{ people: 1 }}><UsersThreeIcon size={16} /> {t("People in Prima")}</Link></Button>
        ) : null}
      </div>
    </Page>
  );
}

function PrimaSetup({ status: s, loading }: { status?: PrimaStatus; loading: boolean }) {
  const t = useT();
  const { data: me } = useSuspenseQuery(meQuery);
  const owner = me.permissions.includes("org.manage");
  const search = useSearch({ strict: false }) as { people?: number };
  const companyNeeded = s?.code === "company_needed";
  return (
    <Page>
      <PageHeader title={t("Prima")} icon={ShieldCheckIcon}
        description={t("Prima Secure, the group's operations app: people and sites, rosters, attendance, cases, HR, claims, IT and more. Staff do the daily work there; your AI follows the same SOPs and workflows from the Library.")} />

      {s?.needs_microsoft ? <ConnectMicrosoft email={me.user.email} /> : null}

      <Section title={t("Status")}>
        {loading ? <Skeleton className="h-16" /> : (
          <div className="grid gap-3">
            <div className="flex flex-wrap items-center gap-2">
              {!s?.enabled
                ? <Pill tone="warn"><WarningCircleIcon size={13} weight="fill" /> {t("Not set up on this server")}</Pill>
                : s.running
                  ? <Pill tone="ok"><CheckCircleIcon size={13} weight="fill" /> {t("Running on this server")}</Pill>
                  : <Pill tone="warn"><WarningCircleIcon size={13} weight="fill" /> {t("Not running right now")}</Pill>}
              {s?.running && !s.needs_microsoft && !s.linked ? <Pill tone="warn">{t("Your account is not linked yet")}</Pill> : null}
            </div>
            {s?.problem ? <p className="text-[13px] text-muted">{s.problem}</p> : null}
            {companyNeeded && !owner ? <p className="text-[13px]">{t("Ask the office owner to set which Prima company your branch is. Prima then makes your own account the next time you open it.")}</p> : null}
          </div>
        )}
      </Section>

      {owner && s?.enabled && (search.people || companyNeeded) ? <CompaniesSection /> : null}
      {owner && s?.enabled ? <PeopleSection /> : null}

      <Section title={t("How you get in")}>
        <p className="text-[13px]">{t("Prima opens with your office sign-in once your Microsoft work account is connected to the office. The first time, the office finds your Prima staff record by that account or your exact name; if it cannot be sure, the office owner picks it on this page.")}</p>
        <p className="mt-2 text-[13px] text-muted">{t("Owners open Prima straight away as its CEO, with no link and no Microsoft step. Prima's records show the CEO; the office's activity log shows which owner recorded what.")}</p>
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

    </Page>
  );
}

interface StaffRow { id: string; name: string; title: string; role: string; can_sign_in: boolean; linked_to: string | null }
interface PersonRow {
  user_id: string; name: string; email: string; role: string; microsoft: boolean;
  link: { prima_user_id: string; prima_name: string; how: "microsoft" | "name" | "owner" | "auto" } | null;
  suggestion: string | null;
  /** P82: owners (the developer is one) open Prima as its top record, with no link. */
  opens_as?: "ceo" | "coo" | null;
}
interface PeopleData { staff: StaffRow[]; people: PersonRow[]; top?: { id: string; name: string; title: string; top: "ceo" | "coo" } | null }

const NONE = "none";

/** The owner links the office's people to Prima's staff records: the likely one is picked,
 * one button links them all, and any row can be changed or cleared. */
function PeopleSection() {
  const t = useT();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const q = useQuery({ queryKey: ["prima", "people"], queryFn: () => api<PeopleData>("/api/prima/people") });
  const done = () => {
    void qc.invalidateQueries({ queryKey: ["prima"] });
  };
  const linkAll = useMutation({
    mutationFn: () => api<{ linked: number }>("/api/prima/people/link-suggested", "POST", {}),
    onSuccess: done,
  });
  const linkOne = useMutation({
    mutationFn: (v: { user_id: string; prima_user_id: string | null }) => api("/api/prima/people/link", "POST", v),
    onSuccess: done,
  });
  const d = q.data;
  const names = new Map((d?.staff ?? []).map((r) => [r.id, r]));
  const waiting = (d?.people ?? []).filter((p) => !p.link && p.suggestion).length;
  const error = q.error ?? linkAll.error ?? linkOne.error;
  return (
    <Section title={t("People in Prima")}
      actions={<Button size="sm" disabled={!waiting || linkAll.isPending} onClick={() => linkAll.mutate()}><LinkIcon size={15} /> {t("Link all suggested ({n})", { n: waiting })}</Button>}>
      <p className="mb-3 text-[13px] text-muted">{t("Who in the office is which Prima staff record. People are linked by themselves when the match is sure (their Microsoft account, or the only record with their exact name); pick the record for anyone else. A link decides whose pay, leave and HR records each person, and their AI, can see.")}</p>
      {error ? <p className="mb-3 text-[13px] text-danger">{errorMessage(error)}</p> : null}
      {q.isLoading ? <Skeleton className="h-24" /> : (
        <div className="grid gap-2">
          {(d?.people ?? []).map((p) => {
            if (p.opens_as) {
              return (
                <div key={p.user_id} className="flex flex-wrap items-center gap-3 rounded-[var(--radius-md)] border border-border bg-surface px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[14px] font-medium">{p.name}</div>
                    <div className="truncate text-[12px] text-muted">{p.email}</div>
                  </div>
                  <Pill tone="ok"><CheckCircleIcon size={13} weight="fill" /> {p.opens_as === "ceo" ? t("Opens Prima as the CEO (owner)") : t("Opens Prima as the COO (owner)")}</Pill>
                </div>
              );
            }
            const value = p.link?.prima_user_id ?? p.suggestion ?? NONE;
            const options = [
              { value: NONE, label: t("Not linked") },
              ...(d?.staff ?? [])
                .filter((r) => !r.linked_to || r.linked_to === p.user_id)
                .map((r) => ({ value: r.id, label: r.name, hint: [r.title, r.can_sign_in ? "" : t("cannot sign in yet")].filter(Boolean).join(" · ") })),
            ];
            return (
              <div key={p.user_id} className="flex flex-wrap items-center gap-3 rounded-[var(--radius-md)] border border-border bg-surface px-3 py-2">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[14px] font-medium">{p.name}</div>
                  <div className="truncate text-[12px] text-muted">{p.email}</div>
                </div>
                {p.link
                  ? <Pill tone="ok"><CheckCircleIcon size={13} weight="fill" /> {p.link.how === "microsoft" ? t("Linked by Microsoft") : p.link.how === "name" ? t("Linked by name") : p.link.how === "auto" ? t("Own Prima account") : t("Linked")}</Pill>
                  : p.suggestion ? <Pill tone="warn">{t("Suggested")}</Pill> : null}
                <Select size="sm" className="w-64" label={t("Prima record for {name}", { name: p.name })} value={value} options={options}
                  disabled={linkOne.isPending}
                  onValueChange={(v) => linkOne.mutate({ user_id: p.user_id, prima_user_id: v === NONE ? null : v })} />
                {!p.link && p.suggestion ? (
                  <Button size="sm" variant="secondary" disabled={linkOne.isPending}
                    onClick={() => linkOne.mutate({ user_id: p.user_id, prima_user_id: p.suggestion })}>
                    {t("Link {name}", { name: names.get(p.suggestion)?.name ?? "" })}
                  </Button>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
      <div className="mt-3">
        <Button size="sm" variant="ghost" onClick={() => void navigate({ to: "/prima", search: {} })}>{t("Back to Prima")}</Button>
      </div>
    </Section>
  );
}

interface BranchRow { id: string; name: string; company_id: string | null; suggestion: string | null }
interface CompaniesData { companies: { id: string; name: string }[]; branches: BranchRow[] }

/** P75: the owner says once which Prima company each office branch is. Anyone with no Prima
 * record of their own then gets their own account there, from their office role. */
function CompaniesSection() {
  const t = useT();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["prima", "companies"], queryFn: () => api<CompaniesData>("/api/prima/companies") });
  const [picked, setPicked] = useState<Record<string, string>>({});
  const save = useMutation({
    mutationFn: (companies: Record<string, string | null>) => api("/api/prima/companies", "PUT", { companies }),
    onSuccess: () => {
      setPicked({});
      void qc.invalidateQueries({ queryKey: ["prima"] });
    },
  });
  const d = q.data;
  const valueOf = (b: BranchRow) => picked[b.id] ?? b.company_id ?? b.suggestion ?? NONE;
  const changes: Record<string, string | null> = {};
  for (const b of d?.branches ?? []) {
    const v = valueOf(b);
    const now = v === NONE ? null : v;
    if (now !== b.company_id) changes[b.id] = now;
  }
  const options = [
    { value: NONE, label: t("Not set") },
    ...(d?.companies ?? []).map((c) => ({ value: c.id, label: c.name, hint: c.id })),
  ];
  const error = q.error ?? save.error;
  return (
    <Section title={t("Prima companies")}
      actions={<Button size="sm" disabled={!Object.keys(changes).length || save.isPending} onClick={() => save.mutate(changes)}>{t("Save")}</Button>}>
      <p className="mb-3 text-[13px] text-muted">{t("Which Prima company each branch is. Anyone with no Prima record of their own gets their own Prima account in their branch's company the first time they open Prima, with access from their office role.")}</p>
      {error ? <p className="mb-3 text-[13px] text-danger">{errorMessage(error)}</p> : null}
      {q.isLoading ? <Skeleton className="h-16" /> : (
        <div className="grid gap-2">
          {(d?.branches ?? []).map((b) => (
            <div key={b.id} className="flex flex-wrap items-center gap-3 rounded-[var(--radius-md)] border border-border bg-surface px-3 py-2">
              <div className="min-w-0 flex-1 truncate text-[14px] font-medium">{b.name}</div>
              {b.company_id
                ? <Pill tone="ok"><CheckCircleIcon size={13} weight="fill" /> {t("Company set")}</Pill>
                : b.suggestion ? <Pill tone="warn">{t("Suggested")}</Pill> : <Pill tone="warn">{t("Not set")}</Pill>}
              <Select size="sm" className="w-64" label={t("Prima company for {name}", { name: b.name })} value={valueOf(b)} options={options}
                disabled={save.isPending}
                onValueChange={(v) => setPicked((x) => ({ ...x, [b.id]: v }))} />
            </div>
          ))}
        </div>
      )}
    </Section>
  );
}

/** P70: one sign-in with Microsoft connects the account; it comes back here and Prima opens. */
function ConnectMicrosoft({ email }: { email: string }) {
  const t = useT();
  const connect = useMutation({
    mutationFn: () => api<{ url: string }>("/api/auth/microsoft/start", "POST", { email, next: "/prima" }),
    onSuccess: (r) => {
      window.location.href = r.url;
    },
  });
  return (
    <section className="grid gap-4 rounded-[var(--radius-lg)] border border-accent/30 bg-accent-soft/50 p-5 sm:grid-cols-[auto_1fr_auto] sm:items-center">
      <span className="grid size-11 place-items-center rounded-[var(--radius-md)] bg-accent text-accent-fg"><MicrosoftOutlookLogoIcon size={22} weight="fill" /></span>
      <div className="grid gap-1">
        <h2 className="text-[15.5px] font-semibold">{t("Connect your Microsoft account to open Prima")}</h2>
        <p className="text-[13px] text-muted">{t("Prima and the office are one system and know you by your Microsoft work account. Sign in with Microsoft once; you come straight back to Prima.")}</p>
        {connect.error ? <p className="text-[13px] text-danger">{errorMessage(connect.error)}</p> : null}
      </div>
      <Button size="lg" disabled={connect.isPending} onClick={() => connect.mutate()}>
        <LinkIcon size={16} /> {t("Connect Microsoft")}
      </Button>
    </section>
  );
}
