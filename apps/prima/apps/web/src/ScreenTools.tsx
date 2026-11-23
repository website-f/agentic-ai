import { Suspense, lazy, useState, type RefObject } from 'react';
import {
  EXPORT_RULE,
  EXPORT_SENSITIVITY_LABELS,
  RECORD_KINDS,
  SCREEN_TOOLS,
  exportAllowed,
  exportCsv,
  exportPdf,
  exportSensitivity,
  exportXlsx,
  type ExportSheet,
} from '@prima/core';
import { api } from './api';
import { useApp } from './App';
import { useLang } from './i18n';
import { Drawer, ErrorNotice, useToast } from './ui';
import { RecordButton, useRecordKinds } from './views/RecordForm';

// Upload reads files and runs the import (views/ScreenUpload.tsx); it loads only when someone presses Upload.
const ScreenUpload = lazy(() => import('./views/ScreenUpload'));

/**
 * Upload, Key in and Download on every screen and tab (Fauzan, 23 Nov 2026: "After we check upload button for all tab
 * or all deparment. Dont have upload, key in , download"). One toolbar above every screen; it adds no authority:
 * - Upload works like Import (Fitri, 24 Nov 2026): a list is read on the device, matched to this screen's records, its
 *   columns and rows checked, sorted and saved through the screen's own import (views/ScreenUpload.tsx). Any other file
 *   is kept in "Old files and data" where the file manager is installed; where it is not, the person is told plainly.
 * - Key in opens the plain record forms this screen holds (keepers only; the server checks again) and points to the
 *   open tab's own forms.
 * - Download gives the open tab as the person sees it, as Excel, CSV or PDF, logged first; sensitive data needs a reason.
 */

type Tool = 'upload' | 'keyin' | 'download';

const L = {
  upload: { ms: 'Muat naik', en: 'Upload' },
  keyin: { ms: 'Isi data', en: 'Key in' },
  download: { ms: 'Muat turun', en: 'Download' },
};

/** Buttons on a tab that key in a record: Add, New, Record, Request and the like. */
export const KEY_IN_WORDS = /^(\+ ?)?(add|tambah|new|baru|record|rekod|key in|isi|create|cipta|daftar|register|log |raise|request|mohon|submit|hantar|report|lapor)/i;

/** The open tab's name: the selected tab of the first tab bar on the screen. */
export function openTabName(root: HTMLElement | null): string {
  const bar = root?.querySelector('[role=tablist]');
  const sel = bar?.querySelector('[role=tab][aria-selected=true]') as HTMLElement | null;
  return (sel?.innerText ?? sel?.textContent ?? '').replace(/\s+\d+$/, '').replace(/\s+/g, ' ').trim();
}

const skip = (e: Element) => !!e.closest('[data-screen-tools], [data-no-export], .drawer, .scrim, [role=dialog]');
const shown = (e: Element) => (e as HTMLElement).getClientRects().length > 0;

/** An element's own words, without its buttons, inputs and pictures. */
function words(e: Element): string {
  const c = e.cloneNode(true) as Element;
  c.querySelectorAll('button, input, select, textarea, svg, script, style, [data-no-export]').forEach((x) => x.remove());
  return (c.textContent ?? '').replace(/\s+/g, ' ').trim();
}

/** Lines an element shows, as laid out on screen, without the words of its buttons and pick lists. */
function lines(e: HTMLElement): string[] {
  const drop = new Set([...e.querySelectorAll('button, select, option')].map((x) => (x.textContent ?? '').trim()).filter(Boolean));
  return (e.innerText ?? e.textContent ?? '')
    .split('\n')
    .map((x) => x.replace(/\s+/g, ' ').trim())
    .filter((x) => x && !drop.has(x));
}

const heading = (e: Element, fallback: string) => {
  const panel = e.closest('section.panel, .panel, section');
  const h = panel?.querySelector('h2, h3, h4');
  return (h?.textContent ?? '').replace(/\s+/g, ' ').trim() || fallback;
};

