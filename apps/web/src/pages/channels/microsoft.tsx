/** Channels > Microsoft 365 (P34): the office's Entra app (client ID, write-only secret,
 * tenant), the addresses to paste into Entra, admin consent for shared mailboxes, the shared
 * mailboxes themselves (company, agent, rules, test), and each person's own Outlook. The
 * full admin walk-through is docs/MICROSOFT-365.md; the in-app guide here is its short form. */
import {
  ArrowSquareOutIcon,
  BookOpenTextIcon,
  BroadcastIcon,
  CopyIcon,
  EnvelopeSimpleIcon,
  InfoIcon,
  KanbanIcon,
  MicrosoftOutlookLogoIcon,
  PauseIcon,
  PencilSimpleIcon,
  PlayIcon,
  PlugsConnectedIcon,
  PlusIcon,
  ShieldCheckIcon,
  TimerIcon,
  TrashIcon,
  UsersFourIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useCallback, useState, type ReactNode } from "react";
import { toast } from "sonner";

import { IconTile } from "@/components/page";
import { Trans } from "@/components/trans";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader, Meta } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm";
import { ResponsiveDialog } from "@/components/ui/dialog";
import { Field, FormError, Input } from "@/components/ui/field";
import { Pill } from "@/components/ui/pill";
import { Segmented } from "@/components/ui/segmented";
import { Select } from "@/components/ui/select";
import { SideSheet } from "@/components/ui/side-sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { SwitchField } from "@/components/ui/switch";
import { msg, t as tNow, useT } from "@/i18n";
import { errorMessage } from "@/lib/api";
import {
  addMailbox,
  CATEGORY_LABEL,
  clientIdProblem,
  DEFAULT_RULES,
  isAnyTenant,
  isClock,
  isEmail,
  isMissingApi,
  mailboxesQuery,
  microsoftConfigQuery,
  microsoftKeys,
  removeMailbox,
  rulesSummary,
  saveMicrosoftConfig,
  startAdminConsent,
  TASK_CATEGORIES,
  tenantProblem,
  testMailbox,
  updateMailbox,
  WEBHOOK_LABEL,
  WEBHOOK_TONE,
  type MailboxRules,
  type MicrosoftConfig,
  type SharedMailbox,
  type TaskCategory,
} from "@/lib/microsoft";
import { branchesQuery } from "@/lib/queries";
import { cn, timeAgo } from "@/lib/utils";
import { agentsQuery } from "@/lib/work";
import { MissingServer, OutlookConnection, useMsReturn } from "@/pages/mail/outlook";
import { ChoiceCard } from "@/pages/welcome/parts";

const CATEGORY_HINT: Record<TaskCategory, string> = {
  invoice: msg("Bills and payment requests"),
  customer_request: msg("Quotes, orders, questions from customers"),
  tender: msg("Tender notices and RFQs"),
  complaint: msg("Unhappy customers, service problems"),
  internal: msg("Mail from colleagues"),
};

function copyText(text: string) {
  void navigator.clipboard.writeText(text).then(() => toast.success(tNow("Copied.")), () => toast.error(tNow("Copy blocked by the browser.")));
}

function CopyRow({ label, value, hint }: { label: string; value: string; hint?: ReactNode }) {
  const t = useT();
  return (
    <div className="grid min-w-0 gap-1">
      <span className="text-[12px] font-medium text-muted">{label}</span>
      <div className="flex min-w-0 items-start gap-1.5 rounded-sm border border-border bg-surface py-1 pr-1 pl-2.5">
        <span className="min-w-0 flex-1 py-1 font-mono text-[12.5px] break-all">{value}</span>
        <button type="button" onClick={() => copyText(value)} aria-label={t("Copy {label}", { label })}
          className="grid size-8 shrink-0 place-items-center rounded-sm text-muted transition-colors hover:bg-surface-2 hover:text-fg">
          <CopyIcon size={14} />
        </button>
      </div>
      {hint ? <span className="text-[12px] text-muted">{hint}</span> : null}
    </div>
  );
}

function Steps({ items }: { items: ReactNode[] }) {
  return (
    <ol className="grid gap-2.5 text-[13px]">
      {items.map((it, i) => (
        <li key={i} className="flex items-start gap-2.5">
          <span className="grid size-5 shrink-0 place-items-center rounded-full bg-accent-soft text-[11px] font-semibold text-accent tabular">{i + 1}</span>
          <span className="min-w-0 flex-1 leading-relaxed">{it}</span>
        </li>
      ))}
    </ol>
  );
}

const B = ({ children }: { children: ReactNode }) => <span className="font-medium text-fg">{children}</span>;
const Code = ({ children }: { children: ReactNode }) => <span className="rounded bg-surface-2 px-1 py-px font-mono text-[12px] break-all text-fg">{children}</span>;

// ---------------------------------------------------------------- the card

