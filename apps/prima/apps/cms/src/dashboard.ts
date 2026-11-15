// The operator dashboard (plan section 6), first version: alarm queue, who has been told, device health and refused
// feeds. Plain HTML and one script file, so the page runs under a strict content security policy with no inline script.

export const PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>CMS Command Centre</title>
<link rel="stylesheet" href="/app.css">
</head>
<body>
<header><h1>CMS Command Centre</h1><span id="clock"></span>
<form id="signin"><label>Operator key <input id="token" type="password" autocomplete="off" required></label><button>Sign in</button></form>
<button id="signout" hidden>Sign out</button></header>
<p class="rule">CMS watches and tells. The company decides and acts. Gate and panel commands are off.</p>
<main hidden id="app">
<section id="assistant" lang="ms"><h2>Pembantu Pemantauan: perkara utama sekarang <span id="fcount"></span></h2>
<p class="rule">Cadangan sahaja, disusun mengikut keutamaan dengan sebabnya. Operator dan syarikat memutuskan. Pembantu ini tidak mengakui, menutup, menaikkan atau menyembunyikan penggera, dan tidak boleh mengawal sebarang peranti. Ambang masih cadangan.</p>
<p><button id="briefBtn" type="button">Ringkasan syif (draf)</button></p>
<div id="brief" hidden><p class="unk">Draf ringkasan daripada senarai di bawah, dibuat di pelayan dalaman CMS. Senarai di bawah ialah rekod; jika berbeza, ikut senarai.</p><p id="briefText" class="brieftext"></p></div>
<ol id="findings"></ol>
<h3>Sistem bersambung</h3><table><thead><tr><th>Sistem</th><th>Keadaan</th><th>Peranti (dalam talian / luar / belum didengar)</th><th>Peristiwa 24 jam</th><th>Ditolak 24 jam</th><th>Nota</th></tr></thead><tbody id="systems"></tbody></table></section>
<section id="handover" lang="ms"><h2>Serah tugas syif (Head Control)</h2>
<p class="rule">Jadual tugas dari Prima. Head Control yang keluar menulis serah tugas dalam jam terakhir syif; Head Control yang masuk mengambilnya. Rekod dihantar ke Prima (tanpa klip video).</p>
<p id="hoState"></p>
<ul id="hoItems"></ul>
<div id="hoForm" hidden><label>Nota<br><textarea id="hoNote" rows="3" cols="50"></textarea></label><br>
<button id="hoGive" type="button" hidden>Tulis serah tugas</button>
<button id="hoAgree" type="button" hidden>Setuju dan ambil alih</button>
<button id="hoDisagree" type="button" hidden>Ambil alih, tidak setuju</button></div></section>
<section><h2>Alarm queue <span id="count"></span></h2><table><thead><tr><th>Severity</th><th>What</th><th>Opened</th><th>State</th><th>Actions</th></tr></thead><tbody id="queue"></tbody></table></section>
<section><h2>Response, last 24 hours <span class="unk">(targets proposed, owner to confirm)</span></h2><table><thead><tr><th>Measure</th><th>All</th><th>Critical</th><th>High</th><th>Normal</th></tr></thead><tbody id="kpis"></tbody></table><p id="kpiDevices"></p><table><thead><tr><th>Company</th><th>Alarms</th><th>Acknowledge median</th><th>Over target</th><th>Waiting over target</th><th>False rate</th><th>Devices unknown</th></tr></thead><tbody id="kpiCompanies"></tbody></table></section>
<section><h2>Who CMS told</h2><ul id="told"></ul></section>
<section><h2>Device health</h2><table><thead><tr><th>Device</th><th>Site</th><th>Kind</th><th>State</th><th>Last seen</th></tr></thead><tbody id="health"></tbody></table></section>
<section><h2>Gaps: nobody to tell</h2><ul id="gaps"></ul></section>
<section><h2>Refused feed messages</h2><ul id="refused"></ul></section>
<section><h2>Prima did not accept (kept, retried)</h2><ul id="parked"></ul></section>
</main>
<dialog id="closeDialog"><form id="closeForm" method="dialog">
<h2>Close alarm</h2><p id="closeWhat"></p>
<fieldset><legend>What was it?</legend>
<label><input type="radio" name="outcome" value="real" required> Real alarm (the company opens a case)</label><br>
<label><input type="radio" name="outcome" value="false"> False alarm</label></fieldset>
<label>Note (required)<br><textarea id="closeNote" rows="3" cols="40" required></textarea></label>
<p><button id="closeOk" value="ok">Close alarm</button> <button id="closeCancel" type="button">Cancel, keep it open</button></p>
</form></dialog>
<script src="/app.js"></script>
</body>
</html>`;

export const CSS = `:root{--bg:#f7f7f5;--fg:#1d1d1b;--muted:#666;--line:#ddd;--crit:#b3261e;--high:#c25e00;--ok:#1e7a3c}
@media (prefers-color-scheme:dark){:root{--bg:#161615;--fg:#eee;--muted:#aaa;--line:#333;--crit:#ff6b60;--high:#ffa64d;--ok:#5fd38a}}
body{margin:0;font:14px/1.4 system-ui,sans-serif;background:var(--bg);color:var(--fg)}
header{display:flex;gap:16px;align-items:center;flex-wrap:wrap;padding:12px 16px;border-bottom:1px solid var(--line)}
h1{font-size:18px;margin:0}h2{font-size:15px;margin:16px 0 8px}
main,.rule{padding:0 16px}.rule{color:var(--muted)}
table{width:100%;border-collapse:collapse}td,th{text-align:left;padding:6px;border-bottom:1px solid var(--line);vertical-align:top}
.critical{color:var(--crit);font-weight:600}.high{color:var(--high);font-weight:600}.on{color:var(--ok)}.off{color:var(--crit)}.unk{color:var(--muted)}
button{margin:2px}section{overflow-x:auto}
#findings{padding-left:20px}#findings li{margin:0 0 12px;padding:8px;border:1px solid var(--line);border-radius:6px}
#findings .why,#findings .next{margin:4px 0 0 0;padding-left:18px}#findings .next li,#findings .why li{border:0;margin:0;padding:0}
.done{opacity:.7}.brieftext{white-space:pre-wrap;border-left:3px solid var(--line);padding-left:10px}h3{font-size:14px;margin:12px 0 6px}
@media (max-width:600px){button{min-height:44px}}`;

export const SCRIPT = `(() => {
  const $ = (id) => document.getElementById(id);
  let token = '';
  try { token = sessionStorage.getItem('cmsToken') || ''; } catch {}
  const el = (tag, text, cls) => { const e = document.createElement(tag); if (text !== undefined) e.textContent = text; if (cls) e.className = cls; return e; };
  const t = (iso) => iso ? new Date(iso).toLocaleString() : '';
  async function api(path, body) {
    const res = await fetch(path, { method: body ? 'POST' : 'GET', headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    if (res.status === 401) { signOut(); throw new Error('Signed out'); }
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed');
    return data;
  }
  function signOut() { token = ''; try { sessionStorage.removeItem('cmsToken'); } catch {} $('app').hidden = true; $('signout').hidden = true; $('signin').hidden = false; }
  function closeChoice(id) {
    return new Promise((resolve) => {
      const d = $('closeDialog'); const f = $('closeForm');
      f.reset(); $('closeWhat').textContent = 'Alarm ' + id.slice(0, 8);
      const done = (v) => { $('closeCancel').onclick = null; f.onsubmit = null; d.onclose = null; if (d.open) d.close(); resolve(v); };
      $('closeCancel').onclick = () => done(null);
      d.onclose = () => done(null);
      f.onsubmit = (e) => {
        e.preventDefault();
        const picked = f.querySelector('input[name=outcome]:checked');
        const note = $('closeNote').value.trim();
        if (!picked || !note) return;
        done({ outcome: picked.value, note });
      };
      d.showModal();
    });
  }
  async function act(id, verb) {
    const body = {};
    if (verb === 'actioned') { body.by = prompt('Who is acting on it?'); if (!body.by) return; }
    if (verb === 'close') {
      // Real or false is an explicit choice; Cancel only closes the dialog and leaves the alarm open.
      const choice = await closeChoice(id);
      if (!choice) return;
      body.outcome = choice.outcome; body.note = choice.note;
    }
    if (verb === 'escalate') { body.reason = prompt('Reason for escalating above the Regional OM (required)'); if (!body.reason) return; }
    try { await api('/api/alarms/' + encodeURIComponent(id) + '/' + verb, body); } catch (e) { alert(e.message); }
    load();
  }
  function render(s) {
    $('count').textContent = '(' + s.queue.length + ' open)';
    const q = $('queue'); q.replaceChildren();
    for (const a of s.queue) {
      const tr = el('tr');
      tr.append(el('td', a.severity, a.severity), el('td', a.summary + (a.repeats ? ' (x' + (a.repeats + 1) + ')' : '') + (a.restoredAt ? ' - restored' : '') + (a.notes && a.notes.length ? ' - ' + a.notes[a.notes.length - 1].text : '')), el('td', t(a.openedAt)), el('td', a.state + (a.actionBy ? ' by ' + a.actionBy : '')));
      const td = el('td');
      for (const [verb, label] of [['acknowledge','Acknowledge'],['actioned','Someone acting'],['close','Close'],['escalate','Escalate']]) {
        const b = el('button', label); b.addEventListener('click', () => act(a.id, verb)); td.append(b);
      }
      tr.append(td); q.append(tr);
    }
    const told = $('told'); told.replaceChildren();
    for (const n of s.notifications) told.append(el('li', t(n.at) + ' - ' + n.to.name + ' (' + n.to.role + ', ' + n.to.phone + '): ' + n.message));
    const h = $('health'); h.replaceChildren();
    for (const d of s.health) { const tr = el('tr'); tr.append(el('td', d.deviceId), el('td', d.siteId), el('td', d.kind), el('td', d.state === 'offline' ? 'OFFLINE' : d.state, d.state === 'online' ? 'on' : d.state === 'offline' ? 'off' : 'unk'), el('td', t(d.lastSeen) || 'never')); h.append(tr); }
    const g = $('gaps'); g.replaceChildren();
    for (const x of s.gaps) g.append(el('li', t(x.at) + ' - alarm ' + x.alarmId.slice(0, 8) + ': nobody set for ' + x.missingRoles.join(', ')));
    const r = $('refused'); r.replaceChildren();
    for (const x of s.refused) r.append(el('li', t(x.at) + ' - ' + x.source + ': ' + x.reason));
    const p = $('parked'); p.replaceChildren();
    for (const x of (s.primaRejected || [])) p.append(el('li', t(x.at) + ' - ' + x.kind + ' ' + x.id.slice(0, 12) + ': ' + x.reason + ' (tries: ' + x.attempts + ')'));
  }
  const m = (v) => v === null || v === undefined ? '-' : v + ' min';
  function renderKpis(k) {
    const rows = [
      ['Alarms', (f) => f.alarms],
      ['Time to acknowledge, median', (f) => m(f.ackMedianMin)],
      ['Time to acknowledge, 90% within', (f) => m(f.ackP90Min)],
      ['Acknowledged over target', (f) => f.ackOverTarget],
      ['Waiting now, over target', (f) => f.waitingOverTarget],
      ['Time to someone acting, median', (f) => m(f.actMedianMin)],
      ['Acting over target', (f) => f.actOverTarget],
      ['Time to close, median', (f) => m(f.closeMedianMin)],
      ['False alarms', (f) => f.falseAlarms + (f.falseRatePct === null ? '' : ' (' + f.falseRatePct + '%)')],
      ['Repeats', (f) => f.repeats],
    ];
    const b = $('kpis'); b.replaceChildren();
    for (const [label, get] of rows) { const tr = el('tr'); tr.append(el('td', label), el('td', String(get(k.all))), el('td', String(get(k.bySeverity.critical))), el('td', String(get(k.bySeverity.high))), el('td', String(get(k.bySeverity.normal)))); b.append(tr); }
    const d = k.devices;
    $('kpiDevices').textContent = 'Devices: ' + d.online + ' online, ' + d.offline + ' offline, ' + d.unknown + ' unknown' + (d.unknownPct === null ? '' : ' (' + d.unknownPct + '% unknown; unknown is never green)') + '. These are last reported states and alarm handling times; they do not show contracted post-minutes covered or recording integrity. Gaps: ' + k.gaps + '. Waiting to send to Prima: ' + k.toPrimaWaiting + '. Prima did not accept: ' + k.primaParked + '.';
    const c = $('kpiCompanies'); c.replaceChildren();
    for (const x of k.byCompany) { const tr = el('tr'); tr.append(el('td', x.companyId), el('td', String(x.figures.alarms)), el('td', m(x.figures.ackMedianMin)), el('td', String(x.figures.ackOverTarget)), el('td', String(x.figures.waitingOverTarget)), el('td', x.figures.falseRatePct === null ? '-' : x.figures.falseRatePct + '%'), el('td', x.devices.unknown + ' of ' + x.devices.total)); c.append(tr); }
  }
  const SEV = { critical: 'KRITIKAL', high: 'TINGGI', normal: 'BIASA', info: 'MAKLUMAT' };
  const STATE = { ok: 'Baik', attention: 'Perlu perhatian', quiet: 'Senyap', unknown: 'Tidak diketahui' };
  async function feedback(key, useful, li) {
    const note = useful ? '' : (prompt('Kenapa tidak berguna? (pilihan)') || '');
    try { await api('/api/assistant/feedback', { key, useful, note }); li.querySelector('.fb').textContent = 'Terima kasih, dicatat.'; } catch (e) { alert(e.message); }
  }
  function renderAssistant(v) {
    $('fcount').textContent = '(' + v.findings.length + ')';
    const ol = $('findings'); ol.replaceChildren();
    if (!v.findings.length) ol.append(el('li', 'Tiada penggera terbuka.'));
    for (const f of v.findings) {
      const li = el('li', undefined, f.allActioned ? 'done' : '');
      const head = el('div'); head.append(el('strong', SEV[f.severity] + ' ', f.severity), el('strong', f.title), el('span', ' - ' + f.alarmIds.length + ' penggera, sejak ' + t(f.firstOpenedAt), 'unk'));
      const why = el('ul', undefined, 'why'); for (const r of f.reasons) why.append(el('li', r));
      const next = el('ol', undefined, 'next'); for (const s of f.suggestions) next.append(el('li', s));
      const fb = el('div', undefined, 'fb');
      const yes = el('button', 'Berguna'); yes.addEventListener('click', () => feedback(f.key, true, li));
      const no = el('button', 'Tidak berguna'); no.addEventListener('click', () => feedback(f.key, false, li));
      fb.append(yes, no);
      li.append(head, el('div', 'Kenapa di sini:', 'unk'), why, el('div', 'Cadangan langkah seterusnya:', 'unk'), next, fb);
      ol.append(li);
    }
    const tb = $('systems'); tb.replaceChildren();
    for (const s of v.systems) {
      const tr = el('tr'); const d = s.devices;
      tr.append(el('td', s.label), el('td', STATE[s.state], s.state === 'ok' ? 'on' : s.state === 'quiet' ? 'off' : s.state === 'attention' ? 'high' : 'unk'), el('td', d.total ? d.online + ' / ' + d.offline + ' / ' + d.unknown : '-'), el('td', String(s.events24h)), el('td', String(s.refused24h)), el('td', s.note));
      tb.append(tr);
    }
  }
  function renderHandover(h) {
    const st = $('hoState'); const items = $('hoItems'); items.replaceChildren();
    $('hoGive').hidden = true; $('hoAgree').hidden = true; $('hoDisagree').hidden = true; $('hoForm').hidden = true;
    if (!h.roster) { st.textContent = 'Jadual tugas CMS belum diterima dari Prima.'; st.className = 'unk'; return; }
    st.className = '';
    const w = h.written; const k = h.taken;
    const parts = [];
    parts.push(h.ending ? 'Keluar: ' + (h.ending.staffName || 'tiada') + ' (tamat ' + t(h.ending.end) + ')' : 'Tiada syif sedang tamat');
    parts.push(h.starting ? 'Masuk: ' + (h.starting.staffName || 'tiada') + ' (mula ' + t(h.starting.start) + ')' : 'Tiada syif seterusnya dalam jadual');
    parts.push(w ? 'Ditulis ' + t(w.outgoing.at) + ': ' + w.outgoing.note : 'Belum ditulis');
    if (k) parts.push('Diambil ' + t(k.incoming.at) + (k.incoming.agree ? '' : ' (TIDAK SETUJU)') + ': ' + k.incoming.note);
    st.textContent = parts.join(' · ');
    if (w) for (const a of w.outgoing.openAlarms) items.append(el('li', a.kind + ': ' + a.summary + ' (' + a.state + ')'));
    const me = h.operator;
    const canGive = h.ending && h.ending.staffName === me && !w && Date.now() >= Date.parse(h.ending.end) - 3600000;
    const canTake = h.starting && h.starting.staffName === me && !k;
    if (canGive || canTake) { $('hoForm').hidden = false; $('hoGive').hidden = !canGive; $('hoAgree').hidden = !canTake; $('hoDisagree').hidden = !canTake; }
  }
  async function handover(path, body) {
    try { await api(path, Object.assign({ note: $('hoNote').value }, body)); $('hoNote').value = ''; load(); } catch (e) { alert(e.message); }
  }
  $('hoGive').addEventListener('click', () => handover('/api/handover/give', {}));
  $('hoAgree').addEventListener('click', () => handover('/api/handover/take', { agree: true }));
  $('hoDisagree').addEventListener('click', () => handover('/api/handover/take', { agree: false }));
  async function load() { if (!token) return; try { render(await api('/api/state')); renderHandover(await api('/api/handover')); renderAssistant(await api('/api/assistant')); renderKpis(await api('/api/kpis')); } catch {} }
  $('signin').addEventListener('submit', async (e) => {
    e.preventDefault(); token = $('token').value; $('token').value = '';
    try { render(await api('/api/state')); try { sessionStorage.setItem('cmsToken', token); } catch {} $('app').hidden = false; $('signout').hidden = false; $('signin').hidden = true; load(); } catch (err) { alert('Key not accepted'); token = ''; }
  });
  $('signout').addEventListener('click', signOut);
  $('briefBtn').addEventListener('click', async () => {
    $('brief').hidden = false; $('briefText').textContent = 'Menyediakan...';
    try {
      const b = await api('/api/assistant/briefing');
      $('briefText').textContent = b.state === 'ok' ? b.text : b.state === 'off' ? 'Ringkasan syif belum dihidupkan di pelayan dalaman CMS. Gunakan senarai di bawah.' : 'Ringkasan tidak dapat dibuat: ' + b.reason + ' Gunakan senarai di bawah.';
    } catch (e) { $('briefText').textContent = e.message; }
  });
  setInterval(() => { $('clock').textContent = new Date().toLocaleString(); load(); }, 5000);
  if (token) { $('app').hidden = false; $('signout').hidden = false; $('signin').hidden = true; load(); }
})();`;
