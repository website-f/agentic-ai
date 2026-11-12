// E7 (P100, Fauzan 11 Nov 2026): CMS operators open the CMS console with their Prima sign-in (Microsoft), instead of a
// personal operator key. Prima checks who may (roster staff with their own account, or Arms Control) and hands the
// console a one-time ticket that lasts 60 seconds; the console keeps its own short session.
import { useState } from 'react';
import { MonitorIcon } from '@phosphor-icons/react';
import { api } from '../api';
import { Card } from '../kit';
import { Chip, ErrorNotice, useAction, useLoad } from '../ui';
import '../styles/p100-newb.css';

export function CmsConsoleCard() {
  const { data } = useLoad(() => api.cmsConsole(), []);
  const act = useAction();
  const [going, setGoing] = useState(false);
  if (!data || !data.may) return null;
  return (
    <Card
      title="CMS console"
      sub="The 24-hour console opens with your Prima sign-in (Microsoft). No operator key is needed."
      actions={data.on ? <Chip tone="ok">Ready</Chip> : <Chip tone="neutral">Not set up yet</Chip>}
    >
      {data.on ? (
        <div className="nb-actions" style={{ justifyContent: 'flex-start', marginTop: 0 }}>
          <button
            className="btn btn-primary"
            type="button"
            disabled={act.busy || going}
            onClick={async () => {
              const r = await act.run(() => api.cmsConsoleSignIn());
              if (r) {
                setGoing(true);
                window.location.assign(r.url);
              }
            }}
          >
            <MonitorIcon size={16} aria-hidden="true" /> Open the CMS console
          </button>
        </div>
      ) : (
        <p className="nb-note">IT sets the CMS address and the shared sign-in secret on Prima and on the CMS server. Until then the console cannot be opened from here.</p>
      )}
      <ErrorNotice error={act.error} />
    </Card>
  );
}
