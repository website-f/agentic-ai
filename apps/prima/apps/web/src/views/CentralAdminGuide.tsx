import { useState } from 'react';
import { centralAdminGuideFor, type GuideCard } from '@prima/core';
import { useApp } from '../App';
import { useLang } from '../i18n';

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
  const both = lang !== 'en';
  const say = (x: { ms: string; en: string }) =>
    both ? (
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
        {both ? 'Panduan langkah demi langkah' : 'Step-by-step guide'} ({cards.length}) <span className="muted small">{g.version}</span>
      </summary>
      {cards.map((c) => (
        <article key={c.id} className="small" style={{ marginTop: 8 }}>
          <strong>{say(c.title)}</strong>
          <p>{say(c.purpose)}</p>
          <p>
            <b>{both ? 'Siapa' : 'Who'}:</b> {say(c.responsible)}
          </p>
          <p>
            <b>{both ? 'Di mana' : 'Where'}:</b> {say(c.where)}
          </p>
          {c.fields.length > 0 && (
            <ul>
              {c.fields.map((f, i) => (
                <li key={i}>
                  {say(f.name)} {f.required ? (both ? '(wajib)' : '(required)') : both ? '(pilihan)' : '(optional)'}: {say(f.format)}.{' '}
                  {both ? 'Contoh' : 'Example'}: {f.example}
                </li>
              ))}
            </ul>
          )}
          <p>
            <b>{both ? 'Dokumen sumber' : 'Source document'}:</b> {say(c.source)}
          </p>
          <p>
            <b>{both ? 'Tanya' : 'Ask'}:</b> {say(c.ask)}
          </p>
          <p>
            <b>{both ? 'Kunci sekali' : 'Key once'}:</b> {say(c.reuse)}
          </p>
          <ol>
            {c.steps.map((s, i) => (
              <li key={i}>{say(s)}</li>
            ))}
          </ol>
          <p>
            <b>{both ? 'Dipulangkan' : 'Sent back'}:</b> {say(c.returned)}
          </p>
          <p>
            <b>{both ? 'Bukti selesai' : 'Done evidence'}:</b> {say(c.evidence)}
          </p>
          <p>
            <b>{both ? 'Jika ada ralat' : 'If something fails'}:</b> {say(c.recover)}
          </p>
          <p className="muted">
            <b>{both ? 'Had' : 'Limits'}:</b> {say(c.limits)}
          </p>
        </article>
      ))}
    </details>
  );
}
