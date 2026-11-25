/**
 * P132 (Fitri, 26 Nov 2026: "let Prima handle the organization and members ... next all will be
 * from Prima"): once the office follows Prima, companies, departments and people are changed in
 * Prima; the Organization page shows them read-only with the way to the right Prima screen, what the
 * last run did, and (owner) what is held: lower access levels and accounts Prima closed.
 * API: routers/prima_master.py; the run itself: prima/mirror.py.
 */
import { ArrowsClockwiseIcon, ArrowSquareOutIcon, CheckIcon, InfoIcon } from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { useT } from "@/i18n";
import { api } from "@/lib/api";

export interface PrimaMaster {
  on: boolean;
  summary: Record<string, number>;
  held: { user_id: string; name: string; kind: "down" | "close" | string; from_role: string | null; to_role: string | null }[];
  can_run: boolean;
  can_apply_held: boolean;
}

export const primaMasterQuery = {
  queryKey: ["prima-master"],
  queryFn: () => api<PrimaMaster>("/api/prima-master"),
  staleTime: 60_000,
};

/** True once Prima keeps the organization and the people (the office shows them read-only). */
export function usePrimaMaster(): boolean {
  const { data } = useQuery(primaMasterQuery);
  return data?.on === true;
}

const SCREENS: { hash: string; label: string; what: string }[] = [
  { hash: "accounts", label: "Accounts and access", what: "Add people, their company, department and access" },
  { hash: "orgchart", label: "Org chart", what: "Who reports to whom, and each unit's head" },
  { hash: "people", label: "People", what: "Staff records (HR), with the email they sign in with" },
  { hash: "overview", label: "Companies", what: "Add a company (CEO)" },
];

const ROLE: Record<string, string> = {
  owner: "Owner", admin: "Global admin", it_support: "IT support", management: "Management", hr: "HR",
  branch_manager: "Branch manager", group_hod: "Group HOD", hod: "Head of department", supervisor: "Supervisor", staff: "Staff",
};

export function PrimaMasterPanel() {
  const t = useT();
  const qc = useQueryClient();
  const { data } = useQuery(primaMasterQuery);
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["prima-master"] });
    void qc.invalidateQueries({ queryKey: ["branches"] });
    void qc.invalidateQueries({ queryKey: ["members"] });
  };
  const run = useMutation({
    mutationFn: () => api<PrimaMaster>("/api/prima-master/run", "POST", {}),
    onSuccess: () => {
      refresh();
      toast.success(t("The office follows Prima again."));
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const applyHeld = useMutation({
    mutationFn: () => api<PrimaMaster>("/api/prima-master/apply-held", "POST", {}),
    onSuccess: () => {
      refresh();
      toast.success(t("Applied."));
    },
    onError: (e: Error) => toast.error(e.message),
  });
  if (data?.on !== true) return null;
  const s = data.summary ?? {};
  const held = Array.isArray(data.held) ? data.held : [];
  return (
    <Card>
      <CardHeader
        icon={<InfoIcon size={20} className="mt-0.5 text-accent" aria-hidden />}
        title={t("Companies, departments and people are kept in Prima")}
        description={t(
          "The office follows Prima every 30 minutes: new companies and people appear here by themselves, with their company, department and access level. Change them in Prima.",
        )}
        actions={
          data.can_run ? (
            <Button variant="outline" size="sm" onClick={() => run.mutate()} disabled={run.isPending}>
              <ArrowsClockwiseIcon size={15} /> {run.isPending ? t("Following Prima…") : t("Follow Prima now")}
            </Button>
          ) : null
        }
      />
      <CardBody className="grid gap-4">
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {SCREENS.map((x) => (
            <Link
              key={x.hash}
              to="/prima"
              hash={x.hash}
              className="group grid gap-0.5 rounded-[var(--radius-sm)] border border-border px-3 py-2.5 transition-colors hover:border-accent/40 hover:bg-accent/5"
            >
              <span className="flex items-center gap-1.5 text-[13.5px] font-semibold">
                {t(x.label)} <ArrowSquareOutIcon size={13} className="text-muted group-hover:text-accent" aria-hidden />
              </span>
              <span className="text-[12.5px] text-muted">{t(x.what)}</span>
            </Link>
          ))}
        </div>
        {Object.keys(s).length ? (
          <p className="text-[12.5px] text-muted">
            {t("Last run: {added} added, {raised} given more access, {moved} moved, {made} companies added, {noEmail} without an email (add one in Prima).", {
              added: s.added ?? 0,
              raised: s.raised ?? 0,
              moved: s.moved ?? 0,
              made: s.companies_made ?? 0,
              noEmail: s.no_email ?? 0,
            })}
          </p>
        ) : null}
        {held.length ? (
          <div className="grid gap-2 rounded-[var(--radius-sm)] bg-warn/5 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-[13px] font-semibold">
                {t("Waiting for the owner: {n} change(s) that take access away", { n: held.length })}
              </p>
              {data.can_apply_held ? (
                <Button size="sm" onClick={() => applyHeld.mutate()} disabled={applyHeld.isPending}>
                  <CheckIcon size={15} weight="bold" /> {t("Apply these")}
                </Button>
              ) : null}
            </div>
            <ul className="grid gap-1 text-[12.5px]">
              {held.slice(0, 60).map((h) => (
                <li key={`${h.user_id}:${h.kind}`} className="flex flex-wrap gap-x-2">
                  <span className="font-medium">{h.name}</span>
                  <span className="text-muted">
                    {h.kind === "close"
                      ? t("Prima closed their access: sign-in would be switched off")
                      : t("{from} → {to}", { from: t(ROLE[h.from_role ?? ""] ?? h.from_role ?? ""), to: t(ROLE[h.to_role ?? ""] ?? h.to_role ?? "") })}
                  </span>
                </li>
              ))}
            </ul>
            <p className="text-[12px] text-muted">
              {t("Nobody loses access by surprise: these wait until the owner applies them. To keep someone's access, give it to them in Prima (for example name them head of their unit in the Org chart).")}
            </p>
          </div>
        ) : null}
      </CardBody>
    </Card>
  );
}
