import { api } from './api';
import { ErrorNotice, useAction, useLoad } from './ui';

/**
 * Fauzan, 28 Oct 2026: "Enforce secrecy in company." Before using Prima each person accepts the confidentiality rule
 * (SEC-CONFIDENTIAL); the acceptance is kept with the time. Nothing behind it opens until they accept.
 */
export function ConfidentialityGate({ userId }: { userId: string }) {
  const { data } = useLoad(() => api.confidentiality(), [userId]);
  const act = useAction();
  if (!data || data.accepted) return null;
  return (
    <div className="confid-gate" role="dialog" aria-modal="true" aria-labelledby="confid-title">
      <div className="confid-card">
        <div className="confid-mark">SULIT · CONFIDENTIAL</div>
        <h2 id="confid-title">Company information is confidential</h2>
        <ol>
          {data.points.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ol>
        <ErrorNotice error={act.error} />
        <button className="btn btn-primary" disabled={act.busy} onClick={() => act.run(() => api.acceptConfidentiality(), 'Thank you. Recorded.')}>
          I agree and will keep it confidential
        </button>
        <p className="muted small">Rule {data.ruleId}, version {data.version}. Your agreement is recorded with the time.</p>
      </div>
    </div>
  );
}
