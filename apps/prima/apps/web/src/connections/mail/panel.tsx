import { useEffect, useRef, useState } from 'react';
import type { Adapter, ProviderPanelProps } from '../contract';
import { addressList, mailAdapterCore, type DraftView, type MailClient } from './adapter';

const stateText: Record<DraftView['state'], string> = {
  Draft: 'Ready for your review. Nothing has been sent.',
  Sending: 'Sending from your mailbox. Do not press Send again.',
  Accepted: 'Accepted by Microsoft for delivery from your own mailbox. This does not confirm delivery or that a copy is in Sent Items yet.',
  Failed: 'Not sent. Microsoft refused the message or could not be reached before sending. You may correct it and press Send again.',
  Uncertain: 'We could not confirm whether Microsoft accepted it. This draft is locked and will never be sent again. Check your Outlook Sent Items, then tell us what you found.',
  Discarded: 'Discarded. Nothing was sent.',
};
/** Server refusals of the person's own input (bad address, changed draft, wait) are shown; anything else invalidates. */
const inputError = (e: unknown) => {
  const status = (e as { status?: unknown })?.status;
  return status === 400 || status === 409 ? String((e as Error).message || 'That was refused. Check the draft and try again.') : null;
};

/**
 * Compose → review → explicit Send. Nothing is requested on mount; every request is a button press and every
 * response must be for the signed-in user. Any unexpected failure invalidates the card, and "Find my recent
 * drafts" recovers a draft after a reload, a lost response or an account switch.
 */
