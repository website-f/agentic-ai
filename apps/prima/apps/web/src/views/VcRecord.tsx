import { useState } from 'react';
import type { ProofInput } from '@prima/core';
import type { VcRecordBody } from '../api';
import { ErrorNotice, useAction } from '../ui';
import { ProofPicker } from './Proof';

const HOW: { id: VcRecordBody['how']; label: string }[] = [
  { id: 'app', label: 'Message (WhatsApp, Teams, SMS, email)' },
  { id: 'call', label: 'Phone call' },
  { id: 'meeting', label: 'Meeting' },
  { id: 'letter', label: 'Letter' },
];

/**
 * HR gap B1 (Fauzan, 23 Nov 2026: "Vc not in system yet. But when consent needed. Cos or dcos or hr upload the consent
 * given from what app or call"): the Chief of Staff, the Deputy or the HR Administrator records the Vice Chairman's
 * answer, with how he gave it and the proof. The server refuses the person it is about and whoever took the step before.
 */
export function VcRecordForm({ refText, send, onClose }: { refText: string; send: (body: VcRecordBody) => Promise<unknown>; onClose: () => void }) {
  const today = new Date(Date.now() + 8 * 3_600_000).toISOString().slice(0, 10);
  const [how, setHow] = useState<VcRecordBody['how']>('app');
  const [givenOn, setGivenOn] = useState(today);
  const [note, setNote] = useState('');
  const [proof, setProof] = useState<ProofInput[]>([]);
  const act = useAction();
  const needsFile = how === 'app' || how === 'letter';
  const ready = note.trim().length >= 3 && (proof.length > 0 || (!needsFile && note.trim().length >= 15));
  const go = (consent: boolean) =>
    act.run(
      () => send({ consent, how, givenOn, note, proof }),
      consent ? "Recorded: the Vice Chairman consented." : "Recorded: the Vice Chairman refused.",
    ).then((r) => {
      if (r !== undefined) onClose();
    });
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, borderLeft: '3px solid var(--warn)', paddingLeft: 10 }}>
      <div className="small" style={{ fontWeight: 600 }}>
        Record the Vice Chairman's answer
      </div>
      <div className="muted small">
        Ask him by message or call, then record what he said here. Upload a screenshot of his message, his letter or the call log.
      </div>
      <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
        <label className="small">
          How he answered{' '}
          <select className="input" aria-label="How the Vice Chairman answered" value={how} onChange={(e) => setHow(e.target.value as VcRecordBody['how'])}>
            {HOW.map((h) => (
              <option key={h.id} value={h.id}>
                {h.label}
              </option>
            ))}
          </select>
        </label>
        <label className="small">
          On{' '}
          <input className="input" type="date" aria-label="Day he answered" value={givenOn} max={today} onChange={(e) => setGivenOn(e.target.value)} />
        </label>
      </div>
      <input
        className="input"
        aria-label="What the Vice Chairman said"
        placeholder={needsFile ? 'What he said (a short line)' : 'When you called or met him and what he said'}
        value={note}
        onChange={(e) => setNote(e.target.value)}
      />
      <ProofPicker site={null} refText={refText} items={proof} onChange={setProof} documentsOnly required={needsFile} />
      <ErrorNotice error={act.error} />
      <div className="row">
        <button className="btn btn-primary btn-sm" disabled={act.busy || !ready} onClick={() => go(true)}>
          He consented
        </button>
        <button className="btn btn-sm" disabled={act.busy || !ready} onClick={() => go(false)}>
          He refused
        </button>
        <button className="btn btn-ghost btn-sm" onClick={onClose}>
          Cancel
        </button>
      </div>
    </div>
  );
}
