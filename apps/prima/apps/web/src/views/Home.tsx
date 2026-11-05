import { useState } from 'react';
import { ArrowRightIcon, CaretDownIcon } from '@phosphor-icons/react';
import { isGroupLeader, type HomeItem, type HomeLink } from '@prima/core';
import { GrowthPanel, iconFor } from './Growth';
import { ApprovalLimitsPanel } from './ApprovalLimits';
import { setFinTarget } from '../finTarget';
import { api } from '../api';
import { useApp } from '../App';
import { Chip, ErrorNotice, Loading, n, useLoad, type Tone } from '../ui';
import { Card, Empty, PageHead, Stat, Stats } from '../kit';
import '../styles/home.css';

const RANK: Record<string, number> = { crit: 0, warn: 1, info: 2, neutral: 3, ok: 4 };
const worst = (items: HomeItem[]): Tone => items.reduce<Tone>((w, t) => ((RANK[t.tone] ?? 5) < (RANK[w] ?? 5) ? t.tone : w), 'ok');

/** A section's heading on the dashboard: its name and how many lines it holds. */
function SectionHead({ id, title, items }: { id: string; title: string; items: HomeItem[] }) {
  const crit = items.filter((t) => t.tone === 'crit').length;
  return (
    <div className="home-section-head">
      <h2 id={id}>{title}</h2>
      <Chip tone={crit ? 'crit' : items.length ? 'warn' : 'ok'}>{items.length}</Chip>
    </div>
  );
}

/** The decisions waiting for this person: one card each, the tag on top and where it opens at the bottom. */
function ActionCards({ title, items, empty, open }: { title: string; items: HomeItem[]; empty: string; open: (l: HomeLink) => void }) {
  return (
    <section className="home-section" aria-labelledby="home-today">
      <SectionHead id="home-today" title={title} items={items} />
      {items.length === 0 ? (
        <Card>
          <Empty title={empty} />
        </Card>
      ) : (
        <div className="home-actions">
          {items.slice(0, 40).map((t, i) => (
            <button key={i} type="button" className="home-action" data-tone={t.tone} onClick={() => open(t.go)}>
              <span className="home-action-top">
                <span className="home-icon" data-tone={t.tone} aria-hidden="true">
                  {iconFor(t.tag)}
                </span>
                <Chip tone={t.tone}>{t.tag}</Chip>
              </span>
              <span className="home-action-title">{t.title}</span>
              <span className="home-action-detail">{t.detail}</span>
              <span className="home-action-go">
                Open
                <ArrowRightIcon size={14} weight="bold" aria-hidden="true" />
              </span>
            </button>
          ))}
        </div>
      )}
      {items.length > 40 && <p className="muted small">and {items.length - 40} more</p>}
    </section>
  );
}

const FOLD = 4;
/** A long list grouped by its tag: one card per area with its count, long areas folded until opened. */
function GroupedList({ id, title, items, empty, open }: { id: string; title: string; items: HomeItem[]; empty: string; open: (l: HomeLink) => void }) {
  const [unfolded, setUnfolded] = useState<Record<string, boolean>>({});
  const groups = new Map<string, HomeItem[]>();
  for (const t of items) groups.set(t.tag, [...(groups.get(t.tag) ?? []), t]);
  return (
    <section className="home-section" aria-labelledby={id}>
      <SectionHead id={id} title={title} items={items} />
      {items.length === 0 ? (
        <Card>
          <Empty title={empty} />
        </Card>
      ) : (
        <div className="home-groups">
          {[...groups].map(([tag, list]) => {
            const long = list.length > FOLD + 1;
            const all = !long || unfolded[tag];
            const tone = worst(list);
            return (
              <section key={tag} className="home-group" aria-label={`${tag}, ${list.length}`}>
                <div className="home-group-head">
                  <span className="home-icon" data-tone={tone} aria-hidden="true">
                    {iconFor(tag)}
                  </span>
                  <h3>{tag}</h3>
                  <Chip tone={tone}>{list.length}</Chip>
                </div>
                <ul className="home-group-list">
                  {(all ? list : list.slice(0, FOLD)).map((t, i) => (
                    <li key={i}>
                      <button type="button" className="home-item" onClick={() => open(t.go)}>
                        <span className="home-dot" data-tone={t.tone} aria-hidden="true" />
                        <span className="home-item-text">
                          <span className="home-item-title">{t.title}</span>
                          <span className="home-item-detail">{t.detail}</span>
                        </span>
                        <ArrowRightIcon className="home-item-go" size={14} aria-hidden="true" />
                      </button>
                    </li>
                  ))}
                </ul>
                {long && (
                  <button
                    type="button"
                    className="home-group-more"
                    aria-expanded={!!unfolded[tag]}
                    onClick={() => setUnfolded((u) => ({ ...u, [tag]: !u[tag] }))}
                  >
                    {unfolded[tag] ? 'Show fewer' : `Show all ${list.length}`}
                    <CaretDownIcon size={14} aria-hidden="true" data-open={!!unfolded[tag]} />
                  </button>
                )}
              </section>
            );
          })}
        </div>
      )}
    </section>
  );
}

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
    if (l.view === 'finance' && l.tab) setFinTarget({ tab: l.tab, section: l.section, companyId: l.companyId });
    else if (l.companyId) setCompanyId(l.companyId);
    go({ view: l.view, siteId: l.siteId, personId: l.personId, caseId: l.caseId, tenderId: l.tenderId });
  };
  return (
    <div className="page home">
      <PageHead title={data.title} sub={data.intro} />
      {data.watch && <ActionCards title={data.todoTitle ?? 'To do now'} items={data.todo} empty="Nothing needs your decision today." open={open} />}
      <section className="home-section" aria-label="Key numbers">
        <Stats>
          {data.tiles.map((t) => (
            <Stat
              key={t.label}
              label={t.label}
              value={n(t.value)}
              tone={t.value === 'UNKNOWN' ? 'unknown' : t.tone}
              note={t.note}
              icon={iconFor(t.label)}
              onClick={t.go.view === 'home' ? undefined : () => open(t.go)}
            />
          ))}
        </Stats>
      </section>
      {/* Growth for group leadership (Fauzan, 3 Nov 2026): after the decisions and key numbers, before the monitor list. */}
      {isGroupLeader(me.user) && !companyScoped && <GrowthPanel />}
      {me.user.opsTier === 'ceo' && !companyScoped && <ApprovalLimitsPanel />}
      {data.watch ? (
        <GroupedList id="home-watch" title={data.watchTitle ?? 'Monitor'} items={data.watch} empty="Nothing to watch right now." open={open} />
      ) : (
        <GroupedList id="home-todo" title={data.todoTitle ?? 'To do now'} items={data.todo} empty="Nothing needs you right now." open={open} />
      )}
    </div>
  );
}
