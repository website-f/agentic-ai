import { api, type FwmBoard } from '../api';
import { ImportButton, QuickAddButton } from './ImportDrawer';

/**
 * P90 (Fitri, 9 Nov 2026: "in Prima FWM, foreign workers, there is no button to add the records"): FWM adds one worker
 * by hand, or loads the old list from any file. Both go through the same server add (FWM staff only); the screen shows
 * the buttons to FWM staff, the server checks again.
 */
export function FwAddButtons({ branches }: { branches: FwmBoard['branches'] }) {
  const byId = new Map(branches.map((b) => [b.id, b]));
  return (
    <>
      <ImportButton kind="fwWorker" />
      <QuickAddButton
        kind="fwWorker"
        label="Add foreign worker"
        options={{ branch: branches.map((b): [string, string] => [b.id, b.name]) }}
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
    </>
  );
}
