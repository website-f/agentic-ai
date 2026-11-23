import { useEffect, useState } from 'react';
import {
  KEY_IN_FIELDS,
  KEY_IN_FILE_ACCEPT,
  KEY_IN_LABELS,
  keyInConfirm,
  keyInConfirmAll,
  keyInOnlineAllowed,
  keyInReadyToSave,
  type KeyInAnyPaper,
  type KeyInField,
  type KeyInValue,
} from '@prima/core';
import { api } from './api';
import { readPaperWords, type PaperWords } from './paper-words';
import { useLang } from './i18n';

/**
 * "Isi automatik" panel for a form (rule KEY-IN). The host form passes what the person typed and what Prima already
 * holds; the person picks any kind of document (photo, PDF, Word, Excel and more) or takes its photo; the device reads
 * its words for free (paper-words.ts) and the server fills the
 * fields still empty. Each value read from the paper is marked "Semak" until the person confirms or corrects it, and
 * the host form may save only when `ready` is true. This panel saves nothing and never names an AI product.
 */
export function KeyIn({
  paper,
  typed,
  prima,
  words,
  only,
  onFields,
}: {
  paper: KeyInAnyPaper;
  typed?: Record<string, unknown>;
  prima?: Record<string, unknown>;
  /** Words already read from the paper elsewhere (for example a PDF's text). When given, no photo is asked for. */
  words?: string;
  /**
   * The fields the host form has a box for. Others are not shown and never hold the save back (a KDN statement has a
   * year, but the 3.1 form only asks for its months).
   */
  only?: string[];
  /** Called on every change with the fields and whether the form may be saved. */
  onFields: (fields: KeyInField[], ready: boolean) => void;
}) {
  const { lang } = useLang();
  const L = lang === 'en' ? KEY_IN_LABELS.en : KEY_IN_LABELS.bm;
  const [status, setStatus] = useState<{ allowed: boolean; online: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [unreadable, setUnreadable] = useState(false);
  const [problem, setProblem] = useState<PaperWords['problem']>(null);
  const [fields, setFields] = useState<KeyInField[] | null>(null);

  useEffect(() => {
    let live = true;
    api.keyInStatus().then((s) => live && setStatus(s)).catch(() => live && setStatus({ allowed: false, online: false }));
    return () => { live = false; };
  }, []);

  const put = (all: KeyInField[]) => {
    const next = only ? all.filter((f) => only.includes(f.name)) : all;
    setFields(next);
    onFields(next, keyInReadyToSave(next));
  };
  const read = async (text: string | null) => {
    setUnreadable(!text);
    if (!text) return;
    try {
      put((await api.keyInRead(paper, { text, typed, prima })).fields);
    } catch {
      setUnreadable(true);
    }
  };
  // Runs by itself when the paper's words are already at hand.
  useEffect(() => {
    if (words && status?.allowed) void read(words);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [words, status?.allowed]);

  if (!status?.allowed) return null;

  const pickFile = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    setProblem(null);
    setUnreadable(false);
    try {
      const got = await readPaperWords(file).catch((): PaperWords => ({ kind: 'unknown', words: null, problem: 'unreadable' }));
      if (got.words) await read(got.words);
      else if (got.problem && got.problem !== 'unreadable' && got.problem !== 'empty') setProblem(got.problem);
      else setUnreadable(true);
    } finally {
      setBusy(false);
    }
  };
  const specs = KEY_IN_FIELDS[paper];
  const parse = (name: string, v: string): KeyInValue | null => {
    if (v === '') return null;
    const type = specs.find((s) => s.name === name)?.type;
    return type === 'money' || type === 'number' || type === 'year' ? (Number.isFinite(Number(v)) ? Number(v) : null) : v;
  };

  return (
    <div className="card" style={{ marginTop: 8 }}>
      <strong>{L.title}</strong>
      <p className="muted small">{keyInOnlineAllowed(paper) && status.online ? L.sent : keyInOnlineAllowed(paper) ? '' : L.localOnly}</p>
      {words == null && (
        <>
          <p className="muted small">{L.pick}</p>
          <input type="file" accept={KEY_IN_FILE_ACCEPT} disabled={busy} aria-label={L.title} onChange={(e) => void pickFile(e.target.files?.[0])} />
        </>
      )}
      {busy && <p className="small" role="status">{L.reading}</p>}
      {problem && (
        <p className="small" role="status">
          {problem === 'too-big' ? L.tooBig : problem === 'old-office' ? L.oldOffice : problem === 'locked' ? L.locked : L.unknownFile}
        </p>
      )}
      {unreadable && <p className="small" role="status">{L.blank}</p>}
      {fields && (
        <div>
          <p className="small">{L.note}</p>
          <table className="small">
            <tbody>
              {fields.map((f) => {
                const spec = specs.find((s) => s.name === f.name);
                const type = spec?.type;
                return (
                  <tr key={f.name}>
                    <th style={{ textAlign: 'left' }}>{spec ? (lang === 'en' ? spec.label.en : spec.label.bm) : f.name}</th>
                    <td>
                      <input
                        type={type === 'date' ? 'date' : type === 'month' ? 'month' : type === 'money' || type === 'number' || type === 'year' ? 'number' : 'text'}
                        step={type === 'money' ? '0.01' : undefined}
                        value={f.value ?? ''}
                        placeholder={f.value == null ? L.blank : undefined}
                        onChange={(e) => put(keyInConfirm(fields, f.name, parse(f.name, e.target.value)))}
                      />
                    </td>
                    <td className="muted">{f.raw ? `“${f.raw}”` : ''}</td>
                    <td>
                      {f.toCheck && (
                        <button className="btn btn-sm" onClick={() => put(keyInConfirm(fields, f.name))}>
                          <span className="chip">{L.check}</span> ✓
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!keyInReadyToSave(fields) && (
            <button className="btn btn-sm" onClick={() => put(keyInConfirmAll(fields))}>{L.confirmAll}</button>
          )}
        </div>
      )}
    </div>
  );
}
