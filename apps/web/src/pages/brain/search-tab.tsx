import { ChatsCircleIcon, FileTextIcon, LightbulbIcon, MagnifyingGlassIcon } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Switch } from "radix-ui";
import { useDeferredValue, useState } from "react";

import { EmptyState, IconTile, type Tone } from "@/components/page";
import { ListCard, Meta } from "@/components/ui/card";
import { Input } from "@/components/ui/field";
import { Pill } from "@/components/ui/pill";
import { Skeleton } from "@/components/ui/skeleton";
import { errorMessage } from "@/lib/api";
import { searchQuery, type Hit } from "@/lib/brain";
import { timeAgo } from "@/lib/utils";

const VIA_LABEL = { keyword: "words", meaning: "meaning", link: "linked page" } as const;

function Via({ hit }: { hit: Hit }) {
  return (
    <>
      {hit.via.map((v) => <Pill key={v} tone={v === "meaning" ? "info" : v === "link" ? "accent" : "neutral"}>{VIA_LABEL[v]}</Pill>)}
    </>
  );
}

function Group({ title, icon, tone, hits, children }: { title: string; icon: typeof FileTextIcon; tone: Tone; hits: Hit[]; children: (h: Hit) => React.ReactNode }) {
  if (!hits.length) return null;
  return (
    <section className="grid min-w-0 gap-2.5">
      <h3 className="flex items-center gap-2 text-[14px] font-semibold">
        <IconTile icon={icon} tone={tone} size="sm" /> {title}
        <span className="rounded-full bg-surface-2 px-2 text-[11.5px] font-medium text-muted tabular">{hits.length}</span>
      </h3>
      <ListCard>
        {hits.map((h) => <li key={h.id} className="grid min-w-0 gap-1.5 px-4 py-3">{children(h)}</li>)}
      </ListCard>
    </section>
  );
}

export function SearchTab({ onOpenPage, initial }: { onOpenPage: (path: string) => void; initial?: string }) {
  const [q, setQ] = useState(initial ?? "");
  const [history, setHistory] = useState(false);
  const query = useDeferredValue(q.trim());
  const { data, isFetching, error } = useQuery(searchQuery(query, history));
  const empty = data && !data.facts.length && !data.pages.length && !data.history.length;

  return (
    <div className="grid min-w-0 gap-5">
      <div className="grid gap-3 rounded-[var(--radius-md)] border border-border bg-surface p-3 shadow-[0_1px_2px_hsl(var(--shadow)/0.04)] sm:p-4">
        <label className="relative block">
          <span className="sr-only">Search the brain</span>
          <MagnifyingGlassIcon size={18} className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-muted" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ask what the office knows, in English or Malay" className="h-12 pl-10 text-[15px]" autoFocus />
        </label>
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 text-[12.5px] text-muted">
          <label className="inline-flex min-h-9 cursor-pointer items-center gap-2.5">
            <Switch.Root checked={history} onCheckedChange={setHistory}
              className="relative h-6 w-10 shrink-0 rounded-full bg-border transition-colors data-[state=checked]:bg-accent">
              <Switch.Thumb className="block size-5 translate-x-0.5 rounded-full bg-white shadow-sm transition-transform duration-200 data-[state=checked]:translate-x-[18px]" />
            </Switch.Root>
            Include past conversations
          </label>
          {data ? (
            <span className="min-w-0">
              <span className="tabular">{data.took_ms} ms</span> · {data.vectors ? "words, meaning and links" : "words and links only (embedding model not loaded)"}
            </span>
          ) : null}
        </div>
      </div>

      {query.length < 2 ? (
        <EmptyState icon={MagnifyingGlassIcon} title="Search like an agent recalls"
          body="This is the same search agents use when they recall. Each result shows how it was found: matching words, similar meaning, or a page linked from a strong match." />
      ) : isFetching && !data ? (
        <div className="grid gap-px overflow-hidden rounded-[var(--radius-md)] border border-border">
          {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-16 rounded-none" />)}
        </div>
      ) : error ? (
        <p role="alert" className="text-danger">{errorMessage(error)}</p>
      ) : empty ? (
        <EmptyState icon={MagnifyingGlassIcon} title={`Nothing matches “${query}”`} body="Agents would ask a person, then remember the answer." />
      ) : data ? (
        <div className="grid min-w-0 gap-6">
          <Group title="Facts" icon={LightbulbIcon} tone="warn" hits={data.facts}>
            {(h) => (
              <>
                <p className="text-[13.5px] break-words">{h.title}</p>
                <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-muted">
                  <Via hit={h} />
                  <span className="flex min-w-0 flex-wrap items-center gap-x-1.5">
                    <Meta items={[typeof h.meta.source === "string" ? h.meta.source : null, h.when ? timeAgo(h.when) : null]} />
                  </span>
                </div>
              </>
            )}
          </Group>
          <Group title="Pages" icon={FileTextIcon} tone="accent" hits={data.pages}>
            {(h) => (
              <>
                <button type="button" onClick={() => h.path && onOpenPage(h.path)} className="w-fit text-left text-[13.5px] font-medium break-words text-accent hover:underline">{h.title}</button>
                <p className="line-clamp-3 text-[13px] break-words text-muted">{h.snippet}</p>
                <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-muted">
                  <Via hit={h} />
                  <span className="min-w-0 font-mono break-all">{h.path}</span>
                </div>
              </>
            )}
          </Group>
          <Group title="Past conversations" icon={ChatsCircleIcon} tone="info" hits={data.history}>
            {(h) => {
              const taskId = typeof h.meta.task_id === "string" ? h.meta.task_id : null;
              return (
                <>
                  {taskId ? <Link to="/tasks" search={{ task: taskId }} className="w-fit text-[13.5px] font-medium break-words text-accent hover:underline">{h.title}</Link>
                    : <span className="text-[13.5px] font-medium break-words">{h.title}</span>}
                  <p className="line-clamp-3 text-[13px] break-words text-muted">{h.snippet}</p>
                  {h.when ? <span className="text-[12px] text-muted">{timeAgo(h.when)}</span> : null}
                </>
              );
            }}
          </Group>
        </div>
      ) : null}
    </div>
  );
}
