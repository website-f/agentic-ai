/** P80: SharePoint and OneDrive folders in the Library. A manager pastes a folder's link, sees
 * what it opens (the folder's name and how many files will be read), picks who it is for, and
 * connects it. The files stay in SharePoint; only their searchable text is kept, so agents find
 * and cite them with the SharePoint link. Each folder is synced every few hours (or now). */
import {
  ArrowSquareOutIcon,
  ArrowsClockwiseIcon,
  CaretDownIcon,
  CloudIcon,
  FileTextIcon,
  FolderSimpleIcon,
  LinkBreakIcon,
  LinkIcon,
  SparkleIcon,
} from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, type FormEvent } from "react";
import { toast } from "sonner";

import { IconTile } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader, Meta } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm";
import { Input } from "@/components/ui/field";
import { Pill } from "@/components/ui/pill";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { t as tr, useT } from "@/i18n";
import { ApiError, errorMessage } from "@/lib/api";
import { libraryKeys } from "@/lib/library";
import {
  connectLink,
  disconnectLinked,
  draftSops,
  linkedFilesQuery,
  linkedKeys,
  linkedQuery,
  looksLikeLink,
  previewLink,
  syncLinked,
  type LinkedFile,
  type LinkedSource,
  type LinkPreview,
} from "@/lib/linked-sources";
import { microsoftAccountQuery, microsoftConfigQuery, microsoftKeys, readMsReturn, startSharePointConnect } from "@/lib/microsoft";
import { branchesQuery, meQuery } from "@/lib/queries";
import { timeAgo } from "@/lib/utils";

const EVERY = "all";

/** P80: Microsoft 365 sign-in that also asks to read files (read only). Only here: no one
 * else's sign-in ever asks for it. */
function useReconnect() {
  return useMutation({
    mutationFn: () => startSharePointConnect(),
    onSuccess: (r) => { window.location.href = r.url; },
    onError: (e) => toast.error(errorMessage(e)),
  });
}

/** Who a folder may be for: every company (owners and admins), or one company. */
function useScopeOptions() {
  const t = useT();
  const { data: me } = useQuery(meQuery);
  const { data: branches = [] } = useQuery(branchesQuery);
  const sc = me?.scope;
  if (!sc || sc.kind === "all") {
    return [{ value: EVERY, label: t("Every company") }, ...branches.map((b) => ({ value: b.id, label: b.name }))];
  }
  const mine = branches.find((b) => b.id === sc.branch_id);
  return mine ? [{ value: mine.id, label: mine.name }] : [];
}

function StatusPill({ s }: { s: LinkedSource }) {
  const t = useT();
  if (s.status === "syncing") return <Pill tone="info" live>{t("Reading…")}</Pill>;
  if (s.status === "needs_reconnect") return <Pill tone="warn">{t("Needs reconnect")}</Pill>;
  if (s.status === "error") return <Pill tone="danger">{t("Could not sync")}</Pill>;
  return <Pill tone="ok">{t("Up to date")}</Pill>;
}