export function MicrosoftCard({ canManage }: { canManage: boolean }) {
  const t = useT();
  const { data: cfg, isLoading, error } = useQuery(microsoftConfigQuery);
  const [editing, setEditing] = useState(false);
  const [guide, setGuide] = useState(false);
  const search = useSearch({ from: "/app/channels" });
  const navigate = useNavigate({ from: "/channels" });
  const clear = useCallback(() => void navigate({ search: {}, replace: true }), [navigate]);
  useMsReturn(search, clear, "ms_admin");

  const pill = !cfg ? null : cfg.configured ? <Pill tone="ok" live>{t("Set up")}</Pill> : <Pill>{t("Not set up")}</Pill>;

  return (
    <Card data-guide="channels.microsoft">
      <CardHeader
        icon={<IconTile icon={MicrosoftOutlookLogoIcon} tone="info" size="sm" />}
        title="Microsoft 365"
        description={t("Outlook mail and calendar for each person, and shared mailboxes (accounts@, tender@) that a company's agent works through.")}
        actions={<>{pill}<Button size="sm" variant="ghost" onClick={() => setGuide(true)}><BookOpenTextIcon size={15} /> {t("Setup guide")}</Button></>}
      />
      <CardBody className="grid grid-cols-[minmax(0,1fr)] gap-5">
        <ul className="grid grid-cols-[minmax(0,1fr)] divide-y divide-border overflow-hidden rounded-sm border border-border bg-surface-2/40 sm:grid-cols-3 sm:divide-x sm:divide-y-0">
          {[
            { icon: EnvelopeSimpleIcon, title: t("Your Outlook"), body: t("Each person connects their own mail and calendar. Drafts wait for them.") },
            { icon: UsersFourIcon, title: t("Shared mailboxes"), body: t("Invoices, requests and tenders become tasks for the company's agent.") },
            { icon: ShieldCheckIcon, title: t("You approve"), body: t("Nothing is sent until a person approves it. Private details are masked before any AI sees them.") },
          ].map((f) => (
            <li key={f.title} className="flex items-start gap-2.5 p-3">
              <f.icon size={18} weight="duotone" className="mt-0.5 shrink-0 text-info" />
              <span className="min-w-0">
                <span className="block text-[13px] font-medium">{f.title}</span>
                <span className="block text-[12.5px] text-muted">{f.body}</span>
              </span>
            </li>
          ))}
        </ul>

        {isLoading ? <Skeleton className="h-24" />
          : error ? (isMissingApi(error) ? <MissingServer /> : <p role="alert" className="text-[13px] text-danger">{errorMessage(error)}</p>)
          : !cfg ? null
          : (
            <>
              {cfg.can_configure && (!cfg.configured || editing) ? (
                <div className="grid gap-3 border-t border-border pt-5">
                  <div>
                    <h3 className="text-[13.5px] font-semibold">{cfg.configured ? t("Change the app registration") : t("Connect the office's Microsoft Entra app")}</h3>
                    <p className="text-[12.5px] text-muted">{t("Once, for the whole office. Your Microsoft 365 admin registers an app in Microsoft Entra and gives you its IDs.")}</p>
                  </div>
                  <AppForm cfg={cfg} onDone={cfg.configured ? () => setEditing(false) : undefined} onGuide={() => setGuide(true)} />
                </div>
              ) : null}

              {cfg.configured ? (
                <div className="grid gap-3 border-t border-border pt-5">
                  <h3 className="flex items-center gap-1.5 text-[13px] font-semibold"><MicrosoftOutlookLogoIcon size={16} className="text-muted" /> {t("Your Outlook")}</h3>
                  <OutlookConnection bare />
                </div>
              ) : !cfg.can_configure ? (
                <p className="flex items-start gap-2 rounded-sm border border-dashed border-border px-3 py-4 text-[13px] text-muted">
                  <InfoIcon size={16} className="mt-0.5 shrink-0" />
                  <span className="min-w-0">{t("Ask an admin to set up Microsoft 365. Then you can connect your Outlook here.")}</span>
                </p>
              ) : null}

              {cfg.configured && cfg.can_configure && !editing ? (
                <AppSummary cfg={cfg} onEdit={() => setEditing(true)} />
              ) : null}

              {cfg.configured && (canManage || cfg.can_configure) ? <SharedMailboxes cfg={cfg} /> : null}
            </>
          )}
      </CardBody>
      <SetupGuide open={guide} onOpenChange={setGuide} cfg={cfg ?? null} />
    </Card>
  );
}

// ---------------------------------------------------------------- the app registration

function WebhookBadge({ cfg }: { cfg: MicrosoftConfig }) {
  const t = useT();
  return cfg.webhooks_available ? (
    <Pill tone="ok" live><BroadcastIcon size={12} /> {t("Live")}</Pill>
  ) : (
    <Pill tone="info" className="max-w-full whitespace-normal"><TimerIcon size={12} className="shrink-0" /> {t("Checks every 3 minutes — webhooks need the public https address")}</Pill>
  );
}

