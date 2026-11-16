import { Select } from '../SearchSelect';
import { useEffect, useState } from 'react';
import { api } from '../api';
import { Chip, Loading, useAction, useLoad } from '../ui';
import { OpForm, type Field } from './ItPolicyPanel';
import { personField, scopeName, type PickPerson } from './Toolbox';
import { useApp } from '../App';
import { DataTable, type DtColumn, type DtFilter } from '../DataTable';

/**
 * Mesyuarat bulanan JA Group (Part Y, Fauzan's answers 14 Nov 2026): each company reports on the 14-item template and
 * each unit on its department pack, built from Prima's records and the last verified toolbox pack. Reports are in Prima
 * 3 working days before the meeting and the company manager verifies; Unit HR sees who has not sent. Internal Audit
 * keeps the accounts report tracker and the Friday red/yellow/green report. Duty checklists (Senarai tugas) replace the
 * draft role playbooks. Every rule is checked again on the server; this screen only offers the steps.
 */

type Line = { text: string; source: string; red?: boolean };
type Board = {
  period: string;
  bil: string | null;
  meetingOn: string | null;
  deadline: string | null;
  invitesSentOn: string | null;
  recorders: string[];
  minutesStatus: string;
  minutes: string | null;
  rows: { scope: string; name: string; status: string; late: boolean; red: boolean; verifiedBy: string | null }[];
  sent: number;
  notSent: string[];
  can: { organise: boolean; verifyMinutes: boolean };
};
type Report = {
  scope: string;
  period: string;
  status: string;
  items: { key: string; title: string }[];
  lines: Record<string, Line[]>;
  notes: Record<string, string>;
  ticks: Record<string, string>;
  deadline: string | null;
  preparedBy: string | null;
  verifiedBy: string | null;
  can: { prepare: boolean; verify: boolean };
};
type CalItem = { id: string; text: string; fromDay?: number; toDay?: number; every?: string; weekday?: number };
type Calendar = { items: CalItem[]; changedBy: string | null; changedAt: string | null; reason: string | null };
type Duties = {
  scope: string;
  templates: Record<string, number>;
  calendar: Calendar;
  lines: { no: number; id: string; text: string; every: string; window: string; picName: string; backupName: string | null; checkerName: string | null; sopRef: string; target: string | null; doneOn: string | null; status: string; checkedBy: string | null }[];
  can: { keep: boolean };
};
type RegField = { k: string; l: string; t?: 'text' | 'number' | 'date' | 'select' | 'yn' | 'area'; o?: string[]; req?: boolean };
type RegBoard = {
  companyId: string | null;
  registers: { kind: string; item: string; label: string; companyId: string | null; rows: number; submitted: number; toCheck: number; missing: string | null; keep: boolean }[];
  newCompany: { step: string; state: string }[] | null;
  contractsDue: { ref: string; client: string; endOn: string; daysLeft: number }[];
  rentalMonth: { month: string; homes: number; vacant: number; leaving: number; repairPaid: number; repairBudget: number | null; over: boolean | null } | null;
};
type RegList = { spec: { kind: string; label: string; scope: string; fields: RegField[]; confidential?: boolean }; rows: (Record<string, unknown> & { id: string; status: string; canCheck: boolean })[]; can: { add: boolean } };
type Ryg = { rows: { companyId: string; name: string; colour: string; missing: string[]; late: string[]; openFindings: number }[]; red: number; yellow: number; green: number };

const send = (op: string) => (i: Record<string, unknown>) => api.groupMonthAct(op, i);
const lastMonth = () => {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() - 1);
  return d.toISOString().slice(0, 7);
};
const STATUS_BM: Record<string, [string, 'ok' | 'warn' | 'crit' | 'neutral' | 'info']> = {
  none: ['Belum dibina', 'neutral'],
  draft: ['Draf', 'info'],
  submitted: ['Menunggu pengesahan', 'warn'],
  returned: ['Dikembalikan', 'warn'],
  verified: ['Disahkan', 'ok'],
};

const MINUTES_BM: Record<string, string> = { none: 'belum ditulis', draft: 'draf', submitted: 'menunggu pengesahan', returned: 'dikembalikan', verified: 'disahkan' };
const EVERY_OPT = { daily: 'Harian', weekly: 'Mingguan', monthly: 'Bulanan', yearly: 'Tahunan', adhoc: 'Ad hoc' };
const TEMPLATE_BM: Record<string, string> = { company_manager: 'Pengurus syarikat', admin_exec: 'Eksekutif pentadbiran' };

