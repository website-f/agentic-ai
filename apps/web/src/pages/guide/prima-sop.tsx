/** P121b (Fitri, 21 Nov 2026: "I'm in the /guide page, but where are the Prima SOPs and workflows?"): the guide's
 * chapter for Prima's SOPs and workflows, the same flows as Prima's own SOP and workflows screen (Home > Guides).
 * /guide/prima-sop lists them by app with a search; /guide/prima-sop?flow=<id> is one flow: who starts it, each step
 * with who does it and a button that opens that screen (and tab) in Prima, the rules and where it was declared. */
import {
  ArrowLeftIcon,
  ArrowSquareOutIcon,
  CaretRightIcon,
  CheckCircleIcon,
  FlowArrowIcon,
  GavelIcon,
  ListNumbersIcon,
  PlayIcon,
  SealCheckIcon,
  SignpostIcon,
  UserIcon,
} from "@phosphor-icons/react";
import { Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";

import { EmptyState, IconTile } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Pill } from "@/components/ui/pill";
import { SearchInput } from "@/components/ui/search-input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  PRIMA_SOP_PAGE, pick, primaHash, searchPrimaSops, usePrimaSops,
  type PrimaPlace, type PrimaSop, type PrimaSops, type PrimaSopStatus,
} from "@/guide/prima-sops";
import { msg, useLang, useT } from "@/i18n";
import { cn } from "@/lib/utils";

const STATUS: Record<PrimaSopStatus, { label: string; tone: "ok" | "info" | "neutral" | "warn" }> = {
  in_force: { label: msg("In force"), tone: "ok" },
  trial: { label: msg("Trial"), tone: "info" },
  off: { label: msg("Switched off"), tone: "neutral" },
  draft: { label: msg("Not in force yet"), tone: "warn" },
};

/** With nothing typed and every app shown: the first flows of each app, then "See all". */
const FIRST = 4;

function StatusPill({ s }: { s: PrimaSopStatus }) {
  const t = useT();
  return <Pill tone={STATUS[s].tone} className="text-[11.5px]">{t(STATUS[s].label)}</Pill>;
}

/** A button that opens a Prima screen (and tab) inside the office. */
function OpenInPrima({ place, primary, className }: { place: PrimaPlace; primary?: boolean; className?: string }) {
  const lang = useLang((s) => s.lang);
  return (
    <Button asChild variant={primary ? "primary" : "outline"} className={cn("h-11 max-w-full justify-start gap-2 whitespace-normal text-left", className)}>
      <Link to="/prima" hash={primaHash(place)}>
        <ArrowSquareOutIcon size={16} className="shrink-0" />
        <span className="min-w-0">{pick(place.label, lang)}</span>
      </Link>
    </Button>
  );
}

function FlowRow({ sop }: { sop: PrimaSop }) {
  const t = useT();
  const lang = useLang((s) => s.lang);
  return (
    <li className="min-w-0">
      <Link
        to="/guide/$page"
        params={{ page: PRIMA_SOP_PAGE }}
        search={{ flow: sop.id }}
        className="group grid min-h-11 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-[var(--radius-md)] border border-border bg-surface px-4 py-3.5 transition-[border-color,box-shadow] duration-200 hover:border-accent/40 hover:shadow-[var(--shadow-soft)]"
      >
        <span className="grid min-w-0 gap-1">
          <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-[15px] font-medium break-words">{pick(sop.title, lang)}</span>
            {sop.status !== "in_force" ? <StatusPill s={sop.status} /> : null}
          </span>
          <span className="line-clamp-2 text-[13.5px] leading-snug text-muted">{pick(sop.purpose, lang)}</span>
          <span className="text-[12.5px] text-muted tabular">
            {t("{n} steps", { n: sop.steps.length })}
            {sop.start ? ` · ${t("has a form to start it")}` : ""}
          </span>
        </span>
        <CaretRightIcon size={16} className="shrink-0 text-muted transition-transform group-hover:translate-x-0.5" />
      </Link>
    </li>
  );
}

