import { api, type DeliveryProof } from '../api';
import { Chip, ErrorNotice, Loading, dateLabel, useLoad } from '../ui';

const STEP_LABEL = { om: 'Operations Manager', patrol: 'Patrolling officer', guard: 'Guard' } as const;

/**
 * Proof that a Goodwill item reached the guard (Fauzan, 2 Nov 2026): who received it at each step and when, the
 * signature, slip and photo, and a check that each file still matches the SHA-256 written into the audit log.
 */
export function DeliveryProofPanel({ issueId }: { issueId: string }) {
  const { data, error } = useLoad(() => api.deliveryProof(issueId), [issueId]);
  if (error) return <ErrorNotice error={error} />;
  if (!data) return <Loading what="the delivery proof" />;
  return <ProofBody p={data} />;
}

function ProofBody({ p }: { p: DeliveryProof }) {
  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
        {p.delivered ? <Chip tone="ok">Guard acknowledged</Chip> : <Chip tone="warn">Not yet with the guard</Chip>}
        {p.allIntact ? <Chip tone="ok">Files match the audit log</Chip> : <Chip tone="crit">A file does not match the audit log</Chip>}
      </div>
      <div className="muted small">
        {p.issue.qty} x {p.itemName} for {p.issue.personName}
        {p.companyName ? ` (${p.companyName})` : ''}
        {p.issue.serial ? ` · serial ${p.issue.serial}` : ''} · issued {dateLabel(p.issue.issuedAt.slice(0, 10))} by {p.issue.issuedBy}
      </div>
      {p.steps.map((s) => (
        <div key={s.step} className="list-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 4 }}>
          <div className="row" style={{ justifyContent: 'space-between', gap: 6, flexWrap: 'wrap' }}>
            <strong>
              {STEP_LABEL[s.step]}: {s.who}
            </strong>
            {s.done ? (
              <Chip tone="ok">{s.signed ? 'Signed on screen' : s.step === 'om' ? 'Confirmed in Prima' : 'Signed slip'}</Chip>
            ) : (
              <Chip tone="warn">Not yet</Chip>
            )}
          </div>
          {s.done && (
            <>
              <div className="muted small">
                {s.at.slice(0, 16).replace('T', ' ')}
                {s.recordedBy ? ` · recorded by ${s.recordedBy}` : ''}
                {s.place
                  ? ` · phone location ${s.place.lat}, ${s.place.lng}${s.place.accuracyM != null ? ` (±${s.place.accuracyM} m, from the phone)` : ''}`
                  : ''}
              </div>
              <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'flex-start' }}>
                {s.files.map((f) => (
                  <figure key={f.id} style={{ margin: 0, maxWidth: 260 }}>
                    {f.mime.startsWith('image/') ? (
                      <img src={f.data} alt={f.name} style={{ width: '100%', border: '1px solid var(--line, #ccc)', borderRadius: 6, background: '#ffffff' }} />
                    ) : f.mime === 'application/pdf' ? (
                      <a href={f.data} download={`${f.name}.pdf`}>
                        {f.name} (PDF)
                      </a>
                    ) : (
                      <span>{f.name}</span>
                    )}
                    <figcaption className="small">
                      {f.name} {f.intact ? <Chip tone="ok">unchanged</Chip> : <Chip tone="crit">changed or missing</Chip>}
                      <div className="muted" style={{ wordBreak: 'break-all' }}>
                        SHA-256 {f.recordedSha256 ?? 'not recorded'}
                      </div>
                    </figcaption>
                  </figure>
                ))}
              </div>
            </>
          )}
        </div>
      ))}
      <details>
        <summary className="small">Audit log for this item ({p.audit.length})</summary>
        <ul className="small">
          {p.audit.map((a) => (
            <li key={a.seq}>
              #{a.seq} {a.at.slice(0, 16).replace('T', ' ')} {a.actor}: {a.summary}
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}
