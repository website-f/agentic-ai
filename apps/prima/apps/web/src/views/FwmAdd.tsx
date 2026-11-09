import { useState } from 'react';
import { api, type FwmBoard } from '../api';
import { AddImportMenu } from './AddImportMenu';
import { QuickAddDrawer } from './ImportDrawer';

/**
 * P90 (Fitri, 9 Nov 2026: "in Prima FWM, foreign workers, there is no button to add the records"): FWM adds one worker
 * by hand, or loads the old list from any file. Both go through the same server add; the server checks again.
 *
 * P93 (Fitri, 9 Nov 2026: "where do I add the old records, where is the Add button?"): one Add and one Import at the top
 * of the screen (the P91 pattern), for FWM staff and the owner (P78). Old paper dates of workers already in Prima import
 * as opening records ("Typed in, copy not seen"); the next paper is still recorded from its copy.
 */
export function FwAddMenu({ branches, onPapers }: { branches: FwmBoard['branches']; onPapers: () => void }) {
  const [adding, setAdding] = useState(false);
  const byId = new Map(branches.map((b) => [b.id, b]));
  return (
    <>
      <AddImportMenu
        entries={[
          { key: 'worker', label: 'Foreign worker', onAdd: () => setAdding(true), importKind: 'fwWorker' },
          { key: 'papers', label: 'Paper dates from the old system', onAdd: onPapers, importKind: 'fwPaper' },
        ]}
      />
      {adding && (
        <QuickAddDrawer
          kind="fwWorker"
          title="Add foreign worker"
          options={{ branch: branches.map((b): [string, string] => [b.id, b.name]) }}
          onClose={() => setAdding(false)}
          save={(v) => {
            const b = byId.get(String(v.branch ?? ''));
            if (!b) throw new Error('Choose the branch.');
            return api.addFwWorker({
              companyId: b.companyId,
              branchId: b.id,
              staffNo: String(v.staffNo ?? ''),
              name: String(v.name ?? ''),
              nationality: v.nationality,
              dob: String(v.dob ?? ''),
              hiredOn: String(v.hiredOn ?? ''),
              phone: v.phone,
              passportNo: v.passportNo,
              passportIssuedOn: v.passportIssuedOn,
              passportExpiresOn: v.passportExpiresOn,
              permitNo: v.permitNo,
              permitIssuedOn: v.permitIssuedOn,
              permitExpiresOn: v.permitExpiresOn,
              fomemaExpiresOn: v.fomemaExpiresOn,
              insuranceExpiresOn: v.insuranceExpiresOn,
              spikpaExpiresOn: v.spikpaExpiresOn,
            });
          }}
        />
      )}
    </>
  );
}

/** Where the Add button would be, for someone who may not add: who adds instead, never a silent gap. */
export function NoAddNote({ children }: { children: string }) {
  return <p className="p93-noadd">{children}</p>;
}