function FlowList({ data }: { data: PrimaSops }) {
  const t = useT();
  const lang = useLang((s) => s.lang);
  const [query, setQuery] = useState("");
  const [app, setApp] = useState<string>("");
  const [allForms, setAllForms] = useState(false);
  const typed = query.trim().length > 1;
  const list = useMemo(() => searchPrimaSops(data, typed ? query : "", app || undefined), [data, query, typed, app]);
  const forms = useMemo(() => data.sops.filter((s) => s.start && (!app || s.app === app)), [data, app]);
  const groups = data.apps
    .map((a) => ({ app: a, sops: list.filter((s) => s.app === a.id) }))
    .filter((g) => g.sops.length);
  const counts = useMemo(() => new Map(data.apps.map((a) => [a.id, data.sops.filter((s) => s.app === a.id).length])), [data]);
  const chip = (on: boolean) =>
    cn(
      "inline-flex h-10 shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-[13.5px] font-medium whitespace-nowrap transition-colors pointer-coarse:h-11",
      on ? "border-accent bg-accent-soft text-accent" : "border-border bg-surface text-muted hover:text-fg",
    );

  return (
    <div className="grid gap-8">
      <div className="grid gap-3">
        <SearchInput value={query} onChange={setQuery} placeholder={t("Search the flows, e.g. uniform, leave or claim")} className="basis-auto" />
        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0" role="group" aria-label={t("Apps")}>
          <button type="button" className={chip(!app)} aria-pressed={!app} onClick={() => setApp("")}>
            {t("All")} <span className="tabular opacity-70">{data.sops.length}</span>
          </button>
          {data.apps.map((a) => (
            <button key={a.id} type="button" className={chip(app === a.id)} aria-pressed={app === a.id} onClick={() => setApp(app === a.id ? "" : a.id)}>
              {pick(a, lang)} <span className="tabular opacity-70">{counts.get(a.id)}</span>
            </button>
          ))}
        </div>
      </div>

      {!typed && forms.length ? (
        <section className="grid gap-3" aria-labelledby="prima-forms">
          <div>
            <h2 id="prima-forms" className="flex items-center gap-2 text-[19px] font-semibold">
              <PlayIcon size={18} weight="duotone" className="text-accent" /> {t("Forms you can start")}
            </h2>
            <p className="text-[14px] text-muted">{t("Each opens the form in Prima. Prima shows only the ones your role may use.")}</p>
          </div>
          <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {(allForms ? forms : forms.slice(0, 6)).map((s) => (
              <li key={s.id} className="flex min-w-0 flex-col gap-2 rounded-[var(--radius-md)] border border-border bg-surface p-3.5">
                <Link to="/guide/$page" params={{ page: PRIMA_SOP_PAGE }} search={{ flow: s.id }} className="text-[14.5px] font-medium break-words hover:text-accent hover:underline">
                  {pick(s.title, lang)}
                </Link>
                {s.start ? <OpenInPrima place={s.start} className="h-10 w-fit text-[13.5px]" /> : null}
              </li>
            ))}
          </ul>
          {forms.length > 6 && !allForms ? (
            <Button variant="ghost" className="h-11 w-fit" onClick={() => setAllForms(true)}>
              {t("Show all {n} forms", { n: forms.length })}
            </Button>
          ) : null}
        </section>
      ) : null}

      {groups.length ? (
        groups.map((g) => {
          const short = !typed && !app && g.sops.length > FIRST;
          return (
            <section key={g.app.id} className="grid gap-3" aria-label={pick(g.app, lang)}>
              <h2 className="flex items-baseline gap-2 text-[19px] font-semibold">
                {pick(g.app, lang)} <span className="text-[14px] font-normal text-muted tabular">{g.sops.length}</span>
              </h2>
              <ul className="grid grid-cols-1 gap-2 lg:grid-cols-2">
                {(short ? g.sops.slice(0, FIRST) : g.sops).map((s) => (
                  <FlowRow key={s.id} sop={s} />
                ))}
              </ul>
              {short ? (
                <Button variant="ghost" className="h-11 w-fit" onClick={() => setApp(g.app.id)}>
                  {t("See all {n} in {app}", { n: g.sops.length, app: pick(g.app, lang) })} <CaretRightIcon size={14} />
                </Button>
              ) : null}
            </section>
          );
        })
      ) : (
        <p className="py-6 text-center text-[14px] text-muted">
          {t('No Prima flow matches "{q}". Try one word, such as "uniform" or "leave".', { q: query.trim() })}
        </p>
      )}
    </div>
  );
}