function makeMailPanel(client: MailClient) {
  return function MailPanel({ userId, evidence, signal, cancel, fail }: ProviderPanelProps) {
    const [to, setTo] = useState(''); const [cc, setCc] = useState('');
    const [subject, setSubject] = useState(''); const [body, setBody] = useState('');
    const [draft, setDraft] = useState<DraftView | null>(null);
    const [recent, setRecent] = useState<DraftView[] | null>(null);
    const [busy, setBusy] = useState(false); const [error, setError] = useState('');
    const [reported, setReported] = useState(false);
    const inFlight = useRef(false);
    useEffect(() => {
      const clear = () => { setDraft(null); setRecent(null); setBusy(false); setError(''); setReported(false); inFlight.current = false; };
      signal.addEventListener('abort', clear, { once: true });
      return () => signal.removeEventListener('abort', clear);
    }, [signal]);
    if (!evidence || evidence.userId !== userId) return null;

    async function run<T>(fn: () => Promise<T>, apply: (value: T) => void) {
      if (inFlight.current) return;
      inFlight.current = true; setBusy(true); setError('');
      try { const value = await fn(); if (!signal.aborted) apply(value); }
      catch (e) { if (!signal.aborted) { const message = inputError(e); if (message) setError(message); else fail(); } }
      finally { inFlight.current = false; if (!signal.aborted) setBusy(false); }
    }
    const open = (d: DraftView) => { setReported(false); setDraft(d); setTo(d.to.join(', ')); setCc(d.cc.join(', ')); setSubject(d.subject); setBody(d.body); };
    const content = () => ({ to: addressList(to), cc: addressList(cc), subject, body });
    const editable = !draft || draft.state === 'Draft' || draft.state === 'Failed';
    const waiting = !!draft?.retryNotBefore && Date.parse(draft.retryNotBefore) > Date.now();
    const canSend = !!draft && (draft.state === 'Draft' || draft.state === 'Failed') && draft.identityMatches && !waiting;

    return <div style={{ marginTop: 12 }}>
      <p className="notice" data-tone="warn">This sends real email from your own Microsoft 365 mailbox when you press Send. Prima does not read your inbox, reply for you or let Arisha send. Plain text, no attachments.</p>
      <p className="small muted">The access check only confirms Prima may ask Microsoft on your behalf. It does not prove your mailbox can send; Microsoft's answer to Send does.</p>
      <button className="btn btn-sm" disabled={busy} onClick={() => void run(() => client.list(userId, signal), setRecent)}>Find my recent drafts</button>
      {recent && <ul aria-label="Your recent drafts" style={{ paddingLeft: 20 }}>
        {recent.length === 0 && <li className="small muted">No recent drafts.</li>}
        {recent.map(d => <li key={d.id}><button className="btn btn-sm" onClick={() => { open(d); setRecent(null); }}>{d.subject}</button> <span className="small muted">{d.state}</span></li>)}
      </ul>}
      {editable && <form onSubmit={e => { e.preventDefault(); void run(() => draft ? client.edit(userId, draft.id, content(), signal) : client.create(userId, content(), signal), open); }}>
        <label htmlFor="mail-to">To</label><input id="mail-to" className="input" value={to} onChange={e => setTo(e.target.value)} autoComplete="off" />
        <label htmlFor="mail-cc">Cc</label><input id="mail-cc" className="input" value={cc} onChange={e => setCc(e.target.value)} autoComplete="off" />
        <label htmlFor="mail-subject">Subject</label><input id="mail-subject" className="input" maxLength={200} value={subject} onChange={e => setSubject(e.target.value)} />
        <label htmlFor="mail-body">Message</label><textarea id="mail-body" className="input" rows={8} maxLength={20000} value={body} onChange={e => setBody(e.target.value)} />
        <button className="btn" type="submit" disabled={busy}>{draft ? 'Save changes for review' : 'Save draft for review'}</button>
      </form>}
      {draft && <section aria-label="Review before sending" className="panel" style={{ padding: 12, marginTop: 12 }}>
        <h3>Review</h3>
        <p className="small" style={{ overflowWrap: 'anywhere' }}><strong>To:</strong> {draft.to.join(', ')}{draft.cc.length > 0 && <><br /><strong>Cc:</strong> {draft.cc.join(', ')}</>}<br /><strong>Subject:</strong> {draft.subject}</p>
        <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{draft.body}</pre>
        <p role="status">{stateText[draft.state]}</p>
        {!draft.identityMatches && <p className="notice" data-tone="warn">This draft was written under a different Microsoft account. Save it again to review it under this account before sending.</p>}
        {waiting && <p className="notice" data-tone="info">Microsoft asked Prima to wait. You can press Send again after <time dateTime={draft.retryNotBefore!}>{draft.retryNotBefore}</time>.</p>}
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          {canSend && <button className="btn btn-primary" disabled={busy} onClick={() => void run(() => client.send(userId, draft.id, draft.contentHash, signal), r => open(r.draft))}>Send from my mailbox</button>}
          {editable && <button className="btn" disabled={busy} onClick={() => void run(() => client.discard(userId, draft.id, signal), open)}>Discard</button>}
          <button className="btn btn-sm" disabled={busy} onClick={() => void run(() => client.get(userId, draft.id, signal), open)}>Reload this draft</button>
        </div>
        {draft.state === 'Uncertain' && <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
          <button className="btn" disabled={busy} onClick={() => void run(() => client.resolve(userId, draft.id, 'found', signal), open)}>I found it in Sent Items</button>
          <button className="btn" disabled={busy} onClick={() => void run(() => client.resolve(userId, draft.id, 'not-found', signal), d => { open(d); setReported(d.state === 'Uncertain'); })}>It is not in Sent Items</button>
          {/* Keeps the reviewed text in the form as a NEW draft: a separate review and Send, never a resend of this one. */}
          <button className="btn" disabled={busy} onClick={() => { setDraft(null); setReported(false); setError(''); }}>Start a new draft from this</button>
        </div>}
        {reported && draft.state === 'Uncertain' && <p className="notice" data-tone="warn">Recorded. Not finding it does not prove it was not sent: Microsoft may still deliver it, so this draft stays locked. Check Sent Items again later. If you still need to send it, start a new draft from it and review it again; it may then arrive twice.</p>}
      </section>}
      {busy && <p role="status" className="small">Waiting for Prima… <button className="btn btn-sm" onClick={cancel}>Stop waiting</button> Stopping does not recall a message that was already sent; use "Find my recent drafts" to see what happened.</p>}
      {error && <p role="alert" className="notice" data-tone="crit">{error}</p>}
    </div>;
  };
}

export function mailAdapter(client: MailClient): Adapter {
  return { ...mailAdapterCore(client), ProviderPanel: makeMailPanel(client) };
}
