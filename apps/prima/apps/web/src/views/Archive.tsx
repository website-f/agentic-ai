import { useEffect, useState } from 'react';
import {
  ARCHIVE_FOLDERS,
  ARCHIVE_FOLDER_LABELS,
  ARCHIVE_RULE,
  archiveExt,
  archiveRestricted,
  archiveSuggest,
  type ArchiveFileView,
  type ArchiveFolder,
} from '@prima/core';
import { api } from '../api';
import { useLang } from '../i18n';
import { readPaperWords } from '../paper-words';
import { Chip, ErrorNotice, Kpi, Loading, dateLabel, dateTimeLabel, useAction, useLoad } from '../ui';

/**
 * Data and file manager, "Fail lama" (Fauzan, 23 Nov 2026: "Do also a data and file manager. As staff upload all old
 * data we have, even the hard copy scan to computer"). The person picks many files at once; each is read on their own
 * device and the rules suggest its folder, date, reference and title; the person checks and saves. Files travel to
 * the server in pieces. Nothing is deleted: a wrong file is set aside with a reason.
 */

const MAX_BATCH = 20;
const T = {
  title: { ms: 'Fail & data lama', en: 'Old files and data' },
  intro: {
    ms: 'Masukkan fail lama syarikat atau jabatan anda: fail komputer, dan kertas yang diimbas atau difoto. Prima membaca setiap fail pada peranti anda dan mencadangkan folder, tarikh dan tajuk. Anda hanya semak dan simpan.',
    en: 'Put in the old files of your company or department: computer files, and paper that was scanned or photographed. Prima reads each file on your own device and suggests the folder, date and title. You only check and save.',
  },
  add: { ms: 'Tambah fail', en: 'Add files' },
  pick: { ms: `Pilih sehingga ${MAX_BATCH} fail apa-apa jenis: PDF, gambar, Word, Excel, PowerPoint, teks, e-mel, zip, video, suara, lukisan. Had 200 MB setiap fail. Hanya program ditolak. PDF, gambar dan fail pejabat juga dibaca untuk carian.`, en: `Choose up to ${MAX_BATCH} files of any kind: PDF, photo, Word, Excel, PowerPoint, text, email, zip, video, voice, drawings. 200 MB each at most. Only programs are refused. PDF, photos and office files are also read for searching.` },
  saveAll: { ms: 'Simpan semua', en: 'Save all' },
  tickAll: { ms: 'Tanda semua disemak', en: 'Mark all checked' },
  checked: { ms: 'Disemak', en: 'Checked' },
  check: { ms: 'Semak', en: 'Check' },
  later: { ms: 'Fail yang tidak ditanda disimpan juga dan menunggu semakan anda kemudian.', en: 'Files not marked are saved too and wait for your check later.' },
  find: { ms: 'Cari tajuk, rujukan, nama fail atau perkataan dalam dokumen', en: 'Find a title, reference, file name or words in the document' },
  all: { ms: 'Semua', en: 'All' },
  toCheck: { ms: 'Belum disemak', en: 'To check' },
  mine: { ms: 'Saya masukkan', en: 'Added by me' },
  aside: { ms: 'Diketepikan', en: 'Set aside' },
  none: { ms: 'Tiada fail.', en: 'No files.' },
  open: { ms: 'Buka', en: 'Open' },
  edit: { ms: 'Betulkan', en: 'Correct' },
  setAside: { ms: 'Ketepikan', en: 'Set aside' },
  restricted: { ms: 'Terhad', en: 'Restricted' },
  noStorage: {
    ms: 'Storan fail belum dihidupkan, jadi fail belum boleh disimpan. CEO menghidupkannya.',
    en: 'File storage is not switched on yet, so files cannot be kept. The CEO switches it on.',
  },
  notInstalled: { ms: 'Pengurus fail belum dipasang dalam pangkalan data ini.', en: 'The file manager is not installed in this database yet.' },
};

