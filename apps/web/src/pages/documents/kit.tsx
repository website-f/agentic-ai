import {
  BankIcon, CoinsIcon, IdentificationCardIcon, ImageSquareIcon, ListPlusIcon, PaletteIcon, PhoneIcon, PlusIcon, TrashIcon,
  UsersIcon, type Icon,
} from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { EmptyState, IconTile, Page, PageHeader, type Tone } from "@/components/page";
import { Button } from "@/components/ui/button";
import { ActionBar, Card, CardBody, CardHeader } from "@/components/ui/card";
import { Field, Input, TextareaField } from "@/components/ui/field";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { msg, t as tr, useT } from "@/i18n";
import { api, errorMessage } from "@/lib/api";
import { useCompanies } from "@/lib/company";
import { docKeys, fileUrl, kitQuery, kitsQuery, uploadFile, type CompanyKit, type CustomKitField } from "@/lib/documents";
import { cn } from "@/lib/utils";
import { DocSteps } from "./visuals";

type KitData = Record<string, string>;

const GROUP: Record<string, { icon: Icon; tone: Tone; hint: string }> = {
  Identity: { icon: IdentificationCardIcon, tone: "accent", hint: msg("As registered") },
  Contact: { icon: PhoneIcon, tone: "info", hint: msg("Shown on the letterhead") },
  Bank: { icon: BankIcon, tone: "violet", hint: msg("Printed on invoices") },
  People: { icon: UsersIcon, tone: "orange", hint: msg("Who signs") },
  Money: { icon: CoinsIcon, tone: "warn", hint: msg("Currency, tax and terms") },
  Brand: { icon: PaletteIcon, tone: "pink", hint: msg("Colour and footer") },
};

/** How the top of every document will look. Paper is white in both themes, like a page. */
function Letterhead({ data, logo }: { data: KitData; logo: string | null }) {
  const t = useT();
  const accent = /^#[0-9a-f]{6}$/i.test(data.accent ?? "") ? data.accent : "#13895f";
  const address = (data.address ?? "").split("\n").map((s) => s.trim()).filter(Boolean).join(", ");
  const contact = [data.phone, data.email, data.website].filter(Boolean).join("  ·  ");
  return (
    <div className="overflow-hidden rounded-[var(--radius-md)] border border-border bg-white p-5 text-[#191919] shadow-[var(--shadow-soft)]">
      <div className="flex items-start gap-4">
        {logo ? <img src={fileUrl(logo, true)} alt="" className="h-12 w-auto max-w-28 object-contain" /> : null}
        <div className="min-w-0">
          <p className="truncate text-[17px] font-bold">{data.legal_name || <span className="text-[#9a9a9a]">{t("Your company name")}</span>}</p>
          {data.reg_no ? <p className="text-[11.5px] text-[#5f5f5f]">Registration No. {data.reg_no}{data.tax_no ? `  ·  Tax No. ${data.tax_no}` : ""}</p> : null}
          {address ? <p className="truncate text-[11.5px] text-[#5f5f5f]">{address}</p> : null}
          {contact ? <p className="truncate text-[11.5px] text-[#5f5f5f]">{contact}</p> : null}
        </div>
      </div>
      <div className="mt-3 h-[2px]" style={{ background: accent }} />
      <p className="mt-3 text-[11.5px] text-[#9a9a9a]">{t("Every quotation, invoice, letter and pack for this company starts like this.")}</p>
    </div>
  );
}

