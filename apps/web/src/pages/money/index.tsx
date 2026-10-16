/** Money (P35, finance.view): what customers owe the company (receivables) and what it owes
 * suppliers (payables, often bills captured from emailed PDFs). Totals, how late things are, the
 * cash expected each week, every invoice and bill, and payment reminders. */
import { ArrowDownLeftIcon, ArrowUpRightIcon, ClockIcon, CoinsIcon, PlusIcon, ScanIcon, SealCheckIcon, WarningIcon } from "@phosphor-icons/react";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { FilePicker } from "@/components/file-drop";
import { LoadMore } from "@/components/load-more";
import { EmptyState, Page, PageHeader } from "@/components/page";
import { PageTabs } from "@/components/page-tabs";
import { Button } from "@/components/ui/button";
import { Toolbar } from "@/components/ui/card";
import { Pill } from "@/components/ui/pill";
import { SearchInput } from "@/components/ui/search-input";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Stat, StatGrid } from "@/components/ui/stat";
import { useT } from "@/i18n";
import { errorMessage } from "@/lib/api";
import { isMissingApi, partyKeys } from "@/lib/crm";
import {
  balanceOf,
  captureBill,
  MONEY_STATUSES,
  moneyKeys,
  moneyListQuery,
  moneySummaryQuery,
  STATUS_LABEL,
  STATUS_TONE,
  type MoneyDirection,
  type MoneyDoc,
  type MoneyStatus,
} from "@/lib/money";
import { useDebounced } from "@/lib/paged";
import { meQuery } from "@/lib/queries";
import { cn } from "@/lib/utils";
import { CompanySelect, LoadError, MissingBusiness, useCompanyFilter, useFormat } from "@/pages/contacts/bits";

import { AgingCard, ForecastCard } from "./charts";
import { DocSheet } from "./doc-sheet";
import { NewInvoiceDialog } from "./new-invoice";
import { RemindersCard } from "./reminders";

const ALL = "all";

