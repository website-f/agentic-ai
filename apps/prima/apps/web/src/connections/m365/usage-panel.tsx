import { useEffect, useState } from 'react';
import type { M365Link, M365LinkState, PersonUsage, UseCheckId, UsePlan, UseStatus } from '@prima/core';
import { Chip, Kpi } from '../../ui';

/**
 * Microsoft use board (rule M365-USE; Fauzan, 23 Nov 2026). Shows the signed-in person's own Microsoft 365 checklist
 * with a short how-to for anything missing and, for managers, the people inside their walls. The server decides who
 * is shown; this screen only reads the stored day. Coaching, never discipline.
 */
type Line = PersonUsage & { score: number | null; planGives?: { bm: string; en: string } | null };
const PLAN: Record<UsePlan, string> = { premium: 'Premium', basic_p1: 'Basic + P1', basic: 'Basic', other: 'Other' };
export interface Board {
  on: boolean;
  installed: boolean;
  snapshot: { asOf: string; refreshed: string | null; namesHidden: boolean } | null;
  howto: { id: UseCheckId; title: string; bm: string; en: string; steps?: { bm: string; en: string }[]; link?: { url: string; label: string } | null; itHelps?: string }[];
  mine?: Line | null;
  seesAll?: boolean;
  people?: (Line & { id: string; name: string; title: string; companyIds: string[]; department: string | null })[];
  summary?: { companies: Group[]; departments: Group[]; plans?: Record<UsePlan, number> } | null;
  /** Every Prima to Microsoft 365 link (IT and group leaders only). */
  links?: (M365Link & { state: M365LinkState })[];
  linkUse?: { people: number; linked: number; primaSignIn: number; myApps: number; sharePoint: number; teams: number };
}
interface Group { key: string; people: number; score: number | null; setupMissing: number; idle: number; premiumUnused?: number }

const tone = (s: UseStatus | undefined) => (s === 'ok' ? 'ok' : s === 'missing' ? 'warn' : 'unknown');
const word = (s: UseStatus | undefined) => (s === 'ok' ? 'Siap / Done' : s === 'missing' ? 'Belum / Not yet' : 'Tidak diketahui / Unknown');

/** askIt raises an IT help request for one item and answers its reference (the server checks the person). */
type AskIt = (id: UseCheckId, title: string) => Promise<string | null>;

export function UsagePanel({ load, askIt }: { load: (signal: AbortSignal) => Promise<unknown>; askIt?: AskIt }) {
  const [board, setBoard] = useState<Board | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const ac = new AbortController();
    load(ac.signal).then((b) => setBoard(b as Board)).catch(() => !ac.signal.aborted && setError('Microsoft use is not available here yet.'));
    return () => ac.abort();
  }, [load]);
  if (error) return <section className="panel" style={{ padding: 16 }}><h2>Microsoft use</h2><p className="notice" data-tone="info">{error}</p></section>;
  if (!board) return <section className="panel" style={{ padding: 16 }}><h2>Microsoft use</h2><p role="status">Reading…</p></section>;
  return <UsageView board={board} askIt={askIt} />;
}

