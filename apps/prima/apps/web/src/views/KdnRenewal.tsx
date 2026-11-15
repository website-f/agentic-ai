import { api } from '../api';
import { Chip, Loading, dateLabel, useAction, useLoad } from '../ui';
import { OpForm, type Field } from './ItPolicyPanel';

/**
 * Pembaharuan Lesen KDN 2027 (Part W, Fauzan's answers 14 Nov 2026). KDN's own yearly checklist as the paper list,
 * each paper with its file and date check, the eSIMS update, the appointment in a Hari Bertemu Pelanggan session and
 * the result of the day, the counts the company head confirms, Nepali guards in eSIMS, Finance's SST tick, the
 * director's signature and the pendrive pack. Prima records only: it never logs in to eSIMS, lodges or pays.
 * Every rule is checked again on the server; this panel only offers the steps.
 */

type Paper = { item: string; label: string; form: 'hardcopy' | 'softcopy'; name: string; done: boolean; na: string | null; files: string[] };
type Row = {
  licenceId: string;
  companyId: string;
  companyName: string;
  reference: string;
  expiresOn: string | null;
  stage: 'not_opened' | 'papers' | 'signed' | 'appointment' | 'accepted' | 'renewed';
  papers: { ready: number; of: number };
  missing: string[];
  appointment: { session: number; on: string; time: string; ref: string; attendee: string } | null;
  results: { kind: string; on: string; lacking: string[] }[];
  sst: { on: string; ref: string } | null;
  counts: { csg: { notTrained: number; unknown: number }; tng: { notTrained: number; unknown: number }; local: number; nepali: number; by: string } | null;
  liveCounts: { csg: { notTrained: number; unknown: number }; tng: { notTrained: number; unknown: number }; local: number; nepali: number } | null;
  nepali: { entered: number; total: number };
  twoB: boolean;
  investigators: boolean;
  esims: boolean;
  checked: boolean;
  director: { name: string; position: string } | null;
  counter: boolean;
  signBlocks: string[];
  countdown: { nextSession: { no: number; from: string; to: string } | null; daysToNext: number | null; daysToClose: number; open: boolean };
  late: 'DCoS' | 'CoS' | 'CEO' | null;
  hints: Record<string, string[]> | null;
  papersDetail: Paper[] | null;
};
type Board = {
  window: { year: number; opens: string; closes: string; sessions: { no: number; from: string; to: string }[]; returnOnlySessions: number[]; place?: string };
  giftLine: { bm: string; en: string };
  declaration: { bm: string; en: string };
  rows: Row[];
  pledges: { filed: number; of: number };
  can: { central: boolean; finance: boolean; fwm: boolean };
};

const STAGE: Record<Row['stage'], ['crit' | 'warn' | 'info' | 'ok' | 'neutral', string]> = {
  not_opened: ['warn', 'Belum dibuka'],
  papers: ['info', 'Menyediakan dokumen'],
  signed: ['info', 'Ditandatangani pengarah'],
  appointment: ['info', 'Janji temu ditetapkan'],
  accepted: ['ok', 'Lengkap, diterima KDN'],
  renewed: ['ok', 'Diperbaharui'],
};

const send = (op: string) => (i: Record<string, unknown>) => api.kdnAct(op, i);

function paperFields(p: Paper): Field[] {
  const f: Field[] = [];
  const item = p.item;
  if (item === '1.2' || item === '1.3') f.push({ k: 'docDate', l: 'Tarikh pada dokumen', t: 'date' });
  if (item === '3.1' || item === '3.2') f.push({ k: 'from', l: 'Bulan pertama (YYYY-MM)' }, { k: 'to', l: 'Bulan terakhir (YYYY-MM)' });
  if (item === '3.3' || item === '3.4' || item === '3.5') f.push({ k: 'year', l: 'Tahun dokumen', t: 'number' });
  if (item === '3.3') f.push({ k: 'both', l: 'Kedua-dua CP204 dan SST dilampirkan', t: 'check' });
  if (item === '3.7') f.push({ k: 'month', l: 'Bulan penyata (YYYY-MM)' });
  if (item === '1.4') f.push({ k: 'signer', l: 'Pengarah yang menandatangani' });
  f.push({ k: 'docs', l: p.form === 'softcopy' ? 'Fail PDF' : 'Imbasan salinan bertandatangan', t: 'proof' }, { k: 'ref', l: 'Nota (pilihan)' });
  return f;
}

