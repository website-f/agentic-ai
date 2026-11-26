/**
 * P133 (Fitri, 26 Nov 2026: "no members settings and organization ... all must be moved to Prima"):
 * the office no longer has an Organization or Members page. Companies, departments and people are
 * kept in Prima (P132). What the office keeps of its own lives here:
 *   - that Prima keeps them, what the last run did, and what waits for the owner (PrimaMasterPanel);
 *   - who runs the office itself: owners, global admins, IT support (the owner adds and removes);
 *   - helping one person sign in: their sign-in email (a typo stops the emailed code), an emailed
 *     sign-in password, a fresh Microsoft link;
 *   - Sign in as a role (P131).
 */
import { ArrowsCounterClockwiseIcon, EnvelopeSimpleIcon, MagnifyingGlassIcon, PencilSimpleIcon, ShieldStarIcon, UserMinusIcon, UserPlusIcon } from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";

import { MemberIdentityDialog, ResetMicrosoftDialog } from "@/components/member-identity";
import { Page, PageHeader } from "@/components/page";
import { PrimaMasterPanel } from "@/components/prima-master";
import { RolePreviewCard } from "@/components/role-preview";
import { useEmailMember } from "@/components/sign-in-emails";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import { useT } from "@/i18n";
import { api, errorMessage } from "@/lib/api";
import { meQuery } from "@/lib/queries";
import type { MembersPage } from "@/lib/members";
import type { Member } from "@/lib/types";

const OFFICE_ROLES = ["owner", "admin", "it_support"] as const;
const ROLE_LABEL: Record<string, string> = { owner: "Owner", admin: "Global admin", it_support: "IT support" };

function useMemberSearch(q: string, role?: string) {
  const params = new URLSearchParams({ page: "1", page_size: role ? "100" : "8" });
  if (q.trim()) params.set("q", q.trim());
  if (role) params.set("role", role);
  return useQuery({
    queryKey: ["office-access-members", q.trim(), role ?? ""],
    queryFn: () => api<MembersPage>(`/api/members?${params}`),
    enabled: !!role || q.trim().length >= 2,
    staleTime: 15_000,
  });
}