function KitForm({ kit }: { kit: CompanyKit }) {
  const t = useT();
  const qc = useQueryClient();
  const [data, setData] = useState<KitData>(() =>
    Object.fromEntries(Object.entries(kit.data).filter(([k]) => k !== "custom").map(([k, v]) => [k, String(v)])),
  );
  const [custom, setCustom] = useState<CustomKitField[]>(kit.data.custom ?? []);
  const [logo, setLogo] = useState<string | null>(kit.logo_file_id);
  const [dirty, setDirty] = useState(false);
  const logoInput = useRef<HTMLInputElement>(null);
  const set = (k: string, v: string) => { setData((d) => ({ ...d, [k]: v })); setDirty(true); };
  const ro = !kit.can_edit;

  const save = useMutation({
    mutationFn: () => api<CompanyKit>(`/api/company-kits/${kit.branch_id}`, "PUT", {
      data: { ...data, custom: custom.filter((c) => c.label.trim()) },
      logo_file_id: logo,
    }),
    onSuccess: (k) => {
      qc.setQueryData(docKeys.kit(kit.branch_id), k);
      qc.invalidateQueries({ queryKey: docKeys.kits });
      setDirty(false);
      toast.success(tr("{name} kit saved.", { name: kit.branch_name }));
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const upLogo = useMutation({
    mutationFn: (f: File) => uploadFile(f, { branch_id: kit.branch_id }),
    onSuccess: (f) => {
      if (!f.mime.startsWith("image/")) { toast.error(tr("The logo must be an image (PNG or JPG).")); return; }
      setLogo(f.id);
      setDirty(true);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const groups = [...new Set(kit.fields.map((f) => f.group))];
  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <form className="grid min-w-0 gap-5" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
        {groups.map((g, gi) => (
          <Card key={g} data-guide={gi === 0 ? "company-kit.fields" : undefined}>
            <CardHeader title={t(g)} description={GROUP[g] ? t(GROUP[g].hint) : undefined}
              icon={<IconTile icon={GROUP[g]?.icon ?? IdentificationCardIcon} tone={GROUP[g]?.tone ?? "neutral"} size="sm" />} />
            <CardBody>
            <fieldset disabled={ro} className="grid gap-3 sm:grid-cols-2">
              {kit.fields.filter((f) => f.group === g).map((f) =>
                f.type === "longtext" ? (
                  <TextareaField key={f.key} label={f.label} rows={3} value={data[f.key] ?? ""} onChange={(e) => set(f.key, e.target.value)} className="sm:col-span-2" />
                ) : f.key === "accent" ? (
                  <div key={f.key} className="grid gap-1.5">
                    <span className="text-[13px] font-medium">{f.label}</span>
                    <div className="flex items-center gap-2">
                      <input type="color" aria-label={f.label} value={data.accent || "#13895f"} onChange={(e) => set("accent", e.target.value)}
                        className="h-10 w-12 cursor-pointer rounded-sm border border-border bg-surface p-1" />
                      <Input value={data.accent ?? ""} onChange={(e) => set("accent", e.target.value)} placeholder="#13895f" className="font-mono" />
                    </div>
                  </div>
                ) : (
                  <Field key={f.key} label={f.label} value={data[f.key] ?? ""} onChange={(e) => set(f.key, e.target.value)}
                    type={f.type === "number" ? "number" : f.key === "incorporated_on" ? "date" : "text"}
                    placeholder={f.key === "currency" ? "RM" : f.key === "tax_label" ? "SST" : f.key === "payment_terms" ? t("e.g. 30 days from invoice") : undefined} />
                ),
              )}
            </fieldset>
            </CardBody>
          </Card>
        ))}

        <Card>
          <CardHeader title={t("More facts")} icon={<IconTile icon={ListPlusIcon} tone="neutral" size="sm" />}
            description={<>{t("Licence numbers, CIDB grade, MOF registration… Use them in templates as")} {"{{company.<key>}}"}.</>} />
          <CardBody>
          <fieldset disabled={ro} className="grid gap-3">
          {custom.map((c, i) => (
            <div key={i} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_auto] items-end gap-2 max-sm:grid-cols-[minmax(0,1fr)_auto] max-sm:[&>*:nth-child(2)]:col-start-1 max-sm:[&>*:nth-child(2)]:row-start-2">
              <Field label={i ? "" : t("Name")} aria-label={t("Name")} value={c.label} placeholder={t("e.g. CIDB grade")}
                onChange={(e) => { const label = e.target.value; setCustom((cs) => cs.map((x, j) => j === i ? { ...x, label, key: x.key || "" } : x)); setDirty(true); }} />
              <Field label={i ? "" : t("Value")} aria-label={t("Value")} value={c.value} placeholder={t("e.g. G7")}
                onChange={(e) => { const value = e.target.value; setCustom((cs) => cs.map((x, j) => j === i ? { ...x, value } : x)); setDirty(true); }} />
              <Button type="button" variant="ghost" size="icon" aria-label={t("Remove")} onClick={() => { setCustom((cs) => cs.filter((_, j) => j !== i)); setDirty(true); }}>
                <TrashIcon size={16} />
              </Button>
            </div>
          ))}
          <Button type="button" size="sm" variant="outline" className="w-fit" onClick={() => setCustom((cs) => [...cs, { key: "", label: "", value: "" }])}>
            <PlusIcon size={14} /> {t("Add a fact")}
          </Button>
          </fieldset>
          </CardBody>
        </Card>
        {!ro ? (
          <ActionBar className="lg:hidden">
            <span className="text-[12.5px] text-muted max-md:hidden">{t("{n} of {total} filled", { n: kit.filled, total: kit.total })}</span>
            <Button data-guide="company-kit.save" type="submit" loading={save.isPending} disabled={!dirty}>{dirty ? t("Save kit") : t("Saved")}</Button>
          </ActionBar>
        ) : null}
      </form>

      <aside className="grid content-start gap-4 max-lg:row-start-1 lg:sticky lg:top-20">
        <Letterhead data={data} logo={logo} />
        <div className="grid gap-2 rounded-[var(--radius-md)] border border-border bg-surface p-4">
          <span className="text-[13px] font-semibold">{t("Logo")}</span>
          <input ref={logoInput} type="file" accept="image/png,image/jpeg,image/webp" hidden
            onChange={(e) => { const f = e.target.files?.[0]; if (f) upLogo.mutate(f); e.target.value = ""; }} />
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" disabled={ro} loading={upLogo.isPending} onClick={() => logoInput.current?.click()}>
              <ImageSquareIcon size={14} /> {logo ? t("Replace logo") : t("Upload logo")}
            </Button>
            {logo ? <Button size="sm" variant="ghost" disabled={ro} onClick={() => { setLogo(null); setDirty(true); }}>{t("Remove")}</Button> : null}
          </div>
        </div>
        <div className="grid gap-2 rounded-[var(--radius-md)] border border-border bg-surface p-4">
          <div className="flex items-center justify-between text-[13px]">
            <span className="font-semibold">{t("Complete")}</span>
            <span className="text-muted">{t("{n} of {total}", { n: kit.filled, total: kit.total })}</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-surface-2">
            <div className="h-full rounded-full bg-accent transition-[width]" style={{ width: `${Math.round((kit.filled / Math.max(1, kit.total)) * 100)}%` }} />
          </div>
          {ro ? <p className="text-[12.5px] text-muted">{t("Only admins and this company's manager can change it.")}</p>
            : <Button data-guide="company-kit.save" className="max-lg:hidden" loading={save.isPending} disabled={!dirty} onClick={() => save.mutate()}>{dirty ? t("Save kit") : t("Saved")}</Button>}
        </div>
      </aside>
    </div>
  );
}

export function CompanyKitPage() {
  const t = useT();
  const search = useSearch({ from: "/app/company-kit" });
  const navigate = useNavigate({ from: "/company-kit" });
  const { data: kits = [], isLoading, error } = useQuery(kitsQuery);
  // One company at a time: without ?b= it opens the header's company (under "All companies",
  // the last one picked), else the first.
  const { one } = useCompanies();
  const start = (kits.find((k) => k.branch_id === one?.id) ?? kits[0])?.branch_id;
  const current = search.b ?? start;
  const { data: kit } = useQuery({ ...kitQuery(current ?? ""), enabled: !!current });
  useEffect(() => {
    if (!search.b && start) navigate({ search: { b: start }, replace: true });
  }, [start, search.b, navigate]);

  return (
    <Page>
      <PageHeader title={t("Company kit")}
        description={t("The facts every document about a company reuses: legal name, registration, address, bank, signatory and logo. Fill it once; templates and agents use it everywhere.")} />
      <DocSteps current="/company-kit" />
      {isLoading ? <Skeleton className="h-64" />
        : error ? <p role="alert" className="text-danger">{errorMessage(error)}</p>
        : !kits.length ? (
          <EmptyState icon={IdentificationCardIcon} title={t("No companies yet")} body={t("Add a branch (one per company) in Organization first.")} />
        ) : (
          <>
            {kits.length > 1 && kits.length <= 12 ? (
              <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0" role="tablist" aria-label={t("Companies")}>
                {kits.map((k) => (
                  <button key={k.branch_id} role="tab" aria-selected={k.branch_id === current} onClick={() => navigate({ search: { b: k.branch_id } })}
                    className={cn("flex shrink-0 items-center gap-2 rounded-full border px-3 py-1.5 text-[13px] whitespace-nowrap",
                      k.branch_id === current ? "border-accent bg-accent-soft font-medium text-accent" : "border-border hover:bg-surface-2")}>
                    {k.branch_name}
                    <span className={cn("text-[11.5px]", k.filled >= k.total - 3 ? "text-ok" : "text-muted")}>{k.filled}/{k.total}</span>
                  </button>
                ))}
              </div>
            ) : null}
            {kits.length > 12 ? (
              <Select value={current ?? ""} onValueChange={(b) => navigate({ search: { b } })} label={t("Company")} className="sm:w-72"
                options={kits.map((k) => ({ value: k.branch_id, label: k.branch_name, hint: `${k.filled}/${k.total}` }))} />
            ) : null}
            {kit ? <KitForm key={kit.branch_id + (kit.updated_at ?? "")} kit={kit} /> : <Skeleton className="h-64" />}
          </>
        )}
    </Page>
  );
}
