import { ChatsCircleIcon, FileTextIcon, LightbulbIcon, MagnifyingGlassIcon } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useDeferredValue, useState } from "react";

import { Input } from "@/components/ui/field";
import { Pill } from "@/components/ui/pill";
import { Skeleton } from "@/components/ui/skeleton";
import { errorMessage } from "@/lib/api";
import { searchQuery, type Hit } from "@/lib/brain";
import { timeAgo } from "@/lib/utils";

const VIA_LABEL = { keyword: "words", meaning: "meaning", link: "linked page" } as const;

function Via({ hit }: { hit: Hit }) {
  return (
    <span className="flex flex-wrap gap-1">
      {hit.via.map((v) => <Pill key={v} tone={v === "meaning" ? "info" : v === "link" ? "accent" : "neutral"}>{VIA_LABEL[v]}</Pill>)}
    </span>
  );
}

function Group({ title, icon: Icon, hits, children }: { title: string; icon: typeof FileTextIcon; hits: Hit[]; children: (h: Hit) => React.ReactNode }) {
  if (!hits.length) return null;
  return (
    <section className="grid gap-2">
      <h3 className="flex items-center gap-1.5 text-[13px] font-semibold"><Icon size={15} /> {title} <span className="font-normal text-muted">{hits.length}</span></h3>
      <ul className="divide-y divide-border rounded-[var(--radius-md)] border border-border bg-surface">
        {hits.map((h) => <li key={h.id} className="grid gap-1.5 px-4 py-3">{children(h)}</li>)}
      </ul>
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
    <div className="grid gap-5">
      <div className="grid gap-2">
        <label className="relative block">
          <span className="sr-only">Search the brain</span>
          <MagnifyingGlassIcon size={18} className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-muted" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ask what the office knows, in English or Malay" className="h-12 pl-10 text-[15px]" autoFocus />
        </label>
        <div className="flex flex-wrap items-center justify-between gap-2 text-[12.5px] text-muted">
          <label className="inline-flex items-center gap-2">
            <input type="checkbox" checked={history} onChange={(e) => setHistory(e.target.checked)} className="size-4 accent-[var(--accent)]" />
            Include past conversations
          </label>
          {data ? (
            <span>
              {data.took_ms} ms · {data.vectors ? "words, meaning and links" : "words and links only (embedding model not loaded)"}
            </span>
          ) : null}
        </div>
      </div>

      {query.length < 2 ? (
        <p className="text-[13.5px] text-muted">This is the same search agents use when they recall. Each result shows how it was found: matching words, similar meaning, or a page linked from a strong match.</p>
      ) : isFetching && !data ? (
        <Skeleton className="h-48 rounded-[var(--radius-md)]" />
      ) : error ? (
        <p role="alert" className="text-danger">{errorMessage(error)}</p>
      ) : empty ? (
        <p className="text-[13.5px] text-muted">Nothing matches “{query}”. Agents would ask a person, then remember the answer.</p>
      ) : data ? (
        <div className="grid gap-6">
          <Group title="Facts" icon={LightbulbIcon} hits={data.facts}>
            {(h) => (
              <>
                <p className="text-[13.5px]">{h.title}</p>
                <div className="flex flex-wrap items-center gap-2 text-[12px] text-muted">
                  <Via hit={h} />
                  {typeof h.meta.source === "string" ? <span>{h.meta.source}</span> : null}
                  {h.when ? <span>{timeAgo(h.when)}</span> : null}
                </div>
              </>
            )}
          </Group>
          <Group title="Pages" icon={FileTextIcon} hits={data.pages}>
            {(h) => (
              <>
                <button onClick={() => h.path && onOpenPage(h.path)} className="w-fit text-left text-[13.5px] font-medium text-accent hover:underline">{h.title}</button>
                <p className="text-[13px] text-muted">{h.snippet}</p>
                <div className="flex flex-wrap items-center gap-2 text-[12px] text-muted">
                  <Via hit={h} />
                  <span className="truncate font-mono">{h.path}</span>
                </div>
              </>
            )}
          </Group>
          <Group title="Past conversations" icon={ChatsCircleIcon} hits={data.history}>
            {(h) => {
              const taskId = typeof h.meta.task_id === "string" ? h.meta.task_id : null;
              return (
                <>
                  {taskId ? <Link to="/tasks" search={{ task: taskId }} className="w-fit text-[13.5px] font-medium text-accent hover:underline">{h.title}</Link>
                    : <span className="text-[13.5px] font-medium">{h.title}</span>}
                  <p className="text-[13px] text-muted">{h.snippet}</p>
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