function ConnectForm({ maxFiles }: { maxFiles: number }) {
  const t = useT();
  const qc = useQueryClient();
  const config = useQuery(microsoftConfigQuery);
  const account = useQuery({ ...microsoftAccountQuery, enabled: !!config.data?.configured });
  const reconnect = useReconnect();
  const options = useScopeOptions();
  const [url, setUrl] = useState("");
  const [preview, setPreview] = useState<LinkPreview | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const scope = picked && options.some((o) => o.value === picked) ? picked : (options[0]?.value ?? EVERY);

  const check = useMutation({
    mutationFn: () => previewLink(url),
    onSuccess: setPreview,
    onError: (e) => {
      setPreview(null);
      if (e instanceof ApiError && e.code === "files_not_allowed") qc.invalidateQueries({ queryKey: microsoftAccountQuery.queryKey });
      toast.error(errorMessage(e));
    },
  });
  const connect = useMutation({
    mutationFn: () => connectLink(url, scope === EVERY ? null : scope),
    onSuccess: (s) => {
      setUrl("");
      setPreview(null);
      qc.invalidateQueries({ queryKey: linkedKeys.all });
      qc.invalidateQueries({ queryKey: libraryKeys.all });
      toast.success(tr("{name} is connected. Its files are being read now.", { name: s.name }));
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  if (config.isLoading || account.isLoading) return <Skeleton className="h-20 rounded-[var(--radius-md)]" />;
  if (!config.data?.configured) {
    return <p className="text-[13px] text-muted">{t("Microsoft 365 is not set up yet. An admin sets it up in Channels > Microsoft 365.")}</p>;
  }
  if (!account.data?.connected || account.data.files_ok === false) {
    const first = !account.data?.connected;
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-md)] border border-warn/30 bg-warn/6 p-3">
        <p className="min-w-0 flex-1 basis-64 text-[13px]">
          {first
            ? t("Connect your Microsoft 365 first. Folders are opened with your own sign-in, so only what you can already open is read.")
            : t("Reconnect Microsoft 365 once to allow SharePoint. Microsoft asks you to allow reading your files (read only).")}
        </p>
        <Button size="sm" loading={reconnect.isPending} onClick={() => reconnect.mutate()} className="max-sm:w-full">
          {first ? t("Connect Microsoft 365") : t("Reconnect Microsoft 365 to allow SharePoint")}
        </Button>
      </div>
    );
  }

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (looksLikeLink(url)) check.mutate();
    else toast.error(t("Paste a link that starts with https:// on sharepoint.com, onedrive.live.com or 1drv.ms."));
  };

  return (
    <div className="grid gap-3">
      <form onSubmit={submit} className="flex flex-wrap gap-2 max-sm:[&>*]:w-full">
        <label className="relative min-w-0 flex-1 basis-64">
          <span className="sr-only">{t("SharePoint or OneDrive link")}</span>
          <LinkIcon size={16} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted" />
          <Input value={url} onChange={(e) => { setUrl(e.target.value); setPreview(null); }} inputMode="url" autoComplete="off"
            placeholder={t("Paste a SharePoint or OneDrive folder link")} className="pl-9" />
        </label>
        <Button type="submit" variant="outline" loading={check.isPending} disabled={!url.trim()}>{t("Check link")}</Button>
      </form>
      {preview ? (
        <div className="grid gap-3 rounded-[var(--radius-md)] border border-border bg-surface-2/40 p-3">
          <div className="flex min-w-0 items-start gap-2.5">
            {preview.is_folder ? <FolderSimpleIcon size={20} weight="duotone" className="mt-0.5 shrink-0 text-accent" /> : <FileTextIcon size={20} weight="duotone" className="mt-0.5 shrink-0 text-accent" />}
            <div className="min-w-0">
              <p className="text-[13.5px] font-medium break-words">{preview.name}</p>
              <p className="text-[12.5px] text-muted">
                {preview.files === 1 ? t("1 file will be read") : t("{n} files will be read", { n: preview.files })}
                {preview.skipped ? ` · ${t("{n} other files (pictures, zips) are left out", { n: preview.skipped })}` : ""}
              </p>
              {preview.capped ? <p className="text-[12.5px] text-warn">{t("This folder is large: only the first {n} files are read.", { n: maxFiles })}</p> : null}
              {preview.already ? <p className="text-[12.5px] text-warn">{t("This folder is in the Library already.")}</p> : null}
            </div>
          </div>
          <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
            <label className="grid gap-1.5">
              <span className="text-[12.5px] font-medium text-muted">{t("Who it is for")}</span>
              <Select value={scope} onValueChange={setPicked} options={options} label={t("Who it is for")} className="w-full" />
            </label>
            <div className="flex flex-wrap gap-2 max-sm:[&>*]:flex-1">
              <Button variant="ghost" onClick={() => setPreview(null)}>{t("Cancel")}</Button>
              <Button loading={connect.isPending} disabled={preview.already || !preview.files || !options.length} onClick={() => connect.mutate()}>
                <CloudIcon size={16} /> {t("Connect")}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function FileRow({ f, source, canDraft }: { f: LinkedFile; source: LinkedSource; canDraft: boolean }) {
  const t = useT();
  const draft = useMutation({
    mutationFn: () => draftSops(source.id, [f.id]),
    onSuccess: () => toast.success(tr("The SOP draft is being written. It waits on the SOPs page for your approval.")),
    onError: (e) => toast.error(errorMessage(e)),
  });
  const pill = f.status === "indexed" ? <Pill tone="ok">{f.passages === 1 ? t("Indexed · 1 passage") : t("Indexed · {n} passages", { n: f.passages })}</Pill>
    : f.status === "held" ? <Pill tone="warn">{t("Held back")}</Pill>
    : f.status === "empty" ? <Pill tone="neutral">{t("No text found")}</Pill>
    : f.status === "too_large" ? <Pill tone="neutral">{t("Too large")}</Pill>
    : <Pill tone="danger">{t("Could not read")}</Pill>;
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2.5">
      <div className="min-w-0 flex-1 basis-56">
        <a href={f.web_url} target="_blank" rel="noreferrer noopener" className="text-[13px] font-medium break-words hover:text-accent hover:underline">{f.name}</a>
        {f.path !== f.name ? <p className="text-[12px] break-words text-muted">{f.path}</p> : null}
        {f.status === "held" ? <p className="text-[12px] text-muted">{t("It holds passwords or personal data, so agents never see it.")}</p> : null}
        {f.error && f.status !== "held" ? <p className="text-[12px] text-muted">{f.error}</p> : null}
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        {pill}
        {canDraft && f.status === "indexed" ? (
          <Button size="sm" variant="ghost" loading={draft.isPending} onClick={() => draft.mutate()}><SparkleIcon size={14} /> {t("SOP draft")}</Button>
        ) : null}
      </div>
    </li>
  );
}

function FilesList({ source, canDraft }: { source: LinkedSource; canDraft: boolean }) {
  const t = useT();
  const { data = [], isLoading, error } = useQuery(linkedFilesQuery(source.id));
  if (isLoading) return <Skeleton className="h-16 rounded-[var(--radius-md)]" />;
  if (error) return <p role="alert" className="text-[13px] text-danger">{errorMessage(error)}</p>;
  if (!data.length) return <p className="text-[13px] text-muted">{t("No files read yet.")}</p>;
  return (
    <ul className="grid grid-cols-[minmax(0,1fr)] divide-y divide-border overflow-hidden rounded-[var(--radius-md)] border border-border bg-surface">
      {data.map((f) => <FileRow key={f.id} f={f} source={source} canDraft={canDraft} />)}
    </ul>
  );
}

function SourceCard({ s, canDraft }: { s: LinkedSource; canDraft: boolean }) {
  const t = useT();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [removing, setRemoving] = useState(false);
  const reconnect = useReconnect();
  const refresh = () => {
    qc.invalidateQueries({ queryKey: linkedKeys.all });
    qc.invalidateQueries({ queryKey: libraryKeys.all });
  };
  const sync = useMutation({
    mutationFn: () => syncLinked(s.id),
    onSuccess: () => { refresh(); qc.invalidateQueries({ queryKey: linkedKeys.files(s.id) }); toast.success(tr("Syncing {name} now.", { name: s.name })); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const drafts = useMutation({
    mutationFn: () => draftSops(s.id),
    onSuccess: (r) => toast.success(r.count === 1
      ? tr("1 SOP draft is being written. It waits on the SOPs page for your approval.")
      : tr("{n} SOP drafts are being written. They wait on the SOPs page for your approval.", { n: r.count })),
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <li className="grid gap-3 rounded-[var(--radius-md)] border border-border bg-surface p-3 sm:p-4">
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
        <div className="flex min-w-0 flex-1 basis-60 items-start gap-2.5">
          <FolderSimpleIcon size={22} weight="duotone" className="mt-0.5 shrink-0 text-accent" />
          <div className="min-w-0">
            <a href={s.web_url} target="_blank" rel="noreferrer noopener" className="inline-flex max-w-full items-center gap-1 text-[14px] font-semibold break-words hover:text-accent hover:underline">
              {s.name} <ArrowSquareOutIcon size={13} className="shrink-0 text-muted" />
            </a>
            <div className="text-[12.5px] text-muted">
              <Meta items={[
                s.branch_id ? s.scope_label : t("Every company"),
                s.files_indexed === 1 ? t("1 file indexed") : t("{n} files indexed", { n: s.files_indexed }),
                s.last_sync_at ? t("synced {when}", { when: timeAgo(s.last_sync_at).toLowerCase() }) : "",
                t("by {name}", { name: s.connected_by_name }),
              ]} />
            </div>
          </div>
        </div>
        <StatusPill s={s} />
      </div>
      {s.files_held ? <p className="text-[12.5px] text-muted">{t("{n} held back: they hold passwords or personal data, so agents never see them.", { n: s.files_held })}</p> : null}
      {s.files_failed ? <p className="text-[12.5px] text-muted">{t("{n} could not be read (too large or damaged).", { n: s.files_failed })}</p> : null}
      {s.capped ? <p className="text-[12.5px] text-warn">{t("This folder is large: only the first {n} files are read.", { n: s.files_seen })}</p> : null}
      {s.last_error && s.status !== "ready" ? <p role="alert" className="text-[12.5px] text-danger">{s.last_error}</p> : null}
      {s.status === "needs_reconnect" ? (
        s.connected_by_me ? (
          <Button size="sm" className="justify-self-start max-sm:w-full" loading={reconnect.isPending} onClick={() => reconnect.mutate()}>
            {t("Reconnect Microsoft 365 to allow SharePoint")}
          </Button>
        ) : (
          <p className="text-[12.5px] text-muted">{t("Ask {name} to reconnect Microsoft 365, or connect the link again yourself.", { name: s.connected_by_name })}</p>
        )
      ) : null}
      <div className="flex flex-wrap gap-2 max-sm:[&>*]:flex-1">
        <Button size="sm" variant="ghost" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          <CaretDownIcon size={14} className={open ? "rotate-180 transition-transform" : "transition-transform"} /> {t("Files")}
        </Button>
        {s.can_manage ? (
          <Button size="sm" variant="outline" loading={sync.isPending} disabled={s.status === "syncing"} onClick={() => sync.mutate()}>
            <ArrowsClockwiseIcon size={14} /> {t("Sync now")}
          </Button>
        ) : null}
        {canDraft && s.files_indexed ? (
          <Button size="sm" variant="outline" loading={drafts.isPending} onClick={() => drafts.mutate()}>
            <SparkleIcon size={14} /> {t("Turn into SOP drafts")}
          </Button>
        ) : null}
        {s.can_manage ? (
          <Button size="sm" variant="ghost" onClick={() => setRemoving(true)}><LinkBreakIcon size={14} /> {t("Disconnect")}</Button>
        ) : null}
      </div>
      {open ? <FilesList source={s} canDraft={canDraft} /> : null}
      <ConfirmDialog open={removing} onOpenChange={setRemoving} title={t("Disconnect {name}?", { name: s.name })} danger
        confirmLabel={t("Disconnect")} body={t("Agents stop finding its files. The files stay in SharePoint, untouched; you can connect the folder again any time.")}
        onConfirm={async () => {
          try {
            await disconnectLinked(s.id);
            refresh();
            toast.success(tr("Disconnected. Its searchable text was removed."));
          } catch (e) {
            toast.error(errorMessage(e));
          }
        }} />
    </li>
  );
}

/** Back from that sign-in (?ms=connected|error&msg=…): one toast, then the address is cleaned. */
function useSharePointReturn() {
  const t = useT();
  const qc = useQueryClient();
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const back = readMsReturn(Object.fromEntries(params));
    if (!back) return;
    if (back.ok) toast.success(t("Microsoft 365 reconnected. You can link SharePoint folders now."));
    else toast.error(back.message || t("Microsoft sign-in failed."), { duration: 12_000 });
    params.delete("ms");
    params.delete("msg");
    const rest = params.toString();
    window.history.replaceState(window.history.state, "", window.location.pathname + (rest ? `?${rest}` : ""));
    void qc.invalidateQueries({ queryKey: microsoftKeys.all });
    void qc.invalidateQueries({ queryKey: linkedKeys.all });
  }, [qc, t]);
}

export function LinkedSources() {
  const t = useT();
  useSharePointReturn();
  const { data, isLoading } = useQuery(linkedQuery);
  // Opened from the "Link SharePoint or OneDrive" button on another tab (#sharepoint).
  useEffect(() => {
    if (data && window.location.hash === "#sharepoint") document.getElementById("sharepoint")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [data]);
  if (isLoading) return <Skeleton className="h-28 rounded-[var(--radius-md)]" />;
  if (!data || (!data.can_connect && !data.sources.length)) return null;
  return (
    <Card id="sharepoint" data-guide="library.sharepoint" className="scroll-mt-24">
      <CardHeader icon={<IconTile icon={CloudIcon} size="sm" />} title={t("SharePoint and OneDrive")}
        description={t("Files stay in SharePoint. Only their searchable text is kept here, so agents find and cite them.")} />
      <CardBody className="grid gap-4">
        {data.can_connect ? <ConnectForm maxFiles={data.max_files} /> : null}
        {data.sources.length ? (
          <ul className="grid gap-3">
            {data.sources.map((s) => <SourceCard key={s.id} s={s} canDraft={data.can_draft_sops} />)}
          </ul>
        ) : null}
      </CardBody>
    </Card>
  );
}