function AppSummary({ cfg, onEdit }: { cfg: MicrosoftConfig; onEdit: () => void }) {
  const t = useT();
  return (
    <div className="grid gap-3 border-t border-border pt-4">
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px] text-muted">
        <ShieldCheckIcon size={14} className="shrink-0 text-ok" />
        <Meta items={[
          cfg.client_id_hint ? t("App {id}", { id: cfg.client_id_hint }) : t("Microsoft 365 is set up for the office."),
          isAnyTenant(cfg.tenant) ? t("Any work account") : t("Only {tenant}", { tenant: cfg.tenant }),
        ]} />
        <button type="button" onClick={onEdit} className="font-medium text-accent hover:underline">{t("Change app registration")}</button>
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[12.5px] text-muted">{t("New mail:")}</span>
        <WebhookBadge cfg={cfg} />
      </div>
    </div>
  );
}

function AppForm({ cfg, onDone, onGuide }: { cfg: MicrosoftConfig; onDone?: () => void; onGuide: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const [clientId, setClientId] = useState("");
  const [secret, setSecret] = useState("");
  const [scope, setScope] = useState<"any" | "one">(isAnyTenant(cfg.tenant) ? "any" : "one");
  const [tenant, setTenant] = useState(isAnyTenant(cfg.tenant) ? "" : cfg.tenant);
  const idProblem = clientId.trim() ? clientIdProblem(clientId) : null;
  const tenantValue = scope === "any" ? "organizations" : tenant.trim();
  const tProblem = scope === "one" && tenant.trim() ? tenantProblem(tenant) : null;
  // A first setup needs the secret; a change may keep the saved one.
  const needSecret = !cfg.configured;
  const canSave = !clientIdProblem(clientId) && !tenantProblem(tenantValue) && (!needSecret || secret.trim().length >= 6);
  const save = useMutation({
    mutationFn: () => saveMicrosoftConfig({ client_id: clientId, client_secret: secret, tenant: tenantValue }),
    onSuccess: (r) => {
      qc.setQueryData(microsoftKeys.config, r);
      void qc.invalidateQueries({ queryKey: microsoftKeys.all });
      setSecret("");
      toast.success(t("Microsoft 365 is set up. Everyone can now connect their Outlook."));
      onDone?.();
    },
  });

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-5 lg:grid-cols-2">
      <div className="grid min-w-0 content-start gap-3">
        <p className="flex items-start gap-2 rounded-sm border border-info/25 bg-info/8 px-3 py-2.5 text-[12.5px]">
          <InfoIcon size={15} weight="fill" className="mt-0.5 shrink-0 text-info" />
          <span className="min-w-0">{t("In the Entra app, add these as a Web redirect URI and (for live mail) allow Microsoft to reach the notification URL. The setup guide has every click.")}</span>
        </p>
        <CopyRow label={t("Redirect URI (Web)")} value={cfg.redirect_uri} />
        <CopyRow label={t("Notification URL")} value={cfg.notify_url} hint={<WebhookBadge cfg={cfg} />} />
        <Button type="button" size="sm" variant="outline" className="w-fit" onClick={onGuide}><BookOpenTextIcon size={15} /> {t("Open the setup guide")}</Button>
      </div>
      <form onSubmit={(e) => { e.preventDefault(); if (canSave) save.mutate(); }} className="grid min-w-0 content-start gap-3">
        <Field label={t("Application (client) ID")} value={clientId} onChange={(e) => setClientId(e.target.value)} placeholder="00000000-0000-0000-0000-000000000000"
          autoComplete="off" spellCheck={false}
          hint={cfg.client_id_hint ? t("Saved: {id}. Enter it again to change anything.", { id: cfg.client_id_hint }) : t("On the app's Overview page in Microsoft Entra.")}
          error={idProblem === "not_guid" ? t("That is not an Application (client) ID. It looks like 1a2b3c4d-…, on the app's Overview page (not the secret value or the secret ID).") : undefined} />
        <Field label={t("Client secret value")} type="password" value={secret} onChange={(e) => setSecret(e.target.value)} autoComplete="new-password"
          placeholder={cfg.configured ? t("Saved. Leave blank to keep it.") : ""}
          hint={t("The secret's Value (shown once in Entra), not its Secret ID. Stored encrypted, never shown again.")} />
        <div className="grid gap-1.5">
          <span className="text-[13px] font-medium">{t("Who may sign in")}</span>
          <Segmented label={t("Who may sign in")} value={scope} onChange={setScope} className="w-full [&>button]:flex-1 [&>button]:justify-center"
            options={[{ value: "any", label: t("Any work account") }, { value: "one", label: t("Only our company") }]} />
          <p className="text-[12.5px] text-muted">{scope === "any"
            ? t("Any Microsoft 365 work or school account (tenant: organizations). Pick this if staff sign in from more than one company.")
            : t("Only accounts in your company's Microsoft 365. Enter its tenant ID or domain.")}</p>
        </div>
        {scope === "one" ? (
          <Field label={t("Tenant ID or domain")} value={tenant} onChange={(e) => setTenant(e.target.value)} placeholder="contoso.onmicrosoft.com" autoComplete="off" spellCheck={false}
            error={tProblem === "bad" ? t("Use the tenant ID (a GUID) or a domain like company.com.my.") : tProblem === "personal" ? t("Personal Microsoft accounts are not supported. Use your work tenant.") : undefined}
            hint={t("Entra admin center > Overview > Tenant ID.")} />
        ) : null}
        <FormError message={save.error ? errorMessage(save.error) : null} />
        <div className="flex flex-wrap gap-2">
          <Button type="submit" className="max-sm:flex-1" loading={save.isPending} disabled={!canSave}>
            <ShieldCheckIcon size={16} /> {cfg.configured ? t("Save changes") : t("Save Microsoft 365")}
          </Button>
          {onDone ? <Button type="button" variant="ghost" onClick={onDone}>{t("Cancel")}</Button> : null}
        </div>
      </form>
    </div>
  );
}

