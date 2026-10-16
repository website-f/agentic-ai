/** Contacts (P35): the company's customers, suppliers, partners and leads in one list, with
 * what each owes or is owed. New contacts by hand or from a spreadsheet; likely duplicates are
 * flagged so they can be tidied. */
import { AddressBookIcon, BuildingOfficeIcon, CaretRightIcon, CopyIcon, PlusIcon, UploadSimpleIcon, UserIcon, WarningIcon } from "@phosphor-icons/react";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { LoadMore } from "@/components/load-more";
import { EmptyState, Page, PageHeader } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Toolbar } from "@/components/ui/card";
import { Input } from "@/components/ui/field";
import { Pill } from "@/components/ui/pill";
import { SearchInput } from "@/components/ui/search-input";
import { Segmented } from "@/components/ui/segmented";
import { Skeleton } from "@/components/ui/skeleton";
import { useT } from "@/i18n";
import { errorMessage } from "@/lib/api";
import { useCompanies } from "@/lib/company";
import { archiveParty, duplicatesQuery, partiesQuery, partyKeys, type Party, type PartyRole } from "@/lib/crm";
import { useDebounced } from "@/lib/paged";
import { meQuery } from "@/lib/queries";
import { cn } from "@/lib/utils";

import { CompanySelect, LoadError, RolePills, useCompanyFilter, useFormat } from "./bits";
import { ImportDialog } from "./import";
import { PartyDialog } from "./party-form";

type RoleFilter = "all" | PartyRole;
type StatusFilter = "active" | "archived";

