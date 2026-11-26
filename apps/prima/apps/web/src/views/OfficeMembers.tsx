import { useRef, useState } from 'react';
import { useRouteTab } from '../App';
import { PageHead } from '../kit';
import '../styles/office-members.css';

/**
 * P135 (Fitri, 26 Nov 2026: "where to add members? see all members and roles settings like Agentic? and add
 * organization where? ... all functions like settings, roles and all must be the same, it's just fully managed on
 * Prima"): the Agentic Office's own Organization, Members and roles, Roles and access and Office access screens, shown
 * here with every function they have. The office draws them alone (no office menu) in a frame named "office-embed";
 * the same sign-in and the office's own permission checks apply. People and companies added in Prima's People, Accounts
 * and access and Group still reach the office by themselves (every 30 minutes).
 */
const TABS = [
  { id: 'organization', label: 'Organization', src: '/organization' },
  { id: 'members', label: 'Members and roles', src: '/settings/members' },
  { id: 'roles', label: 'Roles and access', src: '/settings/roles' },
  { id: 'access', label: 'Office access', src: '/settings/office-access' },
] as const;
type Tab = (typeof TABS)[number]['id'];

/**
 * P138e (Fitri: "people don't clear things, just refresh: make it fix itself"): a browser that still has the office's
 * old offline copy (saved with "never in a frame") shows the frame as refused. The page in the frame is this site's, so
 * when it cannot be read it was refused: the office's old service worker is dropped (it installs again, current, on
 * the next office page) and the frame loads once more. Once per visit, so it never loops.
 */
async function dropOfficeWorker(): Promise<boolean> {
  try {
    const regs = await navigator.serviceWorker?.getRegistrations();
    let dropped = false;
    for (const r of regs ?? []) {
      // The office's worker covers the whole site ("/"); Prima's own is under /prima/ and stays.
      if (new URL(r.scope).pathname === '/') dropped = (await r.unregister()) || dropped;
    }
    return dropped;
  } catch {
    return false;
  }
}

export function OfficeMembersView() {
  const [tab, setTab] = useRouteTab<Tab>('members', TABS.map((t) => t.id));
  const current = TABS.find((t) => t.id === tab) ?? TABS[1];
  const frame = useRef<HTMLIFrameElement>(null);
  const healed = useRef(false);
  const [attempt, setAttempt] = useState(0);
  const onLoad = () => {
    let refused = false;
    try {
      // A refused frame shows the browser's own error page, which this site may not read.
      const href = frame.current?.contentWindow?.location.href ?? '';
      refused = !href || href.startsWith('chrome-error:') || href === 'about:blank';
    } catch {
      refused = true;
    }
    if (!refused || healed.current) return;
    healed.current = true;
    void dropOfficeWorker().then(() => setAttempt((n) => n + 1));
  };
  return (
    <div className="page om-page">
      <PageHead
        title="Members and organization"
        sub="Everyone who signs in, their role and company, the companies and departments, what each role may do, and who runs the office."
      >
        <div className="tabbar" role="tablist" aria-label="Members and organization">
          {TABS.map((t) => (
            <button key={t.id} type="button" role="tab" aria-selected={t.id === tab} onClick={() => setTab(t.id)}>
              {t.label}
            </button>
          ))}
        </div>
      </PageHead>
      <iframe
        ref={frame}
        key={`${current.id}-${attempt}`}
        className="om-frame"
        name="office-embed"
        title={current.label}
        src={attempt ? `${current.src}?fresh=${attempt}` : current.src}
        onLoad={onLoad}
      />
    </div>
  );
}
