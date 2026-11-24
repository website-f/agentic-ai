import { useState } from 'react';
import { ArrowRightIcon, CaretDownIcon } from '@phosphor-icons/react';
import { isGroupLeader, type HomeItem, type HomeLink } from '@prima/core';
import { GrowthPanel, iconFor } from './Growth';
import { ApprovalLimitsPanel, StaffLeaveVcPanel } from './ApprovalLimits';
import { CashStandInPanel } from './CashStandIn';
import { setFinTarget } from '../finTarget';
import { api } from '../api';
import { forMe, myName } from '../office-access';
import { useApp } from '../App';
import { Chip, ErrorNotice, Loading, n, useLoad, type Tone } from '../ui';
import { Card, Empty, PageHead, Stat, Stats } from '../kit';
import { FoldSection, useFoldMap } from '../fold';
import '../styles/home.css';
import { AllScreens } from './AllScreens';
import { HomeLaunchpad, HomeShortcuts, waitingBySpace } from '../Spaces';

const RANK: Record<string, number> = { crit: 0, warn: 1, info: 2, neutral: 3, ok: 4 };
const worst = (items: HomeItem[]): Tone => items.reduce<Tone>((w, t) => ((RANK[t.tone] ?? 5) < (RANK[w] ?? 5) ? t.tone : w), 'ok');

/** P128: a section's count beside its folding heading. */
function CountChip({ items }: { items: HomeItem[] }) {
  const crit = items.filter((t) => t.tone === 'crit').length;
  return <Chip tone={crit ? 'crit' : items.length ? 'warn' : 'ok'}>{items.length}</Chip>;
}

/** P128: what a folded section holds, area by area ("Foreign workers 6 · Finance 1"); each name its own text for the translator. */
function TagSummary({ items }: { items: HomeItem[] }) {
  const by = new Map<string, number>();
  for (const t of items) by.set(t.tag, (by.get(t.tag) ?? 0) + 1);
  return (
    <>
      {[...by].map(([tag, k], i) => (
        <span key={tag}>
          {i > 0 && <span aria-hidden="true"> · </span>}
          <span>{tag}</span> <span className="num">{k}</span>
        </span>
      ))}
    </>
  );
}

/** P128: the folded key numbers name the ones that need a look. */
function NumbersSummary({ tiles }: { tiles: { label: string; tone: string }[] }) {
  const look = tiles.filter((t) => t.tone === 'crit' || t.tone === 'warn');
  if (!look.length) return <span>All in order</span>;
  return (
    <>
      {look.slice(0, 4).map((t, i) => (
        <span key={t.label}>
          {i > 0 && <span aria-hidden="true"> · </span>}
          <span>{t.label}</span>
        </span>
      ))}
    </>
  );
}

const FIRST = 6;
/** The decisions waiting for this person: one card each, the tag on top and where it opens at the bottom. P128: the first 6, then Show all. */
function ActionCards({ title, items, empty, open }: { title: string; items: HomeItem[]; empty: string; open: (l: HomeLink) => void }) {
  const [all, setAll] = useState(false);
  const shown = items.slice(0, all ? 40 : FIRST);
  return (
    <FoldSection id="home.today" className="home-section" title={title} badge={<CountChip items={items} />} summary={items.length ? <TagSummary items={items} /> : empty}>
      {items.length === 0 ? (
        <Card>
          <Empty title={empty} />
        </Card>
      ) : (
        <div className="home-actions">
          {shown.map((t, i) => (
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
      {items.length > FIRST && (
        <button type="button" className="btn home-more" aria-expanded={all} onClick={() => setAll((a) => !a)}>
          {all ? 'Show fewer' : `Show all ${items.length}`}
          <CaretDownIcon size={14} aria-hidden="true" data-open={all} />
        </button>
      )}
      {all && items.length > 40 && <p className="muted small">and {items.length - 40} more</p>}
    </FoldSection>
  );
}

const FOLD = 4;
/**
 * A long list grouped by its tag: one card per area with its count. P128: each area folds to its heading and one line
 * (its first item); what the person opened or closed is remembered on this device. Long areas still show 4 until opened.
 */
function GroupedList({
  id,
  title,
  items,
  empty,
  open,
  groupsOpen,
}: {
  id: string;
  title: string;
  items: HomeItem[];
  empty: string;
  open: (l: HomeLink) => void;
  groupsOpen: boolean;
}) {
  const [unfolded, setUnfolded] = useState<Record<string, boolean>>({});
  const folds = useFoldMap(`${id}.areas`, groupsOpen);
  const groups = new Map<string, HomeItem[]>();
  for (const t of items) groups.set(t.tag, [...(groups.get(t.tag) ?? []), t]);
  const tags = [...groups.keys()];
  const anyOpen = tags.some((t) => folds.isOpen(t));
  return (
    <FoldSection
      id={id}
      className="home-section"
      title={title}
      badge={<CountChip items={items} />}
      summary={items.length ? <TagSummary items={items} /> : empty}
      actions={
        tags.length > 1 ? (
          <button type="button" className="btn btn-sm" onClick={() => folds.setAll(tags, !anyOpen)}>
            {anyOpen ? 'Close all' : 'Open all'}
          </button>
        ) : undefined
      }
    >
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
            const isOpen = folds.isOpen(tag);
            return (
              <section key={tag} className="home-group" data-open={isOpen || undefined} aria-label={`${tag}, ${list.length}`}>
                <button type="button" className="home-group-head" aria-expanded={isOpen} onClick={() => folds.toggle(tag)}>
                  <span className="home-icon" data-tone={tone} aria-hidden="true">
                    {iconFor(tag)}
                  </span>
                  <span className="home-group-name">
                    <span className="home-group-title">{tag}</span>
                    {!isOpen && <span className="home-group-peek">{list[0].title}</span>}
                  </span>
                  <Chip tone={tone}>{list.length}</Chip>
                  <CaretDownIcon className="home-group-caret" size={14} weight="bold" aria-hidden="true" />
                </button>
                {isOpen && (
                  <>
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
                  </>
                )}
              </section>
            );
          })}
        </div>
      )}
    </FoldSection>
  );
}

