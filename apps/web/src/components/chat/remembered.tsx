/** Under a chat answer: what the agent remembered for it (facts from the brain, passages
 * from the library), so the person sees why it answered so, opens the file, or says a fact
 * is not right (it is forgotten and stops being used; it can be restored in Brain). */
import { BookOpenTextIcon, BrainIcon, CaretDownIcon, CheckIcon, XIcon } from "@phosphor-icons/react";
import { useMutation } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";

import { useT } from "@/i18n";
import { api, errorMessage } from "@/lib/api";
import { cn } from "@/lib/utils";

export interface Recalled {
  kind: "fact" | "file" | "sop";
  id: string;
  text: string;
  page?: number | null;
}

export function Remembered({ items }: { items: Recalled[] }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [gone, setGone] = useState<Set<string>>(new Set());
  const forget = useMutation({
    mutationFn: (id: string) => api(`/api/brain/facts/${encodeURIComponent(id)}/forget`, "POST", {}),
    onSuccess: (_, id) => {
      setGone((g) => new Set(g).add(id));
      toast.success(t("Forgotten. Your AI stops using it; Brain can bring it back."));
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  if (!items.length) return null;
  return (
    <div className="mt-2 text-[12px]">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open}
        className="inline-flex h-7 items-center gap-1 rounded-sm px-1.5 text-muted hover:bg-surface-2 hover:text-fg">
        <BrainIcon size={13} /> {t("What it remembered ({n})", { n: items.length })}
        <CaretDownIcon size={11} className={cn("transition-transform", open && "rotate-180")} />
      </button>
      {open ? (
        <ul className="mt-1 grid gap-1 rounded-sm border border-border bg-surface-2/40 p-2">
          {items.map((x) => (
            <li key={`${x.kind}:${x.id}`} className="flex min-w-0 items-start gap-2">
              {x.kind === "fact" ? <BrainIcon size={13} className="mt-0.5 shrink-0 text-muted" /> : <BookOpenTextIcon size={13} className="mt-0.5 shrink-0 text-muted" />}
              {x.kind === "fact" ? (
                <>
                  <span className={cn("min-w-0 flex-1 break-words", gone.has(x.id) && "text-muted line-through")}>{x.text}</span>
                  {gone.has(x.id) ? (
                    <span className="inline-flex shrink-0 items-center gap-0.5 text-muted"><CheckIcon size={12} /> {t("Forgotten")}</span>
                  ) : (
                    <button type="button" disabled={forget.isPending} onClick={() => forget.mutate(x.id)}
                      className="inline-flex shrink-0 items-center gap-0.5 rounded-sm px-1 text-muted hover:bg-danger/10 hover:text-danger">
                      <XIcon size={11} /> {t("Not right")}
                    </button>
                  )}
                </>
              ) : x.kind === "file" ? (
                <Link to="/files" search={{ f: x.id, page: x.page ?? undefined } as never} className="min-w-0 flex-1 truncate text-accent hover:underline">
                  {x.text}{x.page ? ` · ${t("p.{n}", { n: x.page })}` : ""}
                </Link>
              ) : (
                <span className="min-w-0 flex-1 truncate">{x.text}</span>
              )}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
