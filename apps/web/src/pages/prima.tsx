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
  BooksIcon, CheckCircleIcon, EyeIcon, LinkIcon, MicrosoftOutlookLogoIcon, ShieldCheckIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useRouterState, useSearch } from "@tanstack/react-router";

import { Page, PageHeader, Section } from "@/components/page";
import { Button } from "@/components/ui/button";
import { DataTable, filterOf, TableFilter, useTableState, type Column } from "@/components/ui/data-table";
import { Pill } from "@/components/ui/pill";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useLang, useT } from "@/i18n";
import { api, errorMessage } from "@/lib/api";
import { cleanMenu, primaGo, usePrima } from "@/lib/prima-embed";
import { handPrimaLanguage, primaScreen } from "@/lib/prima-screen";
import { meQuery } from "@/lib/queries";
import { ROLE_INFO, type Role } from "@/lib/types";

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

/** P117 (Fitri, 19 Nov 2026: one office, Prima inside): Prima itself, filling the page under the
 * office header, with the office's sidebar as its menu (lib/prima-embed.ts). Prima hides its own
 * menu when framed here (apps/prima/apps/web/src/office-embed.ts). The address follows the
 * screen open in Prima (/prima#clock, /prima#@hr), and the sidebar, the phone's Clock in tab or
 * a link with an address opens that screen in the Prima already showing. (P71 had Prima open as
 * its own full page instead; Prima-only members and the phone app still do.) */