/** What the person sees on the open tab: each table, each list, the figure cards; plain text when there is none. */
export function collectScreen(root: HTMLElement): ExportSheet[] {
  const sheets: ExportSheet[] = [];
  let rowsLeft = EXPORT_RULE.maxRows;
  const tables = [...root.querySelectorAll('table')].filter((t) => !skip(t) && shown(t));
  tables.forEach((t, i) => {
    const headRow = t.querySelector('thead tr') ?? t.querySelector('tr');
    const header = headRow ? [...headRow.children].map(words) : [];
    const body = [...t.querySelectorAll('tr')].filter((r) => r !== headRow && !skip(r) && shown(r));
    const rows = body.slice(0, rowsLeft).map((r) => [...r.children].map(words)).filter((r) => r.some(Boolean));
    rowsLeft -= rows.length;
    sheets.push({ name: heading(t, `Table ${i + 1}`), header, rows });
  });
  const lists = [...root.querySelectorAll('.list')].filter((l) => !skip(l) && shown(l) && !l.closest('table') && !l.parentElement?.closest('.list'));
  lists.forEach((l, i) => {
    const items = [...l.querySelectorAll(':scope > .list-item, :scope > * > .list-item')].filter((x) => shown(x)) as HTMLElement[];
    if (!items.length) return;
    const rows = items.slice(0, Math.max(0, rowsLeft)).map(lines).filter((r) => r.length);
    rowsLeft -= rows.length;
    const width = Math.max(1, ...rows.map((r) => r.length));
    sheets.push({ name: heading(l, `List ${i + 1}`), header: Array.from({ length: width }, (_, c) => (c === 0 ? 'Item' : `Detail ${c}`)), rows });
  });
  const kpis = [...root.querySelectorAll('.kpi')].filter((k) => !skip(k) && shown(k)) as HTMLElement[];
  if (kpis.length) sheets.unshift({ name: 'Summary', header: ['Figure', 'Value', 'Note'], rows: kpis.map((k) => lines(k).slice(0, 3)) });
  if (!sheets.length) {
    const text = [...root.querySelectorAll('section.panel, .panel')].filter((p) => !skip(p) && shown(p) && !p.parentElement?.closest('.panel')) as HTMLElement[];
    const all = (text.length ? text : [root]).flatMap((p) => lines(p));
    sheets.push({ name: 'Screen', header: ['Text'], rows: all.slice(0, EXPORT_RULE.maxRows).map((x) => [x]) });
  }
  return sheets;
}

const fileStem = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40) || 'screen';

export function ScreenTools({ screen, label, contentRef }: { screen: string; label: string; contentRef: RefObject<HTMLDivElement> }) {
  const { me } = useApp();
  const { lang } = useLang();
  const tr = (x: { ms: string; en: string }) => (lang === 'en' ? x.en : lang === 'ms' ? x.ms : `${x.ms} / ${x.en}`);
  const [open, setOpen] = useState<{ tool: Tool; tab: string } | null>(null);
  const tools = SCREEN_TOOLS[screen];
  // Guards and site devices keep their short phone screens; integrations have no screens.
  if (!tools || tools.none || me.user.integration || me.user.role === 'guard' || me.user.role === 'site_device') return null;
  const show = (tool: Tool) => setOpen({ tool, tab: openTabName(contentRef.current) });
  return (
    <div className="screen-tools" data-screen-tools="" role="toolbar" aria-label={tr({ ms: 'Alat skrin', en: 'Screen tools' })}>
      {(['upload', 'keyin', 'download'] as const).map((t) => (
        <button key={t} className="btn btn-sm" data-tool={t} onClick={() => show(t)}>
          {tr(L[t])}
        </button>
      ))}
      {open?.tool === 'upload' && (
        <Suspense fallback={null}>
          <ScreenUpload
            screen={screen}
            title={`${tr(L.upload)}: ${label}${open.tab ? ` · ${open.tab}` : ''}`}
            contentRef={contentRef}
            onKeyIn={() => setOpen({ tool: 'keyin', tab: open.tab })}
            onClose={() => setOpen(null)}
          />
        </Suspense>
      )}
      {open && open.tool !== 'upload' && (
        <Drawer title={`${tr(L[open.tool])}: ${label}${open.tab ? ` · ${open.tab}` : ''}`} onClose={() => setOpen(null)}>
          {open.tool === 'keyin' && <KeyInPanel screen={screen} tr={tr} contentRef={contentRef} onClose={() => setOpen(null)} />}
          {open.tool === 'download' && <DownloadPanel screen={screen} label={label} tab={open.tab} tr={tr} contentRef={contentRef} />}
        </Drawer>
      )}
    </div>
  );
}

type Tr = (x: { ms: string; en: string }) => string;