function SearchBox({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <label className="flex h-10 items-center gap-2 rounded-[var(--radius-sm)] border border-border bg-surface px-3 focus-within:border-accent">
      <MagnifyingGlassIcon size={16} className="text-muted" aria-hidden />
      <input className="min-w-0 flex-1 bg-transparent text-[14px] outline-none" value={value} placeholder={placeholder} aria-label={placeholder} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

function OfficeAdmins({ isOwner }: { isOwner: boolean }) {
  const t = useT();
  const qc = useQueryClient();
  const owners = useMemberSearch("", "owner");
  const admins = useMemberSearch("", "admin");
  const it = useMemberSearch("", "it_support");
  const [q, setQ] = useState("");
  const [give, setGive] = useState<string>("admin");
  const found = useMemberSearch(q);
  const people = [...(owners.data?.items ?? []), ...(admins.data?.items ?? []), ...(it.data?.items ?? [])];
  const change = useMutation({
    mutationFn: ({ id, role }: { id: string; role: string }) => api<Member>(`/api/members/${id}`, "PATCH", { role }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["office-access-members"] });
      toast.success(t("Saved."));
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Card>
      <CardHeader
        icon={<ShieldStarIcon size={20} className="mt-0.5 text-accent" aria-hidden />}
        title={t("Who runs the office")}
        description={t("Owners, global admins and IT support are the office's own: Prima never changes them. Taking someone off gives them back the access their Prima job gives (within 30 minutes).")}
      />
      <CardBody className="grid gap-3">
        <ul className="divide-y divide-border rounded-[var(--radius-sm)] border border-border">
          {people.map((m) => (
            <li key={m.user_id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[14px] font-medium">{m.name}</span>
                <span className="block truncate text-[12.5px] text-muted">{m.email}</span>
              </span>
              <span className="rounded-full bg-accent/10 px-2 py-0.5 text-[12px] font-medium text-accent">{t(ROLE_LABEL[m.role] ?? m.role)}</span>
              {isOwner && m.role !== "owner" ? (
                <Button variant="ghost" size="sm" disabled={change.isPending} onClick={() => change.mutate({ id: m.user_id, role: "staff" })}>
                  <UserMinusIcon size={15} /> {t("Take off")}
                </Button>
              ) : null}
            </li>
          ))}
          {!people.length ? <li className="px-3 py-3 text-[13px] text-muted">{t("Loading…")}</li> : null}
        </ul>
        {isOwner ? (
          <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_12rem]">
            <SearchBox value={q} onChange={setQ} placeholder={t("Find someone to add (name or email)")} />
            <Select value={give} onValueChange={setGive} label={t("As")} options={[{ value: "admin", label: t("Global admin") }, { value: "it_support", label: t("IT support") }, { value: "owner", label: t("Owner") }]} />
            {(found.data?.items ?? []).filter((m) => !OFFICE_ROLES.includes(m.role as (typeof OFFICE_ROLES)[number])).map((m) => (
              <div key={m.user_id} className="flex items-center gap-3 rounded-[var(--radius-sm)] border border-border px-3 py-2 sm:col-span-2">
                <span className="min-w-0 flex-1 truncate text-[13.5px]">
                  {m.name} <span className="text-muted">· {m.email}</span>
                </span>
                <Button size="sm" disabled={change.isPending} onClick={() => change.mutate({ id: m.user_id, role: give })}>
                  <UserPlusIcon size={15} /> {t("Add")}
                </Button>
              </div>
            ))}
          </div>
        ) : null}
      </CardBody>
    </Card>
  );
}

function SignInHelpRow({ m }: { m: Member }) {
  const t = useT();
  const [editing, setEditing] = useState(false);
  const [ms, setMs] = useState(false);
  const email = useEmailMember(m.user_id, m.name);
  return (
    <li className="grid gap-2 px-3 py-2.5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
      <span className="min-w-0">
        <span className="block truncate text-[14px] font-medium">{m.name}</span>
        <span className="block truncate text-[12.5px] text-muted">
          {m.email} · {m.last_login_at ? t("signed in before") : t("never signed in")}
          {!m.is_active ? ` · ${t("switched off")}` : ""}
        </span>
      </span>
      <span className="flex flex-wrap gap-1.5">
        <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
          <PencilSimpleIcon size={14} /> {t("Fix email")}
        </Button>
        <Button variant="outline" size="sm" disabled={email.isPending || !m.is_active} onClick={() => email.mutate()}>
          <EnvelopeSimpleIcon size={14} /> {t("Email a sign-in password")}
        </Button>
        <Button variant="outline" size="sm" onClick={() => setMs(true)}>
          <ArrowsCounterClockwiseIcon size={14} /> {t("Reset Microsoft")}
        </Button>
      </span>
      {editing ? <MemberIdentityDialog member={m} open={editing} onOpenChange={setEditing} /> : null}
      {ms ? <ResetMicrosoftDialog member={m} open={ms} onOpenChange={setMs} /> : null}
    </li>
  );
}

function SignInHelp() {
  const t = useT();
  const [q, setQ] = useState("");
  const found = useMemberSearch(q);
  const items = found.data?.items ?? [];
  return (
    <Card>
      <CardHeader
        icon={<EnvelopeSimpleIcon size={20} className="mt-0.5 text-accent" aria-hidden />}
        title={t("Help someone sign in")}
        description={t("Find them by name or email. The emailed sign-in password goes only to the email shown here, so a typo (outlookk.com) means nothing arrives: fix it first. Ask them to look in Junk too.")}
      />
      <CardBody className="grid gap-2">
        <SearchBox value={q} onChange={setQ} placeholder={t("Name or email")} />
        {q.trim().length >= 2 ? (
          items.length ? (
            <ul className="divide-y divide-border rounded-[var(--radius-sm)] border border-border">
              {items.map((m) => <SignInHelpRow key={m.user_id} m={m} />)}
            </ul>
          ) : (
            <p className="text-[13px] text-muted">{found.isFetching ? t("Looking…") : t("No one found. People are added in Prima (People, then Accounts and access).")}</p>
          )
        ) : null}
        <NotRegistered />
      </CardBody>
    </Card>
  );
}

export function OfficeAccessPage() {
  const t = useT();
  const { data: me } = useSuspenseQuery(meQuery);
  const runsOffice = ["owner", "admin", "it_support"].includes(me.role);
  return (
    <Page>
      <PageHeader
        title={t("Office access")}
        description={t("Companies, departments and people are kept in Prima. Here: who runs the office, helping someone sign in, and trying another role.")}
      />
      <div className="grid gap-4">
        <PrimaMasterPanel />
        {runsOffice ? <OfficeAdmins isOwner={me.role === "owner"} /> : null}
        {runsOffice ? <SignInHelp /> : null}
        <RolePreviewCard />
      </div>
    </Page>
  );
}

/** P134: who asked for a sign-in password in the last 7 days with an email nobody here has:
 * the people HR still has to add in Prima (they can then sign in within 30 minutes). */
function NotRegistered() {
  const t = useT();
  const { data } = useQuery({
    queryKey: ["unknown-signins"],
    queryFn: () => api<{ email: string; at: string }[]>("/api/prima-master/unknown-signins"),
    staleTime: 60_000,
  });
  const rows = Array.isArray(data) ? data : [];
  if (!rows.length) return null;
  return (
    <div className="mt-2 grid gap-2 rounded-[var(--radius-sm)] bg-warn/5 p-3">
      <p className="text-[13px] font-semibold">{t("Asked for a sign-in password but not added yet ({n})", { n: rows.length })}</p>
      <p className="text-[12.5px] text-muted">
        {t("No email is sent to these addresses: nobody here has them. Add each person in Prima (People, Add office staff) with this exact email; they can sign in within 30 minutes. A misspelt address is just a typo: ignore it.")}
      </p>
      <ul className="grid gap-1 text-[13px]">
        {rows.slice(0, 50).map((r) => (
          <li key={r.email} className="flex flex-wrap justify-between gap-x-3">
            <span className="font-medium break-all">{r.email}</span>
            <span className="text-muted">{new Date(r.at).toLocaleString()}</span>
          </li>
        ))}
      </ul>
      <Link to="/prima" hash="people" className="text-[13px] font-semibold text-accent hover:underline">
        {t("Open People in Prima")}
      </Link>
    </div>
  );
}