export function GroupMonthlyPanel({ people = [] }: { people?: PickPerson[] }) {
  const [tab, setTab] = useState<'board' | 'report' | 'audit' | 'duties' | 'registers'>('board');
  const [period, setPeriod] = useState(lastMonth());
  const [scope, setScope] = useState('');
  // P105: the company or unit is picked by name from the board's list (it was typed as "co:co-sasa" / "dept:it").
  const board = useLoad(() => send('board')({ period }) as Promise<Board>, [period]);
  const me = useApp()?.me;
  // Without the group board (a company or unit person), their own companies and unit are the choices.
  const own = [...(me?.companies ?? []).map((c) => ({ scope: `co:${c.id}`, name: c.name })), ...(me?.user.department ? [{ scope: `dept:${me.user.department}`, name: `Unit ${scopeName(me.user.department)}` }] : [])];
  const scopes = board.data ? board.data.rows.map((r) => ({ scope: r.scope, name: scopeName(r.name) })) : board.error ? own : [];
  const onlyOne = !board.data && board.error && own.length === 1 ? own[0].scope : '';
  useEffect(() => {
    if (onlyOne && !scope) setScope(onlyOne);
  }, [onlyOne, scope]);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div className="tabbar" role="tablist" aria-label="Monthly group meeting">
        {(
          [
            ['board', 'Siapa sudah hantar'],
            ['report', 'Laporan bulanan'],
            ['audit', 'Laporan akaun (Audit Dalaman)'],
            ['duties', 'Senarai tugas'],
            ['registers', 'Daftar tugas'],
          ] as const
        ).map(([k, l]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>
            {l}
          </button>
        ))}
      </div>
      <div className="panel" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <label className="small">
          Bulan dilaporkan <input className="input" type="month" value={period} onChange={(e) => setPeriod(e.target.value)} />
        </label>
        <label className="small">
          Syarikat / unit{' '}
          {scopes.length ? (
            <Select className="select" aria-label="Syarikat / unit" value={scope} onChange={(e) => setScope(e.target.value)}>
              <option value="">Pilih syarikat atau unit</option>
              {scopes.map((x) => (
                <option key={x.scope} value={x.scope}>
                  {x.name}
                </option>
              ))}
            </Select>
          ) : (
            <input className="input" placeholder="co:co-sasa atau dept:it" value={scope} onChange={(e) => setScope(e.target.value.trim())} />
          )}
        </label>
      </div>
      {tab === 'board' && <BoardTab board={board} period={period} onPick={(s) => (setScope(s), setTab('report'))} />}
      {tab === 'report' && (scope ? <ReportTab scope={scope} period={period} /> : <p className="muted">Pilih syarikat atau unit (dari senarai "Siapa sudah hantar").</p>)}
      {tab === 'audit' && <AuditTab period={period} companies={scopes.filter((x) => x.scope.startsWith('co:'))} />}
      {tab === 'duties' && (scope ? <DutiesTab scope={scope} period={period} people={people} /> : <p className="muted">Pilih syarikat atau unit untuk senarai tugasnya.</p>)}
      {tab === 'registers' && <RegistersTab companyId={scope.startsWith('co:') ? scope.slice(3) : ''} people={people} />}
    </div>
  );
}