export function MoneyPage() {
  const t = useT();
  const qc = useQueryClient();
  const navigate = useNavigate({ from: "/money" });
  const search = useSearch({ from: "/app/money" });
  const { data: me } = useSuspenseQuery(meQuery);
  const canManage = me.permissions.includes("finance.manage");
  const company = useCompanyFilter();
  const { money } = useFormat();
  const tab: MoneyDirection = search.tab ?? "receivable";
  const setTab = (v: MoneyDirection) => {
    setStatus(ALL);
    void navigate({ search: (s) => ({ ...s, tab: v === "receivable" ? undefined : v }), replace: true });
  };
  const [status, setStatus] = useState<string>(ALL);
  const [overdue, setOverdue] = useState(false);
  const [q, setQ] = useState("");
  const needle = useDebounced(q.trim());
  const [invoicingOn, setInvoicingOn] = useState(false);
  const [capturingOn, setCapturingOn] = useState(false);

  // Links like /money?new=invoice&party=… or ?new=bill open the form; closing it drops the flag.
  const invoicing = invoicingOn || (search.new === "invoice" && canManage);
  const capturing = capturingOn || (search.new === "bill" && canManage);
  const setInvoicing = (o: boolean) => {
    setInvoicingOn(o);
    if (!o && (search.new || search.party)) void navigate({ search: (x) => ({ ...x, new: undefined, party: undefined }), replace: true });
  };
  const setCapturing = (o: boolean) => {
    setCapturingOn(o);
    if (!o && search.new) void navigate({ search: (x) => ({ ...x, new: undefined }), replace: true });
  };

  const summary = useQuery(moneySummaryQuery(company.branchId));
  const s = summary.data;
  const missing = isMissingApi(summary.error);

  const params = useMemo(
    () => ({ direction: tab, status: status === ALL ? undefined : status, overdue: overdue || undefined, q: needle, branch_id: company.branchId }),
    [tab, status, overdue, needle, company.branchId],
  );
  const list = useInfiniteQuery({ ...moneyListQuery(params), enabled: !missing });
  const items = useMemo(() => list.data?.pages.flatMap((p) => p.items) ?? [], [list.data]);
  const total = list.data?.pages[0]?.total ?? null;

  const capture = useMutation({
    mutationFn: (fileId: string) => captureBill(fileId, company.branchId ?? company.one?.id ?? ""),
    onSuccess: (d) => {
      void qc.invalidateQueries({ queryKey: moneyKeys.all });
      void qc.invalidateQueries({ queryKey: partyKeys.all });
      toast.success(t("Bill captured. Check what was read, then approve it."));
      void navigate({ search: (x) => ({ ...x, tab: "payable", doc: d.id || undefined }) });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const openDoc = (id: string) => void navigate({ search: (x) => ({ ...x, doc: id }) });
  const recv = tab === "receivable";

  return (
    <Page>
      <PageHeader title={t("Money")}
        description={t("What customers owe you and what you owe suppliers: what is overdue, what is due soon, and the cash coming in and going out.")}
        actions={canManage ? (
          <>
            <Button variant="outline" loading={capture.isPending} onClick={() => setCapturing(true)}><ScanIcon size={16} /> {t("Capture bill from a file")}</Button>
            <Button onClick={() => setInvoicing(true)}><PlusIcon size={16} weight="bold" /> {t("New invoice")}</Button>
          </>
        ) : null} />

      {missing ? <MissingBusiness /> : (
        <>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <PageTabs<MoneyDirection> label={t("Receivables or payables")} value={tab} onChange={setTab} className="min-w-0 flex-1"
              tabs={[
                { value: "receivable", label: t("Receivables"), icon: ArrowDownLeftIcon },
                { value: "payable", label: t("Payables"), icon: ArrowUpRightIcon, count: s?.awaiting_approval || undefined, attention: !!s?.awaiting_approval },
              ]} />
            <CompanySelect value={company.value} onChange={company.set} className="max-sm:w-full" />
          </div>

          {summary.isLoading ? (
            <StatGrid>{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-24 rounded-[var(--radius-md)]" />)}</StatGrid>
          ) : summary.error ? <LoadError error={summary.error} /> : s ? (
            <StatGrid>
              <Stat label={recv ? t("Owed to you") : t("You owe")} value={money(recv ? s.receivable_open : s.payable_open)} icon={CoinsIcon}
                onClick={() => { setOverdue(false); setStatus(ALL); }} active={!overdue && status === ALL} />
              <Stat label={t("Overdue")} value={money(recv ? s.receivable_overdue : s.payable_overdue)} icon={WarningIcon} tone={(recv ? s.receivable_overdue : s.payable_overdue) ? "danger" : "neutral"}
                hint={t("Past the due date")} onClick={() => setOverdue((o) => !o)} active={overdue} />
              <Stat label={t("Due in 7 days")} value={money(recv ? s.due_7d_in : s.due_7d_out)} icon={ClockIcon} tone="info" hint={recv ? t("Coming in") : t("Going out")} />
              <Stat label={t("Bills awaiting approval")} value={s.awaiting_approval} icon={SealCheckIcon} tone={s.awaiting_approval ? "warn" : "neutral"}
                onClick={() => { if (recv) setTab("payable"); setStatus("awaiting_approval"); setOverdue(false); }}
                active={!recv && status === "awaiting_approval"} />
            </StatGrid>
          ) : null}

          <div className="grid grid-cols-[minmax(0,1fr)] gap-5 lg:grid-cols-2">
            <AgingCard direction={tab} branchId={company.branchId} />
            <ForecastCard branchId={company.branchId} />
          </div>

          <section className="grid min-w-0 gap-3">
            <h2 className="text-[15px] font-semibold">{recv ? t("Invoices") : t("Bills")}</h2>
            <Toolbar>
              <SearchInput value={q} onChange={setQ} placeholder={recv ? t("Search number, customer or reference") : t("Search number, supplier or reference")} />
              <Select value={status} onValueChange={setStatus} label={t("Status")} className="sm:w-48"
                options={[{ value: ALL, label: t("Every status") }, ...MONEY_STATUSES.map((st) => ({ value: st, label: t(STATUS_LABEL[st]) }))]} />
              <button type="button" aria-pressed={overdue} onClick={() => setOverdue((o) => !o)}
                className={cn("inline-flex h-10 items-center justify-center gap-1.5 rounded-sm border px-3 text-[13px] font-medium transition-colors",
                  overdue ? "border-danger/50 bg-danger/8 text-danger" : "border-border bg-surface text-muted hover:text-fg")}>
                <WarningIcon size={15} /> {t("Overdue only")}
              </button>
            </Toolbar>
            {list.isLoading ? (
              <div className="grid gap-2">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-16 rounded-[var(--radius-md)]" />)}</div>
            ) : list.error ? <LoadError error={list.error} /> : !items.length ? (
              status !== ALL || overdue || needle ? (
                <p className="rounded-[var(--radius-md)] border border-dashed border-border px-4 py-8 text-center text-[13px] text-muted">{t("Nothing matches these filters.")}</p>
              ) : (
                <EmptyState icon={CoinsIcon} title={recv ? t("No invoices yet") : t("No bills yet")}
                  body={recv ? t("Invoices you raise here, or that agents draft from quotes and orders, show here until they are paid.")
                    : t("Supplier bills that reach your mailboxes are read and listed here for approval. You can also capture one from a file.")}
                  action={canManage ? (recv
                    ? <Button onClick={() => setInvoicing(true)}><PlusIcon size={16} weight="bold" /> {t("New invoice")}</Button>
                    : <Button onClick={() => setCapturing(true)}><ScanIcon size={16} /> {t("Capture bill from a file")}</Button>) : undefined} />
              )
            ) : (
              <div className="grid grid-cols-[minmax(0,1fr)] overflow-hidden rounded-[var(--radius-md)] border border-border bg-surface">
                <ul className="grid grid-cols-[minmax(0,1fr)] divide-y divide-border">
                  {items.map((d) => <DocRow key={d.id} d={d} onOpen={() => openDoc(d.id)} />)}
                </ul>
                <LoadMore className="px-4 pb-3" noun={recv ? t("invoices") : t("bills")} shown={items.length} total={total} hasMore={!!list.hasNextPage} loading={list.isFetchingNextPage}
                  onLoad={() => { if (list.hasNextPage && !list.isFetchingNextPage) void list.fetchNextPage(); }} />
              </div>
            )}
          </section>

          {canManage ? <RemindersCard branchId={company.branchId} /> : null}
        </>
      )}

      {search.doc ? <DocSheet key={search.doc} id={search.doc} canManage={canManage} onOpen={openDoc} onClose={() => void navigate({ search: (x) => ({ ...x, doc: undefined }) })} /> : null}
      {invoicing ? (
        <NewInvoiceDialog open={invoicing} partyId={search.party}
          onOpenChange={setInvoicing}
          onCreated={(d) => d.id && void navigate({ search: (x) => ({ ...x, tab: undefined, new: undefined, party: undefined, doc: d.id }) })} />
      ) : null}
      <FilePicker open={capturing} onOpenChange={setCapturing} branchId={company.branchId} title={t("Capture a bill")}
        onPick={(f) => capture.mutate(f.id)} />
    </Page>
  );
}

function DocRow({ d, onOpen }: { d: MoneyDoc; onOpen: () => void }) {
  const t = useT();
  const { money, day } = useFormat();
  const bal = balanceOf(d);
  const late = d.overdue && d.status !== "paid" && d.status !== "void";
  return (
    <li>
      <button type="button" onClick={onOpen}
        className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 px-4 py-3 text-left transition-colors hover:bg-surface-2/60 focus-visible:bg-surface-2/60 focus-visible:outline-none sm:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_auto]">
        <span className="grid min-w-0 gap-0.5">
          <span className="flex min-w-0 flex-wrap items-center gap-1.5">
            <span className="truncate text-[14px] font-medium">{d.party_name || t("No contact linked")}</span>
            {d.duplicate_of ? <Pill tone="warn">{t("Possible duplicate")}</Pill> : null}
          </span>
          <span className="truncate text-[12.5px] text-muted">{[d.number || t("(no number)"), d.reference].filter(Boolean).join(" · ")}</span>
        </span>
        <span className="flex flex-col items-end gap-1 sm:hidden">
          <span className="text-[13.5px] font-semibold whitespace-nowrap tabular">{money(d.status === "paid" || d.status === "void" ? d.total : bal, d.currency)}</span>
          <Pill tone={late ? "danger" : STATUS_TONE[d.status]}>{late ? t("{n}d late", { n: d.days_overdue }) : t(STATUS_LABEL[d.status])}</Pill>
        </span>
        <span className="col-span-2 text-[12.5px] text-muted sm:col-span-1">
          {d.due_date ? <span className={cn(late && "text-danger")}>{t("Due {date}", { date: day(d.due_date) })}</span> : null}
          {d.amount_paid > 0 && bal > 0 ? <span className="block">{t("{paid} of {total} paid", { paid: money(d.amount_paid, d.currency), total: money(d.total, d.currency) })}</span> : null}
        </span>
        <span className="hidden flex-col items-end gap-1 sm:flex">
          <span className="text-[14px] font-semibold whitespace-nowrap tabular">{money(d.status === "paid" || d.status === "void" ? d.total : bal, d.currency)}</span>
          <span className="flex flex-wrap justify-end gap-1">
            {late ? <Pill tone="danger">{d.days_overdue === 1 ? t("1 day overdue") : t("{n} days overdue", { n: d.days_overdue })}</Pill> : null}
            <Pill tone={STATUS_TONE[d.status as MoneyStatus]}>{t(STATUS_LABEL[d.status])}</Pill>
          </span>
        </span>
      </button>
    </li>
  );
}
