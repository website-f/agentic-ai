/** P57 Settings > Approved services: the switch that lets company information go only to
 * outside services the company approved (a client's NDA usually asks for this), and the list
 * of every outside service this workspace uses: approve one with where it runs and what data
 * it may get, withdraw it, or keep a request blocked. Off: everything works as before. */
import {
  CheckCircleIcon, ClockIcon, DownloadSimpleIcon, ProhibitIcon, ShieldCheckIcon, XIcon,
} from "@phosphor-icons/react";
import { queryOptions, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import { EmptyState, Page, PageHeader, Section } from "@/components/page";
import { Button } from "@/components/ui/button";
import { ResponsiveDialog } from "@/components/ui/dialog";
import { Field, TextareaField } from "@/components/ui/field";
import { Pill } from "@/components/ui/pill";
import { Skeleton } from "@/components/ui/skeleton";
import { SwitchField } from "@/components/ui/switch";
import { msg, useT } from "@/i18n";
import { api, errorMessage } from "@/lib/api";
import { saveFile } from "@/lib/native";
import { cn, timeAgo } from "@/lib/utils";

interface Approval { location: string; data: string; note: string; by: string; at: string }
interface Request { label: string; kind: string; count: number; first_at: string; last_at: string; what: string }
interface Service { key: string; kind: string; name: string; detail: string; approval: Approval | null; request: Request | null }
interface Overview { lock: boolean; services: Service[]; waiting: number }

const KEY = ["compliance"] as const;
const overviewQuery = queryOptions({ queryKey: KEY, queryFn: () => api<Overview>("/api/compliance") });

const KIND_LABEL: Record<string, string> = {
  "AI provider": msg("AI provider"),
  "File storage": msg("File storage"),
  "The web": msg("The web"),
  "Messaging": msg("Messaging"),
  "Phone notifications": msg("Phone notifications"),
  "Microsoft 365": msg("Microsoft 365"),
  "Google": msg("Google"),
  "Outside tools (MCP)": msg("Outside tools (MCP)"),
  "CRM connection": msg("CRM connection"),
};

export function ApprovedServicesPage() {
  const t = useT();
  const qc = useQueryClient();
  const q = useQuery(overviewQuery);
  const [approving, setApproving] = useState<Service | null>(null);
  const done = () => void qc.invalidateQueries({ queryKey: KEY });
  const lock = useMutation({
    mutationFn: (on: boolean) => api("/api/compliance/lock", "PUT", { on }),
    onSuccess: (_, on) => { done(); toast.success(on ? t("Only approved services are used from now on.") : t("Every service works as before.")); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const withdraw = useMutation({
    mutationFn: (key: string) => api(`/api/compliance/approve/${encodeURIComponent(key)}`, "DELETE"),
    onSuccess: done,
    onError: (e) => toast.error(errorMessage(e)),
  });
  const dismiss = useMutation({
    mutationFn: (key: string) => api(`/api/compliance/requests/${encodeURIComponent(key)}`, "DELETE"),
    onSuccess: done,
    onError: (e) => toast.error(errorMessage(e)),
  });

  const data = q.data;
  const approved = data?.services.filter((s) => s.approval) ?? [];
  // The approved list as a file, for the Project Specification or a client's records.
  const download = () => {
    const rows = [["Service", "Kind", "Detail", "Location", "Data it may receive", "Note", "Approved by", "Approved at"]];
    for (const s of approved) rows.push([s.name, s.kind, s.detail, s.approval!.location, s.approval!.data, s.approval!.note, s.approval!.by, s.approval!.at]);
    const csv = rows.map((r) => r.map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
    void saveFile(new Blob([csv], { type: "text/csv" }), "approved-services.csv"); // P96: phone app too
  };

  return (
    <Page>
      <PageHeader
        title={t("Approved services")}
        description={t("Choose which outside services may receive company information: AI providers, file storage, messaging, the web, Microsoft 365, Google and other connections. Use it when a client's agreement says their information goes only to services they approved in writing.")}
        actions={approved.length ? <Button variant="outline" onClick={download}><DownloadSimpleIcon size={16} /> {t("Download the approved list")}</Button> : undefined}
      />
      {q.isLoading ? (
        <Skeleton className="h-40 rounded-[var(--radius-md)]" />
      ) : q.error || !data ? (
        <p role="alert" className="text-danger">{errorMessage(q.error)}</p>
      ) : (
        <>
          <Section title={t("Only use approved services")}>
            <div className={cn("grid gap-2 rounded-[var(--radius-md)] border p-4", data.lock ? "border-accent/40 bg-accent-soft/30" : "border-border bg-surface")}>
              <SwitchField checked={data.lock} disabled={lock.isPending} onCheckedChange={(on) => lock.mutate(on)}
                label={data.lock ? t("On: only approved services are used") : t("Off: every service works as before")}
                hint={t("When on, anything not approved below is not used at all, and each attempt waits here for your decision. Things on this server (its own AI model and disk) need no approval.")} />
              {data.lock && data.waiting ? (
                <p className="flex items-center gap-1.5 text-[13px] font-medium text-warn"><ClockIcon size={15} /> {t("{n} services wait for your decision below.", { n: data.waiting })}</p>
              ) : null}
            </div>
          </Section>

          <Section title={t("Outside services this workspace uses")} description={t("Found from your settings: the AI providers you added, file storage, channels, connections and the web.")}>
            {data.services.length ? (
              <ul className="grid gap-2">
                {data.services.map((s) => (
                  <li key={s.key} className="grid gap-2 rounded-[var(--radius-md)] border border-border bg-surface p-3.5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                    <div className="grid min-w-0 gap-1">
                      <span className="flex min-w-0 flex-wrap items-center gap-2">
                        <span className="truncate text-[14px] font-semibold">{s.name}</span>
                        <Pill tone="neutral">{t(KIND_LABEL[s.kind] ?? s.kind)}</Pill>
                        {s.approval ? <Pill tone="ok"><CheckCircleIcon size={12} weight="fill" /> {t("Approved")}</Pill>
                          : s.request && data.lock ? <Pill tone="warn"><ClockIcon size={12} /> {t("Waiting for you")}</Pill>
                          : data.lock ? <Pill tone="danger"><ProhibitIcon size={12} /> {t("Blocked")}</Pill>
                          : <Pill tone="neutral">{t("Not approved")}</Pill>}
                      </span>
                      {s.detail ? <span className="truncate text-[12.5px] text-muted">{s.detail}</span> : null}
                      {s.approval ? (
                        <span className="text-[12px] text-muted">
                          {[s.approval.location && t("Location: {where}", { where: s.approval.location }), s.approval.data && t("Data: {what}", { what: s.approval.data }), t("approved by {name} {when}", { name: s.approval.by, when: timeAgo(s.approval.at).toLowerCase() })].filter(Boolean).join(" · ")}
                        </span>
                      ) : s.request && data.lock ? (
                        <span className="text-[12px] text-muted">
                          {t("Wanted {n} times, last {when}", { n: s.request.count, when: timeAgo(s.request.last_at).toLowerCase() })}{s.request.what ? ` · ${s.request.what}` : ""}
                        </span>
                      ) : null}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {s.approval ? (
                        <Button size="sm" variant="ghost" loading={withdraw.isPending && withdraw.variables === s.key} onClick={() => withdraw.mutate(s.key)}>{t("Withdraw")}</Button>
                      ) : (
                        <>
                          <Button size="sm" onClick={() => setApproving(s)}><ShieldCheckIcon size={14} /> {t("Approve")}</Button>
                          {s.request && data.lock ? (
                            <Button size="sm" variant="ghost" onClick={() => dismiss.mutate(s.key)}><XIcon size={14} /> {t("Keep blocked")}</Button>
                          ) : null}
                        </>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState icon={ShieldCheckIcon} title={t("No outside services yet")} body={t("Add an AI provider or a connection and it shows here.")} />
            )}
          </Section>
        </>
      )}
      {approving ? <ApproveDialog service={approving} onClose={() => setApproving(null)} onDone={() => { setApproving(null); done(); }} /> : null}
    </Page>
  );
}

function ApproveDialog({ service, onClose, onDone }: { service: Service; onClose: () => void; onDone: () => void }) {
  const t = useT();
  const [location, setLocation] = useState("");
  const [data, setData] = useState("");
  const [note, setNote] = useState("");
  const save = useMutation({
    mutationFn: () => api("/api/compliance/approve", "POST", { key: service.key, location, data, note }),
    onSuccess: () => { toast.success(t("{name} is approved.", { name: service.name })); onDone(); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <ResponsiveDialog open onOpenChange={(o) => !o && onClose()} title={t("Approve {name}", { name: service.name })}
      description={t("Record what the company agreed to, as the client's approval in writing says. It is kept with who approved it and when.")}
      footer={<><Button variant="outline" onClick={onClose}>{t("Cancel")}</Button><Button loading={save.isPending} onClick={() => save.mutate()}><ShieldCheckIcon size={15} /> {t("Approve")}</Button></>}>
      <div className="grid gap-4">
        <Field label={t("Where it processes or stores data")} value={location} onChange={(e) => setLocation(e.target.value)} placeholder={t("e.g. Singapore region, or USA")} />
        <TextareaField label={t("Data it may receive")} value={data} onChange={(e) => setData(e.target.value)} rows={2} placeholder={t("e.g. task text and documents, with personal data masked")} />
        <TextareaField label={t("Note (optional)")} value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder={t("e.g. approved by the client's email of 2 Nov 2026; no training on data")} />
      </div>
    </ResponsiveDialog>
  );
}