function BoardTab({ board, period, onPick }: { board: { data: Board | null; error: string | null }; period: string; onPick: (scope: string) => void }) {
  const { data, error } = board;
  if (error)
    return (
      <p className="muted">
        Senarai &quot;Siapa sudah hantar&quot; untuk Unit HR, Pejabat Pengarah dan kepimpinan kumpulan. Pilih syarikat atau unit anda di atas, kemudian buka &quot;Laporan bulanan&quot; atau &quot;Senarai tugas&quot;.
      </p>
    );
  if (!data) return <Loading what="monthly meeting" />;
  return (
    <section className="panel">
      <div className="panel-head">
        <h3>Mesyuarat bulanan JA Group {data.bil ?? ''} ({data.period})</h3>
        <span className="muted small">
          Mesyuarat {data.meetingOn ?? 'belum ditetapkan'} · tarikh akhir laporan {data.deadline ?? '-'} · jemputan Outlook {data.invitesSentOn ?? 'belum'} · pencatat {data.recorders.join(', ') || '-'}
        </span>
      </div>
      <p className="small">
        Disahkan {data.sent} daripada {data.rows.length}. Minit: {MINUTES_BM[data.minutesStatus] ?? data.minutesStatus}.
      </p>
      {data.can.organise && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <OpForm title="Tetapkan tarikh mesyuarat" op="setMeeting" send={send('setMeeting')} fixed={{ period }} fields={[{ k: 'meetingOn', l: 'Tarikh mesyuarat', t: 'date' }, { k: 'note', l: 'Catatan' }]} />
          <OpForm title="Logistik (jemputan, pencatat)" op="logistics" send={send('logistics')} fixed={{ period }} fields={[{ k: 'invitesSentOn', l: 'Jemputan Outlook dihantar pada', t: 'date' }, { k: 'recorderIds', l: 'Pencatat minit (ID pengguna, dipisah koma)', t: 'list' }, { k: 'room', l: 'Bilik' }]} />
          <OpForm title="Tulis minit" op="minutes" send={send('minutes')} fixed={{ period, step: 'draft' }} fields={[{ k: 'text', l: 'Minit (keputusan, siapa, bila)', t: 'area' }, { k: 'aiNotes', l: 'Nota AI dari Loop / Notes (tampal)', t: 'area' }, { k: 'aiChecked', l: 'Saya sudah semak nota AI', t: 'check' }]} />
          <OpForm title="Hantar minit untuk pengesahan" op="minutes" send={send('minutes')} fixed={{ period, step: 'submit' }} fields={[]} />
        </div>
      )}
      {data.can.verifyMinutes && data.minutesStatus === 'submitted' && (
        <div style={{ display: 'flex', gap: 6 }}>
          <OpForm title="Sahkan minit" op="minutes" send={send('minutes')} fixed={{ period, step: 'verify' }} fields={[{ k: 'comment', l: 'Ulasan' }]} />
          <OpForm title="Kembalikan minit" op="minutes" send={send('minutes')} fixed={{ period, step: 'return' }} fields={[{ k: 'comment', l: 'Sebab' }]} />
        </div>
      )}
      {data.minutes && <pre className="small" style={{ whiteSpace: 'pre-wrap' }}>{data.minutes}</pre>}
      {/* P107: 40-60 companies and units: a data table (search, Status / Lewat filters, sort, pages; cards on a phone).
          A row opens that company's or unit's monthly report, as its name button did. */}
      <DataTable label="Siapa sudah hantar" stateKey="gm.board" rows={data.rows} rowKey={(r) => r.scope} columns={BOARD_COLUMNS} filters={BOARD_FILTERS} onView={(r) => onPick(r.scope)} />
    </section>
  );
}

type BoardRow = Board['rows'][number];
const statusBm = (s: string) => STATUS_BM[s]?.[0] ?? s;
const BOARD_COLUMNS: DtColumn<BoardRow>[] = [
  { id: 'name', label: 'Syarikat / unit', value: (r) => scopeName(r.name), render: (r) => <strong>{scopeName(r.name)}</strong>, phone: 'title' },
  { id: 'status', label: 'Status', value: (r) => statusBm(r.status), render: (r) => <Chip tone={STATUS_BM[r.status]?.[1] ?? 'neutral'}>{statusBm(r.status)}</Chip> },
  { id: 'late', label: 'Lewat', value: (r) => (r.late ? 'Lewat' : null), render: (r) => (r.late ? <Chip tone="warn">Lewat</Chip> : '–') },
  {
    id: 'red',
    label: 'Hari mesyuarat',
    value: (r) => (r.red ? 'Tiada pada hari mesyuarat' : null),
    render: (r) => (r.red ? <Chip tone="crit">Tiada pada hari mesyuarat</Chip> : '–'),
  },
  { id: 'verifiedBy', label: 'Disahkan oleh', value: (r) => r.verifiedBy, hideBelow: 1100 },
];
const BOARD_FILTERS: DtFilter<BoardRow>[] = [
  { id: 'status', label: 'Status', value: (r) => r.status, optionLabel: statusBm },
  {
    id: 'late',
    label: 'Lewat',
    value: (r) => (r.late ? 'yes' : 'no'),
    options: [
      { value: 'yes', label: 'Lewat' },
      { value: 'no', label: 'Tidak lewat' },
    ],
  },
];

