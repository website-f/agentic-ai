import { useRef, useState } from 'react';
import { api, type ItBoard, type ItPlan } from '../api';
import { LANG_RULE, Rich, sampleProblem, useSample } from '../Arisha';
import { useLang } from '../i18n';
import { Chip, ErrorNotice, Kpi, Loading, dateLabel, useLoad } from '../ui';
import { GiveJob, type JobPreset } from './ItWork';

/**
 * The IT team's work plan (Fauzan, 28 Oct 2026): the IT Manager makes sure the team's work is planned properly for the
 * whole week, month and year, and Arisha helps the manager plan. Arisha only suggests; the manager gives each job.
 */

type Span = ItPlan['span'];
type Due = ItPlan['dues'][number];

const WHAT: Record<Due['what'], string> = {
  service: 'Service',
  check: 'Six-month health inspection',
  domain: 'Domain',
  ssl: 'Certificate',
  access: 'Access review',
  tender: 'Tender',
};

export function ItPlanView({ board }: { board: ItBoard }) {
  const [span, setSpan] = useState<Span>('week');
  const [from, setFrom] = useState<string | undefined>(undefined);
  const { data, error } = useLoad(() => api.itPlan(span, from), [span, from]);
  const [giving, setGiving] = useState<Due | null>(null);
  const [show, setShow] = useState<'open' | 'all'>('open');
  if (error) return <ErrorNotice error={error} />;
  if (!data) return <Loading what="the plan" />;
  const open = data.dues.filter((d) => !d.jobId);
  const shown = show === 'open' ? open : data.dues;
  const r = data.readiness;
  const bucketOf = (d: string) => data.buckets.findIndex((b) => d >= b.from && d <= b.to);
  return (
    <section className="panel">
      <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 8 }}>
        <div className="seg">
          {(
            [
              ['week', 'Week'],
              ['month', 'Month'],
              ['year', 'Year'],
            ] as const
          ).map(([k, l]) => (
            <button
              key={k}
              aria-pressed={span === k}
              onClick={() => {
                setSpan(k);
                setFrom(undefined);
              }}
            >
              {l}
            </button>
          ))}
        </div>
        <button className="btn btn-sm" onClick={() => setFrom(data.prev)} aria-label="Earlier">
          ‹
        </button>
        <strong>{data.title}</strong>
        <button className="btn btn-sm" onClick={() => setFrom(data.next)} aria-label="Later">
          ›
        </button>
        {from && (
          <button className="btn btn-sm btn-ghost" onClick={() => setFrom(undefined)}>
            Today
          </button>
        )}
      </div>
      <p className="muted small">
        The regular work comes from the registers: servicing every 6 months, yearly asset checks, domain and certificate renewals, access reviews every 90 days and
        tender closing dates. {data.canPlan ? 'Give each piece to someone as a job with a due date.' : 'The IT Manager gives each piece to someone as a job.'}
      </p>
      <div className="kpis">
        <Kpi label="Regular work due" value={data.dues.length} />
        <Kpi label="Not given to anyone" value={open.length} tone={open.length ? 'warn' : 'ok'} />
        <Kpi label="Overdue, not given" value={open.filter((d) => d.overdue).length} tone={open.some((d) => d.overdue) ? 'crit' : 'ok'} />
        <Kpi label="Jobs due in this period" value={data.jobs.length} />
      </div>
      <p className="notice" data-tone={r.notGiven ? 'warn' : 'ok'}>
        {r.notGiven
          ? `${r.nextTitle}: ${r.notGiven} of ${r.due} pieces of regular work not given yet.`
          : `${r.nextTitle}: all ${r.due} pieces of regular work are given.`}
      </p>

      <h3>Who has what</h3>
      <div style={{ overflowX: 'auto' }}>
        <table className="table">
          <thead>
            <tr>
              <th>Person</th>
              {data.buckets.map((b) => (
                <th key={b.from} className="num">
                  {data.span === 'year' ? b.label.slice(0, 3) : b.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.load.map((p) => (
              <tr key={p.id}>
                <td>{p.name}</td>
                {p.cells.map((c, i) => (
                  <td key={i} className="num" title={c.over ? 'Too much planned' : c.empty ? 'Nothing planned' : undefined}>
                    {c.over ? <Chip tone="crit">{c.jobs}</Chip> : c.empty ? <Chip tone="warn">0</Chip> : c.jobs || '–'}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted small">
        Jobs due in each {data.span === 'week' ? 'day' : data.span === 'month' ? 'week' : 'month'}. There is no fixed limit: plan what the work needs. A week or
        month ahead with nothing planned is flagged.
      </p>

      {data.canPlan && <PlanHelper data={data} />}

      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', marginTop: 12 }}>
        <h3 style={{ margin: 0 }}>Regular work</h3>
        <div className="seg">
          <button aria-pressed={show === 'open'} onClick={() => setShow('open')}>
            Not given ({open.length})
          </button>
          <button aria-pressed={show === 'all'} onClick={() => setShow('all')}>
            All ({data.dues.length})
          </button>
        </div>
      </div>
      <div className="list">
        {shown.length === 0 && <div className="empty">Everything in this period is given to someone.</div>}
        {data.buckets.map((b, i) => {
          const items = shown.filter((d) => bucketOf(d.dueOn) === i);
          if (!items.length) return null;
          return (
            <div key={b.from}>
              <div className="label" style={{ margin: '8px 0 4px' }}>
                {b.label}
              </div>
              {items.map((d) => (
                <div key={d.key} className="list-item" style={{ alignItems: 'flex-start' }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 600 }}>{d.title}</div>
                    <div className="muted small">
                      {WHAT[d.what]} · due {dateLabel(d.dueOn)} · {d.detail}
                    </div>
                    {giving?.key === d.key && (
                      <div style={{ marginTop: 6 }}>
                        <GiveJob
                          data={board}
                          preset={{ kind: d.jobKind, title: d.title, detail: d.detail, dueOn: d.dueOn, technical: d.technical, planKey: d.key } as JobPreset}
                          onDone={() => setGiving(null)}
                        />
                      </div>
                    )}
                  </div>
                  <div className="row" style={{ gap: 4, flexShrink: 0 }}>
                    {d.overdue && <Chip tone="crit">Overdue</Chip>}
                    {d.jobId ? (
                      <Chip tone="ok">{d.assignee}</Chip>
                    ) : d.what === 'tender' ? (
                      <Chip tone="warn">No owner</Chip>
                    ) : data.canPlan ? (
                      <button className="btn btn-sm btn-primary" onClick={() => setGiving(giving?.key === d.key ? null : d)}>
                        {giving?.key === d.key ? 'Cancel' : 'Plan it'}
                      </button>
                    ) : (
                      <Chip tone="warn">Not given</Chip>
                    )}
                  </div>
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </section>
  );
}

/** Arisha suggests who could do what and when. The IT Manager decides and gives each job with "Plan it". */
function PlanHelper({ data }: { data: ItPlan }) {
  const sample = useSample();
  const { lang } = useLang();
  const [text, setText] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  if (sample === undefined) return null;
  const suggest = async () => {
    if (!sample || busy) return;
    setBusy(true);
    setProblem(null);
    setText('');
    const ctrl = new AbortController();
    abort.current = ctrl;
    const open = data.dues.filter((d) => !d.jobId && d.what !== 'tender').slice(0, 60);
    const people = data.team.filter((p) => p.itRole !== 'manager');
    const load = data.load.map((p) => `${p.name} (${p.itRole}): ${p.cells.map((c, i) => `${data.buckets[i].label}=${c.jobs}`).join(', ')}`).join('\n');
    const prompt = `You are Arisha, the AI assistant inside Prima Secure. You help the IT Manager plan the IT team's work for ${data.title}. You only suggest: the IT Manager decides and gives each job with the "Plan it" button. Never say a job is given.
Rules: the IT Manager is a supervisor and gets no technical jobs; technical work (servicing, checks, renewals) suits the IT Lead and the IT Executives; the IT Lead also checks technical jobs, so give the IT Lead less; spread the work evenly, with no fixed limit per person, as the work needs; overdue work first; renewals well before the expiry date; keep the same company's work with the same person where it makes sense; leave room for help requests that come in every day.
${LANG_RULE[lang]}
Answer with a short numbered list, one line per piece of work: the work, the person suggested, the date suggested, and a few words why. Then one or two lines on anyone with too much or too little. Do not invent people or work.

TEAM (excluding the IT Manager): ${people.map((p) => `${p.name} (${p.itRole})`).join(', ')}
JOBS ALREADY DUE PER PERSON:
${load}
TODAY: ${data.today}
WORK NOT GIVEN YET (${open.length}${data.dues.filter((d) => !d.jobId).length > open.length ? ', first 60' : ''}):
${open.map((d, i) => `${i + 1}. ${d.title} | due ${d.dueOn}${d.overdue ? ' OVERDUE' : ''} | ${d.technical ? 'technical' : 'not technical'}`).join('\n') || '(none)'}`;
    try {
      const r = await sample(prompt, { onText: ({ text }) => setText(text), signal: ctrl.signal, modelTier: 'default', cache: false });
      setText(r.text);
    } catch (e) {
      if (!ctrl.signal.aborted) setProblem(sampleProblem(e, lang));
    } finally {
      abort.current = null;
      setBusy(false);
    }
  };
  return (
    <div className="panel" style={{ marginTop: 10, background: 'var(--surface-2)' }}>
      <div className="row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <strong>Arisha can suggest a plan</strong>
        <span className="muted small">She suggests; you decide and give each job.</span>
        <span style={{ flex: 1 }} />
        {busy ? (
          <button className="btn btn-sm" onClick={() => abort.current?.abort()}>
            Stop
          </button>
        ) : (
          <button className="btn btn-sm btn-primary" onClick={suggest} disabled={!sample}>
            Suggest a plan
          </button>
        )}
      </div>
      {!sample && <p className="muted small">Arisha is not connected here. In the test link she runs on Claude.</p>}
      {text !== null && (
        <div style={{ marginTop: 8 }} data-no-translate>
          {text ? <Rich text={text} /> : <span className="muted">Thinking…</span>}
        </div>
      )}
      {problem && <p className="notice" data-tone="warn">{problem}</p>}
    </div>
  );
}
