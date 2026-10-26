/** P50 CRM connections (owner): other systems whose records show up as a CRM list. Each
 * connection is a card (which list it fills, the last sync and how often, on/off, sync now,
 * change the key or how often, remove). "Connect a system" is a guided wizard: pick a system,
 * give what it needs, test it and choose the fields, then name the list. A webhook gets an
 * address to paste into the other system instead; a CSV file from this device is copied in once. */
import {
  ArrowLeftIcon, ArrowSquareOutIcon, ArrowsClockwiseIcon, CaretRightIcon, CheckCircleIcon, ClockIcon, CopyIcon,
  DotsThreeIcon, FileArrowUpIcon, KeyIcon, LinkSimpleIcon, LockKeyIcon, PlugsConnectedIcon, PlusIcon, TrashIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { toast } from "sonner";

import { EmptyState, IconTile, Section } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm";
import { ResponsiveDialog } from "@/components/ui/dialog";
import { Field, FormError, Input } from "@/components/ui/field";
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from "@/components/ui/menu";
import { Pill } from "@/components/ui/pill";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { SwitchField } from "@/components/ui/switch";
import { msg, useT } from "@/i18n";
import { ApiError, errorMessage } from "@/lib/api";
import {
  addConnector, addObject, crmConnectorsQuery, crmKeys, deleteConnector, FIELD_TYPES, importCsv, newHookAddress, syncConnector,
  testConnector, updateConnector, type Connector, type FieldType, type FoundField, type Preset,
} from "@/lib/crm-hub";
import { cn, timeAgo } from "@/lib/utils";

import { crmIcon } from "./icons";

// ------------------------------------------------------------------------------- constants

const FREQUENCIES: { value: number; label: string }[] = [
  { value: 15, label: msg("Every 15 minutes") },
  { value: 30, label: msg("Every 30 minutes") },
  { value: 60, label: msg("Every hour") },
  { value: 180, label: msg("Every 3 hours") },
  { value: 360, label: msg("Every 6 hours") },
  { value: 720, label: msg("Twice a day") },
  { value: 1440, label: msg("Once a day") },
  { value: 10080, label: msg("Once a week") },
];

/** The systems people know by name first; the do-it-yourself ones last. */
const ORDER = ["shopify", "woocommerce", "stripe", "hubspot", "airtable", "google_sheet", "csv", "rest", "webhook"];

/** Imported data cannot point at people or other lists, and numbers are given by the other system. */
const IMPORT_TYPES = FIELD_TYPES.filter((f) => !["person", "relation", "file", "auto"].includes(f.type));

const MAX_FILE = 3_000_000;

type AuthType = "none" | "bearer" | "header" | "query" | "basic";
type PageType = "none" | "page" | "offset" | "cursor" | "link" | "stripe";

const AUTH_TYPES: { value: AuthType; label: string; hint: string }[] = [
  { value: "bearer", label: msg("As a \"Bearer\" token"), hint: msg("The most common way") },
  { value: "header", label: msg("In a header with its own name"), hint: msg("e.g. X-API-Key") },
  { value: "query", label: msg("Inside the web address"), hint: msg("e.g. ?api_key=...") },
  { value: "basic", label: msg("Username and password"), hint: msg("The key is the password") },
];

const PAGE_TYPES: { value: PageType; label: string }[] = [
  { value: "none", label: msg("Everything comes in one reply") },
  { value: "page", label: msg("Page numbers (page=2, page=3...)") },
  { value: "offset", label: msg("Skip a number of records (offset=100...)") },
  { value: "cursor", label: msg("A \"next\" value inside the reply") },
  { value: "link", label: msg("A \"next\" link in the reply headers") },
  { value: "stripe", label: msg("Stripe style (starting_after)") },
];

function freqLabel(t: (s: string, v?: Record<string, string | number>) => string, minutes: number): string {
  const known = FREQUENCIES.find((f) => f.value === minutes);
  return known ? t(known.label) : t("Every {n} minutes", { n: minutes });
}

function frequencyOptions(t: (s: string) => string, current: number) {
  const opts = FREQUENCIES.map((f) => ({ value: String(f.value), label: t(f.label) }));
  if (!FREQUENCIES.some((f) => f.value === current)) opts.push({ value: String(current), label: String(current) });
  return opts;
}

function sampleText(v: unknown): string {
  if (v === null || v === undefined || v === "") return "";
  if (typeof v === "object") {
    try {
      return JSON.stringify(v).slice(0, 120);
    } catch {
      return "";
    }
  }
  return String(v as string | number | boolean).slice(0, 120);
}

function copyText(t: (s: string) => string, text: string) {
  if (!navigator.clipboard) {
    toast.error(t("Copy blocked by the browser."));
    return;
  }
  void navigator.clipboard.writeText(text).then(() => toast.success(t("Copied.")), () => toast.error(t("Copy blocked by the browser.")));
}

/** The address (host only) someone typed, without https:// or a trailing path. */
function hostOf(raw: string): string {
  return raw.trim().replace(/^https?:\/\//i, "").replace(/\/.*$/, "").toLowerCase();
}

function presetIcon(c: Connector, presets: Preset[]): string {
  const p = presets.find((x) => x.key === c.preset);
  if (p) return p.icon;
  return c.kind === "webhook" ? "webhooks-logo" : c.kind === "csv" ? "file-csv" : "plugs-connected";
}

/** A webhook's full address, to paste into the other system. */
const hookUrl = (path: string) => `${window.location.origin}${path}`;

// ------------------------------------------------------------------------------- the page

export function CrmConnections({ onOpenObject }: { onOpenObject: (key: string) => void }) {
  const t = useT();
  const q = useQuery(crmConnectorsQuery);
  const [wizard, setWizard] = useState(false);
  // A webhook's address is given once, when it is made: kept here for this visit.
  const [hooks, setHooks] = useState<Record<string, string>>({});

  if (q.isLoading) {
    return (
      <div className="grid gap-3">
        <Skeleton className="h-10 w-56" />
        <div className="grid grid-cols-[minmax(0,1fr)] gap-3 lg:grid-cols-2">
          <Skeleton className="h-52 rounded-[var(--radius-md)]" />
          <Skeleton className="h-52 rounded-[var(--radius-md)]" />
        </div>
      </div>
    );
  }
  if (q.error) return <FormError message={errorMessage(q.error)} />;

  const connectors = q.data?.connectors ?? [];
  const presets = q.data?.presets ?? [];
  const connectBtn = (
    <Button onClick={() => setWizard(true)} className="max-sm:w-full">
      <PlusIcon size={16} weight="bold" /> {t("Connect a system")}
    </Button>
  );

  return (
    <div className="grid gap-4">
      {connectors.length ? (
        <Section
          title={t("Connections")}
          description={t("Other systems whose records show up in your CRM, kept up to date by themselves.")}
          actions={connectBtn}
        >
          <ul className="grid grid-cols-[minmax(0,1fr)] gap-3 lg:grid-cols-2">
            {connectors.map((c) => (
              <ConnectorCard key={c.id} conn={c} presets={presets} hookPath={hooks[c.id]} onNewHook={(path) => setHooks((h) => ({ ...h, [c.id]: path }))} onOpenObject={onOpenObject} />
            ))}
          </ul>
        </Section>
      ) : (
        <EmptyState
          icon={PlugsConnectedIcon}
          title={t("Bring in data from your other systems")}
          body={t("Connect another system and its records show up here as a CRM list that keeps itself up to date. For example: orders from your online store (Shopify, WooCommerce), customers and payments from Stripe, contacts from HubSpot, or a list you keep in a Google Sheet.")}
          action={connectBtn}
        />
      )}
      <p className="flex items-start gap-1.5 text-[12.5px] text-muted">
        <LockKeyIcon size={14} className="mt-0.5 shrink-0" />
        {t("Keys and passwords you give are stored encrypted and never shown again, not even to you.")}
      </p>
      {wizard ? (
        <ConnectWizard
          presets={presets}
          onClose={() => setWizard(false)}
          onCreated={(c) => { if (c.webhook_path) setHooks((h) => ({ ...h, [c.id]: c.webhook_path! })); }}
          onOpenObject={(key) => { setWizard(false); onOpenObject(key); }}
        />
      ) : null}
    </div>
  );
}

// ------------------------------------------------------------------------------- one connection

function ConnectorCard({ conn: c, presets, hookPath, onNewHook, onOpenObject }: {
  conn: Connector; presets: Preset[]; hookPath?: string; onNewHook: (path: string) => void; onOpenObject: (key: string) => void;
}) {
  const t = useT();
  const qc = useQueryClient();
  const [dialog, setDialog] = useState<"key" | "often" | "remove" | null>(null);
  const refresh = () => void qc.invalidateQueries({ queryKey: crmKeys.all });
  const Ico = crmIcon(presetIcon(c, presets));
  const preset = presets.find((p) => p.key === c.preset);
  const hook = c.kind === "webhook";

  const sync = useMutation({
    mutationFn: () => syncConnector(c.id),
    onSuccess: (r) => {
      refresh();
      if (r.last_status === "error") toast.error(r.last_error || t("It did not work this time."));
      else toast.success(syncSummary(t, r.sync));
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const toggle = useMutation({
    mutationFn: (enabled: boolean) => updateConnector(c.id, { enabled }),
    onSuccess: (r) => { refresh(); toast.success(r.enabled ? t("{name} is on.", { name: r.name }) : t("{name} is paused.", { name: r.name })); },
    onError: (e) => toast.error(errorMessage(e)),
  });

  let status: ReactNode;
  if (c.last_status === "never" || !c.last_sync_at) {
    status = <Pill tone="neutral">{hook ? t("Nothing received yet") : t("Not synced yet")}</Pill>;
  } else if (c.last_status === "error") {
    status = <Pill tone="danger"><WarningCircleIcon size={13} weight="bold" />{t("Last try failed {when}", { when: timeAgo(c.last_sync_at) })}</Pill>;
  } else {
    status = <Pill tone="ok"><CheckCircleIcon size={13} weight="bold" />{hook ? t("Last received {when}", { when: timeAgo(c.last_sync_at) }) : t("Synced {when}", { when: timeAgo(c.last_sync_at) })}</Pill>;
  }
  const counts = c.last_status === "ok" ? statsLine(t, c.stats) : "";

  return (
    <li className="min-w-0">
      <Card className="grid h-full gap-3 p-4">
        <div className="flex items-start gap-3">
          <IconTile icon={Ico} tone={c.enabled ? "accent" : "neutral"} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[14.5px] font-semibold">{c.name}</p>
            <p className="truncate text-[12.5px] text-muted">{preset ? t(preset.name) : hook ? t("Another system sends us records") : t("Another system")}</p>
          </div>
          <Menu>
            <MenuTrigger asChild>
              <Button variant="ghost" size="icon" className="-mt-1 -mr-2 size-11" aria-label={t("More for {name}", { name: c.name })}>
                <DotsThreeIcon size={22} weight="bold" />
              </Button>
            </MenuTrigger>
            <MenuContent>
              {!hook ? <MenuItem icon={<KeyIcon />} onSelect={() => setDialog("key")}>{t("Change key or password")}</MenuItem> : null}
              {!hook ? <MenuItem icon={<ClockIcon />} onSelect={() => setDialog("often")}>{t("Change how often")}</MenuItem> : null}
              {!hook ? <MenuSeparator /> : null}
              <MenuItem danger icon={<TrashIcon />} onSelect={() => setDialog("remove")}>{t("Remove")}</MenuItem>
            </MenuContent>
          </Menu>
        </div>

        <div className="grid gap-1.5">
          <div className="flex flex-wrap items-center gap-2">{status}{counts ? <span className="text-[12.5px] text-muted">{counts}</span> : null}</div>
          {c.last_status === "error" && c.last_error ? (
            <p className="rounded-sm border border-danger/25 bg-danger/6 px-3 py-2 text-[13px] break-words text-danger">
              {c.last_error}
            </p>
          ) : null}
        </div>

        {c.object ? (
          <button type="button" onClick={() => onOpenObject(c.object!.key)}
            className="flex min-h-11 w-full items-center gap-2 rounded-sm border border-border bg-surface-2/50 px-3 text-left text-[13.5px] hover:border-accent/50">
            <span className="shrink-0 text-muted">{t("Fills the list")}</span>
            <span className="min-w-0 flex-1 truncate font-medium">{c.object.name}</span>
            <CaretRightIcon size={16} className="shrink-0 text-muted" />
          </button>
        ) : (
          <p className="text-[13px] text-muted">{t("Its list was removed. Remove this connection and connect again.")}</p>
        )}

        {hook ? <HookAddress id={c.id} path={hookPath} onNew={onNewHook} /> : null}

        <div className="mt-auto flex flex-col gap-3 border-t border-border pt-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0 flex-1">
            <SwitchField
              checked={c.enabled}
              disabled={toggle.isPending}
              onCheckedChange={(v) => toggle.mutate(v)}
              label={hook ? t("Accept records") : t("Keep it up to date")}
              hint={!c.enabled ? (hook ? t("Paused: what it sends is turned away") : t("Paused")) : hook ? t("On") : freqLabel(t, c.every_minutes)}
            />
          </div>
          {!hook ? (
            <Button variant="outline" className="h-11 max-sm:w-full" loading={sync.isPending} onClick={() => sync.mutate()}>
              {!sync.isPending ? <ArrowsClockwiseIcon size={16} /> : null} {t("Sync now")}
            </Button>
          ) : null}
        </div>
      </Card>

      {dialog === "key" ? <KeyDialog conn={c} onClose={() => setDialog(null)} /> : null}
      {dialog === "often" ? <OftenDialog conn={c} onClose={() => setDialog(null)} /> : null}
      <ConfirmDialog
        open={dialog === "remove"}
        onOpenChange={(o) => !o && setDialog(null)}
        title={t("Remove {name}?", { name: c.name })}
        body={c.object
          ? t("We stop reading from this system. The records already brought in stay in {list}, and you can remove that list separately.", { list: c.object.name })
          : t("We stop reading from this system.")}
        confirmLabel={t("Remove")}
        danger
        onConfirm={async () => {
          try {
            await deleteConnector(c.id);
            refresh();
            toast.success(t("{name} removed.", { name: c.name }));
          } catch (e) {
            toast.error(errorMessage(e));
          }
        }}
      />
    </li>
  );
}

function statsLine(t: (s: string, v?: Record<string, string | number>) => string, stats: Record<string, unknown> | undefined): string {
  if (!stats) return "";
  const created = Number(stats.created ?? 0);
  const updated = Number(stats.updated ?? 0);
  if (!created && !updated) return stats.received !== undefined ? t("No changes") : "";
  return t("{a} new, {b} changed", { a: created, b: updated });
}

function syncSummary(t: (s: string, v?: Record<string, string | number>) => string, stats: Record<string, unknown> | undefined): string {
  if (!stats) return t("Up to date.");
  const created = Number(stats.created ?? 0);
  const updated = Number(stats.updated ?? 0);
  if (!created && !updated) return t("Up to date. Nothing new.");
  return t("Up to date: {a} new, {b} changed.", { a: created, b: updated });
}

/** The webhook's address (when known this visit) with a Copy button; lost, a new one. */
function HookAddress({ id, path, onNew }: { id: string; path?: string; onNew: (path: string) => void }) {
  const t = useT();
  const [asking, setAsking] = useState(false);
  const make = useMutation({
    mutationFn: () => newHookAddress(id),
    onSuccess: (c) => { if (c.webhook_path) onNew(c.webhook_path); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  if (!path) {
    return (
      <div className="grid gap-2 rounded-sm bg-surface-2 px-3 py-2 text-[12.5px] text-muted">
        <p>{t("The address to paste into the other system was shown once, when you made this.")}</p>
        <Button size="sm" variant="outline" className="justify-self-start" loading={make.isPending} onClick={() => setAsking(true)}>{t("Get a new address")}</Button>
        <ConfirmDialog open={asking} onOpenChange={setAsking} title={t("Get a new address?")} confirmLabel={t("Get a new address")}
          body={t("The old address stops working at once. Paste the new one into the other system.")} onConfirm={() => make.mutate()} />
      </div>
    );
  }
  return <CopyBox value={hookUrl(path)} hint={t("Paste this address into the other system where it asks where to send data (often called a \"webhook URL\"). Copy it now: it is shown only this once.")} />;
}

function CopyBox({ value, hint }: { value: string; hint: ReactNode }) {
  const t = useT();
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-1.5">
      <div className="flex items-center gap-2">
        <Input readOnly value={value} aria-label={t("Address")} className="h-11 min-w-0 font-mono text-[12.5px]" onFocus={(e) => e.currentTarget.select()} />
        <Button variant="outline" className="h-11 shrink-0" onClick={() => copyText(t, value)}>
          <CopyIcon size={16} /> {t("Copy")}
        </Button>
      </div>
      <p className="text-[12.5px] text-muted">{hint}</p>
    </div>
  );
}

// ------------------------------------------------------------------------------- small dialogs

function KeyDialog({ conn, onClose }: { conn: Connector; onClose: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const auth = (conn.config.auth ?? {}) as { type?: string; username?: string };
  const basic = auth.type === "basic";
  const [secret, setSecret] = useState("");
  const [username, setUsername] = useState(auth.username ?? "");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const save = useMutation({
    mutationFn: async () => {
      const body: Parameters<typeof updateConnector>[1] = { secret: secret.trim() };
      if (basic && username.trim() !== (auth.username ?? "")) {
        const rest = Object.fromEntries(Object.entries(conn.config).filter(([k]) => k !== "secret_set"));
        body.config = { ...rest, auth: { ...auth, username: username.trim() } };
      }
      await updateConnector(conn.id, body);
      return syncConnector(conn.id);
    },
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: crmKeys.all });
      if (r.last_status === "error") toast.error(t("Saved, but it still did not work: {error}", { error: r.last_error ?? "" }));
      else toast.success(t("Saved, and it works."));
      onClose();
    },
    onError: (e) => setErrors(e instanceof ApiError && Object.keys(e.fields).length ? e.fields : { _: errorMessage(e) }),
  });
  return (
    <ResponsiveDialog open onOpenChange={(o) => !o && onClose()} title={t("Change key or password")}
      description={t("Paste the new one from {name}. The old one is replaced.", { name: conn.name })}
      footer={<><Button variant="outline" onClick={onClose}>{t("Cancel")}</Button><Button loading={save.isPending} disabled={!secret.trim()} onClick={() => save.mutate()}>{t("Save and try it")}</Button></>}>
      <div className="grid gap-3">
        <FormError message={errors._} />
        {basic ? <Field label={t("Username")} value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="off" error={errors["config"]} /> : null}
        <Field label={t("New key or password")} type="password" autoComplete="new-password" value={secret} onChange={(e) => setSecret(e.target.value)} autoFocus
          error={errors.secret} hint={conn.config.secret_set ? t("A key is saved now. It is stored encrypted and never shown again.") : t("Stored encrypted and never shown again.")} />
      </div>
    </ResponsiveDialog>
  );
}

function OftenDialog({ conn, onClose }: { conn: Connector; onClose: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const [minutes, setMinutes] = useState(conn.every_minutes);
  const save = useMutation({
    mutationFn: () => updateConnector(conn.id, { every_minutes: minutes }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: crmKeys.all }); toast.success(t("Saved.")); onClose(); },
  });
  const fieldErr = save.error instanceof ApiError ? save.error.fields.every_minutes : undefined;
  return (
    <ResponsiveDialog open onOpenChange={(o) => !o && onClose()} title={t("How often to sync")}
      description={t("How often we read {name} for new and changed records.", { name: conn.name })}
      footer={<><Button variant="outline" onClick={onClose}>{t("Cancel")}</Button><Button loading={save.isPending} onClick={() => save.mutate()}>{t("Save")}</Button></>}>
      <div className="grid gap-1.5">
        <span className="text-[13px] font-medium">{t("Check for changes")}</span>
        <Select value={String(minutes)} onValueChange={(v) => setMinutes(Number(v))} options={frequencyOptions(t, minutes)} label={t("Check for changes")} className="w-full" />
        {fieldErr ? <p className="text-[12.5px] text-danger">{fieldErr}</p> : null}
        {save.error && !fieldErr ? <FormError message={errorMessage(save.error)} /> : null}
      </div>
    </ResponsiveDialog>
  );
}

// ------------------------------------------------------------------------------- the wizard

type Step = "pick" | "details" | "fields" | "finish" | "done";
type Row = FoundField & { include: boolean };

interface Draft {
  url: string;
  secret: string;
  username: string;
  shop: string;
  site: string;
  table: string;
  authType: AuthType;
  authName: string;
  recordsPath: string;
  idPath: string;
  pageType: PageType;
  pageParam: string;
  cursorPath: string;
  csvMode: "link" | "file";
  fileText: string;
  fileName: string;
}

const EMPTY: Draft = {
  url: "", secret: "", username: "", shop: "", site: "", table: "", authType: "bearer", authName: "", recordsPath: "",
  idPath: "id", pageType: "none", pageParam: "", cursorPath: "", csvMode: "link", fileText: "", fileName: "",
};

/** What the person types for each kind of system. */
function secretLabel(t: (s: string) => string, key: string): string {
  switch (key) {
    case "shopify": return t("Admin API access token");
    case "woocommerce": return t("Consumer secret");
    case "hubspot": return t("Private app token");
    case "stripe": return t("Restricted key");
    case "airtable": return t("Personal access token");
    default: return t("Key or password from that system");
  }
}

function isFile(p: Preset, d: Draft) {
  return p.key === "csv" && d.csvMode === "file";
}

function flowOf(p: Preset | null, d: Draft): Step[] {
  if (!p) return ["pick", "details", "fields", "finish"];
  if (p.kind === "webhook") return ["pick", "finish"];
  if (isFile(p, d)) return ["pick", "details", "finish"];
  return ["pick", "details", "fields", "finish"];
}

/** Check what was typed and turn it into the connection's settings. */
function buildConfig(t: (s: string) => string, p: Preset, d: Draft): { config: Record<string, unknown>; errors: Record<string, string> } {
  const base = structuredClone(p.config);
  const errors: Record<string, string> = {};
  const needUrl = (v: string, field = "url") => {
    if (!v.trim()) errors[field] = t("Paste the web address.");
    else if (!/^https?:\/\/\S+$/i.test(v.trim())) errors[field] = t("Paste the full web address, starting with https://");
  };
  const needSecret = () => { if (!d.secret.trim()) errors.secret = t("Paste the key from that system."); };

  switch (p.key) {
    case "shopify": {
      let host = hostOf(d.shop);
      if (!host) errors.shop = t("Type your store address.");
      else if (!host.includes(".")) host = `${host}.myshopify.com`;
      base.url = String(base.url).replace("YOUR-SHOP.myshopify.com", host);
      needSecret();
      break;
    }
    case "woocommerce": {
      const host = d.site.trim().replace(/\/+$/, "");
      if (!host) errors.site = t("Type your website address.");
      const site = /^https?:\/\//i.test(host) ? host : `https://${host}`;
      base.url = String(base.url).replace("https://YOUR-SITE", site);
      base.auth = { type: "basic", username: d.username.trim() };
      if (!d.username.trim()) errors.username = t("Paste the consumer key.");
      needSecret();
      break;
    }
    case "airtable": {
      const link = d.table.trim();
      if (/^https:\/\/api\.airtable\.com\/v0\//i.test(link)) base.url = link;
      else {
        const m = /(app[A-Za-z0-9]+)\/(tbl[A-Za-z0-9]+)/.exec(link);
        if (m) base.url = `https://api.airtable.com/v0/${m[1]}/${m[2]}`;
        else errors.table = t("That does not look like an Airtable table link. Open the table and copy the address from your browser.");
      }
      needSecret();
      break;
    }
    case "hubspot":
    case "stripe":
      needSecret();
      break;
    case "csv":
      if (d.csvMode === "file") {
        if (!d.fileText) errors.fileText = t("Choose a CSV file.");
      } else {
        needUrl(d.url);
        base.url = d.url.trim();
      }
      break;
    case "google_sheet":
      if (!/docs\.google\.com\/spreadsheets\//i.test(d.url)) errors.url = t("Paste the Google Sheet's address (it starts with https://docs.google.com/spreadsheets/).");
      base.url = d.url.trim();
      break;
    case "rest": {
      needUrl(d.url);
      base.url = d.url.trim();
      const auth: Record<string, string> = { type: d.secret.trim() ? d.authType : "none" };
      if (d.authType === "header") auth.name = d.authName.trim() || "X-API-Key";
      if (d.authType === "query") auth.name = d.authName.trim() || "api_key";
      if (d.authType === "basic") auth.username = d.username.trim();
      base.auth = auth;
      base.records_path = d.recordsPath.trim();
      base.id_path = d.idPath.trim() || "id";
      const page: Record<string, string> = { type: d.pageType };
      if (["page", "offset", "cursor"].includes(d.pageType) && d.pageParam.trim()) page.param = d.pageParam.trim();
      if (d.pageType === "cursor") {
        if (!d.cursorPath.trim()) errors.cursorPath = t("Say where the \"next\" value is in the reply.");
        page.cursor_path = d.cursorPath.trim();
      }
      base.pagination = page;
      break;
    }
    case "webhook":
      base.id_path = d.idPath.trim() || "id";
      break;
    default:
      // A system the app does not know by name: the address it gives, and its key.
      if (p.kind !== "webhook") {
        const url = d.url.trim() || String(base.url ?? "");
        needUrl(url);
        base.url = url;
      }
  }
  return { config: base, errors };
}

/** The column names in a CSV's first line (for a quick look before copying it in). */
function csvColumns(text: string): string[] {
  const first = (text.charCodeAt(0) === 0xfeff ? text.slice(1) : text).split(/\r?\n/, 1)[0] ?? "";
  const sep = [",", ";", "\t", "|"].reduce((a, b) => (first.split(b).length > first.split(a).length ? b : a), ",");
  return first.split(sep).map((c) => c.trim().replace(/^"|"$/g, "")).filter(Boolean).slice(0, 40);
}

function ConnectWizard({ presets, onClose, onCreated, onOpenObject }: {
  presets: Preset[];
  onClose: () => void;
  onCreated: (c: Connector) => void;
  onOpenObject: (key: string) => void;
}) {
  const t = useT();
  const qc = useQueryClient();
  const [step, setStep] = useState<Step>("pick");
  const [preset, setPreset] = useState<Preset | null>(null);
  const [d, setD] = useState<Draft>(EMPTY);
  const [rows, setRows] = useState<Row[]>([]);
  const [found, setFound] = useState(0);
  const [titleField, setTitleField] = useState("");
  const [listName, setListName] = useState("");
  const [every, setEvery] = useState(60);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formErr, setFormErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [made, setMade] = useState<{ key: string | null; name: string; hook?: string; note: string; problems?: string[]; failed?: boolean } | null>(null);

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => { setD((x) => ({ ...x, [k]: v })); setErrors((e) => ({ ...e, [k]: "" })); };
  const sorted = [...presets].sort((a, b) => (ORDER.indexOf(a.key) + 1 || 99) - (ORDER.indexOf(b.key) + 1 || 99));
  const flow = flowOf(preset, d);
  const at = flow.indexOf(step);

  const fail = (e: unknown, known: string[]) => {
    if (e instanceof ApiError && Object.keys(e.fields).length) {
      const mine: Record<string, string> = {};
      const other: string[] = [];
      for (const [k, v] of Object.entries(e.fields)) {
        const rowErr = /^fields\.(\d+)\./.exec(k);
        if (rowErr) mine[`row${rowErr[1]}`] = v;
        else if (k === "name" || k === "object_name") mine.listName = v;
        else if (known.includes(k)) mine[k] = v;
        else other.push(v);
      }
      setErrors(mine);
      setFormErr(other.length ? `${e.message} ${other.join(" ")}` : e.message);
      if (Object.keys(mine).some((k) => k.startsWith("row"))) setStep("fields");
      return;
    }
    setFormErr(errorMessage(e));
  };

  const choose = (p: Preset) => {
    setPreset(p);
    setD({ ...EMPTY, idPath: String(p.config.id_path ?? "id") });
    setErrors({});
    setFormErr(null);
    setRows([]);
    setListName(["rest", "csv", "webhook"].includes(p.key) ? "" : t(p.name));
    setStep(p.kind === "webhook" ? "finish" : "details");
  };

  const runTest = async () => {
    if (!preset) return;
    const { config, errors: errs } = buildConfig(t, preset, d);
    setFormErr(null);
    if (Object.values(errs).some(Boolean)) { setErrors(errs); return; }
    if (isFile(preset, d)) { setStep("finish"); return; }
    setBusy(true);
    try {
      const r = await testConnector({ kind: preset.kind as "rest" | "csv", config, secret: d.secret.trim() || undefined });
      if (!r.fields.length) {
        setFormErr(t("It answered, but no records were found. Check the address, or (Advanced) where the list sits in the reply."));
        return;
      }
      const next = r.fields.map((f) => ({ ...f, include: true, type: IMPORT_TYPES.some((x) => x.type === f.type) ? f.type : ("text" as FieldType) }));
      setRows(next);
      setFound(r.count);
      setTitleField((next.find((f) => /(^|_)(name|title|full_name|email)$/i.test(f.key)) ?? next[0])?.key ?? "");
      setErrors({});
      setStep("fields");
    } catch (e) {
      fail(e, ["secret"]);
    } finally {
      setBusy(false);
    }
  };

  const create = async () => {
    if (!preset) return;
    if (!listName.trim()) { setErrors({ listName: t("Give the list a name.") }); return; }
    const { config } = buildConfig(t, preset, d);
    setBusy(true);
    setFormErr(null);
    try {
      if (isFile(preset, d)) {
        const obj = await addObject({ name: listName.trim(), icon: "file-csv", description: t("Copied from {file}", { file: d.fileName }) });
        const r = await importCsv(obj.key, d.fileText);
        void qc.invalidateQueries({ queryKey: crmKeys.all });
        toast.success(t("{name} is ready.", { name: obj.name }));
        setMade({ key: obj.key, name: obj.name, note: t("{n} records copied in.", { n: r.added }) + (r.skipped ? ` ${t("{n} rows were skipped.", { n: r.skipped })}` : ""), problems: r.problems });
      } else {
        const included = rows.filter((r) => r.include);
        const c = await addConnector({
          name: listName.trim(), kind: preset.kind, preset: preset.key, config, secret: d.secret.trim() || undefined,
          fields: rows, title_field: included.some((r) => r.key === titleField) ? titleField : included[0]?.key ?? null,
          object_name: listName.trim(), icon: preset.icon, every_minutes: every,
        });
        void qc.invalidateQueries({ queryKey: crmKeys.all });
        onCreated(c);
        toast.success(t("{name} is connected.", { name: c.name }));
        const stats = c.sync ?? {};
        const failed = c.last_status === "error";
        const note = c.kind === "webhook"
          ? t("Records the other system sends will appear in this list.")
          : failed
            ? t("The list is made, but the first sync did not work: {error}", { error: c.last_error ?? String(stats.error ?? "") })
            : t("{n} records brought in. It will keep itself up to date.", { n: Number(stats.created ?? 0) + Number(stats.updated ?? 0) });
        setMade({ key: c.object?.key ?? null, name: c.object?.name ?? c.name, hook: c.webhook_path, note, failed });
      }
      setStep("done");
    } catch (e) {
      fail(e, ["every_minutes"]);
    } finally {
      setBusy(false);
    }
  };

  const back = () => {
    setFormErr(null);
    const prev = flow[at - 1];
    if (prev) setStep(prev);
  };

  // ---- the step's body and buttons
  let body: ReactNode = null;
  let footer: ReactNode = null;
  let title = t("Connect a system");
  let description: string | undefined;
  const backBtn = <Button variant="outline" onClick={back} disabled={busy}><ArrowLeftIcon size={16} /> {t("Back")}</Button>;

  if (step === "pick") {
    description = t("Which system has the records you want in your CRM?");
    body = (
      <ul className="grid grid-cols-[minmax(0,1fr)] gap-2 sm:grid-cols-2">
        {sorted.map((p) => {
          const Ico = crmIcon(p.icon);
          return (
            <li key={p.key}>
              <button type="button" onClick={() => choose(p)}
                className="flex h-full min-h-14 w-full items-start gap-3 rounded-[var(--radius-md)] border border-border bg-surface p-3 text-left transition-colors hover:border-accent/50">
                <span className="grid size-10 shrink-0 place-items-center rounded-sm bg-accent-soft text-accent"><Ico size={20} weight="duotone" /></span>
                <span className="grid min-w-0 gap-0.5">
                  <span className="text-[14px] font-medium">{t(p.name)}</span>
                  <span className="line-clamp-2 text-[12px] text-muted">{t(p.help)}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    );
    footer = <Button variant="outline" onClick={onClose}>{t("Cancel")}</Button>;
  } else if (step === "details" && preset) {
    title = t(preset.name);
    description = t("Step {a} of {b}: where to read from", { a: at + 1, b: flow.length });
    body = <DetailsStep preset={preset} d={d} set={set} errors={errors} formErr={formErr} />;
    footer = <>{backBtn}<Button loading={busy} onClick={() => void runTest()}>{isFile(preset, d) ? t("Next") : t("Test and continue")}</Button></>;
  } else if (step === "fields" && preset) {
    title = t("Choose what to keep");
    description = t("Step {a} of {b}: we found {n} records. Tick what you want in the list.", { a: at + 1, b: flow.length, n: found });
    const kept = rows.filter((r) => r.include);
    const badLabel = kept.some((r) => !r.label.trim());
    body = <FieldsStep rows={rows} setRows={setRows} titleField={titleField} setTitleField={setTitleField} errors={errors} formErr={formErr} />;
    footer = <>{backBtn}<Button disabled={!kept.length || badLabel} onClick={() => { setFormErr(null); setStep("finish"); }}>{t("Next")}</Button></>;
  } else if (step === "finish" && preset) {
    title = preset.kind === "webhook" ? t(preset.name) : t("Name the list");
    description = t("Step {a} of {b}: last step", { a: at + 1, b: flow.length });
    const file = isFile(preset, d);
    body = (
      <div className="grid gap-4">
        <FormError message={formErr} />
        {preset.kind === "webhook" ? (
          <p className="text-[13.5px] text-muted">{t("You will get a web address to paste into the other system. Each record it sends there (as JSON) lands in this list.")}</p>
        ) : null}
        <Field label={t("Name of the list")} value={listName} onChange={(e) => { setListName(e.target.value); setErrors((x) => ({ ...x, listName: "" })); }}
          placeholder={t("e.g. Online orders, Stripe customers")} autoFocus error={errors.listName || undefined}
          hint={t("This is how it shows in your CRM. You can rename it later.")} maxLength={80} />
        {preset.kind !== "webhook" && !file ? (
          <div className="grid gap-1.5">
            <span className="text-[13px] font-medium">{t("Check for changes")}</span>
            <Select value={String(every)} onValueChange={(v) => setEvery(Number(v))} options={frequencyOptions(t, every)} label={t("Check for changes")} className="w-full" />
            {errors.every_minutes ? <p className="text-[12.5px] text-danger">{errors.every_minutes}</p> : <p className="text-[12.5px] text-muted">{t("New and changed records are brought in by themselves. You can also sync any time.")}</p>}
          </div>
        ) : null}
        {file ? <p className="text-[13px] text-muted">{t("The file is copied in once. To keep it up to date by itself, put it online (for example as a Google Sheet) and connect its link instead.")}</p> : null}
        {preset.kind === "webhook" ? (
          <details className="rounded-sm border border-border px-3 py-2">
            <summary className="flex min-h-9 cursor-pointer items-center text-[13px] font-medium">{t("Advanced (optional)")}</summary>
            <div className="mt-2 pb-1">
              <Field label={t("Which value is each record's ID")} value={d.idPath} onChange={(e) => set("idPath", e.target.value)}
                hint={t("A record sent again with the same ID updates the one already here. Usually \"id\".")} />
            </div>
          </details>
        ) : null}
      </div>
    );
    footer = <>{backBtn}<Button loading={busy} onClick={() => void create()}>{file ? t("Copy it in") : t("Create")}</Button></>;
  } else if (step === "done" && made) {
    title = made.failed ? t("Almost there") : t("All set");
    body = (
      <div className="grid gap-4">
        <div className="flex items-start gap-3">
          {made.failed
            ? <WarningCircleIcon size={28} weight="duotone" className="shrink-0 text-warn" />
            : <CheckCircleIcon size={28} weight="duotone" className="shrink-0 text-ok" />}
          <div className="grid min-w-0 gap-1 text-[13.5px]">
            <p className="font-semibold break-words">{made.name}</p>
            <p className="text-muted break-words">{made.note}</p>
            {made.failed ? <p className="text-muted">{t("Fix it from the ... menu on its card (Change key or password), then press Sync now.")}</p> : null}
          </div>
        </div>
        {made.problems?.length ? (
          <ul className="grid gap-1 rounded-sm bg-surface-2 px-3 py-2 text-[12.5px] text-muted">
            {made.problems.map((p, i) => <li key={i} className="break-words">{p}</li>)}
          </ul>
        ) : null}
        {made.hook ? <CopyBox value={hookUrl(made.hook)} hint={t("Paste this address into the other system where it asks where to send data (often called a \"webhook URL\"). It must send each record as JSON. Copy it now: it is shown only this once.")} /> : null}
      </div>
    );
    footer = (
      <>
        <Button variant="outline" onClick={onClose}>{t("Done")}</Button>
        {made.key ? <Button onClick={() => onOpenObject(made.key!)}><ArrowSquareOutIcon size={16} /> {t("Open the list")}</Button> : null}
      </>
    );
  }

  return (
    <ResponsiveDialog open onOpenChange={(o) => !o && !busy && onClose()} title={title} description={description} footer={footer}
      className="w-[min(92vw,40rem)]">
      {body}
    </ResponsiveDialog>
  );
}

// ------------------------------------------------------------------------------- step 2

function DetailsStep({ preset: p, d, set, errors, formErr }: {
  preset: Preset;
  d: Draft;
  set: <K extends keyof Draft>(k: K, v: Draft[K]) => void;
  errors: Record<string, string>;
  formErr: string | null;
}) {
  const t = useT();
  const err = (k: string) => errors[k] || undefined;
  const key = p.key;
  const known = ["shopify", "woocommerce", "airtable", "hubspot", "stripe", "google_sheet", "csv", "rest"].includes(key);
  const secretNeeded = ["shopify", "woocommerce", "airtable", "hubspot", "stripe"].includes(key) || (!known && p.kind === "rest");
  const secretField = (optional: boolean) => (
    <Field label={optional ? t("Key or password from that system (optional)") : secretLabel(t, key)} type="password" autoComplete="new-password"
      value={d.secret} onChange={(e) => set("secret", e.target.value)} error={err("secret")}
      hint={optional ? t("Only if it asks for one. Stored encrypted and never shown again.") : t("Stored encrypted and never shown again.")} />
  );

  const readFile = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > MAX_FILE) {
      toast.error(t("That file is too big (up to 3 MB). Split it, or put it online and use its link."));
      return;
    }
    set("fileText", await file.text());
    set("fileName", file.name);
  };
  const cols = d.fileText ? csvColumns(d.fileText) : [];

  return (
    <div className="grid gap-4">
      <p className="rounded-sm bg-surface-2 px-3 py-2 text-[13px] text-muted">{t(p.help)}</p>
      <FormError message={formErr} />

      {key === "shopify" ? (
        <Field label={t("Your Shopify store address")} value={d.shop} onChange={(e) => set("shop", e.target.value)} placeholder="my-shop.myshopify.com"
          inputMode="url" autoCapitalize="none" error={err("shop")} hint={t("The one that ends in .myshopify.com (you see it in Shopify admin).")} />
      ) : null}
      {key === "woocommerce" ? (
        <>
          <Field label={t("Your website address")} value={d.site} onChange={(e) => set("site", e.target.value)} placeholder="https://myshop.com"
            inputMode="url" autoCapitalize="none" error={err("site")} />
          <Field label={t("Consumer key")} value={d.username} onChange={(e) => set("username", e.target.value)} autoComplete="off" autoCapitalize="none"
            error={err("username")} hint={t("Starts with ck_")} />
        </>
      ) : null}
      {key === "airtable" ? (
        <Field label={t("Link to your Airtable table")} value={d.table} onChange={(e) => set("table", e.target.value)} placeholder="https://airtable.com/app.../tbl..."
          inputMode="url" autoCapitalize="none" error={err("table")} hint={t("Open the table in Airtable and copy the address from your browser.")} />
      ) : null}
      {key === "google_sheet" ? (
        <Field label={t("Link to the Google Sheet")} value={d.url} onChange={(e) => set("url", e.target.value)} placeholder="https://docs.google.com/spreadsheets/d/..."
          inputMode="url" autoCapitalize="none" error={err("url")} hint={t("The tab open in the link is read. Its first row must hold the column names.")} />
      ) : null}

      {key === "csv" ? (
        <>
          <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label={t("Where is the file?")}>
            {([["link", LinkSimpleIcon, t("A link to the file"), t("Kept up to date")], ["file", FileArrowUpIcon, t("A file on this device"), t("Copied in once")]] as const).map(([mode, Ico, label, sub]) => (
              <button key={mode} type="button" role="radio" aria-checked={d.csvMode === mode} onClick={() => set("csvMode", mode)}
                className={cn("flex min-h-14 items-center gap-2.5 rounded-[var(--radius-md)] border p-3 text-left", d.csvMode === mode ? "border-accent bg-accent-soft/50" : "border-border")}>
                <Ico size={20} className="shrink-0 text-accent" />
                <span className="grid min-w-0"><span className="text-[13.5px] font-medium">{label}</span><span className="text-[12px] text-muted">{sub}</span></span>
              </button>
            ))}
          </div>
          {d.csvMode === "link" ? (
            <Field label={t("Web address of the CSV file")} value={d.url} onChange={(e) => set("url", e.target.value)} placeholder="https://..."
              inputMode="url" autoCapitalize="none" error={err("url")} hint={t("For example an export link from another system.")} />
          ) : (
            <div className="grid gap-1.5">
              <label className={cn("flex min-h-14 cursor-pointer items-center gap-3 rounded-[var(--radius-md)] border border-dashed p-3",
                errors.fileText ? "border-danger" : "border-border hover:border-accent/50")}>
                <FileArrowUpIcon size={22} className="shrink-0 text-accent" />
                <span className="grid min-w-0">
                  <span className="truncate text-[13.5px] font-medium">{d.fileName || t("Choose a CSV file")}</span>
                  <span className="text-[12px] text-muted">{d.fileName ? t("Tap to choose another") : t("Up to 3 MB. The first row must hold the column names.")}</span>
                </span>
                <input type="file" accept=".csv,text/csv,text/plain" className="sr-only" onChange={(e) => void readFile(e.target.files?.[0])} />
              </label>
              {errors.fileText ? <p className="text-[12.5px] text-danger">{errors.fileText}</p> : null}
              {cols.length ? (
                <p className="text-[12.5px] break-words text-muted">{t("Columns found: {list}", { list: cols.join(", ") })}</p>
              ) : null}
            </div>
          )}
        </>
      ) : null}

      {key === "rest" || (!known && p.kind === "rest") ? (
        <Field label={t("Web address that lists the records")} value={d.url} onChange={(e) => set("url", e.target.value)}
          placeholder={String(p.config.url || "https://...")} inputMode="url" autoCapitalize="none" error={err("url")}
          hint={t("The other system's help pages usually give it (sometimes called an API address).")} />
      ) : null}
      {!known && p.kind === "csv" ? (
        <Field label={t("Web address of the file")} value={d.url} onChange={(e) => set("url", e.target.value)} inputMode="url" autoCapitalize="none" error={err("url")} />
      ) : null}

      {secretNeeded ? secretField(false) : null}

      {key === "rest" ? (
        <>
          {secretField(true)}
          {d.secret.trim() ? (
            <div className="grid gap-3">
              <div className="grid gap-1.5">
                <span className="text-[13px] font-medium">{t("How the key is sent")}</span>
                <Select value={d.authType} onValueChange={(v) => set("authType", v as AuthType)} label={t("How the key is sent")} className="w-full"
                  options={AUTH_TYPES.map((a) => ({ value: a.value, label: t(a.label), hint: t(a.hint) }))} />
                <p className="text-[12.5px] text-muted">{t("Not sure? Leave it as it is; the test tells you if it is wrong.")}</p>
              </div>
              {d.authType === "header" || d.authType === "query" ? (
                <Field label={d.authType === "header" ? t("Header name") : t("Name in the web address")} value={d.authName}
                  onChange={(e) => set("authName", e.target.value)} placeholder={d.authType === "header" ? "X-API-Key" : "api_key"} autoCapitalize="none" />
              ) : null}
              {d.authType === "basic" ? (
                <Field label={t("Username")} value={d.username} onChange={(e) => set("username", e.target.value)} autoComplete="off" autoCapitalize="none" />
              ) : null}
            </div>
          ) : null}
          <details className="rounded-sm border border-border px-3 py-2">
            <summary className="flex min-h-9 cursor-pointer items-center text-[13px] font-medium">{t("Advanced (optional)")}</summary>
            <div className="mt-2 grid gap-3 pb-1">
              <Field label={t("Where the list sits in the reply")} value={d.recordsPath} onChange={(e) => set("recordsPath", e.target.value)}
                placeholder="data.items" autoCapitalize="none" hint={t("Leave empty if the reply is the list itself. Use dots for deeper places, like data.items.")} />
              <Field label={t("Which value is each record's ID")} value={d.idPath} onChange={(e) => set("idPath", e.target.value)} autoCapitalize="none"
                hint={t("So a record that changes is updated, not added twice. Usually \"id\".")} />
              <div className="grid gap-1.5">
                <span className="text-[13px] font-medium">{t("When there are many records")}</span>
                <Select value={d.pageType} onValueChange={(v) => set("pageType", v as PageType)} label={t("When there are many records")} className="w-full"
                  options={PAGE_TYPES.map((x) => ({ value: x.value, label: t(x.label) }))} />
              </div>
              {d.pageType === "page" || d.pageType === "offset" || d.pageType === "cursor" ? (
                <Field label={t("Name of the setting in the web address")} value={d.pageParam} onChange={(e) => set("pageParam", e.target.value)} autoCapitalize="none"
                  placeholder={d.pageType === "page" ? "page" : d.pageType === "offset" ? "offset" : "cursor"} />
              ) : null}
              {d.pageType === "cursor" ? (
                <Field label={t("Where the \"next\" value is in the reply")} value={d.cursorPath} onChange={(e) => set("cursorPath", e.target.value)}
                  placeholder="paging.next.after" autoCapitalize="none" error={err("cursorPath")} />
              ) : null}
            </div>
          </details>
        </>
      ) : null}
    </div>
  );
}

// ------------------------------------------------------------------------------- step 3

function FieldsStep({ rows, setRows, titleField, setTitleField, errors, formErr }: {
  rows: Row[];
  setRows: (fn: (r: Row[]) => Row[]) => void;
  titleField: string;
  setTitleField: (k: string) => void;
  errors: Record<string, string>;
  formErr: string | null;
}) {
  const t = useT();
  const kept = rows.filter((r) => r.include);
  const patch = (i: number, p: Partial<Row>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...p } : r)));
  const typeOptions = IMPORT_TYPES.map((f) => ({ value: f.type, label: t(f.label), hint: t(f.hint) }));
  const titleValue = kept.some((r) => r.key === titleField) ? titleField : kept[0]?.key ?? "";

  return (
    <div className="grid gap-4">
      <FormError message={formErr} />
      {kept.length ? (
        <div className="grid gap-1.5">
          <span className="text-[13px] font-medium">{t("Which one names each record?")}</span>
          <Select value={titleValue} onValueChange={setTitleField} label={t("Which one names each record?")} className="w-full"
            options={kept.map((r) => ({ value: r.key, label: r.label || r.key }))} />
          <p className="text-[12.5px] text-muted">{t("Shown as the title of each card and row, like a customer's name or an order number.")}</p>
        </div>
      ) : (
        <FormError message={t("Tick at least one thing to keep.")} />
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[13px] text-muted">{t("{a} of {b} kept", { a: kept.length, b: rows.length })}</p>
        <div className="flex gap-1">
          <Button variant="ghost" size="sm" className="h-10" onClick={() => setRows((rs) => rs.map((r) => ({ ...r, include: true })))}>{t("Keep all")}</Button>
          <Button variant="ghost" size="sm" className="h-10" onClick={() => setRows((rs) => rs.map((r) => ({ ...r, include: false })))}>{t("Keep none")}</Button>
        </div>
      </div>

      <ul className="grid grid-cols-[minmax(0,1fr)] gap-2">
        {rows.map((r, i) => {
          const sample = sampleText(r.sample);
          const err = errors[`row${i}`] || (r.include && !r.label.trim() ? t("Give it a name.") : "");
          return (
            <li key={r.path} className={cn("rounded-[var(--radius-md)] border border-border p-2", !r.include && "bg-surface-2/50")}>
              <div className="flex items-start gap-1">
                <label className="grid size-11 shrink-0 cursor-pointer place-items-center">
                  <input type="checkbox" className="size-5 accent-accent" checked={r.include}
                    onChange={(e) => patch(i, { include: e.target.checked })} aria-label={t("Keep {name}", { name: r.label || r.path })} />
                </label>
                <div className="grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)] gap-2 py-0.5 sm:grid-cols-[minmax(0,1fr)_11rem]">
                  <Input value={r.label} onChange={(e) => patch(i, { label: e.target.value })} disabled={!r.include} maxLength={80}
                    aria-label={t("Name of this field")} aria-invalid={!!err} />
                  <Select value={r.type} onValueChange={(v) => patch(i, { type: v as FieldType })} options={typeOptions} disabled={!r.include}
                    label={t("Kind of field")} className="w-full" />
                  <p className="truncate text-[12px] text-muted sm:col-span-2" title={sample || undefined}>
                    {sample ? t("Example: {value}", { value: sample }) : t("Empty in the records we saw")}
                    {r.path !== r.label ? <span className="opacity-70"> · {r.path}</span> : null}
                  </p>
                  {err ? <p className="text-[12.5px] text-danger sm:col-span-2">{err}</p> : null}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