function ReportTab({ scope, period }: { scope: string; period: string }) {
  const { data, error } = useLoad(() => send('reportView')({ scope, period }) as Promise<Report>, [scope, period]);
  const act = useAction();
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [ticks, setTicks] = useState<Record<string, string>>({});
  if (error) return <p className="muted">{error}</p>;
  if (!data) return <Loading what="monthly report" />;
  const co = scope.startsWith('co:') ? scope.slice(3) : null;
  return (
    <section className="panel">
      <div className="panel-head">
        <h3>
          Laporan bulanan {period} <Chip tone={STATUS_BM[data.status]?.[1] ?? 'neutral'}>{STATUS_BM[data.status]?.[0] ?? data.status}</Chip>
        </h3>
        <span className="muted small">
          Tarikh akhir {data.deadline ?? 'belum ditetapkan'} · disediakan {data.preparedBy ?? '-'} · disahkan {data.verifiedBy ?? '-'}
        </span>
      </div>
      {act.error && <p className="error">{act.error.message}</p>}
      {data.can.prepare || data.status === 'none' ? (
        <button className="btn btn-sm" disabled={act.busy} onClick={() => void act.run(() => send('reportBuild')({ scope, period }), 'Laporan dibina dari rekod.')}>
          Bina laporan dari rekod
        </button>
      ) : null}
      {data.items.map((it) => (
        <div key={it.key} className="item">
          <div className="item-main">
            <strong>
              {it.key}. {it.title}
            </strong>
            {(data.lines[it.key] ?? []).map((l, n) => (
              <div key={n} className="small" style={l.red ? { color: 'var(--crit, #b00)' } : undefined}>
                {l.text} <span className="muted">({l.source})</span>
              </div>
            ))}
            {data.notes[it.key] && <div className="small">Catatan: {data.notes[it.key]}</div>}
            {data.can.prepare && (
              <div style={{ display: 'flex', gap: 6 }}>
                <input className="input" aria-label={`Catatan ${it.key}`} placeholder="Status terkini" value={notes[it.key] ?? data.notes[it.key] ?? ''} onChange={(e) => setNotes((p) => ({ ...p, [it.key]: e.target.value }))} />
                <Select className="select" aria-label={`Tanda ${it.key}`} value={ticks[it.key] ?? data.ticks[it.key] ?? ''} onChange={(e) => setTicks((p) => ({ ...p, [it.key]: e.target.value }))}>
                  <option value="">-</option>
                  <option value="berubah">berubah</option>
                  <option value="tiada_perubahan">tiada perubahan</option>
                </Select>
              </div>
            )}
          </div>
        </div>
      ))}
      {data.lines.sulit && (
        <div className="item">
          <strong>SULIT</strong>
          {data.lines.sulit.map((l, n) => (
            <div key={n} className="small">
              {l.text}
            </div>
          ))}
        </div>
      )}
      {data.can.prepare && (
        <div style={{ display: 'flex', gap: 6 }}>
          <button className="btn btn-sm" disabled={act.busy} onClick={() => void act.run(() => send('reportSave')({ scope, period, notes, ticks }), 'Disimpan.')}>
            Simpan catatan
          </button>
          <button className="btn btn-sm" disabled={act.busy} onClick={() => void act.run(() => send('reportSubmit')({ scope, period }), 'Dihantar untuk pengesahan.')}>
            Hantar untuk pengesahan
          </button>
        </div>
      )}
      {data.can.verify && (
        <div style={{ display: 'flex', gap: 6 }}>
          <OpForm title="Sahkan laporan" op="reportDecide" send={send('reportDecide')} fixed={{ scope, period, verdict: 'verify' }} fields={[{ k: 'comment', l: 'Ulasan' }]} />
          <OpForm title="Kembalikan laporan" op="reportDecide" send={send('reportDecide')} fixed={{ scope, period, verdict: 'return' }} fields={[{ k: 'comment', l: 'Sebab' }]} />
        </div>
      )}
      {co && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
          <OpForm title="Kaedah bayaran gaji pengawal" op="payMethod" send={send('payMethod')} fixed={{ companyId: co, period }} fields={[{ k: 'transfer', l: 'Pindahan', t: 'number' }, { k: 'noAccount', l: 'Tiada akaun bank', t: 'number' }, { k: 'cash', l: 'Tunai', t: 'number' }, { k: 'note', l: 'Catatan' }]} />
          <OpForm title="Daftar JTK" op="jtk" send={send('jtk')} fixed={{ companyId: co }} fields={JTK} />
          <OpForm title="Laporan akaun dihantar" op="acctSent" send={send('acctSent')} fixed={{ companyId: co, period }} fields={[{ k: 'sentOn', l: 'Tarikh dihantar', t: 'date' }, { k: 'ref', l: 'Fail atau pautan laporan' }]} />
        </div>
      )}
    </section>
  );
}
const JTK: Field[] = [
  { k: 'type', l: 'Jenis', t: 'select', o: ['complaint', 'audit'], labels: { complaint: 'Aduan', audit: 'Audit' } },
  { k: 'ref', l: 'Rujukan JTK' },
  { k: 'receivedOn', l: 'Tarikh diterima', t: 'date' },
  { k: 'staffNo', l: 'No. pekerja (bukan nama)' },
  { k: 'amount', l: 'Amaun (RM)', t: 'number' },
  { k: 'hearingOn', l: 'Tarikh pendengaran', t: 'date' },
  { k: 'id', l: 'ID rekod (untuk kemas kini)' },
  { k: 'outcome', l: 'Keputusan' },
  { k: 'close', l: 'Tutup rekod ini', t: 'check' },
];

