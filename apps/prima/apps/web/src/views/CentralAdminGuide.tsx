import { useState } from 'react';
import { centralAdminGuideFor, type GuideCard } from '@prima/core';
import { useApp } from '../App';
import { useLang } from '../i18n';
import { dateLabel } from '../ui';

/**
 * Guide cards for Central Admin tasks (Arisha main review, 2 Nov 2026): Bahasa Melayu first with matching English,
 * only for the roles the signed-in person holds. Read-only help; the screen's own buttons do the work.
 */
export function CentralAdminGuide({ view, tab }: { view: GuideCard['view']; tab?: string }) {
  const { me } = useApp();
  const { lang } = useLang();
  const [open, setOpen] = useState(false);
  const g = centralAdminGuideFor(me.user, view);
  const cards = g.cards.filter((c) => !tab || !c.tab || c.tab === tab);
  if (!cards.length) return null;
  // P80: one language when the person chose one (Bahasa Melayu or English); both side by side only in BM + English.
  const both = lang === 'mix';
  const bm = lang !== 'en';
  const say = (x: { ms: string; en: string }) =>
    lang === 'ms' ? (
      x.ms
    ) : both ? (
      <>
        {x.ms}
        <span className="muted"> · {x.en}</span>
      </>
    ) : (
      x.en
    );
  return (
    <details className="notice" data-tone="info" open={open} onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)} aria-label="Panduan / Guide">
      <summary>
        {lang !== 'en' ? 'Panduan langkah demi langkah' : 'Step-by-step guide'} ({cards.length}){' '}
        {/* P80: the guide's date, not its version code ("central-admin-guide 2026-11-03.1"). */}
        <span className="muted small" title={g.version}>
          {guideDate(g.version, lang !== 'en')}
        </span>
      </summary>
      {cards.map((c) => (
        <article key={c.id} className="small" style={{ marginTop: 8 }}>
          <strong>{say(c.title)}</strong>
          <p>{say(c.purpose)}</p>
          <p>
            <b>{bm ? 'Siapa' : 'Who'}:</b> {say(c.responsible)}
          </p>
          <p>
            <b>{bm ? 'Di mana' : 'Where'}:</b> {say(c.where)}
          </p>
          {c.fields.length > 0 && (
            <ul>
              {c.fields.map((f, i) => (
                <li key={i}>
                  {say(f.name)} {f.required ? (bm ? '(wajib)' : '(required)') : bm ? '(pilihan)' : '(optional)'}: {say(f.format)}.{' '}
                  {bm ? 'Contoh' : 'Example'}: {f.example}
                </li>
              ))}
            </ul>
          )}
          <p>
            <b>{bm ? 'Dokumen sumber' : 'Source document'}:</b> {say(c.source)}
          </p>
          <p>
            <b>{bm ? 'Tanya' : 'Ask'}:</b> {say(c.ask)}
          </p>
          <p>
            <b>{bm ? 'Kunci sekali' : 'Key once'}:</b> {say(c.reuse)}
          </p>
          <ol>
            {c.steps.map((s, i) => (
              <li key={i}>{say(s)}</li>
            ))}
          </ol>
          <p>
            <b>{bm ? 'Dipulangkan' : 'Sent back'}:</b> {say(c.returned)}
          </p>
          <p>
            <b>{bm ? 'Bukti selesai' : 'Done evidence'}:</b> {say(c.evidence)}
          </p>
          <p>
            <b>{bm ? 'Jika ada ralat' : 'If something fails'}:</b> {say(c.recover)}
          </p>
          <p className="muted">
            <b>{bm ? 'Had' : 'Limits'}:</b> {say(c.limits)}
          </p>
        </article>
      ))}
    </details>
  );
}

function guideDate(version: string, ms: boolean): string {
  const d = version.match(/(\d{4}-\d{2}-\d{2})/)?.[1];
  return d ? `${ms ? 'Dikemas kini' : 'Updated'} ${dateLabel(d)}` : '';
}
