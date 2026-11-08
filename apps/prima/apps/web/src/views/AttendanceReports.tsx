// P81: the group's past attendance, from the InfoTech monthly PDF reports. HR, the company manager and the owner
// import the reports (several PDFs at once: sent in pieces with a progress bar, read on the server page by page, shown
// as a preview, then saved). Everyone who sees a company's pay sees its months: tiles, the monthly trend, company and
// department breakdowns, who is often late, and each person's month as a calendar.
import { Select } from '../SearchSelect';
import { useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import {
  ArrowsClockwiseIcon,
  CalendarCheckIcon,
  ClockCountdownIcon,
  CoinsIcon,
  FilePdfIcon,
  FileXlsIcon,
  HourglassMediumIcon,
  SignOutIcon,
  UploadSimpleIcon,
  UserMinusIcon,
  UserSwitchIcon,
} from '@phosphor-icons/react';
import { ATTENDANCE_CHECK_LABEL, attendanceFromTable, cleanGrid, parseCsv, readXlsx, reasonLabel, timesheetColumns, type AttendanceCheckKind } from '@prima/core';
import { api } from '../api';
import type {
  AttendanceOverviewView,
  AttendancePersonView,
  AttendancePreview,
  AttendanceStaffHit,
  AttendanceUnmatched,
  AttendanceUploadView,
} from '../api/attendance-reports';
import { Card, Empty, Person, Search, Stat, Stats, Toolbar } from '../kit';
import { Chip, Drawer, ErrorNotice, Loading, RefreshContext, dateLabel, dateTimeLabel, useLoad } from '../ui';
import '../styles/attendance-reports.css';

const client = api.attendanceReports;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const FULL_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const monthLabel = (m: string, full = false) => `${(full ? FULL_MONTHS : MONTHS)[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;
const nf = (v: number, d = 0) => v.toLocaleString('en-MY', { minimumFractionDigits: d, maximumFractionDigits: d });
const rm = (v: number) => `RM ${nf(v, 2)}`;
const hm = (min: number) => (min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')} min`);
const otSum = (ot: number[]) => ot.reduce((a, b) => a + b, 0);
const RATES = ['1.0', '1.5', '2.0', '3.0'];

/** What each letter of a month strip means (core attendanceStrip). */
const KIND: Record<string, { label: string; k: string }> = {
  P: { label: 'Present', k: 'present' },
  L: { label: 'Late', k: 'late' },
  E: { label: 'Left early', k: 'early' },
  A: { label: 'Absent', k: 'absent' },
  R: { label: 'Rest day', k: 'rest' },
  V: { label: 'Leave', k: 'leave' },
  H: { label: 'Public holiday', k: 'holiday' },
  '.': { label: 'Nothing on the report', k: 'none' },
};

function useDebounced<T>(v: T, ms: number): T {
  const [d, setD] = useState(v);
  useEffect(() => {
    const t = setTimeout(() => setD(v), ms);
    return () => clearTimeout(t);
  }, [v, ms]);
  return d;
}