function AuditTab({ period, companies }: { period: string; companies: { scope: string; name: string }[] }) {
  const grid = useLoad(() => send('acctTracker')({ year: period.slice(0, 4) }) as Promise<{ months: string[]; rows: { companyId: string; name: string; cells: { period: string; state: string; lateDays: number | null }[] }[] }>, [period]);
  const ryg = useLoad(() => send('ryg')({}) as Promise<Ryg>, []);
  const act = useAction();
  if (grid.error) return <p className="muted">{grid.error}</p>;
  if (!grid.data) return <Loading what="accounts report tracker" />;
  const tone = (s: string) => (s === 'missing' ? 'crit' : s === 'late' ? 'warn' : s === 'reviewed' || s === 'sent' ? 'ok' : 'neutral');
  return (
    <section className="panel">
      <div className="panel-head">
        <h3>Penjejak laporan akaun {grid.data.months[0]?.slice(0, 4)}</h3>
        {ryg.data && (
          <span className="small">
            <Chip tone="crit">Merah {ryg.data.red}</Chip> <Chip tone="warn">Kuning {ryg.data.yellow}</Chip> <Chip tone="ok">Hijau {ryg.data.green}</Chip>
          </span>
        )}
      </div>
      {act.error && <p className="error">{act.error.message}</p>}
      <div style={{ display: 'flex', gap: 6 }}>
        <button className="btn btn-sm" disabled={act.busy} onClick={() => void act.run(() => send('rygFreeze')({}), 'Laporan Jumaat dihantar.')}>
          Hantar laporan Jumaat (merah/kuning/hijau)
        </button>
        <OpForm title="Semak laporan akaun" op="acctReview" send={send('acctReview')} fields={[companies.length ? { k: 'companyId', l: 'Syarikat', t: 'select', o: companies.map((c) => c.scope.slice(3)), labels: Object.fromEntries(companies.map((c) => [c.scope.slice(3), c.name])) } : { k: 'companyId', l: 'Syarikat (ID)' }, { k: 'period', l: 'Bulan (YYYY-MM)' }, { k: 'comment', l: 'Ulasan semakan' }]} />
      </div>
      <div className="list">
        {grid.data.rows.map((r) => (
          <div key={r.companyId} className="item">
            <div className="item-main">
              <strong>{r.name}</strong>{' '}
              {r.cells.map((c) => (
                <Chip key={c.period} tone={tone(c.state)} title={c.state}>
                  {c.period.slice(5)}
                  {c.lateDays ? ` +${c.lateDays}h` : ''}
                </Chip>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function DutiesTab({ scope, period, people }: { scope: string; period: string; people: PickPerson[] }) {
  const { data, error } = useLoad(() => send('duties')({ scope }) as Promise<Duties>, [scope]);
  const kpi = useLoad(() => send('dutyKpi')({ scope, month: period }) as Promise<{ people: { userId: string; name: string; due: number; onTime: number; onTimePct: number | null }[] }>, [scope, period]);
  if (error) return <p className="muted">{error}</p>;
  if (!data) return <Loading what="duty checklist" />;
  return (
    <section className="panel">
      <div className="panel-head">
        <h3>Senarai tugas harian, bulanan dan tahunan</h3>
        <span className="muted small">Baris yang siap dalam tempohnya dikira tepat masa dalam KPI orang itu.</span>
      </div>
      {data.can.keep && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <OpForm title="Muat templat kumpulan" op="dutyLoad" send={send('dutyLoad')} fixed={{ scope }} fields={[{ k: 'role', l: 'Templat', t: 'select', o: Object.keys(data.templates), labels: Object.fromEntries(Object.entries(data.templates).map(([k, n]) => [k, `${TEMPLATE_BM[k] ?? k} (${n} baris)`])) }, personField('picId', 'PIC', people), personField('backupId', 'Ganti', people), personField('checkerId', 'Penyemak (bukan PIC)', people)]} />
          <OpForm
            title="Tambah baris"
            op="dutyAdd"
            send={send('dutyAdd')}
            fixed={{ scope }}
            fields={[
              { k: 'text', l: 'Tugas' },
              { k: 'every', l: 'Kekerapan', t: 'select', o: ['daily', 'weekly', 'monthly', 'yearly', 'adhoc'], labels: EVERY_OPT },
              { k: 'fromDay', l: 'Dari hari (hb)', t: 'number' },
              { k: 'toDay', l: 'Hingga hari (hb)', t: 'number' },
              { k: 'month', l: 'Bulan (tahunan)', t: 'number' },
              { k: 'weekday', l: 'Hari (mingguan, 1-5)', t: 'number' },
              personField('picId', 'PIC', people),
              personField('backupId', 'Ganti', people),
              personField('checkerId', 'Penyemak (bukan PIC)', people),
              { k: 'sopRef', l: 'Rujukan SOP' },
            ]}
          />
        </div>
      )}
      {/* P107: tens of duty lines: a data table (search, Status / Tempoh / PIC filters, sort, pages; cards on a phone).
          "Buang baris" stays on each row for those who keep the list. */}
      <DataTable
        details
        label="Senarai tugas"
        stateKey="gm.duties"
        rows={data.lines}
        rowKey={(l) => l.id}
        columns={DUTY_COLUMNS}
        filters={DUTY_FILTERS}
        searchText={(l) => `${l.backupName ?? ''} ${l.checkerName ?? ''} ${l.sopRef} ${l.checkedBy ?? ''}`}
        phoneFacts={5}
        rowEnd={
          data.can.keep
            ? (l) => (
                <div style={{ display: 'inline-block', whiteSpace: 'normal', textAlign: 'left' }}>
                  <OpForm title="Buang baris" op="dutyEdit" send={send('dutyEdit')} fixed={{ id: l.id, remove: true }} fields={[{ k: 'reason', l: 'Sebab' }]} />
                </div>
              )
            : undefined
        }
        empty={<p className="muted">Tiada senarai tugas lagi: pelan peranan draf masih digunakan.</p>}
      />
      <CalendarBox cal={data.calendar} />
      {kpi.data && kpi.data.people.length > 0 && (
        <div className="list">
          <strong>KPI senarai tugas {period}</strong>
          {kpi.data.people.map((p) => (
            <div key={p.userId} className="small">
              {p.name}: {p.onTime}/{p.due} tepat masa ({p.onTimePct ?? '-'}%)
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

const DUTY_TONE: Record<string, 'ok' | 'warn' | 'crit' | 'neutral' | 'info'> = { disemak: 'ok', 'menunggu semakan': 'info', dikembalikan: 'warn', lewat: 'crit', terbuka: 'info', 'belum dibuka': 'neutral' };
type DutyLine = Duties['lines'][number];
const DUTY_COLUMNS: DtColumn<DutyLine>[] = [
  { id: 'no', label: 'No.', value: (l) => l.no, sort: 'number', width: '3.5rem', phone: 'hidden' },
  {
    id: 'text',
    label: 'Tugas',
    value: (l) => l.text,
    phone: 'title',
    render: (l) => (
      <span style={{ display: 'grid', gap: 2 }}>
        <strong>{l.text}</strong>
        {(l.backupName || l.checkerName || l.sopRef || l.checkedBy) && (
          <span className="muted small">
            {[l.backupName ? `ganti ${l.backupName}` : '', l.checkerName ? `penyemak ${l.checkerName}` : '', l.sopRef ? `SOP ${l.sopRef}` : '', l.checkedBy ? `disemak oleh ${l.checkedBy}` : '']
              .filter(Boolean)
              .join(' · ')}
          </span>
        )}
      </span>
    ),
  },
  { id: 'window', label: 'Tempoh', value: (l) => l.window, render: (l) => <Chip tone="neutral">{l.window}</Chip> },
  { id: 'status', label: 'Status', value: (l) => l.status, render: (l) => <Chip tone={DUTY_TONE[l.status] ?? 'neutral'}>{l.status}</Chip> },
  { id: 'pic', label: 'PIC', value: (l) => l.picName },
  { id: 'target', label: 'Sasaran', value: (l) => l.target, render: (l) => l.target ?? '-', hideBelow: 1100 },
  { id: 'done', label: 'Siap', value: (l) => l.doneOn, render: (l) => l.doneOn ?? '-', hideBelow: 1100 },
];
const DUTY_FILTERS: DtFilter<DutyLine>[] = [
  { id: 'status', label: 'Status', value: (l) => l.status },
  { id: 'window', label: 'Tempoh', value: (l) => l.window },
  { id: 'pic', label: 'PIC', value: (l) => l.picName },
];
const EVERY_BM: Record<string, string> = { monthly: 'setiap bulan', bimonthly: 'setiap 2 bulan', twice: 'dua kali sebulan', weekly: 'setiap minggu' };

/** Part Z2: the group monthly calendar. Unit HR or the Director Office changes it with a reason (one line each: text; from; to; every; weekday). */
function CalendarBox({ cal }: { cal: Calendar }) {
  const parse = (i: Record<string, unknown>) => {
    const items = String(i.lines ?? '')
      .split('\n')
      .map((x) => x.trim())
      .filter(Boolean)
      .map((x) => {
        const [text, fromDay, toDay, every, weekday] = x.split(';').map((y) => y.trim());
        return { text, fromDay: fromDay || undefined, toDay: toDay || undefined, every: every || undefined, weekday: weekday || undefined };
      });
    return send('setCalendar')({ items, reason: i.reason });
  };
  const current = cal.items.map((c) => [c.text, c.fromDay ?? '', c.toDay ?? '', c.every ?? '', c.weekday ?? ''].join('; ')).join('\n');
  return (
    <div className="list">
      <strong>Kalendar bulanan kumpulan</strong>
      {cal.items.map((c) => (
        <div key={c.id} className="small">
          {c.text}: {c.every === 'weekly' ? `setiap minggu (hari ${c.weekday})` : c.every === 'twice' ? 'dua kali sebulan' : `${c.fromDay}${c.toDay && c.toDay !== c.fromDay ? `-${c.toDay}` : ''}hb ${EVERY_BM[c.every ?? 'monthly']}`}
        </div>
      ))}
      <span className="muted small">{cal.changedBy ? `Diubah oleh ${cal.changedBy} (${cal.reason ?? ''})` : 'Nilai asal dari fail syarikat (14 Nov 2026).'}</span>
      <OpForm
        title="Ubah kalendar (HR / Pejabat Pengarah)"
        op="setCalendar"
        send={parse}
        fields={[
          { k: 'lines', l: `Satu baris setiap perkara: teks; dari hb; hingga hb; monthly/bimonthly/twice/weekly; hari (1-5). Sekarang:\n${current}`, t: 'area' },
          { k: 'reason', l: 'Sebab' },
        ]}
      />
    </div>
  );
}

const reg = (op: string) => (i: Record<string, unknown>) => api.registerAct(op, i);
const REG_STATUS: Record<string, [string, 'ok' | 'warn' | 'crit' | 'neutral' | 'info']> = { submitted: ['Menunggu semakan', 'info'], returned: ['Dikembalikan', 'warn'], checked: ['Disemak', 'ok'], closed: ['Direkod', 'ok'] };

/** Part Z4-Z13: the duty map registers (records only; no provider is connected and Prima moves no money). */
function RegistersTab({ companyId, people }: { companyId: string; people: PickPerson[] }) {
  const [kind, setKind] = useState('');
  const { data, error } = useLoad(() => reg('board')({ companyId }) as Promise<RegBoard>, [companyId]);
  if (error) return <p className="muted">{error}</p>;
  if (!data) return <Loading what="registers" />;
  return (
    <section className="panel">
      <div className="panel-head">
        <h3>Daftar tugas syarikat dan unit</h3>
        <span className="muted small">Rekod sahaja: nombor pekerja, bukan nama; tiada nombor IC atau akaun bank. Penyedia tidak menyemak rekodnya sendiri.</span>
      </div>
      {!companyId && <p className="muted small">Pilih syarikat di atas untuk daftar syarikat; daftar unit dipaparkan di bawah.</p>}
      <div className="list">
        {data.registers.map((r) => (
          <div key={`${r.kind}-${r.companyId ?? 'g'}`} className="item">
            <div className="item-main">
              <button className="btn btn-sm" onClick={() => setKind(r.kind)} aria-pressed={kind === r.kind}>
                {r.label}
              </button>{' '}
              <Chip tone="neutral">{r.item}</Chip> <span className="small">{r.rows} rekod</span>
              {r.toCheck > 0 && <Chip tone="info">{r.toCheck} untuk anda semak</Chip>}
              {r.missing && <Chip tone="warn">Belum direkod ({r.missing})</Chip>}
            </div>
          </div>
        ))}
        {!data.registers.length && <p className="muted">Tiada daftar untuk anda di sini.</p>}
      </div>
      {data.contractsDue.length > 0 && (
        <div className="list">
          <strong>Kontrak tamat dalam 90 hari tanpa notis</strong>
          {data.contractsDue.map((c) => (
            <div key={c.ref} className="small">
              {c.ref} {c.client}: tamat {c.endOn} ({c.daysLeft} hari)
            </div>
          ))}
        </div>
      )}
      {data.newCompany && (
        <div className="list">
          <strong>Persediaan syarikat baharu</strong>
          {data.newCompany.map((x) => (
            <div key={x.step} className="small">
              {x.step}: {x.state === 'done' ? 'siap' : x.state === 'to check' ? 'untuk disemak' : 'belum'}
            </div>
          ))}
        </div>
      )}
      {data.rentalMonth && (
        <div className="list">
          <strong>Laporan sewaan bulan {data.rentalMonth.month}</strong>
          <div className="small">
            Rumah {data.rentalMonth.homes} · kosong {data.rentalMonth.vacant} · akan keluar {data.rentalMonth.leaving} · pembaikan dibayar RM{data.rentalMonth.repairPaid.toFixed(2)} · bajet {data.rentalMonth.repairBudget == null ? 'belum ditetapkan' : `RM${data.rentalMonth.repairBudget.toFixed(2)}`}
            {data.rentalMonth.over ? ' · melebihi bajet' : ''}
          </div>
        </div>
      )}
      <OpForm title="Tetapkan pelulus tabung kebajikan (CoS / DCoS)" op="setApprover" send={reg('setApprover')} fields={[personField('userId', 'Pelulus', people), { k: 'reason', l: 'Sebab' }]} />
      {kind && <RegisterList kind={kind} companyId={companyId} />}
    </section>
  );
}

function RegisterList({ kind, companyId }: { kind: string; companyId: string }) {
  const { data, error } = useLoad(() => reg('list')({ kind, companyId }) as Promise<RegList>, [kind, companyId]);
  if (error) return <p className="muted">{error}</p>;
  if (!data) return <Loading what="register" />;
  const fields: Field[] = data.spec.fields.map((f) => ({ k: f.k, l: `${f.l}${f.req ? ' *' : ''}`, t: f.t ?? 'text', o: f.o }) as Field);
  const fixed = { kind, ...(data.spec.scope === 'company' ? { companyId } : {}) };
  // P107: the register's own fields are the columns (as the server's spec lists them), then status and who prepared
  // and checked it. Values show as typed, as before; a blank shows a dash.
  const shown = (v: unknown) => (v == null || v === '' ? '–' : String(v));
  const fieldCols: DtColumn<RegRow>[] = data.spec.fields.map(
    (f, i): DtColumn<RegRow> => ({
      id: `f:${f.k}`,
      label: f.l,
      value: (r) => (r[f.k] == null || r[f.k] === '' ? null : f.t === 'number' && Number.isFinite(Number(r[f.k])) ? Number(r[f.k]) : String(r[f.k])),
      sort: f.t === 'number' ? 'number' : f.t === 'date' ? 'date' : 'text',
      render: (r) => shown(r[f.k]),
      phone: i === 0 ? 'title' : 'fact',
      hideBelow: i >= 4 ? 1200 : undefined,
    }),
  );
  const statusCol: DtColumn<RegRow> = {
    id: 'status',
    label: 'Status',
    value: (r) => REG_STATUS[r.status]?.[0] ?? r.status,
    render: (r) => {
      const [label, tone] = REG_STATUS[r.status] ?? [r.status, 'neutral'];
      return <Chip tone={tone}>{label}</Chip>;
    },
  };
  const columns: DtColumn<RegRow>[] = [
    ...fieldCols.slice(0, 1),
    statusCol,
    ...fieldCols.slice(1),
    { id: 'preparedBy', label: 'Disediakan oleh', value: (r) => shown(r.preparedBy), hideBelow: 1100 },
    {
      id: 'checkedBy',
      label: 'Disemak oleh',
      value: (r) => (r.checkedBy ? String(r.checkedBy) : null),
      render: (r) => (r.checkedBy ? `${String(r.checkedBy)} (${String(r.checkedOn ?? '')})` : '–'),
      hideBelow: 1100,
    },
  ];
  const filters: DtFilter<RegRow>[] = [{ id: 'status', label: 'Status', value: (r) => r.status, optionLabel: (s) => REG_STATUS[s]?.[0] ?? s }];
  return (
    <div className="list" style={{ gap: 8 }}>
      <strong>
        {data.spec.label}
        {data.spec.confidential ? ' (SULIT)' : ''}
      </strong>
      {data.can.add && <OpForm title="Tambah rekod" op="put" send={reg('put')} fixed={fixed} fields={fields} />}
      {/* P107: tens to hundreds of records: a data table (search, Status filter, sort, pages; cards on a phone). The fix,
          check and return forms sit under their row, as they did inside it. */}
      <DataTable
        details
        label={data.spec.label}
        stateKey={`gm.register.${kind}`}
        rows={data.rows}
        rowKey={(r) => r.id}
        columns={columns}
        filters={filters}
        rowDetail={(r) =>
          (data.can.add && r.status === 'returned') || r.canCheck ? (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'flex-start' }}>
              {data.can.add && r.status === 'returned' && <OpForm title="Betulkan dan hantar semula" op="put" send={reg('put')} fixed={{ ...fixed, id: r.id }} fields={fields} />}
              {r.canCheck && (
                <span style={{ display: 'inline-flex', gap: 6 }}>
                  <OpForm title="Semak" op="check" send={reg('check')} fixed={{ id: r.id, verdict: 'check' }} fields={[{ k: 'comment', l: 'Ulasan' }]} />
                  <OpForm title="Kembalikan" op="check" send={reg('check')} fixed={{ id: r.id, verdict: 'return' }} fields={[{ k: 'comment', l: 'Sebab' }]} />
                </span>
              )}
            </div>
          ) : null
        }
        empty={<p className="muted small">Tiada rekod lagi.</p>}
      />
    </div>
  );
}
type RegRow = RegList['rows'][number];