type Row = {
  n: number;
  file: File;
  state: 'reading' | 'ready' | 'sending' | 'done' | 'duplicate' | 'error';
  note: string;
  words: string;
  folder: ArchiveFolder;
  title: string;
  docDate: string;
  refNo: string;
  origin: 'scan' | 'file';
  checked: boolean;
};

const base64Of = (bytes: Uint8Array): string => {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};
const sizeLabel = (n: number) => (n >= 1_048_576 ? `${(n / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const ownerLabel = (o: string) => (o.startsWith('company:') ? o.slice(8) : o.slice(5).replace(/_/g, ' '));

export function ArchiveView() {
  const { lang } = useLang();
  const t = (k: keyof typeof T) => (lang === 'en' ? T[k].en : lang === 'ms' ? T[k].ms : `${T[k].ms} / ${T[k].en}`);
  const folderName = (f: ArchiveFolder) => (lang === 'en' ? ARCHIVE_FOLDER_LABELS[f].en : ARCHIVE_FOLDER_LABELS[f].bm);
  const [folder, setFolder] = useState('');
  const [status, setStatus] = useState<'filed' | 'to_check' | 'mine' | 'set_aside'>('filed');
  const [q, setQ] = useState('');
  const [asked, setAsked] = useState('');
  const [year, setYear] = useState('');
  const [page, setPage] = useState(0);
  const [tick, setTick] = useState(0);
  const { data, error, loading } = useLoad(
    () => api.archive({ folder: folder || undefined, status, q: asked || undefined, year: /^\d{4}$/.test(year) ? Number(year) : undefined, page }),
    [folder, status, asked, year, page, tick],
  );
  const reload = () => setTick((x) => x + 1);

  if (error) return <ErrorNotice error={error} />;
  if (!data) return <Loading what={t('title')} />;
  const total = Object.values(data.counts).reduce((a, b) => a + b, 0);

  return (
    <div className="stack" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <section className="panel">
        <div className="panel-head">
          <h3>{t('title')}</h3>
        </div>
        <div className="panel-body">
          <p className="muted small">{t('intro')}</p>
          {!data.installed && <p className="small" role="status">{t('notInstalled')}</p>}
          {data.installed && !data.storage && <p className="small" role="status">{t('noStorage')}</p>}
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <Kpi label={lang === 'en' ? 'Files kept' : 'Fail disimpan'} value={total} />
            <Kpi label={t('toCheck')} value={data.toCheck} tone={data.toCheck ? 'warn' : 'ok'} />
          </div>
        </div>
      </section>

      {data.installed && data.storage && data.owners.length > 0 && <AddFiles owners={data.owners} t={t} folderName={folderName} onSaved={reload} />}

      <section className="panel">
        <div className="panel-head">
          <h3>{lang === 'en' ? 'Find a file' : 'Cari fail'}</h3>
        </div>
        <div className="panel-body" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div className="tabbar" role="tablist" aria-label="File lists">
            {(['filed', 'to_check', 'mine', 'set_aside'] as const).map((s) => (
              <button key={s} role="tab" aria-selected={status === s} onClick={() => (setStatus(s), setPage(0))}>
                {s === 'filed' ? t('all') : s === 'to_check' ? t('toCheck') : s === 'mine' ? t('mine') : t('aside')}
                {s === 'to_check' && data.toCheck > 0 && <span className="tab-count">{data.toCheck}</span>}
              </button>
            ))}
          </div>
          <form
            className="row"
            style={{ gap: 6, flexWrap: 'wrap' }}
            onSubmit={(e) => {
              e.preventDefault();
              setAsked(q.trim());
              setPage(0);
            }}
          >
            <input className="input" style={{ flex: '1 1 240px' }} aria-label="Find a file" placeholder={t('find')} value={q} onChange={(e) => setQ(e.target.value)} />
            <select className="input" style={{ width: 'auto' }} aria-label="Folder" value={folder} onChange={(e) => (setFolder(e.target.value), setPage(0))}>
              <option value="">{lang === 'en' ? 'Every folder' : 'Semua folder'}</option>
              {ARCHIVE_FOLDERS.map((f) => (
                <option key={f} value={f}>
                  {folderName(f)}
                  {data.counts[f] ? ` (${data.counts[f]})` : ''}
                </option>
              ))}
            </select>
            <input className="input" style={{ width: 100 }} inputMode="numeric" aria-label="Year" placeholder={lang === 'en' ? 'Year' : 'Tahun'} value={year} onChange={(e) => (setYear(e.target.value.replace(/\D/g, '').slice(0, 4)), setPage(0))} />
            <button className="btn btn-sm btn-primary" type="submit">
              {lang === 'en' ? 'Find' : 'Cari'}
            </button>
          </form>
          {loading && <span className="muted small">…</span>}
          <div className="list">
            {data.files.length === 0 && <p className="muted small">{t('none')}</p>}
            {data.files.map((f) => (
              <FileRow key={f.id} f={f} t={t} folderName={folderName} onChanged={reload} />
            ))}
          </div>
          {data.pages > 1 && (
            <div className="row" style={{ gap: 6 }}>
              <button className="btn btn-sm" disabled={data.page === 0} onClick={() => setPage(data.page - 1)}>
                ‹
              </button>
              <span className="small">
                {data.page + 1} / {data.pages} · {data.total}
              </span>
              <button className="btn btn-sm" disabled={data.page + 1 >= data.pages} onClick={() => setPage(data.page + 1)}>
                ›
              </button>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

type Tr = (k: keyof typeof T) => string;

/**
 * Upload from any screen (Fauzan, 23 Nov 2026: Upload, Key in and Download on every tab). The same Add files panel as
 * this screen, filed for the person's own unit; the screen suggests the folder when the rules cannot tell.
 */
export function ArchiveUpload({ folder, onSaved, files }: { folder: ArchiveFolder; onSaved?: () => void; /** Files the person already chose (the toolbar's Upload). */ files?: File[] }) {
  const { lang } = useLang();
  const t = (k: keyof typeof T) => (lang === 'en' ? T[k].en : lang === 'ms' ? T[k].ms : `${T[k].ms} / ${T[k].en}`);
  const folderName = (f: ArchiveFolder) => (lang === 'en' ? ARCHIVE_FOLDER_LABELS[f].en : ARCHIVE_FOLDER_LABELS[f].bm);
  const { data, error } = useLoad(() => api.archive({ status: 'mine', page: 0 }), []);
  if (error) return <ErrorNotice error={error} />;
  if (!data) return <Loading what={t('title')} />;
  if (!data.installed) return <p className="small" role="status">{t('notInstalled')}</p>;
  if (!data.storage) return <p className="small" role="status">{t('noStorage')}</p>;
  if (!data.owners.length) return <p className="small muted" role="status">{lang === 'en' ? 'You have no unit to keep files for.' : 'Anda tiada unit untuk menyimpan fail.'}</p>;
  return <AddFiles owners={data.owners} t={t} folderName={folderName} onSaved={onSaved ?? (() => undefined)} screenFolder={folder} files={files} />;
}

function AddFiles({ owners, t, folderName, onSaved, screenFolder, files: chosen }: { owners: string[]; t: Tr; folderName: (f: ArchiveFolder) => string; onSaved: () => void; screenFolder?: ArchiveFolder; files?: File[] }) {
  const [owner, setOwner] = useState(owners[0]);
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const patch = (n: number, x: Partial<Row>) => setRows((rs) => rs.map((r) => (r.n === n ? { ...r, ...x } : r)));

  const pick = async (list: FileList | File[] | null | undefined) => {
    if (!list?.length) return;
    const files = [...list].slice(0, MAX_BATCH);
    setNote(list.length > MAX_BATCH ? `${MAX_BATCH} / ${list.length}` : '');
    const start = Date.now();
    const fresh: Row[] = files.map((file, i) => ({ n: start + i, file, state: 'reading', note: '', words: '', folder: 'other', title: file.name, docDate: '', refNo: '', origin: 'file', checked: false }));
    setRows(fresh);
    setBusy(true);
    try {
      // One at a time: reading a scan uses the device's text reader.
      for (const r of fresh) {
        if (!archiveExt(r.file.name)) {
          patch(r.n, { state: 'error', note: 'Programs and scripts are not kept. Every other kind of file is.' });
          continue;
        }
        if (r.file.size > ARCHIVE_RULE.maxFileBytes) {
          patch(r.n, { state: 'error', note: 'Larger than 200 MB. Save a long scan as two or more files.' });
          continue;
        }
        const read = await readPaperWords(r.file).catch(() => null);
        const s = archiveSuggest(r.file.name, read?.words ?? null, read?.kind ?? 'unknown');
        patch(r.n, { state: 'ready', words: read?.words ?? '', folder: s.folder === 'other' && screenFolder ? screenFolder : s.folder, title: s.title, docDate: s.docDate ?? '', refNo: s.ref ?? '', origin: s.origin });
      }
    } finally {
      setBusy(false);
    }
  };
  // The toolbar's Upload hands over the file the person already chose: read it once, as if picked here.
  useEffect(() => {
    if (chosen?.length) void pick(chosen);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, for the files handed over.
  }, []);

  const saveAll = async () => {
    setBusy(true);
    try {
      for (const r of rows) {
        if (r.state !== 'ready') continue;
        try {
          const details = { folder: r.folder, title: r.title, docDate: r.docDate || null, ref: r.refNo || null, origin: r.origin };
          const s = await api.archiveStart({ owner, fileName: r.file.name, size: r.file.size, words: r.words, ...details });
          // A big scan is read from the device and sent one piece at a time (three on the way at once), never whole.
          let next = 0;
          let sent = 0;
          const lane = async () => {
            while (next < s.parts) {
              const i = next++;
              const piece = new Uint8Array(await r.file.slice(i * s.partBytes, (i + 1) * s.partBytes).arrayBuffer());
              await api.archivePart(s.id, i, base64Of(piece));
              patch(r.n, { state: 'sending', note: `${++sent} / ${s.parts}` });
            }
          };
          patch(r.n, { state: 'sending', note: `0 / ${s.parts}` });
          await Promise.all([lane(), lane(), lane()]);
          const done = await api.archiveFinish(s.id, { ...details, checked: r.checked });
          patch(r.n, done.duplicateOf ? { state: 'duplicate', note: done.duplicateOf.title } : { state: 'done', note: '' });
        } catch (e) {
          patch(r.n, { state: 'error', note: e instanceof Error ? e.message : 'Could not be saved.' });
        }
      }
      onSaved();
    } finally {
      setBusy(false);
    }
  };
  const ready = rows.filter((r) => r.state === 'ready');

  return (
    <section className="panel">
      <div className="panel-head">
        <h3>{t('add')}</h3>
      </div>
      <div className="panel-body" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {owners.length > 1 && (
          <label className="small">
            For{' '}
            <select className="input" style={{ width: 'auto' }} aria-label="File for" value={owner} onChange={(e) => setOwner(e.target.value)}>
              {owners.map((o) => (
                <option key={o} value={o}>
                  {ownerLabel(o)}
                </option>
              ))}
            </select>
          </label>
        )}
        <p className="muted small">{t('pick')}</p>
        <input type="file" multiple disabled={busy} aria-label="Files to add" onChange={(e) => void pick(e.target.files)} />
        {note && <span className="small muted">{note}</span>}
        {rows.map((r) => (
          <div key={r.n} className="list-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 6 }}>
            <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
              <strong className="small">{r.file.name}</strong>
              <span className="muted small">{sizeLabel(r.file.size)}</span>
              {r.state === 'reading' && <Chip tone="neutral">…</Chip>}
              {r.state === 'sending' && <Chip tone="neutral">{r.note}</Chip>}
              {r.state === 'done' && <Chip tone="ok">Saved</Chip>}
              {r.state === 'duplicate' && <Chip tone="warn" title={r.note}>Already kept: {r.note}</Chip>}
              {r.state === 'error' && <Chip tone="crit">{r.note}</Chip>}
              {r.state === 'ready' && !r.checked && <Chip tone="warn">{t('check')}</Chip>}
              {r.state === 'ready' && archiveRestricted(r.folder) && <Chip tone="neutral">{t('restricted')}</Chip>}
            </div>
            {r.state === 'ready' && (
              <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                <select className="input" style={{ width: 'auto' }} aria-label={`Folder for ${r.file.name}`} value={r.folder} onChange={(e) => patch(r.n, { folder: e.target.value as ArchiveFolder })}>
                  {ARCHIVE_FOLDERS.map((f) => (
                    <option key={f} value={f} title={ARCHIVE_FOLDER_LABELS[f].hint}>
                      {folderName(f)}
                    </option>
                  ))}
                </select>
                <input className="input" style={{ flex: '1 1 200px' }} aria-label={`Title for ${r.file.name}`} value={r.title} onChange={(e) => patch(r.n, { title: e.target.value })} />
                <input className="input" style={{ width: 'auto' }} type="date" aria-label={`Date on ${r.file.name}`} value={r.docDate} onChange={(e) => patch(r.n, { docDate: e.target.value })} />
                <input className="input" style={{ width: 150 }} aria-label={`Reference on ${r.file.name}`} placeholder="Ref" value={r.refNo} onChange={(e) => patch(r.n, { refNo: e.target.value })} />
                <label className="small">
                  <input type="checkbox" aria-label={`Checked ${r.file.name}`} checked={r.checked} onChange={(e) => patch(r.n, { checked: e.target.checked })} /> {t('checked')}
                </label>
              </div>
            )}
          </div>
        ))}
        {ready.length > 0 && (
          <>
            <p className="muted small">{t('later')}</p>
            <div className="row" style={{ gap: 6 }}>
              <button className="btn btn-sm" disabled={busy} onClick={() => setRows((rs) => rs.map((r) => (r.state === 'ready' ? { ...r, checked: true } : r)))}>
                {t('tickAll')}
              </button>
              <button className="btn btn-sm btn-primary" disabled={busy || ready.some((r) => !r.title.trim())} onClick={() => void saveAll()}>
                {t('saveAll')} ({ready.length})
              </button>
            </div>
          </>
        )}
      </div>
    </section>
  );
}

function FileRow({ f, t, folderName, onChanged }: { f: ArchiveFileView; t: Tr; folderName: (f: ArchiveFolder) => string; onChanged: () => void }) {
  const act = useAction();
  const [mode, setMode] = useState<'edit' | 'aside' | null>(null);
  const [d, setD] = useState({ folder: f.folder, title: f.title, docDate: f.docDate ?? '', ref: f.ref ?? '' });
  const [reason, setReason] = useState('');
  const [progress, setProgress] = useState('');
  const open = () =>
    act.run(async () => {
      const got = await api.archiveOpen(f.id).finally(() => setProgress(''));
      // The server has checked the stored file against its record; the bytes then come one piece at a time.
      const pieces: Uint8Array[] = [];
      for (let i = 0; i < got.parts; i++) {
        if (got.parts > 3) setProgress(`${i + 1} / ${got.parts}`);
        const part = await api.archiveOpenPart(got.id, i, got.pass).catch((e) => {
          setProgress('');
          throw e;
        });
        const bin = atob(part.base64);
        const bytes = new Uint8Array(bin.length);
        for (let k = 0; k < bin.length; k++) bytes[k] = bin.charCodeAt(k);
        pieces.push(bytes);
      }
      setProgress('');
      const whole = new Blob(pieces as BlobPart[], { type: got.mime });
      if (whole.size !== got.size) throw new Error('The file did not arrive whole. Please open it again.');
      const url = URL.createObjectURL(whole);
      // Always saved to the device, never shown inside Prima: an old file is opened by the person's own program.
      const a = document.createElement('a');
      a.href = url;
      a.download = got.fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    });
  return (
    <div className="list-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 4 }}>
      <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
        <strong>{f.title}</strong>
        <Chip tone="neutral">{folderName(f.folder)}</Chip>
        {f.restricted && <Chip tone="warn">{t('restricted')}</Chip>}
        {!f.checked && f.status === 'filed' && <Chip tone="warn">{t('check')}</Chip>}
        {f.status === 'set_aside' && <Chip tone="crit">{t('aside')}</Chip>}
      </div>
      <span className="small muted">
        {f.docDate ? `${dateLabel(f.docDate)} · ` : ''}
        {f.ref ? `${f.ref} · ` : ''}
        {f.fileName} · {sizeLabel(f.size)} · {f.origin === 'scan' ? 'scan' : 'file'} · {ownerLabel(f.owner)} · {f.uploadedBy}, {dateTimeLabel(f.at)}
      </span>
      {f.snippet && <span className="small">“…{f.snippet}…”</span>}
      {f.setAside && <span className="small">{f.setAside.reason} ({f.setAside.by})</span>}
      <ErrorNotice error={act.error} />
      <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
        <button className="btn btn-sm" disabled={act.busy} onClick={() => void open()}>
          {t('open')}
          {progress ? ` ${progress}` : ''}
        </button>
        {f.mayEdit && f.status === 'filed' && (
          <>
            <button className="btn btn-sm" aria-expanded={mode === 'edit'} onClick={() => setMode(mode === 'edit' ? null : 'edit')}>
              {t('edit')}
            </button>
            {!f.checked && (
              <button className="btn btn-sm btn-primary" disabled={act.busy} onClick={() => act.run(() => api.archiveDetails(f.id, { checked: true }), 'Checked.').then((x) => x && onChanged())}>
                ✓ {t('checked')}
              </button>
            )}
            <button className="btn btn-sm btn-ghost" aria-expanded={mode === 'aside'} onClick={() => setMode(mode === 'aside' ? null : 'aside')}>
              {t('setAside')}
            </button>
          </>
        )}
      </div>
      {mode === 'edit' && (
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          <select className="input" style={{ width: 'auto' }} aria-label="Folder" value={d.folder} onChange={(e) => setD({ ...d, folder: e.target.value as ArchiveFolder })}>
            {ARCHIVE_FOLDERS.map((x) => (
              <option key={x} value={x}>
                {folderName(x)}
              </option>
            ))}
          </select>
          <input className="input" style={{ flex: '1 1 200px' }} aria-label="Title" value={d.title} onChange={(e) => setD({ ...d, title: e.target.value })} />
          <input className="input" style={{ width: 'auto' }} type="date" aria-label="Date on the document" value={d.docDate} onChange={(e) => setD({ ...d, docDate: e.target.value })} />
          <input className="input" style={{ width: 150 }} aria-label="Reference" placeholder="Ref" value={d.ref} onChange={(e) => setD({ ...d, ref: e.target.value })} />
          <button
            className="btn btn-sm btn-primary"
            disabled={act.busy || !d.title.trim()}
            onClick={() => act.run(() => api.archiveDetails(f.id, { ...d, docDate: d.docDate || null, ref: d.ref || null, checked: true }), 'Saved.').then((x) => x && (setMode(null), onChanged()))}
          >
            Save
          </button>
        </div>
      )}
      {mode === 'aside' && (
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          <input className="input" style={{ flex: '1 1 240px' }} aria-label="Reason to set aside" placeholder="Why (needed). The file stays on record." value={reason} onChange={(e) => setReason(e.target.value)} />
          <button className="btn btn-sm" disabled={act.busy || reason.trim().length < 5} onClick={() => act.run(() => api.archiveSetAside(f.id, reason), 'Set aside.').then((x) => x && (setMode(null), onChanged()))}>
            {t('setAside')}
          </button>
        </div>
      )}
    </div>
  );
}
