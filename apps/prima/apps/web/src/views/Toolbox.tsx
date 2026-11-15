import { useState } from 'react';
import { api } from '../api';
import { saveFile } from '../save';
import { Chip, Loading, dateLabel, useAction, useLoad } from '../ui';
import { CentralAdminGuide } from './CentralAdminGuide';
import { OpForm, type Field } from './ItPolicyPanel';

/**
 * Mesyuarat Toolbox (Part X, Fauzan's answers 14 Nov 2026): every company and every central department meets every
 * 2 weeks with the standard agenda. Prima builds the status pack from the company's or department's own records and
 * freezes it; status lines carry forward; the preparer submits and the director who chairs (else the company manager;
 * the department head; or the visiting central director) verifies with a comment. Minutes from Microsoft Loop or Notes
 * are pasted or uploaded, never fetched. The OM's site safety and operations talks are recorded here too.
 * Every rule is checked again on the server; this screen only offers the steps.
 */

type PackLine = { text: string; source: string; red?: boolean };
type View = {
  meetingId: string;
  title: string;
  start: string;
  scope: string;
  bil: string;
  agenda: { key: string; title: string; source: string; own?: boolean }[];
  pack: Record<string, PackLine[]> | null;
  packAt: string | null;
  ticks: Record<string, string>;
  status: string;
  text: string | null;
  aiNotes: { text: string; checked: boolean; docNames: string[] } | null;
  preparedBy: string | null;
  verifiedBy: string | null;
  versions: number;
  lines: { id: string; section: string; matter: string; status: string; ownerName: string | null; target: string | null; stale: number }[];
  can: { prepare: boolean; verify: boolean };
};
type Board = {
  rows: { scope: string; name: string; lastMeeting: string | null; late: boolean; openLines: number; staleMax: number; tell: string | null; red: number; director: string | null; directorVisit: string; directorMissed: boolean }[];
  can: { rotation: boolean; central: boolean };
};
type Talks = { days: number; rows: { siteId: string; siteName: string; state: string | null; last: string | null; due: boolean }[] };

const send = (op: string) => (i: Record<string, unknown>) => api.toolboxAct(op, i);
const STATUS: readonly string[] = ['baru', 'dalam_proses', 'menunggu', 'selesai', 'tiada'];