export function KdnRenewalPanel() {
  const { data, error } = useLoad(() => api.kdnAct('board', {}) as Promise<Board>, []);
  if (error) return null; // not this person's screen
  if (!data) return <Loading what="KDN renewal" />;
  const w = data.window;
  return (
    <section className="panel">
      <div className="panel-head">
        <h3>Pembaharuan Lesen KDN {w.year}</h3>
        <span className="muted small">
          Tetingkap {dateLabel(w.opens)} hingga {dateLabel(w.closes)} · Ikrar anti rasuah {data.pledges.filed}/{data.pledges.of}
        </span>
      </div>
      <p className="muted small">
        Sesi Hari Bertemu Pelanggan:{' '}
        {w.sessions.map((s) => `${s.no}: ${dateLabel(s.from)}-${dateLabel(s.to)}${w.returnOnlySessions.includes(s.no) ? ' (dikembalikan sahaja)' : ''}`).join(' · ')}
      </p>
      <p className="notice" data-tone="info">
        Prima merekod sahaja: tiada log masuk eSIMS, tiada penghantaran dan tiada bayaran dari sini. {data.giftLine.bm}
      </p>
      <div className="list">
        {data.rows.length === 0 && <p className="muted">Tiada lesen KDN.</p>}
        {data.rows.map((r) => (
          <KdnRow key={r.licenceId} r={r} b={data} />
        ))}
      </div>
    </section>
  );
}

