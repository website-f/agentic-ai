import { useEffect, useState } from 'react';
import { Card, Facts, Person } from '../kit';
import { useLang, type Lang } from '../i18n';
import { Chip } from '../ui';
import '../styles/office-member.css';

declare const __DEMO__: boolean;

/**
 * P112 (Fitri, 17 Nov 2026: "...and then can't see link to the members, and if not match then add them into the members
 * in agentic ai with correct designation, email and so on. please wire this up nicely"): on a person's details, whether
 * they are a member of the Agentic Office, with a link to them on its Members page, or "Add to Agentic Office" with a
 * form filled in from Prima (name, work email, job title, the office company of their Prima company, department, role).
 *
 * Only inside the office (VITE_OFFICE), and only for whoever may add members there: the office answers everyone else
 * 403 and the card stays hidden. The office reads the person from Prima again, as the person asking, before it shows or
 * saves anything (apps/api/agentic/api/routers/prima_members.py), so nothing typed here decides who the person is.
 * Its own Bahasa Melayu / English (the page translator leaves it alone: data-no-translate).
 */
export type OfficeMemberPerson = {
  id: string;
  name: string;
  email?: string | null;
  jobTitle?: string | null;
  companyId: string;
  staffNo?: string | null;
};

type Member = {
  user_id: string;
  name: string;
  email: string;
  role: string;
  role_label: string;
  branch_id: string | null;
  branch_name: string | null;
  department_name: string | null;
  job_title: string | null;
  active: boolean;
};

type Draft = {
  name: string;
  email: string | null;
  emails: string[];
  job_title: string | null;
  role: string | null;
  roles: { id: string; label: string }[];
  branch_id: string | null;
  branches: { id: string; name: string }[];
  company_mapped: boolean;
  department_id: string | null;
  departments: { id: string; name: string; branch_id: string }[];
};

type Answer = {
  status: 'member' | 'none' | 'elsewhere';
  person: { id: string };
  how: 'linked' | 'email' | 'name' | null;
  member: Member | null;
  same_name?: number;
  draft: Draft | null;
};

type Added = { member: { user_id: string; name: string; email: string }; temp_password: string | null };

/** Inside the Agentic Office (not the test version, not Prima on its own). */
export const IN_OFFICE = !__DEMO__ && import.meta.env.VITE_OFFICE === 'true';

/** Roles that sit in a company (and maybe a department) in the office; the others see the whole office. */
const PLACED = new Set(['branch_manager', 'hod', 'supervisor', 'staff']);
const NEEDS_DEPT = new Set(['hod', 'supervisor']);

export class OfficeCallError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message);
  }
}