export function ToolboxPanel({ meetings }: { meetings: { id: string; title: string; start: string; kind: string; seriesKey?: string | null }[] }) {
  const { data } = useLoad(() => api.toolboxAct('board', {}) as Promise<Board>, []);
  const talks = useLoad(() => api.toolboxAct('siteTalks', {}) as Promise<Talks>, []);
  const [open, setOpen] = useState<string | null>(null);
  const mine = meetings.filter((m) => m.kind === 'toolbox' || m.seriesKey?.startsWith('co-office:') || m.seriesKey?.startsWith('dept-toolbox:'));
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <CentralAdminGuide view="meetings" />
      {data && (
        <section className="panel">
          <div className="panel-head">
            <h3>Mesyuarat Toolbox: syarikat dan jabatan</h3>
            <span className="muted small">Setiap 2 minggu; pengarah pusat hadir sekali setiap 2 bulan</span>
          </div>
          <div className="list">
            {data.rows.map((r) => (
              <div key={r.scope} className="item">
                <div className="item-main">
                  <strong>{r.name}</strong> {r.late ? <Chip tone="warn">Belum disahkan dalam 2 minggu</Chip> : <Chip tone="ok">Terkini</Chip>}{' '}
                  {r.directorMissed && <Chip tone="crit">Lawatan pengarah pusat: tiada</Chip>}
                  <div className="muted small">
                    Terakhir {r.lastMeeting ? dateLabel(r.lastMeeting) : 'tiada'} · baris terbuka {r.openLines}
                    {r.staleMax ? ` · tiada perubahan ${r.staleMax} mesyuarat` : ''}
                    {r.tell ? ` · dimaklumkan kepada ${r.tell}` : ''} · merah {r.red} · pengarah {r.director ?? 'belum ditetapkan'}
                  </div>
                  {data.can.rotation && (
                    <OpForm title="Tetapkan pengarah pusat" op="rotation" send={send('rotation')} fixed={{ scope: r.scope }} fields={[{ k: 'directorId', l: 'Pengarah (ID pengguna)' }, { k: 'reason', l: 'Sebab' }]} />
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
      <section className="panel">
        <div className="panel-head">
          <h3>Mesyuarat toolbox saya</h3>
        </div>
        <div className="list">
          {mine.length === 0 && <p className="muted">Tiada mesyuarat toolbox. Tetapkannya dari "Regular meetings".</p>}
          {mine.map((m) => (
            <button key={m.id} className="list-item list-button" onClick={() => setOpen(open === m.id ? null : m.id)}>
              <span>
                {m.title} · {dateLabel(m.start.slice(0, 10))}
              </span>
            </button>
          ))}
        </div>
        {open && <ToolboxMeeting id={open} />}
      </section>
      {talks.data && (
        <section className="panel">
          <div className="panel-head">
            <h3>Taklimat toolbox tapak (OM)</h3>
            <span className="muted small">Setiap tapak sekurang-kurangnya sekali dalam {talks.data.days} hari</span>
          </div>
          <div className="list">
            {talks.data.rows.slice(0, 40).map((r) => (
              <div key={r.siteId} className="item">
                <div className="item-main">
                  {r.siteName} {r.due ? <Chip tone="warn">Belum ada taklimat</Chip> : <Chip tone="ok">{dateLabel(r.last!)}</Chip>}
                  <OpForm
                    title="Rekod taklimat"
                    op="siteTalk"
                    send={send('siteTalk')}
                    fixed={{ siteId: r.siteId }}
                    fields={[
                      { k: 'safety', l: 'Topik keselamatan' },
                      { k: 'ops', l: 'Perkara operasi (pisah dengan koma)', t: 'list' },
                      { k: 'headcount', l: 'Bilangan pengawal hadir', t: 'number' },
                      { k: 'photos', l: 'Foto di tapak (masa dan GPS)', t: 'photos' },
                      { k: 'issues', l: 'Isu dibangkitkan (pisah dengan koma)', t: 'list' },
                    ]}
                  />
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function ToolboxMeeting({ id }: { id: string }) {
  const { data, error } = useLoad(() => api.toolboxAct('view', { meetingId: id }) as Promise<View>, [id]);
  const act = useAction();
  const [text, setText] = useState<string | null>(null);
  if (error) return <p className="notice" data-tone="warn">{error}</p>;
  if (!data) return <Loading what="toolbox" />;
  const M = { meetingId: id };
  const locked = data.status === 'submitted' || data.status === 'verified';
  const tick = (key: string, v: 'changed' | 'nochange') => act.run(() => api.toolboxAct('draft', { ...M, ticks: { [key]: v } }), 'Disimpan.');
  const pdf = () =>
    act.run(async () => {
      const p = (await api.toolboxAct('pdf', M)) as { name: string; base64: string };
      await saveFile(p.name, `data:application/pdf;base64,${p.base64}`);
      return p;
    }, 'Minit dimuat turun.');
  const lineFields: Field[] = [
    { k: 'section', l: 'Seksyen', t: 'select', o: data.agenda.map((a) => a.key) },
    { k: 'matter', l: 'Perkara' },
    { k: 'status', l: 'Status', t: 'select', o: STATUS },
    { k: 'ownerId', l: 'Pemilik (ID pengguna, pilihan)' },
    { k: 'target', l: 'Tarikh sasaran', t: 'date' },
    { k: 'note', l: 'Nota' },
  ];
  return (
    <div className="panel" style={{ marginTop: 8 }}>
      <strong>
        {data.title} · {data.bil}
      </strong>{' '}
      <Chip tone={data.status === 'verified' ? 'ok' : data.status === 'submitted' ? 'info' : 'neutral'}>{data.status}</Chip>
      <div className="muted small">
        {data.packAt ? `Data setakat ${data.packAt.slice(0, 16).replace('T', ' ')}` : 'Pek status belum dibina'}
        {data.preparedBy ? ` · disediakan oleh ${data.preparedBy}` : ''}
        {data.verifiedBy ? ` · disahkan oleh ${data.verifiedBy}` : ''}
        {data.versions ? ` · ${data.versions} versi lama` : ''}
      </div>
      <div className="row">
        {data.can.prepare && !locked && (
          <button className="btn btn-sm" disabled={act.busy} onClick={() => void act.run(() => api.toolboxAct('build', M), 'Pek status dibina.')}>
            Bina pek status
          </button>
        )}
        {data.can.prepare && <OpForm title="Baris status" op="line" send={send('line')} fixed={{ scope: data.scope }} fields={lineFields} />}
        {data.status === 'verified' && (
          <button className="btn btn-sm" disabled={act.busy} onClick={() => void pdf()}>
            Minit (PDF)
          </button>
        )}
      </div>
      {data.agenda.map((a) => (
        <div key={a.key} style={{ marginTop: 6 }}>
          <strong>
            {a.key}) {a.title}
          </strong>{' '}
          {data.ticks[a.key] ? <Chip tone="ok">{data.ticks[a.key].startsWith('nochange') ? 'tiada perubahan' : 'berubah'}</Chip> : null}
          {data.can.prepare && !locked && data.packAt && (
            <>
              {' '}
              <button className="btn btn-sm" onClick={() => void tick(a.key, 'changed')}>
                Berubah
              </button>{' '}
              <button className="btn btn-sm" onClick={() => void tick(a.key, 'nochange')}>
                Tiada perubahan
              </button>
            </>
          )}
          <ul className="small">
            {(data.pack?.[a.key] ?? []).map((l, i) => (
              <li key={i} style={l.red ? { color: 'var(--crit, #b42318)' } : undefined}>
                {l.text} <span className="muted">[{l.source}]</span>
              </li>
            ))}
            {data.lines
              .filter((l) => l.section === a.key)
              .map((l) => (
                <li key={l.id}>
                  {l.matter}: {l.status}
                  {l.ownerName ? ` · ${l.ownerName}` : ''}
                  {l.target ? ` · sasaran ${l.target}` : ''}
                  {l.stale >= 3 ? ` · tiada perubahan ${l.stale} mesyuarat` : ''}
                  {data.can.prepare && <OpForm title="Kemas kini" op="line" send={send('line')} fixed={{ scope: data.scope, id: l.id }} fields={[{ k: 'status', l: 'Status', t: 'select', o: STATUS }, { k: 'note', l: 'Nota' }]} />}
                </li>
              ))}
          </ul>
        </div>
      ))}
      {data.text !== null && (
        <div style={{ marginTop: 8 }}>
          <strong>Minit</strong>
          <textarea rows={6} style={{ width: '100%' }} disabled={locked || !data.can.prepare} value={text ?? data.text} onChange={(e) => setText(e.target.value)} />
          {data.aiNotes && (
            <p className="small">
              {data.aiNotes.checked ? <Chip tone="ok">Nota AI disemak</Chip> : <Chip tone="warn">Nota AI - belum disemak</Chip>} {data.aiNotes.docNames.join(', ')}
            </p>
          )}
          {data.can.prepare && !locked && (
            <div className="row">
              <button className="btn btn-sm" disabled={act.busy || text === null} onClick={() => void act.run(() => api.toolboxAct('draft', { ...M, text }), 'Draf disimpan.')}>
                Simpan draf
              </button>
              <OpForm title="Tampal / muat naik nota AI (Loop, Notes)" op="draft" send={send('draft')} fixed={M} fields={[{ k: 'aiText', l: 'Teks nota AI', t: 'area' }, { k: 'aiFile', l: 'Fail eksport', t: 'proof' }]} />
              {data.aiNotes && !data.aiNotes.checked && <OpForm title="Saya sudah semak nota AI" op="draft" send={send('draft')} fixed={{ ...M, aiChecked: true }} fields={[]} />}
              <OpForm title="Hantar untuk pengesahan" op="submit" send={send('submit')} fixed={M} fields={[{ k: 'sameReason', l: 'Sebab jika sama seperti mesyuarat lepas' }, { k: 'datesReason', l: 'Sebab jika ada tarikh selepas mesyuarat' }]} />
            </div>
          )}
        </div>
      )}
      <div className="row" style={{ marginTop: 6 }}>
        {data.can.verify && <OpForm title="Sahkan" op="verify" send={send('verify')} fixed={M} fields={[{ k: 'comment', l: 'Ulasan' }]} done="Disahkan." />}
        {data.can.verify && <OpForm title="Kembalikan" op="verify" send={send('verify')} fixed={{ ...M, return: true }} fields={[{ k: 'comment', l: 'Sebab' }]} />}
        {data.status === 'verified' && data.can.prepare && <OpForm title="Pembetulan (versi baharu)" op="correct" send={send('correct')} fixed={M} fields={[{ k: 'reason', l: 'Sebab' }]} />}
        <OpForm title="Ulasan pengarah" op="remarks" send={send('remarks')} fixed={M} fields={[{ k: 'text', l: 'Ulasan' }]} />
      </div>
      {data.scope.startsWith('co:') && <Registers companyId={data.scope.slice(3)} />}
    </div>
  );
}

/** X8 and X18: the registers the minutes need, per company (each form is refused on the server for the wrong person). */
function Registers({ companyId }: { companyId: string }) {
  const C = { companyId };
  return (
    <div className="row" style={{ marginTop: 6, flexWrap: 'wrap' }}>
      <OpForm
        title="Cawangan KDN negeri"
        op="branch"
        send={send('branch')}
        fixed={C}
        fields={[
          { k: 'state', l: 'Negeri' },
          { k: 'zone', l: 'Zon' },
          { k: 'address', l: 'Alamat penuh' },
          { k: 'kdnStatus', l: 'Status KDN', t: 'select', o: ['lulus', 'dalam_proses', 'batal'] },
          { k: 'pbtStatus', l: 'Status lesen PBT' },
          { k: 'vault', l: 'Bilik kebal', t: 'check' },
          { k: 'chosen', l: 'Cawangan pilihan zon', t: 'check' },
          { k: 'chosenOn', l: 'Tarikh keputusan', t: 'date' },
          { k: 'chosenReason', l: 'Sebab' },
        ]}
      />
      <OpForm
        title="Penama MOF"
        op="nominee"
        send={send('nominee')}
        fixed={C}
        fields={[
          { k: 'name', l: 'Nama (tanpa nombor IC)' },
          { k: 'position', l: 'Jawatan' },
          { k: 'record', l: 'Rekod MOF' },
          { k: 'addedOn', l: 'Tarikh ditambah', t: 'date' },
          { k: 'removalRequestedOn', l: 'Mohon dikeluarkan', t: 'date' },
          { k: 'removedOn', l: 'Dikeluarkan', t: 'date' },
          { k: 'docs', l: 'Dokumen MOF (IC hanya di sini)', t: 'proof' },
        ]}
      />
      <OpForm
        title="Tuntutan PGM"
        op="pgm"
        send={send('pgm')}
        fixed={C}
        fields={[
          { k: 'contractRef', l: 'Kontrak' },
          { k: 'pgmYear', l: 'Tahun PGM', t: 'number' },
          { k: 'zone', l: 'Zon' },
          { k: 'appliedOn', l: 'Tarikh mohon', t: 'date' },
          { k: 'approvedOn', l: 'Tarikh lulus', t: 'date' },
          { k: 'approvedAmount', l: 'Amaun lulus RM', t: 'number' },
          { k: 'receivedOn', l: 'Tarikh terima', t: 'date' },
          { k: 'receivedAmount', l: 'Amaun diterima RM', t: 'number' },
        ]}
      />
      <OpForm
        title="SULIT: perkara atas nama individu (Kewangan)"
        op="personal"
        send={send('personal')}
        fixed={C}
        fields={[
          { k: 'what', l: 'Perkara' },
          { k: 'name', l: 'Atas nama' },
          { k: 'amount', l: 'Amaun RM', t: 'number' },
          { k: 'paidOn', l: 'Tarikh bayar', t: 'date' },
          { k: 'assetRef', l: 'Aset syarikat berkaitan' },
          { k: 'note', l: 'Nota Kewangan' },
        ]}
      />
    </div>
  );
}
