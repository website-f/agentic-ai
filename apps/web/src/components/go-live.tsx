/** P81: Settings > Data and privacy > Start fresh for go-live (owner only). A practice office
 * becomes the real one: every member but the owners leaves, the companies the owner ticks go
 * (their AI workers, files and linked folders move to a company that stays), and AI workers,
 * SOPs, settings, Microsoft and the AI Engine stay. The real staff then come in through
 * Members > Import. The same reset runs on the server as `python -m agentic.golive`. */
import {
  BooksIcon, BuildingsIcon, CheckCircleIcon, DatabaseIcon, FileTextIcon, RobotIcon, RocketLaunchIcon, TreeStructureIcon, UsersThreeIcon,
} from "@phosphor-icons/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { ConfirmForm } from "@/components/owner-confirm";
import { IconTile } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { FormError } from "@/components/ui/field";
import { SearchInput } from "@/components/ui/search-input";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Stat, StatGrid } from "@/components/ui/stat";
import { locale, useT } from "@/i18n";
import { errorMessage } from "@/lib/api";
import { goLiveKey, goLiveOverview, goLivePlan, type GoLiveCompany, type GoLiveResult, startFresh } from "@/lib/golive";
import { timeAgo } from "@/lib/utils";

const num = (n: number) => n.toLocaleString(locale());

function CompanyRow({ c, on, onToggle }: { c: GoLiveCompany; on: boolean; onToggle: () => void }) {
  const t = useT();
  const bits = [
    c.departments === 1 ? t("1 department") : t("{n} departments", { n: num(c.departments) }),
    c.agents === 1 ? t("1 AI worker") : t("{n} AI workers", { n: num(c.agents) }),
    c.files === 1 ? t("1 file") : t("{n} files", { n: num(c.files) }),
    c.members === 1 ? t("1 person") : t("{n} people", { n: num(c.members) }),
  ];
  return (
    <li>
      <label className={`flex min-h-12 cursor-pointer items-start gap-3 px-3 py-2.5 transition-colors hover:bg-surface-2/60 ${on ? "bg-danger/6" : ""}`}>
        <input type="checkbox" checked={on} onChange={onToggle} className="mt-0.5 size-4 shrink-0 cursor-pointer accent-[var(--danger)] pointer-coarse:size-5" />
        <span className="grid min-w-0 gap-0.5">
          <span className={`text-[13.5px] font-medium break-words ${on ? "text-danger line-through decoration-danger/50" : ""}`}>{c.name}</span>
          <span className="text-[12px] text-muted">{bits.join(" · ")}</span>
        </span>
      </label>
    </li>
  );
}

function Done({ r }: { r: GoLiveResult }) {
  const t = useT();
  return (
    <div role="status" className="grid gap-1.5 rounded-[var(--radius-sm)] border border-ok/40 bg-ok/8 px-3 py-2.5 text-[13px]">
      <p className="flex items-center gap-2 font-medium"><CheckCircleIcon size={16} className="text-ok" /> {t("Done. This office starts fresh.")}</p>
      <ul className="grid list-disc gap-0.5 pl-5 text-muted">
        <li>{t("{n} members left; {owners} owners stayed.", { n: num(r.members_removed), owners: num(r.owners_kept) })}</li>
        <li>{t("{n} companies and {d} departments removed.", { n: num(r.companies_removed), d: num(r.departments_removed) })}</li>
        {r.agents_moved || r.files_moved ? <li>{t("{a} AI workers and {f} files moved.", { a: num(r.agents_moved), f: num(r.files_moved) })}</li> : null}
        {r.prima_links_ended ? <li>{t("{n} Prima links ended.", { n: num(r.prima_links_ended) })}</li> : null}
      </ul>
      <p>{t("Next: Members › Import to bring in your staff.")}</p>
    </div>
  );
}