function KdnRow({ r, b }: { r: Row; b: Board }) {
  const act = useAction();
  const [tone, label] = STAGE[r.stage];
  const own = r.papersDetail !== null && r.hints !== null;
  const L = { licenceId: r.licenceId };
  const pack = () =>
    act.run(async () => {
      const p = (await api.kdnAct('pack', L)) as { name: string; base64: string };
      const bin = atob(p.base64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([bytes], { type: 'application/zip' }));
      a.download = p.name;
      a.click();
      return p;
    }, 'Pek pendrive dimuat turun.');
  return (
    <div className="item">
      <div className="item-main">
        <strong>{r.companyName}</strong> <Chip tone={tone}>{label}</Chip> {r.late && <Chip tone="crit">Lewat: kepada {r.late}</Chip>}
        <div className="muted small">
          {r.reference} · tamat {r.expiresOn ? dateLabel(r.expiresOn) : 'tiada rekod'} · dokumen {r.papers.ready}/{r.papers.of}
          {r.appointment ? ` · janji temu sesi ${r.appointment.session}, ${dateLabel(r.appointment.on)} ${r.appointment.time}` : r.countdown.nextSession ? ` · sesi seterusnya ${r.countdown.nextSession.no} dalam ${r.countdown.daysToNext} hari` : ''}
          {` · SST ${r.sst ? 'disahkan' : 'belum'} · Nepal eSIMS ${r.nepali.entered}/${r.nepali.total}`}
          {r.counter ? ' · dihantar di kaunter (akan lewat)' : ''}
        </div>
        {r.signBlocks.length > 0 && r.stage !== 'not_opened' && <p className="small muted">Sebelum tandatangan: {r.signBlocks.join('; ')}.</p>}
        {r.papersDetail && r.papersDetail.length > 0 && (
          <ul className="small">
            {r.papersDetail.map((p) => (
              <li key={p.item}>
                {p.done ? '✓' : '○'} {p.item} (label {p.label}, {p.form === 'hardcopy' ? 'HARDCOPY' : 'PDF'}) {p.name}
                {p.na ? ` · tidak berkenaan: ${p.na}` : ''}
                {p.files.length ? ` · ${p.files.length} fail` : ''}
                {r.hints?.[p.item] && <div className="muted">Petunjuk Prima: {r.hints[p.item].join('; ')}</div>}
                {own && !p.done && p.item !== '1.1' && p.item !== 'Akhir' && r.stage === 'papers' && (
                  <div className="row">
                    <OpForm title="Sedia" op="paper" send={send('paper')} fixed={{ ...L, item: p.item }} fields={paperFields(p)} done="Dokumen disimpan." />
                    {p.item === '2.1' && <OpForm title="Tidak berkenaan" op="paper" send={send('paper')} fixed={{ ...L, item: p.item, na: true }} fields={[{ k: 'reason', l: 'Sebab' }]} />}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
        {r.liveCounts && !r.counts && (
          <p className="small">
            CSG belum berlatih {r.liveCounts.csg.notTrained} (tiada rekod {r.liveCounts.csg.unknown}) · TNG belum berlatih {r.liveCounts.tng.notTrained} (tiada rekod {r.liveCounts.tng.unknown}) · {r.liveCounts.nepali} pengawal Nepal tidak dikira
          </p>
        )}
        {r.counts && (
          <p className="small">
            Disahkan oleh {r.counts.by}: CSG {r.counts.csg.notTrained}, TNG {r.counts.tng.notTrained}
          </p>
        )}
        {r.director && <p className="small">Ditandatangani: {r.director.name} ({r.director.position})</p>}
        <div className="row">
          {r.stage === 'not_opened' && own !== false && <OpForm title="Buka pembaharuan KDN" op="open" send={send('open')} fixed={L} fields={[]} />}
          {r.stage !== 'not_opened' && own && (
            <>
              {!r.esims && <OpForm title="eSIMS dikemas kini" op="esims" send={send('esims')} fixed={L} fields={[{ k: 'on', l: 'Tarikh', t: 'date' }]} />}
              {r.twoB && !r.investigators && <OpForm title="Penyiasat 2(b) dalam eSIMS" op="esims" send={send('esims')} fixed={{ ...L, what: 'investigators' }} fields={[{ k: 'on', l: 'Tarikh', t: 'date' }]} />}
              {!r.counts && <OpForm title="Sahkan bilangan CSG/TNG" op="counts" send={send('counts')} fixed={L} fields={[{ k: 'reason', l: 'Sebab (contoh: disemak dengan JA)' }]} />}
              {!r.checked && <OpForm title="Semak dokumen (pengurus)" op="check" send={send('check')} fixed={L} fields={[{ k: 'note', l: 'Nota' }]} />}
              {r.stage === 'papers' && <OpForm title="Tandatangan pengarah" op="sign" send={send('sign')} fixed={L} fields={[{ k: 'declaration', l: b.declaration.bm, t: 'check' }]} done="Ditandatangani." />}
              <OpForm
                title={r.appointment ? 'Tukar janji temu' : 'Rekod janji temu'}
                op="appointment"
                send={send('appointment')}
                fixed={L}
                fields={[
                  { k: 'session', l: 'Sesi', t: 'number' },
                  { k: 'on', l: 'Tarikh', t: 'date' },
                  { k: 'time', l: 'Masa (HH:MM)' },
                  { k: 'ref', l: 'Rujukan janji temu eSIMS' },
                  { k: 'attendee', l: 'Siapa hadir' },
                  ...(r.appointment ? [{ k: 'reason', l: 'Sebab tukar' } as Field] : []),
                ]}
              />
              {r.appointment && (
                <OpForm
                  title="Keputusan hari itu"
                  op="result"
                  send={send('result')}
                  fixed={L}
                  fields={[
                    { k: 'kind', l: 'Keputusan', t: 'select', o: ['accepted', 'lacking', 'counter'] },
                    { k: 'on', l: 'Tarikh', t: 'date' },
                    { k: 'ref', l: 'Rujukan KDN' },
                    { k: 'lacking', l: 'Item tidak lengkap (cth 1.2, 3.7)', t: 'list' },
                    { k: 'note', l: 'Nota' },
                  ]}
                />
              )}
              <button className="btn btn-sm" disabled={act.busy} onClick={() => void pack()}>
                Muat turun pek pendrive
              </button>
            </>
          )}
          {b.can.finance && !r.sst && <OpForm title="Tiada tunggakan SST" op="sst" send={send('sst')} fixed={{ companyId: r.companyId }} fields={[{ k: 'ref', l: 'Rujukan penyata MySST' }, { k: 'on', l: 'Tarikh', t: 'date' }]} />}
          {b.can.central && r.stage !== 'not_opened' && <OpForm title={r.twoB ? 'Matikan 2(b)' : 'Hidupkan 2(b)'} op="twoB" send={send('twoB')} fixed={{ ...L, on: !r.twoB }} fields={[{ k: 'reason', l: 'Sebab' }]} />}
        </div>
      </div>
    </div>
  );
}