/** One call to the office's own API (same site): its session cookie, and its CSRF token sent back as a header. */
export async function officeCall<T>(method: 'GET' | 'POST', path: string, lang: Lang, body?: unknown): Promise<T> {
  const csrf = /(?:^|;\s*)agentic_csrf=([^;]+)/.exec(document.cookie)?.[1];
  const res = await fetch(path, {
    method,
    credentials: 'same-origin',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      'x-lang': lang === 'en' ? 'en' : 'ms',
      ...(csrf ? { 'x-csrf-token': decodeURIComponent(csrf) } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as { message?: unknown; code?: unknown };
  if (!res.ok) throw new OfficeCallError(typeof data.message === 'string' && data.message ? data.message : `(${res.status})`, res.status, String(data.code ?? ''));
  return data as T;
}

/** The office's Members page, on this member. */
export function membersLink(m: Pick<Member, 'user_id' | 'email'>): string {
  return `/settings/members?q=${encodeURIComponent(m.email)}&focus=${encodeURIComponent(m.user_id)}`;
}

function useL() {
  const { lang } = useLang();
  return { lang, L: (bm: string, en: string) => (lang === 'en' ? en : bm) };
}

type State = { kind: 'loading' } | { kind: 'hidden' } | { kind: 'error'; message: string } | { kind: 'ready'; answer: Answer };

export function OfficeMemberCard({ person }: { person: OfficeMemberPerson }) {
  const { lang, L } = useL();
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [version, setVersion] = useState(0);
  const [adding, setAdding] = useState<null | { notTheSame: boolean }>(null);
  const [added, setAdded] = useState<Added | null>(null);

  useEffect(() => {
    if (!IN_OFFICE || !person.id) return;
    let live = true;
    // A new look at the same person keeps what is shown until the answer comes; another person starts afresh.
    setState((s) => (s.kind === 'ready' && s.answer.person?.id === person.id ? s : { kind: 'loading' }));
    officeCall<Answer>('GET', `/api/prima-members/${encodeURIComponent(person.id)}`, lang)
      .then((answer) => live && setState({ kind: 'ready', answer }))
      .catch((e: unknown) => {
        if (!live) return;
        // Not someone who adds members, Prima-only access, or Prima does not show them this person: no card.
        if (e instanceof OfficeCallError && [401, 403, 404].includes(e.status)) setState({ kind: 'hidden' });
        else setState({ kind: 'error', message: e instanceof Error ? e.message : String(e) });
      });
    return () => {
      live = false;
    };
  }, [person.id, version, lang]);

  useEffect(() => {
    setAdding(null);
    setAdded(null);
  }, [person.id]);

  if (!IN_OFFICE || state.kind === 'hidden' || state.kind === 'loading') return null;

  const title = L('Agentic Office', 'Agentic Office');
  if (state.kind === 'error') {
    return (
      <div className="om-card" data-no-translate>
        <Card title={title}>
          <p className="muted small om-note">
            {L('Tidak dapat menyemak keahlian Agentic Office sekarang.', 'Could not check Agentic Office membership right now.')} {state.message}
          </p>
          <div className="om-actions">
            <button type="button" className="btn btn-sm" onClick={() => setVersion((v) => v + 1)}>
              {L('Cuba lagi', 'Try again')}
            </button>
          </div>
        </Card>
      </div>
    );
  }

  const a = state.answer;
  const draft = a.draft;
  const canAdd = !!draft && draft.roles.length > 0;
  const done = (r: Added) => {
    setAdded(r);
    setAdding(null);
    setVersion((v) => v + 1);
  };

  return (
    <div className="om-card" data-no-translate>
      <Card
        title={a.status === 'none' ? L('Belum dalam Agentic Office', 'Not in Agentic Office yet') : L('Ahli Agentic Office', 'Agentic Office member')}
        sub={
          a.status === 'none'
            ? L('Orang ini belum menjadi ahli pejabat. Tambah mereka supaya mereka boleh log masuk.', 'This person is not a member of the office yet. Add them so they can sign in.')
            : undefined
        }
        actions={
          a.status === 'member' ? (
            <Chip tone={a.how === 'name' ? 'warn' : 'ok'}>{a.how === 'name' ? L('Nama sama', 'Same name') : L('Ahli', 'Member')}</Chip>
          ) : a.status === 'none' ? (
            <Chip tone="neutral">{L('Bukan ahli', 'Not a member')}</Chip>
          ) : undefined
        }
      >
        {added && <AddedNotice added={added} L={L} onClose={() => setAdded(null)} />}

        {a.status === 'elsewhere' && (
          <p className="muted small om-note">
            {L(
              'Orang ini ahli Agentic Office di syarikat yang tidak anda uruskan.',
              'This person is an Agentic Office member in a company you do not manage.',
            )}
          </p>
        )}

        {a.status === 'member' && a.member && <MemberView member={a.member} how={a.how} L={L} />}

        {a.status === 'member' && a.how === 'name' && canAdd && !adding && (
          <div className="om-actions">
            <span className="muted small">{L('Bukan orang yang sama?', 'Not the same person?')}</span>
            <button type="button" className="btn btn-sm" onClick={() => setAdding({ notTheSame: true })}>
              {L('Tambah sebagai ahli baharu', 'Add as a new member')}
            </button>
          </div>
        )}

        {a.status === 'none' && !adding && (
          <>
            {!!a.same_name && (
              <div className="notice" data-tone="warn">
                {L(
                  `${a.same_name} ahli mempunyai nama ini. Semak di Ahli sebelum menambah.`,
                  `${a.same_name} members have this name. Check Members before adding.`,
                )}{' '}
                <a href={`/settings/members?q=${encodeURIComponent(person.name)}`}>{L('Semak di Ahli', 'Check in Members')}</a>
              </div>
            )}
            {canAdd ? (
              <div className="om-actions">
                <button type="button" className="btn btn-primary" onClick={() => setAdding({ notTheSame: false })}>
                  {L('Tambah ke Agentic Office', 'Add to Agentic Office')}
                </button>
              </div>
            ) : (
              <p className="muted small om-note">{L('Anda tidak boleh menambah ahli.', 'You cannot add members.')}</p>
            )}
          </>
        )}

        {adding && draft && (
          <AddForm
            personId={person.id}
            draft={draft}
            askNotSame={adding.notTheSame || !!a.same_name}
            lang={lang}
            L={L}
            onCancel={() => setAdding(null)}
            onDone={done}
          />
        )}
      </Card>
    </div>
  );
}

type LFn = (bm: string, en: string) => string;

function MemberView({ member, how, L }: { member: Member; how: Answer['how']; L: LFn }) {
  const howText =
    how === 'linked'
      ? L('Dipautkan ke rekod Prima ini', 'Linked to this Prima record')
      : how === 'email'
        ? L('E-mel kerja yang sama', 'The same work email')
        : L('Nama yang sama sahaja: pastikan ia orang yang sama', 'The same name only: check it is the same person');
  return (
    <>
      <div className="om-head">
        <Person name={member.name} sub={member.email} />
        <a className="btn btn-sm" href={membersLink(member)}>
          {L('Buka di Ahli', 'Open in Members')}
        </a>
      </div>
      {!member.active && (
        <div className="notice" data-tone="warn">
          {L('Akaun ini dimatikan di Agentic Office.', 'This account is switched off in Agentic Office.')}
        </div>
      )}
      <Facts
        items={[
          [L('Peranan', 'Role'), member.role_label],
          [L('Syarikat', 'Company'), member.branch_name || '-'],
          [L('Jabatan', 'Department'), member.department_name || '-'],
          [L('Jawatan', 'Job title'), member.job_title || '-'],
          [L('Dipadankan melalui', 'Matched by'), howText],
        ]}
      />
    </>
  );
}

function AddedNotice({ added, L, onClose }: { added: Added; L: LFn; onClose: () => void }) {
  return (
    <div className="om-confirm" role="status">
      <p>
        <strong>{L(`${added.member.name} telah ditambah ke Agentic Office.`, `${added.member.name} was added to Agentic Office.`)}</strong>
      </p>
      {added.temp_password ? (
        <>
          <p className="muted small">
            {L(
              `Kata laluan sementara untuk ${added.member.email}. Ia ditunjukkan sekali sahaja: berikan kepada mereka secara peribadi; mereka menukarnya semasa log masuk pertama.`,
              `Temporary password for ${added.member.email}. It is shown once only: give it to them privately; they change it at their first sign-in.`,
            )}
          </p>
          <div className="om-secret">{added.temp_password}</div>
        </>
      ) : (
        <p className="muted small">{L('Mereka log masuk dengan kata laluan sedia ada.', 'They sign in with their existing password.')}</p>
      )}
      <div className="om-actions">
        <button type="button" className="btn btn-sm" onClick={onClose}>
          {L('Selesai', 'Done')}
        </button>
      </div>
    </div>
  );
}

function AddForm({
  personId,
  draft,
  askNotSame,
  lang,
  L,
  onCancel,
  onDone,
}: {
  personId: string;
  draft: Draft;
  askNotSame: boolean;
  lang: Lang;
  L: LFn;
  onCancel: () => void;
  onDone: (r: Added) => void;
}) {
  const [email, setEmail] = useState(draft.email ?? '');
  const [jobTitle, setJobTitle] = useState(draft.job_title ?? '');
  const [role, setRole] = useState(draft.role ?? draft.roles[0]?.id ?? '');
  const [branchId, setBranchId] = useState(draft.branch_id ?? (draft.branches.length === 1 ? draft.branches[0].id : ''));
  const [deptId, setDeptId] = useState(draft.department_id ?? '');
  const [notSame, setNotSame] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const placed = PLACED.has(role);
  const depts = draft.departments.filter((d) => d.branch_id === branchId);
  const roleLabel = draft.roles.find((r) => r.id === role)?.label ?? role;
  const branchName = draft.branches.find((b) => b.id === branchId)?.name ?? '';
  const emailOk = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim());
  const missing = !emailOk
    ? L('Isi e-mel kerja mereka.', 'Give their work email.')
    : !role
      ? L('Pilih peranan.', 'Pick a role.')
      : placed && !branchId
        ? L('Pilih syarikat.', 'Pick a company.')
        : placed && NEEDS_DEPT.has(role) && !deptId
          ? L('Ketua jabatan atau penyelia memerlukan jabatan.', 'A head of department or supervisor needs a department.')
          : askNotSame && !notSame
            ? L('Tandakan "bukan orang yang sama" dahulu.', 'Tick "not the same person" first.')
            : null;

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await officeCall<Added>('POST', `/api/prima-members/${encodeURIComponent(personId)}`, lang, {
        email: email.trim().toLowerCase(),
        role,
        branch_id: placed ? branchId || null : null,
        department_id: placed ? deptId || null : null,
        job_title: jobTitle.trim(),
        not_the_same: askNotSame && notSame,
      });
      onDone(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setConfirming(false);
    } finally {
      setBusy(false);
    }
  };

  if (confirming) {
    return (
      <div className="om-confirm">
        <p>
          {L(
            `Tambah ${draft.name} (${email.trim().toLowerCase()}) ke Agentic Office sebagai ${roleLabel}${placed && branchName ? ` di ${branchName}` : ''}?`,
            `Add ${draft.name} (${email.trim().toLowerCase()}) to Agentic Office as ${roleLabel}${placed && branchName ? ` in ${branchName}` : ''}?`,
          )}
        </p>
        <p className="muted small">
          {L(
            'Mereka mendapat kata laluan sementara dan dipautkan ke Prima secara automatik.',
            'They get a temporary password and are linked to Prima automatically.',
          )}
        </p>
        <div className="om-actions">
          <button type="button" className="btn" disabled={busy} onClick={() => setConfirming(false)}>
            {L('Kembali', 'Back')}
          </button>
          <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void submit()}>
            {busy ? L('Menambah...', 'Adding...') : L('Ya, tambah', 'Yes, add')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <form
      className="om-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (!missing) setConfirming(true);
      }}
    >
      <div className="field">
        <span className="label">{L('Nama (dari Prima)', 'Name (from Prima)')}</span>
        <div className="om-readonly">{draft.name}</div>
      </div>

      <label className="field">
        <span className="label">{L('E-mel kerja', 'Work email')}</span>
        {draft.emails.length > 1 ? (
          <select className="select" value={email} onChange={(e) => setEmail(e.target.value)}>
            {draft.emails.map((x) => (
              <option key={x} value={x}>
                {x}
              </option>
            ))}
          </select>
        ) : draft.emails.length === 1 ? (
          <div className="om-readonly">{draft.emails[0]}</div>
        ) : (
          <>
            <input className="input" type="email" autoComplete="off" value={email} placeholder="nama@syarikat.com.my" onChange={(e) => setEmail(e.target.value)} />
            <span className="muted small">{L('Prima tiada e-mel untuk orang ini.', 'Prima has no email for this person.')}</span>
          </>
        )}
      </label>

      <label className="field">
        <span className="label">{L('Jawatan', 'Job title')}</span>
        <input className="input" maxLength={120} value={jobTitle} onChange={(e) => setJobTitle(e.target.value)} />
      </label>

      <label className="field">
        <span className="label">{L('Peranan di Agentic Office', 'Role in Agentic Office')}</span>
        <select className="select" value={role} onChange={(e) => setRole(e.target.value)}>
          {draft.roles.map((r) => (
            <option key={r.id} value={r.id}>
              {r.label}
            </option>
          ))}
        </select>
      </label>

      {placed && (
        <label className="field">
          <span className="label">{L('Syarikat', 'Company')}</span>
          {draft.branches.length ? (
            <select
              className="select"
              value={branchId}
              onChange={(e) => {
                setBranchId(e.target.value);
                setDeptId('');
              }}
            >
              {draft.branches.length > 1 && <option value="">{L('Pilih syarikat', 'Pick a company')}</option>}
              {draft.branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          ) : (
            <div className="om-readonly muted">{L('Tiada syarikat yang anda boleh letakkan mereka.', 'No company you may place them in.')}</div>
          )}
          {!draft.company_mapped && draft.branches.length > 0 && (
            <span className="muted small">
              {L(
                'Syarikat Prima orang ini belum dipadankan dengan syarikat di pejabat: pilih yang betul.',
                "This person's Prima company is not matched to an office company yet: pick the right one.",
              )}
            </span>
          )}
        </label>
      )}

      {placed && (
        <label className="field">
          <span className="label">{NEEDS_DEPT.has(role) ? L('Jabatan', 'Department') : L('Jabatan (pilihan)', 'Department (optional)')}</span>
          <select className="select" value={deptId} disabled={!branchId} onChange={(e) => setDeptId(e.target.value)}>
            <option value="">{L('Tiada', 'None')}</option>
            {depts.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </label>
      )}

      {askNotSame && (
        <label className="om-check om-wide">
          <input type="checkbox" checked={notSame} onChange={(e) => setNotSame(e.target.checked)} />
          <span>
            {L(
              'Bukan orang yang sama: ahli yang bernama sama ialah orang lain.',
              'Not the same person: the member with the same name is someone else.',
            )}
          </span>
        </label>
      )}

      {error && (
        <div className="notice om-wide" data-tone="crit" role="alert">
          {error}
        </div>
      )}

      <div className="om-actions om-wide">
        {missing && <span className="muted small om-hint">{missing}</span>}
        <button type="button" className="btn" onClick={onCancel}>
          {L('Batal', 'Cancel')}
        </button>
        <button type="submit" className="btn btn-primary" disabled={!!missing}>
          {L('Teruskan', 'Continue')}
        </button>
      </div>
    </form>
  );
}
