import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { api } from '../api';
import { contractReviewClient } from '../api/it-import-review-contract-client';
import { durableReviewMarker } from '../api/it-import-review-marker';
import { blockedImportReviewClient } from '../api/it-import-review';
import { ItExtractionView } from './ItExtraction';
import { ItImportReview } from './ItImportReview';
import { ImportReviewSession, type ReviewActor } from './it-import-review-state';
export function ItExtractionWorkspace({ actor }: { actor: ReviewActor }) {
  const [reviewing, setReviewing] = useState(false);
  const session = useMemo(() => {
    const directory = async () => {
      const board = await api.itBoard();
      if (!('team' in board) || !board.team) throw new Error('Directory unavailable');
      return board.team;
    };
    let client = blockedImportReviewClient(directory);
    // Build flag stays false unless explicitly released. Server flag/readiness and Microsoft auth are additional gates.
    if (import.meta.env.VITE_ARISHA_IT_IMPORT_UI_ENABLED === 'true' && api.mode === 'server' && actor.id === 'u-fauzan' && actor.opsTier === 'ceo' && !actor.integration && api.itImportReviewAssertOwner && api.itImportReviewRequest) {
      try {
        const pending = durableReviewMarker({ ownerId: 'u-fauzan', namespace: new URL(import.meta.env.VITE_API_URL || window.location.origin, window.location.origin).origin,
          storage: window.localStorage, locks: navigator.locks, assertOwner: () => api.itImportReviewAssertOwner!() });
        client = contractReviewClient({ integrationEnabled: true, ownerId: 'u-fauzan', directory,
          markers: pending.store, claim: pending.claim, requestId: () => crypto.randomUUID(),
          transport: { request: (method, path, body) => api.itImportReviewRequest!(method, path, body) } });
      } catch { /* Unsupported durable storage/locks: keep all review writes disabled. */ }
    }
    return new ImportReviewSession(client, actor);
  }, [actor.id, actor.opsTier, actor.integration]);
  const reviewState = useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot);
  useEffect(() => { session.activate(); void session.load(); setReviewing(false); return () => session.dispose(); }, [session]);
  if (actor.id !== 'u-fauzan' || actor.opsTier !== 'ceo' || actor.integration) return <div className="page"><p role="alert" className="notice" data-tone="warn">This import workspace is restricted to the exact CEO account.</p></div>;
  return reviewing || !!reviewState.pendingReviewId || reviewState.phase === 'uncertain' ? <div className="page ix-page"><header className="k-head"><div className="k-head-text"><h1>AI data preview</h1></div></header><ItImportReview session={session} onBack={() => setReviewing(false)} /></div> : <ItExtractionView userId={actor.id} reviewDisabled={reviewState.phase === 'loading'} onReview={(extraction, edits) => {
    session.handoff(extraction, edits);
    setReviewing(true); // Also show expiry/refusal messages instead of silently ignoring the handoff.
  }} />;
}
