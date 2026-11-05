import { useState } from 'react';
import { api, type GuideCardItem } from '../api';
import { useLang } from '../i18n';
import { Chip, ErrorNotice, Loading, useLoad } from '../ui';

/**
 * Guide cards (Arisha review, 2 Nov 2026, section A): what to enter, where the source is, whom to ask, what is entered
 * once and reused, and what happens after Save. Read-only help from the server's role-scoped mapping; the same cards
 * Arisha reads. Bahasa Melayu first, with English.
 */
type Text = { bm: string; en: string };

function Say({ text, block = false }: { text: Text; block?: boolean }) {
  const { lang } = useLang();
  const Tag = block ? 'p' : 'span';
  if (lang === 'en') return <Tag data-no-translate>{text.en}</Tag>;
  if (lang === 'ms') return <Tag data-no-translate>{text.bm}</Tag>;
  return (
    <Tag data-no-translate>
      {text.bm} <span className="muted">({text.en})</span>
    </Tag>
  );
}

const STATUS: Record<GuideCardItem['status'], [string, 'ok' | 'warn' | 'unknown']> = {
  ready: ['Sedia / Ready', 'ok'],
  partial: ['Sebahagian / Partly built', 'warn'],
  not_built: ['Belum dibina / Not built', 'unknown'],
  off: ['Dimatikan di sini / Switched off here', 'unknown'],
};

export function GuideCardView({ card, open: startOpen = false }: { card: GuideCardItem; open?: boolean }) {
  const [open, setOpen] = useState(startOpen);
  return (
    <article className="card" aria-label={card.title.en}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <button className="link-button" aria-expanded={open} onClick={() => setOpen(!open)}>
          <Say text={card.title} />
        </button>
        <Chip tone={STATUS[card.status][1]}>{STATUS[card.status][0]}</Chip>
      </div>
      {open && (
        <div className="small" style={{ display: 'grid', gap: 6, marginTop: 6 }}>
          <Say block text={card.purpose} />
          <div>
            <strong>Siapa / Who:</strong> <Say text={card.who} />
          </div>
          <div>
            <strong>Skrin / Screen:</strong> {card.screen.name}. <Say text={card.screen.action} />
          </div>
          <div className="notice" data-tone="info">
            <strong>Kunci sekali, guna semula / Entered once, reused:</strong> <Say text={card.enteredOnce} />
            {card.feeds.length > 0 && (
              <div>
                Dihantar terus kepada / Sent on to: {card.feeds.map((f) => `${f.desk}${f.kind === 'todo' ? ' (tugas / to do)' : ''}`).join(', ')}.
              </div>
            )}
          </div>
          {card.fields.length > 0 && (
            <table className="table">
              <thead>
                <tr>
                  <th>Medan / Field</th>
                  <th>Format</th>
                  <th>Contoh / Example</th>
                </tr>
              </thead>
              <tbody>
                {card.fields.map((f) => (
                  <tr key={f.key}>
                    <td>
                      {f.label}
                      {f.required ? ' *' : ''}
                    </td>
                    <td>
                      <Say text={f.format} />
                      {f.choices ? ` ${f.choices.join(' / ')}` : ''}
                      {f.rule && (
                        <div>
                          <strong>Peraturan / Rule:</strong> <Say text={f.rule} />
                        </div>
                      )}
                    </td>
                    <td>{f.example}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {card.sources.map((s, i) => (
            <div key={i}>
              <strong>Sumber / Source:</strong> <Say text={s.what} /> <strong>Tanya / Ask:</strong> {s.askDeskName}.
            </div>
          ))}
          <ol style={{ margin: 0 }}>
            <li>
              <Say text={card.steps.save} />
            </li>
            <li>
              <Say text={card.steps.review} />
            </li>
            <li>
              <Say text={card.steps.returned} />
            </li>
            <li>
              <Say text={card.steps.done} />
            </li>
            <li>
              <Say text={card.steps.recover} />
            </li>
          </ol>
          {card.notVerified.map((n, i) => (
            <p key={i} className="notice" data-tone="unknown">
              <Say text={n} />
            </p>
          ))}
          <p className="muted">Panduan sahaja; tiada apa disimpan dari sini. / Guidance only; nothing is saved from here. v{card.version}</p>
        </div>
      )}
    </article>
  );
}

/** All my cards (Hand-overs, Guide tab). */
export function MyGuide() {
  const { data, error } = useLoad(() => api.org.guide(), []);
  if (error) return <ErrorNotice error={error} />;
  if (!data) return <Loading what="your guide" />;
  return (
    <>
      <p className="muted">
        Tugas yang anda dibenarkan sahaja. / Only the tasks you are allowed to do. Versi / Version {data.version}.
      </p>
      {!data.cards.length && <p className="muted">Tiada tugas untuk dipandu. / No tasks to guide.</p>}
      <div className="list">
        {data.cards.map((c) => (
          <GuideCardView key={c.id} card={c} />
        ))}
      </div>
    </>
  );
}

/** The card for one record form, inside its Add/Edit drawer. */
export function RecordGuide({ kind }: { kind: string }) {
  const { data } = useLoad(() => api.org.guide(), []);
  const card = data?.cards.find((c) => c.id === `record.${kind}`);
  return card ? <GuideCardView card={card} /> : null;
}
