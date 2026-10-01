import { diffLines } from "diff";
import { RadioGroup } from "radix-ui";
import { useMemo, useState } from "react";

import { useIsPhone } from "@/lib/use-media";
import { cn } from "@/lib/utils";

type Row = { kind: "same" | "add" | "del"; text: string; a?: number; b?: number };

function rows(before: string, after: string): Row[] {
  const out: Row[] = [];
  let a = 1;
  let b = 1;
  for (const part of diffLines(before, after)) {
    const lines = part.value.replace(/\n$/, "").split("\n");
    for (const text of lines) {
      if (part.added) out.push({ kind: "add", text, b: b++ });
      else if (part.removed) out.push({ kind: "del", text, a: a++ });
      else out.push({ kind: "same", text, a: a++, b: b++ });
    }
  }
  return out;
}

/** Pair removed and added runs side by side; unchanged lines sit on both sides. */
function split(r: Row[]): [Row | null, Row | null][] {
  const out: [Row | null, Row | null][] = [];
  let i = 0;
  while (i < r.length) {
    if (r[i]!.kind === "same") {
      out.push([r[i]!, r[i]!]);
      i++;
      continue;
    }
    const dels: Row[] = [];
    const adds: Row[] = [];
    while (i < r.length && r[i]!.kind !== "same") (r[i]!.kind === "del" ? dels : adds).push(r[i++]!);
    for (let k = 0; k < Math.max(dels.length, adds.length); k++) out.push([dels[k] ?? null, adds[k] ?? null]);
  }
  return out;
}

const TONE = {
  same: "",
  add: "bg-ok/10 text-fg",
  del: "bg-danger/10 text-fg",
} as const;
const MARK = { same: " ", add: "+", del: "−" } as const;

function Cell({ row, side }: { row: Row | null; side: "a" | "b" }) {
  const edge = side === "b" ? "border-l border-border" : "";
  if (!row) return <td colSpan={2} className={cn("bg-surface-2/50", edge)} />;
  return (
    <>
      <td className={cn("border-r border-border px-1.5 text-right align-top text-[11px] text-muted tabular select-none", edge)}>
        {side === "a" ? row.a : row.b}
      </td>
      <td className={cn("px-2 align-top whitespace-pre-wrap break-words", TONE[row.kind])}>{row.text || " "}</td>
    </>
  );
}

/** Line diff of two texts. Side by side on wide screens, unified on phones. */
export function DiffView({ before, after, labels = ["Current", "Proposed"] }: { before: string; after: string; labels?: [string, string] }) {
  const phone = useIsPhone();
  const [mode, setMode] = useState<"split" | "unified">("split");
  const r = useMemo(() => rows(before, after), [before, after]);
  const added = r.filter((x) => x.kind === "add").length;
  const removed = r.filter((x) => x.kind === "del").length;
  const view = phone ? "unified" : mode;

  return (
    <div className="grid gap-2">
      <div className="flex items-center justify-between gap-2 text-[12.5px]">
        <span className="text-muted"><span className="font-medium text-ok">+{added}</span> <span className="font-medium text-danger">−{removed}</span> lines</span>
        {!phone ? (
          <RadioGroup.Root value={mode} onValueChange={(v) => setMode(v as "split" | "unified")} aria-label="Diff layout" className="inline-flex rounded-sm border border-border p-0.5">
            {(["split", "unified"] as const).map((v) => (
              <RadioGroup.Item key={v} value={v} className="rounded-[6px] px-2.5 py-0.5 text-[12px] text-muted capitalize data-[state=checked]:bg-surface-2 data-[state=checked]:font-medium data-[state=checked]:text-fg">{v}</RadioGroup.Item>
            ))}
          </RadioGroup.Root>
        ) : null}
      </div>
      <div className="overflow-x-auto rounded-sm border border-border bg-surface">
        <table className="w-full table-fixed border-collapse font-mono text-[12px] leading-[1.6]">
          {view === "split" ? (
            <>
              <colgroup>
                <col className="w-10" />
                <col />
                <col className="w-10" />
                <col />
              </colgroup>
              <thead>
                <tr className="border-b border-border text-left text-[11.5px] text-muted">
                  <th colSpan={2} className="px-2 py-1 font-medium">{labels[0]}</th>
                  <th colSpan={2} className="border-l border-border px-2 py-1 font-medium">{labels[1]}</th>
                </tr>
              </thead>
              <tbody>
                {split(r).map(([a, b], i) => (
                  <tr key={i}>
                    <Cell row={a} side="a" />
                    <Cell row={b} side="b" />
                  </tr>
                ))}
              </tbody>
            </>
          ) : (
            <>
              <colgroup>
                <col className="w-7" />
                <col />
              </colgroup>
              <tbody>
              {r.map((row, i) => (
                <tr key={i} className={TONE[row.kind]}>
                  <td className="px-1 text-center align-top text-muted select-none">{MARK[row.kind]}</td>
                  <td className="px-2 align-top whitespace-pre-wrap break-words">{row.text || " "}</td>
                </tr>
              ))}
              </tbody>
            </>
          )}
        </table>
      </div>
    </div>
  );
}
