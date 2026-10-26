/** P40: where company files are kept: the database (default), this server's disk, an
 * S3-compatible bucket (Backblaze B2, AWS S3, Cloudflare R2, Wasabi, MinIO) or the company's
 * own WebDAV file server; and storage imported into a company's Library. */
import { ArrowsClockwiseIcon, CheckCircleIcon, CloudIcon, DatabaseIcon, HardDrivesIcon, NetworkIcon, PlusIcon, TrashIcon } from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import { EmptyState, IconTile, Page, PageHeader } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader, ListCard } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm";
import { ResponsiveDialog } from "@/components/ui/dialog";
import { Field, FormError } from "@/components/ui/field";
import { Pill } from "@/components/ui/pill";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { SwitchField } from "@/components/ui/switch";
import { msg, useT } from "@/i18n";
import { api, ApiError, errorMessage } from "@/lib/api";
import { branchesQuery } from "@/lib/queries";
import { timeAgo } from "@/lib/utils";

type Kind = "local" | "s3" | "webdav";

interface SyncSettings {
  enabled?: boolean;
  branch_id?: string | null;
  department_id?: string | null;
  prefix?: string;
  folder?: string;
  last_sync?: string;
  imported?: number;
  error?: string | null;
  last_result?: { new: number; changed: number; gone: number; skipped: number };
}

interface Target {
  id: string;
  name: string;
  kind: Kind;
  config: Record<string, string | boolean>;
  is_primary: boolean;
  sync: SyncSettings;
  files: number;
}

const storageKey = ["storage"] as const;

const KIND: Record<Kind, { label: string; hint: string; icon: typeof CloudIcon }> = {
  local: { label: msg("This server's disk"), hint: msg("A folder on the server the app runs on, included in the nightly backup."), icon: HardDrivesIcon },
  s3: { label: msg("S3 bucket (Backblaze B2, AWS, R2, Wasabi)"), hint: msg("Any S3-compatible bucket. For Backblaze B2 use its S3 endpoint and an application key."), icon: CloudIcon },
  webdav: { label: msg("Company file server (WebDAV)"), hint: msg("Nextcloud, ownCloud, Synology, QNAP or any WebDAV share."), icon: NetworkIcon },
};

const FIELDS: Record<Kind, { key: string; label: string; placeholder?: string; secret?: boolean }[]> = {
  local: [{ key: "folder", label: msg("Folder name (optional)"), placeholder: "sop-share" }],
  s3: [
    { key: "endpoint", label: msg("Endpoint"), placeholder: "https://s3.us-west-004.backblazeb2.com" },
    { key: "region", label: msg("Region"), placeholder: "us-west-004" },
    { key: "bucket", label: msg("Bucket") },
    { key: "access_key", label: msg("Key ID") },
    { key: "secret_key", label: msg("Application key (secret)"), secret: true },
  ],
  webdav: [
    { key: "url", label: msg("Address"), placeholder: "https://files.company.my/remote.php/dav/files/agentic" },
    { key: "username", label: msg("Username") },
    { key: "password", label: msg("Password"), secret: true },
  ],
};

function AddDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const t = useT();
  const qc = useQueryClient();
  const [kind, setKind] = useState<Kind>("s3");
  const [name, setName] = useState("");
  const [config, setConfig] = useState<Record<string, string>>({});
  const [primary, setPrimary] = useState(false);
  const save = useMutation({
    mutationFn: () => api<Target>("/api/storage", "POST", { name: name || t(KIND[kind].label), kind, config, is_primary: primary }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: storageKey });
      toast.success(t("Tested and saved: a file was written, read back and deleted."));
      onOpenChange(false);
    },
  });
  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange} title={t("Add storage")}
      description={t("It is tested before it is saved: a small file is written, read back and deleted.")}
      footer={<>
        <Button variant="outline" onClick={() => onOpenChange(false)}>{t("Cancel")}</Button>
        <Button loading={save.isPending} onClick={() => save.mutate()}>{t("Test and save")}</Button>
      </>}>
      <div className="grid gap-4">
        <Select value={kind} onValueChange={(v) => { setKind(v as Kind); setConfig({}); }} label={t("Kind")} className="w-full"
          options={(Object.keys(KIND) as Kind[]).map((k) => ({ value: k, label: t(KIND[k].label), hint: t(KIND[k].hint) }))} />
        <Field label={t("Name")} value={name} onChange={(e) => setName(e.target.value)} placeholder={t(KIND[kind].label)} />
        {FIELDS[kind].map((f) => (
          <Field key={f.key} label={t(f.label)} type={f.secret ? "password" : "text"} autoComplete="off" placeholder={f.placeholder}
            value={config[f.key] ?? ""} onChange={(e) => setConfig({ ...config, [f.key]: e.target.value })} />
        ))}
        <SwitchField checked={primary} onCheckedChange={setPrimary} label={t("Keep new files here")}
          hint={t("New uploads and everything the AI makes go here. If it is ever unreachable, files are kept in the database instead, so nothing is lost.")} />
        <FormError message={save.error ? errorMessage(save.error) : null} />
      </div>
    </ResponsiveDialog>
  );
}

