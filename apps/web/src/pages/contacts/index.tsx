/** Contacts (P35): the company's customers, suppliers, partners and leads in one list, with
 * what each owes or is owed. New contacts by hand or from a spreadsheet; likely duplicates are
 * flagged so they can be tidied. */
import { AddressBookIcon, BuildingOfficeIcon, CaretRightIcon, CopyIcon, PlusIcon, UploadSimpleIcon, UserIcon, WarningIcon } from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { EmptyState, Page, PageHeader } from "@/components/page";
import { Button } from "@/components/ui/button";
import { DataTable, filterOf, useServerTable, useTableState, type Column } from "@/components/ui/data-table";
import { Input } from "@/components/ui/field";
import { Pill } from "@/components/ui/pill";
import { Segmented } from "@/components/ui/segmented";
import { useT } from "@/i18n";
import { errorMessage } from "@/lib/api";
import { useCompanies } from "@/lib/company";
import { archiveParty, asList, duplicatesQuery, normalizeParty, partyKeys, type ListResult, type Party, type PartyRole } from "@/lib/crm";
import { useDebounced } from "@/lib/paged";
import { meQuery } from "@/lib/queries";
import { cn } from "@/lib/utils";

import { CompanySelect, RolePills, useCompanyFilter, useFormat } from "./bits";
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
  const { money } = useFormat();

  // P96: a data table. The search (q) and role stay in the address as before; tag, active or
  // archived, page, size and order join them. The server searches, filters, sorts and pages.
  const control = useTableState({ size: 25 }, { filters: ["role", "tag", "status"] });
  const [roleParam, setRoleParam] = filterOf(control, "role");
  const [tagParam, setTagParam] = filterOf(control, "tag");
  const [statusParam, setStatusParam] = filterOf(control, "status");
  const role = (roleParam || "all") as RoleFilter;
  const status = (statusParam || "active") as StatusFilter;
  const [tag, setTag] = useState(tagParam);
  const [seenTag, setSeenTag] = useState(tagParam);
  if (seenTag !== tagParam) {
    setSeenTag(tagParam);
    setTag(tagParam);
  }
  const tagNeedle = useDebounced(tag.trim());
  useEffect(() => {
    if (tagNeedle !== tagParam) setTagParam(tagNeedle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tagNeedle]);
  const [creatingOn, setCreatingOn] = useState(false);
  const [importingOn, setImportingOn] = useState(false);

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

  const list = useServerTable<Party, ListResult<Party> | Party[]>(partyKeys.all, "/api/parties", control.state,
    { branch_id: company.branchId, status }, { pick: (b) => asList(b).items.map(normalizeParty) });
  const filtered = !!(control.state.q || role !== "all" || tagParam || status !== "active" || company.branchId);
  const showCompany = canAll && isAll && !company.branchId;

  const columns: Column<Party>[] = [
    {
      id: "name", header: t("Name"), sortable: true, card: "title",
      cell: (p) => (
        <span className="flex min-w-0 items-start gap-2.5">
          <span aria-hidden className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-full bg-surface-2 text-muted">
            {p.kind === "person" ? <UserIcon size={16} /> : <BuildingOfficeIcon size={16} />}
          </span>
          <span className="grid min-w-0 gap-1">
            <span className="flex min-w-0 flex-wrap items-center gap-1.5">
              <span className="min-w-0 text-[14px] font-medium break-words">{p.name}</span>
              {p.status === "archived" ? <Pill>{t("Archived")}</Pill> : null}
            </span>
            <span className="flex min-w-0 flex-wrap items-center gap-1">
              <RolePills roles={p.roles} />
              {showCompany && p.branch_name ? <span className="truncate text-[11.5px] text-muted">{p.branch_name}</span> : null}
              {p.tags.slice(0, 2).map((tg) => <span key={tg} className="max-w-32 truncate rounded-full border border-border px-1.5 text-[11px] text-muted">{tg}</span>)}
            </span>
          </span>
        </span>
      ),
    },
    {
      id: "contact", header: t("Primary contact"),
      cell: (p) => (p.primary_contact ? (
        <span className="grid min-w-0 text-[12.5px]">
          <span className="font-medium break-words text-fg/90">{p.primary_contact.name}</span>
          {p.primary_contact.title ? <span className="break-words text-muted">{p.primary_contact.title}</span> : null}
        </span>
      ) : <span className="text-muted">—</span>),
    },
    {
      id: "reach", header: t("Phone and email"), hideBelow: "lg",
      cell: (p) => {
        const c = p.primary_contact;
        return (
          <span className="grid min-w-0 text-[12.5px] text-muted">
            {p.phone || c?.phone ? <span className="break-all">{p.phone || c?.phone}</span> : null}
            {p.email || c?.email ? <span className="break-all">{p.email || c?.email}</span> : null}
            {!(p.phone || c?.phone || p.email || c?.email) ? "—" : null}
          </span>
        );
      },
    },
    ...(finance ? [{
      id: "balance", header: t("Open balance"), align: "right" as const,
      cell: (p: Party) => {
        const b = p.balances;
        if (!b) return <span className="text-[12.5px] text-muted">—</span>;
        return (
          <span className="grid justify-items-end gap-1 max-md:justify-items-start">
            {b.receivable_open ? <span className="text-[13px] font-medium whitespace-nowrap tabular" title={t("They owe you")}>{money(b.receivable_open, p.currency)}</span> : null}
            {b.payable_open ? <span className="text-[12.5px] whitespace-nowrap text-muted tabular" title={t("You owe them")}>{t("You owe {amount}", { amount: money(b.payable_open, p.currency) })}</span> : null}
            {!b.receivable_open && !b.payable_open ? <span className="text-[12.5px] text-muted">{t("Nothing open")}</span> : null}
            {b.overdue ? <Pill tone="danger">{t("{amount} overdue", { amount: money(b.overdue, p.currency) })}</Pill> : null}
          </span>
        );
      },
    }] : []),
  ];

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

      <DataTable
        label={t("Contacts")}
        mode="server"
        columns={columns}
        rows={list.rows}
        total={list.total}
        rowId={(p) => p.id}
        rowLabel={(p) => p.name}
        control={control}
        loading={list.loading}
        fetching={list.fetching}
        error={list.error}
        onRetry={list.refetch}
        onOpen={(p) => void navigate({ to: "/contacts/$partyId", params: { partyId: p.id } })}
        searchPlaceholder={t("Search name, email, phone, TIN or SSM")}
        filters={
          <>
            <CompanySelect value={company.value} onChange={company.set} className="w-full" />
            <Input value={tag} onChange={(e) => setTag(e.target.value)} placeholder={t("Tag")} aria-label={t("Filter by tag")} className="w-full sm:w-36" />
            <div className="col-span-2 max-w-full min-w-0 overflow-x-auto">
              <Segmented<RoleFilter> size="sm" label={t("Which contacts")} value={role} onChange={(v) => setRoleParam(v === "all" ? "" : v)}
                options={[
                  { value: "all", label: t("All") },
                  { value: "customer", label: t("Customers") },
                  { value: "supplier", label: t("Suppliers") },
                  { value: "partner", label: t("Partners") },
                  { value: "lead", label: t("Leads") },
                ]} />
            </div>
            <Segmented<StatusFilter> size="sm" className="col-span-2 w-fit" label={t("Active or archived")} value={status} onChange={(v) => setStatusParam(v === "active" ? "" : v)}
              options={[{ value: "active", label: t("Active") }, { value: "archived", label: t("Archived") }]} />
          </>
        }
        empty={filtered ? (
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
        )}
      />

      {creating ? <PartyDialog open={creating} onOpenChange={setCreating} defaultRoles={role === "all" ? ["customer"] : [role]}
        onSaved={(p) => p.id && void navigate({ to: "/contacts/$partyId", params: { partyId: p.id } })} /> : null}
      <ImportDialog open={importing} onOpenChange={setImporting} />
    </Page>
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
