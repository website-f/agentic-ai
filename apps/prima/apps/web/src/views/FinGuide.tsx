import { finGuidesFor, type FinText } from '@prima/core';
import { useApp } from '../App';
import { useLang } from '../i18n';

/**
 * The guide card for a Finance task (Arisha main's review, 2 Nov 2026, section A): what to enter, which documents,
 * where to find them and whom to ask. Bahasa Melayu first with English beneath (English only when the screen is set to
 * English). Shown only when the card belongs to the person's role; Arisha answers from the same cards.
 */
export function FinGuide({ id }: { id: string }) {
  const { me } = useApp();
  const { lang } = useLang();
  const g = finGuidesFor(me.user).find((x) => x.id === id);
  if (!g) return null;
  const T = ({ t }: { t: FinText }) =>
    lang === 'en' ? (
      <>{t.en}</>
    ) : (
      <>
        {t.ms}
        {lang === 'mix' && <span className="muted"> / {t.en}</span>}
      </>
    );
  return (
    <details className="panel small" style={{ padding: '8px 12px' }} data-guide={g.id}>
      <summary style={{ cursor: 'pointer', fontWeight: 600 }}>
        {lang === 'en' ? 'How to do this' : 'Cara membuatnya'}
        {lang === 'mix' && <span className="muted"> / How to do this</span>}: <T t={g.title} />
      </summary>
      <div className="stack" style={{ gap: 6, marginTop: 6 }}>
        <div>
          <T t={g.purpose} />
        </div>
        <div>
          <strong>{lang === 'en' ? 'Where' : 'Di mana'}:</strong> <T t={g.where} />
        </div>
        {g.fields.length > 0 && (
          <div>
            <strong>{lang === 'en' ? 'What to enter' : 'Apa yang diisi'}:</strong>
            <ul style={{ margin: '2px 0 0 18px' }}>
              {g.fields.map((f) => (
                <li key={f.key}>
                  <T t={f.label} />
                  {f.required ? '' : lang === 'en' ? ' (optional)' : ' (pilihan)'}: <T t={f.format} />
                  {(typeof f.example === 'string' || typeof f.example === 'number') && !/Id$/.test(f.key) && !['subject', 'sector', 'period'].includes(f.key)
                    ? f.example !== '' && (
                        <span className="muted">
                          {' '}
                          · {lang === 'en' ? 'e.g.' : 'cth.'} {String(f.example)}
                        </span>
                      )
                    : null}
                </li>
              ))}
            </ul>
          </div>
        )}
        {[
          [lang === 'en' ? 'Documents and where to find them' : 'Dokumen dan di mana mencarinya', g.sources],
          [lang === 'en' ? 'Whom to ask' : 'Siapa ditanya', g.ask],
          [lang === 'en' ? 'Already in Prima (not typed again)' : 'Sudah ada dalam Prima (tidak diisi lagi)', g.reused],
          [lang === 'en' ? 'Steps' : 'Langkah', g.steps],
          [lang === 'en' ? 'If Prima refuses' : 'Jika Prima menolak', g.recover],
          [lang === 'en' ? 'Note' : 'Nota', g.notes ?? []],
        ]
          .filter(([, list]) => (list as FinText[]).length > 0)
          .map(([h, list]) => (
            <div key={h as string}>
              <strong>{h as string}:</strong>
              <ul style={{ margin: '2px 0 0 18px' }}>
                {(list as FinText[]).map((t, i) => (
                  <li key={i}>
                    <T t={t} />
                  </li>
                ))}
              </ul>
            </div>
          ))}
        <div>
          <strong>{lang === 'en' ? 'Done when' : 'Selesai bila'}:</strong> <T t={g.done} />
        </div>
        <div className="muted">
          {g.id} v{g.version}
        </div>
      </div>
    </details>
  );
}