function ImportCard({ target }: { target: Target }) {
  const t = useT();
  const qc = useQueryClient();
  const { data: branches = [] } = useQuery(branchesQuery);
  const s = target.sync ?? {};
  const [enabled, setEnabled] = useState(!!s.enabled);
  const [branch, setBranch] = useState(s.branch_id ?? branches[0]?.id ?? "");
  const [prefix, setPrefix] = useState(s.prefix ?? "");
  const [folder, setFolder] = useState(s.folder ?? "");
  const save = useMutation({
    mutationFn: () => api<Target>(`/api/storage/${target.id}`, "PATCH", { sync: { enabled, branch_id: branch || null, prefix, folder } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: storageKey });
      toast.success(t("Saved."));
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const sync = useMutation({
    mutationFn: () => api<{ new: number; changed: number; gone: number; skipped: number }>(`/api/storage/${target.id}/sync`, "POST", {}),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: storageKey });
      toast.success(t("{n} new, {c} changed, {g} gone. New files are being read into the Library.", { n: r.new, c: r.changed, g: r.gone }));
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <div className="grid gap-3 rounded-sm border border-border bg-surface-2/40 p-3">
      <SwitchField checked={enabled} onCheckedChange={setEnabled} label={t("Import its documents into the Library")}
        hint={t("SOPs, policies and documents kept here are read in place (not copied) and every agent of the company can search them. Checked again every hour.")} />
      {enabled ? (
        <div className="grid gap-3 sm:grid-cols-3">
          <Select value={branch} onValueChange={setBranch} label={t("Company")} className="w-full"
            options={branches.map((b) => ({ value: b.id, label: b.name }))} />
          <Field label={t("Only this folder (optional)")} value={prefix} onChange={(e) => setPrefix(e.target.value)} placeholder="SOP/" />
          <Field label={t("Library folder")} value={folder} onChange={(e) => setFolder(e.target.value)} placeholder={target.name} />
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" loading={save.isPending} onClick={() => save.mutate()}>{t("Save")}</Button>
        {s.enabled ? (
          <Button size="sm" variant="ghost" loading={sync.isPending} onClick={() => sync.mutate()}><ArrowsClockwiseIcon size={14} /> {t("Import now")}</Button>
        ) : null}
        {s.last_sync ? <span className="text-[12px] text-muted">{t("Last checked {when}: {n} documents", { when: timeAgo(s.last_sync).toLowerCase(), n: s.imported ?? 0 })}</span> : null}
        {s.error ? <span className="text-[12px] text-danger">{s.error}</span> : null}
      </div>
    </div>
  );
}

function TargetRow({ target }: { target: Target }) {
  const t = useT();
  const qc = useQueryClient();
  const [removing, setRemoving] = useState(false);
  const k = KIND[target.kind];
  const act = useMutation({
    mutationFn: (what: "check" | "primary" | "unprimary") =>
      what === "check"
        ? api(`/api/storage/${target.id}/check`, "POST", {})
        : api(`/api/storage/${target.id}`, "PATCH", { is_primary: what === "primary" }),
    onSuccess: (_, what) => {
      qc.invalidateQueries({ queryKey: storageKey });
      toast.success(what === "check" ? t("It works: a file was written, read back and deleted.") : t("Saved."));
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const remove = useMutation({
    mutationFn: () => api(`/api/storage/${target.id}`, "DELETE"),
    onSuccess: () => qc.invalidateQueries({ queryKey: storageKey }),
    onError: (e) => toast.error(e instanceof ApiError ? e.message : errorMessage(e)),
  });
  return (
    <li className="grid min-w-0 gap-3 px-4 py-4 sm:px-5">
      <div className="flex min-w-0 flex-wrap items-start gap-3">
        <IconTile icon={k.icon} tone={target.kind === "s3" ? "info" : target.kind === "webdav" ? "violet" : "neutral"} size="sm" />
        <div className="min-w-0 flex-1">
          <p className="text-[14px] font-semibold break-words">{target.name} {target.is_primary ? <Pill tone="ok" className="ml-1">{t("New files go here")}</Pill> : null}</p>
          <p className="text-[12.5px] text-muted break-words">
            {t(k.label)}
            {target.config.bucket ? ` · ${String(target.config.bucket)}` : ""}
            {target.config.url ? ` · ${String(target.config.url)}` : ""}
            {" · "}{t("{n} files here", { n: target.files })}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="ghost" disabled={act.isPending} onClick={() => act.mutate("check")}><CheckCircleIcon size={14} /> {t("Test")}</Button>
          <Button size="sm" variant="ghost" disabled={act.isPending} onClick={() => act.mutate(target.is_primary ? "unprimary" : "primary")}>
            {target.is_primary ? t("Stop keeping new files here") : t("Keep new files here")}
          </Button>
          <Button size="sm" variant="ghost" className="text-muted hover:text-danger" onClick={() => setRemoving(true)}><TrashIcon size={14} /></Button>
        </div>
      </div>
      <ImportCard target={target} />
      <ConfirmDialog open={removing} onOpenChange={setRemoving} title={t("Remove {name}?", { name: target.name })} danger confirmLabel={t("Remove")}
        body={t("Only possible when no file is kept there any more. The files themselves are never deleted from your bucket or server.")}
        onConfirm={() => remove.mutate()} />
    </li>
  );
}

export function StoragePage() {
  const t = useT();
  const [adding, setAdding] = useState(0);
  const { data, isLoading, error } = useQuery({ queryKey: storageKey, queryFn: () => api<Target[]>("/api/storage") });
  return (
    <Page className="max-w-4xl">
      <PageHeader title={t("File storage")}
        description={t("Where company files are kept. Files stay in the app's database unless you add storage here: this server's disk, a Backblaze B2 or other S3 bucket, or your company's own file server. Any of them can also feed the Library.")}
        actions={<Button onClick={() => setAdding((n) => n + 1)}><PlusIcon size={16} weight="bold" /> {t("Add storage")}</Button>} />
      <Card>
        <CardHeader title={t("The app's database")} icon={<IconTile icon={DatabaseIcon} size="sm" />}
          description={data?.some((x) => x.is_primary) ? t("Holds the files saved before you chose another storage.") : t("New files are kept here now. Backed up every night with everything else.")} />
      </Card>
      {isLoading ? <Skeleton className="h-40" /> : error ? <p role="alert" className="text-danger">{errorMessage(error)}</p> : !data?.length ? (
        <EmptyState icon={CloudIcon} title={t("No other storage yet")}
          body={t("Add a bucket or your file server to keep files outside the database, or to bring the documents already there into the Library.")} />
      ) : (
        <Card>
          <ListCard className="rounded-none border-0">{data.map((x) => <TargetRow key={x.id} target={x} />)}</ListCard>
        </Card>
      )}
      <Card>
        <CardBody className="text-[12.5px] text-muted">
          {t("Keys and passwords are encrypted with the server's master key and never shown again. Only owners and admins see this page.")}
        </CardBody>
      </Card>
      {adding ? <AddDialog key={adding} open onOpenChange={(o) => !o && setAdding(0)} /> : null}
    </Page>
  );
}