function KeyInPanel({ screen, tr, contentRef, onClose }: { screen: string; tr: Tr; contentRef: RefObject<HTMLDivElement>; onClose: () => void }) {
  const kinds = useRecordKinds();
  const { companyId } = useApp();
  const tools = SCREEN_TOOLS[screen];
  const mine = (tools.records ?? []).filter((k) => kinds.has(k));
  // The open tab's own forms: its Add, New, Record and Request buttons, as they stand.
  const own = [...(contentRef.current?.querySelectorAll('button') ?? [])].filter(
    (b) => !skip(b) && shown(b) && !b.disabled && KEY_IN_WORDS.test((b.innerText ?? b.textContent ?? '').trim()) && !/report a problem/i.test(b.innerText),
  );
  const seen = new Set<string>();
  const ownUnique = own.filter((b) => {
    const k = (b.innerText ?? '').trim();
    if (!k || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {mine.length > 0 && (
        <div>
          <h3 className="small">{tr({ ms: 'Rekod yang anda simpan di skrin ini', en: 'Records you keep on this screen' })}</h3>
          <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
            {mine.map((k) => (
              <RecordButton key={k} kind={k} companyId={companyId || null} label={`+ ${RECORD_KINDS[k].label}`} />
            ))}
          </div>
        </div>
      )}
      {ownUnique.length > 0 && (
        <div>
          <h3 className="small">{tr({ ms: 'Borang pada tab ini', en: 'Forms on this tab' })}</h3>
          <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
            {ownUnique.map((b, i) => (
              <button
                key={i}
                className="btn btn-sm"
                onClick={() => {
                  onClose();
                  b.scrollIntoView({ block: 'center' });
                  b.click();
                }}
              >
                {(b.innerText ?? '').trim()}
              </button>
            ))}
          </div>
        </div>
      )}
      {!mine.length && !ownUnique.length && (
        <p className="small" role="status">
          {tools.readOnly ??
            tr({
              ms: 'Tiada apa untuk anda isi pada tab ini. Kerja tab ini dibuat oleh orang lain, atau dari skrin lain.',
              en: 'Nothing for you to key in on this tab. Its work is done by others, or from another screen.',
            })}
        </p>
      )}
    </div>
  );
}

function DownloadPanel({ screen, label, tab, tr, contentRef }: { screen: string; label: string; tab: string; tr: Tr; contentRef: RefObject<HTMLDivElement> }) {
  const { me, companyId } = useApp();
  // Not useAction: a download changes nothing, so the screen is not reloaded (that would reset the open tab).
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();
  const [reason, setReason] = useState('');
  const sensitivity = exportSensitivity(screen, tab);
  if (!exportAllowed(me.user, screen, tab))
    return (
      <p className="small" role="status">
        {tr({
          ms: 'Senarai aduan (speak up) hanya dimuat turun oleh pengendali aduan.',
          en: 'Speak-up lists are downloaded only by the people who handle speak-up reports.',
        })}
      </p>
    );
  const root = contentRef.current;
  const preview = root ? collectScreen(root) : [];
  const rows = preview.reduce((a, s) => a + s.rows.length, 0);
  const needReason = !!sensitivity && reason.trim().length < EXPORT_RULE.reasonMinChars;

  const take = async (format: 'xlsx' | 'csv' | 'pdf') => {
    const now = contentRef.current;
    if (!now) return;
    const sheets = collectScreen(now);
    const count = sheets.reduce((a, s) => a + s.rows.length, 0);
    if (busy) return;
    setBusy(true);
    setError(null);
    let done: Awaited<ReturnType<typeof api.exportLog>>;
    try {
      done = await api.exportLog({ screen, tab, format, rows: count, reason, companyId });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return;
    } finally {
      setBusy(false);
    }
    const stamp = { title: `${label}${tab ? ` · ${tab}` : ''}`, ref: done.ref, at: done.at, by: done.by, sensitivity: done.sensitivity };
    const bytes = format === 'xlsx' ? exportXlsx(sheets, stamp) : format === 'csv' ? exportCsv(sheets) : exportPdf(sheets, stamp);
    const type = format === 'xlsx' ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : format === 'csv' ? 'text/csv;charset=utf-8' : 'application/pdf';
    const blob = new Blob([bytes as BlobPart], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    // The CSV carries no stamp lines (another system reads it), so its log reference is in the file name.
    a.download = `${fileStem(label)}${tab ? `-${fileStem(tab)}` : ''}-${done.at.slice(0, 10)}${format === 'csv' ? `-${done.ref}` : ''}.${format}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    toast(tr({ ms: `Dimuat turun dan direkodkan (${done.ref}).`, en: `Downloaded and logged (${done.ref}).` }));
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <p className="muted small">
        {tr({
          ms: `Muat turun apa yang anda lihat pada tab ini: ${preview.length} jadual atau senarai, ${rows} baris. Setiap muat turun direkodkan dengan nama anda dan masa.`,
          en: `Download what you see on this tab: ${preview.length} table${preview.length === 1 ? '' : 's'} or list${preview.length === 1 ? '' : 's'}, ${rows} row${rows === 1 ? '' : 's'}. Every download is logged with your name and the time.`,
        })}
      </p>
      {sensitivity && (
        <label className="field">
          <span className="label">
            {tr({
              ms: `Data sulit (${EXPORT_SENSITIVITY_LABELS[sensitivity].bm}). Kenapa anda perlukannya?`,
              en: `Confidential data (${EXPORT_SENSITIVITY_LABELS[sensitivity].en}). Why do you need it?`,
            })}
          </span>
          <textarea className="input" rows={2} maxLength={300} aria-label="Reason for the download" value={reason} onChange={(e) => setReason(e.target.value)} />
        </label>
      )}
      {error && <ErrorNotice error={error} />}
      <div className="row" style={{ gap: 6 }}>
        <button className="btn btn-sm btn-primary" disabled={busy || needReason} onClick={() => void take('xlsx')}>
          Excel
        </button>
        <button className="btn btn-sm" disabled={busy || needReason} onClick={() => void take('csv')}>
          CSV
        </button>
        <button className="btn btn-sm" disabled={busy || needReason} onClick={() => void take('pdf')}>
          PDF
        </button>
      </div>
    </div>
  );
}
