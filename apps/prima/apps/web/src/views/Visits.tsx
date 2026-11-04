import { useState } from 'react';
import { EVIDENCE_PLACE_LABEL } from '@prima/core';
import { api, type SiteVisits } from '../api';
import { Chip, ErrorNotice, dateTimeLabel, hhmm, useAction, useLoad } from '../ui';
import { EvidenceCamera, PhotoCard } from './Camera';

type TestPlace = 'site' | 'away' | 'gps';

/**
 * Site visits (Fauzan, 25 Oct 2026): check in by GPS with the server's time, take stamped photos with the in-app
 * camera, and close with findings. A visit checked in away from the site is shown in red for the company to ask about.
 */
export function SiteVisitsSection({ siteId }: { siteId: string }) {
  const { data, error } = useLoad(() => api.siteVisits(siteId), [siteId]);
  const [purpose, setPurpose] = useState('');
  const [where, setWhere] = useState<TestPlace>(api.mode === 'demo' ? 'site' : 'gps');
  const [open, setOpen] = useState<string | null>(null);
  const act = useAction();
  if (error) return <ErrorNotice error={error} />;
  if (!data) return null;
  const site = data.site;

  const locate = (): Promise<{ lat: number | null; lng: number | null; accuracyM: number | null }> => {
    if (where === 'site') return Promise.resolve({ lat: site.lat + 0.0001, lng: site.lng - 0.0001, accuracyM: 8 });
    if (where === 'away') return Promise.resolve({ lat: site.lat + 0.012, lng: site.lng, accuracyM: 12 });
    return new Promise((resolve) => {
      if (!navigator.geolocation) return resolve({ lat: null, lng: null, accuracyM: null });
      navigator.geolocation.getCurrentPosition(
        (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracyM: Math.round(p.coords.accuracy) }),
        () => resolve({ lat: null, lng: null, accuracyM: null }),
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 },
      );
    });
  };

  const start = async () => {
    const loc = await locate();
    const r = await act.run(() => api.startSiteVisit(siteId, { ...loc, purpose }), 'Visit started. Take photos at the site, then close it.');
    if (r) setPurpose('');
  };

  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <h3 style={{ margin: 0 }}>Site visits</h3>
      {data.mine && <MyVisit v={data.visits.find((x) => x.visit.id === data.mine!.id)!} site={site} />}
      {data.canVisit && !data.mine && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <input
            className="input"
            aria-label="Visit purpose"
            placeholder="Why you are visiting: routine check, client meeting…"
            value={purpose}
            onChange={(e) => setPurpose(e.target.value)}
          />
          {api.mode === 'demo' && (
            <div className="seg" style={{ flexWrap: 'wrap', alignSelf: 'flex-start' }} aria-label="Test only: where you are">
              <button aria-pressed={where === 'site'} onClick={() => setWhere('site')}>
                Test: at the site
              </button>
              <button aria-pressed={where === 'away'} onClick={() => setWhere('away')}>
                Test: 1.3 km away
              </button>
              <button aria-pressed={where === 'gps'} onClick={() => setWhere('gps')}>
                This phone's GPS
              </button>
            </div>
          )}
          <div>
            <button className="btn btn-primary" disabled={act.busy} onClick={start}>
              Start site visit
            </button>
          </div>
          <ErrorNotice error={act.error} />
        </div>
      )}
      <div className="list">
        {data.visits.length === 0 && <div className="empty">No site visits recorded.</div>}
        {data.visits
          .filter((x) => x.visit.id !== data.mine?.id)
          .map(({ visit: v, photos }) => (
            <div key={v.id} className="list-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 6 }}>
              <button
                className="row"
                style={{ justifyContent: 'space-between', background: 'none', border: 0, padding: 0, textAlign: 'left', cursor: 'pointer', color: 'inherit' }}
                onClick={() => setOpen(open === v.id ? null : v.id)}
                aria-expanded={open === v.id}
              >
                <div>
                  <div style={{ fontWeight: 600 }}>
                    {v.visitorName} · {dateTimeLabel(v.startedAt)}
                    {v.endedAt ? `–${hhmm(v.endedAt)}` : ''}
                  </div>
                  <div className="muted small">
                    {v.visitorTitle} · {v.purpose} · {photos.length} photo{photos.length === 1 ? '' : 's'}
                  </div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
                  <Chip tone={v.place === 'on_site' ? 'ok' : v.place === 'away' ? 'crit' : 'warn'}>
                    {EVIDENCE_PLACE_LABEL[v.place]} · {v.distanceM} m
                  </Chip>
                  <Chip tone={v.status === 'open' ? 'info' : 'neutral'}>{v.status === 'open' ? 'In progress' : 'Closed'}</Chip>
                </div>
              </button>
              {open === v.id && (
                <>
                  {v.findings && <div className="small">{v.findings}</div>}
                  {photos.map((p) => (
                    <PhotoCard key={p.id} p={p} />
                  ))}
                </>
              )}
            </div>
          ))}
      </div>
    </section>
  );
}

function MyVisit({ v, site }: { v: SiteVisits['visits'][number]; site: SiteVisits['site'] }) {
  const [findings, setFindings] = useState('');
  const [taking, setTaking] = useState(v.photos.length === 0);
  const act = useAction();
  return (
    <div className="panel" style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <strong>Your visit since {hhmm(v.visit.startedAt)}</strong>
        <Chip tone={v.visit.place === 'on_site' ? 'ok' : v.visit.place === 'away' ? 'crit' : 'warn'}>
          {EVIDENCE_PLACE_LABEL[v.visit.place]} · {v.visit.distanceM} m
        </Chip>
      </div>
      {v.photos.map((p) => (
        <PhotoCard key={p.id} p={p} />
      ))}
      {taking ? (
        <EvidenceCamera site={site} refText={`Visit ${site.code}`} onSend={(p) => api.addVisitPhoto(v.visit.id, p)} onDone={() => setTaking(false)} />
      ) : (
        <div>
          <button className="btn" onClick={() => setTaking(true)}>
            Take another photo
          </button>
        </div>
      )}
      <textarea className="textarea" aria-label="Visit findings" placeholder="What you found" value={findings} onChange={(e) => setFindings(e.target.value)} />
      <ErrorNotice error={act.error} />
      <div>
        <button
          className="btn btn-primary"
          disabled={act.busy}
          onClick={() => act.run(() => api.closeSiteVisit(v.visit.id, findings), 'Site visit closed')}
          title={v.photos.length ? undefined : 'Take at least one photo first'}
        >
          Close visit
        </button>
      </div>
    </div>
  );
}