function FlowDetail({ sop, data }: { sop: PrimaSop; data: PrimaSops }) {
  const t = useT();
  const lang = useLang((s) => s.lang);
  const app = data.apps.find((a) => a.id === sop.app);
  const same = data.sops.filter((s) => s.app === sop.app);
  const i = same.findIndex((s) => s.id === sop.id);
  const next = same[i + 1];
  return (
    <article className="grid min-w-0 gap-8">
      <Link
        to="/guide/$page"
        params={{ page: PRIMA_SOP_PAGE }}
        className="inline-flex min-h-11 w-fit items-center gap-1.5 text-[14px] font-medium text-accent hover:underline"
      >
        <ArrowLeftIcon size={16} /> {t("All Prima flows")}
      </Link>

      <header className="grid gap-3">
        <p className="text-[12px] font-semibold tracking-[0.08em] text-accent uppercase">Prima · {app ? pick(app, lang) : sop.app}</p>
        <h1 className="text-[26px] leading-tight font-semibold tracking-tight text-balance break-words sm:text-[32px]">{pick(sop.title, lang)}</h1>
        <div className="flex flex-wrap items-center gap-2">
          <StatusPill s={sop.status} />
          {sop.statusNote ? <span className="text-[13.5px] text-muted">{pick(sop.statusNote, lang)}</span> : null}
        </div>
        <p className="max-w-[62ch] text-[17px] leading-relaxed font-medium">{pick(sop.purpose, lang)}</p>
      </header>

      <section aria-labelledby="sop-start" className="grid gap-3 rounded-[var(--radius-md)] border border-border bg-surface p-4 sm:p-5">
        <h2 id="sop-start" className="flex items-center gap-2 text-[13px] font-semibold tracking-[0.06em] text-muted uppercase">
          <UserIcon size={16} weight="duotone" className="text-accent" /> {t("Who starts it")}
        </h2>
        <p className="text-[15.5px] leading-relaxed">{pick(sop.starter, lang)}</p>
        <div className="flex flex-wrap gap-2">
          {sop.start ? <OpenInPrima place={sop.start} primary /> : null}
          <Button asChild variant="outline" className="h-11 gap-2">
            <Link to="/prima" hash={`sop/${sop.id}`}>
              <FlowArrowIcon size={16} /> {t("Open this flow in Prima")}
            </Link>
          </Button>
        </div>
      </section>

      <section aria-labelledby="sop-steps" className="grid gap-4">
        <h2 id="sop-steps" className="flex items-center gap-2 text-[19px] font-semibold">
          <ListNumbersIcon size={20} weight="duotone" className="text-accent" /> {t("Steps")}
        </h2>
        <ol className="grid gap-0">
          {sop.steps.map((st, n) => (
            <li key={n} className="relative grid grid-cols-[auto_minmax(0,1fr)] gap-3.5 pb-6 last:pb-0">
              {n < sop.steps.length - 1 ? <span aria-hidden className="absolute top-9 bottom-1 left-[15px] w-px bg-border" /> : null}
              <span className="z-[1] grid size-8 place-items-center rounded-full bg-accent text-[13.5px] font-semibold text-accent-fg tabular">{n + 1}</span>
              <div className="grid min-w-0 gap-1.5 pt-1">
                <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="text-[15px] font-semibold break-words">{pick(st.who, lang)}</span>
                  {st.decision ? (
                    <Pill tone="accent" className="text-[11.5px]">
                      <SealCheckIcon size={13} weight="fill" /> {t("Approves or refuses")}
                    </Pill>
                  ) : null}
                  {st.outside ? <Pill className="text-[11.5px]">{t("Outside Prima")}</Pill> : null}
                </div>
                <p className="max-w-[66ch] text-[15px] leading-relaxed text-fg/90">{pick(st.does, lang)}</p>
                {st.where ? <OpenInPrima place={st.where} className="mt-1 h-10 w-fit text-[13.5px]" /> : null}
              </div>
            </li>
          ))}
        </ol>
      </section>

      {sop.rules.length ? (
        <section aria-labelledby="sop-rules" className="grid gap-3">
          <h2 id="sop-rules" className="flex items-center gap-2 text-[19px] font-semibold">
            <GavelIcon size={20} weight="duotone" className="text-accent" /> {t("Rules that always apply")}
          </h2>
          <ul className="grid gap-2">
            {sop.rules.map((r, n) => (
              <li key={n} className="flex min-w-0 items-start gap-2.5 text-[15px] leading-relaxed">
                <CheckCircleIcon size={18} weight="fill" className="mt-0.5 shrink-0 text-accent" />
                <span className="min-w-0">{pick(r, lang)}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <p className="flex items-start gap-2 text-[13px] text-muted">
        <SignpostIcon size={16} className="mt-0.5 shrink-0" />
        <span className="min-w-0 break-words">
          {t("Declared in {doc}", { doc: sop.source.doc })}
          {sop.source.decided ? ` · ${sop.source.decided}` : ""}
        </span>
      </p>

      {next ? (
        <Link
          to="/guide/$page"
          params={{ page: PRIMA_SOP_PAGE }}
          search={{ flow: next.id }}
          className="grid min-h-11 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-[var(--radius-md)] border border-border bg-surface px-4 py-3.5 transition-colors hover:border-accent/40"
        >
          <span className="grid min-w-0 gap-0.5">
            <span className="text-[12.5px] text-muted">{t("Next in {app}", { app: app ? pick(app, lang) : sop.app })}</span>
            <span className="text-[15px] font-medium break-words">{pick(next.title, lang)}</span>
          </span>
          <CaretRightIcon size={16} className="text-muted" />
        </Link>
      ) : null}
    </article>
  );
}

/** The chapter: the list, or one flow when ?flow= names one. */
export function PrimaSopChapter({ flow }: { flow?: string }) {
  const t = useT();
  const data = usePrimaSops();
  const sop = flow ? data?.sops.find((s) => s.id === flow) : undefined;

  return (
    <div className="mx-auto grid w-full max-w-[60rem] min-w-0 gap-8">
      {!data ? (
        <div className="grid gap-3" aria-busy>
          <Skeleton className="h-9 w-2/3" />
          <Skeleton className="h-5 w-full" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      ) : flow && !sop ? (
        <EmptyState
          icon={FlowArrowIcon}
          title={t("No Prima flow by that name")}
          body={t("It may have been renamed. Pick one from the list.")}
          action={
            <Button asChild variant="outline" className="h-11">
              <Link to="/guide/$page" params={{ page: PRIMA_SOP_PAGE }}>
                {t("All Prima flows")} <CaretRightIcon size={14} />
              </Link>
            </Button>
          }
        />
      ) : sop ? (
        <FlowDetail key={sop.id} sop={sop} data={data} />
      ) : (
        <>
          <header className="grid gap-4">
            <p className="text-[12px] font-semibold tracking-[0.08em] text-accent uppercase">Prima</p>
            <div className="flex min-w-0 items-start gap-4">
              <IconTile icon={FlowArrowIcon} size="lg" className="hidden sm:grid" />
              <div className="grid min-w-0 gap-2">
                <h1 className="text-[28px] leading-tight font-semibold tracking-tight text-balance sm:text-[34px]">{t("Prima SOP and workflows")}</h1>
                <p className="max-w-[62ch] text-[16px] leading-relaxed text-muted sm:text-[17px]">
                  {t("Every way work moves in Prima, written from Prima's own documents: who starts it, each step and who does it, and a button to the screen where it is done.")}
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[13px] text-muted">
              {(Object.keys(STATUS) as PrimaSopStatus[]).map((s) => (
                <span key={s} className="inline-flex items-center gap-1.5">
                  <StatusPill s={s} />
                  <span>{t(STATUS_HELP[s])}</span>
                </span>
              ))}
            </div>
            <Button asChild variant="outline" className="h-11 w-fit gap-2">
              <Link to="/prima" hash="sop">
                <ArrowSquareOutIcon size={16} /> {t("Open SOP and workflows in Prima")}
              </Link>
            </Button>
          </header>
          <FlowList data={data} />
        </>
      )}
    </div>
  );
}

const STATUS_HELP: Record<PrimaSopStatus, string> = {
  in_force: msg("in use now"),
  trial: msg("running as a trial"),
  off: msg("built, waiting for its owner to turn it on"),
  draft: msg("decided, not in use yet"),
};