function PrimaFrame() {
  const t = useT();
  const navigate = useNavigate();
  const hash = useRouterState({ select: (st) => st.location.hash });
  const frame = useRef<HTMLIFrameElement>(null);
  const reported = useRef("");
  const setMenu = usePrima((st) => st.setMenu);
  const setRoute = usePrima((st) => st.setRoute);
  const setFrame = usePrima((st) => st.setFrame);
  // The language and the first screen are handed over before Prima starts.
  const [src] = useState(() => {
    handPrimaLanguage(useLang.getState().lang);
    return APP + primaScreen(window.location.hash);
  });
  useEffect(() => {
    const on = (e: MessageEvent) => {
      const w = frame.current?.contentWindow;
      if (e.origin !== window.location.origin || !w || e.source !== w) return;
      const d = e.data as { source?: unknown; type?: unknown; hash?: unknown; view?: unknown; space?: unknown } | null;
      if (!d || d.source !== "prima") return;
      if (d.type === "menu") {
        const menu = cleanMenu(d);
        if (menu) setMenu(menu);
      } else if (d.type === "route" && typeof d.hash === "string" && /^#@?[a-z][a-z0-9-]{0,39}$/.test(d.hash)) {
        setRoute({ hash: d.hash, view: typeof d.view === "string" ? d.view : "", space: typeof d.space === "string" ? d.space : null });
        reported.current = d.hash.slice(1);
        void navigate({ to: "/prima", hash: d.hash.slice(1), replace: true });
      }
    };
    window.addEventListener("message", on);
    return () => window.removeEventListener("message", on);
  }, [navigate, setMenu, setRoute]);
  useEffect(() => {
    setFrame(frame.current?.contentWindow ?? null);
    return () => setFrame(null);
  }, [setFrame]);
  // The address changed from outside Prima (the Clock in tab, a link): open that screen in it.
  useEffect(() => {
    if (!hash || hash === reported.current) return;
    primaGo(`#${hash}`);
  }, [hash]);
  return (
    <iframe
      ref={frame}
      src={src}
      title={t("Prima")}
      allow="camera; geolocation; clipboard-write"
      onLoad={() => setFrame(frame.current?.contentWindow ?? null)}
      className="block w-full border-0 bg-bg h-[calc(100dvh-3.5rem-env(safe-area-inset-top)-4.5rem-env(safe-area-inset-bottom))] md:h-[calc(100dvh-3.5rem-env(safe-area-inset-top))]"
    />
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
        {owner ? <p className="mt-2 text-[13px] text-muted">{t("Owners open Prima straight away as its CEO, with no link and no Microsoft step. Prima's records show the CEO; the office's activity log shows which owner recorded what.")}</p> : null}
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

/** P107: where a person's link stands, as a filter value. */
const linkState = (p: PersonRow) => (p.opens_as ? "owner" : p.link ? "linked" : p.suggestion ? "suggested" : "unlinked");
const LINK_ORDER: Record<string, number> = { suggested: 0, unlinked: 1, linked: 2, owner: 3 };

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
  // P107: a data table (search, where the link stands, office role); "p_" keeps its place in
  // the address apart from the companies table on the same page.
  const control = useTableState({ size: 25 }, { prefix: "p_", filters: ["state", "role"] });
  const [state] = filterOf(control, "state");
  const [role] = filterOf(control, "role");
  const d = q.data;
  const people = useMemo(() => d?.people ?? [], [d]);
  const names = new Map((d?.staff ?? []).map((r) => [r.id, r]));
  const waiting = people.filter((p) => !p.link && p.suggestion).length;
  const roles = useMemo(() => [...new Set(people.map((p) => p.role).filter(Boolean))].sort(), [people]);
  const rows = useMemo(() => people.filter((p) => (!state || linkState(p) === state) && (!role || p.role === role)), [people, state, role]);
  const error = linkAll.error ?? linkOne.error;
  const roleName = (r: string) => (ROLE_INFO[r as Role] ? t(ROLE_INFO[r as Role].label) : r);

  const linkPill = (p: PersonRow) => p.opens_as
    ? <Pill tone="ok"><CheckCircleIcon size={13} weight="fill" /> {p.opens_as === "ceo" ? t("Opens Prima as the CEO (owner)") : t("Opens Prima as the COO (owner)")}</Pill>
    : p.link
      ? <Pill tone="ok"><CheckCircleIcon size={13} weight="fill" /> {p.link.how === "microsoft" ? t("Linked by Microsoft") : p.link.how === "name" ? t("Linked by name") : p.link.how === "auto" ? t("Own Prima account") : t("Linked")}</Pill>
      : p.suggestion ? <Pill tone="warn">{t("Suggested")}</Pill> : <Pill>{t("Not linked")}</Pill>;

  const columns: Column<PersonRow>[] = [
    {
      id: "name", header: t("Person"), sortValue: (p) => p.name.toLowerCase(), card: "title", exportValue: (p) => p.name,
      cell: (p) => (
        <span className="grid min-w-0">
          <span className="text-[14px] font-medium break-words">{p.name}</span>
          <span className="text-[12px] break-all text-muted">{p.email}</span>
        </span>
      ),
    },
    { id: "email", header: t("Email"), exportOnly: true, cell: () => null, exportValue: (p) => p.email },
    { id: "role", header: t("Role"), sortValue: (p) => roleName(p.role), hideBelow: "lg", cell: (p) => <span className="text-muted">{roleName(p.role)}</span> },
    {
      id: "state", header: t("Link"), sortValue: (p) => LINK_ORDER[linkState(p)], kind: "number", cell: linkPill,
      exportValue: (p) => (p.opens_as ? t("Owners") : p.link ? t("Linked") : p.suggestion ? t("Suggested") : t("Not linked")),
    },
    {
      id: "record", header: t("Prima record"), exportValue: (p) => p.link?.prima_name ?? "",
      cell: (p) => {
        if (p.opens_as) return <span className="text-muted">-</span>;
        const value = p.link?.prima_user_id ?? p.suggestion ?? NONE;
        const options = [
          { value: NONE, label: t("Not linked") },
          ...(d?.staff ?? [])
            .filter((r) => !r.linked_to || r.linked_to === p.user_id)
            .map((r) => ({ value: r.id, label: r.name, hint: [r.title, r.can_sign_in ? "" : t("cannot sign in yet")].filter(Boolean).join(" · ") })),
        ];
        return (
          <Select size="sm" className="w-full min-w-48 sm:max-w-72" label={t("Prima record for {name}", { name: p.name })} value={value} options={options}
            disabled={linkOne.isPending}
            onValueChange={(v) => linkOne.mutate({ user_id: p.user_id, prima_user_id: v === NONE ? null : v })} />
        );
      },
    },
  ];

  return (
    <Section title={t("People in Prima")}>
      <p className="mb-3 text-[13px] text-muted">{t("Who in the office is which Prima staff record. People are linked by themselves when the match is sure (their Microsoft account, or the only record with their exact name); pick the record for anyone else. A link decides whose pay, leave and HR records each person, and their AI, can see.")}</p>
      {error ? <p className="mb-3 text-[13px] text-danger">{errorMessage(error)}</p> : null}
      <DataTable
        label={t("People in Prima")}
        columns={columns}
        rows={rows}
        rowId={(p) => p.user_id}
        rowLabel={(p) => p.name}
        control={control}
        loading={q.isLoading}
        error={q.error}
        onRetry={() => void q.refetch()}
        searchText={(p) => `${p.name} ${p.email} ${p.link?.prima_name ?? ""} ${p.suggestion ? names.get(p.suggestion)?.name ?? "" : ""}`}
        searchPlaceholder={t("Search by name or email")}
        exportName={t("people-in-prima")}
        filters={
          <>
            <TableFilter control={control} id="state" label={t("Link")} allLabel={t("Every link")}
              options={[
                { value: "suggested", label: t("Suggested") },
                { value: "unlinked", label: t("Not linked") },
                { value: "linked", label: t("Linked") },
                { value: "owner", label: t("Owners") },
              ]} />
            {roles.length > 1 ? <TableFilter control={control} id="role" label={t("Role")} allLabel={t("All roles")} options={roles.map((r) => ({ value: r, label: roleName(r) }))} /> : null}
          </>
        }
        toolbarActions={<Button size="sm" disabled={!waiting || linkAll.isPending} onClick={() => linkAll.mutate()}><LinkIcon size={15} /> {t("Link all suggested ({n})", { n: waiting })}</Button>}
        actions={(p) => !p.opens_as && !p.link && p.suggestion ? (
          <Button size="sm" variant="secondary" disabled={linkOne.isPending}
            onClick={() => linkOne.mutate({ user_id: p.user_id, prima_user_id: p.suggestion })}>
            {t("Link {name}", { name: names.get(p.suggestion)?.name ?? "" })}
          </Button>
        ) : null}
      />
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
  // P107: a data table of the branches (search, where each stands); "c_" keeps its place in the
  // address apart from the people table. Picks wait in `picked` across pages until Save.
  const control = useTableState({ size: 25 }, { prefix: "c_", filters: ["state"] });
  const [state] = filterOf(control, "state");
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
  const stateOf = (b: BranchRow) => (b.company_id ? "set" : b.suggestion ? "suggested" : "unset");
  const rows = (d?.branches ?? []).filter((b) => !state || stateOf(b) === state);
  const companyName = new Map((d?.companies ?? []).map((c) => [c.id, c.name]));
  const columns: Column<BranchRow>[] = [
    { id: "name", header: t("Branch"), sortValue: (b) => b.name.toLowerCase(), card: "title", exportValue: (b) => b.name, cell: (b) => <span className="text-[14px] font-medium break-words">{b.name}</span> },
    {
      id: "state", header: t("Status"), sortValue: (b) => ({ unset: 0, suggested: 1, set: 2 })[stateOf(b)], kind: "number",
      exportValue: (b) => (b.company_id ? t("Company set") : b.suggestion ? t("Suggested") : t("Not set")),
      cell: (b) => b.company_id
        ? <Pill tone="ok"><CheckCircleIcon size={13} weight="fill" /> {t("Company set")}</Pill>
        : b.suggestion ? <Pill tone="warn">{t("Suggested")}</Pill> : <Pill tone="warn">{t("Not set")}</Pill>,
    },
    {
      id: "company", header: t("Prima company"), exportValue: (b) => companyName.get(valueOf(b)) ?? "",
      cell: (b) => (
        <Select size="sm" className="w-full min-w-48 sm:max-w-72" label={t("Prima company for {name}", { name: b.name })} value={valueOf(b)} options={options}
          disabled={save.isPending}
          onValueChange={(v) => setPicked((x) => ({ ...x, [b.id]: v }))} />
      ),
    },
  ];
  return (
    <Section title={t("Prima companies")}
      actions={<Button size="sm" disabled={!Object.keys(changes).length || save.isPending} onClick={() => save.mutate(changes)}>{t("Save")}</Button>}>
      <p className="mb-3 text-[13px] text-muted">{t("Which Prima company each branch is. Anyone with no Prima record of their own gets their own Prima account in their branch's company the first time they open Prima, with access from their office role.")}</p>
      {save.error ? <p className="mb-3 text-[13px] text-danger">{errorMessage(save.error)}</p> : null}
      <DataTable
        label={t("Prima companies")}
        columns={columns}
        rows={rows}
        rowId={(b) => b.id}
        rowLabel={(b) => b.name}
        control={control}
        loading={q.isLoading}
        error={q.error}
        onRetry={() => void q.refetch()}
        searchText={(b) => `${b.name} ${companyName.get(valueOf(b)) ?? ""}`}
        searchPlaceholder={t("Search branches")}
        exportName={t("prima-companies")}
        filters={
          <TableFilter control={control} id="state" label={t("Status")} allLabel={t("All statuses")}
            options={[{ value: "unset", label: t("Not set") }, { value: "suggested", label: t("Suggested") }, { value: "set", label: t("Company set") }]} />
        }
      />
    </Section>
  );
}

/** P70: one sign-in with Microsoft connects the account; it comes back here and Prima opens. */
export function ConnectMicrosoft({ email }: { email: string }) {
  const t = useT();
  const connect = useMutation({
    mutationFn: () => api<{ url: string }>("/api/auth/microsoft/start", "POST", { email, next: `/prima${primaScreen(window.location.hash)}` }),
    onSuccess: (r) => {
      window.location.href = r.url;
    },
  });
  return (
    <section data-testid="prima-connect" className="grid gap-4 rounded-[var(--radius-lg)] border border-accent/30 bg-accent-soft/50 p-4 sm:grid-cols-[auto_1fr_auto] sm:items-center sm:p-5">
      <span className="grid size-11 place-items-center rounded-[var(--radius-md)] bg-accent text-accent-fg"><MicrosoftOutlookLogoIcon size={22} weight="fill" /></span>
      <div className="grid gap-1">
        <h2 className="text-[16px] font-semibold">{t("Connect your Microsoft account to open Prima")}</h2>
        <p className="text-[14px] text-muted sm:text-[13px]">{t("Prima and the office are one system and know you by your Microsoft work account. Sign in with Microsoft once; you come straight back to Prima.")}</p>
        {/* P92: on a phone, the steps in plain words: most people do this once, from the Clock in tab */}
        <ol className="mt-1 grid list-decimal gap-0.5 pl-5 text-[14px] sm:text-[13px]">
          <li>{t("Press Connect Microsoft.")}</li>
          <li>{t("Sign in with your work email and password (the one for Outlook).")}</li>
          <li>{t("You come back here and Prima opens.")}</li>
        </ol>
        {connect.error ? <p className="text-[13px] text-danger">{errorMessage(connect.error)}</p> : null}
      </div>
      <Button size="lg" className="min-h-11 w-full sm:w-auto" disabled={connect.isPending} onClick={() => connect.mutate()}>
        <LinkIcon size={16} /> {t("Connect Microsoft")}
      </Button>
    </section>
  );
}
