/** One contact (P35): who they are (TIN, SSM, SST, address), their people, notes, everything that
 * happened with them (mail, tasks, documents, invoices, payments, deals), their deals and the
 * money between you. */
import {
  ArchiveIcon,
  ArrowLeftIcon,
  BuildingOfficeIcon,
  CalendarIcon,
  ChatTextIcon,
  ClockCounterClockwiseIcon,
  CoinsIcon,
  EnvelopeSimpleIcon,
  FileTextIcon,
  GlobeIcon,
  HandshakeIcon,
  InfoIcon,
  KanbanIcon,
  MapPinIcon,
  NoteIcon,
  PaperPlaneTiltIcon,
  PencilSimpleIcon,
  PhoneIcon,
  PlusIcon,
  ReceiptIcon,
  ScanIcon,
  StarIcon,
  TrashIcon,
  TrayIcon,
  UserIcon,
  UsersThreeIcon,
  type Icon,
} from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { Link, useNavigate, useParams, useSearch } from "@tanstack/react-router";
import { useState, type ReactNode } from "react";
import { toast } from "sonner";

import { EmptyState, IconTile, Page } from "@/components/page";
import { PageTabs } from "@/components/page-tabs";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader, ListCard } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm";
import { ResponsiveDialog } from "@/components/ui/dialog";
import { Field, FormError, TextareaField } from "@/components/ui/field";
import { Pill } from "@/components/ui/pill";
import { Skeleton } from "@/components/ui/skeleton";
import { locale, useT } from "@/i18n";
import { errorMessage } from "@/lib/api";
import {
  addContact,
  addNote,
  addressLine,
  archiveParty,
  deleteContact,
  isPast,
  KIND_LABEL,
  partyKeys,
  partyQuery,
  STAGE_LABEL,
  STAGE_TONE,
  TIMELINE_LABEL,
  timelineQuery,
  updateContact,
  updateParty,
  type Contact,
  type PartyDetail,
  type TimelineItem,
  type TimelineKind,
} from "@/lib/crm";
import { balanceOf, partyMoneyQuery, STATUS_LABEL, STATUS_TONE } from "@/lib/money";
import { meQuery } from "@/lib/queries";
import { cn, timeAgo } from "@/lib/utils";

import { LoadError, RolePills, useFormat } from "./bits";
import { PartyDialog } from "./party-form";

export const PARTY_TABS = ["overview", "timeline", "deals", "money"] as const;
export type PartyTab = (typeof PARTY_TABS)[number];

export function ContactDetailPage() {
  const t = useT();
  const { partyId } = useParams({ from: "/app/contacts/$partyId" });
  const search = useSearch({ from: "/app/contacts/$partyId" });
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data: me } = useSuspenseQuery(meQuery);
  const canWrite = me.permissions.includes("work.write");
  const finance = me.permissions.includes("finance.view");
  const canManage = me.permissions.includes("finance.manage");
  const party = useQuery(partyQuery(partyId));
  const [editing, setEditing] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const tab: PartyTab = search.tab && (search.tab !== "money" || finance) ? search.tab : "overview";
  const setTab = (v: PartyTab) => void navigate({ to: "/contacts/$partyId", params: { partyId }, search: { tab: v === "overview" ? undefined : v }, replace: true });

  const back = (
    <Link to="/contacts" className="inline-flex w-fit items-center gap-1.5 text-[13px] text-muted hover:text-fg">
      <ArrowLeftIcon size={14} /> {t("Contacts")}
    </Link>
  );

  if (party.isLoading) {
    return <Page>{back}<Skeleton className="h-28 rounded-[var(--radius-md)]" /><Skeleton className="h-64 rounded-[var(--radius-md)]" /></Page>;
  }
  if (party.error || !party.data) return <Page>{back}<LoadError error={party.error} /></Page>;
  const p = party.data;

  const tabs = [
    { value: "overview" as const, label: t("Overview"), icon: InfoIcon },
    { value: "timeline" as const, label: t("Timeline"), icon: ClockCounterClockwiseIcon },
    { value: "deals" as const, label: t("Deals"), icon: HandshakeIcon, count: p.deals.length || undefined },
    ...(finance ? [{ value: "money" as const, label: t("Money"), icon: CoinsIcon }] : []),
  ];

  return (
    <Page>
      {back}
      <Header p={p} finance={finance}
        actions={canWrite ? (
          <>
            <Button variant="outline" size="sm" onClick={() => setEditing(true)}><PencilSimpleIcon size={15} /> {t("Edit")}</Button>
            {p.status !== "archived" ? <Button variant="ghost" size="sm" onClick={() => setArchiving(true)}><ArchiveIcon size={15} /> {t("Archive")}</Button> : null}
          </>
        ) : null} />
      <PageTabs label={t("Contact sections")} value={tab} onChange={setTab} tabs={tabs} />
      {tab === "overview" ? <Overview p={p} canWrite={canWrite} canManage={canManage} finance={finance} />
        : tab === "timeline" ? <Timeline partyId={p.id} finance={finance} />
        : tab === "deals" ? <DealsTab p={p} canWrite={canWrite} />
        : <MoneyTab p={p} canManage={canManage} />}

      {editing ? <PartyDialog open={editing} onOpenChange={setEditing} party={p} /> : null}
      <ConfirmDialog open={archiving} onOpenChange={setArchiving} title={t("Archive {name}?", { name: p.name })} confirmLabel={t("Archive")}
        body={t("It leaves the contact list and pickers. Its history, invoices and bills stay, and you can find it again under Archived.")}
        onConfirm={async () => {
          try {
            await archiveParty(p.id);
            toast.success(t("Archived."));
            void qc.invalidateQueries({ queryKey: partyKeys.all });
          } catch (e) {
            toast.error(errorMessage(e));
          }
        }} />
    </Page>
  );
}

