import type { HomeItem, HomeLink } from '@prima/core';
import { api } from '../api';
import { useApp } from '../App';
import { Chip, ErrorNotice, Kpi, Loading, useLoad } from '../ui';

/** The first screen for each job: only what that person must watch, each line opening where the work is done (Fauzan, 25 Oct 2026). */
export function HomeView() {
  const { me, companyId, setCompanyId, go } = useApp();
  const companyScoped = me.user.role === 'company_manager' || me.user.role === 'admin_exec';
  const { data, error } = useLoad(() => api.home(companyScoped ? companyId : undefined), [companyScoped ? companyId : '']);
  if (error)
    return (
      <div className="page">
        <ErrorNotice error={error} />
      </div>
    );
  if (!data)
    return (
      <div className="page">
        <Loading what="your dashboard" />
      </div>
    );
  const open = (l: HomeLink) => {
    if (l.companyId) setCompanyId(l.companyId);
    go({ view: l.view, siteId: l.siteId, personId: l.personId, caseId: l.caseId, tenderId: l.tenderId });
  };
  const list = (title: string, items: HomeItem[], empty: string) => {
    const crit = items.filter((t) => t.tone === 'crit').length;
    return (
      <section className="panel">
        <div className="panel-head">
          <h2>{title}</h2>
          <Chip tone={crit ? 'crit' : items.length ? 'warn' : 'ok'}>{items.length}</Chip>
        </div>
        <div className="list">
          {items.length === 0 && <div className="empty">{empty}</div>}
          {items.slice(0, 40).map((t, i) => (
            <button key={i} className="list-item" onClick={() => open(t.go)}>
              <div>
                <div style={{ fontWeight: 600 }}>{t.title}</div>
                <div className="muted small">{t.detail}</div>
              </div>
              <Chip tone={t.tone}>{t.tag}</Chip>
            </button>
          ))}
          {items.length > 40 && <div className="muted small">and {items.length - 40} more</div>}
        </div>
      </section>
    );
  };
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>{data.title}</h1>
          <p>{data.intro}</p>
        </div>
      </div>
      {data.watch && list(data.todoTitle ?? 'To do now', data.todo, 'Nothing needs your decision today.')}
      <div className="kpis">
        {data.tiles.map((t) => (
          <button key={t.label} className="kpi-link" onClick={() => (t.go.view === 'home' ? undefined : open(t.go))}>
            <Kpi label={t.label} value={t.value} tone={t.tone} note={t.note} />
          </button>
        ))}
      </div>
      {data.watch
        ? list(data.watchTitle ?? 'Monitor', data.watch, 'Nothing to watch right now.')
        : list(data.todoTitle ?? 'To do now', data.todo, 'Nothing needs you right now.')}
    </div>
  );
}