export function GoLiveCard() {
  const t = useT();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: goLiveKey, queryFn: goLiveOverview });
  const [remove, setRemove] = useState<ReadonlySet<string>>(() => new Set());
  const [moveTo, setMoveTo] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [asking, setAsking] = useState(false);
  const [done, setDone] = useState<GoLiveResult | null>(null);
  const ov = q.data;
  const companies = useMemo(() => ov?.companies ?? [], [ov]);
  const plan = useMemo(() => goLivePlan({ companies }, remove, moveTo), [companies, remove, moveTo]);
  const needle = filter.trim().toLowerCase();
  const listed = needle ? companies.filter((c) => c.name.toLowerCase().includes(needle)) : companies;
  const allListed = listed.length > 0 && listed.every((c) => remove.has(c.id));
  const someListed = listed.some((c) => remove.has(c.id));

  const toggle = (id: string) => setRemove((s) => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    return n;
  });
  const tickListed = (on: boolean) => setRemove((s) => {
    const n = new Set(s);
    for (const c of listed) if (on) n.add(c.id); else n.delete(c.id);
    return n;
  });

  if (q.isLoading) return <Skeleton className="h-48" />;
  if (q.error || !ov) return <FormError message={q.error ? errorMessage(q.error) : null} />;
  const homeName = companies.find((c) => c.id === plan.home)?.name ?? "";
  const backup = ov.backup.last_success;

  return (
    <Card className="border-warn/40">
      <CardHeader icon={<IconTile icon={RocketLaunchIcon} size="sm" tone="warn" />} title={t("Start fresh for go-live")}
        description={t("Turn this practice office into the real one: the sample people and companies go; AI workers, SOPs, settings, Microsoft and the AI Engine stay.")} />
      <CardBody className="grid gap-5">
        {done ? <Done r={done} /> : null}
        <StatGrid className="grid-cols-2 sm:grid-cols-3 lg:grid-cols-3">
          <Stat label={t("Members")} value={num(ov.members.total)} icon={UsersThreeIcon} hint={t("{n} owners stay", { n: num(ov.members.owners) })} />
          <Stat label={t("Companies")} value={num(companies.length)} icon={BuildingsIcon} tone="info" />
          <Stat label={t("Departments")} value={num(ov.departments)} icon={TreeStructureIcon} tone="violet" />
          <Stat label={t("AI workers")} value={num(ov.agents)} icon={RobotIcon} tone="ok" hint={t("All kept")} />
          <Stat label={t("Files")} value={num(ov.files)} icon={BooksIcon} tone="orange" hint={t("All kept")} />
          <Stat label={t("SOPs")} value={num(ov.sops)} icon={FileTextIcon} tone="neutral" hint={t("All kept")} />
        </StatGrid>

        <section className="grid gap-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-[13.5px] font-semibold">{t("Companies to remove")}</h3>
            <span className="text-[12.5px] text-muted tabular-nums">{t("{n} of {total} ticked", { n: num(remove.size), total: num(companies.length) })}</span>
          </div>
          <p className="text-[12.5px] text-muted">{t("Tick the sample companies. Keep the real ones; the staff import adds any that are missing.")}</p>
          {companies.length > 8 ? <SearchInput value={filter} onChange={setFilter} placeholder={t("Find a company")} /> : null}
          {companies.length ? (
            <div className="overflow-hidden rounded-[var(--radius-md)] border border-border">
              <label className="flex min-h-11 cursor-pointer items-center gap-3 border-b border-border bg-surface-2/50 px-3 text-[13px] font-medium">
                <input type="checkbox" checked={allListed} ref={(el) => { if (el) el.indeterminate = someListed && !allListed; }}
                  onChange={(e) => tickListed(e.target.checked)} className="size-4 cursor-pointer accent-[var(--danger)] pointer-coarse:size-5" />
                {needle ? t("Tick all {n} found", { n: num(listed.length) }) : t("Tick all")}
              </label>
              <ul className="grid max-h-80 divide-y divide-border overflow-y-auto overscroll-contain">
                {listed.map((c) => <CompanyRow key={c.id} c={c} on={remove.has(c.id)} onToggle={() => toggle(c.id)} />)}
              </ul>
            </div>
          ) : <p className="text-[13px] text-muted">{t("This office has no companies yet.")}</p>}
        </section>

        {plan.needsHome ? (
          <div className="grid gap-1.5">
            {plan.kept.length ? (
              <Select value={plan.home ?? ""} onValueChange={setMoveTo} label={t("Move their AI workers and files to")} className="w-full sm:max-w-md"
                options={plan.kept.map((c) => ({ value: c.id, label: c.name }))} />
            ) : null}
            <p className={`text-[12.5px] ${plan.ready ? "text-muted" : "text-danger"}`}>
              {plan.ready
                ? t("{a} AI workers and {f} files move to {company}. The files go in a folder named after the company they came from.", { a: num(plan.agents), f: num(plan.files), company: homeName })
                : t("Keep at least one company: the AI workers and files of the removed ones need somewhere to go.")}
            </p>
          </div>
        ) : null}

        <section className="grid gap-1.5 text-[13px]">
          <h3 className="text-[13.5px] font-semibold">{t("What happens")}</h3>
          <ul className="grid list-disc gap-1 pl-5">
            <li>{t("{n} members leave; the {owners} owners stay. They are signed out at once, their Prima links end, and anyone with no other workspace is deactivated (not deleted).", { n: num(ov.members.to_remove), owners: num(ov.members.owners) })}</li>
            {plan.removed ? (
              <li>{t("{n} companies are removed with their {d} departments and {o} records that belong only to them (memory pages, skills, workflows, forms).", { n: num(plan.removed), d: num(plan.departments), o: num(plan.other) })}</li>
            ) : <li>{t("No company is removed.")}</li>}
            <li>{t("AI workers, SOPs, settings, Microsoft and the AI Engine stay. An SOP of a removed company becomes a library SOP, still attached to its AI workers.")}</li>
            <li>{t("Files stay. Delete the ones you do not want in Library or Browse, where you can select many at once.")}</li>
          </ul>
        </section>

        <div className="grid gap-1.5 rounded-[var(--radius-sm)] border border-warn/40 bg-warn/8 px-3 py-2.5 text-[13px]">
          <p className="flex items-center gap-2 font-medium"><DatabaseIcon size={16} className="text-warn" /> {t("A backup is taken first")}</p>
          <p className="text-muted">
            {t("This page cannot take one itself: the server's backup (every night, and before every deploy) is the safety net.")}{" "}
            {backup
              ? t("The last one finished {when}.", { when: timeAgo(backup).toLowerCase() })
              : t("When the last one ran is not visible from here: ask whoever runs the server to take one now.")}
          </p>
          {!backup ? <code className="w-fit max-w-full rounded-sm bg-surface-2 px-2 py-1 font-mono text-[11.5px] break-all">{ov.backup.command}</code> : null}
          <p className="text-muted">{t("For your own copy, use Export all data above.")}</p>
        </div>

        <div>
          <Button variant="danger" disabled={!plan.ready} onClick={() => setAsking(true)}>
            <RocketLaunchIcon size={16} /> {t("Start fresh…")}
          </Button>
        </div>
      </CardBody>
      <ConfirmForm open={asking} onOpenChange={setAsking} danger needsCode={ov.needs_code} workspaceName={ov.workspace.name}
        title={t("Start fresh for {name}", { name: ov.workspace.name })} submit={t("Start fresh")}
        description={t("{n} members leave and {c} companies are removed. This cannot be undone from here.", { n: num(ov.members.to_remove), c: num(plan.removed) })}
        onConfirm={async (v) => {
          const r = await startFresh({ ...v, remove_branch_ids: [...remove], move_to: plan.needsHome ? plan.home : null });
          setDone(r);
          setRemove(new Set());
          setMoveTo(null);
          toast.success(t("Done. This office starts fresh."));
          await qc.invalidateQueries();
        }} />
    </Card>
  );
}
