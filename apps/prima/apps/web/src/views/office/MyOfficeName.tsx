/**
 * P141 (Fitri, 27 Nov 2026: people added from their email "can change their name later in settings"): on My details, someone who
 * signs in with an office account (Prima id "u-off-…") changes the name the office shows for them (PUT /api/account/name).
 */
import { useEffect, useState } from 'react';
import { office } from '../../api/office';
import { Card } from '../../kit';
import { ErrorNotice, useAction, useLoad } from '../../ui';

const tidy = (s: string) => s.trim().replace(/\s+/g, ' ');

export function MyOfficeName() {
  const me = useLoad(() => office.me(), []);
  const act = useAction();
  const current = me.data?.user.name ?? '';
  const [name, setName] = useState(current);
  useEffect(() => setName(current), [current]);
  if (!me.data) return null;
  const next = tidy(name);
  const ok = next.length >= 2 && next.length <= 120 && next !== current;
  const save = async () => {
    if (!ok) return;
    const r = await act.run(() => office.setMyName(next), 'Saved. The office shows your new name.');
    if (r) me.reload();
  };
  return (
    <Card title="Name shown in the office" sub="How colleagues see your name in the office. Your sign-in email stays the same.">
      <form
        style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <input className="input" style={{ flex: '1 1 220px', minWidth: 0 }} aria-label="Name shown in the office" maxLength={120} value={name} onChange={(e) => setName(e.target.value)} data-no-translate />
        <button className="btn btn-primary btn-sm" disabled={act.busy || !ok}>
          {act.busy ? 'Saving…' : 'Save'}
        </button>
      </form>
      <ErrorNotice error={act.error} />
    </Card>
  );
}
