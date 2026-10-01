import { CheckCircleIcon, XCircleIcon } from "@phosphor-icons/react";

import { Pill } from "@/components/ui/pill";
import type { EvalSuite } from "@/lib/skills";
import { cn } from "@/lib/utils";

export function SuiteBadge({ suite, label }: { suite: EvalSuite | undefined; label?: string }) {
  if (!suite) return null;
  if (suite.error) return <Pill tone="danger">{label ? `${label}: ` : ""}could not run</Pill>;
  const all = suite.passed === suite.total;
  return (
    <Pill tone={all ? "ok" : suite.passed ? "warn" : "danger"}>
      {label ? `${label}: ` : ""}{suite.passed}/{suite.total} passed
    </Pill>
  );
}

/** Per-case results; with two suites, old and new appear side by side for each case. */
export function EvalResults({ suite, before }: { suite: EvalSuite; before?: EvalSuite }) {
  if (suite.error) return <p role="alert" className="text-[13px] text-danger">{suite.error}</p>;
  return (
    <ul className="divide-y divide-border rounded-[var(--radius-md)] border border-border bg-surface">
      {suite.cases.map((c, i) => {
        const old = before?.cases[i];
        return (
          <li key={c.title + i} className="grid gap-1.5 px-4 py-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[13px] font-medium">{c.title}</span>
              {old ? (
                <span className="flex items-center gap-1 text-[12px] text-muted">
                  <Mark pass={old.pass} /> before <span aria-hidden>→</span> <Mark pass={c.pass} /> after
                </span>
              ) : <Mark pass={c.pass} withLabel />}
              <span className="ml-auto text-[11.5px] text-muted tabular">{c.tokens} tokens</span>
            </div>
            {c.failures.length ? <p className="text-[12.5px] text-danger">{c.failures.join("; ")}</p> : null}
            <details>
              <summary className="cursor-pointer text-[12px] text-muted">Answer</summary>
              <p className="mt-1 text-[12.5px] whitespace-pre-wrap text-muted">{c.output}</p>
            </details>
          </li>
        );
      })}
    </ul>
  );
}

function Mark({ pass, withLabel }: { pass: boolean; withLabel?: boolean }) {
  const Icon = pass ? CheckCircleIcon : XCircleIcon;
  return (
    <span className={cn("inline-flex items-center gap-1 text-[12px] font-medium", pass ? "text-ok" : "text-danger")}>
      <Icon size={15} weight="fill" />
      {withLabel ? (pass ? "Pass" : "Fail") : <span className="sr-only">{pass ? "pass" : "fail"}</span>}
    </span>
  );
}