function Header({ p, finance, actions }: { p: PartyDetail; finance: boolean; actions: ReactNode }) {
  const t = useT();
  const { money } = useFormat();
  const ids = [
    p.tin ? { k: t("TIN"), v: p.tin } : null,
    p.reg_no ? { k: p.kind === "company" ? t("SSM") : t("IC"), v: p.reg_no } : null,
    p.sst_no ? { k: t("SST"), v: p.sst_no } : null,
  ].filter((x): x is { k: string; v: string } => !!x);
  const addr = addressLine(p.address);
  const m = p.money;
  return (
    <div className="grid gap-4 rounded-[var(--radius-md)] border border-border bg-surface p-4 sm:p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-start gap-3.5">
          <IconTile icon={p.kind === "person" ? UserIcon : BuildingOfficeIcon} size="lg" className="hidden sm:grid" />
          <div className="grid min-w-0 gap-1.5">
            <p className="text-[11.5px] font-medium tracking-[0.06em] text-accent uppercase">{t(KIND_LABEL[p.kind])}{p.branch_name ? ` · ${p.branch_name}` : ""}</p>
            <h1 className="min-w-0 text-[22px] leading-tight font-semibold tracking-tight break-words sm:text-[26px]">{p.name}</h1>
            {p.legal_name && p.legal_name !== p.name ? <p className="text-[13px] break-words text-muted">{p.legal_name}</p> : null}
            <div className="flex flex-wrap items-center gap-1.5">
              <RolePills roles={p.roles} />
              {p.status === "archived" ? <Pill>{t("Archived")}</Pill> : null}
              {p.tags.map((tg) => <span key={tg} className="max-w-40 truncate rounded-full border border-border px-2 text-[11.5px] text-muted">{tg}</span>)}
            </div>
          </div>
        </div>
        {actions ? <div className="flex shrink-0 flex-wrap gap-2">{actions}</div> : null}
      </div>
      {ids.length ? (
        <dl className="flex flex-wrap gap-x-5 gap-y-1 text-[12.5px]">
          {ids.map((i) => (
            <div key={i.k} className="flex min-w-0 gap-1.5"><dt className="text-muted">{i.k}</dt><dd className="font-mono break-all">{i.v}</dd></div>
          ))}
        </dl>
      ) : null}
      <ul className="grid grid-cols-[minmax(0,1fr)] gap-1.5 text-[13px] sm:grid-cols-2">
        {p.email ? <ContactLine icon={EnvelopeSimpleIcon}><a href={`mailto:${p.email}`} className="break-all text-accent hover:underline">{p.email}</a></ContactLine> : null}
        {p.phone ? <ContactLine icon={PhoneIcon}><a href={`tel:${p.phone.replace(/\s/g, "")}`} className="text-accent hover:underline">{p.phone}</a></ContactLine> : null}
        {p.website ? <ContactLine icon={GlobeIcon}><a href={/^https?:\/\//.test(p.website) ? p.website : `https://${p.website}`} target="_blank" rel="noreferrer" className="break-all text-accent hover:underline">{p.website}</a></ContactLine> : null}
        {addr ? <ContactLine icon={MapPinIcon}><span className="break-words">{addr}</span></ContactLine> : null}
      </ul>
      {finance && m ? (
        <dl className="grid grid-cols-[minmax(0,1fr)] gap-2 border-t border-border pt-3 sm:grid-cols-3">
          <Figure label={t("They owe you")} value={money(m.receivable_open, p.currency)} />
          <Figure label={t("You owe them")} value={money(m.payable_open, p.currency)} />
          <Figure label={t("Overdue")} value={money(m.overdue, p.currency)} tone={m.overdue ? "danger" : undefined} />
        </dl>
      ) : null}
    </div>
  );
}

function ContactLine({ icon: IconCmp, children }: { icon: Icon; children: ReactNode }) {
  return (
    <li className="flex min-w-0 items-start gap-2">
      <IconCmp size={15} className="mt-0.5 shrink-0 text-muted" />
      <span className="min-w-0">{children}</span>
    </li>
  );
}

function Figure({ label, value, tone }: { label: string; value: string; tone?: "danger" }) {
  return (
    <div className="flex items-baseline justify-between gap-2 sm:grid sm:gap-0.5">
      <dt className="text-[12px] text-muted">{label}</dt>
      <dd className={cn("text-[16px] font-semibold tabular", tone === "danger" && "text-danger")}>{value}</dd>
    </div>
  );
}

// ------------------------------------------------------------------------------------- overview

function Overview({ p, canWrite, canManage, finance }: { p: PartyDetail; canWrite: boolean; canManage: boolean; finance: boolean }) {
  const t = useT();
  const { money } = useFormat();
  const isCustomer = p.roles.includes("customer") || p.roles.includes("lead");
  const isSupplier = p.roles.includes("supplier");
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-5 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
      <div className="grid min-w-0 content-start gap-5">
        <People p={p} canWrite={canWrite} />
        <Notes p={p} canWrite={canWrite} />
      </div>
      <div className="grid min-w-0 content-start gap-5">
        {canWrite || canManage ? (
          <Card>
            <CardHeader title={t("Quick actions")} />
            <CardBody className="grid gap-2">
              {canWrite ? (
                <Button variant="outline" className="justify-start" asChild>
                  <Link to="/deals" search={{ new: 1, party: p.id }}><HandshakeIcon size={16} /> {t("New deal")}</Link>
                </Button>
              ) : null}
              {canManage && (isCustomer || !isSupplier) ? (
                <Button variant="outline" className="justify-start" asChild>
                  <Link to="/money" search={{ tab: "receivable", new: "invoice", party: p.id }}><ReceiptIcon size={16} /> {t("New invoice")}</Link>
                </Button>
              ) : null}
              {canManage && (isSupplier || !isCustomer) ? (
                <Button variant="outline" className="justify-start" asChild>
                  <Link to="/money" search={{ tab: "payable", new: "bill" }}><ScanIcon size={16} /> {t("Capture bill")}</Link>
                </Button>
              ) : null}
            </CardBody>
          </Card>
        ) : null}
        <Card>
          <CardHeader title={t("Details")} />
          <CardBody>
            <dl className="grid gap-2.5 text-[13px]">
              <Detail k={t("Pays within")} v={p.payment_terms_days === null ? "" : p.payment_terms_days === 0 ? t("Cash on delivery") : t("{n} days", { n: p.payment_terms_days })} />
              {finance ? <Detail k={t("Credit limit")} v={p.credit_limit === null ? t("No limit") : money(p.credit_limit, p.currency)} /> : null}
              <Detail k={t("Currency")} v={p.currency} />
              <Detail k={t("Industry")} v={p.industry} />
              <Detail k={t("Source")} v={p.source} />
              <Detail k={t("Company")} v={p.branch_name} />
            </dl>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}

function Detail({ k, v }: { k: string; v: string }) {
  if (!v) return null;
  return (
    <div className="flex min-w-0 items-baseline justify-between gap-3">
      <dt className="shrink-0 text-muted">{k}</dt>
      <dd className="min-w-0 text-right break-words">{v}</dd>
    </div>
  );
}

function People({ p, canWrite }: { p: PartyDetail; canWrite: boolean }) {
  const t = useT();
  const qc = useQueryClient();
  const [edit, setEdit] = useState<Contact | "new" | null>(null);
  const [removing, setRemoving] = useState<Contact | null>(null);
  const refresh = () => void qc.invalidateQueries({ queryKey: partyKeys.all });
  const primary = useMutation({
    mutationFn: (c: Contact) => updateContact(c.id, { is_primary: true }),
    onSuccess: () => { toast.success(t("Primary contact changed.")); refresh(); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const people = [...p.contacts].sort((a, b) => Number(b.is_primary) - Number(a.is_primary));
  return (
    <Card>
      <CardHeader title={t("People")} description={t("Who you talk to there. The primary one is used on invoices and reminders.")}
        actions={canWrite ? <Button size="sm" variant="outline" onClick={() => setEdit("new")}><PlusIcon size={14} weight="bold" /> {t("Add person")}</Button> : null} />
      {!people.length ? (
        <p className="px-5 py-6 text-center text-[13px] text-muted">{t("No one added yet.")}</p>
      ) : (
        <ul className="grid grid-cols-[minmax(0,1fr)] divide-y divide-border">
          {people.map((c) => (
            <li key={c.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3 px-4 py-3 sm:px-5">
              <div className="grid min-w-0 gap-0.5">
                <p className="flex min-w-0 flex-wrap items-center gap-1.5">
                  <span className="min-w-0 truncate text-[14px] font-medium">{c.name}</span>
                  {c.is_primary ? <Pill tone="accent"><StarIcon size={11} weight="fill" /> {t("Primary")}</Pill> : null}
                </p>
                {c.title ? <p className="truncate text-[12.5px] text-muted">{c.title}</p> : null}
                <p className="flex min-w-0 flex-wrap gap-x-3 gap-y-0.5 text-[12.5px]">
                  {c.email ? <a href={`mailto:${c.email}`} className="min-w-0 break-all text-accent hover:underline">{c.email}</a> : null}
                  {c.phone ? <a href={`tel:${c.phone.replace(/\s/g, "")}`} className="text-accent hover:underline">{c.phone}</a> : null}
                </p>
                {c.notes ? <p className="text-[12.5px] break-words text-muted">{c.notes}</p> : null}
              </div>
              {canWrite ? (
                <div className="flex flex-wrap justify-end gap-1">
                  {!c.is_primary ? (
                    <Button size="icon-sm" variant="ghost" aria-label={t("Make {name} the primary contact", { name: c.name })} title={t("Make primary")}
                      loading={primary.isPending && primary.variables?.id === c.id} onClick={() => primary.mutate(c)}>
                      <StarIcon size={15} />
                    </Button>
                  ) : null}
                  <Button size="icon-sm" variant="ghost" aria-label={t("Edit {name}", { name: c.name })} onClick={() => setEdit(c)}><PencilSimpleIcon size={15} /></Button>
                  <Button size="icon-sm" variant="ghost" aria-label={t("Remove {name}", { name: c.name })} onClick={() => setRemoving(c)}><TrashIcon size={15} /></Button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {edit ? <PersonDialog partyId={p.id} person={edit === "new" ? null : edit} first={!people.length} onClose={() => setEdit(null)} /> : null}
      <ConfirmDialog open={!!removing} onOpenChange={(o) => !o && setRemoving(null)} danger title={t("Remove {name}?", { name: removing?.name ?? "" })} confirmLabel={t("Remove")}
        body={t("They are taken off this contact. Past mail and notes stay in the timeline.")}
        onConfirm={async () => {
          if (!removing) return;
          try {
            await deleteContact(removing.id);
            refresh();
          } catch (e) {
            toast.error(errorMessage(e));
          }
        }} />
    </Card>
  );
}

function PersonDialog({ partyId, person, first, onClose }: { partyId: string; person: Contact | null; first: boolean; onClose: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const [name, setName] = useState(person?.name ?? "");
  const [title, setTitle] = useState(person?.title ?? "");
  const [email, setEmail] = useState(person?.email ?? "");
  const [phone, setPhone] = useState(person?.phone ?? "");
  const [notes, setNotes] = useState(person?.notes ?? "");
  const [tried, setTried] = useState(false);
  const save = useMutation({
    mutationFn: () => {
      const body = { name, title, email, phone, notes };
      return person ? updateContact(person.id, body) : addContact(partyId, { ...body, is_primary: first });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: partyKeys.all });
      onClose();
    },
  });
  const nameErr = !name.trim() ? t("Give it a name.") : undefined;
  return (
    <ResponsiveDialog open onOpenChange={(o) => !o && !save.isPending && onClose()} title={person ? t("Edit {name}", { name: person.name }) : t("Add person")}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={save.isPending}>{t("Cancel")}</Button>
          <Button loading={save.isPending} onClick={() => { setTried(true); if (!nameErr) save.mutate(); }}>{t("Save")}</Button>
        </>
      }>
      <div className="grid gap-3">
        <FormError message={save.error ? errorMessage(save.error) : null} />
        <Field label={t("Name")} value={name} onChange={(e) => setName(e.target.value)} error={tried ? nameErr : undefined} autoFocus />
        <Field label={t("Job title")} value={title} onChange={(e) => setTitle(e.target.value)} />
        <Field label={t("Email")} type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        <Field label={t("Phone")} type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
        <TextareaField label={t("Notes")} value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
      </div>
    </ResponsiveDialog>
  );
}

function Notes({ p, canWrite }: { p: PartyDetail; canWrite: boolean }) {
  const t = useT();
  const qc = useQueryClient();
  const [text, setText] = useState("");
  const [about, setAbout] = useState<string | null>(null);
  const note = useMutation({
    mutationFn: () => addNote(p.id, text),
    onSuccess: () => {
      setText("");
      toast.success(t("Note added to the timeline."));
      void qc.invalidateQueries({ queryKey: partyKeys.timeline(p.id) });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const saveAbout = useMutation({
    mutationFn: (notes: string) => updateParty(p.id, { notes }),
    onSuccess: () => {
      setAbout(null);
      void qc.invalidateQueries({ queryKey: partyKeys.detail(p.id) });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Card>
      <CardHeader title={t("Notes")} description={t("What everyone should know about them, and a log of calls and visits.")} />
      <CardBody className="grid gap-4">
        {about !== null ? (
          <div className="grid gap-2">
            <TextareaField label={t("About them")} value={about} onChange={(e) => setAbout(e.target.value)} rows={4} />
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="outline" onClick={() => setAbout(null)}>{t("Cancel")}</Button>
              <Button size="sm" loading={saveAbout.isPending} onClick={() => saveAbout.mutate(about)}>{t("Save")}</Button>
            </div>
          </div>
        ) : (
          <div className="grid gap-1">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[12px] font-semibold tracking-[0.06em] text-muted uppercase">{t("About them")}</span>
              {canWrite ? <button type="button" onClick={() => setAbout(p.notes)} className="text-[12.5px] text-accent hover:underline">{t("Edit")}</button> : null}
            </div>
            <p className="text-[13.5px] whitespace-pre-wrap break-words text-fg/90">{p.notes || <span className="text-muted">{t("Nothing written yet.")}</span>}</p>
          </div>
        )}
        {canWrite ? (
          <form className="grid gap-2 border-t border-border pt-4" onSubmit={(e) => { e.preventDefault(); if (text.trim()) note.mutate(); }}>
            <TextareaField label={t("Log a note")} placeholder={t("e.g. Called Aina, she will pay invoice 1042 on Friday.")} value={text} onChange={(e) => setText(e.target.value)} rows={3} />
            <div className="flex justify-end">
              <Button size="sm" type="submit" loading={note.isPending} disabled={!text.trim()}><NoteIcon size={15} /> {t("Add note")}</Button>
            </div>
          </form>
        ) : null}
      </CardBody>
    </Card>
  );
}

// ------------------------------------------------------------------------------------- timeline

const KIND_ICON: Record<TimelineKind, Icon> = {
  email_in: TrayIcon,
  email_out: PaperPlaneTiltIcon,
  note: NoteIcon,
  call: PhoneIcon,
  meeting: UsersThreeIcon,
  task: KanbanIcon,
  document: FileTextIcon,
  invoice: ReceiptIcon,
  payment: CoinsIcon,
  deal: HandshakeIcon,
};

const KIND_TONE: Partial<Record<TimelineKind, "info" | "ok" | "accent" | "warn" | "neutral">> = {
  email_in: "info",
  email_out: "info",
  invoice: "accent",
  payment: "ok",
  deal: "warn",
};

function when(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleString(locale(), { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function Timeline({ partyId, finance }: { partyId: string; finance: boolean }) {
  const t = useT();
  const items = useQuery(timelineQuery(partyId));
  if (items.isLoading) return <div className="grid gap-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-14 rounded-[var(--radius-md)]" />)}</div>;
  if (items.error) return <LoadError error={items.error} />;
  const list = items.data ?? [];
  if (!list.length) {
    return <EmptyState icon={ClockCounterClockwiseIcon} title={t("Nothing here yet")} body={t("Mail to and from them, notes, tasks, documents, invoices, payments and deals show here as they happen.")} />;
  }
  return (
    <ol className="relative grid grid-cols-[minmax(0,1fr)] gap-0">
      {list.map((it, i) => <TimelineRow key={it.id} it={it} last={i === list.length - 1} finance={finance} />)}
    </ol>
  );
}

function TimelineRow({ it, last, finance }: { it: TimelineItem; last: boolean; finance: boolean }) {
  const t = useT();
  const IconCmp = KIND_ICON[it.kind] ?? ChatTextIcon;
  const l = it.links;
  const chip = "inline-flex min-h-7 items-center gap-1.5 rounded-full border border-border bg-surface px-2.5 text-[12px] hover:border-accent/50 hover:text-accent";
  const links: ReactNode[] = [];
  if (l.task_id) links.push(<Link key="t" to="/tasks" search={{ task: l.task_id }} className={chip}><KanbanIcon size={13} className="text-accent" /> {t("Open task")}</Link>);
  if (l.document_id) links.push(<Link key="d" to="/documents" search={{ d: l.document_id }} className={chip}><FileTextIcon size={13} className="text-accent" /> {t("Open document")}</Link>);
  if (l.money_doc_id && finance) links.push(<Link key="m" to="/money" search={{ doc: l.money_doc_id }} className={chip}><ReceiptIcon size={13} className="text-accent" /> {t("Open invoice or bill")}</Link>);
  if (l.deal_id) links.push(<Link key="g" to="/deals" search={{ deal: l.deal_id }} className={chip}><HandshakeIcon size={13} className="text-accent" /> {t("Open deal")}</Link>);
  if (l.mail_item_id) links.push(<Link key="e" to="/mail" className={chip}><EnvelopeSimpleIcon size={13} className="text-accent" /> {t("Open in Mail")}</Link>);
  return (
    <li className="relative grid grid-cols-[auto_minmax(0,1fr)] gap-3 pb-4">
      {!last ? <span aria-hidden className="absolute top-9 bottom-0 left-4 w-px bg-border" /> : null}
      <IconTile icon={IconCmp} size="sm" tone={KIND_TONE[it.kind] ?? "neutral"} />
      <div className="grid min-w-0 gap-1 pt-0.5">
        <p className="flex min-w-0 flex-wrap items-baseline gap-x-2 text-[12.5px] text-muted">
          <span className="font-medium text-fg/80">{t(TIMELINE_LABEL[it.kind] ?? it.kind)}</span>
          {it.actor ? <span className="min-w-0 truncate">{it.actor}</span> : null}
          <time dateTime={it.at} title={when(it.at)} className="tabular">{timeAgo(it.at)}</time>
        </p>
        <p className="text-[13.5px] whitespace-pre-wrap break-words">{it.summary}</p>
        {links.length ? <div className="flex flex-wrap gap-1.5 pt-0.5">{links}</div> : null}
      </div>
    </li>
  );
}

// ------------------------------------------------------------------------------------- deals and money

function DealsTab({ p, canWrite }: { p: PartyDetail; canWrite: boolean }) {
  const t = useT();
  const { money, day } = useFormat();
  return (
    <div className="grid gap-3">
      {canWrite ? (
        <div className="flex justify-end">
          <Button asChild size="sm"><Link to="/deals" search={{ new: 1, party: p.id }}><PlusIcon size={14} weight="bold" /> {t("New deal")}</Link></Button>
        </div>
      ) : null}
      {!p.deals.length ? (
        <EmptyState icon={HandshakeIcon} title={t("No deals with them yet")} body={t("Track a quote or an opportunity from first contact to won or lost.")} />
      ) : (
        <ListCard>
          {p.deals.map((d) => (
            <li key={d.id}>
              <Link to="/deals" search={{ deal: d.id }} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 px-4 py-3 hover:bg-surface-2/60">
                <span className="grid min-w-0 gap-0.5">
                  <span className="truncate text-[14px] font-medium">{d.title}</span>
                  <span className="flex min-w-0 flex-wrap items-center gap-x-2 text-[12.5px] text-muted">
                    {d.next_step ? <span className={cn("min-w-0 truncate", isPast(d.next_step_due) && "text-danger")}>{d.next_step}{d.next_step_due ? ` · ${day(d.next_step_due)}` : ""}</span> : null}
                    {d.expected_close ? <span className="inline-flex items-center gap-1"><CalendarIcon size={12} /> {day(d.expected_close)}</span> : null}
                  </span>
                </span>
                <span className="flex flex-col items-end gap-1">
                  <span className="text-[13.5px] font-medium whitespace-nowrap tabular">{money(d.value, d.currency)}</span>
                  <Pill tone={STAGE_TONE[d.stage]}>{t(STAGE_LABEL[d.stage])}</Pill>
                </span>
              </Link>
            </li>
          ))}
        </ListCard>
      )}
    </div>
  );
}

function MoneyTab({ p, canManage }: { p: PartyDetail; canManage: boolean }) {
  const t = useT();
  const { money, day } = useFormat();
  const docs = useQuery(partyMoneyQuery(p.id));
  if (docs.isLoading) return <div className="grid gap-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-14 rounded-[var(--radius-md)]" />)}</div>;
  if (docs.error) return <LoadError error={docs.error} />;
  const items = docs.data?.items ?? [];
  const owedToYou = items.filter((d) => d.direction === "receivable").reduce((s, d) => s + balanceOf(d), 0);
  const youOwe = items.filter((d) => d.direction === "payable").reduce((s, d) => s + balanceOf(d), 0);
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[13px] text-muted">
          {t("They owe you {a} · you owe them {b}", { a: money(owedToYou, p.currency), b: money(youOwe, p.currency) })}
        </p>
        {canManage ? (
          <Button asChild size="sm"><Link to="/money" search={{ tab: "receivable", new: "invoice", party: p.id }}><PlusIcon size={14} weight="bold" /> {t("New invoice")}</Link></Button>
        ) : null}
      </div>
      {!items.length ? (
        <EmptyState icon={CoinsIcon} title={t("No invoices or bills yet")} body={t("Invoices you send them and bills they send you show here, with what is still owed.")} />
      ) : (
        <ListCard>
          {items.map((d) => (
            <li key={d.id}>
              <Link to="/money" search={{ tab: d.direction, doc: d.id }} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 px-4 py-3 hover:bg-surface-2/60">
                <span className="grid min-w-0 gap-0.5">
                  <span className="flex min-w-0 flex-wrap items-center gap-1.5">
                    <span className="truncate text-[14px] font-medium">{d.number || t("(no number)")}</span>
                    <Pill>{d.direction === "receivable" ? t("Invoice") : t("Bill")}</Pill>
                  </span>
                  <span className="text-[12.5px] text-muted">{d.due_date ? t("Due {date}", { date: day(d.due_date) }) : null}</span>
                </span>
                <span className="flex flex-col items-end gap-1">
                  <span className="text-[13.5px] font-medium whitespace-nowrap tabular">{money(balanceOf(d) || d.total, d.currency)}</span>
                  <span className="flex flex-wrap justify-end gap-1">
                    {d.overdue && d.status !== "paid" && d.status !== "void" ? <Pill tone="danger">{t("{n} days overdue", { n: d.days_overdue })}</Pill> : null}
                    <Pill tone={STATUS_TONE[d.status]}>{t(STATUS_LABEL[d.status])}</Pill>
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ListCard>
      )}
    </div>
  );
}