export function ContactsPage() {
  const t = useT();
  const navigate = useNavigate({ from: "/contacts" });
  const search = useSearch({ from: "/app/contacts" });
  const { data: me } = useSuspenseQuery(meQuery);
  const canWrite = me.permissions.includes("work.write");
  const finance = me.permissions.includes("finance.view");
  const { isAll, canAll } = useCompanies();
  const company = useCompanyFilter();

  const [q, setQ] = useState(search.q ?? "");
  const [role, setRole] = useState<RoleFilter>(search.role ?? "all");
  const [tag, setTag] = useState("");
  const [status, setStatus] = useState<StatusFilter>("active");
  const [creatingOn, setCreatingOn] = useState(false);
  const [importingOn, setImportingOn] = useState(false);
  const needle = useDebounced(q.trim());
  const tagNeedle = useDebounced(tag.trim());

  // Links like /contacts?new=1 (or ?import=1) open the form; closing it drops the flag.
  const creating = creatingOn || (!!search.new && canWrite);
  const importing = importingOn || (!!search.import && canWrite);
  const setCreating = (o: boolean) => {
    setCreatingOn(o);
    if (!o && search.new) void navigate({ search: (s) => ({ ...s, new: undefined }), replace: true });
  };
  const setImporting = (o: boolean) => {
    setImportingOn(o);
    if (!o && search.import) void navigate({ search: (s) => ({ ...s, import: undefined }), replace: true });
  };

  const params = useMemo(
    () => ({ q: needle, role: role === "all" ? undefined : role, branch_id: company.branchId, tag: tagNeedle, status }),
    [needle, role, company.branchId, tagNeedle, status],
  );
  const list = useInfiniteQuery(partiesQuery(params));
  const items = useMemo(() => list.data?.pages.flatMap((p) => p.items) ?? [], [list.data]);
  const total = list.data?.pages[0]?.total ?? null;
  const filtered = !!(needle || role !== "all" || tagNeedle || status !== "active" || company.branchId);
  const showCompany = canAll && isAll && !company.branchId;

  return (
    <Page>
      <PageHeader
        title={t("Contacts")}
        description={t("Your customers, suppliers, partners and leads: who to talk to, what they owe you and what you owe them.")}
        actions={canWrite ? (
          <>
            <Button variant="outline" onClick={() => setImporting(true)}><UploadSimpleIcon size={16} /> {t("Import from Excel/CSV")}</Button>
            <Button onClick={() => setCreating(true)}><PlusIcon size={16} weight="bold" /> {t("New contact")}</Button>
          </>
        ) : null}
      />

      <Duplicates canWrite={canWrite} />

      <Toolbar>
        <SearchInput value={q} onChange={setQ} placeholder={t("Search name, email, phone, TIN or SSM")} />
        <CompanySelect value={company.value} onChange={company.set} />
        <Input value={tag} onChange={(e) => setTag(e.target.value)} placeholder={t("Tag")} aria-label={t("Filter by tag")} className="sm:w-36" />
      </Toolbar>
      <div className="flex flex-wrap items-center gap-2">
        <Segmented<RoleFilter> size="sm" label={t("Which contacts")} value={role} onChange={setRole}
          options={[
            { value: "all", label: t("All") },
            { value: "customer", label: t("Customers") },
            { value: "supplier", label: t("Suppliers") },
            { value: "partner", label: t("Partners") },
            { value: "lead", label: t("Leads") },
          ]} />
        <Segmented<StatusFilter> size="sm" label={t("Active or archived")} value={status} onChange={setStatus}
          options={[{ value: "active", label: t("Active") }, { value: "archived", label: t("Archived") }]} />
        {total !== null ? <span className="ml-auto text-[12.5px] text-muted tabular">{total === 1 ? t("1 contact") : t("{n} contacts", { n: total })}</span> : null}
      </div>

      {list.isLoading ? (
        <div className="grid gap-2">{[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-16 rounded-[var(--radius-md)]" />)}</div>
      ) : list.error ? (
        <LoadError error={list.error} />
      ) : !items.length ? (
        filtered ? (
          <p className="rounded-[var(--radius-md)] border border-dashed border-border px-4 py-8 text-center text-[13px] text-muted">{t("No contact matches these filters.")}</p>
        ) : (
          <EmptyState icon={AddressBookIcon} title={t("No contacts yet")}
            body={t("Add your customers and suppliers, or import them from a spreadsheet. Mail from them, invoices, bills and deals then line up on each one's page.")}
            action={canWrite ? (
              <div className="flex flex-wrap justify-center gap-2">
                <Button onClick={() => setCreating(true)}><PlusIcon size={16} weight="bold" /> {t("New contact")}</Button>
                <Button variant="outline" onClick={() => setImporting(true)}><UploadSimpleIcon size={16} /> {t("Import from Excel/CSV")}</Button>
              </div>
            ) : undefined} />
        )
      ) : (
        <div className="grid grid-cols-[minmax(0,1fr)] overflow-hidden rounded-[var(--radius-md)] border border-border bg-surface">
          <div aria-hidden className={cn("hidden gap-3 border-b border-border bg-surface-2/50 px-4 py-2 text-[12px] font-medium text-muted lg:grid", finance ? "lg:grid-cols-[minmax(0,2.2fr)_minmax(0,1.5fr)_minmax(0,1.6fr)_minmax(0,1.2fr)_1rem]" : "lg:grid-cols-[minmax(0,2.2fr)_minmax(0,1.5fr)_minmax(0,1.6fr)_1rem]")}>
            <span>{t("Name")}</span>
            <span>{t("Primary contact")}</span>
            <span>{t("Phone and email")}</span>
            {finance ? <span className="text-right">{t("Open balance")}</span> : null}
            <span />
          </div>
          <ul className="grid grid-cols-[minmax(0,1fr)] divide-y divide-border">
            {items.map((p) => <PartyRow key={p.id} p={p} finance={finance} showCompany={showCompany} />)}
          </ul>
          <LoadMore className="px-4 pb-3" noun={t("contacts")} shown={items.length} total={total} hasMore={!!list.hasNextPage} loading={list.isFetchingNextPage}
            onLoad={() => { if (list.hasNextPage && !list.isFetchingNextPage) void list.fetchNextPage(); }} />
        </div>
      )}

      {creating ? <PartyDialog open={creating} onOpenChange={setCreating} defaultRoles={role === "all" ? ["customer"] : [role]}
        onSaved={(p) => p.id && void navigate({ to: "/contacts/$partyId", params: { partyId: p.id } })} /> : null}
      <ImportDialog open={importing} onOpenChange={setImporting} />
    </Page>
  );
}

function PartyRow({ p, finance, showCompany }: { p: Party; finance: boolean; showCompany: boolean }) {
  const t = useT();
  const { money } = useFormat();
  const c = p.primary_contact;
  const b = p.balances;
  const open = b ? (b.receivable_open || 0) + (b.payable_open || 0) : 0;
  return (
    <li>
      <Link to="/contacts/$partyId" params={{ partyId: p.id }}
        className={cn("grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5 px-4 py-3 transition-colors hover:bg-surface-2/60 focus-visible:bg-surface-2/60 focus-visible:outline-none",
          finance ? "lg:grid-cols-[minmax(0,2.2fr)_minmax(0,1.5fr)_minmax(0,1.6fr)_minmax(0,1.2fr)_1rem]" : "lg:grid-cols-[minmax(0,2.2fr)_minmax(0,1.5fr)_minmax(0,1.6fr)_1rem]")}>
        <span className="flex min-w-0 items-start gap-2.5">
          <span aria-hidden className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-full bg-surface-2 text-muted">
            {p.kind === "person" ? <UserIcon size={16} /> : <BuildingOfficeIcon size={16} />}
          </span>
          <span className="grid min-w-0 gap-1">
            <span className="flex min-w-0 flex-wrap items-center gap-1.5">
              <span className="min-w-0 truncate text-[14px] font-medium">{p.name}</span>
              {p.status === "archived" ? <Pill>{t("Archived")}</Pill> : null}
            </span>
            <span className="flex min-w-0 flex-wrap items-center gap-1">
              <RolePills roles={p.roles} />
              {showCompany && p.branch_name ? <span className="truncate text-[11.5px] text-muted">{p.branch_name}</span> : null}
              {p.tags.slice(0, 2).map((tg) => <span key={tg} className="max-w-32 truncate rounded-full border border-border px-1.5 text-[11px] text-muted">{tg}</span>)}
            </span>
          </span>
        </span>
        {/* Phones: the balance and overdue badge sit on the right of the name. */}
        <span className="flex flex-col items-end gap-1 lg:hidden">
          {finance && open ? <span className="text-[13px] font-medium whitespace-nowrap tabular">{money(open, p.currency)}</span> : null}
          {finance && b?.overdue ? <Pill tone="danger">{t("Overdue")}</Pill> : null}
        </span>
        <span className="col-span-2 min-w-0 text-[12.5px] max-lg:pl-[2.625rem] lg:col-span-1">
          {c ? (
            <>
              <span className="block truncate font-medium text-fg/90">{c.name}</span>
              {c.title ? <span className="block truncate text-muted">{c.title}</span> : null}
            </>
          ) : <span className="text-muted max-lg:hidden">—</span>}
        </span>
        <span className="col-span-2 grid min-w-0 text-[12.5px] text-muted max-lg:pl-[2.625rem] lg:col-span-1">
          {p.phone || c?.phone ? <span className="truncate">{p.phone || c?.phone}</span> : null}
          {p.email || c?.email ? <span className="truncate">{p.email || c?.email}</span> : null}
        </span>
        {finance ? (
          <span className="hidden flex-col items-end gap-1 lg:flex">
            {b ? (
              <>
                {b.receivable_open ? <span className="text-[13px] font-medium whitespace-nowrap tabular" title={t("They owe you")}>{money(b.receivable_open, p.currency)}</span> : null}
                {b.payable_open ? <span className="text-[12.5px] whitespace-nowrap text-muted tabular" title={t("You owe them")}>{t("You owe {amount}", { amount: money(b.payable_open, p.currency) })}</span> : null}
                {!b.receivable_open && !b.payable_open ? <span className="text-[12.5px] text-muted">{t("Nothing open")}</span> : null}
                {b.overdue ? <Pill tone="danger">{t("{amount} overdue", { amount: money(b.overdue, p.currency) })}</Pill> : null}
              </>
            ) : <span className="text-[12.5px] text-muted">—</span>}
          </span>
        ) : null}
        <CaretRightIcon size={14} className="hidden text-muted lg:block" />
      </Link>
    </li>
  );
}

/** "Possible duplicates": contacts that look like the same company or person. */
function Duplicates({ canWrite }: { canWrite: boolean }) {
  const t = useT();
  const qc = useQueryClient();
  const dupes = useQuery(duplicatesQuery);
  const [open, setOpen] = useState(false);
  const archive = useMutation({
    mutationFn: archiveParty,
    onSuccess: () => {
      toast.success(t("Archived."));
      void qc.invalidateQueries({ queryKey: partyKeys.all });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const groups = dupes.data ?? [];
  if (!groups.length) return null;
  return (
    <section className="rounded-[var(--radius-md)] border border-warn/30 bg-warn/6">
      <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)} className="flex w-full items-center gap-2.5 px-4 py-3 text-left">
        <CopyIcon size={17} weight="duotone" className="shrink-0 text-warn" />
        <span className="min-w-0 flex-1 text-[13.5px]">
          <span className="font-medium">{groups.length === 1 ? t("1 possible duplicate") : t("{n} possible duplicates", { n: groups.length })}</span>
          <span className="text-muted"> · {t("Contacts that look like the same company or person.")}</span>
        </span>
        <CaretRightIcon size={13} weight="bold" className={cn("shrink-0 text-muted transition-transform", open && "rotate-90")} />
      </button>
      {open ? (
        <ul className="grid grid-cols-[minmax(0,1fr)] gap-2 border-t border-warn/20 p-3">
          {groups.map((g, i) => (
            <li key={i} className="grid gap-1.5 rounded-[var(--radius-sm)] border border-border bg-surface p-3">
              <p className="flex items-center gap-1.5 text-[12.5px] text-muted"><WarningIcon size={13} className="shrink-0 text-warn" /> {g.reason || t("Looks the same")}</p>
              <ul className="grid gap-1">
                {g.parties.map((p) => (
                  <li key={p.id} className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                    <Link to="/contacts/$partyId" params={{ partyId: p.id }} className="min-w-0 truncate text-[13.5px] font-medium text-accent hover:underline">{p.name}</Link>
                    <span className="min-w-0 truncate text-[12px] text-muted">{[p.email, p.phone, p.tin].filter(Boolean).join(" · ")}</span>
                    {canWrite && p.status !== "archived" ? (
                      <Button size="sm" variant="ghost" className="ml-auto h-7" loading={archive.isPending && archive.variables === p.id} onClick={() => archive.mutate(p.id)}>{t("Archive")}</Button>
                    ) : null}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
