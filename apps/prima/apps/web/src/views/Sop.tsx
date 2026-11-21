import { useMemo, useState } from 'react';
import { ArrowLeftIcon, ArrowRightIcon, CaretRightIcon, CheckCircleIcon, FileTextIcon, MagnifyingGlassIcon, PlayIcon, SealCheckIcon, XIcon } from '@phosphor-icons/react';
import { useApp, type ViewName } from '../App';
import { useLang, type Lang } from '../i18n';
import { NAV_SECTIONS, fold, type NavSectionId } from '../nav-catalog';
import { PageHead } from '../kit';
import { SpaceIcon } from '../Spaces';
import { SOPS, sopById } from '../sop/catalog';
import type { Place, Sop, SopStatus, Text2 } from '../sop/types';
import { ProcessPanel } from './ProcessPage';
import '../styles/sop.css';

/**
 * P121 (Fitri, 21 Nov 2026): "add one more SOP and workflow page to show all workflows and SOPs that are declared
 * there". Every flow in sop/catalog.ts: who starts it, each step with who does it and a button to the screen where it
 * is done, the rules, and the document it comes from. Addresses: #sop (all), #sop/equip (one app), #sop/<id> (one flow),
 * #sop/rules (the rules register from Prima's own rules). Read only.
 */

const pick = (t: Text2, lang: Lang) => (lang === 'en' ? t.en : t.ms);

const STATUS: Record<SopStatus, { label: string; tone: string }> = {
  in_force: { label: 'In force', tone: 'ok' },
  trial: { label: 'Trial', tone: 'info' },
  off: { label: 'Switched off', tone: 'muted' },
  draft: { label: 'Not in force yet', tone: 'warn' },
};

const APPS = NAV_SECTIONS.filter((s) => !s.home);
/** On "All" with nothing typed: the first forms and the first flows of each app. */
const FORMS_SHOWN = 6;
const FLOWS_SHOWN = 3;
const appTitle = (id: NavSectionId) => NAV_SECTIONS.find((s) => s.id === id)?.title ?? id;

function StatusChip({ s }: { s: SopStatus }) {
  return (
    <span className="sop-status" data-tone={STATUS[s].tone}>
      {STATUS[s].label}
    </span>
  );
}

/** A button to a place in Prima, or a quiet note when the person does not have that screen. */
function PlaceButton({ place, primary }: { place: Place; primary?: boolean }) {
  const { go, canOpen } = useApp();
  const { lang } = useLang();
  if (!canOpen?.(place.view))
    return (
      <span className="sop-place-off">
        <span>Not in your menu:</span> <span data-no-translate>{pick(place.label, lang)}</span>
      </span>
    );
  return (
    <button type="button" className={primary ? 'btn btn-primary sop-go' : 'btn btn-sm sop-go'} onClick={() => go({ view: place.view, tab: place.tab })}>
      {primary ? <PlayIcon size={16} weight="fill" aria-hidden="true" /> : null}
      <span data-no-translate>{pick(place.label, lang)}</span>
      {!primary && <ArrowRightIcon size={14} aria-hidden="true" />}
    </button>
  );
}

function matches(s: Sop, q: string): boolean {
  const words = fold(q).split(' ').filter(Boolean);
  if (!words.length) return true;
  const hay = fold(
    [s.title.en, s.title.ms, s.purpose.en, s.purpose.ms, s.starter.en, s.starter.ms, s.words ?? '', appTitle(s.app), ...s.steps.flatMap((x) => [x.who.en, x.who.ms, x.does.en, x.does.ms])].join(' '),
  );
  return words.every((w) => hay.includes(w));
}

