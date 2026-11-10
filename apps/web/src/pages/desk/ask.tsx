/** The desk's "Ask or search" (P26), opened from the desk's Ask my AI (P97): search the
 * company's documents, or hand the question to the person's AI worker, who answers with the
 * sources and, when asked, prepares a document that lands on their desk. */
import { ArrowRightIcon, CheckCircleIcon, ClockCounterClockwiseIcon, FileTextIcon, MagnifyingGlassIcon, PaperPlaneTiltIcon, SparkleIcon, XIcon } from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";

import { IconTile } from "@/components/page";
import { PinButton } from "@/components/pin-button";
import { Marked, TYPE_ICON, typeLabel, useOpenTarget } from "@/components/search-box";
import { Button } from "@/components/ui/button";
import { Card, ListCard, ListRow, Meta } from "@/components/ui/card";
import { Segmented } from "@/components/ui/segmented";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useT } from "@/i18n";
import { api, errorMessage } from "@/lib/api";
import { askDesk, askTargetsQuery, deskKeys } from "@/lib/desk";
import { searchKeys, suggestQuery, useDebounced, type SearchResult } from "@/lib/search";
import { cn } from "@/lib/utils";

/** `bare`: no card around it (inside the Ask my AI sheet). `initial`: words to start with. */
export function AskPanel({ bare = false, initial = "" }: { bare?: boolean; initial?: string }) {
  const t = useT();
  const qc = useQueryClient();
  const open = useOpenTarget();
  const [q, setQ] = useState(initial);
  const [make, setMake] = useState<"answer" | "document">("answer");
  const [agentId, setAgentId] = useState<string>("");
  const [searched, setSearched] = useState("");
  const [asked, setAsked] = useState<{ id: string; title: string; agent: string; note: string | null } | null>(null);
  const debounced = useDebounced(q.trim(), 180);
  const { data: sug } = useQuery(suggestQuery(debounced, undefined, debounced.length >= 2 && debounced !== searched));
  const { data: targets = [] } = useQuery(askTargetsQuery);
  const target = targets.find((a) => a.id === agentId) ?? targets[0];
  const results = useQuery({
    queryKey: [...searchKeys.all, "desk", searched],
    queryFn: () => api<SearchResult>(`/api/search?${new URLSearchParams({ q: searched, limit: "6" })}`),
    enabled: !!searched,
  });
  const ask = useMutation({
    mutationFn: () => askDesk({ text: q.trim(), agent_id: target?.id, make }),
    onSuccess: (r) => {
      setAsked({ id: r.task_id, title: r.title, agent: r.agent.name, note: r.note });
      setQ("");
      setSearched("");
      void qc.invalidateQueries({ queryKey: deskKeys.all });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const search = (text: string) => {
    const s = text.trim();
    if (!s) return;
    setQ(s);
    setSearched(s);
    setAsked(null);
  };
  const terms = (sug?.suggestions ?? []).filter((s) => q.trim() && s.text.toLowerCase() !== q.trim().toLowerCase()).slice(0, 6);
  return (
    <Card data-guide="desk.ask" className={cn("overflow-hidden", bare && "border-0 bg-transparent shadow-none")}>
      <div className={cn("grid grid-cols-[minmax(0,1fr)] gap-3", bare ? "pb-2" : "bg-[radial-gradient(ellipse_at_top_left,var(--accent-soft),transparent_65%)] p-4 sm:p-5")}>
        {!bare ? (
          <div className="flex flex-wrap items-center gap-2">
            <IconTile icon={SparkleIcon} size="sm" />
            <h2 className="text-[15px] font-semibold">{t("Ask or search")}</h2>
            <span className="text-[12.5px] text-muted">{t("Anything inside your company's documents, SOPs and records.")}</span>
          </div>
        ) : null}
        <form
          className="flex flex-col gap-2 sm:flex-row"
          onSubmit={(e) => {
            e.preventDefault();
            search(q);
          }}
        >
          <label className="relative min-w-0 flex-1">
            <span className="sr-only">{t("Ask or search")}</span>
            <MagnifyingGlassIcon size={18} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={t("e.g. kelayakan advance, RM700, uniform request, a tender number…")}
              className="h-12 w-full rounded-sm border border-border bg-surface pr-10 pl-10 text-[15px] text-fg placeholder:text-muted/80 focus-visible:border-accent focus-visible:ring-3 focus-visible:ring-accent/20 focus-visible:outline-none"
            />
            {q ? (
              <button type="button" aria-label={t("Clear")} onClick={() => { setQ(""); setSearched(""); }} className="absolute top-1/2 right-3 -translate-y-1/2 text-muted hover:text-fg">
                <XIcon size={16} />
              </button>
            ) : null}
          </label>
          <div className="flex min-w-0 gap-2 max-sm:[&>*]:min-w-0 max-sm:[&>*]:flex-1">
            <Button type="submit" variant="outline" size="lg" disabled={!q.trim()}>
              <MagnifyingGlassIcon size={16} /> {t("Search")}
            </Button>
            <Button type="button" size="lg" disabled={q.trim().length < 3 || !target} loading={ask.isPending} onClick={() => ask.mutate()}>
              <PaperPlaneTiltIcon size={16} /> <span className="truncate">{target ? t("Ask {name}", { name: target.name }) : t("Ask my AI")}</span>
            </Button>
          </div>
        </form>
        {terms.length ? (
          <div className="flex flex-wrap gap-1.5">
            {terms.map((s) => (
              <button
                key={`${s.kind}:${s.text}:${s.id ?? ""}`}
                type="button"
                onClick={() => (s.kind === "term" || s.kind === "recent" ? search(s.text) : open(s.url, s.type, s.branch_id))}
                className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-border bg-surface px-3 py-1 text-[12.5px] hover:border-accent/40 hover:bg-accent-soft/40"
              >
                {s.kind === "recent" ? <ClockCounterClockwiseIcon size={12} /> : s.kind === "term" ? <MagnifyingGlassIcon size={12} /> : <FileTextIcon size={12} />}
                <span className="truncate">{s.text}</span>
              </button>
            ))}
          </div>
        ) : null}
        <div className="flex min-w-0 flex-wrap items-center gap-2 text-[12.5px] text-muted">
          <Segmented
            size="sm"
            label={t("What should your AI hand back?")}
            value={make}
            onChange={setMake}
            options={[
              { value: "answer", label: t("Find and answer") },
              { value: "document", label: t("Answer and prepare a document") },
            ]}
          />
          {targets.length > 1 ? (
            <Select size="sm" label={t("Who should do it")} value={target?.id ?? ""} onValueChange={setAgentId}
              options={targets.map((a) => ({ value: a.id, label: a.is_twin ? t("{name} (your AI worker)", { name: a.name }) : a.name }))} className="min-w-0 sm:w-64" />
          ) : null}
          {!targets.length ? (
            <span>{t("You have no AI worker yet.")} <Link to="/my-worker" className="text-accent hover:underline">{t("Hire one")}</Link></span>
          ) : (
            <span>{t("Whatever it finds or makes is kept in your workspace.")}</span>
          )}
        </div>
        {asked ? (
          <div className="flex flex-wrap items-center gap-2 rounded-sm border border-accent/30 bg-accent-soft/40 px-3 py-2 text-[13px]">
            <CheckCircleIcon size={16} className="text-accent" weight="fill" />
            <span className="min-w-0 flex-1">
              {asked.note ? t("{name} will do it: {note}", { name: asked.agent, note: asked.note }) : t("{name} is on it. The answer appears under My work.", { name: asked.agent })}
            </span>
            <Link to="/tasks" search={{ task: asked.id }} className="font-medium text-accent hover:underline">{t("Follow it")}</Link>
          </div>
        ) : null}
      </div>
      {searched ? (
        <div className="border-t border-border">
          {results.isLoading ? (
            <div className="grid gap-2 p-4">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-12 rounded-sm" />)}</div>
          ) : results.data && results.data.hits.length ? (
            <ListCard className="rounded-none border-0">
              {results.data.hits.map((h) => {
                const IconCmp = TYPE_ICON[h.type];
                return (
                  <ListRow
                    key={`${h.type}:${h.id}:${h.page ?? ""}`}
                    leading={<IconTile icon={IconCmp} size="sm" tone="neutral" />}
                    title={h.title}
                    meta={
                      <>
                        <Meta items={[typeLabel(t, h.type), h.page ? t("p.{n}", { n: h.page }) : null, h.company, h.folder]} />
                        {h.snippet ? <Marked html={h.snippet} className="line-clamp-2 basis-full text-[12.5px]" /> : null}
                      </>
                    }
                    trailing={
                      <>
                        <PinButton kind={h.type === "page" ? "page" : h.type} refId={h.id} title={h.title} />
                        <Button size="sm" variant="outline" onClick={() => open(h.url, h.type, h.branch_id)}>{t("Open|verb")}</Button>
                      </>
                    }
                  />
                );
              })}
              <li className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-[12.5px] text-muted">
                <span>{t("{n} results", { n: results.data.total })}</span>
                <span className="flex flex-wrap gap-3">
                  <PinButton kind="search" refId={searched} title={searched} withLabel />
                  <Link to="/search" search={{ q: searched }} className="inline-flex items-center gap-1 font-medium text-accent hover:underline">
                    {t("See all results")} <ArrowRightIcon size={13} />
                  </Link>
                </span>
              </li>
            </ListCard>
          ) : (
            <p className="px-4 py-4 text-[13px] text-muted">
              {t("Nothing in the documents matches “{q}”.", { q: searched })} {targets.length ? t("Ask your AI worker: it also reads the files page by page and asks colleagues.") : null}
            </p>
          )}
        </div>
      ) : null}
    </Card>
  );
}
