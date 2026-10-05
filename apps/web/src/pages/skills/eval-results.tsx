import { CheckCircleIcon, XCircleIcon } from "@phosphor-icons/react";

import { Pill } from "@/components/ui/pill";
import { useT } from "@/i18n";
import type { EvalSuite } from "@/lib/skills";
import { cn } from "@/lib/utils";

export function SuiteBadge({ suite, label }: { suite: EvalSuite | undefined; label?: string }) {
  const t = useT();
  if (!suite) return null;
  if (suite.error) return <Pill tone="danger">{label ? t("{label}: could not run", { label }) : t("could not run")}</Pill>;
  const all = suite.passed === suite.total;
  return (
    <Pill tone={all ? "ok" : suite.passed ? "warn" : "danger"}>
      {label ? t("{label}: {passed}/{total} passed", { label, passed: suite.passed, total: suite.total }) : t("{passed}/{total} passed", { passed: suite.passed, total: suite.total })}
    </Pill>
  );
}

/** Per-case results; with two suites, old and new appear side by side for each case. */
export function EvalResults({ suite, before }: { suite: EvalSuite; before?: EvalSuite }) {
  const t = useT();
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
                  <Mark pass={old.pass} /> {t("before")} <span aria-hidden>→</span> <Mark pass={c.pass} /> {t("after")}
                </span>
              ) : <Mark pass={c.pass} withLabel />}
              <span className="ml-auto text-[11.5px] text-muted tabular">{t("{n} tokens", { n: c.tokens })}</span>
            </div>
            {c.failures.length ? <p className="text-[12.5px] text-danger">{c.failures.join("; ")}</p> : null}
            <details>
              <summary className="cursor-pointer text-[12px] text-muted">{t("Answer")}</summary>
              <p className="mt-1 text-[12.5px] whitespace-pre-wrap text-muted">{c.output}</p>
            </details>
          </li>
        );
      })}
    </ul>
  );
}

function Mark({ pass, withLabel }: { pass: boolean; withLabel?: boolean }) {
  const t = useT();
  const Icon = pass ? CheckCircleIcon : XCircleIcon;
  return (
    <span className={cn("inline-flex items-center gap-1 text-[12px] font-medium", pass ? "text-ok" : "text-danger")}>
      <Icon size={15} weight="fill" />
      {withLabel ? (pass ? t("Pass") : t("Fail")) : <span className="sr-only">{pass ? t("pass") : t("fail")}</span>}
    </span>
  );
}