/** The whole guide: search, the app filter, the forms you can start, and the flows by app. */
function SopList({ app }: { app?: NavSectionId }) {
  const { go, canOpen } = useApp();
  const { lang } = useLang();
  const [q, setQ] = useState('');
  const [mine, setMine] = useState(false);
  const [allForms, setAllForms] = useState(false);
  // On "All" with nothing typed, each app shows its first few flows and a button to the rest (a long page on a phone).
  const short = !app && !q.trim();
  const shown = useMemo(
    () => SOPS.filter((s) => (!app || s.app === app) && matches(s, q) && (!mine || (s.start && canOpen?.(s.start.view)) || s.steps.some((x) => x.where && canOpen?.(x.where.view)))),
    [app, q, lang, mine, canOpen],
  );
  const startable = shown.filter((s) => s.start && canOpen?.(s.start.view));
  const byApp = APPS.map((a) => ({ a, list: shown.filter((s) => s.app === a.id) })).filter((g) => g.list.length);
  return (
    <>
      <div className="sop-tools">
        <label className="sop-search">
          <MagnifyingGlassIcon size={18} aria-hidden="true" />
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search: uniform, leave, claim, purchase…" aria-label="Search the SOPs" />
          {q && (
            <button type="button" className="sop-clear" aria-label="Clear" onClick={() => setQ('')}>
              <XIcon size={14} />
            </button>
          )}
        </label>
        <label className="sop-mine">
          <input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} />
          <span>Only the ones I take part in</span>
        </label>
      </div>
      <div className="sop-chips" role="tablist" aria-label="Apps">
        <button type="button" role="tab" aria-selected={!app} className="sop-chip" onClick={() => go({ view: 'sop' })}>
          All <span className="num">{SOPS.length}</span>
        </button>
        {APPS.map((a) => {
          const n = SOPS.filter((s) => s.app === a.id).length;
          if (!n) return null;
          return (
            <button key={a.id} type="button" role="tab" aria-selected={app === a.id} className="sop-chip" onClick={() => go({ view: 'sop', tab: a.id })}>
              {a.title} <span className="num">{n}</span>
            </button>
          );
        })}
        <button type="button" className="sop-chip" data-rules onClick={() => go({ view: 'sop', tab: 'rules' })}>
          Rules register
        </button>
      </div>

      {startable.length > 0 && !q && (
        <section className="sop-section" aria-labelledby="sop-start">
          <h2 id="sop-start">Forms you can start</h2>
          <ul className="sop-start-grid">
            {(allForms || !short ? startable : startable.slice(0, FORMS_SHOWN)).map((s) => (
              <li key={s.id}>
                <button type="button" className="sop-start" onClick={() => go({ view: s.start!.view, tab: s.start!.tab })}>
                  <SpaceIcon id={s.app} size="sm" />
                  <span className="sop-start-text">
                    <strong data-no-translate>{pick(s.start!.label, lang)}</strong>
                    <span className="muted small" data-no-translate>
                      {pick(s.title, lang)}
                    </span>
                  </span>
                  <ArrowRightIcon size={16} aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
          {short && !allForms && startable.length > FORMS_SHOWN && (
            <button type="button" className="btn btn-sm sop-more" onClick={() => setAllForms(true)}>
              <span>Show all</span> <span className="num">{startable.length}</span> <span>forms</span>
            </button>
          )}
        </section>
      )}

      {byApp.length === 0 && (
        <div className="sop-empty">
          <p>No SOP matches that.</p>
          {q && (
            <button type="button" className="btn btn-sm" onClick={() => setQ('')}>
              Clear the search
            </button>
          )}
        </div>
      )}
      {byApp.map(({ a, list }) => (
        <section key={a.id} className="sop-section" aria-label={a.title}>
          <div className="sop-section-head">
            <SpaceIcon id={a.id} size="sm" />
            <h2>{a.title}</h2>
            <span className="num muted">{list.length}</span>
          </div>
          <ul className="sop-cards">
            {(short ? list.slice(0, FLOWS_SHOWN) : list).map((s) => (
              <li key={s.id}>
                <button type="button" className="sop-card" onClick={() => go({ view: 'sop', tab: s.id })}>
                  <span className="sop-card-top">
                    <strong className="sop-card-title" data-no-translate>
                      {pick(s.title, lang)}
                    </strong>
                    <StatusChip s={s.status} />
                  </span>
                  <span className="sop-card-purpose" data-no-translate>
                    {pick(s.purpose, lang)}
                  </span>
                  <span className="sop-card-meta">
                    <span className="sop-card-steps">
                      <span className="num">{s.steps.length}</span> <span>steps</span>
                    </span>
                    <span className="sop-card-starter" data-no-translate>
                      {pick(s.starter, lang)}
                    </span>
                  </span>
                  <CaretRightIcon className="sop-card-go" size={16} aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
          {short && list.length > FLOWS_SHOWN && (
            <button type="button" className="btn btn-sm sop-more" onClick={() => go({ view: 'sop', tab: a.id })}>
              <span>See all</span> <span className="num">{list.length}</span> <ArrowRightIcon size={14} aria-hidden="true" />
            </button>
          )}
        </section>
      ))}
    </>
  );
}

/** One flow: the start button, the steps as a timeline, the rules and where it was declared. */
function SopDetail({ sop }: { sop: Sop }) {
  const { go } = useApp();
  const { lang } = useLang();
  return (
    <article className="sop-detail">
      <button type="button" className="sp-back-link" onClick={() => go({ view: 'sop', tab: sop.app })}>
        <ArrowLeftIcon size={16} aria-hidden="true" /> <span>All SOPs:</span> <span>{appTitle(sop.app)}</span>
      </button>
      <header className="sop-detail-head">
        <SpaceIcon id={sop.app} size="lg" />
        <div>
          <h1 data-no-translate>{pick(sop.title, lang)}</h1>
          <p className="sop-detail-purpose" data-no-translate>
            {pick(sop.purpose, lang)}
          </p>
          <div className="sop-detail-tags">
            <StatusChip s={sop.status} />
            {sop.statusNote && (
              <span className="muted small" data-no-translate>
                {pick(sop.statusNote, lang)}
              </span>
            )}
          </div>
        </div>
      </header>

      <div className="sop-who">
        <span className="sop-who-label">Who starts it</span>
        <span data-no-translate>{pick(sop.starter, lang)}</span>
        {sop.start && <PlaceButton place={sop.start} primary />}
      </div>

      <section className="sop-section" aria-labelledby="sop-steps">
        <h2 id="sop-steps">Steps</h2>
        <ol className="sop-steps">
          {sop.steps.map((st, i) => (
            <li key={i} className="sop-step" data-decision={st.decision || undefined}>
              <span className="sop-step-n num" aria-hidden="true">
                {i + 1}
              </span>
              <div className="sop-step-body">
                <div className="sop-step-who">
                  <span className="sop-role" data-no-translate>
                    {pick(st.who, lang)}
                  </span>
                  {st.decision && (
                    <span className="sop-tag" data-tone="decision">
                      <SealCheckIcon size={13} aria-hidden="true" /> Approves or refuses
                    </span>
                  )}
                  {st.outside && <span className="sop-tag">Outside Prima</span>}
                </div>
                <p className="sop-step-does" data-no-translate>
                  {pick(st.does, lang)}
                </p>
                {st.where && <PlaceButton place={st.where} />}
              </div>
            </li>
          ))}
        </ol>
      </section>

      {sop.rules.length > 0 && (
        <section className="sop-section sop-rules" aria-labelledby="sop-rules">
          <h2 id="sop-rules">Rules that always apply</h2>
          <ul>
            {sop.rules.map((r, i) => (
              <li key={i}>
                <CheckCircleIcon size={16} weight="fill" aria-hidden="true" />
                <span data-no-translate>{pick(r, lang)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <p className="sop-source muted small">
        <FileTextIcon size={14} aria-hidden="true" /> <span>Declared in</span>{' '}
        <span className="mono" data-no-translate>
          {sop.source.doc}
        </span>
        {sop.source.decided && (
          <>
            {' · '}
            <span data-no-translate>{sop.source.decided}</span>
          </>
        )}
      </p>
    </article>
  );
}

export function SopView() {
  const { route, go } = useApp();
  const tab = route?.tab;
  const sop = tab ? sopById(tab) : undefined;
  const app = tab && APPS.some((a) => a.id === tab) ? (tab as NavSectionId) : undefined;
  if (sop)
    return (
      <div className="page sop-page">
        <SopDetail sop={sop} />
      </div>
    );
  return (
    <div className="page sop-page">
      <PageHead title="SOP and workflows" sub="How work is done in Prima: who does each step, where to do it, and the rules. As decided by the CEO." />
      {tab === 'rules' ? (
        <>
          <button type="button" className="sp-back-link" onClick={() => go({ view: 'sop' })}>
            <ArrowLeftIcon size={16} aria-hidden="true" /> All SOPs
          </button>
          <ProcessPanel />
        </>
      ) : (
        <SopList app={app} />
      )}
    </div>
  );
}

/** P121: on an app's own page, that app's flows (up to six) with a link to the rest. */
export function SpaceSops({ id }: { id: string }) {
  const { go, canOpen } = useApp();
  const { lang } = useLang();
  if (!canOpen?.('sop')) return null;
  const list = SOPS.filter((s) => s.app === id);
  if (!list.length) return null;
  return (
    <section className="home-section sop-space" aria-labelledby={`sop-space-${id}`}>
      <div className="home-section-head">
        <h2 id={`sop-space-${id}`}>How work flows here</h2>
        <button type="button" className="btn btn-sm" onClick={() => go({ view: 'sop', tab: id })}>
          <span>All</span> <span className="num">{list.length}</span>
        </button>
      </div>
      <ul className="sop-mini">
        {list.slice(0, 6).map((s) => (
          <li key={s.id} className="sop-mini-item">
            <button type="button" className="sop-mini-row" onClick={() => go({ view: 'sop', tab: s.id })}>
              <span className="sop-mini-text">
                <strong data-no-translate>{pick(s.title, lang)}</strong>
                <span className="muted small" data-no-translate>
                  {pick(s.starter, lang)}
                </span>
              </span>
              <CaretRightIcon size={14} aria-hidden="true" />
            </button>
            {s.start && canOpen?.(s.start.view) && (
              <button type="button" className="sop-mini-start" onClick={() => go({ view: s.start!.view as ViewName, tab: s.start!.tab })}>
                <PlayIcon size={12} weight="fill" aria-hidden="true" /> <span>Start</span>
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
