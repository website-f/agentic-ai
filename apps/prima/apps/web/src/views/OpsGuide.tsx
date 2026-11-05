import { useState } from 'react';
import { specialOpsGuideCardsFor } from '@prima/core';
import { useApp } from '../App';
import { useLang } from '../i18n';

/**
 * Special Ops and Asset Management guide cards (review, 2 Nov 2026), from the shared card mapping in @prima/core
 * (special-ops-guide.ts, the same cards Arisha reads once combined with the hand-over guide). Read-only help per role,
 * Bahasa Melayu first with English. It never saves, approves or sends; the screen's own action and the server decide.
 */
export function OpsGuide({ area }: { area: 'arms' | 'assets' }) {
  const { me } = useApp();
  const { lang } = useLang();
  const [open, setOpen] = useState<string | null>(null);
  const cards = specialOpsGuideCardsFor(me.user, area);
  if (!cards.length) return null;
  const en = lang === 'en';
  const t = (x: { bm: string; en: string }) =>
    en ? (
      x.en
    ) : (
      <>
        {x.bm}
        <span className="muted small" style={{ display: 'block' }}>
          {x.en}
        </span>
      </>
    );
  const row = (bm: string, eng: string, x: { bm: string; en: string }) => (
    <div>
      <strong>{en ? eng : bm}:</strong> {t(x)}
    </div>
  );
  return (
    <section className="panel" aria-label={en ? 'How to do it' : 'Panduan langkah demi langkah'}>
      <div className="panel-head">
        <div>
          <h2>{en ? 'How to do it' : 'Panduan langkah demi langkah'}</h2>
          <div className="muted small">{en ? 'Help only: it does not save or approve anything.' : 'Panduan sahaja: ia tidak menyimpan atau meluluskan apa-apa.'}</div>
        </div>
      </div>
      <div className="list">
        {cards.map((c) => (
          <div key={c.id} className="list-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 4 }}>
            <button className="link-button" aria-expanded={open === c.id} onClick={() => setOpen(open === c.id ? null : c.id)} style={{ textAlign: 'left' }}>
              <span style={{ fontWeight: 600 }}>{en ? c.title.en : c.title.bm}</span>
            </button>
            {open === c.id && (
              <div className="small" style={{ display: 'grid', gap: 6 }}>
                <div>{t(c.purpose)}</div>
                {row('Siapa', 'Who', c.who)}
                {row('Di mana', 'Where', c.screen.action)}
                <div>
                  <strong>{en ? 'What to enter' : 'Apa yang perlu diisi'}:</strong>
                  <ul style={{ margin: '4px 0 0 18px' }}>
                    {c.fields.map((x) => (
                      <li key={x.key}>
                        {x.label} {x.required ? '' : en ? '(optional)' : '(pilihan)'} · <span className="muted">{en ? x.format.en : x.format.bm}</span>
                      </li>
                    ))}
                  </ul>
                </div>
                {c.sources.map((s, i) => (
                  <div key={i}>
                    <strong>{en ? 'Documents and whom to ask' : 'Dokumen dan siapa ditanya'}:</strong> {t(s.what)}
                    {s.askDesk === 'asset' ? <span className="muted"> · Asset Management</span> : s.askName ? <span className="muted"> · {s.askName}</span> : null}
                  </div>
                ))}
                {row('Diisi sekali sahaja', 'Entered once', c.enteredOnce)}
                {row('Simpan', 'Save', c.steps.save)}
                {row('Semakan', 'Review', c.steps.review)}
                {row('Jika dipulangkan', 'If it comes back', c.steps.returned)}
                {row('Selesai', 'Done', c.steps.done)}
                {row('Jika ada masalah', 'If it goes wrong', c.steps.recover)}
                {c.notVerified.length > 0 && (
                  <div className="muted">
                    <strong>{en ? 'Not verified yet' : 'Belum disahkan'}:</strong>
                    <ul style={{ margin: '4px 0 0 18px' }}>
                      {c.notVerified.map((n, i) => (
                        <li key={i}>{en ? n.en : n.bm}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
