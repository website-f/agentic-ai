import { useEffect, useState } from 'react';
import { api } from '../api';

export interface WitnessValue {
  staffNo: string;
  pin: string;
}

export const emptyWitness: WitnessValue = { staffNo: '', pin: '' };

/**
 * The witness types their own staff number and PIN on this screen, so a name can no longer be typed for someone who was
 * not there (insider abuse audit, 27 Oct 2026). The test link shows a few staff who can witness, with their test PINs.
 */
export function WitnessField({ id, companyId, value, onChange }: { id: string; companyId: string; value: WitnessValue; onChange: (v: WitnessValue) => void }) {
  const [demo, setDemo] = useState<{ name: string; staffNo: string; pin: string }[]>([]);
  useEffect(() => {
    let live = true;
    if (api.demoWitnesses) void api.demoWitnesses(companyId).then((w) => live && setDemo(w));
    return () => {
      live = false;
    };
  }, [companyId]);
  return (
    <div className="field">
      <span className="label">Witness signs in here</span>
      <div className="grid-2">
        <input
          id={`${id}-no`}
          className="input mono"
          aria-label="Witness staff number"
          placeholder="Staff number"
          autoComplete="off"
          value={value.staffNo}
          onChange={(e) => onChange({ ...value, staffNo: e.target.value })}
        />
        <input
          id={`${id}-pin`}
          className="input mono"
          aria-label="Witness PIN"
          placeholder="PIN"
          type="password"
          inputMode="numeric"
          autoComplete="off"
          value={value.pin}
          onChange={(e) => onChange({ ...value, pin: e.target.value })}
        />
      </div>
      <span className="muted small">The second person present enters their own staff number and PIN. It cannot be the person doing it or receiving it.</span>
      {demo.length > 0 && (
        <span className="muted small">
          Test link only:{' '}
          {demo.map((w, i) => (
            <button key={w.staffNo} type="button" className="link-button" onClick={() => onChange({ staffNo: w.staffNo, pin: w.pin })}>
              {i > 0 ? ', ' : ''}
              {w.name} ({w.staffNo}, PIN {w.pin})
            </button>
          ))}
        </span>
      )}
    </div>
  );
}
