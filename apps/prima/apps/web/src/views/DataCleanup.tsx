import { useState } from 'react';
import { api } from '../api';
import { useLang } from '../i18n';
import { Chip, ErrorNotice, Kpi, Loading, dateTimeLabel, useLoad } from '../ui';

/**
 * Data clean-up (Part AG, AG15). Fixed rules list duplicates, gaps and clashes in staff, site and contract records
 * while data collection runs (to about 18 January 2027). Each line names the record by its number only and says how to
 * fix it; the person corrects the record in its usual form and the line goes away by itself. No AI, nothing changed here.
 */
const AREAS = [
  { id: '', bm: 'Semua', en: 'All' },
  { id: 'staff', bm: 'Staf', en: 'Staff' },
  { id: 'site', bm: 'Tapak', en: 'Sites' },
  { id: 'contract', bm: 'Kontrak', en: 'Contracts' },
] as const;

export function DataCleanupView() {
  const { lang } = useLang();
  const en = lang === 'en';
  const [area, setArea] = useState('');
  const [companyId, setCompanyId] = useState('');
  const { data, error } = useLoad(() => api.dataCleanup({ area: area || undefined, companyId: companyId || undefined }), [area, companyId]);
  if (error) return <ErrorNotice error={error} />;
  if (!data) return <Loading what="data clean-up" />;
  const fix = data.findings.filter((f) => f.level === 'fix').length;
  return (
    <div className="stack" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <section className="panel">
        <div className="panel-head">
          <h3>{en ? 'Data clean-up' : 'Semakan data'}</h3>
          <span className="muted small">{en ? 'As at' : 'Pada'} {dateTimeLabel(data.asOf)}</span>
        </div>
        <div className="panel-body">
          <p className="muted small">
            {en
              ? 'Prima checks staff, site and contract records for duplicates, gaps and clashes. Each line names the record by its number. Open the record in its usual screen and correct it; the line goes away by itself.'
              : 'Prima menyemak rekod staf, tapak dan kontrak untuk pendua, maklumat tertinggal dan percanggahan. Setiap baris menyebut nombor rekod. Buka rekod di skrin biasa dan betulkan; baris itu hilang dengan sendiri.'}
          </p>
          <div className="kpis">
            <Kpi label={en ? 'To look at' : 'Perlu dilihat'} value={data.total} tone={data.total ? 'warn' : 'ok'} />
            <Kpi label={en ? 'Wrong, to fix' : 'Salah, perlu dibetulkan'} value={fix} tone={fix ? 'crit' : 'ok'} />
          </div>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
            <div className="tabbar" role="tablist" aria-label="Record kind">
              {AREAS.map((a) => (
                <button key={a.id} role="tab" aria-selected={area === a.id} onClick={() => setArea(a.id)}>
                  {en ? a.en : a.bm}
                </button>
              ))}
            </div>
            {data.companies.length > 1 && (
              <select className="select" aria-label="Show company" value={companyId} onChange={(e) => setCompanyId(e.target.value)}>
                <option value="">{en ? 'Every company' : 'Semua syarikat'}</option>
                {data.companies.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.code} ({c.open})
                  </option>
                ))}
              </select>
            )}
          </div>
        </div>
      </section>

      {data.byRule.length === 0 && (
        <section className="panel">
          <p className="muted">{en ? 'Nothing to fix. Well done.' : 'Tiada yang perlu dibetulkan.'}</p>
        </section>
      )}
      {data.byRule.map((r) => (
        <section className="panel" key={r.rule}>
          <div className="panel-head">
            <h3 style={{ fontSize: '1rem' }}>{r.what}</h3>
            <Chip tone={r.level === 'fix' ? 'crit' : 'warn'}>{r.level === 'fix' ? (en ? 'Fix' : 'Betulkan') : en ? 'Check' : 'Semak'}</Chip>
          </div>
          <p className="small">
            <strong>{en ? 'How to fix:' : 'Cara betulkan:'}</strong> {r.fix}
          </p>
          <ul className="small" aria-label={r.rule}>
            {data.findings
              .filter((f) => f.rule === r.rule)
              .map((f) => (
                <li key={f.id}>
                  {f.companyCode} · <strong>{f.record}</strong>
                  {f.with.length > 0 && <span className="muted"> · {en ? 'with' : 'dengan'} {f.with.join(', ')}</span>}
                </li>
              ))}
          </ul>
        </section>
      ))}
      {data.more > 0 && <p className="muted small">{en ? `${data.more} more lines; choose a company or a kind to see them.` : `${data.more} baris lagi; pilih syarikat atau jenis untuk melihatnya.`}</p>}
    </div>
  );
}
