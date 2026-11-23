import { useState } from 'react';
import { api } from '../api';
import { useApp, type ViewName } from '../App';
import { useLang } from '../i18n';
import { Chip, ErrorNotice, Loading, useAction, useLoad } from '../ui';
import { ProofPicker } from './Proof';

/**
 * Prima helper (Fauzan, 23 Nov 2026: "Make sure ai agent can help with everything ... What prima app give permission
 * for the person or department can do, agent can help it do"). The person says what they need in their own words; the
 * helper fills the form with fixed rules from Prima's own lists, the team's skills and the person's own style. The
 * person checks it and presses Send, which runs the same action as the job's own screen, as them. Nothing is sent by
 * itself, and nothing is approved, signed or paid here.
 */
type Home = Awaited<ReturnType<typeof api.assistantHome>>;
type Understood = Awaited<ReturnType<typeof api.assistantUnderstand>>;
type Field = Home['actions'][number]['fields'][number];
type Line = { stockItemId: string; qty: number };

export function AssistantView() {
  const { lang } = useLang();
  const en = lang === 'en';
  const { go } = useApp();
  const { data: home, error, reload } = useLoad(() => api.assistantHome(), []);
  const [text, setText] = useState('');
  const [u, setU] = useState<Understood | null>(null);
  const [actionId, setActionId] = useState<string>('');
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [done, setDone] = useState<{ actionId: string; ref: string; view: string; values: Record<string, unknown> } | null>(null);
  const [skillName, setSkillName] = useState('');
  const [skillWords, setSkillWords] = useState('');
  const [skillScope, setSkillScope] = useState('me');
  const act = useAction();
  if (error) return <ErrorNotice error={error} />;
  if (!home) return <Loading what="helper" />;
  const action = home.actions.find((a) => a.id === actionId) ?? null;
  const L = (x: { bm: string; en: string }) => (en ? x.en : x.bm);
  const lists = u?.lists ?? {};
  const origin = (name: string) => u?.draft.origins[name as keyof typeof u.draft.origins];
  const nameOf = (list: { id: string; name: string }[] | undefined, id: unknown) => list?.find((x) => x.id === id)?.name ?? '';

  const fill = async (chosen?: string) => {
    setDone(null);
    const r = await act.run(() => api.assistantUnderstand({ text, actionId: chosen || null, lang }));
    if (!r) return;
    setU(r);
    setActionId(r.draft.actionId ?? '');
    setValues({ ...r.draft.values });
  };
  const send = async () => {
    if (!action) return;
    const labels: Record<string, string> = {};
    for (const x of [...(lists.sites ?? []), ...(lists.receivers ?? []), ...(lists.items ?? []), ...Object.values(lists.pick ?? {}).flat()]) labels[x.id] = x.name;
    const r = await act.run(() => api.assistantAct('send', { actionId: action.id, values, text, draft: u?.draft, labels }), en ? 'Sent' : 'Dihantar');
    if (r) {
      setDone({ actionId: action.id, ref: r.ref ?? '', view: r.view, values });
      setU(null);
      setText('');
      reload();
    }
  };
  const set = (k: string, v: unknown) => setValues((x) => ({ ...x, [k]: v }));
  // A list can depend on a choice (the company's staff, the vehicle's cards): read the lists again, as the person.
  const choose = async (k: string, v: unknown) => {
    const next = { ...values, [k]: v };
    setValues(next);
    if (!action || !u || !action.fields.some((f) => f.type === 'pick')) return;
    const l = await api.assistantLists({ actionId: action.id, values: next }).catch(() => null);
    if (l) setU((x) => (x ? { ...x, lists: { ...x.lists, ...l } } : x));
  };

  const input = (f: Field) => {
    const v = values[f.name];
    const id = `as-${f.name}`;
    const common = { id, 'aria-label': L(f.label) };
    switch (f.type) {
      case 'site':
        return (
          <select {...common} className="select" value={String(v ?? '')} onChange={(e) => set(f.name, e.target.value)}>
            <option value="">{en ? 'Choose' : 'Pilih'}</option>
            {(lists.sites ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        );
      case 'receiver':
        return (
          <select {...common} className="select" value={String(v ?? '')} onChange={(e) => set(f.name, e.target.value)}>
            <option value="">{(lists.receivers ?? []).length ? (en ? 'Choose' : 'Pilih') : en ? 'Not needed (you are the OM) or choose the site first' : 'Tidak perlu (anda OM) atau pilih tapak dahulu'}</option>
            {(lists.receivers ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        );
      case 'choice':
        return (
          <select {...common} className="select" value={String(v ?? '')} onChange={(e) => choose(f.name, e.target.value)}>
            <option value="">{en ? 'Choose' : 'Pilih'}</option>
            {(f.options ?? []).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        );
      case 'pick': {
        const list = (f.list && lists.pick?.[f.list]) || [];
        return (
          <select {...common} className="select" value={String(v ?? '')} onChange={(e) => choose(f.name, e.target.value || undefined)}>
            <option value="">{list.length ? (en ? 'Choose' : 'Pilih') : en ? 'Nothing to choose yet (choose the box above first)' : 'Tiada pilihan lagi (pilih kotak di atas dahulu)'}</option>
            {list.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
        );
      }
      case 'proof':
        return (
          <div id={id} aria-label={L(f.label)}>
            <ProofPicker site={null} refText={action?.label.en ?? 'helper'} items={(Array.isArray(v) ? v : []) as never} onChange={(items) => set(f.name, items)} documentsOnly={f.documentsOnly} required={f.required} />
          </div>
        );
      case 'month':
        return <input {...common} className="input" type="month" value={String(v ?? '')} onChange={(e) => set(f.name, e.target.value)} />;
      case 'bool':
        return <input {...common} type="checkbox" checked={v === true} onChange={(e) => set(f.name, e.target.checked)} />;
      case 'longtext':
        return <textarea {...common} className="input" rows={3} value={String(v ?? '')} onChange={(e) => set(f.name, e.target.value)} />;
      case 'items': {
        const lines = (Array.isArray(v) ? v : []) as Line[];
        const put = (n: Line[]) => set(f.name, n);
        return (
          <div className="stack" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {lines.map((l, i) => (
              <div key={i} className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                <select className="select" aria-label={`${en ? 'Item' : 'Barang'} ${i + 1}`} value={l.stockItemId} onChange={(e) => put(lines.map((x, j) => (j === i ? { ...x, stockItemId: e.target.value } : x)))}>
                  {(lists.items ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
                <input className="input" style={{ width: 80 }} type="number" min={1} aria-label={`${en ? 'Quantity' : 'Kuantiti'} ${i + 1}`} value={l.qty} onChange={(e) => put(lines.map((x, j) => (j === i ? { ...x, qty: Number(e.target.value) } : x)))} />
                <button className="btn ghost" onClick={() => put(lines.filter((_, j) => j !== i))}>{en ? 'Remove' : 'Buang'}</button>
              </div>
            ))}
            {(lists.items ?? []).length > 0 && (
              <button className="btn ghost" onClick={() => put([...lines, { stockItemId: lists.items![0].id, qty: 1 }])}>{en ? 'Add an item' : 'Tambah barang'}</button>
            )}
            {!(lists.items ?? []).length && <span className="muted small">{en ? 'Choose the site first; its store list appears here.' : 'Pilih tapak dahulu; senarai stor dipaparkan di sini.'}</span>}
          </div>
        );
      }
      default:
        return <input {...common} className="input" type={f.type === 'date' ? 'date' : f.type === 'time' ? 'time' : f.type === 'number' ? 'number' : 'text'} value={String(v ?? '')} onChange={(e) => set(f.name, f.type === 'number' ? Number(e.target.value) : e.target.value)} />;
    }
  };

  return (
    <div className="stack" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <section className="panel">
        <div className="panel-head">
          <h3>{en ? 'Prima helper' : 'Pembantu Prima'}</h3>
          <span className="muted small">{en ? `${home.actions.length} jobs it fills for you` : `${home.actions.length} kerja yang boleh diisi untuk anda`}</span>
        </div>
        <div className="panel-body">
          <p className="muted small">
            {en
              ? 'Say what you need in your own words. The helper fills the form from Prima\'s own lists. Check every box, then press Send: it goes exactly as from the job\'s own screen, as you. Nothing is sent by itself, and nothing is approved here.'
              : 'Tulis apa yang anda perlukan dengan perkataan sendiri. Pembantu mengisi borang daripada senarai Prima. Semak setiap kotak, kemudian tekan Hantar: ia dihantar sama seperti dari skrin kerja itu, atas nama anda. Tiada apa dihantar sendiri dan tiada kelulusan di sini.'}
          </p>
          <label className="field" htmlFor="as-text">{en ? 'What do you need?' : 'Apa yang anda perlukan?'}</label>
          <textarea id="as-text" className="input" rows={3} maxLength={1500} value={text} onChange={(e) => setText(e.target.value)} placeholder={en ? 'e.g. OGM asks for 20 trousers size 32 for the new site at ...' : 'cth. OGM minta 20 seluar saiz 32 untuk tapak baharu di ...'} />
          <div className="row" style={{ gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
            <button className="btn primary" disabled={act.busy || text.trim().length < 3} onClick={() => fill()}>{en ? 'Fill the form' : 'Isi borang'}</button>
          </div>
          {act.error && <ErrorNotice error={act.error} />}
          {done && (
            <div className="notice ok" role="status" style={{ marginTop: 8 }}>
              <p>{en ? 'Sent.' : 'Dihantar.'} {done.ref}</p>
              <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                <button className="btn ghost" onClick={() => go({ view: done.view as ViewName })}>{en ? 'Open its screen' : 'Buka skrinnya'}</button>
              </div>
              {home.installed && (
                <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
                  <input className="input" aria-label={en ? 'Skill name' : 'Nama kemahiran'} placeholder={en ? 'Save as a skill: name' : 'Simpan sebagai kemahiran: nama'} value={skillName} onChange={(e) => setSkillName(e.target.value)} />
                  <input className="input" aria-label={en ? 'Words that call it up' : 'Perkataan untuk memanggilnya'} placeholder={en ? 'words, comma between' : 'perkataan, pisah dengan koma'} value={skillWords} onChange={(e) => setSkillWords(e.target.value)} />
                  <select className="select" aria-label={en ? 'For whom' : 'Untuk siapa'} value={skillScope} onChange={(e) => setSkillScope(e.target.value)}>
                    <option value="me">{en ? 'Only me' : 'Saya sahaja'}</option>
                    {home.teams.filter((t) => t.mayPublish).map((t) => <option key={t.owner} value={t.owner}>{en ? 'My team' : 'Pasukan saya'} ({t.owner.split(':')[1]})</option>)}
                  </select>
                  <button
                    className="btn"
                    disabled={act.busy || skillName.trim().length < 3}
                    onClick={async () => {
                      const r = await act.run(() => api.assistantAct('skills', { scope: skillScope === 'me' ? 'me' : 'team', owner: skillScope === 'me' ? undefined : skillScope, name: skillName, words: skillWords ? skillWords.split(',') : [skillName], actionId: done.actionId, values: done.values }), en ? 'Skill saved' : 'Kemahiran disimpan');
                      if (r) { setSkillName(''); setSkillWords(''); reload(); }
                    }}
                  >
                    {en ? 'Save skill' : 'Simpan kemahiran'}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </section>

      {u && (
        <section className="panel" aria-label={en ? 'Filled form' : 'Borang diisi'}>
          <div className="panel-head">
            <h3>{action ? L(action.label) : en ? 'Which job is it?' : 'Kerja yang mana?'}</h3>
            {u.draft.skillId && <Chip tone="info">{en ? 'Skill used' : 'Kemahiran digunakan'}: {home.skills.find((s) => s.id === u.draft.skillId)?.name ?? ''}</Chip>}
          </div>
          <div className="panel-body">
            <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
              <select className="select" aria-label={en ? 'Job' : 'Kerja'} value={actionId} onChange={(e) => fill(e.target.value)}>
                <option value="">{en ? 'Choose the job' : 'Pilih kerja'}</option>
                {home.actions.map((a) => <option key={a.id} value={a.id}>{L(a.label)}</option>)}
              </select>
            </div>
            {action && (
              <div className="stack" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <p className="muted small">{en ? 'Filled by the helper. Check each box before you send.' : 'Diisi oleh pembantu. Semak setiap kotak sebelum menghantar.'}</p>
                {action.fields.map((f) => (
                  <div key={f.name} className="field-row">
                    <label htmlFor={`as-${f.name}`} className="field">
                      {L(f.label)}
                      {f.required ? ' *' : ''}{' '}
                      {origin(f.name) && <span className="muted small">({origin(f.name) === 'said' ? (en ? 'from your words' : 'daripada kata anda') : origin(f.name) === 'skill' ? (en ? 'from the skill' : 'daripada kemahiran') : origin(f.name) === 'usual' ? (en ? 'your usual' : 'kebiasaan anda') : origin(f.name) === 'default' ? (en ? 'the only one, check' : 'satu-satunya, semak') : en ? 'from your text' : 'daripada teks anda'})</span>}
                    </label>
                    {input(f)}
                    {f.type === 'site' && values.siteId ? <span className="muted small">{nameOf(lists.sites, values.siteId)}</span> : null}
                  </div>
                ))}
                {u.draft.missing.length > 0 && <p className="small">{en ? 'Still to fill:' : 'Belum diisi:'} {u.draft.missing.map((m) => L(action.fields.find((f) => f.name === m)?.label ?? { bm: m, en: m })).join(', ')}</p>}
                <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                  <button className="btn primary" disabled={act.busy} onClick={send}>{en ? 'Send' : 'Hantar'}</button>
                  {action.fields.some((f) => f.type === 'site' || f.type === 'pick') && <button className="btn ghost" disabled={act.busy} onClick={() => fill(action.id)}>{en ? 'Read my words again' : 'Baca semula'}</button>}
                  <button className="btn ghost" onClick={() => go({ view: action.view as ViewName })}>{en ? 'Use the full screen instead' : 'Guna skrin penuh'}</button>
                </div>
              </div>
            )}
            {u.guide.length > 0 && (
              <div style={{ marginTop: 12 }}>
                <h4>{en ? 'How to do it in Prima' : 'Cara membuatnya dalam Prima'}</h4>
                <ul>
                  {u.guide.map((g) => (
                    <li key={g.id}>
                      <strong>{g.title}</strong> <span className="muted small">{g.screen}: {g.button}</span>
                      <ol className="small">{g.steps.map((s, i) => <li key={i}>{s}</li>)}</ol>
                      {g.view && <button className="btn ghost" onClick={() => go({ view: g.view as ViewName })}>{en ? 'Open screen' : 'Buka skrin'}</button>}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </section>
      )}

      <section className="panel">
        <div className="panel-head">
          <h3>{en ? 'Skills and my style' : 'Kemahiran dan gaya saya'}</h3>
        </div>
        <div className="panel-body">
          {!home.installed ? (
            <p className="muted small">{en ? 'The skill library is not installed in this database yet. The helper still fills forms; it does not remember yet.' : 'Pustaka kemahiran belum dipasang dalam pangkalan data ini. Pembantu masih mengisi borang tetapi belum mengingat.'}</p>
          ) : (
            <>
              <h4>{en ? 'Skills my helper uses' : 'Kemahiran yang digunakan'}</h4>
              {home.skills.length === 0 && <p className="muted small">{en ? 'None yet. After you send a form, save it as a skill.' : 'Belum ada. Selepas menghantar borang, simpan sebagai kemahiran.'}</p>}
              <ul>
                {home.skills.map((s) => (
                  <li key={s.id}>
                    <strong>{s.name}</strong> <span className="muted small">({s.scope === 'me' ? (en ? 'mine' : 'saya') : s.owner.split(':')[1]}; {s.words.join(', ')})</span>{' '}
                    {(s.scope === 'me' || home.teams.some((t) => t.owner === s.owner && t.mayPublish)) && (
                      <button className="btn ghost" disabled={act.busy} onClick={() => act.run(() => api.assistantAct('retire', { id: s.id, reason: en ? 'No longer used' : 'Tidak digunakan lagi' }), en ? 'Retired' : 'Dihentikan').then(() => reload())}>
                        {en ? 'Retire' : 'Henti guna'}
                      </button>
                    )}
                  </li>
                ))}
              </ul>
              <h4>{en ? 'My style (only you see it)' : 'Gaya saya (hanya anda melihatnya)'}</h4>
              <p className="small">
                {en ? 'Sign-off' : 'Penutup'}: {home.style.signOff ?? '—'} · {en ? 'Words learned' : 'Perkataan dipelajari'}: {home.style.words.length ? home.style.words.map((w) => `"${w.said}" = ${w.label || w.value}`).join(', ') : '—'}
              </p>
              <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                <input
                  className="input"
                  aria-label={en ? 'My sign-off' : 'Penutup saya'}
                  placeholder={en ? 'Sign-off, e.g. Thank you' : 'Penutup, cth. Terima kasih'}
                  defaultValue={home.style.signOff ?? ''}
                  onBlur={(e) => {
                    if (e.target.value !== (home.style.signOff ?? '')) void act.run(() => api.assistantAct('style', { signOff: e.target.value }), en ? 'Saved' : 'Disimpan').then(() => reload());
                  }}
                />
                <button className="btn ghost" disabled={act.busy} onClick={() => act.run(() => api.assistantAct('forget', { all: true }), en ? 'Cleared' : 'Dikosongkan').then(() => reload())}>
                  {en ? 'Clear what it learned about me' : 'Padam apa yang dipelajari tentang saya'}
                </button>
              </div>
            </>
          )}
        </div>
      </section>
    </div>
  );
}