/** The width of an element, kept up to date (charts draw to it). */
function useWidth<T extends HTMLElement>(): [RefObject<T>, number] {
  const ref = useRef<T>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    setW(el.clientWidth);
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

// ---------------------------------------------------------------- the screen

export function AttendanceReports({ compact = false }: { compact?: boolean }) {
  const [month, setMonth] = useState<string | null>(null);
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [department, setDepartment] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const query = useDebounced(q, 300);
  const [importing, setImporting] = useState(false);
  const [matching, setMatching] = useState(false);
  const [open, setOpen] = useState<{ importId: string; key: string } | null>(null);
  const { data, error, loading } = useLoad(
    () => (client ? client.overview({ month, companyId, department, q: query }) : Promise.resolve(null)),
    [month, companyId, department, query],
  );

  if (!client)
    return (
      <Empty title="Attendance reports are kept on the server">
        The preview has no imported reports. Open Prima from the office to import and see them.
      </Empty>
    );

  const o = data;
  return (
    <div className="ar" data-compact={compact || undefined}>
      <Toolbar
        end={
          o && (
            <>
              {o.unmatched > 0 && o.canImport && (
                <button type="button" className="btn btn-sm" onClick={() => setMatching(true)}>
                  <UserSwitchIcon size={16} /> Match to staff <span className="ar-count">{o.unmatched}</span>
                </button>
              )}
              {o.canImport && (
                <button type="button" className="btn btn-primary btn-sm" onClick={() => setImporting(true)}>
                  <UploadSimpleIcon size={16} /> Import timesheet (PDF, Excel, CSV)
                </button>
              )}
            </>
          )
        }
      >
        {o && o.months.length > 0 && (
          <>
            <Select className="select" aria-label="Month" value={o.month ?? ''} onChange={(e) => setMonth(e.target.value || null)}>
              {o.months.map((m) => (
                <option key={m} value={m}>
                  {monthLabel(m, true)}
                </option>
              ))}
            </Select>
            <Select className="select" aria-label="Company" value={companyId ?? ''} onChange={(e) => (setCompanyId(e.target.value || null), setDepartment(null))}>
              <option value="">All companies</option>
              {o.companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
            <Select className="select" aria-label="Department" value={department ?? ''} onChange={(e) => setDepartment(e.target.value || null)}>
              <option value="">All departments</option>
              {o.departments.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </Select>
            <Search value={q} onChange={setQ} placeholder="Search name or staff no" />
          </>
        )}
      </Toolbar>

      {error && <ErrorNotice error={error} />}
      {!o && !error && <Loading what="attendance reports" />}
      {o && o.months.length === 0 && (
        <Card>
          <Empty
            title="No attendance reports yet"
            action={
              o.canImport ? (
                <button type="button" className="btn btn-primary" onClick={() => setImporting(true)}>
                  <UploadSimpleIcon size={16} /> Import timesheet (PDF, Excel, CSV)
                </button>
              ) : undefined
            }
          >
            {o.canImport
              ? 'Import the monthly "Individual Attendance Report" PDFs from the old attendance system, or a timesheet exported to Excel or CSV. Each month shows here once saved.'
              : 'HR, the company manager or the owner imports the monthly attendance reports. Nothing has been imported for the companies you see.'}
          </Empty>
        </Card>
      )}
      {o && o.months.length > 0 && <Dashboard o={o} busy={loading} compact={compact} onOpen={setOpen} />}

      {importing && <ImportDrawer onClose={() => setImporting(false)} />}
      {matching && <MatchDrawer onClose={() => setMatching(false)} />}
      {open && <PersonDrawer importId={open.importId} k={open.key} onClose={() => setOpen(null)} />}
    </div>
  );
}

function Dashboard({ o, busy, compact, onOpen }: { o: AttendanceOverviewView; busy: boolean; compact: boolean; onOpen: (x: { importId: string; key: string }) => void }) {
  const k = o.kpi;
  const [shown, setShown] = useState(60);
  const ot = otSum(k.ot);
  return (
    <div className="ar-dash" data-busy={busy || undefined}>
      <Stats>
        <Stat label="Present days" value={nf(k.present)} icon={<CalendarCheckIcon size={16} />} tone="ok" note={`${nf(k.employees)} people · ${o.month ? monthLabel(o.month) : ''}`} />
        <Stat label="Late" value={nf(k.lateCount)} icon={<ClockCountdownIcon size={16} />} tone={k.lateCount ? 'warn' : 'ok'} note={k.lateMin ? `${hm(k.lateMin)} in all` : 'Nobody late'} />
        <Stat label="Early outs" value={nf(k.earlyCount)} icon={<SignOutIcon size={16} />} tone={k.earlyCount ? 'warn' : 'ok'} note={k.earlyMin ? `${hm(k.earlyMin)} in all` : undefined} />
        <Stat
          label="Overtime hours"
          value={nf(ot, 1)}
          icon={<HourglassMediumIcon size={16} />}
          tone="info"
          note={k.ot.map((h, i) => `${RATES[i]}×: ${nf(h, 1)}`).join(' · ')}
        />
        <Stat label="Absences" value={nf(k.absent)} icon={<UserMinusIcon size={16} />} tone={k.absent ? 'crit' : 'ok'} note={k.leave ? `${nf(k.leave)} leave days besides` : undefined} />
        <Stat
          label="Allowances"
          value={rm(k.allowances)}
          icon={<CoinsIcon size={16} />}
          tone="neutral"
          note={`Day rows ${rm(k.dayAllowances)} · monthly ${rm(k.monthlyAllowances)}${k.noMonthlyBlock ? ` · ${k.noMonthlyBlock} without a monthly block` : ''}`}
        />
      </Stats>

      <div className="ar-grid">
        <Card title="Month by month" sub={o.filters.companyId || o.filters.department || o.filters.q ? 'For the filters chosen' : 'Every company you see'}>
          <TrendCharts trend={o.trend} current={o.month} />
        </Card>
        <Card title="Who is often late" sub={o.month ? monthLabel(o.month, true) : undefined} flush>
          {o.oftenLate.length === 0 ? (
            <div className="empty">Nobody was late this month.</div>
          ) : (
            <ol className="ar-late">
              {o.oftenLate.slice(0, compact ? 6 : 15).map((r, i) => (
                <li key={r.importId + r.key} style={{ ['--i' as string]: i }}>
                  <button type="button" className="ar-late-row" onClick={() => onOpen({ importId: r.importId, key: r.key })}>
                    <Person name={r.personName ?? r.name} size={30} sub={<span className="muted">{r.companyName}</span>} />
                    <span className="ar-late-n">
                      <strong>{r.totals.lateCount}×</strong>
                      <span className="muted small">{hm(r.totals.lateMin)}</span>
                    </span>
                    <Strip strip={r.strip} />
                  </button>
                </li>
              ))}
            </ol>
          )}
        </Card>
      </div>

      {!compact && (
        <div className="ar-grid ar-grid-even">
          <Card title="By company" flush>
            <Breakdown rows={o.byCompany.map((c) => ({ key: c.id, name: c.name, kpi: c }))} />
          </Card>
          <Card title="By department" sub="The staff record's department, else the designation on the report" flush>
            <Breakdown rows={o.byDepartment.map((d) => ({ key: d.name, name: d.name, kpi: d }))} />
          </Card>
        </div>
      )}

      <Card
        title="Everyone this month"
        sub={`${o.rows.length} ${o.rows.length === 1 ? 'person' : 'people'} · select one for their calendar`}
        actions={<Legend />}
        flush
      >
        {o.rows.length === 0 ? (
          <div className="empty">Nobody matches these filters.</div>
        ) : (
          <div className="table-wrap ar-table">
            <table>
              <thead>
                <tr>
                  <th>Person</th>
                  <th className="hide-sm">Month</th>
                  <th className="num">Present</th>
                  <th className="num">Late</th>
                  <th className="num hide-sm">Absent</th>
                  <th className="num hide-sm">OT h</th>
                  <th className="num hide-sm">Allowances</th>
                </tr>
              </thead>
              <tbody>
                {o.rows.slice(0, shown).map((r) => (
                  <tr key={r.importId + r.key} className="clickable" onClick={() => onOpen({ importId: r.importId, key: r.key })}>
                    <td>
                      <button type="button" className="ar-who" onClick={(e) => (e.stopPropagation(), onOpen({ importId: r.importId, key: r.key }))}>
                        <Person
                          name={r.personName ?? r.name}
                          size={30}
                          sub={
                            <>
                              {r.empCode && <span className="mono">{r.empCode}</span>}
                              {r.empCode && ' · '}
                              {r.department}
                              {!r.personId && (
                                <>
                                  {' · '}
                                  <span className="ar-unmatched">not matched</span>
                                </>
                              )}
                            </>
                          }
                        />
                      </button>
                    </td>
                    <td className="hide-sm ar-strip-cell">
                      <Strip strip={r.strip} />
                    </td>
                    <td className="num">{r.totals.present}</td>
                    <td className="num" data-tone={r.totals.lateCount ? 'warn' : undefined}>
                      {r.totals.lateCount}
                    </td>
                    <td className="num hide-sm" data-tone={r.totals.absent ? 'crit' : undefined}>
                      {r.totals.absent}
                    </td>
                    <td className="num hide-sm">{nf(otSum(r.totals.ot), 1)}</td>
                    <td className="num hide-sm">{nf(r.allowances, 2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {o.rows.length > shown && (
              <div className="ar-more">
                <button type="button" className="btn btn-sm" onClick={() => setShown((n) => n + 120)}>
                  Show more ({o.rows.length - shown} left)
                </button>
              </div>
            )}
          </div>
        )}
      </Card>

      {!compact && <ImportsCard imports={o.imports} />}
    </div>
  );
}

function ImportsCard({ imports }: { imports: AttendanceOverviewView['imports'] }) {
  if (!imports.length) return null;
  return (
    <Card title="Reports this month" sub="Each saved file, with any pages the reader could not read" flush>
      <div className="list">
        {imports.map((i) => (
          <details key={i.id} className="list-item ar-import">
            <summary>
              <FilePdfIcon size={18} aria-hidden="true" />
              <span className="ar-import-main">
                <strong>{i.fileName}</strong>
                <span className="muted small">
                  {i.companyName} · {i.counts.employees} people, {nf(i.counts.days)} days · {i.counts.matched} matched · by {i.by}, {dateTimeLabel(i.at)}
                </span>
              </span>
              {i.counts.unreadablePages > 0 ? <Chip tone="warn">{i.counts.unreadablePages} pages unreadable</Chip> : <Chip tone="ok">Every page read</Chip>}
            </summary>
            {i.unreadable.length > 0 && (
              <ul className="ar-pages">
                {i.unreadable.map((u) => (
                  <li key={u.page}>
                    <span className="mono">Page {u.page}</span> {u.reason}
                  </li>
                ))}
              </ul>
            )}
          </details>
        ))}
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------- small pieces

/** A month as a row of small cells, one per day. */
function Strip({ strip, big = false }: { strip: string; big?: boolean }) {
  return (
    <span className="ar-strip" data-big={big || undefined} role="img" aria-label={stripSummary(strip)}>
      {[...strip].map((c, i) => (
        <span key={i} className="ar-cell" data-k={KIND[c]?.k ?? 'none'} title={`${i + 1}: ${KIND[c]?.label ?? ''}`} />
      ))}
    </span>
  );
}

function stripSummary(strip: string): string {
  const n = (c: string) => [...strip].filter((x) => x === c).length;
  return `Present ${n('P') + n('L') + n('E')} days, late ${n('L')}, absent ${n('A')}, leave ${n('V')}`;
}

function Legend() {
  return (
    <span className="ar-legend" aria-hidden="true">
      {['P', 'L', 'E', 'A', 'V', 'R', 'H'].map((c) => (
        <span key={c}>
          <span className="ar-cell" data-k={KIND[c].k} /> {KIND[c].label}
        </span>
      ))}
    </span>
  );
}

function Breakdown({ rows }: { rows: { key: string; name: string; kpi: AttendanceOverviewView['kpi'] }[] }) {
  const most = Math.max(1, ...rows.map((r) => r.kpi.lateCount + r.kpi.absent));
  if (!rows.length) return <div className="empty">Nothing this month.</div>;
  return (
    <ul className="ar-break">
      {rows.slice(0, 30).map((r, i) => (
        <li key={r.key} style={{ ['--i' as string]: i }}>
          <span className="ar-break-name">
            <strong>{r.name}</strong>
            <span className="muted small">
              {r.kpi.employees} people · {nf(r.kpi.present)} present days · {nf(otSum(r.kpi.ot), 1)} OT h
            </span>
          </span>
          <span className="ar-break-bar" title={`${r.kpi.lateCount} late, ${r.kpi.absent} absent`}>
            <span className="ar-bar" data-k="late" style={{ ['--w' as string]: `${(r.kpi.lateCount / most) * 100}%` }} />
            <span className="ar-bar" data-k="absent" style={{ ['--w' as string]: `${(r.kpi.absent / most) * 100}%` }} />
          </span>
          <span className="ar-break-n small">
            <span>{r.kpi.lateCount} late</span>
            <span>{r.kpi.absent} absent</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------- charts (plain SVG)

type Metric = 'late' | 'absent' | 'present' | 'ot';
const METRIC: Record<Metric, { label: string; of: (t: AttendanceOverviewView['trend'][number]) => number; unit: string; tone: string }> = {
  late: { label: 'Late', of: (t) => t.lateCount, unit: 'times', tone: 'warn' },
  absent: { label: 'Absences', of: (t) => t.absent, unit: 'days', tone: 'crit' },
  present: { label: 'Present days', of: (t) => t.present, unit: 'days', tone: 'ok' },
  ot: { label: 'Overtime', of: (t) => otSum(t.ot), unit: 'hours', tone: 'accent' },
};

function TrendCharts({ trend, current }: { trend: AttendanceOverviewView['trend']; current: string | null }) {
  const [m, setM] = useState<Metric>('late');
  return (
    <div className="ar-trend">
      <div className="seg" role="group" aria-label="What to show">
        {(Object.keys(METRIC) as Metric[]).map((x) => (
          <button key={x} type="button" aria-pressed={m === x} onClick={() => setM(x)}>
            {METRIC[x].label}
          </button>
        ))}
      </div>
      {m === 'ot' ? <OtBars trend={trend} current={current} /> : <LineChart trend={trend} metric={m} current={current} />}
    </div>
  );
}

const H = 190;
const PAD = { l: 40, r: 12, t: 14, b: 26 };

function niceMax(v: number): number {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  return [1, 2, 2.5, 5, 10].map((s) => s * p).find((s) => s >= v) ?? v;
}

function LineChart({ trend, metric, current }: { trend: AttendanceOverviewView['trend']; metric: Metric; current: string | null }) {
  const [ref, w] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const spec = METRIC[metric];
  const vals = trend.map(spec.of);
  const max = niceMax(Math.max(...vals, 0));
  const iw = Math.max(10, w - PAD.l - PAD.r);
  const x = (i: number) => PAD.l + (trend.length === 1 ? iw / 2 : (i / (trend.length - 1)) * iw);
  const y = (v: number) => PAD.t + (1 - v / max) * (H - PAD.t - PAD.b);
  const line = vals.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const area = `${line} L${x(vals.length - 1).toFixed(1)},${y(0)} L${x(0).toFixed(1)},${y(0)} Z`;
  const ticks = [0, max / 2, max];
  const hi = hover ?? trend.findIndex((t) => t.month === current);
  return (
    <div ref={ref} className="ar-chart" data-tone={spec.tone}>
      {w > 0 && (
        <svg width={w} height={H} role="img" aria-label={`${spec.label} by month: ${trend.map((t, i) => `${monthLabel(t.month)} ${nf(vals[i])}`).join(', ')}`} onMouseLeave={() => setHover(null)}>
          {ticks.map((t) => (
            <g key={t}>
              <line className="ar-grid-line" x1={PAD.l} x2={w - PAD.r} y1={y(t)} y2={y(t)} />
              <text className="ar-axis" x={PAD.l - 6} y={y(t) + 3} textAnchor="end">
                {nf(t)}
              </text>
            </g>
          ))}
          <path key={`a-${metric}`} className="ar-area" d={area} />
          <path key={`l-${metric}`} className="ar-line" d={line} pathLength={1} />
          {trend.map((t, i) => (
            <g key={t.month}>
              <text className="ar-axis" x={x(i)} y={H - 8} textAnchor="middle">
                {trend.length > 8 && i % 2 && i !== hi ? '' : MONTHS[Number(t.month.slice(5, 7)) - 1]}
              </text>
              <circle className="ar-dot" data-on={i === hi || undefined} cx={x(i)} cy={y(vals[i])} r={i === hi ? 5 : 3.5} />
              <rect
                x={x(i) - iw / Math.max(1, trend.length) / 2}
                y={0}
                width={iw / Math.max(1, trend.length)}
                height={H}
                fill="transparent"
                onMouseEnter={() => setHover(i)}
                onFocus={() => setHover(i)}
                tabIndex={-1}
              />
            </g>
          ))}
          {hi >= 0 && hi < trend.length && (
            <g className="ar-tip" transform={`translate(${Math.min(Math.max(x(hi), PAD.l + 50), w - PAD.r - 50)}, ${Math.max(y(vals[hi]) - 14, 12)})`}>
              <text textAnchor="middle">
                {monthLabel(trend[hi].month)}: {nf(vals[hi], metric === 'present' ? 0 : 0)} {spec.unit}
              </text>
            </g>
          )}
        </svg>
      )}
    </div>
  );
}

/** Overtime hours by rate, stacked per month (one hue, lighter to darker as the rate rises). */
function OtBars({ trend, current }: { trend: AttendanceOverviewView['trend']; current: string | null }) {
  const [ref, w] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const max = niceMax(Math.max(...trend.map((t) => otSum(t.ot)), 0));
  const iw = Math.max(10, w - PAD.l - PAD.r);
  const slot = iw / Math.max(1, trend.length);
  const bw = Math.min(36, slot * 0.6);
  const y = (v: number) => PAD.t + (1 - v / max) * (H - PAD.t - PAD.b);
  const hi = hover ?? trend.findIndex((t) => t.month === current);
  return (
    <div ref={ref} className="ar-chart">
      {w > 0 && (
        <svg width={w} height={H} role="img" aria-label={`Overtime hours by month: ${trend.map((t) => `${monthLabel(t.month)} ${nf(otSum(t.ot), 1)}`).join(', ')}`} onMouseLeave={() => setHover(null)}>
          {[0, max / 2, max].map((t) => (
            <g key={t}>
              <line className="ar-grid-line" x1={PAD.l} x2={w - PAD.r} y1={y(t)} y2={y(t)} />
              <text className="ar-axis" x={PAD.l - 6} y={y(t) + 3} textAnchor="end">
                {nf(t)}
              </text>
            </g>
          ))}
          {trend.map((t, i) => {
            const cx = PAD.l + slot * i + slot / 2;
            let acc = 0;
            return (
              <g key={t.month} onMouseEnter={() => setHover(i)}>
                {t.ot.map((h, r) => {
                  const top = y(acc + h);
                  const hgt = y(acc) - top;
                  acc += h;
                  return h > 0 ? <rect key={r} className="ar-ot" data-rate={r} x={cx - bw / 2} y={top} width={bw} height={Math.max(0, hgt - (r < 3 ? 1 : 0))} rx={r === 3 || t.ot.slice(r + 1).every((z) => z === 0) ? 3 : 0} style={{ ['--i' as string]: i }} /> : null;
                })}
                <rect x={cx - slot / 2} y={0} width={slot} height={H} fill="transparent" />
                <text className="ar-axis" x={cx} y={H - 8} textAnchor="middle" data-on={i === hi || undefined}>
                  {MONTHS[Number(t.month.slice(5, 7)) - 1]}
                </text>
              </g>
            );
          })}
        </svg>
      )}
      <div className="ar-ot-legend">
        {RATES.map((r, i) => (
          <span key={r}>
            <span className="ar-ot-key" data-rate={i} /> {r}×
          </span>
        ))}
        {hi >= 0 && hi < trend.length && (
          <span className="ar-ot-tip">
            {monthLabel(trend[hi].month)}: {trend[hi].ot.map((h, i) => `${RATES[i]}× ${nf(h, 1)}`).join(', ')} h
          </span>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- one person's month

function PersonDrawer({ importId, k, onClose }: { importId: string; k: string; onClose: () => void }) {
  const { data, error } = useLoad(() => client!.person(importId, k), [importId, k]);
  const p = data;
  return (
    <Drawer
      title={p ? (p.person?.name ?? p.employee.name) : 'Attendance'}
      sub={p ? `${monthLabel(p.month, true)}${p.employee.empCode ? ` · ${p.employee.empCode}` : ''}${p.employee.designation ? ` · ${p.employee.designation}` : ''}` : undefined}
      onClose={onClose}
    >
      {error && <ErrorNotice error={error} />}
      {!p && !error && <Loading what="the month" />}
      {p && <PersonMonth p={p} />}
    </Drawer>
  );
}

function PersonMonth({ p }: { p: AttendancePersonView }) {
  const t = p.employee.totals;
  const [day, setDay] = useState<string | null>(null);
  const first = new Date(`${p.month}-01T00:00:00Z`).getUTCDay();
  const len = p.employee.strip.length;
  const byDate = new Map<string, AttendancePersonView['days']>();
  for (const d of p.days) byDate.set(d.date, [...(byDate.get(d.date) ?? []), d]);
  const chosen = day ? (byDate.get(day) ?? []) : [];
  return (
    <div className="ar-person">
      {!p.person && <div className="notice" data-tone="warn">Not matched to a staff record yet. HR matches it under “Match to staff”.</div>}
      <div className="ar-mini-stats">
        <span>
          <strong>{t.present}</strong> present
        </span>
        <span data-tone={t.lateCount ? 'warn' : undefined}>
          <strong>{t.lateCount}</strong> late · {hm(t.lateMin)}
        </span>
        <span data-tone={t.absent ? 'crit' : undefined}>
          <strong>{t.absent}</strong> absent
        </span>
        <span>
          <strong>{t.leave}</strong> leave
        </span>
        <span>
          <strong>{nf(otSum(t.ot), 1)}</strong> OT h
        </span>
        <span>
          <strong>{rm(p.employee.allowances)}</strong>
        </span>
      </div>
      {p.employee.totalsMatch === false && (
        <div className="notice" data-tone="warn">
          The totals printed on the report do not equal its day rows. Check the original report before relying on these figures.
        </div>
      )}
      <div className="ar-cal" role="grid" aria-label={`${monthLabel(p.month, true)} calendar`}>
        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => (
          <span key={d} className="ar-cal-head" role="columnheader">
            {d}
          </span>
        ))}
        {Array.from({ length: first }, (_, i) => (
          <span key={`pad${i}`} />
        ))}
        {Array.from({ length: len }, (_, i) => {
          const date = `${p.month}-${String(i + 1).padStart(2, '0')}`;
          const c = p.employee.strip[i];
          const rows = byDate.get(date) ?? [];
          const r = rows[0];
          return (
            <button
              key={date}
              type="button"
              role="gridcell"
              className="ar-cal-day"
              data-k={KIND[c]?.k ?? 'none'}
              aria-pressed={day === date}
              style={{ ['--i' as string]: i }}
              onClick={() => setDay(day === date ? null : date)}
              aria-label={`${i + 1}: ${KIND[c]?.label ?? ''}${r?.reason ? `, ${reasonLabel(r.reason)}` : ''}`}
            >
              <span className="ar-cal-n">{i + 1}</span>
              {r?.in && <span className="ar-cal-t">{r.in}</span>}
              {r?.reason && !r.in && <span className="ar-cal-t">{r.reason}</span>}
            </button>
          );
        })}
      </div>
      <Legend />
      {day && (
        <Card title={dateLabel(day)}>
          {chosen.length === 0 && <div className="muted">Nothing printed for this day.</div>}
          {chosen.map((d) => (
            <dl key={d.id} className="k-facts">
              <div>
                <dt>In / out</dt>
                <dd className="mono">
                  {d.in ?? '–'} / {d.out ?? '–'}
                </dd>
              </div>
              {d.clocks && d.clocks.length > 0 && (
                <div>
                  <dt>Clock punches</dt>
                  <dd className="mono">{d.clocks.join(', ')}</dd>
                </div>
              )}
              <div>
                <dt>Shift</dt>
                <dd className="mono">{d.shift ?? '–'}</dd>
              </div>
              <div>
                <dt>Hours (normal / actual)</dt>
                <dd>
                  {nf(d.normalH, 2)} / {nf(d.actualH, 2)}
                </dd>
              </div>
              <div>
                <dt>Late / early out</dt>
                <dd>
                  {d.lateMin ? hm(d.lateMin) : '–'} / {d.earlyMin ? hm(d.earlyMin) : '–'}
                </dd>
              </div>
              <div>
                <dt>Overtime</dt>
                <dd>{otSum(d.ot) ? d.ot.map((h, i) => (h ? `${RATES[i]}× ${nf(h, 2)} h` : '')).filter(Boolean).join(', ') : '–'}</dd>
              </div>
              <div>
                <dt>Reason</dt>
                <dd>{d.reasonLabel ?? '–'}</dd>
              </div>
              <div>
                <dt>Report page</dt>
                <dd>{d.page}</dd>
              </div>
            </dl>
          ))}
        </Card>
      )}
      {p.history.length > 1 && (
        <Card title="Other months" flush>
          <ul className="ar-history">
            {p.history.map((h) => (
              <li key={h.importId} data-on={h.importId === p.importId || undefined}>
                <span className="ar-history-m">{monthLabel(h.month)}</span>
                <Strip strip={h.strip} />
                <span className="small muted">
                  {h.totals.lateCount} late · {h.totals.absent} absent
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}
      <p className="muted small">From {p.fileName}. Figures are as the attendance system printed them; nothing here pays, deducts or disciplines anyone.</p>
    </div>
  );
}

// ---------------------------------------------------------------- matching

function MatchDrawer({ onClose }: { onClose: () => void }) {
  const { data, error, reload } = useLoad(() => client!.unmatched(), []);
  const { bump } = useContext(RefreshContext);
  return (
    <Drawer
      title="Match to staff"
      sub="People on the reports no staff record was found for. Pick the person once; later reports use the same match."
      onClose={() => (bump(), onClose())}
    >
      {error && <ErrorNotice error={error} />}
      {!data && !error && <Loading what="unmatched people" />}
      {data && data.length === 0 && <Empty title="Everyone is matched">Every person on the imported reports has a staff record.</Empty>}
      {data && data.length > 0 && (
        <ul className="ar-match-list">
          {data.map((u) => (
            <MatchRow key={u.companyId + u.key} u={u} onDone={reload} />
          ))}
        </ul>
      )}
    </Drawer>
  );
}

function MatchRow({ u, onDone }: { u: AttendanceUnmatched[number]; onDone: () => void }) {
  const [q, setQ] = useState(u.name);
  const dq = useDebounced(q, 300);
  const [hits, setHits] = useState<AttendanceStaffHit[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [openSearch, setOpenSearch] = useState(false);
  useEffect(() => {
    if (!openSearch || !dq.trim()) return;
    let live = true;
    client!.staff(u.companyId, dq).then(
      (h) => live && (setHits(h), setErr(null)),
      (e: unknown) => live && setErr(e instanceof Error ? e.message : String(e)),
    );
    return () => {
      live = false;
    };
  }, [dq, openSearch, u.companyId]);
  const pick = async (h: AttendanceStaffHit) => {
    setBusy(true);
    try {
      await client!.match(u.companyId, u.key, h.id);
      onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <li className="ar-match">
      <div className="ar-match-head">
        <Person name={u.name} size={32} sub={`${u.companyName}${u.empCode ? ` · ${u.empCode}` : ''}${u.designation ? ` · ${u.designation}` : ''} · ${u.months.map((m) => monthLabel(m)).join(', ')}`} />
        {!openSearch && (
          <button type="button" className="btn btn-sm" onClick={() => setOpenSearch(true)}>
            Find staff
          </button>
        )}
      </div>
      {openSearch && (
        <div className="ar-match-search">
          <Search value={q} onChange={setQ} placeholder="Name or staff number" />
          {err && <ErrorNotice error={err} />}
          {hits && hits.length === 0 && <div className="muted small">No staff of this company match “{dq}”.</div>}
          {hits && hits.length > 0 && (
            <ul className="ar-hits">
              {hits.map((h) => (
                <li key={h.id}>
                  <button type="button" disabled={busy} onClick={() => void pick(h)}>
                    <Person name={h.name} size={28} sub={[h.staffNo, h.jobTitle ?? h.department].filter(Boolean).join(' · ')} />
                    <span className="ar-hit-act">This is them</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </li>
  );
}

// ---------------------------------------------------------------- importing

type JobState =
  | { step: 'hashing' }
  | { step: 'sending'; up: AttendanceUploadView; sent: number }
  | { step: 'reading'; up: AttendanceUploadView }
  | { step: 'preview'; up: AttendanceUploadView; preview: AttendancePreview; choice: Record<string, string | null> }
  | { step: 'confirm'; up: AttendanceUploadView; preview: AttendancePreview; choice: Record<string, string | null>; message: string }
  | { step: 'saving'; up: AttendanceUploadView; preview: AttendancePreview; choice: Record<string, string | null> }
  | { step: 'saved'; summary: string; skipped: string[] }
  | { step: 'failed'; message: string; up?: AttendanceUploadView };

interface Job {
  key: string;
  file: File;
  state: JobState;
  /** P90: an Excel or CSV timesheet, read on this device: what was found, shown above the preview. */
  table?: TableNote;
  /** A refused save, shown under the preview it belongs to. */
  error?: string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface TableNote {
  rows: number;
  people: number;
  days: number;
  skipped: number;
  firstSkipped: string[];
  dateOrder: 'dmy' | 'mdy';
  assumed: boolean;
  columns: string[];
}

const isPdf = (f: File) => /\.pdf$/i.test(f.name) || f.type === 'application/pdf';
const isTable = (f: File) => /\.(xlsx|csv)$/i.test(f.name);

/** The browser's own raw-deflate decoder, for the zip inside an .xlsx. */
async function inflateRaw(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * P90: an Excel or CSV timesheet is read here, on this device: the columns found by their headings, the dates in the
 * column's own order. Only the rows go to Prima (as a small file of their own), never the spreadsheet.
 */
async function readTimesheet(file: File): Promise<{ payload: File; note: TableNote }> {
  if (file.size > 20 * 1024 * 1024) throw new Error('This file is larger than 20 MB. Export one month at a time.');
  let grid: string[][];
  if (/\.csv$/i.test(file.name)) grid = cleanGrid(parseCsv(await file.text()));
  else {
    const sheets = await readXlsx(new Uint8Array(await file.arrayBuffer()), inflateRaw);
    // The sheet with the most rows that has the timesheet headings.
    const ok = sheets
      .map((sh) => cleanGrid(sh.rows))
      .filter((g) => g.slice(0, 20).some((r) => timesheetColumns(r).some((c) => c.field === 'date')))
      .sort((a, b) => b.length - a.length);
    if (!ok.length) throw new Error('No sheet in this workbook has a Date column with a Name or Employee number column.');
    grid = ok[0];
  }
  const name = file.name.replace(/\.(xlsx|csv)$/i, '');
  const r = attendanceFromTable(grid, { title: `Timesheet: ${name.slice(0, 80)}` });
  const json = JSON.stringify(r.report);
  return {
    payload: new File([json], file.name, { type: 'application/json' }),
    note: {
      rows: r.rows,
      people: r.report.employees.length,
      days: r.report.employees.reduce((n, e) => n + e.days.length, 0),
      skipped: r.skippedCount,
      firstSkipped: r.skipped.slice(0, 3).map((x) => `row ${x.row}: ${x.reason}`),
      dateOrder: r.dateOrder,
      assumed: r.dateOrderAssumed,
      columns: r.columns.map((c) => c.heading),
    },
  };
}

async function sha256Hex(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const d = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function base64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).replace(/^data:[^,]*,/, ''));
    r.onerror = () => reject(new Error('The file could not be read from this device.'));
    r.readAsDataURL(blob);
  });
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

function ImportDrawer({ onClose }: { onClose: () => void }) {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [drag, setDrag] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const { bump } = useContext(RefreshContext);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const set = useCallback(
    (key: string, state: JobState, error?: string) => setJobs((js) => js.map((j) => (j.key === key ? { ...j, state, error } : j))),
    [],
  );

  const run = useCallback(
    async (job: Job) => {
      try {
        let file = job.file;
        let kind: 'pdf' | 'table' = 'pdf';
        if (isTable(job.file)) {
          const t = await readTimesheet(job.file);
          file = t.payload;
          kind = 'table';
          setJobs((js) => js.map((j) => (j.key === job.key ? { ...j, table: t.note } : j)));
        }
        const sha = await sha256Hex(file);
        let up = await client!.start({ name: job.file.name, size: file.size, sha256: sha, kind });
        set(job.key, { step: 'sending', up, sent: 0 });
        for (let i = 0; i < up.chunks; i++) {
          const data = await base64(file.slice(i * up.chunkBytes, (i + 1) * up.chunkBytes));
          up = await client!.chunk(up.id, i, data);
          set(job.key, { step: 'sending', up, sent: up.received });
        }
        up = await client!.finish(up.id);
        while (up.status === 'reading') {
          set(job.key, { step: 'reading', up });
          await sleep(700);
          up = await client!.status(up.id);
        }
        if (up.status !== 'read') throw new Error(up.error ?? 'The file could not be read.');
        set(job.key, { step: 'reading', up });
        const preview = await client!.preview(up.id, {});
        set(job.key, { step: 'preview', up, preview, choice: {} });
      } catch (e) {
        set(job.key, { step: 'failed', message: message(e) });
      }
    },
    [set],
  );

  const add = (files: FileList | File[]) => {
    const list = [...files].filter((f) => f.size > 0);
    const fresh: Job[] = list.map((file) => ({ key: `${file.name}:${file.size}:${file.lastModified}:${Math.random()}`, file, state: { step: 'hashing' } }));
    for (const j of fresh)
      if (!isPdf(j.file) && !isTable(j.file)) j.state = { step: 'failed', message: 'Only PDF reports, Excel (.xlsx) and CSV timesheets are imported here.' };
    setJobs((js) => [...js, ...fresh]);
    // One file at a time: the server reads two at once at most, and the page stays responsive.
    for (const j of fresh) if (j.state.step === 'hashing') queue.current = queue.current.then(() => run(j));
  };

  const choose = async (job: Job, source: string, companyId: string | null) => {
    const s = job.state;
    if (s.step !== 'preview') return;
    const choice = { ...s.choice, [source]: companyId };
    try {
      const preview = await client!.preview(s.up.id, choice);
      set(job.key, { step: 'preview', up: s.up, preview, choice });
    } catch (e) {
      set(job.key, { step: 'failed', message: message(e), up: s.up });
    }
  };

  const save = async (job: Job, replace: boolean) => {
    const s = job.state;
    if (s.step !== 'preview' && s.step !== 'confirm') return;
    set(job.key, { step: 'saving', up: s.up, preview: s.preview, choice: s.choice });
    try {
      const r = await client!.save(s.up.id, s.choice, replace);
      if (!r.saved) {
        set(job.key, { step: 'confirm', up: s.up, preview: s.preview, choice: s.choice, message: r.needsReplace });
        return;
      }
      const summary = r.imports
        .map((i) => `${i.companyName}: ${i.employees} people, ${nf(i.days)} days, ${i.matched} matched${i.replacedId ? ' (replaced the earlier import)' : ''}`)
        .join('; ');
      set(job.key, { step: 'saved', summary, skipped: r.skipped.map((x) => `${x.source}: ${x.reason}`) });
      bump();
    } catch (e) {
      set(job.key, { step: 'preview', up: s.up, preview: s.preview, choice: s.choice }, message(e));
    }
  };

  const cancel = (job: Job) => {
    const s = job.state;
    if ('up' in s && s.up) void client!.cancel(s.up.id).catch(() => undefined);
    setJobs((js) => js.filter((j) => j.key !== job.key));
  };

  return (
    <Drawer
      title="Import timesheets"
      sub='The monthly "Individual Attendance Report" PDFs from the old attendance system, or a timesheet exported to Excel or CSV. You see every person, the dates and the totals before anything is saved.'
      onClose={onClose}
    >
      <div
        className="ar-drop"
        data-drag={drag || undefined}
        onDragOver={(e) => (e.preventDefault(), setDrag(true))}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          add(e.dataTransfer.files);
        }}
      >
        <UploadSimpleIcon size={28} aria-hidden="true" />
        <strong>Drop the timesheets here (PDF, Excel or CSV)</strong>
        <span className="muted small">One file per month; several at once is fine. Up to 25 MB each. Excel and CSV files are read on this device.</span>
        <button type="button" className="btn btn-sm" onClick={() => input.current?.click()}>
          Choose files
        </button>
        <input
          ref={input}
          type="file"
          accept="application/pdf,.pdf,.xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          multiple
          hidden
          onChange={(e) => {
            if (e.target.files) add(e.target.files);
            e.target.value = '';
          }}
        />
      </div>
      <ul className="ar-jobs">
        {jobs.map((j) => (
          <JobCard key={j.key} job={j} onChoose={(src, id) => void choose(j, src, id)} onSave={(r) => void save(j, r)} onCancel={() => cancel(j)} />
        ))}
      </ul>
    </Drawer>
  );
}

function Progress({ value, label }: { value: number; label: string }) {
  const pct = Math.max(0, Math.min(100, Math.round(value * 100)));
  return (
    <div className="ar-progress" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
      <span className="ar-progress-bar" style={{ ['--p' as string]: `${pct}%` }} />
      <span className="ar-progress-text small">
        {label} · {pct}%
      </span>
    </div>
  );
}

function JobCard({ job, onChoose, onSave, onCancel }: { job: Job; onChoose: (source: string, id: string | null) => void; onSave: (replace: boolean) => void; onCancel: () => void }) {
  const s = job.state;
  const size = job.file.size < 1024 * 1024 ? `${nf(Math.max(1, Math.round(job.file.size / 1024)))} KB` : `${nf(job.file.size / 1024 / 1024, 1)} MB`;
  let body: ReactNode = null;
  if (s.step === 'hashing') body = <Progress value={0} label="Waiting to send" />;
  else if (s.step === 'sending') body = <Progress value={s.sent / Math.max(1, s.up.size)} label="Sending" />;
  else if (s.step === 'reading')
    body = <Progress value={s.up.progress.pages ? s.up.progress.page / s.up.progress.pages : 0} label={s.up.progress.pages ? `Reading page ${s.up.progress.page} of ${s.up.progress.pages}` : 'Reading'} />;
  else if (s.step === 'failed') body = <div className="notice" data-tone="crit">{s.message}</div>;
  else if (s.step === 'saved')
    body = (
      <div className="notice" data-tone="ok">
        Saved. {s.summary}.
        {s.skipped.length > 0 && <div className="small">Left out: {s.skipped.join('; ')}</div>}
      </div>
    );
  else body = <PreviewBody s={s} error={job.error} onChoose={onChoose} onSave={onSave} />;
  return (
    <li className="ar-job" data-step={s.step}>
      <div className="ar-job-head">
        {isTable(job.file) ? <FileXlsIcon size={22} aria-hidden="true" /> : <FilePdfIcon size={22} aria-hidden="true" />}
        <span className="ar-job-name">
          <strong>{job.file.name}</strong>
          <span className="muted small">{size}</span>
        </span>
        {s.step !== 'saved' && s.step !== 'saving' && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel}>
            {s.step === 'failed' ? 'Remove' : 'Cancel'}
          </button>
        )}
      </div>
      {job.table && s.step !== 'saved' && <TableNoteView t={job.table} />}
      {body}
    </li>
  );
}

/** P90: what was read from an Excel or CSV timesheet on this device, before it is sent. */
function TableNoteView({ t }: { t: TableNote }) {
  return (
    <div className="ar-table-note small">
      <span>{`Read on this device: ${nf(t.rows)} rows, ${nf(t.people)} people, ${nf(t.days)} days.`}</span>
      <span>
        {t.dateOrder === 'dmy' ? 'Dates read day first (31-01-2026)' : 'Dates read month first (01-31-2026)'}
        {t.assumed ? '. No day above 12 in the file, so day first was assumed, as in Malaysia. Check a few dates below.' : ', from the dates in the file.'}
      </span>
      <span className="muted">
        <span>Columns used:</span> <span>{t.columns.join(', ')}</span>
      </span>
      {t.skipped > 0 && (
        <span data-tone="warn">
          <span>{`${nf(t.skipped)} ${t.skipped === 1 ? 'row' : 'rows'} left out:`}</span> <span>{t.firstSkipped.join('; ')}</span>
        </span>
      )}
    </div>
  );
}

function PreviewBody({
  s,
  error,
  onChoose,
  onSave,
}: {
  s: Extract<JobState, { step: 'preview' | 'confirm' | 'saving' }>;
  error?: string;
  onChoose: (source: string, id: string | null) => void;
  onSave: (replace: boolean) => void;
}) {
  const p = s.preview;
  const [rowsOpen, setRowsOpen] = useState(false);
  const matched = p.rows.filter((r) => r.personId).length;
  const notAdding = p.rows.filter((r) => r.totalsMatch === false).length;
  return (
    <div className="ar-preview">
      <div className="ar-preview-facts">
        <span>
          <strong>{p.month ? monthLabel(p.month, true) : 'Month unknown'}</strong>
          {p.periodFrom && p.periodTo && <span className="muted small"> {dateLabel(p.periodFrom)} to {dateLabel(p.periodTo)}</span>}
        </span>
        <span>
          <strong>{p.employees}</strong> people
        </span>
        <span>
          <strong>{nf(p.days)}</strong> days
        </span>
        {p.pages > 0 && (
          <span>
            <strong>{p.pages}</strong> pages
          </span>
        )}
        <span data-tone={matched < p.rows.length ? 'warn' : 'ok'}>
          <strong>{matched}</strong> matched to staff
        </span>
      </div>
      <PreviewSummary p={p} />
      {p.alreadyImported && (
        <div className="notice" data-tone="crit">
          This file is already imported ({p.alreadyImported.companyName}, {monthLabel(p.alreadyImported.month)}, by {p.alreadyImported.by}). The same file is never imported twice.
        </div>
      )}
      <ul className="ar-preview-companies">
        {p.companies.map((c) => (
          <li key={c.source}>
            <span className="ar-src">
              <span className="muted small">On the report</span>
              <strong>{c.source || 'No company printed'}</strong>
            </span>
            <label className="field">
              <span className="muted small">Saved under</span>
              <Select className="select" value={c.companyId ?? ''} disabled={s.step !== 'preview'} onChange={(e) => onChoose(c.source, e.target.value || null)}>
                <option value="">Choose the company…</option>
                {p.choices.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name}
                  </option>
                ))}
                {c.companyId && !p.choices.some((x) => x.id === c.companyId) && <option value={c.companyId}>{c.companyName}</option>}
              </Select>
            </label>
            <span className="small">
              {c.employees} people · {c.matched} matched · {c.unmatched} to match
              {c.companyId && !c.canImport && <Chip tone="crit">You do not import for this company</Chip>}
              {c.existing && (
                <Chip tone="warn" title={`${c.existing.fileName}, by ${c.existing.by}`}>
                  Replaces the import of {dateLabel(c.existing.at)}
                </Chip>
              )}
            </span>
          </li>
        ))}
      </ul>
      {(p.unreadable.length > 0 || p.warnings.length > 0 || notAdding > 0) && (
        <details className="ar-issues">
          <summary>
            {p.unreadable.length > 0 && <Chip tone="warn">{p.unreadable.length} pages not readable</Chip>}
            {p.warnings.length > 0 && <Chip tone="warn">{p.warnings.length} rows to check</Chip>}
            {notAdding > 0 && <Chip tone="warn">{notAdding} totals do not add up</Chip>}
          </summary>
          <ul className="ar-pages">
            {p.unreadable.map((u) => (
              <li key={`u${u.page}`}>
                <span className="mono">Page {u.page}</span> {u.reason}
              </li>
            ))}
            {p.warnings.map((w, i) => (
              <li key={`w${i}`}>
                <span className="mono">Page {w.page}</span> {w.reason}
              </li>
            ))}
          </ul>
        </details>
      )}
      <button type="button" className="btn btn-ghost btn-sm" onClick={() => setRowsOpen((x) => !x)} aria-expanded={rowsOpen}>
        {rowsOpen ? 'Hide the people' : `Show the ${p.rows.length} people`}
      </button>
      {rowsOpen && (
        <div className="table-wrap ar-preview-rows">
          <table>
            <thead>
              <tr>
                <th>On the report</th>
                <th>Staff record</th>
                <th>Dates</th>
                <th className="num">Days</th>
                <th className="num">Worked</th>
                <th className="num">Absent</th>
                <th className="num">Rest</th>
                <th className="num">Leave</th>
                <th className="num">Late</th>
                <th className="num">Early out</th>
                {RATES.map((r) => (
                  <th key={r} className="num">
                    OT {r}
                  </th>
                ))}
                <th className="num">Allowances (RM)</th>
              </tr>
            </thead>
            <tbody>
              {p.rows.slice(0, 400).map((r) => (
                <tr key={r.source + r.key}>
                  <td>
                    <div>{r.name || '(no name printed)'}</div>
                    <div className="muted small mono">{r.empCode ?? ''}</div>
                  </td>
                  <td>{r.personName ? <span>{r.personName} <span className="muted small">({r.how === 'staff_no' ? 'staff no' : r.how === 'name' ? 'same name' : 'remembered'})</span></span> : <Chip tone="unknown">Not matched</Chip>}</td>
                  <td className="small ar-nowrap">{r.from && r.to ? `${dateLabel(r.from)} to ${dateLabel(r.to)}` : '-'}</td>
                  <td className="num">{r.days}</td>
                  <td className="num">{r.totals?.present ?? r.present}</td>
                  <td className="num">{r.absent}</td>
                  <td className="num">{r.totals?.rest ?? '-'}</td>
                  <td className="num">{r.totals?.leave ?? '-'}</td>
                  <td className="num" title={r.totals ? `${r.totals.lateCount} days` : undefined}>
                    {r.totals ? (r.totals.lateMin ? hm(r.totals.lateMin) : '-') : r.lateCount}
                  </td>
                  <td className="num">{r.totals?.earlyMin ? hm(r.totals.earlyMin) : '-'}</td>
                  {RATES.map((_, i) => (
                    <td key={i} className="num">
                      {r.totals?.ot[i] ? nf(r.totals.ot[i], 1) : '-'}
                    </td>
                  ))}
                  <td className="num">{r.allowances ? nf(r.allowances, 2) : '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {error && <ErrorNotice error={error} />}
      {s.step === 'confirm' ? (
        <div className="notice ar-confirm" data-tone="warn" role="alert">
          <span>{s.message}</span>
          <span className="row">
            <button type="button" className="btn btn-primary btn-sm" onClick={() => onSave(true)}>
              <ArrowsClockwiseIcon size={16} /> Replace it
            </button>
            <span className="muted small">or Cancel to keep the earlier import.</span>
          </span>
        </div>
      ) : (
        <div className="row">
          <button type="button" className="btn btn-primary" disabled={!p.canSave || s.step === 'saving' || !p.companies.some((c) => c.companyId && c.canImport)} onClick={() => onSave(false)}>
            {s.step === 'saving' ? 'Saving…' : 'Save'}
          </button>
          {!p.canSave && !p.alreadyImported && <span className="muted small">Choose the company it is saved under first.</span>}
        </div>
      )}
    </div>
  );
}

const CHECK_ORDER: AttendanceCheckKind[] = ['weekday_mismatch', 'outside_period', 'duplicate_day', 'totals_mismatch', 'missing_out', 'missing_in', 'overnight', 'missing_days'];

/** P90: the whole file summed, and what to look at before saving. */
function PreviewSummary({ p }: { p: AttendancePreview }) {
  const k = p.kpi;
  const c = p.checks;
  if (!k || !c) return null;
  const found = CHECK_ORDER.filter((x) => c.counts[x] > 0);
  return (
    <div className="ar-summary">
      <div className="ar-summary-grid">
        <span>
          <span className="muted small">Dates on the rows</span>
          <strong>{c.from && c.to ? `${dateLabel(c.from)} to ${dateLabel(c.to)}` : '-'}</strong>
        </span>
        <span>
          <span className="muted small">Worked days</span>
          <strong>{nf(k.present)}</strong>
        </span>
        <span data-tone={k.absent ? 'crit' : undefined}>
          <span className="muted small">Absent days</span>
          <strong>{nf(k.absent)}</strong>
        </span>
        <span>
          <span className="muted small">Leave days</span>
          <strong>{nf(k.leave)}</strong>
        </span>
        <span data-tone={k.lateCount ? 'warn' : undefined}>
          <span className="muted small">Late</span>
          <strong>
            {nf(k.lateCount)} times, {hm(k.lateMin)}
          </strong>
        </span>
        <span>
          <span className="muted small">Overtime hours (1.0 / 1.5 / 2.0 / 3.0)</span>
          <strong>{k.ot.map((h) => nf(h, 1)).join(' / ')}</strong>
        </span>
        <span>
          <span className="muted small">Allowances</span>
          <strong>{rm(k.allowances)}</strong>
        </span>
      </div>
      {found.length === 0 ? (
        <div className="notice small" data-tone="ok">
          Dates checked: every date is inside the report period, on the calendar and on its printed weekday, and nobody has the same day twice.
        </div>
      ) : (
        <details className="ar-checks" open={!c.clean}>
          <summary>
            {c.clean ? <Chip tone="ok">Dates checked</Chip> : <Chip tone="warn">Look at these before saving</Chip>}
            {found.map((x) => (
              <Chip key={x} tone={ATTENDANCE_CHECK_LABEL[x].tone}>
                {ATTENDANCE_CHECK_LABEL[x].label}: {nf(c.counts[x])}
              </Chip>
            ))}
          </summary>
          <ul className="ar-pages">
            {c.examples
              .filter((e) => found.includes(e.kind))
              .map((e, i) => (
                <li key={i}>
                  <span className="mono">{e.date ?? ''}</span> {e.name || e.empCode}: {e.detail}
                </li>
              ))}
          </ul>
        </details>
      )}
    </div>
  );
}

/** Used by the HR screen: the import button and a short summary, with a way into the Attendance screen. */
export function AttendanceReportsSummary({ onOpen }: { onOpen: () => void }) {
  const { data, error } = useLoad(() => (client ? client.overview({}) : Promise.resolve(null)), []);
  const [importing, setImporting] = useState(false);
  const k = data?.kpi;
  const header = useMemo(
    () => (
      <span className="row">
        {data?.canImport && (
          <button type="button" className="btn btn-primary btn-sm" onClick={() => setImporting(true)}>
            <UploadSimpleIcon size={16} /> Import timesheet (PDF, Excel, CSV)
          </button>
        )}
        <button type="button" className="btn btn-sm" onClick={onOpen}>
          Open attendance reports
        </button>
      </span>
    ),
    [data?.canImport, onOpen],
  );
  if (!client) return null;
  return (
    <Card title="Attendance reports" sub={data?.month ? `Latest month: ${monthLabel(data.month, true)}` : 'Monthly reports from the attendance system'} actions={header}>
      {error && <ErrorNotice error={error} />}
      {k && data && data.months.length > 0 ? (
        <div className="ar-mini-stats">
          <span>
            <strong>{nf(k.employees)}</strong> people
          </span>
          <span>
            <strong>{nf(k.present)}</strong> present days
          </span>
          <span data-tone={k.lateCount ? 'warn' : undefined}>
            <strong>{nf(k.lateCount)}</strong> late
          </span>
          <span data-tone={k.absent ? 'crit' : undefined}>
            <strong>{nf(k.absent)}</strong> absences
          </span>
          <span>
            <strong>{nf(otSum(k.ot), 1)}</strong> OT h
          </span>
          {data.unmatched > 0 && (
            <span data-tone="warn">
              <strong>{data.unmatched}</strong> to match to staff
            </span>
          )}
        </div>
      ) : (
        data && <div className="muted">No reports imported yet.</div>
      )}
      {importing && <ImportDrawer onClose={() => setImporting(false)} />}
    </Card>
  );
}