// ---------------------------------------------------------------- shared mailboxes

const STATUS_PILL: Record<string, { label: string; tone: "ok" | "danger" | "info" | "warn" | "neutral" }> = {
  active: { label: msg("Working"), tone: "ok" },
  ok: { label: msg("Working"), tone: "ok" },
  paused: { label: msg("Paused"), tone: "neutral" },
  error: { label: msg("Needs attention"), tone: "danger" },
};

function SharedMailboxes({ cfg }: { cfg: MicrosoftConfig }) {
  const t = useT();
  const qc = useQueryClient();
  const { data: boxes = [], isLoading, error } = useQuery(mailboxesQuery);
  const [dialog, setDialog] = useState<SharedMailbox | "new" | null>(null);
  const [removing, setRemoving] = useState<SharedMailbox | null>(null);
  const [results, setResults] = useState<Record<string, { ok: boolean; message: string }>>({});
  const consent = useMutation({
    mutationFn: startAdminConsent,
    onSuccess: (r) => { window.location.href = r.url; },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const pause = useMutation({
    mutationFn: (b: SharedMailbox) => updateMailbox(b.id, { paused: b.status !== "paused" }),
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: microsoftKeys.mailboxes });
      toast.success(r?.status === "paused" ? t("Paused. The office stops reading it until you resume.") : t("Resumed."));
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const test = useMutation({
    mutationFn: (id: string) => testMailbox(id),
    onSuccess: (r, id) => {
      setResults((cur) => ({ ...cur, [id]: r }));
      if (r.ok) toast.success(r.message || t("The mailbox answered."));
      else toast.error(r.message || t("The mailbox did not answer."), { duration: 12_000 });
      void qc.invalidateQueries({ queryKey: microsoftKeys.mailboxes });
    },
    onError: (e, id) => {
      setResults((cur) => ({ ...cur, [id]: { ok: false, message: errorMessage(e) } }));
      toast.error(errorMessage(e));
    },
  });

  return (
    <div className="grid gap-3 border-t border-border pt-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1 basis-64">
          <h3 className="flex items-center gap-1.5 text-[13px] font-semibold"><UsersFourIcon size={16} className="text-muted" /> {t("Shared mailboxes")}</h3>
          <p className="text-[12.5px] text-muted">{t("Mailboxes like accounts@ or tender@. The company's agent reads new mail, makes tasks, saves attachments and sends a daily digest.")}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {cfg.can_configure ? (
            <Button size="sm" variant="outline" loading={consent.isPending} onClick={() => consent.mutate()}><ShieldCheckIcon size={15} /> {t("Grant company-wide access for shared mailboxes")}</Button>
          ) : null}
          <Button size="sm" onClick={() => setDialog("new")}><PlusIcon size={14} weight="bold" /> {t("Add mailbox")}</Button>
        </div>
      </div>
      {!cfg.shared_enabled ? (
        <p className="flex items-start gap-2 rounded-sm border border-warn/30 bg-warn/8 px-3 py-2.5 text-[12.5px]">
          <WarningCircleIcon size={15} className="mt-0.5 shrink-0 text-warn" />
          <span className="min-w-0">{t("Shared mailboxes need company-wide access: a Microsoft 365 admin presses the button above (admin consent), then limits the app to these mailboxes with RBAC for Applications. See the setup guide.")}</span>
        </p>
      ) : null}

      {isLoading ? <Skeleton className="h-24" />
        : error ? (isMissingApi(error) ? <MissingServer /> : <p role="alert" className="text-[13px] text-danger">{errorMessage(error)}</p>)
        : !boxes.length ? (
          <p className="rounded-sm border border-dashed border-border px-3 py-5 text-center text-[12.5px] text-muted">{t("No shared mailboxes yet. Add one and pick the company and the agent that handles it.")}</p>
        ) : (
          <>
            <ul className="grid grid-cols-[minmax(0,1fr)] divide-y divide-border overflow-hidden rounded-sm border border-border lg:hidden">
              {boxes.map((b) => (
                <li key={b.id} className="grid gap-2 px-3 py-3 text-[13px]">
                  <div className="flex items-start gap-2">
                    <span className="min-w-0 flex-1 font-medium break-all">{b.address}</span>
                    <MailboxStatus b={b} />
                  </div>
                  <p className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[12px] text-muted"><Meta items={[b.branch_name, b.agent_name ?? t("No agent"), b.last_sync_at ? t("Synced {ago}", { ago: timeAgo(b.last_sync_at).toLowerCase() }) : t("Not checked yet")]} /></p>
                  <p className="text-[12px] text-muted">{rulesSummary(b.rules, t).join(" · ")}</p>
                  <RowActions b={b} testing={test.isPending && test.variables === b.id} onTest={() => test.mutate(b.id)} onEdit={() => setDialog(b)} onRemove={() => setRemoving(b)}
                    onPause={() => pause.mutate(b)} pausing={pause.isPending && pause.variables?.id === b.id} />
                  <TestResult r={results[b.id] ?? lastError(b)} />
                </li>
              ))}
            </ul>
            <div className="overflow-x-auto rounded-sm border border-border max-lg:hidden">
              <table className="w-full min-w-[56rem] text-left text-[13px]">
                <thead className="border-b border-border bg-surface-2/60 text-[12px] text-muted">
                  <tr>
                    <th className="px-3 py-2 font-medium">{t("Address")}</th>
                    <th className="px-3 py-2 font-medium">{t("Company")}</th>
                    <th className="px-3 py-2 font-medium">{t("Agent")}</th>
                    <th className="px-3 py-2 font-medium">{t("Rules")}</th>
                    <th className="px-3 py-2 font-medium">{t("Status")}</th>
                    <th className="px-3 py-2 font-medium">{t("Last sync")}</th>
                    <th />
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {boxes.map((b) => (
                    <tr key={b.id} className="align-top">
                      <td className="max-w-64 px-3 py-2.5">
                        <span className="block font-medium break-all">{b.address}</span>
                        {b.display_name && b.display_name !== b.address ? <span className="block text-[12px] text-muted">{b.display_name}</span> : null}
                        <TestResult r={results[b.id] ?? lastError(b)} />
                      </td>
                      <td className="px-3 py-2.5">{b.branch_name}</td>
                      <td className="px-3 py-2.5">{b.agent_name ?? <span className="text-muted">{t("No agent")}</span>}</td>
                      <td className="max-w-72 px-3 py-2.5 text-[12.5px] text-muted">{rulesSummary(b.rules, t).join(" · ")}</td>
                      <td className="px-3 py-2.5"><MailboxStatus b={b} /></td>
                      <td className="px-3 py-2.5 whitespace-nowrap text-muted">{b.last_sync_at ? timeAgo(b.last_sync_at) : t("Not yet")}</td>
                      <td className="px-3 py-2.5"><RowActions b={b} testing={test.isPending && test.variables === b.id} onTest={() => test.mutate(b.id)} onEdit={() => setDialog(b)} onRemove={() => setRemoving(b)}
                        onPause={() => pause.mutate(b)} pausing={pause.isPending && pause.variables?.id === b.id} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

      {dialog ? <MailboxDialog box={dialog === "new" ? null : dialog} onClose={() => setDialog(null)} /> : null}
      <ConfirmDialog open={!!removing} onOpenChange={(o) => !o && setRemoving(null)} danger confirmLabel={t("Remove")}
        title={t("Remove {address}?", { address: removing?.address ?? "" })}
        body={t("The office stops reading this mailbox. Tasks and files it already made stay. The mailbox itself is not touched.")}
        onConfirm={async () => {
          if (!removing) return;
          try {
            await removeMailbox(removing.id);
            await qc.invalidateQueries({ queryKey: microsoftKeys.mailboxes });
            toast.success(t("Mailbox removed."));
          } catch (e) {
            toast.error(errorMessage(e));
          }
        }} />
    </div>
  );
}

function MailboxStatus({ b }: { b: SharedMailbox }) {
  const t = useT();
  const s = STATUS_PILL[b.status] ?? { label: b.status, tone: "warn" as const };
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      <Pill tone={s.tone}>{t(s.label)}</Pill>
      {b.status === "active" || b.status === "ok" ? <Pill tone={WEBHOOK_TONE[b.webhooks]} live={b.webhooks === "live"}>{t(WEBHOOK_LABEL[b.webhooks])}</Pill> : null}
    </span>
  );
}

/** The last thing Microsoft said about the mailbox (e.g. the RBAC hint), until a new test. */
const lastError = (b: SharedMailbox) => (b.status === "error" && b.last_error ? { ok: false, message: b.last_error } : undefined);

function RowActions({ b, testing, onTest, onEdit, onRemove, onPause, pausing }: {
  b: SharedMailbox; testing: boolean; onTest: () => void; onEdit: () => void; onRemove: () => void; onPause: () => void; pausing: boolean;
}) {
  const t = useT();
  const paused = b.status === "paused";
  return (
    <span className="flex flex-wrap items-center justify-end gap-1 max-lg:justify-start">
      <Button size="sm" variant="outline" loading={testing} onClick={onTest}><PlugsConnectedIcon size={14} /> {t("Test")}</Button>
      <Button size="icon-sm" variant="ghost" loading={pausing} aria-label={paused ? t("Resume {name}", { name: b.address }) : t("Pause {name}", { name: b.address })} title={paused ? t("Resume") : t("Pause")} onClick={onPause}>
        {paused ? <PlayIcon size={15} /> : <PauseIcon size={15} />}
      </Button>
      <Button size="icon-sm" variant="ghost" aria-label={t("Edit {name}", { name: b.address })} onClick={onEdit}><PencilSimpleIcon size={15} /></Button>
      <Button size="icon-sm" variant="ghost" className="hover:text-danger" aria-label={t("Remove {name}", { name: b.address })} onClick={onRemove}><TrashIcon size={15} /></Button>
    </span>
  );
}

function TestResult({ r }: { r?: { ok: boolean; message: string } }) {
  if (!r) return null;
  return (
    <p role="status" className={cn("mt-1.5 rounded-sm px-2.5 py-1.5 text-[12px] break-words whitespace-pre-line", r.ok ? "bg-ok/8 text-ok" : "bg-danger/8 text-danger")}>{r.message}</p>
  );
}

function MailboxDialog({ box, onClose }: { box: SharedMailbox | null; onClose: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const { data: branches = [] } = useQuery(branchesQuery);
  const { data: agents = [] } = useQuery(agentsQuery);
  const [address, setAddress] = useState(box?.address ?? "");
  const [branchId, setBranchId] = useState(box?.branch_id ?? (branches.length === 1 ? branches[0]!.id : ""));
  const [agentId, setAgentId] = useState(box?.agent_id ?? "none");
  const [rules, setRules] = useState<MailboxRules>(box?.rules ?? DEFAULT_RULES);
  const branch = branchId || (branches.length === 1 ? branches[0]!.id : "");
  const pickable = agents.filter((a) => a.branch_id === branch && a.status === "active" && !a.private && !a.view_only);
  const addrBad = !!address.trim() && !isEmail(address);
  const hoursBad = !Number.isInteger(rules.follow_up_hours) || rules.follow_up_hours < 0 || rules.follow_up_hours > 720;
  const ok = isEmail(address) && !!branch && isClock(rules.digest.time) && !hoursBad;
  const toggleCat = (c: TaskCategory) => setRules((r) => ({
    ...r, create_tasks_for: r.create_tasks_for.includes(c) ? r.create_tasks_for.filter((x) => x !== c) : [...r.create_tasks_for, c],
  }));
  const save = useMutation({
    mutationFn: () => {
      const body = { address, branch_id: branch, agent_id: agentId === "none" ? null : agentId, rules };
      return box ? updateMailbox(box.id, body) : addMailbox(body);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: microsoftKeys.mailboxes });
      toast.success(box ? t("Saved.") : t("Mailbox added. Press Test to check the office can read it."));
      onClose();
    },
  });

  return (
    <ResponsiveDialog open onOpenChange={(o) => !o && onClose()} className="w-[min(96vw,42rem)]"
      title={box ? t("Edit shared mailbox") : t("Add a shared mailbox")}
      description={t("The agent you pick reads this mailbox for its company. Replies are drafts a person approves.")}
      footer={<><Button variant="outline" onClick={onClose}>{t("Cancel")}</Button><Button loading={save.isPending} disabled={!ok} onClick={() => save.mutate()}>{box ? t("Save") : t("Add mailbox")}</Button></>}>
      <form onSubmit={(e) => { e.preventDefault(); if (ok) save.mutate(); }} className="grid min-w-0 gap-4">
        <Field label={t("Mailbox address")} type="email" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="accounts@company.com.my" autoComplete="off" spellCheck={false}
          error={addrBad ? t("Enter an email address.") : undefined} hint={t("It must be a shared mailbox the app is allowed to read (see the setup guide).")} />
        <div className="grid grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <span className="text-[13px] font-medium">{t("Company")}</span>
            <Select value={branch} onValueChange={(v) => { setBranchId(v); setAgentId("none"); }} label={t("Company")} placeholder={t("Pick a company")} className="w-full"
              options={branches.map((b) => ({ value: b.id, label: b.name }))} />
          </div>
          <div className="grid gap-1.5">
            <span className="text-[13px] font-medium">{t("Agent that handles it")}</span>
            <Select value={agentId} onValueChange={setAgentId} label={t("Agent that handles it")} className="w-full" disabled={!branch}
              options={[{ value: "none", label: t("No agent: only sort and save") }, ...pickable.map((a) => ({ value: a.id, label: `${a.name} (${a.role})` }))]} />
          </div>
        </div>

        <fieldset className="grid gap-2">
          <legend className="mb-1.5 text-[13px] font-medium">{t("Make a task for")}</legend>
          <div className="grid grid-cols-[minmax(0,1fr)] gap-2 sm:grid-cols-2">
            {TASK_CATEGORIES.map((c) => (
              <ChoiceCard key={c} kind="checkbox" on={rules.create_tasks_for.includes(c)} onToggle={() => toggleCat(c)}
                title={t(CATEGORY_LABEL[c])} hint={t(CATEGORY_HINT[c])} leading={<KanbanIcon size={16} className="shrink-0 text-muted" />} />
            ))}
          </div>
        </fieldset>

        <div className="grid gap-3 rounded-[var(--radius-md)] border border-border p-3">
          <SwitchField checked={rules.save_attachments} onCheckedChange={(v) => setRules((r) => ({ ...r, save_attachments: v }))}
            label={t("Save attachments to the Library")} hint={t("Into the company's folder, so agents and people can find them.")} />
          <SwitchField checked={rules.digest.enabled} onCheckedChange={(v) => setRules((r) => ({ ...r, digest: { ...r.digest, enabled: v } }))}
            label={t("Daily digest")} hint={t("One summary of the day's mail to the agent's people.")} />
          {rules.digest.enabled ? (
            <div className="grid max-w-48 gap-1.5">
              <span className="text-[13px] font-medium">{t("Digest time")}</span>
              <Input type="time" value={rules.digest.time} onChange={(e) => setRules((r) => ({ ...r, digest: { ...r.digest, time: e.target.value } }))} aria-label={t("Digest time")} />
            </div>
          ) : null}
          <Field label={t("Follow up after (hours)")} type="number" min={0} max={720} inputMode="numeric" className="max-w-48"
            value={String(rules.follow_up_hours)} onChange={(e) => setRules((r) => ({ ...r, follow_up_hours: e.target.value === "" ? 0 : Number(e.target.value) }))}
            error={hoursBad ? t("Whole hours, 0 to 720.") : undefined}
            hint={t("A reminder task when a customer mail waits this long for a reply. 0 turns it off.")} />
        </div>
        <FormError message={save.error ? errorMessage(save.error) : null} />
      </form>
    </ResponsiveDialog>
  );
}

// ---------------------------------------------------------------- the in-app guide

function SetupGuide({ open, onOpenChange, cfg }: { open: boolean; onOpenChange: (o: boolean) => void; cfg: MicrosoftConfig | null }) {
  const t = useT();
  const entra = <a href="https://entra.microsoft.com" target="_blank" rel="noreferrer" className="text-accent hover:underline">Microsoft Entra admin center <ArrowSquareOutIcon size={12} className="inline" /></a>;
  return (
    <SideSheet open={open} onOpenChange={onOpenChange} size="lg" title={t("Microsoft 365 setup guide")}
      description={t("For your Microsoft 365 admin. About 15 minutes. The full guide, with the PowerShell for shared mailboxes, is MICROSOFT-365.md in the docs folder.")}>
      <div className="grid gap-6 text-[13px]">
        <section className="grid gap-2.5">
          <h3 className="text-[14px] font-semibold">{t("1. Register the app")}</h3>
          <Steps items={[
            <Trans key="a" text={t("In the {entra}, open {path} and press {new}.")} values={{ entra, path: <B>Entra ID &gt; App registrations</B>, new: <B>New registration</B> }} />,
            <Trans key="b" text={t("Name it (e.g. {name}). Supported account types: {single} for one company, or {multi} if staff sign in from several companies.")} values={{ name: <Code>Agentic Office</Code>, single: <B>Single tenant</B>, multi: <B>Multitenant</B> }} />,
            <Trans key="c" text={t("Under {redirect}, choose {web} and paste the redirect URI from this card.")} values={{ redirect: <B>Redirect URI</B>, web: <B>Web</B> }} />,
            <Trans key="d" text={t("Copy the {id} and the {tenant} from the app's Overview page.")} values={{ id: <B>Application (client) ID</B>, tenant: <B>Directory (tenant) ID</B> }} />,
          ]} />
          {cfg ? <CopyRow label={t("Redirect URI (Web)")} value={cfg.redirect_uri} /> : null}
        </section>
        <section className="grid gap-2.5">
          <h3 className="text-[14px] font-semibold">{t("2. Create a client secret")}</h3>
          <Steps items={[
            <Trans key="a" text={t("Open {path} and press {new}. Pick an expiry (e.g. 12 or 24 months).")} values={{ path: <B>Certificates &amp; secrets</B>, new: <B>New client secret</B> }} />,
            <Trans key="b" text={t("Copy the secret's {value} right away: Entra shows it only once. Paste it in this card.")} values={{ value: <B>Value</B> }} />,
            t("Put the expiry date in your calendar and make a new secret before it runs out, then paste the new one here."),
          ]} />
        </section>
        <section className="grid gap-2.5">
          <h3 className="text-[14px] font-semibold">{t("3. API permissions (Microsoft Graph)")}</h3>
          <p className="text-muted">{t("Delegated, for each person's own Outlook:")}</p>
          <p className="flex flex-wrap gap-1.5">{["openid", "profile", "email", "offline_access", "User.Read", "Mail.ReadWrite", "Mail.Send", "Calendars.ReadWrite"].map((p) => <Code key={p}>{p}</Code>)}</p>
          <p className="text-muted">{t("Application, only if you use shared mailboxes:")}</p>
          <p className="flex flex-wrap gap-1.5">{["Mail.ReadWrite", "Mail.Send"].map((p) => <Code key={p}>{p}</Code>)}</p>
          <Steps items={[
            <Trans key="a" text={t("Add them under {path}, then press {grant}.")} values={{ path: <B>API permissions &gt; Add a permission &gt; Microsoft Graph</B>, grant: <B>Grant admin consent</B> }} />,
            t("Or press Grant company-wide access on this card: it opens the same consent page."),
          ]} />
        </section>
        <section className="grid gap-2.5">
          <h3 className="text-[14px] font-semibold">{t("4. Limit the app to the shared mailboxes")}</h3>
          <p className="text-muted">{t("Application permissions reach every mailbox in the company unless you limit them. Use Exchange Online RBAC for Applications (it replaced Application Access Policies): put the shared mailboxes in a group, make a management scope for that group, and give the app the Application Mail.ReadWrite and Mail.Send roles only within that scope. Then remove the tenant-wide Application permissions from the Entra app so RBAC is the only grant.")}</p>
          <pre className="overflow-x-auto rounded-sm bg-surface-2 p-3 text-[11.5px] leading-relaxed">{`Connect-ExchangeOnline
New-ServicePrincipal -AppId <client-id> -ObjectId <enterprise-app-object-id> -DisplayName "Agentic Office"
New-ManagementScope -Name "Agentic shared mailboxes" -RecipientRestrictionFilter "MemberOfGroup -eq '<group DN>'"
New-ManagementRoleAssignment -App <client-id> -Role "Application Mail.ReadWrite" -CustomResourceScope "Agentic shared mailboxes"
New-ManagementRoleAssignment -App <client-id> -Role "Application Mail.Send" -CustomResourceScope "Agentic shared mailboxes"
Test-ServicePrincipalAuthorization -Identity <client-id> -Resource accounts@company.com`}</pre>
          <p className="text-[12.5px] text-muted">{t("Check the exact cmdlets on Microsoft Learn: \"Role Based Access Control for Applications in Exchange Online\". The Test button on each mailbox here shows what Microsoft answers.")}</p>
        </section>
        <section className="grid gap-2.5">
          <h3 className="text-[14px] font-semibold">{t("5. Live mail")}</h3>
          <p className="text-muted">{t("Microsoft pushes new mail to the notification URL, which must be a public https address. Without one the office checks every 3 minutes instead; everything else works the same.")}</p>
          {cfg ? <div className="flex flex-wrap items-center gap-2"><span className="text-muted">{t("This server:")}</span><WebhookBadge cfg={cfg} /></div> : null}
        </section>
        <section className="grid gap-2 rounded-[var(--radius-md)] border border-border bg-surface-2/40 p-3">
          <h3 className="flex items-center gap-1.5 text-[13.5px] font-semibold"><ShieldCheckIcon size={16} className="text-ok" /> {t("What the office keeps")}</h3>
          <ul className="grid list-disc gap-1 pl-5 text-muted">
            <li>{t("Mail details (sender, subject, time, category) are stored; message bodies are fetched only when needed.")}</li>
            <li>{t("Every AI call goes through the privacy gateway, which masks names, IDs and contacts first.")}</li>
            <li>{t("Replies and calendar changes are drafts until a person approves them.")}</li>
            <li>{t("A person disconnects their Outlook on My AI; an admin can also revoke the app in Entra (Enterprise applications) at any time.")}</li>
          </ul>
        </section>
      </div>
    </SideSheet>
  );
}