/** The board as the server sent it (exported for render tests). */
export function UsageView({ board, askIt }: { board: Board; askIt?: AskIt }) {
  const title = (id: UseCheckId) => board.howto.find((h) => h.id === id)?.title ?? id;
  return (
    <section className="panel" style={{ padding: 16, minWidth: 0 }} aria-labelledby="m365-usage-title">
      <div className="row" style={{ gap: 8, flexWrap: 'wrap', justifyContent: 'space-between' }}>
        <h2 id="m365-usage-title">Penggunaan Microsoft / Microsoft use</h2>
        {board.snapshot && <Chip tone="neutral">Data {board.snapshot.refreshed ?? board.snapshot.asOf}</Chip>}
      </div>
      <p className="small muted">
        Untuk bimbingan, bukan tindakan disiplin. Prima hanya membaca kiraan dan tarikh dari Microsoft, bukan kandungan e-mel, chat atau fail. Coaching only,
        never discipline: Prima reads counts and dates from Microsoft, never the content of e-mail, chats or files.
      </p>
      {!board.installed && <p className="notice" data-tone="info">Not installed yet: IT installs this after the CEO's go-ahead.</p>}
      {board.installed && !board.snapshot && <p className="notice" data-tone="info">{board.on ? 'The first daily reading has not run yet.' : 'The daily reading is switched off.'}</p>}
      {board.snapshot?.namesHidden && <p className="notice" data-tone="warn">Microsoft still hides names in its reports, so nobody could be matched. IT turns names on in the Microsoft 365 admin centre.</p>}
      {board.snapshot && <Mine line={board.mine ?? null} board={board} askIt={askIt} />}
      {!!board.links?.length && <Links links={board.links} use={board.linkUse} />}
      {!!board.summary && <Summary s={board.summary} />}
      {!!board.people?.length && (
        <div style={{ overflowX: 'auto', marginTop: 12 }}>
          <h3>{board.seesAll ? 'Semua staf / All staff' : 'Staf saya / My staff'}</h3>
          <table className="table">
            <thead><tr><th>Name</th><th>Score</th><th>Not yet</th><th>Licence</th></tr></thead>
            <tbody>
              {board.people.map((p) => (
                <tr key={p.id}>
                  <td>{p.name}<div className="small muted">{p.title}</div></td>
                  <td>{!p.linked ? <Chip tone="warn">Not linked</Chip> : p.score == null ? <Chip tone="unknown">Unknown</Chip> : `${p.score}%`}</td>
                  <td className="small">{(Object.entries(p.checks) as [UseCheckId, UseStatus][]).filter(([, s]) => s === 'missing').map(([id]) => title(id)).join(', ') || '—'}</td>
                  <td>
                    {p.plan ? PLAN[p.plan] : p.managed ? 'Premium' : p.managed === false ? 'Basic' : '—'}
                    {p.idle && <> <Chip tone="warn">Unused 30 days</Chip></>}
                    {!p.idle && p.premiumUnused && <> <Chip tone="warn">Premium not used</Chip></>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function Mine({ line, board, askIt }: { line: Line | null; board: Board; askIt?: AskIt }) {
  if (!line) return <p className="small muted">You are not on this reading (it covers office staff with an open Prima sign-in).</p>;
  if (!line.linked) return <p className="notice" data-tone="warn">Your Prima sign-in is not linked to your Microsoft account yet. Ask IT.</p>;
  return (
    <>
      <h3>Senarai saya / My checklist {line.score != null && <Chip tone={line.score >= 80 ? 'ok' : 'warn'}>{line.score}%</Chip>}</h3>
      {line.planGives && <p className="small">{line.planGives.bm}<span className="muted"> {line.planGives.en}</span></p>}
      {line.premiumUnused && <p className="notice" data-tone="warn">Anda ada Business Premium tetapi belum guna laptop diurus IT atau Office desktop. IT akan aturkan 30 minit. You have Business Premium but are not using an IT-managed laptop or desktop Office yet. IT will book 30 minutes.</p>}
      <ul className="list" style={{ listStyle: 'none', padding: 0 }}>
        {board.howto.filter((h) => h.id in line.checks).map((h) => {
          const s = line.checks[h.id];
          return (
            <li key={h.id} style={{ padding: '6px 0', borderBottom: '1px solid var(--line, #e5e5e5)' }}>
              <div className="row" style={{ gap: 8, justifyContent: 'space-between', flexWrap: 'wrap' }}><strong>{h.title}</strong><Chip tone={tone(s)}>{word(s)}</Chip></div>
              {s === 'missing' && <div className="small">{h.bm}<div className="muted">{h.en}</div></div>}
              {(s === 'missing' || s === 'unknown') && <HowTo h={h} askIt={askIt} open={s === 'missing'} />}
            </li>
          );
        })}
      </ul>
    </>
  );
}

/** Numbered steps, the official Microsoft page, and a button that asks IT to do it with the person. */
function HowTo({ h, askIt, open }: { h: Board['howto'][number]; askIt?: AskIt; open: boolean }) {
  const [sent, setSent] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  if (!h.steps?.length && !h.link && !askIt) return null;
  const ask = () => {
    if (!askIt || busy) return;
    setBusy(true);
    setFailed(false);
    askIt(h.id, h.title)
      .then((ref) => setSent(ref ?? 'sent'))
      .catch(() => setFailed(true))
      .finally(() => setBusy(false));
  };
  return (
    <details open={open} style={{ marginTop: 4 }}>
      <summary className="small">Cara buat / How to do it</summary>
      {!!h.steps?.length && (
        <ol className="small" style={{ margin: '4px 0', paddingLeft: 20 }}>
          {h.steps.map((s, i) => <li key={i}>{s.bm}<div className="muted">{s.en}</div></li>)}
        </ol>
      )}
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        {h.link && <a className="btn" href={h.link.url} target="_blank" rel="noopener noreferrer">Buka / Open {h.link.label}</a>}
        {askIt && !sent && <button className="btn" type="button" disabled={busy} onClick={ask}>Minta IT bantu / Ask IT to help</button>}
      </div>
      {h.itHelps && !sent && <p className="small muted">{h.itHelps}</p>}
      {sent && <p className="notice" data-tone="ok">Dihantar kepada IT{sent !== 'sent' ? ` (${sent})` : ''}. IT akan hubungi anda. Sent to IT; they will contact you.</p>}
      {failed && <p className="notice" data-tone="warn">Tidak dapat hantar. Cuba lagi atau buka skrin IT. Could not send; try again or use the IT screen.</p>}
      <p className="small muted">IT tidak akan minta kata laluan atau kod anda. IT never asks for your password or codes.</p>
    </details>
  );
}

const STATE: Record<M365LinkState, { word: string; tone: 'ok' | 'warn' | 'unknown' }> = {
  on: { word: 'Hidup / On', tone: 'ok' },
  partly: { word: 'Sebahagian / Partly', tone: 'warn' },
  off: { word: 'Belum / Off', tone: 'unknown' },
};

/** Every link between Prima and Microsoft 365: what it gives staff, whether it is on, and what it still needs. */
function Links({ links, use }: { links: (M365Link & { state: M365LinkState })[]; use?: Board['linkUse'] }) {
  const on = links.filter((l) => l.state === 'on').length;
  const pct = (n: number) => (use && use.people ? `${Math.round((n / use.people) * 100)}%` : '—');
  return (
    <div style={{ marginTop: 12, overflowX: 'auto' }}>
      <h3>
        Sambungan Prima dan Microsoft / Prima and Microsoft links <Chip tone={on === links.length ? 'ok' : 'warn'}>{on} of {links.length} on</Chip>
      </h3>
      {use && (
        <p className="small">
          Of {use.people} staff shown: {use.linked} linked to Microsoft ({pct(use.linked)}), {use.primaSignIn} signed in to Prima with Microsoft ({pct(use.primaSignIn)}), {use.myApps} used
          My Apps ({pct(use.myApps)}), {use.sharePoint} used SharePoint ({pct(use.sharePoint)}), {use.teams} used Teams ({pct(use.teams)}) in the last 30 days.
        </p>
      )}
      <table className="table">
        <thead><tr><th>Link</th><th>State</th><th>What staff get</th><th>Still needed</th></tr></thead>
        <tbody>
          {links.map((l) => (
            <tr key={l.id}>
              <td>{l.title}{l.doc && <div className="small muted">{l.doc}</div>}</td>
              <td><Chip tone={STATE[l.state].tone}>{STATE[l.state].word}</Chip></td>
              <td className="small">{l.bm}<div className="muted">{l.en}</div></td>
              <td className="small">{l.state === 'on' ? '—' : l.needs}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="small muted">On means the settings are in place on the server. Each link is switched on only after the CEO's go-ahead.</p>
    </div>
  );
}

function Summary({ s }: { s: { companies: Group[]; departments: Group[]; plans?: Record<UsePlan, number> } }) {
  const all = [...s.companies, ...s.departments];
  const people = all.reduce((a, g) => a + g.people, 0);
  return (
    <>
      <div className="kpis" style={{ marginTop: 12 }}>
        <Kpi label="People shown" value={people} />
        <Kpi label="Set-up not done" value={all.reduce((a, g) => a + g.setupMissing, 0)} tone="warn" />
        <Kpi label="Licences unused 30 days" value={all.reduce((a, g) => a + g.idle, 0)} tone="warn" />
        <Kpi label="Premium not used" value={all.reduce((a, g) => a + (g.premiumUnused ?? 0), 0)} tone="warn" />
      </div>
      {s.plans && (
        <p className="small muted">
          Plans: {(Object.keys(PLAN) as UsePlan[]).filter((k) => s.plans![k] > 0).map((k) => `${PLAN[k]} ${s.plans![k]}`).join(', ') || 'unknown'}
        </p>
      )}
      <div style={{ overflowX: 'auto' }}>
        <table className="table">
          <thead><tr><th>Company or department</th><th>People</th><th>Score</th><th>Set-up not done</th><th>Unused</th><th>Premium not used</th></tr></thead>
          <tbody>
            {all.map((g) => (
              <tr key={g.key}><td>{g.key}</td><td>{g.people}</td><td>{g.score == null ? 'Unknown' : `${g.score}%`}</td><td>{g.setupMissing}</td><td>{g.idle}</td><td>{g.premiumUnused ?? 0}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