/** The first screen for each job: only what that person must watch, each line opening where the work is done (Fauzan, 25 Oct 2026). */
export function HomeView() {
  const { me, companyId, setCompanyId, go, apps, menu, mainMenu, openSpace } = useApp();
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
      {/* P91 (Fitri, 9 Nov 2026): a long menu becomes apps: a greeting, one search, the app cards and the person's own
          screens on top; the decisions and key numbers follow. A short menu keeps the plain page title. */}
      {apps && openSpace ? (
        <HomeLaunchpad name={myName(me)} intro={forMe(me, data.intro)} menu={menu ?? []} userId={me.user.id} waiting={waitingBySpace(data.todo)} onView={(v) => go({ view: v })} onSpace={openSpace} />
      ) : (menu ?? []).length > 8 ? (
        // P129: a greeting, one search and shortcut tiles; the side menu holds every screen in Prima's sections.
        <HomeShortcuts name={myName(me)} intro={forMe(me, data.intro)} menu={menu ?? []} main={mainMenu ?? []} userId={me.user.id} onView={(v) => go({ view: v })} />
      ) : (
        <PageHead title={data.title} sub={forMe(me, data.intro)} />
      )}
      {data.watch && <ActionCards title={data.todoTitle ?? 'To do now'} items={data.todo} empty="Nothing needs your decision today." open={open} />}
      <FoldSection
        id="home.numbers"
        className="home-section"
        title="Key numbers"
        badge={<span className="home-cat-count num">{data.tiles.length}</span>}
        summary={<NumbersSummary tiles={data.tiles} />}
      >
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
      </FoldSection>
      {/* P90 (Fitri, 9 Nov 2026): every screen this person may open, by category, after the decisions and key numbers. */}
      {/* P129: every screen is in the side menu's sections; Home keeps the shortcuts only. */}
      {!apps && (menu ?? []).length <= 8 && <AllScreens />}
      {/* Growth for group leadership (Fauzan, 3 Nov 2026): after the decisions and key numbers, before the monitor list. */}
      {isGroupLeader(me.user) && !companyScoped && <GrowthPanel />}
      {/* P128: the leadership switches fold under one heading (closed until opened), so the dashboard stays short. */}
      {!companyScoped && (me.user.opsTier === 'ceo' || me.user.leadership === 'finance_director') && (
        <FoldSection
          id="home.lead"
          className="home-section"
          title="Leadership settings"
          defaultOpen={false}
          summary={
            <>
              {me.user.opsTier === 'ceo' && (
                <>
                  <span>Approval limits</span>
                  <span aria-hidden="true"> · </span>
                  <span>Office staff leave consent</span>
                  <span aria-hidden="true"> · </span>
                </>
              )}
              <span>Finance Director stands in</span>
            </>
          }
        >
          {me.user.opsTier === 'ceo' && <ApprovalLimitsPanel />}
          {me.user.opsTier === 'ceo' && <StaffLeaveVcPanel />}
          <CashStandInPanel />
        </FoldSection>
      )}
      {data.watch ? (
        <GroupedList id="home.watch" title={data.watchTitle ?? 'Monitor'} items={data.watch} empty="Nothing to watch right now." open={open} groupsOpen={false} />
      ) : (
        <GroupedList id="home.todo" title={data.todoTitle ?? 'To do now'} items={data.todo} empty="Nothing needs you right now." open={open} groupsOpen />
      )}
    </div>
  );
}
